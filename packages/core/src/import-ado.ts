import { and, eq, like } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";
import { htmlToText, mapAdoState, mapAdoType } from "./ado-map.ts";

/**
 * Import work items from an Azure DevOps / TFS CSV export (Boards →
 * query → "Export to CSV"). Old TFS can't re-import a CSV; this brings
 * the items INTO DCC as requirements, keeping the ADO id, type, state
 * and area path. It does NOT push anything back to ADO — the items are
 * already there.
 */

/* ── RFC-4180 CSV parser (handles quotes, "" escapes, embedded \n and ,) ── */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}


export type ImportResult = {
  total: number;
  created: number;
  skipped: number;
  items: { adoId: number; title: string; status: "created" | "skipped-exists" | "skipped-bad" }[];
};

export async function importAdoCsv(input: { clientId: string; csv: string; by: { userId: string } }): Promise<ImportResult> {
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw new Error("ה-CSV ריק או ללא שורת כותרות");
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cType = col("work item type");
  const cId = col("id");
  const cTitle = col("title");
  const cAssignee = col("assigned to");
  const cState = col("state");
  const cArea = col("area path");
  const cTags = col("tags");
  const cDesc = col("description");
  if (cId < 0 || cTitle < 0) throw new Error('ה-CSV חייב לכלול לפחות עמודות "ID" ו-"Title"');

  const parsed = rows.slice(1).map((r) => ({
    adoId: Number((r[cId] ?? "").replace(/[^\d]/g, "")),
    rawType: (r[cType] ?? "").trim(),
    title: (r[cTitle] ?? "").trim(),
    assignee: cAssignee >= 0 ? (r[cAssignee] ?? "").trim() : "",
    rawState: cState >= 0 ? (r[cState] ?? "").trim() : "",
    area: cArea >= 0 ? (r[cArea] ?? "").trim() : "",
    tags: cTags >= 0 ? (r[cTags] ?? "").trim() : "",
    desc: cDesc >= 0 ? (r[cDesc] ?? "").trim() : "",
  }));

  // de-dup by the "ADO-<id>" key we assign on import
  const existing = new Set(
    (await withTenant(input.clientId, (tx) =>
      tx.select({ k: workitem.key }).from(workitem).where(and(eq(workitem.clientId, input.clientId), like(workitem.key, "ADO-%"))),
    )).map((r) => r.k),
  );

  const out: ImportResult = { total: parsed.length, created: 0, skipped: 0, items: [] };

  for (const p of parsed) {
    if (!p.adoId || !p.title) {
      out.skipped++;
      out.items.push({ adoId: p.adoId, title: p.title, status: "skipped-bad" });
      continue;
    }
    const key = `ADO-${p.adoId}`;
    if (existing.has(key)) {
      out.skipped++;
      out.items.push({ adoId: p.adoId, title: p.title, status: "skipped-exists" });
      continue;
    }
    const type = mapAdoType(p.rawType);
    const phase = mapAdoState(p.rawState);

    // NOTE: linkedAdoId is left NULL. The item already exists in the
    // user's own ADO project (that's where the CSV came from); the key
    // "ADO-<id>" records that origin. Pushing it into the *connected*
    // project is an explicit follow-up (sync), which then sets linkedAdoId.
    const [wi] = await withTenant(input.clientId, (tx) =>
      tx
        .insert(workitem)
        .values({
          clientId: input.clientId,
          ownerId: input.by.userId,
          title: p.title,
          type,
          phase,
          key,
          adoAreaPath: p.area || null,
        })
        .returning(),
    );

    const provenance = [
      `מיובא מ-Azure DevOps · work item #${p.adoId}`,
      p.rawType && `סוג מקורי: ${p.rawType}`,
      p.rawState && `סטטוס מקורי: ${p.rawState}`,
      p.area && `Area: ${p.area}`,
      p.assignee && `שויך ל: ${p.assignee}`,
      p.tags && `תגיות: ${p.tags}`,
    ].filter(Boolean).join(" · ");
    await appendEvent({
      clientId: input.clientId, workitemId: wi!.id, source: "ado", type: "note.added",
      actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
      payload: { body: provenance },
    });
    const descText = htmlToText(p.desc);
    if (descText) {
      await appendEvent({
        clientId: input.clientId, workitemId: wi!.id, source: "ado", type: "note.added",
        actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
        payload: { body: `תיאור מ-ADO:\n${descText}` },
      });
    }
    await regenerateBrief(input.clientId, wi!.id);
    out.created++;
    out.items.push({ adoId: p.adoId, title: p.title, status: "created" });
  }
  return out;
}

import { and, eq, inArray } from "drizzle-orm";
import { appendEvent, db, withTenant } from "@dcc/db";
import { workitem } from "@dcc/db/schema";
import { regenerateBrief } from "./brief/generate.ts";

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

const TYPE_MAP: Record<string, "epic" | "feature" | "story" | "bug" | "task" | "spike"> = {
  epic: "epic",
  feature: "feature",
  "user story": "story",
  "product backlog item": "story",
  requirement: "story",
  "change request": "story",
  bug: "bug",
  issue: "task",
  task: "task",
  "test case": "task",
  "test plan": "task",
  "test suite": "task",
};

const STATE_MAP: Record<string, "intake" | "shaping" | "building" | "review" | "done" | "archived"> = {
  new: "intake",
  proposed: "intake",
  "to do": "intake",
  approved: "shaping",
  design: "shaping",
  committed: "shaping",
  active: "building",
  "in progress": "building",
  "in development": "building",
  doing: "building",
  resolved: "review",
  "qa test": "review",
  "prod ready": "review",
  "ready for prod": "review",
  released: "done",
  closed: "done",
  done: "done",
  completed: "done",
  removed: "archived",
};

const htmlToText = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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

  const validIds = parsed.filter((p) => p.adoId > 0 && p.title).map((p) => p.adoId);
  const existing = validIds.length
    ? new Set(
        (await withTenant(input.clientId, (tx) =>
          tx.select({ a: workitem.linkedAdoId }).from(workitem).where(and(eq(workitem.clientId, input.clientId), inArray(workitem.linkedAdoId, validIds))),
        )).map((r) => r.a),
      )
    : new Set<number | null>();

  const out: ImportResult = { total: parsed.length, created: 0, skipped: 0, items: [] };

  for (const p of parsed) {
    if (!p.adoId || !p.title) {
      out.skipped++;
      out.items.push({ adoId: p.adoId, title: p.title, status: "skipped-bad" });
      continue;
    }
    if (existing.has(p.adoId)) {
      out.skipped++;
      out.items.push({ adoId: p.adoId, title: p.title, status: "skipped-exists" });
      continue;
    }
    const type = TYPE_MAP[p.rawType.toLowerCase()] ?? "task";
    const phase = STATE_MAP[p.rawState.toLowerCase()] ?? "intake";

    const [wi] = await withTenant(input.clientId, (tx) =>
      tx
        .insert(workitem)
        .values({
          clientId: input.clientId,
          ownerId: input.by.userId,
          title: p.title,
          type,
          phase,
          key: `ADO-${p.adoId}`,
          linkedAdoId: p.adoId,
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

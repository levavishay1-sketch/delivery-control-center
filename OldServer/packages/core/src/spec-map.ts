/**
 * The specification as it arrived, and what in it a task implements.
 *
 * A requirement's spec lives in two places: the attached document, and the
 * decisions closed on it (`gap` rows). The document is read straight out of
 * the file into its own headings, paragraphs and tables, with an id on every
 * row, cell and line (`spec-doc.ts`), and kept as read (`spec_document`) —
 * that is what the screen draws, word for word. The one step that needs a
 * model is saying which of those pieces are requirements (`spec_section`),
 * which task implements each (`task_spec_link`), and where a closed decision
 * overrules the document's words. Nothing here rewrites the spec: a
 * correction strikes the words through beside what was decided, never
 * instead of them.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { attachment, gap, specDocument, specSection, task, taskSpecLink, workitem } from "@dcc/db/schema";
import { docElements, docFromHtml, docFromText, overruledPieces, type SpecCorrection, type SpecDoc, type SpecReadAccepted } from "./spec-doc.ts";
export { checkSpecRead, type SpecCorrection, type SpecLink, type SpecRead, type SpecReadAccepted } from "./spec-doc.ts";

/** A decision is part of the spec too, and a task can point at it — this is the id it gets, everywhere. */
export const decisionAnchor = (gapId: string) => `d.${gapId.slice(0, 8)}`;

export type SpecPiece = {
  anchor: string;
  kind: "requirement" | "decision";
  title: string;
  /** A closed decision struck out every word of it — nothing is left to build, so it is not a gap. */
  overruled: boolean;
  /** The tasks that implement it, by seq — empty means nothing does. */
  tasks: { id: string; seq: number; intent: string; source: string }[];
};
export type SpecDecision = { anchor: string; question: string; answer: string };
export type SpecView = {
  /** Present once the requirements in the document have been marked. */
  read: boolean;
  /** What it was read from, so the screen can say. */
  source: { attachmentId: string; name: string } | null;
  /** The document as it arrived. */
  doc: SpecDoc | null;
  corrections: SpecCorrection[];
  /** Every requirement in the document, in its order, then every closed decision. */
  pieces: SpecPiece[];
  /** Every question closed on the requirement, with its answer — as it stands now. */
  decisions: SpecDecision[];
  /** Anchors no task implements — a requirement a decision struck out entirely is not one of them. */
  uncovered: string[];
};

/** The attachment the spec is read out of: the one with the most to say. */
const specAttachment = <A extends { extractedText: string | null }>(atts: A[]): A | null =>
  atts.filter((a) => (a.extractedText ?? "").trim().length > 0).sort((a, b) => (b.extractedText?.length ?? 0) - (a.extractedText?.length ?? 0))[0] ?? null;

/**
 * The document, the requirements in it and who implements each — what the
 * screen draws. The document needs no model to be shown: until its
 * requirements have been marked it is read straight out of the file, and
 * shown as it arrived with nothing marked on it.
 */
export async function specFor(clientId: string, workitemId: string): Promise<SpecView> {
  const view = await withTenant(clientId, async (tx) => {
    const [stored] = await tx.select().from(specDocument).where(eq(specDocument.workitemId, workitemId)).limit(1);
    const reqs = await tx.select().from(specSection).where(and(eq(specSection.workitemId, workitemId), eq(specSection.kind, "requirement"))).orderBy(asc(specSection.ordinal));
    const links = await tx.select().from(taskSpecLink).where(eq(taskSpecLink.workitemId, workitemId));
    const ids = [...new Set(links.map((l) => l.taskId))];
    const tasks = ids.length ? await tx.select({ id: task.id, seq: task.seq, intent: task.intent, active: task.active, state: task.state }).from(task).where(inArray(task.id, ids)) : [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // The answers as they stand now — a question closed after the reading still shows, and shows as not yet implemented.
    const decisions = (await tx.select().from(gap).where(eq(gap.workitemId, workitemId)))
      .filter((g) => g.state === "resolved" && (g.answer ?? "").trim())
      .sort((a, b) => +a.createdAt - +b.createdAt)
      .map((g): SpecDecision => ({ anchor: decisionAnchor(g.id), question: g.description.trim(), answer: (g.answer ?? "").trim() }));
    const [att] = stored?.attachmentId
      ? await tx.select({ id: attachment.id, name: attachment.name }).from(attachment).where(eq(attachment.id, stored.attachmentId)).limit(1)
      : [];

    const byAnchor = new Map<string, SpecPiece["tasks"]>();
    for (const l of links) {
      const t = byId.get(l.taskId);
      if (!t || !t.active || t.state === "dropped") continue;
      byAnchor.set(l.anchor, [...(byAnchor.get(l.anchor) ?? []), { id: t.id, seq: t.seq, intent: t.intent, source: l.source }]);
    }
    const tasksOf = (a: string) => (byAnchor.get(a) ?? []).sort((x, y) => x.seq - y.seq);
    const doc = (stored?.doc as SpecDoc | undefined) ?? null;
    const corrections = (stored?.corrections as SpecCorrection[] | undefined) ?? [];
    const overruled = doc ? overruledPieces(doc, corrections) : new Set<string>();
    const pieces: SpecPiece[] = stored
      ? [
          ...reqs.map((r): SpecPiece => ({ anchor: r.anchor, kind: "requirement", title: r.title, overruled: overruled.has(r.anchor), tasks: tasksOf(r.anchor) })),
          ...decisions.map((d): SpecPiece => ({ anchor: d.anchor, kind: "decision", title: d.question, overruled: false, tasks: tasksOf(d.anchor) })),
        ]
      : [];
    return {
      read: !!stored,
      source: att ? { attachmentId: att.id, name: att.name } : null,
      doc,
      corrections,
      pieces,
      decisions,
      uncovered: pieces.filter((p) => !p.tasks.length && !p.overruled).map((p) => p.anchor),
    };
  });
  if (view.read) return view;
  const att = await withTenant(clientId, async (tx) => specAttachment(await tx.select().from(attachment).where(eq(attachment.workitemId, workitemId))));
  const doc = att ? await readSpecDoc(att).catch(() => null) : null;
  return { ...view, doc, source: att && doc ? { attachmentId: att.id, name: att.name } : null };
}

/** What one task implements — its own list, away from the document. */
export async function specForTask(clientId: string, taskId: string): Promise<{ anchor: string; title: string; kind: string }[]> {
  return withTenant(clientId, async (tx) => {
    const links = await tx.select().from(taskSpecLink).where(eq(taskSpecLink.taskId, taskId));
    if (!links.length) return [];
    const rows = await tx.select().from(specSection).where(and(eq(specSection.workitemId, links[0]!.workitemId), inArray(specSection.anchor, links.map((l) => l.anchor)))).orderBy(asc(specSection.ordinal));
    return rows.map((r) => ({ anchor: r.anchor, title: r.title, kind: r.kind }));
  });
}

/* ── reading the document out of the file ──────────────────────────── */

/**
 * The document's own blocks. A .docx is converted to HTML and walked, so its
 * tables stay tables with the customer's columns; anything else falls back
 * to the text that was already extracted from it.
 */
export async function readSpecDoc(att: { name: string; content: Buffer | null; extractedText: string | null }): Promise<SpecDoc | null> {
  if (att.content && /\.docx$/i.test(att.name)) {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.convertToHtml({ buffer: att.content });
    const doc = docFromHtml(value);
    if (doc.blocks.length) return doc;
  }
  const text = (att.extractedText ?? "").trim();
  return text ? docFromText(text) : null;
}

/* ── writing it down ───────────────────────────────────────────────── */

/**
 * Replace the requirement's reading with this one: the document as read,
 * the requirements in it, the decisions, and who implements what. Links a
 * PERSON made by hand survive when the piece they point at is still there,
 * and are counted when it is not.
 */
export async function saveSpecRead(input: {
  clientId: string; workitemId: string; attachmentId: string | null; doc: SpecDoc;
  read: SpecReadAccepted;
  decisions: { id: string; description: string; answer: string | null }[];
  tasks: { id: string; seq: number }[];
  by: { userId: string };
  source?: "breakdown" | "mapping";
}): Promise<{ requirements: number; links: number; lostManual: number }> {
  const { clientId, workitemId, read, doc } = input;
  const bySeq = new Map(input.tasks.map((t) => [t.seq, t.id]));
  const order = docElements(doc);
  const at = new Map(order.map((e, i) => [e.id, i]));
  const textOf = new Map(order.map((e) => [e.id, e.text]));

  const kept = await withTenant(clientId, async (tx) => {
    const manual = await tx.select().from(taskSpecLink).where(and(eq(taskSpecLink.workitemId, workitemId), eq(taskSpecLink.source, "manual")));
    await tx.delete(taskSpecLink).where(eq(taskSpecLink.workitemId, workitemId));
    await tx.delete(specSection).where(eq(specSection.workitemId, workitemId));
    await tx.delete(specDocument).where(eq(specDocument.workitemId, workitemId));
    await tx.insert(specDocument).values({ clientId, workitemId, attachmentId: input.attachmentId, doc, corrections: read.corrections });

    const reqs = [...read.requirements].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
    let ordinal = 0;
    for (const r of reqs) {
      await tx.insert(specSection).values({
        clientId, workitemId, anchor: r.id, ordinal: ordinal++, kind: "requirement",
        title: r.title.trim(), body: textOf.get(r.id) ?? "", attachmentId: input.attachmentId,
      });
    }
    for (const d of input.decisions) {
      await tx.insert(specSection).values({
        clientId, workitemId, anchor: decisionAnchor(d.id), ordinal: ordinal++, kind: "decision",
        title: d.description.trim(), body: (d.answer ?? "").trim(), gapId: d.id,
      });
    }

    const anchors = new Set([...reqs.map((r) => r.id), ...input.decisions.map((d) => decisionAnchor(d.id))]);
    let links = 0;
    for (const l of read.links) {
      const taskId = bySeq.get(l.seq);
      if (!taskId || !anchors.has(l.id)) continue;
      const added = await tx.insert(taskSpecLink).values({ clientId, workitemId, taskId, anchor: l.id, source: input.source ?? "mapping" }).onConflictDoNothing().returning({ id: taskSpecLink.id });
      links += added.length;
    }
    let lostManual = 0;
    for (const m of manual) {
      if (!anchors.has(m.anchor)) { lostManual++; continue; }
      await tx.insert(taskSpecLink).values({ clientId, workitemId, taskId: m.taskId, anchor: m.anchor, source: "manual" }).onConflictDoUpdate({ target: [taskSpecLink.taskId, taskSpecLink.anchor], set: { source: "manual" } });
    }
    return { requirements: reqs.length, links, lostManual };
  });

  await appendEvent({
    clientId, workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:spec-map" },
    payload: { body: `📑 האפיון נקרא: ${kept.requirements} דרישות סומנו במסמך · ${kept.links} קישורים למשימות${read.unsupported.length ? ` · ${read.unsupported.length} קישורים נדחו — ההוראה של המשימה לא אומרת את מה שצוטט ממנה` : ""}${read.corrections.length ? ` · ${read.corrections.length} מקומות שהחלטה גוברת על המסמך` : ""}${kept.lostManual ? ` · ${kept.lostManual} קישורים ידניים אבדו (החלק שהם הצביעו עליו כבר לא קיים)` : ""}` },
  });
  return kept;
}

/** One task's own mapping, set by a person on the task screen. */
export async function setTaskSpecLinks(clientId: string, taskId: string, anchors: string[]): Promise<number> {
  return withTenant(clientId, async (tx) => {
    const [t] = await tx.select({ workitemId: task.workitemId }).from(task).where(eq(task.id, taskId)).limit(1);
    if (!t) throw new Error("משימה לא נמצאה");
    const valid = anchors.length
      ? (await tx.select({ anchor: specSection.anchor }).from(specSection).where(and(eq(specSection.workitemId, t.workitemId), inArray(specSection.anchor, anchors)))).map((r) => r.anchor)
      : [];
    await tx.delete(taskSpecLink).where(eq(taskSpecLink.taskId, taskId));
    for (const a of valid) await tx.insert(taskSpecLink).values({ clientId, workitemId: t.workitemId, taskId, anchor: a, source: "manual" });
    return valid.length;
  });
}

/** The facts the reading prompt is filled with — also what the preview shows. */
export async function specReadInput(clientId: string, workitemId: string) {
  return withTenant(clientId, async (tx) => {
    const [wi] = await tx.select({ title: workitem.title, key: workitem.key }).from(workitem).where(eq(workitem.id, workitemId)).limit(1);
    const atts = await tx.select().from(attachment).where(eq(attachment.workitemId, workitemId));
    const doc = specAttachment(atts);
    const decisions = (await tx.select().from(gap).where(eq(gap.workitemId, workitemId)))
      .filter((g) => g.state === "resolved" && (g.answer ?? "").trim())
      .sort((a, b) => +a.createdAt - +b.createdAt)
      .map((g) => ({ id: g.id, description: g.description, answer: g.answer }));
    // The work the requirement was actually broken into. DCC's own standard
    // checks (build, tests, regression, e2e) are left out: they verify that the
    // code compiles and still works, never a line of the spec, and 27 of them
    // would drown the 15 rows that do mean something.
    const tasks = (await tx.select({ id: task.id, seq: task.seq, intent: task.intent, prompt: task.prompt, kind: task.kind, checkKind: task.checkKind, parentTaskId: task.parentTaskId, active: task.active, state: task.state }).from(task).where(eq(task.workitemId, workitemId)))
      .filter((t) => t.active && t.state !== "dropped" && !t.checkKind)
      .sort((a, b) => a.seq - b.seq);
    return { title: wi?.title ?? "", key: wi?.key ?? null, doc, decisions, tasks };
  });
}

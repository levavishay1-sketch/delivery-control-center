/**
 * The specification as pieces a task can point at.
 *
 * A requirement's spec lives in two places that were never addressable: the
 * attachment's extracted text, and the decisions closed on it (`gap` rows).
 * This module reads both into `spec_section` — one row per field, rule,
 * mapping line or decision — and records which task implements which piece
 * (`task_spec_link`). Nothing here rewrites the spec: the section keeps the
 * document's own words, and a decision that contradicts them is recorded
 * beside them as a correction, never instead of them.
 *
 * Reading the document is the one step that needs a model, and only when a
 * requirement was broken down before this existed. A breakdown from now on
 * writes its own links (`source: "breakdown"`), because it already reads the
 * spec while it splits the work.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { attachment, gap, specSection, task, taskSpecLink, workitem } from "@dcc/db/schema";

/** A decision is part of the spec too, and a task can point at it — this is the anchor it gets, everywhere. */
export const decisionAnchor = (gapId: string) => `d.${gapId.slice(0, 8)}`;

export type SpecSectionRow = typeof specSection.$inferSelect;
export type SpecSectionView = {
  anchor: string;
  kind: string;
  parentAnchor: string | null;
  title: string;
  body: string;
  /** A decision that corrects this section: what it says instead, and which decision said so. */
  correction: { text: string; gapId: string; question: string } | null;
  /** The tasks that implement it, by seq — empty means nothing does. */
  tasks: { id: string; seq: number; intent: string; source: string }[];
};
export type SpecView = {
  /** Present once the spec has been read into sections. */
  read: boolean;
  /** What it was read from, so the screen can say. */
  source: { attachmentId: string; name: string } | null;
  sections: SpecSectionView[];
  /** Anchors no task implements. */
  uncovered: string[];
};

/** The requirement's spec, its sections and who implements each — what the screen draws. */
export async function specFor(clientId: string, workitemId: string): Promise<SpecView> {
  return withTenant(clientId, async (tx) => {
    const sections = await tx.select().from(specSection).where(eq(specSection.workitemId, workitemId)).orderBy(asc(specSection.ordinal));
    const links = await tx.select().from(taskSpecLink).where(eq(taskSpecLink.workitemId, workitemId));
    const ids = [...new Set(links.map((l) => l.taskId))];
    const tasks = ids.length ? await tx.select({ id: task.id, seq: task.seq, intent: task.intent, active: task.active, state: task.state }).from(task).where(inArray(task.id, ids)) : [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const gapIds = [...new Set(sections.map((s) => s.correctedByGapId).filter((g): g is string => !!g))];
    const gaps = gapIds.length ? await tx.select({ id: gap.id, description: gap.description }).from(gap).where(inArray(gap.id, gapIds)) : [];
    const gapById = new Map(gaps.map((g) => [g.id, g]));
    const [att] = sections.some((s) => s.attachmentId)
      ? await tx.select({ id: attachment.id, name: attachment.name }).from(attachment).where(eq(attachment.id, sections.find((s) => s.attachmentId)!.attachmentId!)).limit(1)
      : [];

    const byAnchor = new Map<string, SpecSectionView["tasks"]>();
    for (const l of links) {
      const t = byId.get(l.taskId);
      if (!t || !t.active || t.state === "dropped") continue;
      byAnchor.set(l.anchor, [...(byAnchor.get(l.anchor) ?? []), { id: t.id, seq: t.seq, intent: t.intent, source: l.source }]);
    }
    const view = sections.map((s): SpecSectionView => ({
      anchor: s.anchor, kind: s.kind, parentAnchor: s.parentAnchor, title: s.title, body: s.body,
      correction: s.correctedByGapId && s.correction
        ? { text: s.correction, gapId: s.correctedByGapId, question: gapById.get(s.correctedByGapId)?.description ?? "" }
        : null,
      tasks: (byAnchor.get(s.anchor) ?? []).sort((a, b) => a.seq - b.seq),
    }));
    return {
      read: sections.length > 0,
      source: att ? { attachmentId: att.id, name: att.name } : null,
      sections: view,
      // A heading is a place in the document, not something a task implements.
      uncovered: view.filter((s) => s.kind !== "heading" && !s.tasks.length).map((s) => s.anchor),
    };
  });
}

/** What one task implements — the task screen's own list. */
export async function specForTask(clientId: string, taskId: string): Promise<{ anchor: string; title: string; kind: string }[]> {
  return withTenant(clientId, async (tx) => {
    const links = await tx.select().from(taskSpecLink).where(eq(taskSpecLink.taskId, taskId));
    if (!links.length) return [];
    const rows = await tx.select().from(specSection).where(and(eq(specSection.workitemId, links[0]!.workitemId), inArray(specSection.anchor, links.map((l) => l.anchor)))).orderBy(asc(specSection.ordinal));
    return rows.map((r) => ({ anchor: r.anchor, title: r.title, kind: r.kind }));
  });
}

/* ── what the model is asked to produce, and what is accepted ──────── */

export type SpecRead = {
  sections: { anchor: string; kind: string; parentAnchor?: string | null; title: string; body?: string }[];
  links: { seq: number; anchors: string[] }[];
  corrections?: { anchor: string; decision: number; correction: string }[];
};
const KINDS = new Set(["heading", "field", "rule", "mapping", "decision"]);
/** Anchors are DCC's own ids and are written into links — keep them short, plain and stable. */
const ANCHOR = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

/**
 * Accept what the model returned, or say exactly what is wrong with it.
 * A link may point at a section the model wrote, or at a decision — whose
 * anchor the system decides and the prompt hands over.
 * Pure — the prove script and the unit test drive it without a database.
 */
export function checkSpecRead(raw: SpecRead, taskSeqs: number[], decisionAnchors: string[]): { ok: true; value: SpecRead } | { ok: false; why: string } {
  const sections = raw.sections ?? [];
  if (!sections.length) return { ok: false, why: "לא הוחזר אף חלק של האפיון" };
  const seen = new Set<string>();
  for (const s of sections) {
    if (!ANCHOR.test(s.anchor ?? "")) return { ok: false, why: `מזהה לא חוקי: ${JSON.stringify(s.anchor)}` };
    if (seen.has(s.anchor)) return { ok: false, why: `מזהה חוזר פעמיים: ${s.anchor}` };
    seen.add(s.anchor);
    if (!KINDS.has(s.kind)) return { ok: false, why: `סוג לא מוכר ב-${s.anchor}: ${s.kind}` };
    if (!(s.title ?? "").trim()) return { ok: false, why: `אין כותרת ל-${s.anchor}` };
  }
  // "Sits under": a rule under its heading, a field's own requirement under the
  // field. Any existing section may be the parent — but not itself, and not a
  // ring, which would make the screen recurse forever.
  const parentOf = new Map(sections.map((s) => [s.anchor, s.parentAnchor ?? null]));
  for (const s of sections) {
    if (!s.parentAnchor) continue;
    if (!seen.has(s.parentAnchor)) return { ok: false, why: `${s.anchor} יושב תחת חלק שלא קיים: ${s.parentAnchor}` };
    const walked = new Set<string>([s.anchor]);
    for (let up = s.parentAnchor; up; up = parentOf.get(up) ?? "") {
      if (walked.has(up)) return { ok: false, why: `${s.anchor} יושב תחת עצמו, במעגל` };
      walked.add(up);
    }
  }
  const seqs = new Set(taskSeqs);
  const linkable = new Set([...seen, ...decisionAnchors]);
  for (const l of raw.links ?? []) {
    if (!seqs.has(l.seq)) return { ok: false, why: `אין משימה #${l.seq}` };
    for (const a of l.anchors ?? []) if (!linkable.has(a)) return { ok: false, why: `משימה #${l.seq} מפנה לחלק שלא קיים: ${a}` };
  }
  for (const c of raw.corrections ?? []) {
    if (!seen.has(c.anchor)) return { ok: false, why: `תיקון מפנה לחלק שלא קיים: ${c.anchor}` };
    if (c.decision < 1 || c.decision > decisionAnchors.length) return { ok: false, why: `תיקון מפנה להחלטה ${c.decision}, ויש ${decisionAnchors.length}` };
  }
  return { ok: true, value: { sections, links: raw.links ?? [], corrections: raw.corrections ?? [] } };
}

/* ── writing it down ───────────────────────────────────────────────── */

/**
 * Replace the requirement's spec index with what was just read. The links a
 * PERSON made by hand survive: they are re-attached when their anchor is
 * still there, and reported when it is not.
 */
export async function saveSpecRead(input: {
  clientId: string; workitemId: string; attachmentId: string | null; read: SpecRead;
  /** The decisions, in the order they were given to the model. */
  decisions: { id: string; description: string; answer: string | null }[];
  tasks: { id: string; seq: number }[];
  by: { userId: string };
  source?: "breakdown" | "mapping";
}): Promise<{ sections: number; links: number; lostManual: number }> {
  const { clientId, workitemId, read } = input;
  const bySeq = new Map(input.tasks.map((t) => [t.seq, t.id]));
  const decisionAt = (n: number) => input.decisions[n - 1];

  const kept = await withTenant(clientId, async (tx) => {
    const manual = await tx.select().from(taskSpecLink).where(and(eq(taskSpecLink.workitemId, workitemId), eq(taskSpecLink.source, "manual")));
    await tx.delete(taskSpecLink).where(eq(taskSpecLink.workitemId, workitemId));
    await tx.delete(specSection).where(eq(specSection.workitemId, workitemId));

    let ordinal = 0;
    for (const s of read.sections) {
      const fix = read.corrections?.find((c) => c.anchor === s.anchor);
      const d = fix ? decisionAt(fix.decision) : undefined;
      await tx.insert(specSection).values({
        clientId, workitemId, anchor: s.anchor, ordinal: ordinal++, kind: s.kind,
        parentAnchor: s.parentAnchor ?? null, title: s.title.trim(), body: (s.body ?? "").trim(),
        attachmentId: s.kind === "decision" ? null : input.attachmentId,
        ...(fix && d ? { correctedByGapId: d.id, correction: fix.correction } : {}),
      });
    }
    // A decision is part of the spec too — one section each, in the order they were closed.
    for (const d of input.decisions) {
      const anchor = decisionAnchor(d.id);
      if (read.sections.some((s) => s.anchor === anchor)) continue;
      await tx.insert(specSection).values({
        clientId, workitemId, anchor, ordinal: ordinal++, kind: "decision",
        parentAnchor: null, title: d.description.trim(), body: (d.answer ?? "").trim(), gapId: d.id,
      });
    }

    const anchors = new Set([...read.sections.map((s) => s.anchor), ...input.decisions.map((d) => decisionAnchor(d.id))]);
    let links = 0;
    for (const l of read.links) {
      const taskId = bySeq.get(l.seq);
      if (!taskId) continue;
      for (const a of new Set(l.anchors)) {
        if (!anchors.has(a)) continue;
        await tx.insert(taskSpecLink).values({ clientId, workitemId, taskId, anchor: a, source: input.source ?? "mapping" }).onConflictDoNothing();
        links++;
      }
    }
    let lostManual = 0;
    for (const m of manual) {
      if (!anchors.has(m.anchor)) { lostManual++; continue; }
      await tx.insert(taskSpecLink).values({ clientId, workitemId, taskId: m.taskId, anchor: m.anchor, source: "manual" }).onConflictDoUpdate({ target: [taskSpecLink.taskId, taskSpecLink.anchor], set: { source: "manual" } });
    }
    return { sections: ordinal, links, lostManual };
  });

  await appendEvent({
    clientId, workitemId, source: "claude_session", type: "note.added",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "dcc:spec-map" },
    payload: { body: `📑 האפיון נקרא ל-${kept.sections} חלקים · ${kept.links} קישורים למשימות${kept.lostManual ? ` · ${kept.lostManual} קישורים ידניים אבדו (החלק שהם הצביעו עליו כבר לא קיים)` : ""}` },
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
    const doc = atts.filter((a) => (a.extractedText ?? "").trim().length > 0).sort((a, b) => (b.extractedText?.length ?? 0) - (a.extractedText?.length ?? 0))[0] ?? null;
    const decisions = (await tx.select().from(gap).where(eq(gap.workitemId, workitemId)))
      .filter((g) => g.state === "resolved" && (g.answer ?? "").trim())
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

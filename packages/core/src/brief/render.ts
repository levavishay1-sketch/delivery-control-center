import type { TimelineSummary } from "../summarise.ts";

export type BriefModel = {
  key: string | null;
  title: string;
  phase: string;
  level: string;
  linkedAdoId: number | null;
  startedWithOpenBlocker: boolean;
  gaps: { description: string; blocking: boolean; verified: boolean; confidence: number }[];
  openBlockers: { questionType: string; question: string }[];
  answeredBlockers: { question: string; answer: string }[];
  taskCounts: Record<string, number>;
  recentTimeline: {
    occurredAt: Date;
    source: string;
    type: string;
    payload: unknown;
  }[];
};

const line = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

/**
 * The Context Brief as Markdown — what SessionStart prints to stdout so
 * it becomes the next session's context. Compact by design: a few
 * thousand tokens, not the whole timeline.
 */
export function renderBrief(m: BriefModel, narrative: TimelineSummary): string {
  const out: string[] = [];
  const id = m.key ?? "(no key)";
  out.push(`# ${id} — ${m.title}`);
  out.push("");
  out.push(
    `**Phase:** ${m.phase} · **Level:** ${m.level}` +
      (m.linkedAdoId ? ` · **ADO:** #${m.linkedAdoId}` : " · **ADO:** not linked"),
  );
  if (m.startedWithOpenBlocker) {
    out.push("");
    out.push("> ⚠️ Work started while a blocker was still open — proceed with that in mind.");
  }

  const blockingGaps = m.gaps.filter((g) => g.blocking);
  const otherGaps = m.gaps.filter((g) => !g.blocking);
  out.push("");
  out.push("## Open gaps");
  if (m.gaps.length === 0) out.push("_None._");
  for (const g of blockingGaps) {
    out.push(`- **BLOCKING** — ${g.description}  _(confidence ${g.confidence.toFixed(2)}${g.verified ? ", verified" : ", not yet verified"})_`);
  }
  for (const g of otherGaps) {
    out.push(`- ${g.description}  _(non-blocking, confidence ${g.confidence.toFixed(2)}${g.verified ? ", verified" : ", not yet verified"})_`);
  }

  if (m.openBlockers.length) {
    out.push("");
    out.push("## Active blockers");
    for (const b of m.openBlockers) out.push(`- [${b.questionType}] ${b.question}`);
  }

  if (m.answeredBlockers.length) {
    out.push("");
    out.push("## Decisions on record");
    for (const b of m.answeredBlockers) {
      out.push(`- **Q:** ${b.question}`);
      out.push(`  **A:** ${b.answer}`);
    }
  }

  const tc = m.taskCounts;
  const total = Object.values(tc).reduce((a, b) => a + b, 0);
  if (total) {
    out.push("");
    out.push("## Tasks");
    out.push(
      `${tc.done ?? 0} done · ${tc.in_progress ?? 0} in progress · ${tc.blocked ?? 0} blocked · ` +
        `${tc.pending ?? 0} pending · ${tc.dropped ?? 0} dropped  (of ${total})`,
    );
  }

  out.push("");
  out.push("## Recent timeline");
  if (narrative.mode === "summarised") {
    out.push(narrative.text);
  } else {
    for (const e of m.recentTimeline) {
      const p = e.payload as Record<string, unknown>;
      const gist =
        (p.summary as string) ||
        (p.body as string) ||
        (p.answer as string) ||
        (p.description as string) ||
        (p.question as string) ||
        (p.outcome ? `→ ${p.outcome}` : "") ||
        `${p.kind ?? ""} ${p.branch ? `on ${p.branch}` : ""}`.trim() ||
        e.type;
      out.push(`- \`${line(e.occurredAt)}\` **${e.source}** ${e.type} — ${String(gist).slice(0, 200)}`);
    }
  }

  out.push("");
  out.push("---");
  out.push("_Load the full timeline or the code only when this brief does not cover what you need._");
  return out.join("\n");
}

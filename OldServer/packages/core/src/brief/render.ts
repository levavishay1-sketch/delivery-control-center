export type BriefModel = {
  key: string | null;
  title: string;
  phase: string;
  type: string;
  linkedAdoId: number | null;
  startedWithOpenBlocker: boolean;
  gaps: { description: string; blocking: boolean; verified: boolean; confidence: number }[];
  openBlockers: { questionType: string; question: string }[];
  answeredBlockers: { question: string; answer: string }[];
  tasks: { seq: number; intent: string; state: string }[];
  lastReview: { verdict: string; findings: { file: string; severity: string; note: string }[] } | null;
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
export function renderBrief(m: BriefModel): string {
  const out: string[] = [];
  const id = m.key ?? "(no key)";
  out.push(`# ${id} — ${m.title}`);
  out.push("");
  out.push(
    `**Phase:** ${m.phase} · **Type:** ${m.type}` +
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

  if (m.lastReview && m.lastReview.verdict === "changes_requested") {
    out.push("");
    out.push("## Review — changes requested");
    for (const f of m.lastReview.findings) {
      out.push(`- ${f.severity === "block" ? "**BLOCK**" : f.severity} · \`${f.file}\` — ${f.note}`);
    }
  }

  if (m.tasks.length) {
    const mark: Record<string, string> = {
      done: "[x]", in_progress: "[~]", blocked: "[!]", pending: "[ ]", dropped: "[-]",
    };
    const done = m.tasks.filter((t) => t.state === "done").length;
    out.push("");
    out.push(`## Tasks — ${done}/${m.tasks.length} done`);
    for (const t of m.tasks) out.push(`- ${mark[t.state] ?? "[ ]"} ${t.intent}`);
  }

  out.push("");
  out.push("## Recent timeline");
  for (const e of m.recentTimeline) {
    const p = e.payload as Record<string, unknown>;
    const gist =
      (p.summary as string) ||
      (p.body as string) ||
      (p.answer as string) ||
      (p.description as string) ||
      (p.question as string) ||
      (p.callId ? `${p.capability}: ${p.label ?? ""}` : "") ||
      (p.verdict ? `${p.verdict}${p.blockingCount ? ` — ${p.blockingCount} blocking` : ""} (${p.findingCount ?? 0} findings)` : "") ||
      (p.taskCount ? `${p.taskCount} tasks, ${p.dependencyCount} deps` : "") ||
      (p.to ? `${p.from ?? "?"} → ${p.to}` : "") ||
      (p.outcome ? `→ ${p.outcome}` : "") ||
      `${p.kind ?? ""} ${p.branch ? `on ${p.branch}` : ""}`.trim() ||
      e.type;
    out.push(`- \`${line(e.occurredAt)}\` **${e.source}** ${e.type} — ${String(gist).slice(0, 200)}`);
  }

  out.push("");
  out.push("---");
  out.push("_Load the full timeline or the code only when this brief does not cover what you need._");
  return out.join("\n");
}

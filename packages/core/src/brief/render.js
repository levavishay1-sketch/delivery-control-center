const line = (d) => d.toISOString().slice(0, 16).replace("T", " ");
/**
 * The Context Brief as Markdown — what SessionStart prints to stdout so
 * it becomes the next session's context. Compact by design: a few
 * thousand tokens, not the whole timeline.
 */
export function renderBrief(m, narrative) {
    const out = [];
    const id = m.key ?? "(no key)";
    out.push(`# ${id} — ${m.title}`);
    out.push("");
    out.push(`**Phase:** ${m.phase} · **Type:** ${m.type}` +
        (m.linkedAdoId ? ` · **ADO:** #${m.linkedAdoId}` : " · **ADO:** not linked"));
    if (m.startedWithOpenBlocker) {
        out.push("");
        out.push("> ⚠️ Work started while a blocker was still open — proceed with that in mind.");
    }
    const blockingGaps = m.gaps.filter((g) => g.blocking);
    const otherGaps = m.gaps.filter((g) => !g.blocking);
    out.push("");
    out.push("## Open gaps");
    if (m.gaps.length === 0)
        out.push("_None._");
    for (const g of blockingGaps) {
        out.push(`- **BLOCKING** — ${g.description}  _(confidence ${g.confidence.toFixed(2)}${g.verified ? ", verified" : ", not yet verified"})_`);
    }
    for (const g of otherGaps) {
        out.push(`- ${g.description}  _(non-blocking, confidence ${g.confidence.toFixed(2)}${g.verified ? ", verified" : ", not yet verified"})_`);
    }
    if (m.openBlockers.length) {
        out.push("");
        out.push("## Active blockers");
        for (const b of m.openBlockers)
            out.push(`- [${b.questionType}] ${b.question}`);
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
        const mark = {
            done: "[x]", in_progress: "[~]", blocked: "[!]", pending: "[ ]", dropped: "[-]",
        };
        const done = m.tasks.filter((t) => t.state === "done").length;
        out.push("");
        out.push(`## Tasks — ${done}/${m.tasks.length} done`);
        for (const t of m.tasks)
            out.push(`- ${mark[t.state] ?? "[ ]"} ${t.intent}`);
    }
    out.push("");
    out.push("## Recent timeline");
    if (narrative.mode === "summarised") {
        out.push(narrative.text);
    }
    else {
        for (const e of m.recentTimeline) {
            const p = e.payload;
            const gist = p.summary ||
                p.body ||
                p.answer ||
                p.description ||
                p.question ||
                (p.model ? `${p.capability} → ${p.model} (${p.rationale ?? ""})` : "") ||
                (p.verdict ? `${p.verdict}${p.blockingCount ? ` — ${p.blockingCount} blocking` : ""} (${p.findingCount ?? 0} findings)` : "") ||
                (p.taskCount ? `${p.taskCount} tasks, ${p.dependencyCount} deps` : "") ||
                (p.to ? `${p.from ?? "?"} → ${p.to}` : "") ||
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
//# sourceMappingURL=render.js.map
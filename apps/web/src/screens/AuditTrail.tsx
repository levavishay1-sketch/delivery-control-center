import { useEffect, useState } from "react";
import { getAudit, type AuditPage } from "../api.ts";
import { ICONS, Icon, PageHead } from "../ui.tsx";

const ACTOR_IC: Record<string, string> = { user: "🧑", delegated: "🤖", system: "⚙️" };
const actorLabel = (a: { kind: string; triggeredBy?: string }) =>
  a.kind === "user" ? "Person" : a.kind === "delegated" ? "AI Agent" : "System";

function actionText(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "note.added": return `Added a note — "${String(p.body ?? "").slice(0, 60)}"`;
    case "gap.proposed": return `Proposed a gap — "${String(p.description ?? "").slice(0, 55)}"`;
    case "gap.verified": return `Verified a gap → ${p.outcome}`;
    case "tasks.proposed": return `Proposed ${p.taskCount} tasks (${p.dependencyCount} deps)`;
    case "task.progressed": return `Task ${p.from} → ${p.to}`;
    case "blocker.raised": return `Raised a blocker — "${String(p.question ?? "").slice(0, 55)}"`;
    case "blocker.answered": return `Answered a blocker`;
    case "model.routed": return `Routed ${p.capability} → ${p.model}`;
    case "review.completed": return `Review — ${p.verdict}${p.blockingCount ? ` (${p.blockingCount} blocking)` : ""}`;
    case "claude.session": return `Claude session — ${String(p.summary ?? "").slice(0, 55)}`;
    case "git.activity": return `${p.kind} on ${p.branch}`;
    case "status.changed": return `${p.from} → ${p.to}`;
    default: return type;
  }
}
const when = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return new Date(iso).toISOString().slice(0, 10);
};

export function AuditTrail({ nav }: { nav: (h: string) => void }) {
  const [q, setQ] = useState<{ actorKind: string; type: string; from: string; to: string; page: string }>({ actorKind: "", type: "", from: "", to: "", page: "1" });
  const [data, setData] = useState<AuditPage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const clean = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
    getAudit(clean as Record<string, string>).then(setData).catch((e) => setErr(String(e)));
  }, [q]);

  const set = (k: string, v: string) => setQ((s) => ({ ...s, [k]: v, page: "1" }));

  return (
    <>
      <PageHead
        title="Audit Trail"
        sub="Every decision, draft, approval, and cost — in order, nothing hidden."
        actions={<button className="btn btn-secondary btn-sm"><Icon d={ICONS.export} size={13} /> Export</button>}
      />

      <div className="filter-bar">
        <div className="field">
          <label>Actor</label>
          <select value={q.actorKind} onChange={(e) => set("actorKind", e.target.value)}>
            <option value="">All actors</option>
            <option value="user">People</option>
            <option value="delegated">AI Agent</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="field">
          <label>Action</label>
          <select value={q.type} onChange={(e) => set("type", e.target.value)}>
            <option value="">All actions</option>
            {["note.added", "gap.proposed", "gap.verified", "tasks.proposed", "task.progressed", "blocker.raised", "blocker.answered", "model.routed", "review.completed", "git.activity"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field"><label>From</label><input type="date" value={q.from} onChange={(e) => set("from", e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={q.to} onChange={(e) => set("to", e.target.value)} /></div>
        <button className="btn btn-secondary btn-sm" onClick={() => setQ({ actorKind: "", type: "", from: "", to: "", page: "1" })}>Clear</button>
      </div>

      {err && <div className="empty">{err}</div>}
      <div className="grid-rowlist">
        <div className="grid-row head"><span>Actor</span><span>Action</span><span>Requirement</span><span style={{ textAlign: "end" }}>Time</span></div>
        {(data?.rows ?? []).map((r) => (
          <div className="grid-row" key={r.id}>
            <span className="actor"><span className="actor-ic">{ACTOR_IC[r.actor.kind] ?? "•"}</span> {actorLabel(r.actor)}</span>
            <span>{actionText(r.type, r.payload)}</span>
            <span className="proj">
              {r.workitemId ? <a onClick={() => nav(`#/wi/${r.workitemId}`)}>{r.wiKey ? `${r.wiKey} · ` : ""}{r.wiTitle}</a> : <span>—</span>}
              <span>{r.clientName}</span>
            </span>
            <span className="time">{when(r.occurredAt)}</span>
          </div>
        ))}
        {data && data.rows.length === 0 && <div className="empty">No events match these filters.</div>}
      </div>

      {data && (
        <div className="pager">
          <span>Page {data.page}</span>
          <span className="links">
            {data.page > 1 && <a onClick={() => setQ((s) => ({ ...s, page: String(data.page - 1) }))}>← Previous</a>}
            {data.hasNext && <a onClick={() => setQ((s) => ({ ...s, page: String(data.page + 1) }))}>Next →</a>}
          </span>
        </div>
      )}
    </>
  );
}

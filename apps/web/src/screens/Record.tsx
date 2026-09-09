import { useCallback, useEffect, useState } from "react";
import {
  answerBlocker, getBrief, getDetail, progressTask, verifyGap,
  type Blocker, type EventRow, type Gap, type Task, type WorkItemDetail,
} from "../api.ts";
import { Pill, TypeChip } from "../ui.tsx";
import { FlowGraph } from "./FlowGraph.tsx";
import { AddNote } from "../forms.tsx";

const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
const post = async (path: string, body: unknown) => {
  const r = await fetch(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", "x-dcc-hook-token": HOOK, "x-dcc-dev-email": DEV_EMAIL }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

const TABS = ["Overview", "Timeline", "Dependencies", "Tasks", "Gaps & Blockers"] as const;
type Tab = (typeof TABS)[number];

const AI_TYPES = new Set(["gap.proposed", "tasks.proposed", "blocker.raised", "model.routed", "review.completed"]);
const isAi = (e: EventRow) => e.actor.kind !== "user" || AI_TYPES.has(e.type);
const fmt = (t: string) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const gist = (e: EventRow) => {
  const p = e.payload;
  return (p.summary || p.body || p.answer || p.description || p.question ||
    (p.model ? `${p.capability} → ${p.model} · ${p.rationale ?? ""}` : "") ||
    (p.verdict ? `${p.verdict}${p.blockingCount ? ` — ${p.blockingCount} blocking` : ""} (${p.findingCount ?? 0} findings)` : "") ||
    (p.taskCount ? `${p.taskCount} tasks, ${p.dependencyCount} deps` : "") ||
    (p.to ? `${p.from ?? "?"} → ${p.to}` : "") || (p.outcome ? `→ ${p.outcome}` : "") ||
    [p.kind, p.branch].filter(Boolean).join(" ") || e.type) as string;
};

export function Record({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<WorkItemDetail | null>(null);
  const [brief, setBrief] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [err, setErr] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [newGap, setNewGap] = useState({ description: "", blocking: false });
  const [newBlk, setNewBlk] = useState({ questionType: "unclear_requirement", question: "" });

  const reload = useCallback(async () => {
    try {
      const [detail, b] = await Promise.all([getDetail(id), getBrief(id)]);
      setD(detail); setBrief(b); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">Loading…</div>;
  const wi = d.workitem;
  const openBlocker = d.blockers.find((b) => b.state === "open");
  const doneTasks = d.tasks.filter((t) => t.state === "done").length;
  const progress = d.tasks.length ? Math.round((doneTasks / d.tasks.length) * 100) : wi.progressPct;

  const onGap = async (g: Gap, outcome: "verified" | "dismissed" | "spun_off") => {
    await verifyGap(g.id, { outcome, clientId: wi.clientId, ...(outcome === "spun_off" ? { spunOffTitle: g.description.slice(0, 80) } : {}) });
    reload();
  };
  const onTask = async (t: Task, to: Task["state"]) => { await progressTask(t.id, { to, clientId: wi.clientId }); reload(); };
  const onAnswer = async (b: Blocker, answer: string) => { await answerBlocker(b.id, { answer, clientId: wi.clientId }); reload(); };

  return (
    <>
      {noteOpen && <AddNote workitemId={wi.id} onClose={() => setNoteOpen(false)} onDone={() => { setNoteOpen(false); reload(); }} />}
      <p className="crumb"><a onClick={() => nav(wi.parentId ? `#/wi/${wi.parentId}` : `#/client/${wi.clientId}`)}>← {wi.parentId ? "לדרישת האב" : "ללקוח"}</a></p>
      <div className="rec-head" style={{ justifyContent: "space-between" }}>
        <div className="rec-head" style={{ margin: 0 }}>
          <h1>{wi.title}</h1>
          <TypeChip type={wi.type} />
          {wi.key && <span style={{ fontFamily: "var(--mono)", color: "var(--ink-400)", fontSize: 13 }}>{wi.key}</span>}
          {wi.startedWithOpenBlocker && <Pill tone="warning">התחיל עם חוסם פתוח</Pill>}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setNoteOpen(true)}>+ הוסף אירוע ל-timeline</button>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}{t === "Gaps & Blockers" && d.gaps.filter((g) => g.state === "proposed").length + d.blockers.filter((b) => b.state === "open").length > 0 ? ` (${d.gaps.filter((g) => g.state === "proposed").length + d.blockers.filter((b) => b.state === "open").length})` : ""}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <>
          {openBlocker && (
            <div className="callout crit">
              <span className="ic"><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--status-critical)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg></span>
              <div className="body">
                <p className="q">Blocked — {openBlocker.questionType.replace(/_/g, " ")}</p>
                <p className="r">{openBlocker.question}</p>
              </div>
            </div>
          )}
          <dl className="detail-grid">
            <div><dt>Phase</dt><dd>{wi.phase}</dd></div>
            <div><dt>Priority</dt><dd>{wi.priority}</dd></div>
            <div><dt>Risk</dt><dd className={wi.risk === "high" ? "overdue" : ""}>{wi.risk}</dd></div>
            <div><dt>Executor</dt><dd>{wi.executor}</dd></div>
            <div><dt>AI budget</dt><dd>{wi.budgetUsd ? `$${wi.budgetUsd}` : "client default"}</dd></div>
            <div><dt>ADO</dt><dd>{wi.linkedAdoId ? `#${wi.linkedAdoId}` : "not linked"}</dd></div>
          </dl>
          <div className="progress-block">
            <div className="top"><span className="l">Progress — {doneTasks}/{d.tasks.length} tasks</span><span>{progress}%</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          </div>
          <div className="section">
            <p className="section-lbl">Context Brief — what the next Claude session loads</p>
            <div className="panel"><pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-700)" }}>{brief || "—"}</pre></div>
          </div>
          <div className="action-row">
            <button className="btn btn-secondary">Edit</button>
            <button className="btn btn-secondary">Create Decision</button>
            <button className="btn btn-primary">Start SDD Pipeline</button>
          </div>
        </>
      )}

      {tab === "Timeline" && (
        <div className="rowlist">
          {d.events.map((e) => (
            <div className="row" key={e.id} style={{ alignItems: "flex-start", background: isAi(e) ? "var(--status-ai-bg)" : undefined }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-400)", minWidth: 96 }}>{fmt(e.occurredAt)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {isAi(e) ? <Pill tone="ai">AI proposal</Pill> : <Pill tone="active">{e.actor.kind === "user" ? "Person" : "System"}</Pill>}
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-500)" }}>{e.type}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-700)", marginTop: 3 }}>{String(gist(e)).slice(0, 220)}</div>
              </div>
            </div>
          ))}
          {d.events.length === 0 && <div className="empty">No events yet.</div>}
        </div>
      )}

      {tab === "Dependencies" && (
        <div style={{ height: "60vh", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-md)", overflow: "hidden", position: "relative" }}>
          <FlowGraph requirementId={wi.id} />
        </div>
      )}

      {tab === "Tasks" && (
        <div className="rowlist">
          {d.tasks.map((t) => (
            <div className="row" key={t.id}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-400)" }}>{t.seq}</span>
              <span className="title" style={{ textDecoration: t.state === "done" ? "line-through" : "none", color: t.state === "done" ? "var(--ink-400)" : undefined }}>{t.intent}</span>
              <span className="spacer" />
              <span className="stage">{t.appetite}</span>
              <Pill tone={t.state === "done" ? "healthy" : t.state === "in_progress" ? "active" : t.state === "blocked" ? "critical" : "inactive"}>{t.state.replace(/_/g, " ")}</Pill>
              {t.state !== "done" && t.state !== "dropped" && (
                <a className="link" onClick={() => onTask(t, t.state === "in_progress" ? "done" : "in_progress")}>{t.state === "in_progress" ? "mark done" : "start"}</a>
              )}
            </div>
          ))}
          {d.tasks.length === 0 && <div className="empty">No breakdown yet.</div>}
        </div>
      )}

      {tab === "Gaps & Blockers" && (
        <>
          <p className="section-lbl">Gaps</p>
          <div className="filter-bar" style={{ marginBottom: 14 }}>
            <div className="field" style={{ flex: 1 }}><label>פער / אי-בהירות שזוהתה</label>
              <input value={newGap.description} onChange={(e) => setNewGap({ ...newGap, description: e.target.value })} placeholder="למשל: לא מוגדר מה קורה כשלקוח עובר דרגה באמצע חודש" style={{ minWidth: 320 }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" style={{ minWidth: 0 }} checked={newGap.blocking} onChange={(e) => setNewGap({ ...newGap, blocking: e.target.checked })} /> חוסם
            </label>
            <button className="btn btn-primary btn-sm" onClick={async () => { if (!newGap.description.trim()) return; await post(`/workitems/${wi.id}/gaps`, { description: newGap.description.trim(), blocking: newGap.blocking, confidence: 1, mode: "interactive" }); setNewGap({ description: "", blocking: false }); reload(); }}>הוסף Gap</button>
          </div>
          <div className="rowlist" style={{ marginBottom: 22 }}>
            {d.gaps.map((g) => (
              <div className="row" key={g.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div className="title">{g.description}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center" }}>
                    {g.blocking ? <Pill tone="critical">blocking</Pill> : <Pill tone="inactive">non-blocking</Pill>}
                    {g.state === "proposed" && <Pill tone="ai">unverified</Pill>}
                    {g.state === "verified" && <Pill tone="healthy">verified</Pill>}
                    {g.state === "spun_off" && <Pill tone="inactive">spun off</Pill>}
                    <span className="stage">confidence {Number(g.confidence).toFixed(2)}</span>
                  </div>
                </div>
                {g.state === "proposed" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "verified")}>Verify</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "dismissed")}>Dismiss</button>
                    {!g.blocking && <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "spun_off")}>Spin off</button>}
                  </div>
                )}
              </div>
            ))}
            {d.gaps.length === 0 && <div className="empty">None.</div>}
          </div>

          <p className="section-lbl">Blockers</p>
          <div className="filter-bar" style={{ marginBottom: 14 }}>
            <div className="field"><label>סוג</label>
              <select value={newBlk.questionType} onChange={(e) => setNewBlk({ ...newBlk, questionType: e.target.value })}>
                <option value="unclear_requirement">דרישה לא ברורה</option><option value="missing_access">חסרה גישה</option><option value="budget_exceeded">חריגת תקציב</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}><label>השאלה</label>
              <input value={newBlk.question} onChange={(e) => setNewBlk({ ...newBlk, question: e.target.value })} placeholder="מה חוסם ומה צריך כדי להמשיך" style={{ minWidth: 320 }} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={async () => { if (!newBlk.question.trim()) return; await post(`/workitems/${wi.id}/blockers`, { questionType: newBlk.questionType, question: newBlk.question.trim() }); setNewBlk({ questionType: "unclear_requirement", question: "" }); reload(); }}>הוסף Blocker</button>
          </div>
          <div className="rowlist">
            {d.blockers.map((b) => <BlockerRow key={b.id} b={b} onAnswer={(a) => onAnswer(b, a)} />)}
            {d.blockers.length === 0 && <div className="empty">אין.</div>}
          </div>
        </>
      )}
    </>
  );
}

function BlockerRow({ b, onAnswer }: { b: Blocker; onAnswer: (a: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <Pill tone={b.state === "open" ? "critical" : "healthy"}>{b.state}</Pill>
          <span className="stage">{b.questionType}</span>
        </div>
        <div className="title" style={{ fontWeight: 400 }}>{b.question}</div>
        {b.answer && <div style={{ color: "var(--status-healthy)", fontSize: 12.5, marginTop: 5 }}>← {b.answer}</div>}
        {b.state === "open" && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input className="" value={text} onChange={(e) => setText(e.target.value)} placeholder="answer for Claude to continue with…" style={{ flex: 1, font: "inherit", fontSize: 12.5, padding: "6px 10px", border: "1px solid var(--border-hairline)", borderRadius: 7 }} />
            <button className="btn btn-primary btn-sm" onClick={() => text.trim() && onAnswer(text.trim())}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
}

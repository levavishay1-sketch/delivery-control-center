import { useCallback, useEffect, useState } from "react";
import {
  answerBlocker, correctNote, deleteBlocker, deleteGap, deleteRequirement, deleteTask,
  getBrief, getDetail, progressTask, startBuilding, syncToAdo, unlinkRepoFromReq, uploadAttachment, verifyGap,
  type Blocker, type EventRow, type Gap, type StartBuildResult, type Task, type WorkItemDetail,
} from "../api.ts";
import { Pill, TypeChip } from "../ui.tsx";
import { FlowGraph } from "./FlowGraph.tsx";
import { AddNote, EditRequirement, LinkRepoToReq } from "../forms.tsx";

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
  const [editOpen, setEditOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [correcting, setCorrecting] = useState<EventRow | null>(null);
  const [newGap, setNewGap] = useState({ description: "", blocking: false });
  const [newBlk, setNewBlk] = useState({ questionType: "unclear_requirement", question: "" });
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState<StartBuildResult | null>(null);

  // go back to wherever the user came from; fall back to the requirements list
  const back = useCallback(() => {
    const cur = location.hash;
    history.back();
    setTimeout(() => { if (location.hash === cur) nav("#/requirements"); }, 160);
  }, [nav]);

  const reload = useCallback(async (verify = false) => {
    try {
      const [detail, b] = await Promise.all([getDetail(id, verify), getBrief(id)]);
      setD(detail); setBrief(b); setErr(null);
    } catch (e) {
      const msg = String(e);
      if (msg.includes(" 410")) { alert("הדרישה נמחקה ב-TFS — מוסרת גם כאן."); back(); return; }
      setErr(msg);
    }
  }, [id, back]);
  // first load verifies against TFS (picks up a delete-in-TFS); refreshes don't
  useEffect(() => { reload(true); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return (
    <div className="empty" style={{ textAlign: "center" }}>
      <p>{err.includes("404") ? "הדרישה לא נמצאה (אולי נמחקה)." : err}</p>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={back}>← חזרה</button>
    </div>
  );
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
  const onDelete = async () => {
    const adoNote = wi.linkedAdoId ? `\n\nזה גם ימחק את work item #${wi.linkedAdoId} ב-Azure DevOps (לסל המחזור).` : "";
    if (!confirm(`למחוק את הדרישה "${wi.title}"? האירועים ב-timeline יישמרו (append-only) אבל יינותקו ממנה.${adoNote}`)) return;
    try {
      const r = await deleteRequirement(wi.id);
      if (r.ado && !r.ado.ok) alert(`הדרישה נמחקה, אבל מחיקת ה-work item ב-ADO נכשלה: ${r.ado.detail}`);
      back();
    } catch (e) { alert(String(e)); }
  };
  const onSyncAdo = async () => {
    setSyncing(true);
    try { const r = await syncToAdo(wi.id); window.open(r.url, "_blank"); reload(); }
    catch (e) { alert(`סנכרון ל-Azure DevOps נכשל:\n${e}`); }
    setSyncing(false);
  };
  const onStart = async () => {
    try { setStarting(await startBuilding(wi.id)); reload(); }
    catch (e) { alert(String(e)); }
  };
  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      await uploadAttachment(wi.id, file.name, btoa(bin));
      reload();
    } catch (e) { alert(`העלאת הקובץ נכשלה:\n${e}`); }
    setUploading(false);
  };

  // events superseded by a later correction
  const supersededIds = new Set(d.events.map((e) => e.supersedes).filter(Boolean) as string[]);

  return (
    <>
      {noteOpen && <AddNote workitemId={wi.id} onClose={() => setNoteOpen(false)} onDone={() => { setNoteOpen(false); reload(); }} />}
      {editOpen && <EditRequirement wi={wi} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); reload(); }} />}
      {repoOpen && <LinkRepoToReq workitemId={wi.id} onClose={() => setRepoOpen(false)} onDone={() => { setRepoOpen(false); reload(); }} />}
      {correcting && <CorrectNote ev={correcting} workitemId={wi.id} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); reload(); }} />}
      {starting && <StartBuildModal r={starting} title={wi.title} onClose={() => setStarting(null)} />}
      <p className="crumb"><a onClick={() => nav(wi.parentId ? `#/wi/${wi.parentId}` : `#/client/${wi.clientId}`)}>← {wi.parentId ? "לדרישת האב" : "ללקוח"}</a></p>
      <div className="rec-head" style={{ justifyContent: "space-between" }}>
        <div className="rec-head" style={{ margin: 0 }}>
          <h1>{wi.title}</h1>
          <TypeChip type={wi.type} />
          {wi.key && <span style={{ fontFamily: "var(--mono)", color: "var(--ink-400)", fontSize: 13 }}>{wi.key}</span>}
          {wi.startedWithOpenBlocker && <Pill tone="warning">התחיל עם חוסם פתוח</Pill>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(wi.phase === "intake" || wi.phase === "shaping") && (
            <button className="btn btn-primary btn-sm" onClick={onStart}>▶ התחל עבודה</button>
          )}
          {wi.phase === "building" && (
            <button className="btn btn-secondary btn-sm" onClick={onStart}>הוראות התחלה</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setNoteOpen(true)}>+ אירוע</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}>עריכה</button>
          <button className="btn btn-secondary btn-sm" style={{ color: "var(--status-critical)" }} onClick={onDelete}>מחיקה</button>
        </div>
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
            <div><dt>Azure DevOps</dt><dd>
              {wi.linkedAdoId
                ? (d.adoUrl ? <a href={d.adoUrl} target="_blank" rel="noreferrer">#{wi.linkedAdoId} ↗</a> : `#${wi.linkedAdoId}`)
                : <button className="btn btn-secondary btn-sm" disabled={syncing} onClick={onSyncAdo}>{syncing ? "יוצר…" : "צור ב-Azure DevOps"}</button>}
            </dd></div>
          </dl>
          <div className="progress-block">
            <div className="top"><span className="l">Progress — {doneTasks}/{d.tasks.length} tasks</span><span>{progress}%</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          </div>

          <div className="section">
            <div className="section-head">
              <p className="section-lbl" style={{ margin: 0 }}>Repositories שהדרישה נוגעת בהם</p>
              <button className="btn btn-secondary btn-sm" onClick={() => setRepoOpen(true)}>+ קשר repository</button>
            </div>
            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              <table className="wtable">
                <tbody>
                  {d.repos.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td><Pill tone={r.linkKind === "auto" ? "ai" : "inactive"}>{r.linkKind === "auto" ? "מהתהליך" : "ידני"}</Pill></td>
                      <td style={{ direction: "ltr", fontSize: 11, color: "var(--ink-400)" }}>{r.adoRepoRef ?? "—"}</td>
                      <td style={{ textAlign: "end" }}>
                        <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={async () => { if (confirm(`לנתק את ${r.name} מהדרישה?`)) { await unlinkRepoFromReq(wi.id, r.id); reload(); } }}>נתק</a>
                      </td>
                    </tr>
                  ))}
                  {d.repos.length === 0 && <tr><td colSpan={4}><div className="empty">אין repositories מקושרים.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <p className="section-lbl" style={{ margin: 0 }}>צרופות</p>
              <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                {uploading ? "מעלה…" : "📎 העלה קובץ"}
                <input type="file" hidden disabled={uploading} onChange={(e) => onUpload(e.target.files?.[0])} />
              </label>
            </div>
            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              <table className="wtable">
                <tbody>
                  {(d.attachments ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.adoUrl ? <a href={a.adoUrl} target="_blank" rel="noreferrer">{a.name} ↗</a> : a.name}</td>
                      <td style={{ color: "var(--ink-400)", fontSize: 11 }}>{a.sizeBytes != null ? `${Math.round(a.sizeBytes / 1024)} KB` : ""}</td>
                      <td><Pill tone={a.source === "ado" ? "ai" : "inactive"}>{a.source === "ado" ? "מ-TFS" : "מ-DCC"}</Pill></td>
                    </tr>
                  ))}
                  {(d.attachments ?? []).length === 0 && <tr><td colSpan={3}><div className="empty">אין צרופות. קובץ שתעלה כאן יעלה גם ל-work item ב-TFS.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section">
            <p className="section-lbl">Context Brief — what the next Claude session loads</p>
            <div className="panel"><pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-700)" }}>{brief || "—"}</pre></div>
          </div>
        </>
      )}

      {tab === "Timeline" && (
        <>
          <p className="hint" style={{ fontSize: 11.5, color: "var(--ink-400)", marginBottom: 10 }}>
            ה-timeline הוא append-only. "תיקון" של הערה יוצר אירוע חדש שמחליף את הישן — שום דבר לא נמחק.
          </p>
          <div className="rowlist">
            {d.events.map((e) => {
              const superseded = supersededIds.has(e.id);
              return (
                <div className="row" key={e.id} style={{ alignItems: "flex-start", background: isAi(e) ? "var(--status-ai-bg)" : undefined, opacity: superseded ? 0.55 : 1 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-400)", minWidth: 96 }}>{fmt(e.occurredAt)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {isAi(e) ? <Pill tone="ai">AI proposal</Pill> : <Pill tone="active">{e.actor.kind === "user" ? "Person" : "System"}</Pill>}
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-500)" }}>{e.type}</span>
                      {superseded && <Pill tone="inactive">תוקן</Pill>}
                      {e.supersedes && <Pill tone="healthy">תיקון</Pill>}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-700)", marginTop: 3, textDecoration: superseded ? "line-through" : "none" }}>{String(gist(e)).slice(0, 220)}</div>
                  </div>
                  {e.type === "note.added" && !superseded && e.actor.kind === "user" && (
                    <a style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setCorrecting(e)}>תקן</a>
                  )}
                </div>
              );
            })}
            {d.events.length === 0 && <div className="empty">No events yet.</div>}
          </div>
        </>
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
              <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={async () => { if (confirm("למחוק את המשימה?")) { await deleteTask(t.id, wi.clientId); reload(); } }}>מחק</a>
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
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {g.state === "proposed" && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "verified")}>Verify</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "dismissed")}>Dismiss</button>
                      {!g.blocking && <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "spun_off")}>Spin off</button>}
                    </>
                  )}
                  <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={async () => { if (confirm("למחוק את ה-Gap?")) { await deleteGap(g.id, wi.clientId); reload(); } }}>מחק</a>
                </div>
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
            {d.blockers.map((b) => <BlockerRow key={b.id} b={b} onAnswer={(a) => onAnswer(b, a)} onDelete={async () => { if (confirm("למחוק את ה-Blocker?")) { await deleteBlocker(b.id, wi.clientId); reload(); } }} />)}
            {d.blockers.length === 0 && <div className="empty">אין.</div>}
          </div>
        </>
      )}
    </>
  );
}

function StartBuildModal({ r, title, onClose }: { r: StartBuildResult; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState("");
  const copy = (t: string, k: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1500); };
  const repo = r.repos[0];
  const cmd = repo ? `git checkout -b ${r.branch}` : `git checkout -b ${r.branch}`;
  const mono: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "7vh 16px", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(560px, 100%)", padding: "22px 24px", maxHeight: "82vh", overflowY: "auto" }}>
        <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 6 }}>מתחילים לעבוד על "{title}"</h2>
        <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 16 }}>הדרישה עברה ל-<b>building</b>. פותחים branch לפי המוסכמה ומריצים Claude Code — ה-hooks יזרימו כל commit, קובץ וסיכום חזרה לכאן.</p>

        {r.startedWithOpenBlocker && (
          <div className="callout crit" style={{ marginBottom: 14 }}>
            <div className="body"><p className="r">שים לב — יש {r.openBlockingGaps} פערים חוסמים ו-{r.openBlockers} חוסמים פתוחים. אפשר להתחיל, אבל זה מסומן "התחיל עם חוסם פתוח".</p></div>
          </div>
        )}

        <div className="field" style={{ marginBottom: 10 }}>
          <label>מפתח הדרישה</label>
          <div style={mono}><span>{r.key}</span><a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(r.key, "key")}>{copied === "key" ? "הועתק ✓" : "העתק"}</a></div>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>שם ה-branch</label>
          <div style={mono}><span>{r.branch}</span><a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(r.branch, "branch")}>{copied === "branch" ? "הועתק ✓" : "העתק"}</a></div>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>repositories</label>
          {r.repos.length === 0
            ? <p style={{ fontSize: 12, color: "var(--status-critical)" }}>אין repository מקושר — קשר אחד קודם (טאב Overview → "+ קשר repository").</p>
            : r.repos.map((rp) => <div key={rp.name} style={{ fontSize: 12.5, direction: "ltr" }}>{rp.name}{rp.adoRepoRef ? ` — ${rp.adoRepoRef}` : ""} (base: {rp.defaultBranch})</div>)}
        </div>

        <div className="field">
          <label>הפקודה</label>
          <div style={{ ...mono, whiteSpace: "pre-wrap", display: "block" }}>
            {`# ב-repository המקושר:\n${cmd}\n\n# ואז:\nclaude`}
          </div>
          <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>ה-SessionStart hook יטען את ה-Context Brief של הדרישה אוטומטית לפי שם ה-branch.</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="btn btn-primary" onClick={onClose}>הבנתי</button>
        </div>
      </div>
    </div>
  );
}

function CorrectNote({ ev, workitemId, onClose, onDone }: { ev: EventRow; workitemId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(String(ev.payload.body ?? ""));
  const [busy, setBusy] = useState(false);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(520px, 100%)", padding: "22px 24px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 12 }}>תיקון הערה</h2>
        <p style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 10 }}>ההערה המקורית תישאר ב-timeline מסומנת "תוקן". זו רשומה חדשה שמחליפה אותה.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", minHeight: 110 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await correctNote(workitemId, ev.id, text.trim()); onDone(); } catch (e) { alert(String(e)); setBusy(false); } }}>{busy ? "שומר…" : "שמור תיקון"}</button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

function BlockerRow({ b, onAnswer, onDelete }: { b: Blocker; onAnswer: (a: string) => void; onDelete: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
          <Pill tone={b.state === "open" ? "critical" : "healthy"}>{b.state}</Pill>
          <span className="stage">{b.questionType}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={onDelete}>מחק</a>
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

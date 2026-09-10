import { useCallback, useEffect, useState } from "react";
import {
  answerBlocker, correctNote, deleteBlocker, deleteGap, deleteRequirement,
  getBrief, getDetail, unlinkRepoFromReq, uploadAttachment, verifyGap,
  type Blocker, type EventRow, type Gap, type WorkItemDetail,
} from "../api.ts";
import { Pill, TypeChip } from "../ui.tsx";
import { FlowGraph } from "./FlowGraph.tsx";
import { AddNote, EditRequirement, LinkRepoToReq } from "../forms.tsx";
import { WorkflowTab } from "./WorkflowTab.tsx";

const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
const post = async (path: string, body: unknown) => {
  const r = await fetch(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", "x-dcc-hook-token": HOOK, "x-dcc-dev-email": DEV_EMAIL }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

// Overview first (rightmost in RTL), then Timeline, then Dependencies.
const TABS = ["Overview", "Timeline", "Dependencies"] as const;
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
  const [answering, setAnswering] = useState<{ id: string; text: string } | null>(null);
  const [gapHelp, setGapHelp] = useState(false);
  const [newBlk, setNewBlk] = useState({ questionType: "unclear_requirement", question: "" });
  const [uploading, setUploading] = useState(false);

  // go back to wherever the user came from; fall back to the requirements list
  const back = useCallback(() => {
    const cur = location.hash;
    history.back();
    setTimeout(() => { if (location.hash === cur) nav("#/requirements"); }, 160);
  }, [nav]);

  const reload = useCallback(async () => {
    try {
      const [detail, b] = await Promise.all([getDetail(id), getBrief(id)]);
      setD(detail); setBrief(b); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, [id]);
  useEffect(() => { reload(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return (
    <div className="empty" style={{ textAlign: "center" }}>
      <p>{err.includes("404") ? "הדרישה לא נמצאה (אולי נמחקה)." : err}</p>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={back}>← חזרה</button>
    </div>
  );
  if (!d) return <div className="spin">Loading…</div>;
  const wi = d.workitem;
  const openBlocker = d.blockers.find((b) => b.state === "open");
  const isOpenGap = (g: Gap) => g.state === "proposed" || g.state === "verified";
  const openGaps = d.gaps.filter(isOpenGap);
  const liveTasks = d.tasks.filter((t) => t.state !== "dropped");
  const doneTasks = liveTasks.filter((t) => t.state === "done").length;
  const tasksInTfs = liveTasks.filter((t) => t.linkedAdoId).length;
  const progressPct = liveTasks.length ? Math.round((doneTasks / liveTasks.length) * 100) : 0;

  const onGap = async (g: Gap, outcome: "verified" | "resolved" | "dismissed" | "spun_off", answer?: string) => {
    await verifyGap(g.id, {
      outcome, clientId: wi.clientId,
      ...(outcome === "spun_off" ? { spunOffTitle: g.description.slice(0, 80) } : {}),
      ...(answer ? { answer } : {}),
    });
    setAnswering(null);
    reload();
  };
  const onAnswer = async (b: Blocker, answer: string) => { await answerBlocker(b.id, { answer, clientId: wi.clientId }); reload(); };
  const onDelete = async () => {
    const tfsNote = d.tasks.some((t) => t.linkedAdoId)
      ? `\n\nמשימות שכבר הוקמו ב-TFS יישארו שם — הן פריטי העבודה של הצוות.`
      : "";
    if (!confirm(`למחוק את הדרישה "${wi.title}"? האירועים ב-timeline יישמרו (append-only) אבל יינותקו ממנה.${tfsNote}`)) return;
    try { await deleteRequirement(wi.id); back(); }
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

  // the gaps/blockers management panel — lives inside step 2 of the
  // workflow card now, not a top-level tab (unchanged functionality).
  const gapsPanel = (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p className="section-lbl" style={{ margin: 0 }}>פערים ואי-בהירויות</p>
        <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--color-accent)" }} onClick={() => setGapHelp((v) => !v)}>
          {gapHelp ? "הסתר הסבר" : "מה זה ואיך מתקדמים?"}
        </a>
      </div>

      {gapHelp && (
        <div className="callout" style={{ marginTop: 10, marginBottom: 14, fontSize: 12.5, lineHeight: 1.7 }}>
          <div className="body">
            <p><b>פער</b> = משהו שחסר / לא הוחלט / דו-משמעי בדרישה. Claude מציע פערים אחרי שהוא קורא את הדרישה ואת ה-repo; אתה מחליט מה לעשות עם כל אחד:</p>
            <ul style={{ margin: "6px 0", paddingInlineStart: 18 }}>
              <li><b>אמיתי</b> — הפער נכון וצריך מענה. אם הוא <b>חוסם</b> — אי אפשר להתחיל לעבוד עד שעונים עליו.</li>
              <li><b>ענה ונסגר</b> — כותב את ההחלטה (נשמרת כהערה ב-timeline) והפער נסגר.</li>
              <li><b>נדחה</b> — לא באמת פער (כבר הוחלט במקום אחר, או לא רלוונטי). נעלם מהרשימה.</li>
              <li><b>פצל לדרישה</b> — פער אמיתי אבל לא שייך לדרישה הזו; נפתחת דרישה נפרדת והעבודה כאן ממשיכה.</li>
            </ul>
          </div>
        </div>
      )}

      <div className="filter-bar" style={{ margin: "10px 0 14px" }}>
        <div className="field" style={{ flex: 1 }}><label>הוסף פער שזיהית בעצמך</label>
          <input value={newGap.description} onChange={(e) => setNewGap({ ...newGap, description: e.target.value })} placeholder="למשל: לא מוגדר מה קורה כשלקוח עובר דרגה באמצע חודש" style={{ minWidth: 260 }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" style={{ minWidth: 0 }} checked={newGap.blocking} onChange={(e) => setNewGap({ ...newGap, blocking: e.target.checked })} /> חוסם
        </label>
        <button className="btn btn-primary btn-sm" onClick={async () => { if (!newGap.description.trim()) return; await post(`/workitems/${wi.id}/gaps`, { description: newGap.description.trim(), blocking: newGap.blocking, confidence: 1, mode: "interactive" }); setNewGap({ description: "", blocking: false }); reload(); }}>הוסף</button>
      </div>

      {d.gaps.length === 0 && (
        <div className="empty" style={{ marginBottom: 18 }}>אין פערים. הרץ "המשך עם AI" בשלב 1 כדי ש-Claude יבדוק את הדרישה.</div>
      )}

      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        {openGaps.map((g) => (
          <div key={g.id} style={{ border: `1px solid ${g.blocking ? "var(--status-critical)" : "var(--border-hairline)"}`, borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 7 }}>
              {g.blocking
                ? <Pill tone="critical">🔴 חוסם — חייב הכרעה כדי להתחיל</Pill>
                : <Pill tone="inactive">לא חוסם — אפשר להשאיר</Pill>}
              {g.state === "verified" && <Pill tone="warning">✓ נבדק — ממתין להכרעה</Pill>}
              <span className="stage">ביטחון {Math.round(Number(g.confidence) * 100)}%</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.65, marginBottom: 11 }}>{g.description}</div>

            {answering?.id === g.id ? (
              <div style={{ display: "grid", gap: 8 }}>
                <textarea
                  value={answering.text} autoFocus rows={3}
                  onChange={(e) => setAnswering({ id: g.id, text: e.target.value })}
                  placeholder="כתוב את ההכרעה — מה ההחלטה, מה עושים. תישמר כהערה ב-timeline והפער ייסגר."
                  style={{ width: "100%", fontSize: 12.5, padding: "8px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={!answering.text.trim()} onClick={() => onGap(g, "resolved", answering.text.trim())}>שמור וסגור פער</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAnswering(null)}>ביטול</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setAnswering({ id: g.id, text: "" })}>✎ הכרע / ענה</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "dismissed")}>✕ לא פער אמיתי</button>
                  {!g.blocking && <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "spun_off")}>↗ פתח דרישה נפרדת</button>}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                  {g.state === "proposed" && <a className="link" style={{ fontSize: 11.5 }} onClick={() => onGap(g, "verified")}>סמן שנבדק, אכריע בהמשך</a>}
                  <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--ink-400)" }} onClick={async () => { if (confirm("למחוק את הפער לגמרי?")) { await deleteGap(g.id, wi.clientId); reload(); } }}>מחק</a>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {d.gaps.filter((g) => !isOpenGap(g)).length > 0 && (
        <details style={{ marginBottom: 22 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--ink-500)" }}>
            טופלו ({d.gaps.filter((g) => !isOpenGap(g)).length})
          </summary>
          <div className="rowlist" style={{ marginTop: 8 }}>
            {d.gaps.filter((g) => !isOpenGap(g)).map((g) => (
              <div className="row" key={g.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink-600)" }}>{g.description}</div>
                </div>
                {g.state === "resolved" && <Pill tone="healthy">נענה</Pill>}
                {g.state === "dismissed" && <Pill tone="inactive">לא פער</Pill>}
                {g.state === "spun_off" && <Pill tone="inactive">דרישה נפרדת</Pill>}
                <a className="link" style={{ fontSize: 11 }} onClick={() => onGap(g, "verified")}>החזר לפתוח</a>
                <a style={{ fontSize: 11, cursor: "pointer", color: "var(--ink-400)" }} onClick={async () => { if (confirm("למחוק את הפער לגמרי?")) { await deleteGap(g.id, wi.clientId); reload(); } }}>מחק</a>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="section-lbl">חוסמים (Blockers)</p>
      <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: -6, marginBottom: 10 }}>שאלה פתוחה שעוצרת את העבודה עד שמישהו עונה — למשל החלטה שצריך מגורם אחר.</p>
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="field"><label>סוג</label>
          <select value={newBlk.questionType} onChange={(e) => setNewBlk({ ...newBlk, questionType: e.target.value })}>
            <option value="unclear_requirement">דרישה לא ברורה</option><option value="missing_access">חסרה גישה</option><option value="budget_exceeded">חריגת תקציב</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>השאלה</label>
          <input value={newBlk.question} onChange={(e) => setNewBlk({ ...newBlk, question: e.target.value })} placeholder="מה חוסם ומה צריך כדי להמשיך" style={{ minWidth: 260 }} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={async () => { if (!newBlk.question.trim()) return; await post(`/workitems/${wi.id}/blockers`, { questionType: newBlk.questionType, question: newBlk.question.trim() }); setNewBlk({ questionType: "unclear_requirement", question: "" }); reload(); }}>הוסף חוסם</button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {d.blockers.map((b) => <BlockerRow key={b.id} b={b} onAnswer={(a) => onAnswer(b, a)} onDelete={async () => { if (confirm("למחוק את החוסם?")) { await deleteBlocker(b.id, wi.clientId); reload(); } }} />)}
        {d.blockers.length === 0 && <div className="empty">אין חוסמים.</div>}
      </div>
    </div>
  );

  return (
    <>
      {noteOpen && <AddNote workitemId={wi.id} onClose={() => setNoteOpen(false)} onDone={() => { setNoteOpen(false); reload(); }} />}
      {editOpen && <EditRequirement wi={wi} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); reload(); }} />}
      {repoOpen && <LinkRepoToReq workitemId={wi.id} onClose={() => setRepoOpen(false)} onDone={() => { setRepoOpen(false); reload(); }} />}
      {correcting && <CorrectNote ev={correcting} workitemId={wi.id} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); reload(); }} />}
      <p className="crumb"><a onClick={() => nav(wi.parentId ? `#/wi/${wi.parentId}` : `#/client/${wi.clientId}`)}>← {wi.parentId ? "לדרישת האב" : "ללקוח"}</a></p>
      <div className="rec-head" style={{ justifyContent: "space-between" }}>
        <div className="rec-head" style={{ margin: 0 }}>
          <h1>{wi.title}</h1>
          <TypeChip type={wi.type} />
          {wi.key && <span style={{ fontFamily: "var(--mono)", color: "var(--ink-400)", fontSize: 13 }}>{wi.key}</span>}
          {wi.startedWithOpenBlocker && <Pill tone="warning">התחיל עם חוסם פתוח</Pill>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setNoteOpen(true)}>+ אירוע</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}>עריכה</button>
          <button className="btn btn-secondary btn-sm" style={{ color: "var(--status-critical)" }} onClick={onDelete}>מחיקה</button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="req-bg" style={{ paddingTop: 22 }}>
          {openBlocker && (
            <div className="callout crit" style={{ marginBottom: 18 }}>
              <span className="ic"><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--status-critical)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg></span>
              <div className="body">
                <p className="q">Blocked — {openBlocker.questionType.replace(/_/g, " ")}</p>
                <p className="r">{openBlocker.question}</p>
              </div>
            </div>
          )}

          {/* metrics · repositories · attachments — one row, 3 columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 20, marginBottom: 20 }}>
            <div className="ov-card" style={{ padding: "16px 18px" }}>
              <div className="ov-metric-grid" style={{ marginBottom: 14 }}>
                <div className="ov-metric"><div className="lbl">Phase</div><div className="val">{wi.phase}</div></div>
                <div className="ov-metric"><div className="lbl">Priority</div><div className="val">{wi.priority}</div></div>
                <div className="ov-metric"><div className="lbl">Risk</div><div className="val">{wi.risk}</div></div>
                <div className="ov-metric"><div className="lbl">Executor</div><div className="val">{wi.executor}</div></div>
                <div className="ov-metric"><div className="lbl">AI budget</div><div className="val">{wi.budgetUsd ? `$${wi.budgetUsd}` : "default"}</div></div>
                <div className="ov-metric"><div className="lbl">TFS</div><div className="val">{tasksInTfs} <span style={{ fontSize: 10, fontWeight: 500, color: "#9B98B8" }}>משימות</span></div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "#9B98B8", flexShrink: 0 }}>{progressPct}%</span>
                <div className="progress-track" style={{ flex: 1, height: 5, background: "#F0EFF7" }}><div className="progress-fill" style={{ width: `${progressPct}%`, background: "#584EF3" }} /></div>
                <span style={{ fontSize: 11, color: "#9B98B8", flexShrink: 0 }}>{doneTasks}/{liveTasks.length} tasks</span>
              </div>
            </div>

            <div className="ov-card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#9B98B8", textTransform: "uppercase", letterSpacing: "0.04em" }}>Repositories</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setRepoOpen(true)}>+ קשר</button>
              </div>
              {d.repos.map((r, i) => (
                <div key={r.id} style={{ padding: "8px 0", borderTop: i > 0 ? "1px solid #EAE8F5" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <Pill tone={r.linkKind === "auto" ? "ai" : "inactive"}>{r.linkKind === "auto" ? "מהתהליך" : "ידני"}</Pill>
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{r.name}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 10.5, color: "#9B98B8", direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.adoRepoRef ?? "—"}</span>
                    <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)", flexShrink: 0 }} onClick={async () => { if (confirm(`לנתק את ${r.name} מהדרישה?`)) { await unlinkRepoFromReq(wi.id, r.id); reload(); } }}>נתק</a>
                  </div>
                </div>
              ))}
              {d.repos.length === 0 && <div style={{ textAlign: "center", color: "#9B98B8", fontSize: 12, padding: "20px 0" }}>אין repositories מקושרים</div>}
            </div>

            <div className="ov-card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#9B98B8", textTransform: "uppercase", letterSpacing: "0.04em" }}>צרופות</span>
                <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                  {uploading ? "מעלה…" : "העלה"}
                  <input type="file" hidden disabled={uploading} onChange={(e) => onUpload(e.target.files?.[0])} />
                </label>
              </div>
              {(d.attachments ?? []).map((a, i) => (
                <div key={a.id} style={{ padding: "7px 0", borderTop: i > 0 ? "1px solid #EAE8F5" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  {a.adoUrl ? <a href={a.adoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name} ↗</a> : <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>}
                  <Pill tone={a.source === "ado" ? "ai" : "inactive"}>{a.source === "ado" ? "TFS" : "DCC"}</Pill>
                </div>
              ))}
              {(d.attachments ?? []).length === 0 && <div style={{ textAlign: "center", color: "#9B98B8", fontSize: 12, padding: "20px 0" }}>אין צרופות עדיין</div>}
            </div>
          </div>

          {/* the requirement's full text */}
          <div className="ov-card" style={{ padding: "18px 20px", marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#9B98B8", marginBottom: 8 }}>פירוט הדרישה</p>
            <p style={{ fontSize: 13, lineHeight: 1.8, color: "#3A3760" }}>{wi.title}</p>
          </div>

          {/* the guided workflow: stepper + step content, one unit */}
          <div style={{ marginBottom: 20 }}>
            <WorkflowTab d={d} reload={reload} nav={nav} gapsPanel={gapsPanel} />
          </div>

          <div className="section">
            <p className="section-lbl">Context Brief — what the next Claude session loads</p>
            <div className="panel"><pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-700)" }}>{brief || "—"}</pre></div>
          </div>
        </div>
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
    </>
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

const BLK_TYPE_HE: Record<string, string> = {
  unclear_requirement: "דרישה לא ברורה", missing_access: "חסרה גישה", budget_exceeded: "חריגת תקציב",
};

function BlockerRow({ b, onAnswer, onDelete }: { b: Blocker; onAnswer: (a: string) => void; onDelete: () => void }) {
  const [text, setText] = useState("");
  const open = b.state === "open";
  return (
    <div style={{ border: `1px solid ${open ? "var(--status-critical)" : "var(--border-hairline)"}`, borderRadius: 12, padding: "12px 14px", background: "var(--surface)" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 7, alignItems: "center", flexWrap: "wrap" }}>
        <Pill tone={open ? "critical" : "healthy"}>{open ? "🔴 חוסם פתוח" : "נענה"}</Pill>
        <span className="stage">{BLK_TYPE_HE[b.questionType] ?? b.questionType}</span>
        <span style={{ flex: 1 }} />
        <a style={{ fontSize: 11, cursor: "pointer", color: "var(--ink-400)" }} onClick={onDelete}>מחק</a>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65 }}>{b.question}</div>
      {b.answer && <div style={{ color: "var(--status-healthy)", fontSize: 12.5, marginTop: 6 }}>← {b.answer}</div>}
      {open && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="התשובה שמאפשרת להמשיך…" style={{ flex: 1, font: "inherit", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }} />
          <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => text.trim() && onAnswer(text.trim())}>שלח תשובה</button>
        </div>
      )}
    </div>
  );
}

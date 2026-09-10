import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTask, getTaskRun, implementTask, progressTask, editTask, rollbackTask, pushTask,
  precheckTaskDelete, deleteTask, DeleteBlocked,
  type FlowRun, type ImplementResult, type TaskDetail as TD, type TaskDeletePrecheck,
} from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { StepRail } from "./WorkflowTab.tsx";

/**
 * One task — the unit that actually reaches TFS and gets built. Its own
 * gated FLOW, same pattern as the requirement's: פיתוח → סקירה והחלטה →
 * הושלם. "תן ל-Claude לפתח" runs the local CLI with write tools on an
 * ISOLATED clone (never the user's own checkout), on a task branch, and
 * commits locally. It never pushes on its own — "⬆ Push ל-GitHub" is the
 * deliberate, explicit action inside the review step, once the user has
 * decided to keep what changed.
 */

const STATE_HE: Record<string, string> = {
  pending: "ממתין", in_progress: "בעבודה", blocked: "חסום", done: "הושלם", dropped: "נדחה",
};

const TASK_STEPS = [
  { key: "implement", label: "פיתוח" },
  { key: "review", label: "סקירה והחלטה" },
  { key: "done", label: "הושלם" },
] as const;

const Transcript = ({ lines }: { lines: string[] }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [lines.length]);
  return (
    <div ref={box} style={{ maxHeight: "44vh", overflowY: "auto", background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.6 }}>
      {lines.length === 0
        ? <span style={{ color: "var(--ink-400)" }}>מתחיל…</span>
        : lines.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("💭") ? "var(--ink-500)" : "var(--ink-800)", whiteSpace: "pre-wrap", marginBottom: 3 }}>{l}</div>
          ))}
    </div>
  );
};

const Card = ({ children, tone }: { children: React.ReactNode; tone?: "crit" | "ok" }) => (
  <div style={{
    border: `1px solid ${tone === "crit" ? "var(--status-critical)" : tone === "ok" ? "var(--status-healthy)" : "var(--border-hairline)"}`,
    borderRadius: 12, padding: "14px 16px", marginBottom: 14, background: "var(--surface)",
  }}>{children}</div>
);

export function TaskDetail({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<TD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [copied, setCopied] = useState("");
  const [editing, setEditing] = useState(false);
  const [editIntent, setEditIntent] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editAppetite, setEditAppetite] = useState<"small" | "standard" | "large">("standard");
  const [editScope, setEditScope] = useState<"text" | "scope">("text");
  const [saving, setSaving] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ pushed: boolean; reason?: string; branchUrl?: string; compareUrl?: string } | null>(null);
  const [delReport, setDelReport] = useState<TaskDeletePrecheck | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [delAckSubtree, setDelAckSubtree] = useState(false);
  const [delAckAdo, setDelAckAdo] = useState(false);
  const [delAckCoTouch, setDelAckCoTouch] = useState(false);
  const [delCodeChoice, setDelCodeChoice] = useState<"rollback" | "orphan">("rollback");
  const [delErr, setDelErr] = useState<string | null>(null);
  const [manualStep, setManualStep] = useState<number | null>(null);

  const load = useCallback(() => { getTask(id).then(setD).catch((e) => setErr(String(e))); }, [id]);
  const refreshRun = useCallback(async () => {
    try {
      const r = await getTaskRun(id);
      setRun((prev) => { if (prev?.state === "running" && r.state === "done") load(); return r; });
    } catch { /* ignore */ }
  }, [id, load]);

  useEffect(() => { load(); refreshRun(); }, [load, refreshRun]);
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(refreshRun, 1500);
    return () => clearInterval(iv);
  }, [running, refreshRun]);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;
  const t = d.task;
  const blockedOpen = d.blockedBy.filter((b) => b.state !== "done");
  const impl = run?.state === "done" && run.kind === "implement" ? (run.result as unknown as ImplementResult | null) : null;

  // the task's own FLOW: פיתוח → סקירה והחלטה → הושלם. Step 1 unlocks once
  // an implement run has concluded (something to review); step 2 unlocks
  // the same moment — marking done doesn't require having pushed, since
  // not every task ends in a push (some get reviewed and rolled back on
  // purpose, some are finished by other means).
  const attempted = run !== null && run.kind === "implement" && run.state !== "running" && run.state !== "idle";
  const stepDone = [attempted, t.state === "done", t.state === "done"];
  const stepUnlocked = [true, attempted, attempted];
  const defaultStep = !attempted ? 0 : t.state === "done" ? 2 : 1;
  const activeStep = manualStep ?? defaultStep;
  const goStep = (i: number) => setManualStep(i);

  const copy = (s: string, k: string) => { navigator.clipboard?.writeText(s); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  const start = async () => {
    setErr(null);
    try { await implementTask(id); setShowLog(true); await refreshRun(); }
    catch (e) { setErr(String(e)); }
  };

  const openEdit = () => {
    setEditIntent(t.intent);
    setEditPrompt(t.prompt ?? "");
    setEditAppetite(t.appetite as "small" | "standard" | "large");
    setEditScope("text");
    setEditing(true);
  };
  const saveEdit = async () => {
    setSaving(true); setErr(null);
    try {
      await editTask(id, {
        clientId: t.clientId, intent: editIntent, appetite: editAppetite, prompt: editPrompt,
        scopeChanged: editScope === "scope",
      });
      setEditing(false);
      load();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const rollback = async () => {
    if (!confirm("זה יבטל את כל שינויי הקוד שנעשו במשימה הזו (branch מבודד, לא בקוד שלך) ויחזיר אותה ל-\"ממתין\". לא ניתן לשחזר מה-DCC. להמשיך?")) return;
    setRollingBack(true); setErr(null); setRollbackMsg(null);
    try {
      const r = await rollbackTask(id);
      setRollbackMsg(r.rolledBack ? "✓ שינויי הקוד בוטלו — ה-branch אופס לבסיס. המשימה נקייה כמו לפני שפותחה." : (r.reason ?? "אין מה לבטל."));
      load();
      await refreshRun();
    } catch (e) { setErr(String(e)); }
    finally { setRollingBack(false); }
  };

  const push = async () => {
    if (!confirm("זה ידחוף את ה-branch של המשימה הזו ל-GitHub (origin האמיתי של ה-repo). להמשיך?")) return;
    setPushing(true); setErr(null); setPushResult(null);
    try {
      const r = await pushTask(id);
      setPushResult(r);
    } catch (e) { setErr(String(e)); }
    finally { setPushing(false); }
  };

  const openDelete = async () => {
    setDelErr(null); setDelLoading(true);
    setDelAckSubtree(false); setDelAckAdo(false); setDelAckCoTouch(false); setDelCodeChoice("rollback");
    try { setDelReport(await precheckTaskDelete(id)); }
    catch (e) { setErr(String(e)); }
    finally { setDelLoading(false); }
  };
  const confirmDelete = async () => {
    if (!delReport) return;
    setDelLoading(true); setDelErr(null);
    try {
      await deleteTask(id, {
        clientId: t.clientId,
        confirmSubtree: delAckSubtree,
        confirmAdoLinked: delAckAdo,
        confirmCoTouch: delAckCoTouch,
        rollbackImplemented: delReport.hasImplementedCode && delCodeChoice === "rollback",
        confirmOrphanCode: delReport.hasImplementedCode && delCodeChoice === "orphan",
      });
      nav(`#/wi/${d.requirement.id}`);
    } catch (e) {
      if (e instanceof DeleteBlocked) { setDelReport(e.precheck); setDelErr(e.message); }
      else setDelErr(String(e));
    } finally { setDelLoading(false); }
  };
  const readyToDelete = !!delReport && (
    (!delReport.hasChildren || delAckSubtree) &&
    (!delReport.hasAdoLinks || delAckAdo) &&
    (!delReport.hasCoTouch || delAckCoTouch)
  );

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav(`#/wi/${d.requirement.id}`)}>← {d.requirement.key ?? "לדרישה"}: {d.requirement.title.slice(0, 50)}</a>}
        title={t.intent}
        sub={`${t.kind === "check" ? "בדיקה" : "משימה"} #${t.seq} · ${t.kind === "check" ? "לא ב-TFS בנפרד" : t.adoType ?? "Task"} · ${t.appetite}`}
        actions={
          <>
            <button className="btn btn-secondary" disabled={running} onClick={openEdit}>✎ ערוך משימה</button>
            <button className="btn btn-secondary" disabled={running || delLoading} onClick={openDelete} style={{ color: "var(--status-critical)" }}>
              {delLoading && !delReport ? "בודק…" : "🗑 מחק משימה"}
            </button>
          </>
        }
      />

      {delReport && (
        <Card tone={delReport.safe ? undefined : "crit"}>
          <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>מחיקת משימה #{t.seq}</h3>
          {delReport.safe ? (
            <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>
              אין תת-פריטים, אין קישור ל-TFS, אין קוד שמומש, ואין משימות אחרות שנגעו באותם קבצים — מחיקה בטוחה.
            </p>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--ink-600)", marginBottom: 12 }}>
              נמצאו {delReport.subtree.length} פריטים שיימחקו. יש לאשר כל נקודה רגישה בנפרד לפני שהמחיקה תתבצע.
            </p>
          )}

          {delReport.hasChildren && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ color: "var(--status-critical)" }}>
                {delReport.subtree.length - 1} תת-פריטים יימחקו יחד עם המשימה
              </label>
              <div className="rowlist" style={{ marginTop: 4 }}>
                {delReport.subtree.filter((n) => n.id !== t.id).map((n) => (
                  <div className="row" key={n.id} style={{ fontSize: 12 }}>
                    <span>#{n.seq} {n.kind === "check" ? "✓ בדיקה" : "משימה"} · {STATE_HE[n.state] ?? n.state}{n.linkedAdoId ? ` · TFS #${n.linkedAdoId}` : ""}{n.commitCount ? ` · ${n.commitCount} commits` : ""}</span>
                    <span className="spacer" />
                    <span style={{ color: "var(--ink-500)" }}>{n.intent.slice(0, 50)}</span>
                  </div>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 8 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckSubtree} onChange={(e) => setDelAckSubtree(e.target.checked)} />
                מבין/ה שכל אלה יימחקו יחד עם המשימה
              </label>
            </div>
          )}

          {delReport.hasAdoLinks && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ color: "var(--status-critical)" }}>חלק כבר קיים ב-TFS</label>
              <p style={{ fontSize: 12, color: "var(--ink-600)", marginTop: 2 }}>
                פריטי TFS <b>לא</b> יימחקו — רק יתועד עליהם ב-Discussion שהוסרו מ-DCC:{" "}
                {delReport.subtree.filter((n) => n.linkedAdoId).map((n) => (
                  <a key={n.id} href={n.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ marginInlineEnd: 6 }}>#{n.linkedAdoId}</a>
                ))}
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 6 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckAdo} onChange={(e) => setDelAckAdo(e.target.checked)} />
                מבין/ה שהפריטים ב-TFS נשארים שם ולא נמחקים
              </label>
            </div>
          )}

          {delReport.hasImplementedCode && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ color: "var(--status-critical)" }}>יש קוד מומש שטרם בוטל</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, marginTop: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" style={{ minWidth: 0 }} checked={delCodeChoice === "rollback"} onChange={() => setDelCodeChoice("rollback")} />
                  בטל את השינויים קודם (rollback) — מומלץ
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" style={{ minWidth: 0 }} checked={delCodeChoice === "orphan"} onChange={() => setDelCodeChoice("orphan")} />
                  השאר את ה-commits כ"יתומים" בקלון המבודד — לא נמחקים בפועל, אבל לא נגישים דרך DCC יותר
                </label>
              </div>
            </div>
          )}

          {delReport.hasCoTouch && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ color: "var(--status-critical)" }}>
                {delReport.coTouchedBy.length} משימות אחרות כבר נגעו באותם קבצים
              </label>
              <div className="rowlist" style={{ marginTop: 4 }}>
                {delReport.coTouchedBy.map((c) => (
                  <div className="row" key={c.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: 3, paddingBlock: 6 }}>
                    <span className="w-title" style={{ fontSize: 12.5 }} onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent.slice(0, 60)}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>{c.files.join(", ")}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 6 }}>
                מחיקת המשימה לא תשנה את ה-branch של המשימות האלה — אבל ייתכן שהן תלויות בשינוי הזה או כופלות אותו.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 6 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckCoTouch} onChange={(e) => setDelAckCoTouch(e.target.checked)} />
                בדקתי את המשימות האלה ורוצה להמשיך במחיקה
              </label>
            </div>
          )}

          {delErr && <p style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 8 }}>{delErr}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={!readyToDelete || delLoading} onClick={confirmDelete} style={{ background: "var(--status-critical)", borderColor: "var(--status-critical)" }}>
              {delLoading ? "מוחק…" : "אשר מחיקה"}
            </button>
            <button className="btn btn-secondary" onClick={() => setDelReport(null)}>ביטול</button>
          </div>
        </Card>
      )}

      {editing && (
        <Card>
          <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 10 }}>עריכת משימה</h3>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>כותרת / intent</label>
            <textarea value={editIntent} onChange={(e) => setEditIntent(e.target.value)} rows={2} />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>הפרומט המדוייק שיורץ ל-Claude</label>
            <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={5} placeholder="ריק = ישתמש ב-intent" />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>גודל</label>
            <select value={editAppetite} onChange={(e) => setEditAppetite(e.target.value as "small" | "standard" | "large")}>
              <option value="small">small</option>
              <option value="standard">standard</option>
              <option value="large">large</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>מה מאפיין את השינוי?</label>
            <div style={{ display: "flex", gap: 14, fontSize: 12.5, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" style={{ minWidth: 0 }} checked={editScope === "text"} onChange={() => setEditScope("text")} />
                רק ניסוח / הבהרה — ההיקף לא השתנה
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" style={{ minWidth: 0 }} checked={editScope === "scope"} onChange={() => setEditScope("scope")} />
                היקף העבודה השתנה — צריך לבדוק תלויות/בדיקות מחדש
              </label>
            </div>
            {editScope === "scope" && (
              <p style={{ fontSize: 11.5, color: "var(--status-warning)", marginTop: 6 }}>
                יתועד כך גם ב-DCC וגם ב-Discussion של TFS (אם קיים). מומלץ לעבור על הפירוק/הבדיקות של המשימה מול השינוי.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>{saving ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>ביטול</button>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <Pill tone={t.state === "done" ? "healthy" : t.state === "in_progress" ? "active" : t.state === "blocked" ? "critical" : "inactive"}>
          {STATE_HE[t.state] ?? t.state}
        </Pill>
        {t.kind === "check"
          ? <Pill tone="neutral">✓ בדיקה — לא work item בפני עצמה</Pill>
          : <Pill tone={t.adoType && t.adoType !== "Task" ? "ai" : "inactive"}>{t.adoType ?? "Task"}</Pill>}
        {t.linkedAdoId
          ? (t.kind === "check"
              ? <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--status-healthy)" }}>תועד ב-Discussion של המשימה ההורה ↗</a>
              : <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--status-healthy)" }}>TFS #{t.linkedAdoId} ↗</a>)
          : <Pill tone="warning">{t.approvedAt ? (t.kind === "check" ? "מאושר, טרם תועד" : "מאושר, טרם הוקם ב-TFS") : "ממתין לאישור"}</Pill>}
        {t.origin === "ai" && <Pill tone="ai">הוצע ע"י AI</Pill>}
      </div>

      {blockedOpen.length > 0 && (
        <Card tone="crit">
          <p style={{ fontSize: 13, marginBottom: 8 }}>המשימה תלויה ב-{blockedOpen.length} משימות שטרם הושלמו:</p>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5 }}>
            {blockedOpen.map((b) => (
              <li key={b.id} style={{ marginBottom: 3 }}>
                <span className="w-title" onClick={() => nav(`#/task/${b.id}`)}>#{b.seq} {b.intent.slice(0, 70)}</span>
                <span style={{ color: "var(--ink-400)" }}> — {STATE_HE[b.state] ?? b.state}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 8 }}>אפשר לפתח בכל זאת, אבל ייתכן שהבסיס עוד לא קיים.</p>
        </Card>
      )}

      <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
        <StepRail steps={TASK_STEPS} done={stepDone} unlocked={stepUnlocked} active={activeStep} onPick={goStep} busy={running} />
        <div style={{ padding: 16 }}>

          {activeStep === 0 && (
            <>
              {running ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <div className="spin" style={{ display: "inline-block", width: 16, height: 16 }} />
                    <p style={{ fontSize: 13, color: "var(--ink-600)", margin: 0 }}>Claude מפתח את המשימה — קורא, עורך, ומריץ מה שאפשר…</p>
                  </div>
                  <Transcript lines={run?.lines ?? []} />
                  <p style={{ marginTop: 6, fontSize: 11, color: "var(--ink-400)" }}>
                    רץ ברקע על קלון מבודד, על branch נפרד. אפשר לצאת מהמסך. לא נדחף כלום.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>
                    {attempted ? "אפשר להריץ שוב — למשל אחרי עריכת הפרומט, או כדי לנסות גישה אחרת." : "Claude יקרא, יערוך ויריץ מה שאפשר על קלון מבודד — עוד לא נוגע בקוד שלך ולא בשום remote."}
                  </p>
                  <button className="btn btn-primary" onClick={start}>
                    {attempted ? "✦ הרץ שוב" : "✦ תן ל-Claude לפתח"}
                  </button>
                  {run?.state === "error" && (
                    <div style={{ marginTop: 14 }}>
                      <p style={{ fontSize: 13, marginBottom: 6, color: "var(--status-critical)" }}>ההרצה האחרונה נכשלה.</p>
                      <p style={{ fontSize: 12, color: "var(--status-critical)", whiteSpace: "pre-wrap" }}>{run.error}</p>
                    </div>
                  )}
                </>
              )}
              {run && run.lines.length > 0 && !running && (
                <div style={{ marginTop: 14 }}>
                  <a className="link" style={{ fontSize: 12 }} onClick={() => setShowLog((v) => !v)}>
                    {showLog ? "▲ הסתר" : "▼ הצג"} את התמלול המלא של ההרצה
                  </a>
                  {showLog && <div style={{ marginTop: 8 }}><Transcript lines={run.lines} /></div>}
                </div>
              )}
            </>
          )}

          {activeStep === 1 && (
            <>
              {impl && (
                <>
                  <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>מה Claude עשה</h3>
                  <p style={{ fontSize: 12.5, color: "var(--ink-700)", whiteSpace: "pre-wrap", lineHeight: 1.65, marginBottom: 12 }}>{impl.summary}</p>

                  {impl.filesChanged.length > 0 && (
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>קבצים שהשתנו ({impl.filesChanged.length})</label>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left" }}>
                        {impl.filesChanged.map((f) => <div key={f}>{f}</div>)}
                      </div>
                    </div>
                  )}
                  {impl.affectedConsumers?.length > 0 && (
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>מי עוד נוגע בקבצים האלה ({impl.affectedConsumers.length})</label>
                      <p style={{ fontSize: 11, color: "var(--ink-500)", marginTop: -2, marginBottom: 6 }}>
                        קוד אחר שמפנה/משתמש בקבצים ששונו — יש לשקול לאסוף ולעדכן אותם יחד לפריסת טסט.
                      </p>
                      <div className="rowlist">
                        {impl.affectedConsumers.map((c, i) => (
                          <div className="row" key={i} style={{ alignItems: "flex-start", flexDirection: "column", gap: 3, paddingBlock: 8 }}>
                            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{c.path}</span>
                            <span style={{ fontSize: 12, color: "var(--ink-700)" }}>{c.reason}</span>
                            {c.usedBy.length > 0 && (
                              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>
                                ← {c.usedBy.join(", ")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {impl.testsRun && (
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>בדיקות</label>
                      <p style={{ fontSize: 12.5 }}>{impl.testsRun}</p>
                    </div>
                  )}
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>איפה זה יושב</label>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", whiteSpace: "pre-wrap" }}>
                      {`${impl.dir}\n${impl.branch}${impl.commit ? `  (commit ${impl.commit})` : "  — ללא שינויים"}`}
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 14 }}>
                    <label>לבדיקה מקומית</label>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ whiteSpace: "pre-wrap" }}>{`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`}</span>
                      <a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`, "cmd")}>{copied === "cmd" ? "✓" : "העתק"}</a>
                    </div>
                  </div>

                  {impl.followUps.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <p className="section-lbl" style={{ marginBottom: 6 }}>המשך שנשאר</p>
                      <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                        {impl.followUps.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}

                  <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 14, display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" disabled={pushing || rollingBack} onClick={push}>
                      {pushing ? "דוחף…" : "⬆ Push ל-GitHub"}
                    </button>
                    <button className="btn btn-secondary" disabled={pushing || rollingBack} onClick={rollback}>
                      {rollingBack ? "מבטל…" : "↩ Rollback"}
                    </button>
                  </div>

                  {pushResult && (
                    <div className="callout" style={{ marginTop: 12 }}>
                      <div className="body">
                        {pushResult.pushed ? (
                          <>
                            <p className="r">✓ נדחף ל-GitHub.</p>
                            <p style={{ display: "flex", gap: 14, marginTop: 4 }}>
                              {pushResult.branchUrl && <a href={pushResult.branchUrl} target="_blank" rel="noreferrer">צפה ב-branch ↗</a>}
                              {pushResult.compareUrl && <a href={pushResult.compareUrl} target="_blank" rel="noreferrer">פתח Pull Request ↗</a>}
                            </p>
                          </>
                        ) : (
                          <p className="r" style={{ color: "var(--status-critical)" }}>{pushResult.reason ?? "ה-push נכשל."}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {rollbackMsg && (
                    <div className="callout" style={{ marginTop: 12 }}>
                      <div className="body"><p className="r">{rollbackMsg}</p></div>
                    </div>
                  )}
                </>
              )}

              {!impl && run?.state === "rolled_back" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Pill tone="inactive">↩ בוטל</Pill>
                    <h3 style={{ fontSize: 13.5, fontWeight: 650, margin: 0, color: "var(--ink-600)" }}>הרצה קודמת — הקוד בוטל, המשימה נקייה כרגע</h3>
                  </div>
                  {(() => {
                    const old = run.result as unknown as ImplementResult | null;
                    if (!old) return null;
                    return (
                      <>
                        <p style={{ fontSize: 12.5, color: "var(--ink-500)", whiteSpace: "pre-wrap", lineHeight: 1.6, marginBottom: 8 }}>{old.summary}</p>
                        {old.filesChanged.length > 0 && (
                          <div className="field">
                            <label>קבצים שהשתנו אז (כבר לא קיימים ב-branch)</label>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>
                              {old.filesChanged.join(", ")}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 8 }}>
                    אפשר לחזור לשלב הפיתוח ולהריץ מחדש בכל רגע.
                  </p>
                </>
              )}

              {!impl && run?.state === "error" && (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 6, color: "var(--status-critical)" }}>ההרצה נכשלה — אין מה לסקור.</p>
                  <p style={{ fontSize: 12, color: "var(--status-critical)", whiteSpace: "pre-wrap" }}>{run.error}</p>
                </div>
              )}
            </>
          )}

          {activeStep === 2 && (
            <>
              {t.state === "done" ? (
                <p style={{ fontSize: 13.5, color: "var(--status-healthy)" }}>✓ המשימה סומנה כהושלמה.</p>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>
                    לסמן שהעבודה של DCC על המשימה הזו נגמרה. אפשר לעשות זאת גם בלי push — לא כל משימה מסתיימת בקוד.
                  </p>
                  <button className="btn btn-primary" onClick={async () => { await progressTask(t.id, { to: "done", clientId: t.clientId }); load(); }}>
                    סמן כהושלם
                  </button>
                </>
              )}
            </>
          )}

        </div>
      </div>

      <Card>
        <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 10 }}>הקשר</h3>
        <dl className="detail-grid">
          <div><dt>דרישה</dt><dd><span className="w-title" onClick={() => nav(`#/wi/${d.requirement.id}`)}>{d.requirement.key ?? d.requirement.title.slice(0, 40)}</span></dd></div>
          {d.parent && <div><dt>הורה</dt><dd><span className="w-title" onClick={() => nav(`#/task/${d.parent!.id}`)}>#{d.parent.seq} {d.parent.intent.slice(0, 40)}</span></dd></div>}
          <div><dt>repository</dt><dd style={{ direction: "ltr" }}>{d.repos.map((r) => r.name).join(", ") || "—"}</dd></div>
          <div><dt>גודל</dt><dd>{t.appetite}</dd></div>
        </dl>
        {t.affectedPaths.length > 0 && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>קבצים צפויים</label>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{t.affectedPaths.join(", ")}</div>
          </div>
        )}
        {d.children.filter((c) => c.kind !== "check").length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="section-lbl" style={{ marginBottom: 6 }}>תת-משימות ({d.children.filter((c) => c.kind !== "check").length})</p>
            <div className="rowlist">
              {d.children.filter((c) => c.kind !== "check").map((c) => (
                <div className="row" key={c.id}>
                  <span className="title w-title" onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent}</span>
                  <span className="spacer" />
                  <Pill tone={c.state === "done" ? "healthy" : "inactive"}>{STATE_HE[c.state] ?? c.state}</Pill>
                </div>
              ))}
            </div>
          </div>
        )}
        {d.children.filter((c) => c.kind === "check").length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="section-lbl" style={{ marginBottom: 6 }}>
              רשימת בדיקה להשלמת המשימה ({d.children.filter((c) => c.kind === "check").length})
            </p>
            <p style={{ fontSize: 11, color: "var(--ov-label)", marginTop: -4, marginBottom: 6 }}>
              לא work items נפרדים ב-TFS — מתועדות ב-Discussion של המשימה הזו כשהיא מוקמת.
            </p>
            <div className="rowlist">
              {d.children.filter((c) => c.kind === "check").map((c) => (
                <div className="row" key={c.id}>
                  <span className={c.state === "done" ? "title" : "title w-title"} style={{ textDecoration: c.state === "done" ? "line-through" : "none", color: c.state === "done" ? "var(--ink-400)" : undefined }} onClick={() => nav(`#/task/${c.id}`)}>
                    {c.state === "done" ? "☑" : "☐"} #{c.seq} {c.intent}
                  </span>
                  <span className="spacer" />
                  {c.linkedAdoId ? <Pill tone="healthy">תועד ב-Discussion</Pill> : <Pill tone="inactive">{STATE_HE[c.state] ?? c.state}</Pill>}
                </div>
              ))}
            </div>
          </div>
        )}
        {d.blocks.length > 0 && (
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 10 }}>
            {d.blocks.length} משימות מחכות לזו: {d.blocks.map((b) => `#${b.seq}`).join(", ")}
          </p>
        )}
      </Card>
    </>
  );
}

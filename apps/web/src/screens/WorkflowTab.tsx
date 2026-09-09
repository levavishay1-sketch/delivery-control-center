import { useEffect, useRef, useState } from "react";
import {
  approveTask, assessRequirement, assignRequirement, breakdownRequirement, getFlowProgress, getUsers,
  rejectTask, startBuilding,
  type AssessResult, type BreakdownResult, type StartBuildResult, type WorkItemDetail,
} from "../api.ts";
import { Pill } from "../ui.tsx";

/**
 * "מהלך העבודה" — a real tab (not a modal). The resting view is derived
 * from the requirement's current state; the async AI steps (assess /
 * breakdown, which spawn the local `claude` CLI) take over the panel
 * while they run and show a live activity log.
 */

type Step = "resting" | "assign" | "assessing" | "breaking" | "tasks" | "build";

const LiveLog = ({ label, lines }: { label: string; lines: string[] }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight); }, [lines.length]);
  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div className="spin" style={{ display: "inline-block", width: 16, height: 16 }} />
        <p style={{ fontSize: 13, color: "var(--ink-600)", margin: 0 }}>{label}</p>
      </div>
      <div ref={boxRef} style={{ maxHeight: "44vh", overflowY: "auto", background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.6 }}>
        {lines.length === 0
          ? <span style={{ color: "var(--ink-400)" }}>מתחיל…</span>
          : lines.map((l, i) => (
              <div key={i} dir={/^[\u{1F300}-\u{1FAFF}]/u.test(l) ? "rtl" : "auto"} style={{ color: l.startsWith("💭") ? "var(--ink-500)" : "var(--ink-700)", whiteSpace: "pre-wrap", marginBottom: 2 }}>{l}</div>
            ))}
      </div>
      <p style={{ marginTop: 6, fontSize: 11, color: "var(--ink-400)" }}>Claude רץ מקומית עם הרישוי שלך — קורא/מחפש בקוד. אפשר לעבור לטאב אחר, זה ימשיך לרוץ.</p>
    </div>
  );
};

const Card = ({ children, tone }: { children: React.ReactNode; tone?: "crit" | "ok" | "plain" }) => (
  <div style={{
    border: `1px solid ${tone === "crit" ? "var(--status-critical)" : "var(--border-hairline)"}`,
    borderRadius: 12, padding: "14px 16px", marginBottom: 12,
    background: tone === "ok" ? "var(--status-healthy-bg, var(--surface))" : "var(--surface)",
  }}>{children}</div>
);

export function WorkflowTab({ d, reload, goToTab }: {
  d: WorkItemDetail; reload: () => void; goToTab: (t: string) => void;
}) {
  const wi = d.workitem;
  const clientId = wi.clientId;
  const [step, setStep] = useState<Step>("resting");
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; email: string; displayName: string }[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [assess, setAssess] = useState<AssessResult | null>(null);
  const [tasks, setTasks] = useState<BreakdownResult["tasks"]>([]);
  const [edited, setEdited] = useState<Record<string, { intent: string; appetite: string }>>({});
  const [build, setBuild] = useState<StartBuildResult | null>(null);
  const [copied, setCopied] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);

  const isOpenGap = (g: { state: string }) => g.state === "proposed" || g.state === "verified";
  const openGaps = d.gaps.filter(isOpenGap).length;
  const openBlockingGaps = d.gaps.filter((g) => g.blocking && isOpenGap(g)).length;
  const aiTasks = d.tasks.filter((t) => t.origin === "ai" && t.state !== "dropped");
  const pendingTasks = aiTasks.filter((t) => !t.approvedAt);
  const assessNote = [...d.events].reverse().find(
    (e) => e.type === "note.added" && typeof e.payload.body === "string" && (e.payload.body as string).startsWith("סיכום Claude"),
  );
  const hasAssessed = !!assessNote || !!assess;

  useEffect(() => { if (step === "assign" && users.length === 0) getUsers().then((r) => setUsers(r.users)).catch(() => {}); }, [step, users.length]);
  useEffect(() => { if (step === "build" && !build) startBuilding(wi.id).then(setBuild).catch((e) => setErr(String(e))); }, [step, build, wi.id]);

  useEffect(() => {
    if (step !== "assessing" && step !== "breaking") return;
    setLogLines([]);
    let alive = true;
    const tick = () => getFlowProgress(wi.id).then((p) => { if (alive && p) setLogLines(p.lines); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, [step, wi.id]);

  const copy = (t: string, k: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  const doAssess = async () => {
    setStep("assessing"); setErr(null);
    try { const r = await assessRequirement(wi.id); setAssess(r); setStep("resting"); reload(); }
    catch (e) { setErr(String(e)); setStep("resting"); }
  };
  const doBreakdown = async () => {
    setStep("breaking"); setErr(null);
    try { const r = await breakdownRequirement(wi.id); setTasks(r.tasks); setStep(r.tasks.length ? "tasks" : "resting"); reload(); }
    catch (e) { setErr(String(e)); setStep("resting"); }
  };
  const doAssign = async () => {
    setErr(null);
    try {
      await assignRequirement(wi.id, assignTo ? { ownerId: assignTo } : { email: assignEmail.trim() });
      setStep("resting"); reload();
    } catch (e) { setErr(String(e)); }
  };

  const Err = () => (err ? <p style={{ color: "var(--status-critical)", fontSize: 12.5, marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</p> : null);

  /* ── takeover views while an async step runs ─────────────────────── */
  if (step === "assessing") return <LiveLog label="Claude קורא את הדרישה ואת ה-repo, מסכם ומעריך…" lines={logLines} />;
  if (step === "breaking") return <LiveLog label="Claude מפרק את הדרישה למשימות…" lines={logLines} />;

  if (step === "assign") return (
    <Card>
      <h3 style={{ fontSize: 15, fontWeight: 650, marginBottom: 12 }}>העברה למשתמש אחר</h3>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>משתמש קיים</label>
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">— בחר —</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>או אימייל חדש</label>
        <input value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="name@altshuler.co.il" dir="ltr" style={{ width: "100%" }} />
      </div>
      <Err />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={!assignTo && !assignEmail.trim()} onClick={doAssign}>העבר</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setStep("resting")}>ביטול</button>
      </div>
    </Card>
  );

  if (step === "tasks") return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>אישור משימות ({tasks.length})</h3>
      <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 12 }}>אשר / ערוך / דחה כל משימה. רק משימות מאושרות נכנסות לתוכנית.</p>
      <div style={{ display: "grid", gap: 10 }}>
        {tasks.map((t) => {
          const e = edited[t.id] ?? { intent: t.intent, appetite: t.appetite };
          return (
            <Card key={t.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-400)" }}>{t.seq}</span>
                <input value={e.intent} onChange={(ev) => setEdited({ ...edited, [t.id]: { ...e, intent: ev.target.value } })} style={{ flex: 1, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--border-hairline)", borderRadius: 6 }} />
                <select value={e.appetite} onChange={(ev) => setEdited({ ...edited, [t.id]: { ...e, appetite: ev.target.value } })} style={{ fontSize: 12 }}>
                  <option value="small">small</option><option value="standard">standard</option><option value="large">large</option>
                </select>
              </div>
              {(t.affectedPaths.length > 0 || t.dependsOnSeq.length > 0) && (
                <div style={{ fontSize: 11, color: "var(--ink-400)", marginBottom: 8 }}>
                  {t.dependsOnSeq.length > 0 && <span>תלוי ב: {t.dependsOnSeq.join(", ")} · </span>}
                  {t.affectedPaths.length > 0 && <span dir="ltr">{t.affectedPaths.join(", ")}</span>}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={async () => {
                  await approveTask(t.id, { clientId, intent: e.intent, appetite: e.appetite as "small" | "standard" | "large" });
                  setTasks((ts) => ts.filter((x) => x.id !== t.id)); reload();
                }}>אשר</button>
                <button className="btn btn-secondary btn-sm" onClick={async () => {
                  await rejectTask(t.id, clientId); setTasks((ts) => ts.filter((x) => x.id !== t.id)); reload();
                }}>דחה</button>
              </div>
            </Card>
          );
        })}
        {tasks.length === 0 && <div className="empty">כל המשימות טופלו.</div>}
      </div>
      <Err />
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {tasks.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={async () => {
            for (const t of tasks) {
              const e = edited[t.id] ?? { intent: t.intent, appetite: t.appetite };
              await approveTask(t.id, { clientId, intent: e.intent, appetite: e.appetite as "small" | "standard" | "large" });
            }
            setTasks([]); reload();
          }}>אשר הכל</button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => { setStep("resting"); goToTab("Tasks"); }}>לטאב המשימות ←</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setStep("build")}>המשך להתחלת עבודה ←</button>
      </div>
    </div>
  );

  if (step === "build") return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>מתחילים לעבוד</h3>
      {!build ? <div className="spin">מכין…</div> : (
        <Card>
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>פותחים branch לפי המוסכמה ומריצים Claude Code בתוך ה-repo.</p>
          {build.startedWithOpenBlocker && <div className="callout crit" style={{ marginBottom: 12 }}><div className="body"><p className="r">יש {build.openBlockingGaps} פערים חוסמים / {build.openBlockers} חוסמים פתוחים.</p></div></div>}
          {(["key", "branch"] as const).map((k) => (
            <div className="field" key={k} style={{ marginBottom: 10 }}>
              <label>{k === "key" ? "מפתח" : "branch"}</label>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", display: "flex", justifyContent: "space-between" }}>
                <span>{build[k]}</span>
                <a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(build[k], k)}>{copied === k ? "✓" : "העתק"}</a>
              </div>
            </div>
          ))}
          <div className="field" style={{ marginBottom: 10 }}>
            <label>repository</label>
            {build.repos.length === 0
              ? <p style={{ fontSize: 12, color: "var(--status-critical)" }}>אין repository מקושר.</p>
              : build.repos.map((r) => <div key={r.name} style={{ fontSize: 12.5, direction: "ltr" }}>{r.name}{r.adoRepoRef ? ` — ${r.adoRepoRef}` : ""}</div>)}
          </div>
          <div className="field">
            <label>הפקודה</label>
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", whiteSpace: "pre-wrap" }}>{`git checkout -b ${build.branch}\nclaude`}</div>
            <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>ה-SessionStart hook יטען את ה-Context Brief אוטומטית.</span>
          </div>
          <div style={{ marginTop: 14 }}><button className="btn btn-secondary btn-sm" onClick={() => setStep("resting")}>חזרה</button></div>
        </Card>
      )}
    </div>
  );

  /* ── resting: a status hub derived from the requirement's state ───── */
  const summary = assess
    ? { title: assess.title, body: `${assess.summary}\n\n${assess.rationale}`, baked: assess.baked }
    : assessNote
      ? { title: null as string | null, body: (assessNote.payload.body as string).replace(/^סיכום Claude:\n/, ""), baked: !(assessNote.payload.body as string).includes("לא אפוי") }
      : null;

  return (
    <div>
      {/* 1. not started yet → choose a path */}
      {!hasAssessed && aiTasks.length === 0 && wi.phase !== "building" && (
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>איך ממשיכים?</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>בחר מסלול לדרישה הזו.</p>
          <div style={{ display: "grid", gap: 10 }}>
            <button className="btn btn-primary" style={{ padding: 14, textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 3 }} onClick={doAssess}>
              <span style={{ fontWeight: 650, fontSize: 13.5 }}>✦ המשך עם AI</span>
              <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>Claude קורא את הדרישה ואת ה-repo, מסכם בעברית, ובודק אם היא אפויה או שיש פערים</span>
            </button>
            <button className="btn btn-secondary" style={{ padding: 14, textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 3 }} onClick={() => setStep("assign")}>
              <span style={{ fontWeight: 650, fontSize: 13.5 }}>👤 העבר למשתמש אחר</span>
              <span style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 400 }}>מישהו אחר ייקח את הדרישה מכאן</span>
            </button>
          </div>
          <Err />
        </Card>
      )}

      {/* 2. assessment summary */}
      {summary && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <h3 style={{ fontSize: 14.5, fontWeight: 650 }}>הערכת AI</h3>
            <a className="link" style={{ fontSize: 11.5 }} onClick={doAssess}>הרץ הערכה מחדש</a>
          </div>
          {summary.title && <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{summary.title}</p>}
          <p style={{ fontSize: 12.5, color: "var(--ink-600)", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{summary.body}</p>
          <div style={{ marginTop: 8 }}>
            {summary.baked ? <Pill tone="healthy">אפויה — מוכנה לפירוק</Pill> : <Pill tone="warning">לא אפויה — צריך הכרעה בפערים</Pill>}
          </div>
          <Err />
        </Card>
      )}

      {/* 3. gaps status */}
      {openGaps > 0 && (
        <Card tone={openBlockingGaps > 0 ? "crit" : "plain"}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            {openBlockingGaps > 0
              ? `${openBlockingGaps} פערים חוסמים פתוחים — צריך להכריע בהם כדי להתקדם.`
              : `${openGaps} פערים לא-חוסמים פתוחים. אפשר להתקדם גם ככה, או לסגור אותם קודם.`}
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => goToTab("Gaps & Blockers")}>לטיפול בפערים ←</button>
        </Card>
      )}

      {/* 4. breakdown into tasks */}
      {hasAssessed && aiTasks.length === 0 && (
        <Card>
          <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>פירוק למשימות</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 10 }}>
            {openBlockingGaps > 0
              ? "אפשר לפרק גם עם פערים חוסמים פתוחים, אבל עדיף לסגור אותם קודם."
              : "Claude יפרק את הדרישה למשימות עם תלויות — ואז תאשר כל אחת."}
          </p>
          <button className="btn btn-primary btn-sm" onClick={doBreakdown}>פרק למשימות</button>
          <Err />
        </Card>
      )}

      {/* 5. task approval pending */}
      {pendingTasks.length > 0 && (
        <Card tone="crit">
          <p style={{ fontSize: 13, marginBottom: 8 }}>{pendingTasks.length} משימות ממתינות לאישור שלך.</p>
          <button className="btn btn-primary btn-sm" onClick={() => goToTab("Tasks")}>לאישור המשימות ←</button>
        </Card>
      )}

      {/* 6. start work */}
      {(aiTasks.length > 0 && pendingTasks.length === 0) || wi.phase === "building" ? (
        <Card tone="ok">
          <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>מוכן להתחלת עבודה</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 10 }}>המשימות אושרו. קבל את פקודת ה-branch וה-Claude Code.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setStep("build")}>הצג הוראות התחלה</button>
        </Card>
      ) : null}
    </div>
  );
}

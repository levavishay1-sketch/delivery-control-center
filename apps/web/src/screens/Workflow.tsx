import { useEffect, useState } from "react";
import {
  approveTask, assessRequirement, assignRequirement, breakdownRequirement, getUsers,
  rejectTask, startBuilding,
  type AssessResult, type BreakdownResult, type StartBuildResult,
} from "../api.ts";
import { Pill } from "../ui.tsx";

/**
 * "▶ התחל עבודה" — the guided flow from a ready requirement:
 *   choose → (assign to a person)  OR  (continue with AI)
 *   AI: assess (translate + baked?) → gaps to resolve  OR  breakdown → approve each task → build instructions
 * The AI steps run the local `claude` CLI, so they can take 1-3 minutes.
 */

type Step = "choose" | "assign" | "assessing" | "assessed" | "breaking" | "tasks" | "build";

const Overlay = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
  <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", zIndex: 100 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(620px, 100%)", padding: "24px 26px", maxHeight: "86vh", overflowY: "auto" }}>
      {children}
    </div>
  </div>
);

const Spinner = ({ label }: { label: string }) => (
  <div style={{ textAlign: "center", padding: "28px 0" }}>
    <div className="spin" style={{ display: "inline-block" }} />
    <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-500)" }}>{label}</p>
    <p style={{ marginTop: 4, fontSize: 11, color: "var(--ink-400)" }}>Claude רץ מקומית — יכול לקחת 1-3 דקות</p>
  </div>
);

export function WorkflowModal({ workitemId, clientId, phase, onClose, onChanged }: {
  workitemId: string; clientId: string; phase: string; onClose: () => void; onChanged: () => void;
}) {
  const alreadyBuilding = phase === "building";
  const [step, setStep] = useState<Step>("choose");
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; email: string; displayName: string }[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [assess, setAssess] = useState<AssessResult | null>(null);
  const [tasks, setTasks] = useState<BreakdownResult["tasks"]>([]);
  const [edited, setEdited] = useState<Record<string, { intent: string; appetite: string }>>({});
  const [build, setBuild] = useState<StartBuildResult | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => { if (step === "assign") getUsers().then((r) => setUsers(r.users)).catch(() => {}); }, [step]);
  useEffect(() => { if (step === "build" && !build) startBuilding(workitemId).then(setBuild).catch((e) => setErr(String(e))); }, [step]);

  const copy = (t: string, k: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  const doAssess = async () => {
    setStep("assessing"); setErr(null);
    try { const r = await assessRequirement(workitemId); setAssess(r); setStep("assessed"); onChanged(); }
    catch (e) { setErr(String(e)); setStep("choose"); }
  };
  const doBreakdown = async () => {
    setStep("breaking"); setErr(null);
    try { const r = await breakdownRequirement(workitemId); setTasks(r.tasks); setStep("tasks"); onChanged(); }
    catch (e) { setErr(String(e)); setStep("assessed"); }
  };
  const doAssign = async () => {
    setErr(null);
    try {
      await assignRequirement(workitemId, assignTo ? { ownerId: assignTo } : { email: assignEmail.trim() });
      onChanged(); onClose();
    } catch (e) { setErr(String(e)); }
  };

  const Err = () => (err ? <p style={{ color: "var(--status-critical)", fontSize: 12.5, marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</p> : null);

  return (
    <Overlay onClose={onClose}>
      {step === "choose" && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 650, marginBottom: 6 }}>איך ממשיכים?</h2>
          <p style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 20 }}>הדרישה מוכנה לטיפול. בחר מסלול.</p>
          <div style={{ display: "grid", gap: 12 }}>
            <button className="btn btn-secondary" style={{ padding: "16px", textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 4 }} onClick={() => setStep("assign")}>
              <span style={{ fontWeight: 650, fontSize: 14 }}>👤 העבר למשתמש אחר</span>
              <span style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 400 }}>מישהו אחר ייקח את המשימה מכאן</span>
            </button>
            <button className="btn btn-primary" style={{ padding: "16px", textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 4 }} onClick={doAssess}>
              <span style={{ fontWeight: 650, fontSize: 14 }}>✦ המשך עם AI</span>
              <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>Claude יתרגם לאנגלית, יבדוק מול ה-repo אם הדרישה אפויה, ואם כן — יפרק למשימות</span>
            </button>
            {alreadyBuilding && (
              <button className="btn btn-ghost" style={{ fontSize: 12.5, color: "var(--ink-500)" }} onClick={() => setStep("build")}>
                📋 הדרישה כבר ב-building — הצג הוראות התחלה
              </button>
            )}
          </div>
          <Err />
        </>
      )}

      {step === "assign" && (
        <>
          <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 14 }}>העברה למשתמש</h2>
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
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" disabled={!assignTo && !assignEmail.trim()} onClick={doAssign}>העבר</button>
            <button className="btn btn-secondary" onClick={() => setStep("choose")}>חזרה</button>
          </div>
        </>
      )}

      {step === "assessing" && <Spinner label="Claude קורא את הדרישה ואת ה-repo, מתרגם ומעריך…" />}
      {step === "breaking" && <Spinner label="Claude מפרק את הדרישה למשימות…" />}

      {step === "assessed" && assess && (
        <>
          <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 4 }}>{assess.title}</h2>
          <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>{assess.summary}</p>
          <div style={{ marginBottom: 12 }}>
            {assess.baked
              ? <Pill tone="healthy">הדרישה אפויה — מוכנה לפירוק</Pill>
              : <Pill tone="warning">לא אפויה — צריך אינטראקציה איתך</Pill>}
            {assess.repoUsed && <span style={{ fontSize: 11, color: "var(--ink-400)", marginInlineStart: 8 }}>נבדק מול {assess.repoUsed}</span>}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14, whiteSpace: "pre-wrap" }}>{assess.rationale}</p>

          {assess.gaps.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p className="section-lbl">פערים שזוהו ({assess.gaps.length})</p>
              <div className="rowlist">
                {assess.gaps.map((g, i) => (
                  <div className="row" key={i} style={{ alignItems: "flex-start" }}>
                    <span style={{ flex: 1, fontSize: 12.5 }}>{g.description}</span>
                    {g.blocking ? <Pill tone="critical">חוסם</Pill> : <Pill tone="inactive">לא חוסם</Pill>}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 8 }}>הפערים נוספו כ-Gaps. טפל בהם בטאב "Gaps &amp; Blockers", ואז חזור לכאן.</p>
            </div>
          )}

          <Err />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {assess.baked
              ? <button className="btn btn-primary" onClick={doBreakdown}>פרק למשימות ←</button>
              : <button className="btn btn-primary" onClick={onClose}>לטיפול בפערים</button>}
            {assess.baked && <button className="btn btn-secondary" onClick={doBreakdown}>נסה שוב פירוק</button>}
          </div>
        </>
      )}

      {step === "tasks" && (
        <>
          <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 4 }}>פירוק למשימות ({tasks.length})</h2>
          <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>אשר / ערוך / דחה כל משימה. רק משימות מאושרות נכנסות לתוכנית.</p>
          <div className="rowlist" style={{ maxHeight: "48vh", overflowY: "auto" }}>
            {tasks.map((t) => {
              const e = edited[t.id] ?? { intent: t.intent, appetite: t.appetite };
              return (
                <div className="row" key={t.id} style={{ alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-400)" }}>{t.seq}</span>
                    <input value={e.intent} onChange={(ev) => setEdited({ ...edited, [t.id]: { ...e, intent: ev.target.value } })} style={{ flex: 1, fontSize: 12.5, padding: "5px 8px", border: "1px solid var(--border-hairline)", borderRadius: 6 }} />
                    <select value={e.appetite} onChange={(ev) => setEdited({ ...edited, [t.id]: { ...e, appetite: ev.target.value } })} style={{ fontSize: 12 }}>
                      <option value="small">small</option><option value="standard">standard</option><option value="large">large</option>
                    </select>
                  </div>
                  {(t.affectedPaths.length > 0 || t.dependsOnSeq.length > 0) && (
                    <div style={{ fontSize: 11, color: "var(--ink-400)", paddingInlineStart: 24 }}>
                      {t.dependsOnSeq.length > 0 && <span>תלוי ב: {t.dependsOnSeq.join(", ")} · </span>}
                      {t.affectedPaths.length > 0 && <span dir="ltr">{t.affectedPaths.join(", ")}</span>}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, paddingInlineStart: 24 }}>
                    <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--status-healthy)" }} onClick={async () => {
                      await approveTask(t.id, { clientId, intent: e.intent, appetite: e.appetite as "small" | "standard" | "large" });
                      setTasks((ts) => ts.filter((x) => x.id !== t.id)); onChanged();
                    }}>אשר</a>
                    <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--status-critical)" }} onClick={async () => {
                      await rejectTask(t.id, clientId); setTasks((ts) => ts.filter((x) => x.id !== t.id)); onChanged();
                    }}>דחה</a>
                  </div>
                </div>
              );
            })}
            {tasks.length === 0 && <div className="empty">כל המשימות טופלו.</div>}
          </div>
          <Err />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {tasks.length > 0 && (
              <button className="btn btn-primary" onClick={async () => {
                for (const t of tasks) {
                  const e = edited[t.id] ?? { intent: t.intent, appetite: t.appetite };
                  await approveTask(t.id, { clientId, intent: e.intent, appetite: e.appetite as "small" | "standard" | "large" });
                }
                setTasks([]); onChanged();
              }}>אשר הכל</button>
            )}
            <button className="btn btn-secondary" onClick={() => setStep("build")}>המשך להתחלת עבודה ←</button>
          </div>
        </>
      )}

      {step === "build" && (
        <>
          <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 6 }}>מתחילים לעבוד</h2>
          {!build ? <Spinner label="מכין…" /> : (
            <>
              <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>הדרישה ב-<b>building</b>. פותחים branch לפי המוסכמה ומריצים Claude Code בתוך ה-repo.</p>
              {build.startedWithOpenBlocker && <div className="callout crit" style={{ marginBottom: 12 }}><div className="body"><p className="r">יש {build.openBlockingGaps} פערים חוסמים / {build.openBlockers} חוסמים פתוחים.</p></div></div>}
              {["key", "branch"].map((k) => (
                <div className="field" key={k} style={{ marginBottom: 10 }}>
                  <label>{k === "key" ? "מפתח" : "branch"}</label>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", display: "flex", justifyContent: "space-between" }}>
                    <span>{k === "key" ? build.key : build.branch}</span>
                    <a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(k === "key" ? build.key : build.branch, k)}>{copied === k ? "✓" : "העתק"}</a>
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
              <div style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={onClose}>סגור</button></div>
            </>
          )}
        </>
      )}
    </Overlay>
  );
}

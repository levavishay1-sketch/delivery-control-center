import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveTask, assignRequirement, getFlowRun, getTaskFlow, getUsers, materializeTasks,
  rejectTask, startAssess, startBreakdown, startBuilding,
  ADO_LADDER, type FlowRun, type MaterializeResult, type StartBuildResult, type TaskFlow, type WorkItemDetail,
} from "../api.ts";
import { Pill } from "../ui.tsx";
import { TaskGraph } from "./TaskGraph.tsx";

/**
 * "מהלך עבודה" — the gated wizard for one requirement.
 *
 * A requirement is a DCC-ONLY pre-stage; it is never pushed to TFS. Its
 * TASKS are the tracked work items, and the depth of the approved task
 * tree picks their types off the Agile ladder (Epic > Feature > User
 * Story > Task) when step 4 materialises them.
 *
 * Steps unlock in order — you cannot break down while blocking gaps are
 * open, and you cannot start work before the tasks exist in TFS.
 */

const STEPS = [
  { key: "assess", label: "בדיקת אפייה" },
  { key: "gaps", label: "פערים" },
  { key: "breakdown", label: "פירוק למשימות" },
  { key: "approve", label: "אישור והקמה" },
  { key: "start", label: "התחלת עבודה" },
] as const;

const Transcript = ({ lines }: { lines: string[] }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight); }, [lines.length]);
  return (
    <div ref={boxRef} style={{ maxHeight: "42vh", overflowY: "auto", background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.6 }}>
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
    border: `1px solid ${tone === "crit" ? "var(--status-critical)" : "var(--border-hairline)"}`,
    borderRadius: 12, padding: "14px 16px", marginBottom: 12, background: "var(--surface)",
  }}>{children}</div>
);

export function WorkflowTab({ d, reload, goToTab }: {
  d: WorkItemDetail; reload: () => void; goToTab: (t: string) => void;
}) {
  const wi = d.workitem;
  const clientId = wi.clientId;
  const [view, setView] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [taskFlow, setTaskFlow] = useState<TaskFlow | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [users, setUsers] = useState<{ id: string; email: string; displayName: string }[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [edited, setEdited] = useState<Record<string, { intent: string; appetite: string }>>({});
  const [build, setBuild] = useState<StartBuildResult | null>(null);
  const [copied, setCopied] = useState("");
  const [materializing, setMaterializing] = useState(false);
  const [materialized, setMaterialized] = useState<MaterializeResult | null>(null);

  /* ── state of the world ─────────────────────────────────────────── */
  const isOpenGap = (g: { state: string }) => g.state === "proposed" || g.state === "verified";
  const openGaps = d.gaps.filter(isOpenGap).length;
  const openBlockingGaps = d.gaps.filter((g) => g.blocking && isOpenGap(g)).length;
  const assessNote = [...d.events].reverse().find(
    (e) => e.type === "note.added" && typeof e.payload.body === "string" && (e.payload.body as string).startsWith("סיכום Claude"),
  );
  const nodes = taskFlow?.nodes ?? [];
  const pending = nodes.filter((n) => !n.approved);
  const unsynced = nodes.filter((n) => n.approved && !n.linkedAdoId);
  const running = run?.state === "running";

  const done = [
    !!assessNote,
    !!assessNote && openBlockingGaps === 0,
    nodes.length > 0,
    nodes.length > 0 && pending.length === 0 && unsynced.length === 0,
    wi.phase === "building" || wi.phase === "review" || wi.phase === "done",
  ];
  const unlocked = done.map((_, i) => i === 0 || done[i - 1] === true);
  const current = done.findIndex((x) => !x);
  const active = view ?? (current === -1 ? STEPS.length - 1 : current);

  /* ── data ───────────────────────────────────────────────────────── */
  const refreshRun = useCallback(async () => {
    try {
      const r = await getFlowRun(wi.id);
      setRun((prev) => {
        if (prev?.state === "running" && r.state !== "running" && r.state !== "idle") reload();
        return r;
      });
    } catch { /* ignore */ }
  }, [wi.id, reload]);
  const refreshTasks = useCallback(async () => {
    try { setTaskFlow(await getTaskFlow(wi.id)); } catch { /* ignore */ }
  }, [wi.id]);

  useEffect(() => { refreshRun(); refreshTasks(); }, [refreshRun, refreshTasks]);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(refreshRun, 1500);
    return () => clearInterval(iv);
  }, [running, refreshRun]);
  useEffect(() => { if (assignOpen && users.length === 0) getUsers().then((r) => setUsers(r.users)).catch(() => {}); }, [assignOpen, users.length]);
  useEffect(() => { if (active === 4 && !build) startBuilding(wi.id).then(setBuild).catch((e) => setErr(String(e))); }, [active, build, wi.id]);

  const copy = (t: string, k: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  const kick = async (what: "assess" | "breakdown") => {
    setErr(null);
    try {
      await (what === "assess" ? startAssess(wi.id) : startBreakdown(wi.id));
      setShowLog(true); await refreshRun();
    } catch (e) { setErr(String(e)); }
  };
  const doAssign = async () => {
    setErr(null);
    try {
      await assignRequirement(wi.id, assignTo ? { ownerId: assignTo } : { email: assignEmail.trim() });
      setAssignOpen(false); reload();
    } catch (e) { setErr(String(e)); }
  };
  const approve = async (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const e = edited[id] ?? { intent: n?.intent ?? "", appetite: n?.appetite ?? "standard" };
    await approveTask(id, { clientId, intent: e.intent, appetite: e.appetite as "small" | "standard" | "large" });
    await refreshTasks(); reload();
  };
  const doMaterialize = async () => {
    setErr(null); setMaterializing(true);
    try { setMaterialized(await materializeTasks(wi.id)); await refreshTasks(); reload(); }
    catch (e) { setErr(String(e)); }
    setMaterializing(false);
  };

  const Err = () => (err ? <p style={{ color: "var(--status-critical)", fontSize: 12.5, marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</p> : null);

  /* ── a run in progress takes over ───────────────────────────────── */
  if (running) {
    return (
      <div>
        <StepRail steps={STEPS} done={done} unlocked={unlocked} active={run?.kind === "breakdown" ? 2 : 0} onPick={() => {}} busy />
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 10px" }}>
          <div className="spin" style={{ display: "inline-block", width: 16, height: 16 }} />
          <p style={{ fontSize: 13, color: "var(--ink-600)", margin: 0 }}>
            {run?.kind === "breakdown" ? "Claude מפרק את הדרישה למשימות…" : "Claude קורא את הדרישה ואת ה-repo, מסכם ומעריך…"}
          </p>
        </div>
        <Transcript lines={run?.lines ?? []} />
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--ink-400)" }}>
          רץ ברקע עם הרישוי שלך. אפשר לצאת מהמסך — כשתחזור זה יהיה כאן, כולל כל מה ש-Claude עשה.
        </p>
      </div>
    );
  }

  return (
    <div>
      <StepRail steps={STEPS} done={done} unlocked={unlocked} active={active} onPick={(i) => { if (unlocked[i]) { setView(i); setErr(null); } }} />

      {run && (run.state === "done" || run.state === "error") && run.lines.length > 0 && (
        <div style={{ margin: "14px 0" }}>
          <a className="link" style={{ fontSize: 12 }} onClick={() => setShowLog((v) => !v)}>
            {showLog ? "▲ הסתר" : "▼ הצג"} מה Claude עשה בהרצה האחרונה ({run.kind === "breakdown" ? "פירוק" : "הערכה"}{run.state === "error" ? " — נכשלה" : ""})
          </a>
          {showLog && <div style={{ marginTop: 8 }}><Transcript lines={run.lines} /></div>}
          {run.state === "error" && run.error && <p style={{ fontSize: 12, color: "var(--status-critical)", marginTop: 6 }}>{run.error}</p>}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {/* ── 1. assess ───────────────────────────────────────────── */}
        {active === 0 && (
          <>
            {assessNote ? (
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <h3 style={{ fontSize: 14.5, fontWeight: 650 }}>מה Claude הבין ומה הוא חושב</h3>
                  <a className="link" style={{ fontSize: 11.5 }} onClick={() => kick("assess")}>הרץ הערכה מחדש</a>
                </div>
                <p style={{ fontSize: 12.5, color: "var(--ink-600)", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
                  {(assessNote.payload.body as string).replace(/^סיכום Claude:\n/, "")}
                </p>
                <div style={{ marginTop: 8 }}>
                  {(assessNote.payload.body as string).includes("לא אפוי")
                    ? <Pill tone="warning">לא אפויה — צריך הכרעה בפערים</Pill>
                    : <Pill tone="healthy">אפויה — מוכנה לפירוק</Pill>}
                </div>
                {done[1] && <div style={{ marginTop: 12 }}><button className="btn btn-primary btn-sm" onClick={() => setView(2)}>לפירוק למשימות ←</button></div>}
                {!done[1] && <div style={{ marginTop: 12 }}><button className="btn btn-primary btn-sm" onClick={() => setView(1)}>לשלב הפערים ←</button></div>}
                <Err />
              </Card>
            ) : (
              <Card>
                <h3 style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>איך ממשיכים?</h3>
                <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>
                  הדרישה קיימת רק כאן ב-DCC. Claude יקרא אותה ואת ה-repo ויגיד אם היא אפויה מספיק לפירוק.
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  <button className="btn btn-primary" style={{ padding: 14, textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 3 }} onClick={() => kick("assess")}>
                    <span style={{ fontWeight: 650, fontSize: 13.5 }}>✦ המשך עם AI</span>
                    <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>מסכם בעברית, בודק אפייה ומזהה פערים. רץ ברקע.</span>
                  </button>
                  <button className="btn btn-secondary" style={{ padding: 14, textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 3 }} onClick={() => setAssignOpen((v) => !v)}>
                    <span style={{ fontWeight: 650, fontSize: 13.5 }}>👤 העבר למשתמש אחר</span>
                    <span style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 400 }}>מישהו אחר ייקח את הדרישה מכאן</span>
                  </button>
                </div>
                {assignOpen && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-hairline)" }}>
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>משתמש קיים</label>
                      <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                        <option value="">— בחר —</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}
                      </select>
                    </div>
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>או אימייל חדש</label>
                      <input value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="name@altshuler.co.il" dir="ltr" style={{ width: "100%" }} />
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={!assignTo && !assignEmail.trim()} onClick={doAssign}>העבר</button>
                  </div>
                )}
                <Err />
              </Card>
            )}
          </>
        )}

        {/* ── 2. gaps ─────────────────────────────────────────────── */}
        {active === 1 && (
          <Card tone={openBlockingGaps > 0 ? "crit" : undefined}>
            <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>פערים</h3>
            {openBlockingGaps > 0 ? (
              <>
                <p style={{ fontSize: 13, marginBottom: 4 }}>{openBlockingGaps} פערים חוסמים פתוחים.</p>
                <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 10 }}>
                  צריך להכריע בכל אחד (ענה / לא פער / דרישה נפרדת) לפני שאפשר לפרק למשימות. הפירוק חסום עד אז.
                </p>
              </>
            ) : openGaps > 0 ? (
              <p style={{ fontSize: 13, marginBottom: 10 }}>אין פערים חוסמים. {openGaps} לא-חוסמים עדיין פתוחים — אפשר להתקדם גם ככה.</p>
            ) : (
              <p style={{ fontSize: 13, marginBottom: 10 }}>כל הפערים טופלו.</p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => goToTab("Gaps & Blockers")}>לטאב הפערים ←</button>
              {done[1] && <button className="btn btn-primary btn-sm" onClick={() => setView(2)}>לפירוק למשימות ←</button>}
            </div>
          </Card>
        )}

        {/* ── 3. breakdown ────────────────────────────────────────── */}
        {active === 2 && (
          <>
            <Card>
              <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>פירוק למשימות</h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 4 }}>
                Claude יפרק את הדרישה להיררכיה של משימות עם תלויות. <b>עומק ההיררכיה קובע את הטיפוסים ב-TFS</b>:
              </p>
              <div style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 10, background: "var(--surface-muted)", borderRadius: 8, padding: "8px 10px" }}>
                {ADO_LADDER.map((_, i) => ADO_LADDER.length - 1 - i).map((depth) => (
                  <div key={depth} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 2 }}>
                    <span style={{ minWidth: 58 }}>עומק {depth + 1}</span>
                    <span dir="ltr" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{ADO_LADDER.slice(ADO_LADDER.length - 1 - depth).join(" › ")}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => kick("breakdown")}>{nodes.length > 0 ? "פרק מחדש" : "פרק למשימות"}</button>
                {nodes.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setView(3)}>לאישור המשימות ←</button>}
              </div>
              <Err />
            </Card>
            {taskFlow && nodes.length > 0 && (
              <Card>
                <p className="section-lbl" style={{ marginBottom: 8 }}>
                  ההיררכיה שהוצעה — עומק {taskFlow.depth} ({ADO_LADDER.slice(ADO_LADDER.length - taskFlow.depth).join(" › ")})
                </p>
                <TaskGraph flow={taskFlow} />
              </Card>
            )}
          </>
        )}

        {/* ── 4. approve + materialize ────────────────────────────── */}
        {active === 3 && taskFlow && (
          <>
            <Card tone={pending.length > 0 ? "crit" : undefined}>
              <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>אישור והקמה ב-TFS</h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 10 }}>
                {pending.length > 0
                  ? `${pending.length} מתוך ${nodes.length} ממתינות לאישור שלך. אחרי שהכל מאושר — ההקמה ב-TFS.`
                  : unsynced.length > 0
                    ? `כל ${nodes.length} המשימות מאושרות. אפשר להקים אותן ב-TFS עם ההיררכיה והתלויות.`
                    : `כל המשימות הוקמו ב-TFS.`}
              </p>
              {pending.length === 0 && unsynced.length > 0 && (
                <button className="btn btn-primary btn-sm" disabled={materializing} onClick={doMaterialize}>
                  {materializing ? "מקים ב-TFS…" : `הקם ${unsynced.length} פריטים ב-TFS`}
                </button>
              )}
              {materialized && <p style={{ fontSize: 12, color: "var(--status-healthy)", marginTop: 8 }}>{materialized.detail}</p>}
              {unsynced.length === 0 && nodes.length > 0 && (
                <button className="btn btn-primary btn-sm" onClick={() => setView(4)}>להתחלת עבודה ←</button>
              )}
              <Err />
            </Card>

            <Card>
              <p className="section-lbl" style={{ marginBottom: 8 }}>
                עומק {taskFlow.depth} ({ADO_LADDER.slice(ADO_LADDER.length - taskFlow.depth).join(" › ")})
              </p>
              <TaskGraph flow={taskFlow} height={320} />
            </Card>

            <div style={{ display: "grid", gap: 8 }}>
              {[...nodes].sort((a, b) => a.level - b.level || a.seq - b.seq).map((n) => {
                const e = edited[n.id] ?? { intent: n.intent, appetite: n.appetite };
                return (
                  <div key={n.id} style={{
                    border: `1px solid ${n.approved ? "var(--border-hairline)" : "var(--status-warning, #b45309)"}`,
                    borderRadius: 10, padding: "10px 12px", background: "var(--surface)",
                    marginInlineStart: n.level * 22,
                  }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-400)" }}>#{n.seq}</span>
                      <Pill tone={n.adoType === "Task" ? "inactive" : "ai"}>{n.adoType ?? "Task"}</Pill>
                      {n.linkedAdoId
                        ? <a href={n.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--status-healthy)" }}>TFS #{n.linkedAdoId} ↗</a>
                        : n.approved ? <Pill tone="healthy">מאושר</Pill> : <Pill tone="warning">ממתין לאישור</Pill>}
                    </div>
                    {n.linkedAdoId ? (
                      <div style={{ fontSize: 12.5 }}>{n.intent}</div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                          <input value={e.intent} onChange={(ev) => setEdited({ ...edited, [n.id]: { ...e, intent: ev.target.value } })} style={{ flex: 1, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--border-hairline)", borderRadius: 6 }} />
                          <select value={e.appetite} onChange={(ev) => setEdited({ ...edited, [n.id]: { ...e, appetite: ev.target.value } })} style={{ fontSize: 12 }}>
                            <option value="small">small</option><option value="standard">standard</option><option value="large">large</option>
                          </select>
                        </div>
                        {n.affectedPaths.length > 0 && (
                          <div style={{ fontSize: 11, color: "var(--ink-400)", marginBottom: 8 }} dir="ltr">{n.affectedPaths.join(", ")}</div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          {!n.approved && <button className="btn btn-primary btn-sm" onClick={() => approve(n.id)}>אשר</button>}
                          {n.approved && <button className="btn btn-secondary btn-sm" onClick={() => approve(n.id)}>שמור שינוי</button>}
                          <button className="btn btn-secondary btn-sm" onClick={async () => { await rejectTask(n.id, clientId); await refreshTasks(); reload(); }}>דחה</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {pending.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" onClick={async () => {
                  for (const n of pending) await approve(n.id);
                }}>אשר את כל {pending.length} המשימות</button>
              </div>
            )}
          </>
        )}

        {/* ── 5. start ────────────────────────────────────────────── */}
        {active === 4 && (
          <Card tone="ok">
            <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>מתחילים לעבוד</h3>
            {!build ? <div className="spin">מכין…</div> : (
              <>
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
                <Err />
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── the step rail ─────────────────────────────────────────────────── */

function StepRail({ steps, done, unlocked, active, onPick, busy }: {
  steps: readonly { key: string; label: string }[];
  done: boolean[]; unlocked: boolean[]; active: number;
  onPick: (i: number) => void; busy?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch" }}>
      {steps.map((s, i) => {
        const isDone = done[i] === true;
        const open = unlocked[i] === true;
        const isActive = i === active;
        return (
          <button
            key={s.key}
            onClick={() => onPick(i)}
            disabled={!open || busy}
            title={open ? undefined : "נעול עד שהשלב הקודם יסתיים"}
            style={{
              flex: "1 1 130px", textAlign: "start", cursor: open && !busy ? "pointer" : "default",
              border: `1px solid ${isActive ? "var(--color-accent)" : "var(--border-hairline)"}`,
              background: isActive ? "var(--status-ai-bg, #f5f3ff)" : open ? "var(--surface)" : "var(--surface-muted)",
              opacity: open ? 1 : 0.55,
              borderRadius: 10, padding: "8px 10px", font: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--ink-400)" }}>
              <span>{isDone ? "✓" : open ? "●" : "🔒"}</span>
              <span>שלב {i + 1}</span>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: isActive ? 650 : 500, marginTop: 2, color: isDone ? "var(--status-healthy)" : "var(--ink-800)" }}>
              {s.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

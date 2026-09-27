import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  cancelOnboardingRun, getOnboardingRun, getOnboardingSteps, getRepos, getUsers, listOnboardingRuns, runOnboardingStep, startOnboardingRun, updateOnboardingAutomation,
  type AutomationLevel, type OnboardingCost, type OnboardingEvent, type OnboardingRunSummary, type OnboardingRunView, type OnboardingStep, type OnboardingStepDefinition, type OnboardingStepKey,
} from "../../api.ts";
import { CardTitle, PageHead, Pill } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { useClaudeContext } from "../../claude/context.ts";
import { CoachPanel } from "./coach.tsx";
import { StepCard } from "./steps.tsx";
import { LevelChooser, type Act } from "./shared.tsx";
import { LEVEL_HE, RUN_STATUS_HE, STEP_KIND_CHIP, STEP_STATUS_HE, errText, eventLabel, fmtDate, fmtInt, fmtTime, fmtUsd, shortSha } from "./labels.ts";

/**
 * The repository's dossier (`openspec/changes/repository-coach`): one fixed
 * process of seven steps whose result differs per repository, shown as a
 * stepper with one step card at a time, and a rail with the automation
 * level, the cost, the decision log, the previous runs and — once the
 * repository has a delivered setup — the coach.
 */

export function RepoDossier({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [repoName, setRepoName] = useState("");
  const [runs, setRuns] = useState<OnboardingRunSummary[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<OnboardingRunView | null>(null);
  const [selected, setSelected] = useState<OnboardingStepKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [users, setUsers] = useState<Record<string, string>>({});

  const loadRuns = useCallback(async (pick?: string) => {
    const r = await listOnboardingRuns(id);
    setRuns(r.runs);
    setRunId((cur) => pick ?? cur ?? r.runs[0]?.id ?? null);
  }, [id]);

  useEffect(() => {
    loadRuns().catch((e) => { setErr(errText(e)); setRuns([]); });
    getRepos().then((r) => setRepoName(r.repos.find((x) => x.id === id)?.name ?? "")).catch(() => {});
    getUsers().then((r) => setUsers(Object.fromEntries(r.users.map((u) => [u.id, u.displayName])))).catch(() => {});
  }, [id, loadRuns]);

  // The run moved on by itself or by the person's decision: show the step it moved to, not the one last looked at.
  const currentKey = view?.run.currentStepKey ?? null;
  const currentStatus = view?.steps.find((s) => s.stepKey === currentKey)?.status ?? null;
  useEffect(() => { if (currentKey && currentStatus === "WaitingForUser") setSelected(currentKey); }, [currentKey, currentStatus]);

  const over = useRef(false);
  const screenRef = useRef<(() => string) | null>(null);
  const refresh = useCallback(async () => {
    if (!runId) return;
    const v = await getOnboardingRun(id, runId);
    over.current = v.run.status === "Completed" || v.run.status === "Cancelled";
    setView(v);
  }, [id, runId]);

  useEffect(() => {
    if (!runId) return;
    setView(null);
    over.current = false;
    refresh().catch((e) => setErr(errText(e)));
    const t = window.setInterval(() => { if (!over.current) refresh().catch(() => {}); }, 2500);
    return () => window.clearInterval(t);
  }, [runId, refresh]);

  const waitingStep = view?.steps.find((s) => s.status === "WaitingForUser")?.stepKey ?? null;
  useClaudeContext(view ? {
    screen: "onboarding",
    topic: { kind: "run", id: view.run.id, title: `התיק של ${repoName}` },
    facts: {
      "מאגר": repoName,
      "סוג ההרצה": view.run.kind === "coach" ? "הרצת מאמן" : "הטמעה",
      "מצב ההרצה": RUN_STATUS_HE[view.run.status]?.label ?? view.run.status,
      "צעד נוכחי": view.run.currentStepKey ? (view.definitions.find((d) => d.key === view.run.currentStepKey)?.title_he ?? view.run.currentStepKey) : "—",
      "צעדים שהסתיימו": view.steps.filter((s) => s.status === "Completed").map((s) => view.definitions.find((d) => d.key === s.stepKey)?.title_he ?? s.stepKey),
      "מדרגת האוטומציה": LEVEL_HE[view.automation.level].title,
      "כרטיסים": `${view.components.length} (${view.components.filter((c) => c.status === "proposed").length} מחכים להחלטה)`,
      "עלות ההרצה": fmtUsd(view.cost.totalCostUsd),
      aiCostUsd: view.cost.totalCostUsd,
      status: RUN_STATUS_HE[view.run.status]?.label ?? view.run.status,
    },
    liveFacts: () => ({ "המסך בטרמינל עכשיו": (screenRef.current?.() ?? "").slice(-3500) }),
    suggestions: waitingStep === "plan"
      ? ["אילו כרטיסים מחכים לי ומה כל אחד עושה?", "מה יקרה אם אאשר את הכול?", "למה רכיב מסוים לא מומלץ כאן?", "מה הסוקר אמר שחסר?"]
      : waitingStep === "trial"
        ? ["מה בודקות משימות הניסיון?", "כמה זה יעלה ולמה?", "מי שופט את התוצאה?"]
        : waitingStep === "deliver"
          ? ["מה בדיוק ייכנס ל-PR?", "מה לא נכנס ולמה?", "מה קורה אחרי המסירה?"]
          : ["מה הוא רוצה ממני עכשיו?", "מה נמצא עד עכשיו?", "מה עולה כסף בתהליך הזה?", "איך ממשיכים מכאן?"],
    actions: ["send_to_session", "request_component"],
  } : null);

  const act: Act = async (name, fn) => {
    setBusy(name);
    setErr(null);
    try { const r = await fn(); await refresh(); return r; } catch (e) { setErr(errText(e)); return undefined; } finally { setBusy(null); }
  };

  const crumb = <a style={{ cursor: "pointer" }} onClick={() => nav("#/repositories")}>Repositories</a>;
  const pickRun = (rid: string) => { setShowNew(false); setSelected(null); loadRuns(rid).catch(() => {}); setRunId(rid); };

  if (runs === null) return <div className="spin">טוען…</div>;
  if (runs.length === 0 || showNew) {
    return <PreStart repoId={id} repoName={repoName} crumb={crumb} onCancel={runs.length ? () => setShowNew(false) : undefined} onStarted={pickRun} onError={setErr} err={err} />;
  }
  if (!view) return <div className="spin">טוען…</div>;

  const { run, steps, definitions: defs } = view;
  const runOver = run.status === "Completed" || run.status === "Cancelled";
  const byKey = new Map(steps.map((s) => [s.stepKey, s]));
  const title = (key: string) => defs.find((d) => d.key === key)?.title_he ?? key;
  const settled = steps.filter((s) => s.status === "Completed").length;
  const sel: OnboardingStepKey = selected ?? run.currentStepKey ?? defs[defs.length - 1]!.key;
  const selStep = byKey.get(sel);
  const runnable = (key: OnboardingStepKey) => {
    const s = byKey.get(key);
    if (runOver || run.status === "Running" || !s || !(s.status === "Pending" || s.status === "Failed")) return false;
    return steps.filter((x) => x.stepOrder < s.stepOrder).every((x) => x.status === "Completed");
  };
  const status = RUN_STATUS_HE[run.status];
  const delivered = runs.some((r) => r.status === "Completed");

  return (
    <>
      <PageHead info="page_onboarding_run"
        crumb={crumb}
        title={`התיק של ${view.repo.name}`}
        sub={`${run.kind === "coach" ? "הרצת מאמן" : "הטמעה"} ${run.id.slice(0, 8)} · התחילה ${fmtDate(run.startedAt)}${run.baselineSha ? ` · commit ${shortSha(run.baselineSha)}` : ""}${run.branchName ? ` · ענף ${run.branchName}` : ""}`}
        actions={
          <>
            <Pill tone={status.tone}>{status.label}</Pill>
            {runOver || run.status === "Failed"
              ? <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(true)}>הרצה חדשה…</button>
              : <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => { if (confirm("לבטל את ההרצה? סשן הטיוטה, אם פתוח, ייסגר. העותק המבודד והענף נשארים, שום דבר לא נמחק ושום דבר לא יצא מהמחשב.")) void act("cancel", () => cancelOnboardingRun(id, run.id)); }}>{busy === "cancel" ? "מבטל…" : "בטל הרצה"}</button>}
          </>
        }
      />
      {err && <div className="ob-note crit" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="dash">
        <div style={{ minWidth: 0 }}>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="progress-block" style={{ margin: "0 0 12px" }}>
              <div className="top"><span className="l">{settled} מתוך {defs.length} צעדים הסתיימו<Info k="step_progress" /></span><span>{Math.round((settled / defs.length) * 100)}%</span></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${(settled / defs.length) * 100}%` }} /></div>
            </div>
            <div className="ob-steps" style={{ ["--ob-steps" as string]: defs.length }}>
              {defs.map((d) => {
                const s = byKey.get(d.key);
                const cls = stepClass(s);
                return (
                  <button key={d.key} type="button" className={`ob-step ${cls}${d.key === sel ? " active" : ""}`} onClick={() => setSelected(d.key)} title={d.short_he}>
                    <span className="n"><span className="g">{GLYPH[cls]}</span><span>צעד {d.order + 1}</span></span>
                    <span className="t">{d.title_he}</span>
                    <span className="s">{s ? stepStatusText(s, view) : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selStep && (
            <StepCard
              key={sel}
              def={defs.find((d) => d.key === sel)!}
              step={selStep}
              view={view}
              users={users}
              runnable={runnable(sel)}
              busy={busy}
              act={act}
              onRun={() => void act(`run:${sel}`, () => runOnboardingStep(id, run.id, sel))}
              screenRef={screenRef}
              nav={nav}
            />
          )}
          <p className="ob-sub" style={{ marginTop: 4 }}>שאלות על כל כרטיס, עובדה או צעד — בצ'אט של קלוד (הכפתור למטה משמאל, או Ctrl K). הוא עונה מהתיק עצמו, בלי קריאה למודל כשאפשר.</p>
        </div>

        <div className="rail">
          <AutomationPanel level={view.automation.level} levels={view.levels} busy={busy === "automation"} disabled={runOver} onSave={(level) => void act("automation", () => updateOnboardingAutomation(id, run.id, { level }))} />
          <CostPanel cost={view.cost} title={title} nav={nav} />
          {(delivered || view.coach.openProposals > 0) && <CoachPanel repoId={id} busy={!!busy} onRunStarted={pickRun} onError={setErr} />}
          <EventLogPanel events={view.events} title={title} users={users} />
          <RunsPanel runs={runs} current={run.id} onPick={pickRun} />
        </div>
      </div>
    </>
  );
}

/* ── the stepper ──────────────────────────────────────────────────── */

type StepClass = "pend" | "live" | "wait" | "done" | "fail";
const GLYPH: Record<StepClass, string> = { pend: "○", live: "●", wait: "✋", done: "✓", fail: "✕" };
function stepClass(s: OnboardingStep | undefined): StepClass {
  if (!s) return "pend";
  if (s.status === "Completed") return "done";
  if (s.status === "Running") return "live";
  if (s.status === "WaitingForUser") return "wait";
  if (s.status === "Failed") return "fail";
  return "pend";
}
function stepStatusText(s: OnboardingStep, v: OnboardingRunView): string {
  if (s.stepKey === "plan" && s.status === "WaitingForUser") {
    const proposed = v.components.filter((c) => c.status === "proposed").length;
    return proposed ? `${proposed} כרטיסים מחכים` : "מוכן לבנייה";
  }
  if (s.stepKey === "plan" && v.run.session.state === "live") return "סשן טיוטה פעיל";
  return STEP_STATUS_HE[s.status];
}

/* ── before the first run ─────────────────────────────────────────── */

function PreStart({ repoId, repoName, crumb, onCancel, onStarted, onError, err }: {
  repoId: string; repoName: string; crumb: ReactNode; onCancel?: () => void; onStarted: (runId: string) => void; onError: (t: string | null) => void; err: string | null;
}) {
  const [defs, setDefs] = useState<OnboardingStepDefinition[] | null>(null);
  const [levels, setLevels] = useState<AutomationLevel[]>(["reversible_auto", "all_approval", "locked"]);
  const [level, setLevel] = useState<AutomationLevel>("reversible_auto");
  const [starting, setStarting] = useState(false);
  useEffect(() => { getOnboardingSteps().then((r) => { setDefs(r.steps); setLevels(r.levels); }).catch((e) => onError(errText(e))); }, [onError]);
  const start = async () => {
    setStarting(true);
    onError(null);
    try { const r = await startOnboardingRun(repoId, { automation: { level } }); onStarted(r.runId); } catch (e) { onError(errText(e)); setStarting(false); }
  };
  return (
    <>
      <PageHead info="page_onboarding_intro" crumb={crumb} title={`התיק של ${repoName || "המאגר"}`} sub="לפני שמתחילים: מה יקרה, מה זה עולה ומה תחליטו" actions={onCancel && <button className="btn btn-secondary btn-sm" onClick={onCancel}>חזרה להרצה</button>} />
      {err && <div className="ob-note crit" style={{ marginBottom: 14 }}>{err}</div>}
      <div className="panel" style={{ display: "grid", gap: 16 }}>
        <div>
          <CardTitle info="onboarding_intro">מה עושים כאן</CardTitle>
          <p className="rd-lead">DCC קורא את המאגר, מבין איך עובדים בו, מריץ ניסיון קטן כדי לראות איפה קלוד נכשל היום, ומציע רכיב לכל כישלון וכל צעד חוזר — כל אחד עם הראיה שלו. אתם מאשרים כרטיסים, לא קבצים. מה שאושר נבנה בעותק מבודד, נבדק, ונמסר כבקשת מיזוג. הענף הראשי לא משתנה עד שתמזגו.</p>
          <p className="ob-sub">שום דבר לא רץ עד שתלחצו "התחל". שום קובץ לא יוצא מהמחשב לפני צעד המסירה, וגם הוא מחכה ללחיצה.</p>
        </div>
        <div>
          <CardTitle info="steps_overview">שבעת הצעדים</CardTitle>
          {!defs ? <div className="spin">טוען…</div> : (
            <div className="ob-overview">
              {defs.map((d) => {
                const k = STEP_KIND_CHIP[d.kind];
                return (
                  <div key={d.key}>
                    <div className="h"><b>{d.order + 1}. {d.title_he}</b><span className={`rd-chip ${k.cls}`}>{k.label}</span><Info k="step_kind" /></div>
                    <div className="ob-sub">{d.short_he}</div>
                    <div className="ob-sub" style={{ marginTop: 2 }}>עלות: {d.cost_he}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <CardTitle info="automation_level">מדרגת האוטומציה</CardTitle>
          <LevelChooser value={level} levels={levels} onChange={setLevel} />
          <p className="ob-sub" style={{ marginTop: 6 }}>אפשר לשנות בכל רגע מהמסך של ההרצה. בכל מדרגה, המסירה מחכה ללחיצה שלכם.</p>
        </div>
        <div>
          <CardTitle info="fixed_layout">מה ייכתב במאגר</CardTitle>
          <p className="ob-sub" style={{ margin: 0 }}>רק מה שאושר, ורק במקומות הקבועים של Claude Code: <span className="ob-code">AGENTS.md</span> עם <span className="ob-code">CLAUDE.md</span> דק שמצביע עליו, <span className="ob-code">.claude/</span> (הגדרות, hooks, skills, סוכנים), <span className="ob-code">.mcp.json</span>, ותיק <span className="ob-code">.dcc/</span> עם הפרופיל, הכרטיסים והראיות — כדי שהמאמן ידע מה הותקן ולמה.</p>
        </div>
        <div className="ob-actions">
          <button className="btn btn-primary" disabled={starting || !defs} onClick={() => void start()}>{starting ? "מתחיל…" : "התחל — חיבור ואבחון"}</button>
          <Info k="what_dcc_does" />
          <span className="ob-sub">החיבור והאבחון בלי מודל ובלי עלות. הצעד הראשון שעולה כסף מבקש אישור על העלות, לפי המדרגה.</span>
        </div>
      </div>
    </>
  );
}

/* ── the rail ─────────────────────────────────────────────────────── */

function AutomationPanel({ level, levels, busy, disabled, onSave }: { level: AutomationLevel; levels: AutomationLevel[]; busy: boolean; disabled: boolean; onSave: (l: AutomationLevel) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(level);
  useEffect(() => { if (!editing) setDraft(level); }, [level, editing]);
  return (
    <div className="panel">
      <CardTitle info="automation_level">מדרגת האוטומציה</CardTitle>
      <p style={{ fontSize: 12.5, marginBottom: 8 }}><b>{LEVEL_HE[level].title}</b> — {LEVEL_HE[level].desc}</p>
      {!editing
        ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => { setDraft(level); setEditing(true); }}>שנה מדרגה</button>
        : (
          <div style={{ display: "grid", gap: 10 }}>
            <LevelChooser value={draft} levels={levels} onChange={setDraft} />
            <p className="ob-sub">השינוי חל מהצעד הבא. כרטיסים שכבר צוירו לא משנים קבוצה.</p>
            <div className="ob-actions">
              <button className="btn btn-primary btn-sm" disabled={busy || draft === level} onClick={() => { onSave(draft); setEditing(false); }}>{busy ? "שומר…" : "שמור"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>ביטול</button>
            </div>
          </div>
        )}
    </div>
  );
}

function CostPanel({ cost, title, nav }: { cost: OnboardingCost; title: (key: string) => string; nav: (h: string) => void }) {
  return (
    <div className="panel">
      <CardTitle info="run_cost">עלות ההרצה</CardTitle>
      <div className="ob-kv">
        <div><div className="l">עלות AI<Info k="ai_cost" /></div><div className="v">{fmtUsd(cost.totalCostUsd)}</div></div>
        <div><div className="l">קריאות למודל<Info k="ledger" /></div><div className="v">{fmtInt(cost.calls)}</div></div>
        <div><div className="l">טוקנים (קלט / פלט)<Info k="tokens" /></div><div className="v" style={{ fontSize: 12 }}>{fmtInt(cost.inputTokens)} / {fmtInt(cost.outputTokens)}</div></div>
      </div>
      {cost.byStep.length > 0 && (
        <div className="rowlist" style={{ marginTop: 10 }}>
          {cost.byStep.map((s) => (
            <div className="row" key={s.stepKey} style={{ padding: "7px 10px", fontSize: 12 }}>
              <span className="title">{title(s.stepKey)}</span>
              <span className="spacer" />
              <span>{fmtUsd(s.costUsd)} · {fmtInt(s.calls)} קריאות</span>
            </div>
          ))}
          {cost.chat && cost.chat.calls > 0 && (
            <div className="row" style={{ padding: "7px 10px", fontSize: 12 }}>
              <span className="title">הצ'אט · {fmtInt(cost.chat.calls)} שאלות</span>
              <span className="spacer" />
              <span>{fmtUsd(cost.chat.costUsd)}</span>
            </div>
          )}
        </div>
      )}
      <p className="ob-sub" style={{ marginTop: 8 }}>
        {cost.liveUsd > 0
          ? <>מתוך זה {fmtUsd(cost.liveUsd)} הוצא בסשן הטיוטה ועדיין לא נרשם — הוא נרשם כשהסשן נסגר.</>
          : <>מתוך יומן הקריאות של קלוד, כמו כל עלות במערכת.</>}
        {" "}<a onClick={() => nav("#/claude/calls")}>כל הקריאות ←</a>
      </p>
    </div>
  );
}

function EventLogPanel({ events, title, users }: { events: OnboardingEvent[]; title: (key: string) => string; users: Record<string, string> }) {
  const list = [...events].reverse();
  return (
    <div className="panel">
      <CardTitle info="decision_log">יומן החלטות ואירועים</CardTitle>
      {list.length === 0 ? <p className="ob-sub">עדיין אין אירועים.</p> : (
        <div className="ob-timeline">
          {list.slice(0, 80).map((e) => {
            const l = eventLabel(e, title);
            const color = l.tone === "critical" ? "var(--status-critical)" : l.tone === "warning" ? "var(--status-warning)" : l.tone === "ai" ? "var(--status-ai)" : l.tone === "healthy" ? "var(--status-healthy)" : "var(--ink-700)";
            const who = e.actorUserId ? users[e.actorUserId] : null;
            return (
              <div key={e.id}>
                <span className="tm">{fmtTime(e.occurredAt)}</span>
                <span style={{ color }}>{l.text}{who ? <span className="ob-sub"> · {who}</span> : null}</span>
              </div>
            );
          })}
          {list.length > 80 && <p className="ob-sub">ועוד {list.length - 80} אירועים ישנים יותר.</p>}
        </div>
      )}
    </div>
  );
}

function RunsPanel({ runs, current, onPick }: { runs: OnboardingRunSummary[]; current: string; onPick: (id: string) => void }) {
  if (runs.length < 2) return null;
  return (
    <div className="panel">
      <CardTitle info="previous_runs">הרצות קודמות</CardTitle>
      <div style={{ display: "grid", gap: 6 }}>
        {runs.map((r) => {
          const st = RUN_STATUS_HE[r.status];
          return (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <a style={{ cursor: "pointer", fontWeight: r.id === current ? 700 : 500 }} onClick={() => onPick(r.id)}>{fmtDate(r.startedAt)}</a>
              {r.kind === "coach" && <span className="rd-chip det">מאמן</span>}
              <span style={{ flex: 1 }} />
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

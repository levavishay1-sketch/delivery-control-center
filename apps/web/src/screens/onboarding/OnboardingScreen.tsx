import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  approveOnboardingReview, cancelOnboardingRun, completeOnboardingInit, getOnboardingFile, getOnboardingRun, getOnboardingStages, getRepos, getUsers,
  listOnboardingRuns, refreshOnboardingReview, resumeOnboardingSession, runOnboardingStage, startOnboardingRun, updateOnboardingAutomation,
  updateOnboardingModelChoices,
  type AutomationPolicy, type DeliverResult, type Effort, type InitResult, type ModelPolicy, type OnboardingRunSummary, type OnboardingRunView,
  type OnboardingStage, type OnboardingStageDefinition, type OnboardingStageKey, type PrepareResult, type ReviewResult,
} from "../../api.ts";
import { CardTitle, PageHead, Pill } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { CodeMapPanel } from "../../components/CodeMap.tsx";
import { FileCompare } from "../../components/FileCompare.tsx";
import { useClaudeContext } from "../../claude/context.ts";
import { RunTerminal } from "./Terminal.tsx";
import { AutomationEditor, AutomationPanel, CostPanel, EventLogPanel, ModelEditor, ModelPanel, RunsPanel } from "./rail.tsx";
import { KIND_CHIP, RUN_STATUS_HE, STAGE_STATUS_HE, errText, fmtDate, fmtInt, fmtUsd, policyNeedsConsent, presetPolicy, shortSha } from "./labels.ts";

/**
 * Repository onboarding: four stages around one live Claude Code session
 * (`openspec/changes/repository-onboarding-native-init`). Each stage runs
 * from its own button in its card; the terminal under the card is the real
 * session and stays on screen through every stage.
 */
/** The concept behind each stage's "i" — the same entry its button opens. */
const STAGE_INFO: Record<string, string | undefined> = { prepare: "prepare", init: "init", review: "onboarding_review", deliver: "deliver" };

export function OnboardingScreen({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [repoName, setRepoName] = useState("");
  const [runs, setRuns] = useState<OnboardingRunSummary[] | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<OnboardingRunView | null>(null);
  const [selected, setSelected] = useState<OnboardingStageKey | null>(null);
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
    const t = window.setInterval(() => { if (!over.current) refresh().catch(() => {}); }, 2000);
    return () => window.clearInterval(t);
  }, [runId, refresh]);

  // What the one chat knows about this screen: the run's state, and — read
  // at the moment of asking — the text on the terminal right now. The
  // session's own digest is added by the server for a `run` topic.
  useClaudeContext(view ? {
    screen: "onboarding",
    topic: { kind: "run", id: view.run.id, title: `הטמעת ${repoName}` },
    facts: {
      "מאגר": repoName,
      "מצב ההרצה": RUN_STATUS_HE[view.run.status]?.label ?? view.run.status,
      "שלב נוכחי": view.run.currentStageKey ? (view.definitions.find((d) => d.key === view.run.currentStageKey)?.title_he ?? view.run.currentStageKey) : "—",
      "שלבים שהושלמו": view.stages.filter((s) => s.status === "Completed").map((s) => view.definitions.find((d) => d.key === s.stageKey)?.title_he ?? s.stageKey),
      "עלות ההרצה": `$${view.cost.totalCostUsd.toFixed(2)}`,
      aiCostUsd: view.cost.totalCostUsd,
      status: RUN_STATUS_HE[view.run.status]?.label ?? view.run.status,
    },
    liveFacts: () => ({ "המסך בטרמינל עכשיו": (screenRef.current?.() ?? "").slice(-3500) }),
    suggestions: ["מה הוא רוצה ממני עכשיו?", "מה הוא עשה עד עכשיו?", "מה ההשלכות של כל אפשרות?", "איך ממשיכים מכאן?"],
    actions: ["send_to_session"],
  } : null);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  const crumb = <a style={{ cursor: "pointer" }} onClick={() => nav("#/repositories")}>Repositories</a>;

  if (runs === null) return <div className="spin">טוען…</div>;
  if (runs.length === 0 || showNew) {
    return (
      <PreStart
        repoId={id} repoName={repoName} crumb={crumb}
        onCancel={runs.length ? () => setShowNew(false) : undefined}
        onStarted={(rid) => { setShowNew(false); setSelected("prepare"); loadRuns(rid).catch(() => {}); setRunId(rid); }}
      />
    );
  }
  if (!view) return <div className="spin">טוען…</div>;

  const { run, stages, definitions: defs } = view;
  const runOver = run.status === "Completed" || run.status === "Cancelled";
  const byKey = new Map(stages.map((s) => [s.stageKey, s]));
  const title = (key: string) => defs.find((d) => d.key === key)?.title_he ?? key;
  const settled = stages.filter((s) => s.status === "Completed").length;
  const sel: OnboardingStageKey = selected ?? run.currentStageKey ?? defs[defs.length - 1]!.key;
  const runnable = (key: OnboardingStageKey) => {
    const s = byKey.get(key);
    if (runOver || !s || !(s.status === "Pending" || s.status === "Failed")) return false;
    return stages.filter((x) => x.stageOrder < s.stageOrder).every((x) => x.status === "Completed");
  };
  const status = RUN_STATUS_HE[run.status];

  return (
    <>
      <PageHead info="page_onboarding_run"
        crumb={crumb}
        title={`הטמעת AI — ${view.repo.name}`}
        sub={`הרצה ${run.id.slice(0, 8)} · התחילה ${fmtDate(run.startedAt)}${run.baselineSha ? ` · commit ${shortSha(run.baselineSha)}` : ""}${run.branchName ? ` · ענף ${run.branchName}` : ""}`}
        actions={
          <>
            <Pill tone={status.tone}>{status.label}</Pill>
            {runOver || run.status === "Failed"
              ? <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(true)}>הרצה חדשה…</button>
              : <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => { if (confirm("לבטל את ההרצה? הסשן של Claude ייסגר. העותק המבודד והענף נשארים, שום דבר לא נמחק.")) void act("cancel", () => cancelOnboardingRun(id, run.id)); }}>{busy === "cancel" ? "מבטל…" : "בטל הרצה"}</button>}
          </>
        }
      />
      {err && <div className="ob-note crit" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="dash">
        <div style={{ minWidth: 0 }}>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="progress-block" style={{ margin: "0 0 12px" }}>
              <div className="top"><span className="l">{settled} מתוך {defs.length} שלבים הסתיימו</span><span>{Math.round((settled / defs.length) * 100)}%</span></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${(settled / defs.length) * 100}%` }} /></div>
            </div>
            <div className="ob-steps" style={{ ["--ob-steps" as string]: defs.length }}>
              {defs.map((d) => {
                const s = byKey.get(d.key);
                const cls = stepClass(s);
                return (
                  <button key={d.key} type="button" className={`ob-step ${cls}${d.key === sel ? " active" : ""}`} onClick={() => setSelected(d.key)} title={d.short_he}>
                    <span className="n"><span className="g">{GLYPH[cls]}</span><span>שלב {d.order + 1}</span></span>
                    <span className="t">{shortTitle(d)}</span>
                    <span className="s">{s ? stageStatusText(s, view) : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <StageCard
            key={sel}
            def={defs.find((d) => d.key === sel)!}
            next={defs.find((d) => d.order === (defs.find((x) => x.key === sel)!.order + 1))}
            stage={byKey.get(sel)!}
            view={view}
            users={users}
            runnable={runnable(sel)}
            busy={busy}
            onRun={() => act(`run:${sel}`, () => runOnboardingStage(id, run.id, sel))}
            onCompleteInit={() => act("complete-init", () => completeOnboardingInit(id, run.id))}
            onResume={() => act("resume", () => resumeOnboardingSession(id, run.id))}
            onRefreshReview={() => act("review-refresh", () => refreshOnboardingReview(id, run.id))}
            onApprove={() => act("approve", () => approveOnboardingReview(id, run.id))}
            onSelect={setSelected}
          />

          <RunTerminal repoId={id} runId={run.id} screenRef={screenRef} />
          <p className="ob-sub" style={{ marginTop: 10 }}>שאלות על מה שהסשן עושה — בצ'אט של קלוד (הכפתור למטה משמאל, או Ctrl K). הוא מקבל את מה שהתחדש בסשן ואת המסך שבטרמינל.</p>
        </div>

        <div className="rail">
          <AutomationPanel
            policy={view.automation} defs={defs} busy={busy === "automation"} disabled={runOver}
            onSave={(p, consent) => act("automation", () => updateOnboardingAutomation(id, run.id, p, consent))}
          />
          <ModelPanel
            choices={view.modelChoices} defs={defs} recommended={view.recommended} busy={busy === "model"} disabled={runOver}
            onSave={(p) => act("model", () => updateOnboardingModelChoices(id, run.id, p))}
          />
          <CostPanel cost={view.cost} title={title} nav={nav} />
          <EventLogPanel events={view.events} title={title} users={users} />
          <RunsPanel runs={runs} current={run.id} onPick={(rid) => { setSelected(null); setRunId(rid); }} />
        </div>
      </div>
    </>
  );
}

/* ── the stepper ──────────────────────────────────────────────────── */

type StepClass = "pend" | "live" | "wait" | "done" | "fail";
const GLYPH: Record<StepClass, string> = { pend: "○", live: "●", wait: "✋", done: "✓", fail: "✕" };
function stepClass(s: OnboardingStage | undefined): StepClass {
  if (!s) return "pend";
  if (s.status === "Completed") return "done";
  if (s.status === "Running") return "live";
  if (s.status === "WaitingForUser") return "wait";
  if (s.status === "Failed") return "fail";
  return "pend";
}
const shortTitle = (d: OnboardingStageDefinition) => d.title_he.replace(/\s*\(.*\)$/, "").replace(/:.*$/, "");
function stageStatusText(s: OnboardingStage, v: OnboardingRunView): string {
  if (s.stageKey === "init" && s.status === "Running") {
    const st = v.run.session.state;
    return st === "live" ? "סשן פעיל" : st === "disconnected" ? "הסשן נותק" : st === "ended" ? "הסשן נסגר" : "רץ";
  }
  return STAGE_STATUS_HE[s.status];
}

/* ── one stage ────────────────────────────────────────────────────── */

type StageCardProps = {
  def: OnboardingStageDefinition;
  next: OnboardingStageDefinition | undefined;
  stage: OnboardingStage;
  view: OnboardingRunView;
  users: Record<string, string>;
  runnable: boolean;
  busy: string | null;
  onRun: () => void;
  onCompleteInit: () => void;
  onResume: () => void;
  onRefreshReview: () => void;
  onApprove: () => void;
  onSelect: (k: OnboardingStageKey) => void;
};

function StageCard(p: StageCardProps) {
  const { def, stage } = p;
  const kind = KIND_CHIP[def.kind];
  const [explain, setExplain] = useState(stage.status === "Pending");
  const nextStage = p.next ? p.view.stages.find((s) => s.stageKey === p.next!.key) : undefined;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="ob-stage-head">
        <CardTitle as="h3" info={STAGE_INFO[def.key] ?? null}>{def.order + 1}. {def.title_he}</CardTitle>
        <span className={`ob-chip ${kind.cls}`}>{kind.label}</span>
        {def.key === "init" && <span className="ob-chip human">דורש אותך</span>}
        {stage.status === "Completed" && <span className="ob-chip ok">הסתיים</span>}
        {stage.status === "Failed" && <span className="ob-chip bad">נכשל</span>}
        <span className="grow" />
        {p.runnable && (
          <button className="btn btn-primary" disabled={!!p.busy} onClick={p.onRun}>
            {p.busy === `run:${def.key}` ? "מתחיל…" : stage.status === "Failed" ? "▶ הרץ שלב שוב" : "▶ הרץ שלב"}
          </button>
        )}
      </div>

      {stage.status === "Failed" && !!stage.errors.length && <div className="ob-note crit" style={{ marginBottom: 10 }}>{stage.errors.join(" · ")}</div>}
      <StageBody {...p} />

      {stage.status === "Completed" && p.next && nextStage && nextStage.status !== "Completed" && (
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => p.onSelect(p.next!.key)}>המשך לשלב הבא: {shortTitle(p.next)} ›</button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button type="button" className="ob-toggle" onClick={() => setExplain((v) => !v)}>{explain ? "הסתר את ההסבר" : "למה השלב הזה, מה הוא עושה ומה הוא מפיק"}</button>
        {explain && (
          <div className="ob-explain">
            <div><b>למה</b><span>{def.why_he}</span></div>
            <div><b>מה</b><span>{def.what_he}</span></div>
            <div><b>תוצר</b><span>{def.output_he}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function StageBody(p: StageCardProps) {
  const { stage, view } = p;
  const waitingText = p.runnable ? "עוד לא רץ. לחצו על \"הרץ שלב\" כדי להתחיל." : "השלב הזה יהיה זמין אחרי שהשלבים שלפניו יסתיימו.";
  const stageCost = view.cost.byStage.find((s) => s.stageKey === stage.stageKey);

  // Every stage that touches git opens with the same picture.
  const map = <CodeMapPanel map={view.codeMap} />;

  if (stage.stageKey === "prepare") {
    if (stage.status === "Running") return <Working text="מושך את הריפו ופותח ענף… בריפו גדול זה לוקח דקה או שתיים. ההתקדמות מופיעה בטרמינל." />;
    if (stage.status !== "Completed") return <p className="ob-sub">{waitingText}</p>;
    const r = stage.result as PrepareResult;
    const found = [
      r.existing.claudeMdLines !== null ? `CLAUDE.md (${r.existing.claudeMdLines} שורות)` : null,
      r.existing.agentsMd ? "AGENTS.md" : null,
      r.existing.rules ? `${r.existing.rules} rules` : null,
      r.existing.skills ? `${r.existing.skills} skills` : null,
      r.existing.hooks ? `${r.existing.hooks} hooks` : null,
      r.existing.agents ? `${r.existing.agents} agents` : null,
      r.existing.settings ? "settings.json" : null,
    ].filter(Boolean);
    return (
      <>
        {map}
        <p className="ob-sub" style={{ margin: "10px 0" }}>עותק מבודד על ענף חדש. הריפו שלך לא נגע.</p>
        <div className="ob-kv">
          <div><div className="l">נוצר מהענף<Info k="run_base_branch" /></div><div className="v ob-code">{r.defaultBranch ?? "—"}</div></div>
          <div><div className="l">ענף<Info k="run_branch" /></div><div className="v ob-code">{r.branch}</div></div>
          <div><div className="l">נקודת התחלה<Info k="run_baseline" /></div><div className="v ob-code">{shortSha(r.baselineSha)}</div></div>
          <div><div className="l">קבצים<Info k="run_files" /></div><div className="v">{fmtInt(r.fileCount)}</div></div>
        </div>
        {r.baseFrom === "head" && (
          <div className="ob-note warn" style={{ marginTop: 10 }}>
            לא נמצא ענף ראשי במאגר, ולכן ההרצה נגזרה מהענף שהעותק עמד עליו. מה שיש בענף הזה ולא בראשי ייכנס גם לבקשת המיזוג — בדקו לפני שממשיכים.
          </div>
        )}
        <p className="ob-sub" style={{ marginTop: 10 }}>{found.length ? `כבר קיים בריפו: ${found.join(", ")}.` : "אין בריפו הגדרות קיימות של Claude Code."}</p>
      </>
    );
  }

  if (stage.stageKey === "init") {
    if (stage.status === "Pending" || stage.status === "Failed") return <p className="ob-sub">{p.runnable ? "Claude Code יתחיל בטרמינל שלמטה עם /init, וישאל אותך שאלות שם." : waitingText}</p>;
    if (stage.status === "Running") {
      const st = view.run.session.state;
      return (
        <div style={{ display: "grid", gap: 10 }}>
          {st === "live"
            ? <p style={{ fontSize: 13 }}>שיחה חיה עם Claude Code בטרמינל שלמטה. עונים לשאלות שלו שם, ואפשר גם לכתוב לו חופשי. כשהוא מסיים, לחצו על "סיימתי".</p>
            : <div className="ob-note warn">{st === "disconnected" ? "הסשן נותק (השרת הופעל מחדש). אפשר לחדש אותו מאותה נקודה בשיחה." : "הסשן של Claude נסגר. אפשר לפתוח אותו מחדש מאותה נקודה, או לסיים את השלב."}</div>}
          <div className="ob-actions">
            <button className="btn btn-primary" disabled={!!p.busy} onClick={p.onCompleteInit}>{p.busy === "complete-init" ? "שומר…" : "✓ סיימתי עם ההטמעה"}</button>
            {st !== "live" && <button className="btn btn-secondary" disabled={!!p.busy} onClick={p.onResume}>{p.busy === "resume" ? "מחדש…" : "↻ חדש את הסשן"}</button>}
            {stageCost && <span className="ob-sub">עלות עד כה: {fmtUsd(stageCost.costUsd)}</span>}
          </div>
        </div>
      );
    }
    const r = stage.result as InitResult;
    return (
      <>
        <div className="ob-kv">
          <div><div className="l">קבצים שהשתנו<Info k="run_files" /></div><div className="v">{fmtInt(r.changedFiles)}</div></div>
          <div><div className="l">עלות השלב<Info k="stage_cost" /></div><div className="v">{fmtUsd(stageCost?.costUsd ?? 0)}</div></div>
          <div><div className="l">סיים/ה</div><div className="v">{p.users[r.completedBy] ?? "—"}</div></div>
        </div>
        <p className="ob-sub" style={{ marginTop: 10 }}>הסשן נשאר פתוח עד המסירה: אפשר לבקש מ-Claude שינויים בטרמינל בכל שלב.</p>
      </>
    );
  }

  if (stage.stageKey === "review") {
    if (stage.status === "WaitingForUser") return <ReviewBody {...p} map={map} />;
    if (stage.status !== "Completed") return <p className="ob-sub">{waitingText}</p>;
    const r = stage.result as ReviewResult;
    return <p style={{ fontSize: 13 }}>{r.auto ? "אושר לפי מדיניות האוטומציה" : `אושר על ידי ${p.users[r.approvedBy ?? ""] ?? "—"}`} · {r.changedFiles.length} קבצים עוברים למסירה.</p>;
  }

  if (stage.status === "Running") return <Working text="עושה commit על שמך, push לענף ופותח PR…" />;
  if (stage.status !== "Completed" && p.runnable) return <div style={{ display: "grid", gap: 10 }}>{map}<p className="ob-sub">{`יבצע commit על שמך, push לענף ${view.run.branchName ?? ""} ויפתח PR. main לא ישתנה עד שתמזגו.`}</p></div>;
  if (stage.status !== "Completed") return <p className="ob-sub">{p.runnable ? `עוד לא רץ. יבצע commit על שמך, push לענף ${view.run.branchName ?? ""} ויפתח PR, ואז יסגור את הסשן.` : waitingText}</p>;
  const r = stage.result as DeliverResult;
  return (
    <>
      {map}
      <div className="ob-kv" style={{ marginTop: 10 }}>
        <div><div className="l">commit</div><div className="v ob-code">{r.commitSha ?? "—"}</div></div>
        <div><div className="l">ענף</div><div className="v ob-code">{r.branch}</div></div>
        <div><div className="l">Pull Request<Info k="run_pr" /></div><div className="v">{r.prUrl ? <a href={r.prUrl} target="_blank" rel="noreferrer">#{r.prNumber ?? "PR"}</a> : r.compareUrl ? <a href={r.compareUrl} target="_blank" rel="noreferrer">פתיחה ידנית</a> : "—"}</div></div>
      </div>
      <p className="ob-sub" style={{ marginTop: 10 }}>
        {r.note ?? (r.localOnly ? `אין remote לריפו: הענף נשאר מקומי. מזגו אותו ל-${r.base} ידנית.` : `ה-PR ממתין למיזוג ידני ל-${r.base}. המיזוג הוא "AI Ready".`)}
      </p>
    </>
  );
}

function Working({ text }: { text: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="spinner" style={{ width: 16, height: 16 }} /><span className="ob-sub" style={{ fontSize: 12.5 }}>{text}</span></div>;
}

function ReviewBody(p: StageCardProps & { map?: ReactNode }) {
  const r = (p.stage.result ?? { changedFiles: [], checkedAt: "" }) as ReviewResult;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {p.map}
      <div className="ob-note warn">שום דבר לא יוצא מהמחשב עד שתאשרו. רוצים לשנות משהו? בקשו מ-Claude בטרמינל שלמטה, ואז רעננו את הרשימה.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 650 }}>מה השתנה ({r.changedFiles.length} קבצים)</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" disabled={!!p.busy} onClick={p.onRefreshReview}>{p.busy === "review-refresh" ? "מרענן…" : "↻ רענן רשימה"}</button>
      </div>
      {r.changedFiles.length === 0 ? <p className="ob-sub">אין שינויים מול נקודת ההתחלה.</p> : (
        <div className="ob-files">
          {r.changedFiles.map((f) => (
            <div key={f.path} className="ob-file">
              <button type="button" aria-pressed={open === f.path} onClick={() => setOpen(open === f.path ? null : f.path)}>
                <span className={`ob-chip ${f.status === "A" ? "ok" : f.status === "D" ? "bad" : "det"}`}>{f.status}</span>
                <span className="f">{f.path}</span>
                <span className="add">+{f.additions}</span>
                <span className="del">−{f.deletions}</span>
              </button>
              {open === f.path && <FileCompare key={`${f.path}|${r.checkedAt}`} load={() => getOnboardingFile(p.view.run.repoId, p.view.run.id, f.path)} />}
            </div>
          ))}
        </div>
      )}
      <div className="ob-actions" style={{ marginTop: 4 }}>
        <button className="btn btn-primary" disabled={!!p.busy} onClick={p.onApprove}>{p.busy === "approve" ? "מאשר…" : "✓ אשר ועבור למסירה"}</button>
      </div>
    </div>
  );
}

/* ── before a run exists ──────────────────────────────────────────── */

function PreStart({ repoId, repoName, crumb, onStarted, onCancel }: { repoId: string; repoName: string; crumb: ReactNode; onStarted: (runId: string) => void; onCancel?: () => void }) {
  const [defs, setDefs] = useState<OnboardingStageDefinition[] | null>(null);
  const [recommended, setRecommended] = useState<{ init: { model: string; effort: Effort } } | null>(null);
  const [policy, setPolicy] = useState<AutomationPolicy | null>(null);
  const [consent, setConsent] = useState(false);
  const [models, setModels] = useState<ModelPolicy>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getOnboardingStages().then((r) => { setDefs(r.stages); setRecommended(r.recommended); setPolicy(presetPolicy("step_by_step", r.stages)); }).catch((e) => setErr(errText(e)));
  }, []);
  if (!defs || !policy || !recommended) return err ? <div className="ob-note crit">{err}</div> : <div className="spin">טוען…</div>;
  const needsConsent = policyNeedsConsent(policy, defs);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try { const r = await startOnboardingRun(repoId, { automation: policy, modelChoices: models, consent }); onStarted(r.runId); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <>
      <PageHead info="page_onboarding_intro" crumb={crumb} title={`לפני שמתחילים — הטמעת AI${repoName ? ` לריפו ${repoName}` : ""}`} sub="הסבר קצר על התהליך. שום דבר עוד לא רץ." actions={onCancel && <button className="btn btn-secondary btn-sm" onClick={onCancel}>חזרה להרצה</button>} />
      {err && <div className="ob-note crit" style={{ marginBottom: 14 }}>{err}</div>}
      <div className="dash">
        <div style={{ minWidth: 0, display: "grid", gap: 16 }}>
          <div className="panel">
            <CardTitle as="h3" info="onboarding_intro" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>מכינים את Claude לריפו הזה</CardTitle>
            <p style={{ fontSize: 13, lineHeight: 1.65 }}>כך שמפתח שמקבל משימה יקבל מההתחלה את מה שהוא צריך לעבודה יעילה, חסכונית ואיכותית: הוראות, ידע שנטען לפי דרישה והגנות. התוכן נוצר על ידי <span className="ob-code">/init</span> של Claude Code עצמו, בשיחה איתך.</p>
          </div>
          <div className="panel">
            <p className="section-lbl">מה יקרה, ב-{defs.length} שלבים<Info k="stage_overview" /></p>
            <div className="ob-overview" style={{ ["--ob-steps" as string]: defs.length }}>
              {defs.map((d) => (
                <div key={d.key}>
                  <div className="n">שלב {d.order + 1} · {KIND_CHIP[d.kind].label}</div>
                  <div className="t">{shortTitle(d)}</div>
                  <div className="d">{d.what_he}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <p className="section-lbl">מה ייכתב לריפו<Info k="what_gets_written" /></p>
            <div className="ob-actions" style={{ gap: 6 }}>
              <span className="ob-chip">CLAUDE.md</span><span className="ob-chip">skills לפי דרישה</span><span className="ob-chip">hooks</span><span className="ob-chip">rules לפי נתיב</span>
            </div>
            <p className="ob-sub" style={{ marginTop: 8 }}>מה בדיוק — Claude מציע ואתם מחליטים בשיחה. הכל נכתב בענף חדש, ושום דבר לא יוצא לפני שתאשרו בסקירת התוצרים.</p>
          </div>
          <div className="panel">
            <p className="section-lbl">על מה תישאלו<Info k="what_youll_be_asked" /></p>
            <p style={{ fontSize: 13, lineHeight: 1.65 }}>על מה ש-Claude לא יכול לדעת מהקוד: מה לעשות עם הגדרות קיימות, איך אתם בונים ומפרסמים, ומה השתנה בצוות. אפשר לבחור תשובה, לכתוב אחרת, או לשוחח איתו.</p>
          </div>
          <div className="ob-actions">
            <button className="btn btn-primary" disabled={busy || (needsConsent && !consent)} onClick={start}>{busy ? "יוצר הרצה…" : "▶ התחל הטמעה"}</button>
            <span className="ob-sub">ייצור הרצה חדשה. שלב 1 מתחיל מהכפתור שלו, אלא אם בחרתם שהשלבים ירוצו לבד.</span>
          </div>
        </div>
        <div className="rail">
          <div className="panel">
            <CardTitle info="automation">אוטומציה</CardTitle>
            <AutomationEditor defs={defs} value={policy} onChange={setPolicy} consent={consent} onConsent={setConsent} />
          </div>
          <div className="panel">
            <CardTitle info="model_effort">מודל ומאמץ</CardTitle>
            <ModelEditor defs={defs} value={models} recommended={recommended} onChange={setModels} />
            <p className="ob-sub" style={{ marginTop: 8 }}>אפשר לשנות גם בזמן השיחה, עם <span className="ob-code">/model</span> ו-<span className="ob-code">/effort</span>.</p>
          </div>
        </div>
      </div>
    </>
  );
}

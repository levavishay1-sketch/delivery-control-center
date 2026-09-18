import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceOnboardingRun, cancelOnboardingRun, checkOnboardingRefresh, getLatestOnboardingRun, getOnboardingRefreshMetrics, getOnboardingRun, getOnboardingRunCostSummary, getOnboardingStages, getRepos,
  listOnboardingRuns, resetOnboardingRunTo, startOnboardingRun, stopOnboardingExecution, submitOnboardingStageInput, updateOnboardingAutomation,
  type AutomationPolicy, type OnboardingRunCostSummary, type OnboardingRunView, type OnboardingStage, type OnboardingStatus, type RefreshResult, type StageDefinition,
} from "../api.ts";
import { PageHead } from "../ui.tsx";
import {
  AutomationEditor, ClaudeCallPanel, Code, KV, Note, RawResult, STATUS_HE, StageExplainer, StageMetaChips, StatusPill, describePolicy, elapsedSince, errText, eventLabel, fmtDate, fmtDuration, fmtInt, fmtTime, fmtUsd, policyNeedsConsent, presetPolicy, shortSha,
} from "./onboarding/shared.tsx";
import { StageFindings } from "./onboarding/stageViews.tsx";
import type { ConfirmResult, DeliverResult, DiscoveryResult } from "./onboarding/types.ts";

/**
 * Repository AI Enablement — the 9-stage onboarding pipeline
 * (`repository-ai-enablement-v2`). Mounted at `#/repo/<id>` (and the
 * older `#/repo-onboarding/<id>`).
 *
 * Two screens. Before a run: what the process will do, stage by stage
 * (why / what / value / what it supports / output / impact — readable
 * before anything runs), how much of it should happen on its own, and
 * the explicit consent an automatic gate needs. During and after a run:
 * a nine-node stepper, the selected stage's explanation and real
 * findings, the gate form when the stage is waiting on a person, the
 * Claude call behind the stage, and a rail with the automation policy,
 * cost, the decision log, open warnings/UNKNOWNs and the knowledge
 * lifecycle (staleness check → refresh run). The run advances on its own
 * only as far as its policy allows; everything here is a person's lever.
 */

type RepoLite = { id: string; name: string; adoRepoRef: string | null; clientId: string | null; clientName: string | null };
type LatestRun = { runId: string; status: OnboardingStatus; currentStageKey: string | null; onboardingVersion: string; mode: string; completedAt: string | null };
type RunRow = { id: string; status: OnboardingStatus; mode: string; onboardingVersion: string; startedAt: string; completedAt: string | null; baselineSha: string | null };

const SETTLED: ReadonlySet<string> = new Set(["Completed", "CompletedWithWarnings", "Skipped"]);
const RUN_OVER: ReadonlySet<string> = new Set(["Completed", "CompletedWithWarnings", "Cancelled"]);
const isLiveStatus = (s: OnboardingStatus) => !RUN_OVER.has(s);
const MODE_HE: Record<string, string> = { initial: "onboarding ראשוני", refresh: "רענון" };

export function RepoOnboardingPanel({ id: repoId, nav }: { id: string; nav: (h: string) => void }) {
  const [repo, setRepo] = useState<RepoLite | null | undefined>(undefined);
  const [defs, setDefs] = useState<StageDefinition[] | null>(null);
  const [latest, setLatest] = useState<LatestRun | null | undefined>(undefined);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<OnboardingRunView | null>(null);
  const [cost, setCost] = useState<OnboardingRunCostSummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const viewRef = useRef<OnboardingRunView | null>(null);
  useEffect(() => { viewRef.current = view; }, [view]);

  const loadMeta = useCallback(() => {
    getRepos().then((r) => setRepo(r.repos.find((x) => x.id === repoId) ?? null)).catch(() => setRepo(null));
    getOnboardingStages().then((s) => setDefs(s.stages)).catch((e) => setLoadErr(errText(e)));
    getLatestOnboardingRun(repoId).then((l) => { setLatest(l); if (l) setRunId((cur) => cur ?? l.runId); }).catch((e) => { setLatest(null); setLoadErr(errText(e)); });
    listOnboardingRuns(repoId).then((r) => setRuns(r.runs)).catch(() => {});
  }, [repoId]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const v = await getOnboardingRun(repoId, runId);
      setView(v); setLoadErr(null);
      getOnboardingRunCostSummary(repoId, runId).then(setCost).catch(() => {});
    } catch (e) { setLoadErr(errText(e)); }
  }, [repoId, runId]);

  // Poll fast while something executes, slowly while the run merely waits
  // on a person or on the PR, never once it is over.
  useEffect(() => {
    if (!runId) { setView(null); setCost(null); return; }
    let alive = true; let n = 0;
    void load();
    const iv = setInterval(() => {
      if (!alive || document.visibilityState !== "visible") return;
      n++;
      const v = viewRef.current;
      if (!v || v.run.id !== runId) { void load(); return; }
      const executing = v.driving || v.run.status === "Running" || v.run.status === "Pending" || v.stages.some((s) => s.status === "Running");
      const waiting = v.run.status === "WaitingForUser" || v.run.status === "AwaitingExternal";
      if (executing || (waiting && n % 4 === 0)) void load();
    }, 2500);
    return () => { alive = false; clearInterval(iv); };
  }, [runId, load]);

  const act = async (key: string, fn: () => Promise<unknown>, opts: { follow?: boolean; fireAndForget?: boolean } = {}) => {
    setBusy(key); setErr(null);
    try {
      if (opts.fireAndForget) {
        // A stage run (`advance`) returns only when the stage finishes —
        // minutes for discovery. Fire it, surface an immediate refusal,
        // and let polling show the progress.
        fn().catch((e) => setErr(errText(e)));
        await new Promise((res) => setTimeout(res, 500));
      } else await fn();
      if (opts.follow !== false) setSelectedKey(null);
      await load();
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(null); }
  };

  if (repo === undefined || latest === undefined || !defs) return <div className="spin">טוען…</div>;
  if (repo === null) return <div className="empty">Repository לא נמצא.</div>;

  const crumb = <a onClick={() => nav("#/repositories")}>← Repositories</a>;
  if (!repo.clientId) {
    return (
      <>
        <PageHead crumb={crumb} title={`הטמעת AI — ${repo.name}`} />
        <Note tone="warn">הטמעת AI זמינה רק ל-repository ששייך ללקוח יחיד — זה משותף בין כמה לקוחות.</Note>
      </>
    );
  }

  const showRun = !!runId && !showNew;
  if (!showRun) {
    return (
      <PreStart
        repoId={repoId} repo={repo} defs={defs} latest={latest} runs={runs} crumb={crumb} nav={nav}
        canReturn={!!runId}
        onReturn={() => setShowNew(false)}
        onStarted={(id) => { setShowNew(false); setSelectedKey(null); setView(null); setRunId(id); loadMeta(); }}
        onLegacyCancelled={() => { setRunId(null); setView(null); loadMeta(); }}
        onViewRun={(id) => { setShowNew(false); setSelectedKey(null); setView(null); setRunId(id); }}
      />
    );
  }

  if (!view) return <div className="spin">{loadErr ?? "טוען את ההרצה…"}</div>;
  const run = view.run;
  const byKey = new Map(view.stages.map((s) => [s.stageKey, s]));
  const merged: OnboardingStage[] = defs.map((d, i) => byKey.get(d.key) ?? {
    id: `pending-${d.key}`, runId: run.id, stageKey: d.key, stageOrder: i, status: "Pending", attempt: 0,
    startedAt: null, completedAt: null, result: null, warnings: [], errors: [], claudeExecutionId: null, sourceCommitSha: null, history: [], updatedAt: run.startedAt,
  });
  const settledCount = merged.filter((s) => SETTLED.has(s.status)).length;
  const executing = view.driving || view.stages.some((s) => s.status === "Running");
  const currentKey = run.currentStageKey;
  const lastTouched = [...merged].reverse().find((s) => s.status !== "Pending")?.stageKey ?? "scan";
  const selKey = selectedKey ?? currentKey ?? lastTouched;
  const selIdx = Math.max(0, merged.findIndex((s) => s.stageKey === selKey));
  const sel = merged[selIdx]!;
  const selDef = defs[selIdx]!;
  const isCurrent = sel.stageKey === currentKey;
  const waiting = isCurrent && run.status === "WaitingForUser" && sel.status === "WaitingForUser";
  const runOver = RUN_OVER.has(run.status);
  const nextUnsettled = merged.find((s) => !SETTLED.has(s.status));
  const nextDef = nextUnsettled ? defs.find((d) => d.key === nextUnsettled.stageKey) : undefined;
  const title = (k: string) => defs.find((d) => d.key === k)?.title_he ?? k;
  const deliver = (byKey.get("deliver")?.result ?? null) as DeliverResult | null;
  const legacy = run.onboardingVersion !== "v2";

  const stepClass = (s: OnboardingStage) => {
    const live = s.stageKey === currentKey && !runOver;
    if (s.status === "Running") return "live";
    if (s.status === "WaitingForUser") return "wait";
    if (s.status === "AwaitingExternal") return "ext";
    if (s.status === "Failed") return "fail";
    if (s.status === "CompletedWithWarnings") return "warn";
    if (s.status === "Completed") return "done";
    if (s.status === "Skipped") return "skip";
    return live ? "live" : "pend";
  };
  const glyph = (s: OnboardingStage) => s.status === "Running" ? <span className="spinner" style={{ width: 10, height: 10 }} />
    : s.status === "Completed" ? "✓" : s.status === "CompletedWithWarnings" ? "✓" : s.status === "WaitingForUser" ? "✋" : s.status === "AwaitingExternal" ? "⏳" : s.status === "Failed" ? "✕" : s.status === "Skipped" ? "–" : "○";

  const submitGate = (input: unknown) => act(`gate:${sel.stageKey}`, () => submitOnboardingStageInput(repoId, run.id, sel.stageKey, input));

  return (
    <>
      <PageHead
        crumb={crumb}
        title={`הטמעת AI — ${repo.name}`}
        sub={`${MODE_HE[run.mode] ?? run.mode} · הרצה ${run.id.slice(0, 8)} · התחילה ${fmtDate(run.startedAt)}${run.baselineSha ? ` · commit ${shortSha(run.baselineSha)}` : ""}${run.branchName ? ` · ענף ${run.branchName}` : ""}`}
        actions={
          <>
            <StatusPill status={run.status} />
            {runOver || run.status === "Failed" ? <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(true)}>הרצה חדשה…</button> : null}
            {!runOver && (
              <button className="btn btn-secondary btn-sm" disabled={busy === "cancel"} onClick={() => { if (confirm("לבטל את ההרצה? ה-worktree והענף המקומי יישארו, שום דבר לא נמחק.")) void act("cancel", () => cancelOnboardingRun(repoId, run.id)); }}>
                {busy === "cancel" ? "מבטל…" : "בטל הרצה"}
              </button>
            )}
          </>
        }
      />

      {legacy && <div style={{ marginBottom: 14 }}><Note tone="warn">ההרצה הזו נוצרה על ידי גרסה קודמת של התהליך ({run.onboardingVersion}) — ניתן לצפות בה או לבטל אותה, אך לא להמשיך. <button className="ob-toggle" onClick={() => setShowNew(true)}>התחילו הרצה חדשה</button>.</Note></div>}
      {err && <div style={{ marginBottom: 14 }}><Note tone="crit">{err}</Note></div>}
      {loadErr && <div style={{ marginBottom: 14 }}><Note tone="warn">{loadErr}</Note></div>}

      <div className="dash">
        <div style={{ minWidth: 0 }}>
          {/* progress + stepper */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="progress-block" style={{ margin: "0 0 12px" }}>
              <div className="top"><span className="l">{settledCount} מתוך {merged.length} שלבים הסתיימו</span><span>{Math.round((settledCount / merged.length) * 100)}%</span></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${(settledCount / merged.length) * 100}%` }} /></div>
            </div>
            <div className="ob-steps">
              {merged.map((s, i) => (
                <button key={s.stageKey} type="button" className={`ob-step ${stepClass(s)}${i === selIdx ? " active" : ""}`} onClick={() => setSelectedKey(s.stageKey)} title={defs[i]!.short_he}>
                  <span className="n"><span className="g">{glyph(s)}</span><span>שלב {i + 1}</span>{s.stageKey === currentKey && !runOver && <span style={{ color: "var(--color-accent)" }}>●</span>}</span>
                  <span className="t">{defs[i]!.title_he}</span>
                  <span className="s">{STATUS_HE[s.status]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* run-level action bar */}
          <div className="panel" style={{ marginBottom: 16 }}>
            {run.status === "Running" && executing && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="spinner" style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 13 }}><b>{currentKey ? title(currentKey) : "השלב הבא"}</b> רץ עכשיו · {byKey.get(currentKey ?? "")?.startedAt ? `מזה ${elapsedSince(byKey.get(currentKey ?? "")!.startedAt)}` : ""}</span>
                <span style={{ flex: 1 }} />
                {currentKey && (defs.find((d) => d.key === currentKey)?.kind === "ai" || defs.find((d) => d.key === currentKey)?.kind === "mixed") && (
                  <button className="btn btn-secondary btn-sm" disabled={busy === "stop"} onClick={() => act("stop", () => stopOnboardingExecution(repoId, run.id), { follow: false })}>{busy === "stop" ? "עוצר…" : "עצור את קריאת ה-AI"}</button>
                )}
              </div>
            )}
            {(run.status === "Running" || run.status === "Pending") && !executing && nextDef && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>השלב הבא, <b>{nextDef.title_he}</b>, מוגדר להתחלה ידנית.</span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-primary" disabled={!!busy || legacy} onClick={() => { setSelectedKey(nextDef.key); void act("advance", () => advanceOnboardingRun(repoId, run.id), { fireAndForget: true }); }}>{busy === "advance" ? "מתחיל…" : `▶ הרץ: ${nextDef.title_he}`}</button>
              </div>
            )}
            {run.status === "WaitingForUser" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>✋ <b>{currentKey ? title(currentKey) : ""}</b> ממתין להחלטה שלך — הטופס למטה.</span>
                <span style={{ flex: 1 }} />
                {!isCurrent && <button className="btn btn-primary btn-sm" onClick={() => setSelectedKey(null)}>עבור לשלב הממתין</button>}
              </div>
            )}
            {run.status === "AwaitingExternal" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>⏳ {deliver?.localOnly ? "ממתין למיזוג מקומי של הענף" : "ממתין למיזוג ה-Pull Request ב-Git"}{deliver?.prUrl && <> · <a href={deliver.prUrl} target="_blank" rel="noreferrer">PR #{deliver.prNumber ?? ""} ↗</a></>}{!deliver?.prUrl && deliver?.compareUrl && <> · <a href={deliver.compareUrl} target="_blank" rel="noreferrer">פתחו PR ↗</a></>}</span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act("advance", () => advanceOnboardingRun(repoId, run.id), { fireAndForget: true })}>{busy === "advance" ? "בודק…" : "בדוק שוב אם מוזג"}</button>
              </div>
            )}
            {run.status === "Failed" && (
              <div style={{ display: "grid", gap: 10 }}>
                <Note tone="crit"><b>{currentKey ? title(currentKey) : "השלב"} נכשל.</b> {byKey.get(currentKey ?? "")?.errors.join(" · ")}</Note>
                <div className="ob-actions">
                  <button className="btn btn-primary btn-sm" disabled={!!busy || legacy} onClick={() => act("advance", () => advanceOnboardingRun(repoId, run.id), { fireAndForget: true })}>{busy === "advance" ? "מנסה…" : "נסה שוב את השלב"}</button>
                  <ResetControl defs={defs} merged={merged} disabled={!!busy || legacy} onReset={(k, note) => act("reset", () => resetOnboardingRunTo(repoId, run.id, k, note))} />
                </div>
              </div>
            )}
            {(run.status === "Completed" || run.status === "CompletedWithWarnings") && (
              <Note tone="ok"><b>ה-Repository מוכן ל-AI.</b>{deliver?.readinessDate ? ` מאז ${fmtDate(deliver.readinessDate)} · commit ${shortSha(deliver.mergedSha)} · מתודולוגיה ${deliver.onboardingVersion}.` : ""} {run.status === "CompletedWithWarnings" ? "חלק מהשלבים הסתיימו עם אזהרות — ראו את הרשימה בצד." : ""} הידע מתיישן עם הקוד: בדיקת העדכניות בצד מזהה מתי נדרש רענון.</Note>
            )}
            {run.status === "Cancelled" && <Note tone="info">ההרצה בוטלה {fmtDate(run.cancelledAt)}. ה-worktree והענף המקומי לא נמחקו.</Note>}
          </div>

          {/* selected stage */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="ob-stage-head">
              <h3>{selIdx + 1}. {selDef.title_he}</h3>
              <StatusPill status={sel.status} />
              {isCurrent && !runOver && <span className="ob-chip ai">◀ השלב הפעיל</span>}
              {sel.attempt > 1 && <span className="ob-chip">ניסיון {sel.attempt}</span>}
              <span style={{ flex: 1 }} />
              <span className="ob-sub">
                {sel.startedAt ? `התחיל ${fmtTime(sel.startedAt)}` : ""}{sel.completedAt ? ` · הסתיים ${fmtTime(sel.completedAt)} (${fmtDuration(new Date(sel.completedAt).getTime() - new Date(sel.startedAt ?? sel.completedAt).getTime())})` : ""}
              </span>
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 8 }}>{selDef.short_he}</p>
            <div style={{ marginBottom: 12 }}><StageMetaChips def={selDef} /></div>
            <Explainer def={selDef} defaultOpen={!SETTLED.has(sel.status)} />
            {sel.warnings.length > 0 && <div style={{ marginTop: 12 }}><Note tone="warn"><ul className="ob-list">{sel.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Note></div>}
            {sel.errors.length > 0 && <div style={{ marginTop: 12 }}><Note tone="crit"><ul className="ob-list">{sel.errors.map((w, i) => <li key={i}>{w}</li>)}</ul></Note></div>}

            {sel.status === "Pending" && (
              <p className="ob-sub" style={{ marginTop: 12 }}>השלב עדיין לא רץ — {nextUnsettled?.stageKey === sel.stageKey ? "הוא הבא בתור." : "הוא יגיע אחרי השלבים שלפניו."}</p>
            )}
            {sel.status === "Running" && <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}><span className="spinner" style={{ width: 12, height: 12 }} /><span className="ob-sub">רץ עכשיו{sel.startedAt ? ` — מזה ${elapsedSince(sel.startedAt)}` : ""}. התוצאות יופיעו כאן כשיסתיים.</span></div>}

            {sel.result !== null && sel.result !== undefined && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--border-hairline)", paddingTop: 12 }}>
                <p className="section-lbl">{waiting ? "ההחלטה שלך" : "הממצאים והפלט"}</p>
                <StageFindings repoId={repoId} runId={run.id} stageKey={sel.stageKey} status={sel.status} result={sel.result} waiting={waiting} busy={busy === `gate:${sel.stageKey}`} mode={run.mode} onSubmit={submitGate} />
                <RawResult value={sel.result} />
              </div>
            )}

            {sel.claudeExecutionId && (
              <details style={{ marginTop: 14, borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 650 }}>הקריאה ל-Claude מאחורי השלב הזה (מודל, עלות, הרשאות, הפרומפט)</summary>
                <div style={{ marginTop: 10 }}><ClaudeCallPanel repoId={repoId} executionId={sel.claudeExecutionId} /></div>
              </details>
            )}

            {SETTLED.has(sel.status) && !runOver && !executing && run.status !== "AwaitingExternal" && !legacy && (
              <div className="action-row">
                <ResetControl defs={defs} merged={merged} fixed={sel.stageKey} disabled={!!busy} onReset={(k, note) => act("reset", () => resetOnboardingRunTo(repoId, run.id, k, note))} />
              </div>
            )}
            {Array.isArray(sel.history) && sel.history.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--ink-500)" }}>{sel.history.length} ניסיונות קודמים של השלב</summary>
                <ul className="ob-list" style={{ marginTop: 6 }}>
                  {(sel.history as { attempt?: number; status?: string; startedAt?: string | null; completedAt?: string | null; errors?: string[]; resetBy?: string }[]).map((h, i) => (
                    <li key={i}>ניסיון {h.attempt ?? i + 1}: {STATUS_HE[(h.status ?? "Pending") as OnboardingStatus] ?? h.status} · {fmtDate(h.startedAt)}{h.resetBy ? ` · אופס על ידי ${h.resetBy === "person" ? "אדם" : title(h.resetBy)}` : ""}{h.errors?.length ? ` · ${h.errors.join("; ")}` : ""}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>

        {/* rail */}
        <div className="rail">
          <AutomationPanel view={view} defs={defs} busy={busy === "automation"} disabled={runOver || legacy} onSave={(p, consent) => act("automation", () => updateOnboardingAutomation(repoId, run.id, p, consent), { follow: false })} />
          <div className="panel">
            <h4>עלות ההרצה</h4>
            <KV items={[
              { l: "עלות AI", v: fmtUsd(cost?.totalCostUsd ?? 0) },
              { l: "קריאות", v: fmtInt(cost?.executionCount ?? 0) },
              { l: "טוקנים (קלט / פלט)", v: `${fmtInt(cost?.totalInputTokens ?? 0)} / ${fmtInt(cost?.totalOutputTokens ?? 0)}` },
              { l: "זמן AI מצטבר", v: fmtDuration(cost?.totalDurationMs ?? 0) },
            ]} />
          </div>
          <WarningsPanel merged={merged} defs={defs} onPick={setSelectedKey} />
          <div className="panel">
            <h4>יומן החלטות ואירועים</h4>
            {view.events.length === 0 ? <p className="ob-sub">עדיין אין אירועים.</p> : (
              <div className="ob-timeline">
                {[...view.events].reverse().slice(0, 40).map((e) => {
                  const l = eventLabel(e, title);
                  return <div key={e.id}><span className="tm">{fmtTime(e.occurredAt)}</span><span style={{ color: l.tone === "critical" ? "var(--status-critical)" : l.tone === "warning" ? "var(--status-warning)" : l.tone === "ai" ? "var(--status-ai)" : "var(--ink-700)" }}>{l.text}</span></div>;
                })}
                {view.events.length > 40 && <p className="ob-sub">ועוד {view.events.length - 40} אירועים ישנים יותר.</p>}
              </div>
            )}
          </div>
          {(runOver || runs.some((r) => r.onboardingVersion === "v2" && (r.status === "Completed" || r.status === "CompletedWithWarnings"))) && (
            <LifecyclePanel repoId={repoId} runOver={runOver} disabled={!!busy} onStartRefresh={() => act("refresh-run", async () => {
              const { runId: id } = await startOnboardingRun(repoId, { mode: "refresh", automation: view.automation, consent: policyNeedsConsent(view.automation) });
              setShowNew(false); setSelectedKey(null); setView(null); setRunId(id); loadMeta();
            })} />
          )}
          {runs.length > 1 && (
            <div className="panel">
              <h4>הרצות קודמות</h4>
              <div style={{ display: "grid", gap: 6 }}>
                {runs.map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <a style={{ cursor: "pointer", fontWeight: r.id === run.id ? 700 : 500 }} onClick={() => { setSelectedKey(null); setView(null); setRunId(r.id); }}>{fmtDate(r.startedAt)}</a>
                    <span className="ob-sub">{MODE_HE[r.mode] ?? r.mode}{r.onboardingVersion !== "v2" ? ` · ${r.onboardingVersion}` : ""}</span>
                    <span style={{ flex: 1 }} />
                    <StatusPill status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────── */

function Explainer({ def, defaultOpen }: { def: StageDefinition; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [def.key, defaultOpen]);
  return (
    <div>
      <button type="button" className="ob-toggle" onClick={() => setOpen((v) => !v)}>{open ? "הסתר את ההסבר" : "למה השלב הזה, מה הוא עושה ומה הוא משפיע"}</button>
      {open && <div style={{ marginTop: 10, background: "var(--surface-tint-2)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "12px 14px" }}><StageExplainer def={def} /></div>}
    </div>
  );
}

function ResetControl({ defs, merged, fixed, disabled, onReset }: { defs: StageDefinition[]; merged: OnboardingStage[]; fixed?: string; disabled: boolean; onReset: (stageKey: string, note?: string) => void }) {
  const candidates = defs.filter((d) => merged.find((s) => s.stageKey === d.key)?.status !== "Pending");
  const [key, setKey] = useState(fixed ?? candidates[0]?.key ?? "scan");
  useEffect(() => { if (fixed) setKey(fixed); }, [fixed]);
  const [note, setNote] = useState("");
  const def = defs.find((d) => d.key === key);
  if (candidates.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {!fixed && (
        <select value={key} onChange={(e) => setKey(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-hairline)" }}>
          {candidates.map((d) => <option key={d.key} value={d.key}>{d.order + 1}. {d.title_he}</option>)}
        </select>
      )}
      {(key === "generate" || key === "discovery" || key === "plan") && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה ל-AI (אופציונלי)" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-hairline)", minWidth: 220 }} />}
      <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => { if (confirm(`לחזור לשלב "${def?.title_he ?? key}"? השלבים מכאן והלאה יאופסו ויורצו מחדש (התוצאות הקודמות נשמרות בהיסטוריה).`)) onReset(key, note.trim() || undefined); }}>
        {fixed ? "↺ הרץ מחדש מהשלב הזה" : "↺ חזור לשלב"}
      </button>
    </div>
  );
}

function AutomationPanel({ view, defs, busy, disabled, onSave }: { view: OnboardingRunView; defs: StageDefinition[]; busy: boolean; disabled: boolean; onSave: (p: AutomationPolicy, consent: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AutomationPolicy>(view.automation);
  const [consent, setConsent] = useState(false);
  useEffect(() => { if (!editing) setDraft(view.automation); }, [view.automation, editing]);
  const needs = policyNeedsConsent(draft);
  return (
    <div className="panel">
      <h4>אוטומציה</h4>
      <p style={{ fontSize: 12.5, marginBottom: 8 }}>{describePolicy(view.automation, defs)}</p>
      {!editing
        ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => { setDraft(view.automation); setConsent(false); setEditing(true); }}>שנה מדיניות</button>
        : (
          <div style={{ display: "grid", gap: 10 }}>
            <AutomationEditor stages={defs} value={draft} onChange={setDraft} consent={consent} onConsent={setConsent} />
            <p className="ob-sub">השינוי חל מיד: אם ההרצה ממתינה בשער שסומן "אוטומטי", הוא יאושר לפי ההצעות.</p>
            <div className="ob-actions">
              <button className="btn btn-primary btn-sm" disabled={busy || (needs && !consent)} onClick={() => { onSave(draft, consent); setEditing(false); }}>{busy ? "שומר…" : "שמור"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>ביטול</button>
            </div>
          </div>
        )}
    </div>
  );
}

function WarningsPanel({ merged, defs, onPick }: { merged: OnboardingStage[]; defs: StageDefinition[]; onPick: (k: string) => void }) {
  const items: { key: string; text: string; tone: "warn" | "unknown" | "fail" }[] = [];
  for (const s of merged) {
    for (const w of s.warnings) items.push({ key: s.stageKey, text: w, tone: "warn" });
    if (s.status === "Failed") for (const e of s.errors) items.push({ key: s.stageKey, text: e, tone: "fail" });
    if (s.stageKey === "discovery" && s.result) for (const u of ((s.result as DiscoveryResult).discovery?.unknowns ?? [])) items.push({ key: "discovery", text: `UNKNOWN: ${u}`, tone: "unknown" });
    if (s.stageKey === "confirm" && s.result) {
      const c = s.result as ConfirmResult;
      for (const a of c.answers ?? []) if (a.status === "unknown") items.push({ key: "confirm", text: `UNKNOWN: ${c.questions.find((q) => q.id === a.id)?.question_he ?? a.id}`, tone: "unknown" });
    }
  }
  const title = (k: string) => defs.find((d) => d.key === k)?.title_he ?? k;
  return (
    <div className="panel">
      <h4>אזהרות ו-UNKNOWN ({items.length})</h4>
      {items.length === 0 ? <p className="ob-sub">אין אזהרות פתוחות.</p> : (
        <div style={{ display: "grid", gap: 6 }}>
          {items.slice(0, 30).map((it, i) => (
            <div key={i} style={{ fontSize: 11.5, display: "grid", gridTemplateColumns: "8px 1fr", gap: 6, alignItems: "start" }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, marginTop: 5, background: it.tone === "fail" ? "var(--status-critical)" : it.tone === "warn" ? "var(--status-warning)" : "var(--status-ai)" }} />
              <span><a style={{ cursor: "pointer", fontWeight: 600 }} onClick={() => onPick(it.key)}>{title(it.key)}</a>: {it.text}</span>
            </div>
          ))}
          {items.length > 30 && <p className="ob-sub">ועוד {items.length - 30}.</p>}
        </div>
      )}
    </div>
  );
}

function LifecyclePanel({ repoId, runOver, disabled, onStartRefresh }: { repoId: string; runOver: boolean; disabled: boolean; onStartRefresh: () => void }) {
  const [metrics, setMetrics] = useState<{ totalChecks: number; noUpdateCount: number; updateRequiredCount: number; lastCheckedAt: string | null; lastResult: RefreshResult | null; avgDaysBetweenChecks: number | null } | null>(null);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMetrics = useCallback(() => { getOnboardingRefreshMetrics(repoId).then((m) => { setMetrics(m); setResult((r) => r ?? m.lastResult); }).catch(() => {}); }, [repoId]);
  useEffect(() => { loadMetrics(); }, [loadMetrics]);
  const check = async () => {
    setChecking(true); setError(null);
    try { setResult(await checkOnboardingRefresh(repoId)); loadMetrics(); } catch (e) { setError(errText(e)); } finally { setChecking(false); }
  };
  return (
    <div className="panel">
      <h4>מחזור חיי הידע</h4>
      <p className="ob-sub" style={{ marginBottom: 8 }}>הידע מתיישן עם הקוד. הבדיקה דטרמיניסטית קודם (manifests, נתיבים שמעדכנים artifact, עריכות ידניות, אורך CLAUDE.md, נתיבים שנעלמו, גיל) — וקריאת AI אחת רק כשמשהו זז.</p>
      {metrics && <p className="ob-sub" style={{ marginBottom: 8 }}>{metrics.totalChecks} בדיקות · {metrics.updateRequiredCount} דרשו עדכון · אחרונה {fmtDate(metrics.lastCheckedAt)}</p>}
      <div className="ob-actions">
        <button className="btn btn-secondary btn-sm" disabled={checking || !runOver} title={!runOver ? "זמין אחרי שההרצה תסתיים" : undefined} onClick={check}>{checking ? "בודק…" : "בדוק עדכניות עכשיו"}</button>
        <button className="btn btn-primary btn-sm" disabled={disabled || !runOver} onClick={onStartRefresh}>התחל הרצת רענון</button>
      </div>
      {error && <p style={{ fontSize: 12, color: "var(--status-critical)", marginTop: 8 }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 10 }}>
          <Note tone={result.updateRequired ? "warn" : "ok"}>
            <b>{result.updateRequired ? "נדרש רענון" : "הידע עדכני"}</b> · {result.reason_he}
            <div className="ob-sub" style={{ marginTop: 4 }}>נבדק {fmtDate(result.checkedAt)} · {shortSha(result.analyzedCommit)} → {shortSha(result.currentCommit)} · {result.changedPaths.length} קבצים השתנו</div>
          </Note>
          {result.signals.length > 0 && (
            <ul className="ob-list" style={{ marginTop: 8, fontSize: 11.5 }}>
              {result.signals.map((s, i) => <li key={i}><b>{s.kind}</b>: {s.detail}{s.artifacts.length ? ` (${s.artifacts.join(", ")})` : ""}</li>)}
            </ul>
          )}
          {result.ai && (
            <div style={{ marginTop: 8, fontSize: 11.5 }}>
              <b>שיפוט AI</b>{result.ai.reason_he !== result.reason_he ? `: ${result.ai.reason_he}` : ""}
              {result.ai.impactedArtifacts.length > 0 && <div style={{ marginTop: 4 }}>לעדכן: {result.ai.impactedArtifacts.map((p) => <Code key={p}>{p}</Code>)}</div>}
              {result.ai.requiredUpdates_he.length > 0 && <ul className="ob-list" style={{ marginTop: 4 }}>{result.ai.requiredUpdates_he.map((u, i) => <li key={i}>{u}</li>)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── before a run ───────────────────────────────────────────────────── */

function PreStart({ repoId, repo, defs, latest, runs, crumb, canReturn, onReturn, onStarted, onLegacyCancelled, onViewRun }: {
  repoId: string; repo: RepoLite; defs: StageDefinition[]; latest: LatestRun | null; runs: RunRow[]; crumb: React.ReactNode; nav: (h: string) => void;
  canReturn: boolean; onReturn: () => void; onStarted: (runId: string) => void; onLegacyCancelled: () => void; onViewRun: (runId: string) => void;
}) {
  const completedV2 = runs.find((r) => r.onboardingVersion === "v2" && (r.status === "Completed" || r.status === "CompletedWithWarnings"));
  const [mode, setMode] = useState<"initial" | "refresh">(completedV2 ? "refresh" : "initial");
  useEffect(() => { if (completedV2) setMode("refresh"); }, [completedV2?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [policy, setPolicy] = useState<AutomationPolicy>(() => presetPolicy(defs, "guided"));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const liveLatest = latest && isLiveStatus(latest.status) ? latest : null;
  const legacyLive = liveLatest && liveLatest.onboardingVersion !== "v2" ? liveLatest : null;
  const needs = policyNeedsConsent(policy);
  const gates = defs.filter((d) => d.gate);

  const start = async () => {
    setBusy("start"); setErr(null);
    try {
      const { runId } = await startOnboardingRun(repoId, { automation: policy, consent: needs ? consent : undefined, mode, previousRunId: mode === "refresh" ? completedV2?.id : undefined });
      onStarted(runId);
    } catch (e) { setErr(errText(e)); setBusy(null); }
  };

  return (
    <>
      <PageHead
        crumb={crumb}
        title={`הטמעת AI — ${repo.name}`}
        sub={`${repo.clientName ?? ""}${repo.adoRepoRef ? ` · ${repo.adoRepoRef}` : ""}`}
        actions={canReturn ? <button className="btn btn-secondary btn-sm" onClick={onReturn}>← חזרה להרצה</button> : undefined}
      />
      {err && <div style={{ marginBottom: 14 }}><Note tone="crit">{err}</Note></div>}
      {legacyLive && (
        <div style={{ marginBottom: 14 }}>
          <Note tone="warn">
            יש הרצה פעילה מגרסה קודמת של התהליך ({legacyLive.onboardingVersion}) — היא לא יכולה להמשיך בגרסה הנוכחית, ורק הרצה אחת יכולה להיות פעילה על repository.{" "}
            <button className="ob-toggle" disabled={busy === "cancel-legacy"} onClick={async () => { setBusy("cancel-legacy"); try { await cancelOnboardingRun(repoId, legacyLive.runId); onLegacyCancelled(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } }}>בטלו אותה</button>
            {" "}כדי להתחיל הרצה חדשה, או <button className="ob-toggle" onClick={() => onViewRun(legacyLive.runId)}>צפו בה</button>.
          </Note>
        </div>
      )}
      {liveLatest && !legacyLive && (
        <div style={{ marginBottom: 14 }}><Note tone="info">יש הרצה פעילה ({STATUS_HE[liveLatest.status]}). <button className="ob-toggle" onClick={() => onViewRun(liveLatest.runId)}>פתחו אותה</button> — רק הרצה אחת יכולה להיות פעילה על repository.</Note></div>
      )}

      <div className="dash">
        <div style={{ minWidth: 0 }}>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>מה התהליך עושה</h3>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink-700)" }}>
              DCC לומד את ה-Repository פעם אחת, מבוסס ראיות, ומשאיר בו רק את מה שמצדיק את קיומו: CLAUDE.md קצר שנטען בכל session ומפנה הלאה, ידע שנטען לפי דרישה (skills), rules לפי נתיבים כשיש הצדקה, הרשאות ו-guardrails דטרמיניסטיים, ו-hooks שמתעדים כל session ב-DCC.
              התהליך לא מניח ש-Repository ריק: מה שכבר קיים (CLAUDE.md, AGENTS.md, תיעוד, הנחיות לכלים אחרים) נסרק, נשקל, ולא משוכפל.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 12 }}>
              <div className="ob-q"><b style={{ fontSize: 12.5 }}>{gates.length} שערים אנושיים</b><p className="ob-sub" style={{ marginTop: 3 }}>{gates.map((g) => g.title_he).join(" · ")}</p></div>
              <div className="ob-q"><b style={{ fontSize: 12.5 }}>מה לעולם לא קורה לבד</b><p className="ob-sub" style={{ marginTop: 3 }}>מיזוג ל-default branch · הרצת סקריפטים של ה-repository · כתיבה מחוץ ל-worktree המבודד</p></div>
              <div className="ob-q"><b style={{ fontSize: 12.5 }}>{defs.filter((d) => d.kind === "ai" || d.kind === "mixed").length} קריאות AI מתוקצבות</b><p className="ob-sub" style={{ marginTop: 3 }}>קריאה-בלבד, מבודדות מתצורת ה-repository, נעצרות בחריגת תקציב</p></div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>תשעת השלבים — מה קורה בכל אחד, לפני שהוא רץ</h3>
              <button type="button" className="ob-toggle" onClick={() => setAllOpen((v) => !v)}>{allOpen ? "כווץ הכל" : "הרחב הכל"}</button>
            </div>
            <div className="ob-overview">
              {defs.map((d) => (
                <details key={`${d.key}-${allOpen}`} open={allOpen}>
                  <summary>
                    <span>{d.order + 1}. {d.title_he}</span>
                    <span className="s">{d.short_he}</span>
                    <span style={{ flex: 1 }} />
                    <StageMetaChips def={d} />
                  </summary>
                  <StageExplainer def={d} />
                </details>
              ))}
            </div>
          </div>
        </div>

        <div className="rail">
          <div className="panel">
            <h4>התחלת הרצה</h4>
            {completedV2 && (
              <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                <label style={{ display: "flex", gap: 8, fontSize: 12.5, cursor: "pointer", alignItems: "flex-start" }}><input type="radio" checked={mode === "refresh"} onChange={() => setMode("refresh")} style={{ marginTop: 3 }} /><span><b>רענון</b><br /><span className="ob-sub">ממשיך מה-onboarding שהושלם {fmtDate(completedV2.completedAt)}: ההחלטות הקודמות מולאות מראש, ה-Discovery ממוקד במה שהשתנה.</span></span></label>
                <label style={{ display: "flex", gap: 8, fontSize: 12.5, cursor: "pointer", alignItems: "flex-start" }}><input type="radio" checked={mode === "initial"} onChange={() => setMode("initial")} style={{ marginTop: 3 }} /><span><b>onboarding מלא מחדש</b><br /><span className="ob-sub">מתעלם מהריצה הקודמת (הקבצים הקיימים עדיין נסרקים ונשקלים).</span></span></label>
              </div>
            )}
            <p className="section-lbl">כמה מזה יקרה לבד</p>
            <AutomationEditor stages={defs} value={policy} onChange={setPolicy} consent={consent} onConsent={setConsent} />
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={!!busy || !!liveLatest || (needs && !consent)} onClick={start}>
                {busy === "start" ? "מתחיל…" : mode === "refresh" ? "▶ התחל רענון" : "▶ התחל onboarding"}
              </button>
              {liveLatest && <p className="ob-sub" style={{ marginTop: 6 }}>יש הרצה פעילה — סיימו או בטלו אותה קודם.</p>}
              {policy.stages.scan?.run === "manual" && !liveLatest && <p className="ob-sub" style={{ marginTop: 6 }}>במצב צעד-אחר-צעד ההרצה נוצרת ומחכה: השלב הראשון יתחיל רק בלחיצה שלכם.</p>}
            </div>
          </div>
          {runs.length > 0 && (
            <div className="panel">
              <h4>הרצות קודמות</h4>
              <div style={{ display: "grid", gap: 6 }}>
                {runs.map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <a style={{ cursor: "pointer" }} onClick={() => onViewRun(r.id)}>{fmtDate(r.startedAt)}</a>
                    <span className="ob-sub">{MODE_HE[r.mode] ?? r.mode}{r.onboardingVersion !== "v2" ? ` · ${r.onboardingVersion}` : ""}</span>
                    <span style={{ flex: 1 }} />
                    <StatusPill status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

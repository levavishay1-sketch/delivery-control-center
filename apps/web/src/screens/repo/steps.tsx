import { useState } from "react";
import {
  answerInterview, approveTrial, correctProfileFact,
  type AgentTest, type ConnectResult, type DiagnoseResult, type DiscoveredProcess, type InterviewAnswer, type InterviewQuestion, type OnboardingStepKey,
  type ProcessesResult, type ProfileCorrection, type ProfileFact, type TrialOutcome, type TrialStepResult,
} from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { CodeMapPanel } from "../../components/CodeMap.tsx";
import { BuildBody, DeliverBody } from "./build.tsx";
import { PlanBody } from "./plan.tsx";
import { Kv, NotYet, Tile, Working, isOver, type StepProps } from "./shared.tsx";
import { AGENT_TEST_HE, DECISION_HE, FAILURE_HE, JUDGE_HE, LEVEL_HE, PROCESS_SOURCE_HE, STEP_KIND_CHIP, fmtDate, fmtDuration, fmtInt, fmtUsd, shortSha } from "./labels.ts";

/**
 * One step of the dossier: its card (title, chips, the rerun button, the
 * "why this step" block) and the body of the first four steps. The plan is
 * in `plan.tsx`, the build and the delivery in `build.tsx`.
 */

/** The concept behind each step's "i" — one entry per step, the same the chat answers from. */
const STEP_INFO: Record<OnboardingStepKey, string> = {
  connect: "step_connect", diagnose: "step_diagnose", processes: "step_processes", trial: "step_trial", plan: "step_plan", build: "step_build", deliver: "step_deliver",
};

export function StepCard(p: StepProps) {
  const { def, step } = p;
  const kind = STEP_KIND_CHIP[def.kind];
  const [explain, setExplain] = useState(step.status === "Pending");
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="ob-stage-head">
        <CardTitle as="h3" info={STEP_INFO[def.key]}>{def.order + 1}. {def.title_he}</CardTitle>
        <span className={`rd-chip ${kind.cls}`}>{kind.label}</span><Info k="step_kind" />
        {step.status === "WaitingForUser" && <span className="rd-chip human">ממתין לך</span>}
        {step.status === "Running" && <span className="rd-chip ai">רץ עכשיו</span>}
        {step.status === "Completed" && <span className="rd-chip ok">הסתיים</span>}
        {step.status === "Failed" && <span className="rd-chip bad">נכשל</span>}
        <span className="grow" />
        {p.runnable && <button className="btn btn-primary btn-sm" disabled={!!p.busy} onClick={p.onRun}>{p.busy === `run:${def.key}` ? "מתחיל…" : step.status === "Failed" ? "▶ הרץ שוב" : "▶ הרץ"}</button>}
      </div>
      {step.status === "Failed" && step.errors.length > 0 && <div className="ob-note crit" style={{ marginBottom: 10 }}>{step.errors.join(" · ")}</div>}
      <StepBody {...p} />
      <div style={{ marginTop: 12 }}>
        <button type="button" className="ob-toggle" onClick={() => setExplain((v) => !v)}>{explain ? "הסתר את ההסבר" : "למה הצעד הזה, מה הוא עושה, מה הוא עולה ומה אתם מחליטים"}</button>
        {explain && (
          <div className="ob-explain">
            <div><b>למה</b><span>{def.why_he}</span></div>
            <div><b>מה</b><span>{def.what_he}</span></div>
            <div><b>תוצר</b><span>{def.output_he}</span></div>
            <div><b>עלות</b><span>{def.cost_he}</span></div>
            <div><b>אתם</b><span>{def.you_he}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepBody(p: StepProps) {
  switch (p.step.stepKey) {
    case "connect": return <ConnectBody {...p} />;
    case "diagnose": return <DiagnoseBody {...p} />;
    case "processes": return <ProcessesBody {...p} />;
    case "trial": return <TrialBody {...p} />;
    case "plan": return <PlanBody {...p} />;
    case "build": return <BuildBody {...p} />;
    case "deliver": return <DeliverBody {...p} />;
  }
}

/* ── 0. connect ───────────────────────────────────────────────────── */

function ConnectBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "Running") return <Working text="מושך את הריפו ופותח ענף… בריפו גדול זה לוקח דקה או שתיים." />;
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const r = step.result as ConnectResult;
  const ex = r.existing;
  const found = [
    ex.claudeMdLines !== null ? `CLAUDE.md (${ex.claudeMdLines} שורות)` : null, ex.agentsMd ? "AGENTS.md" : null, ex.rules ? `${ex.rules} rules` : null,
    ex.skills ? `${ex.skills} skills` : null, ex.hooks ? `${ex.hooks} hooks` : null, ex.agents ? `${ex.agents} agents` : null, ex.settings ? "settings.json" : null,
  ].filter(Boolean);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="ob-kv">
        <Kv label="נוצר מהענף" info="run_base_branch" code>{r.defaultBranch ?? "—"}</Kv>
        <Kv label="ענף" info="run_branch" code>{r.branch}</Kv>
        <Kv label="נקודת התחלה" info="run_baseline" code>{shortSha(r.baselineSha)}</Kv>
        <Kv label="קבצים" info="run_files">{fmtInt(r.fileCount)}</Kv>
      </div>
      {r.baseFrom === "head" && <div className="ob-note warn">לא נמצא ענף ראשי במאגר, ולכן ההרצה נגזרה מהענף שהעותק עמד עליו. מה שיש בענף הזה ולא בראשי ייכנס גם לבקשת המיזוג — בדקו לפני שממשיכים.</div>}
      <div className="rd-inline" style={{ fontSize: 12.5 }}><span>הגדרות AI קיימות<Info k="existing_ai_setup" />:</span><span>{found.length ? found.join(", ") : "אין — ההטמעה מתחילה ממאגר נקי."}</span></div>
      <div className="rd-inline" style={{ fontSize: 12.5 }}><span>מדרגת האוטומציה<Info k="automation_level" />:</span><span className="rd-chip det">{LEVEL_HE[r.level].title}</span></div>
      <div className="rd-inline" style={{ fontSize: 12.5 }}><span>מי אחראי<Info k="run_identity" />:</span><span>{p.users[view.run.triggeredBy] ?? "—"}</span></div>
      <CodeMapPanel map={view.codeMap} />
    </div>
  );
}

/* ── 1. diagnose — the profile, fact by fact ──────────────────────── */

function DiagnoseBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "Running") return <Working text="קורא את הקוד וההיסטוריה… בלי מודל, בלי עלות." />;
  const profile = view.profile;
  if (!profile) return <NotYet runnable={p.runnable} />;
  const r = step.status === "Completed" ? (step.result as DiagnoseResult) : null;
  const { repoId, id: runId } = view.run;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <CardTitle info="profile_card">מה מצאנו</CardTitle>
      {profile.summary && <p className="rd-lead" style={{ margin: 0 }}>{profile.summary}</p>}
      <ProfileFacts
        facts={profile.facts} corrections={profile.corrections} users={p.users} busy={p.busy} disabled={isOver(view)}
        onCorrect={(path, note) => void p.act(`fact:${path}`, () => correctProfileFact(repoId, runId, { path, note: note || null }))}
        onUndo={(path) => void p.act(`fact:${path}`, () => correctProfileFact(repoId, runId, { path, undo: true }))}
      />
      <div className="rd-inline"><span className="ob-sub">תגיות סטאק<Info k="stack_tags" /></span><div className="rd-tags">{profile.tags.length ? profile.tags.map((t) => <span className="rd-chip" key={t}>{t}</span>) : <span className="ob-sub">אין</span>}</div></div>
      {r && <p className="ob-sub" style={{ margin: 0 }}>{fmtInt(r.facts)} עובדות · נמשך {fmtDuration(r.durationMs)} · {profile.corrections.length} תיקונים</p>}
    </div>
  );
}

function ProfileFacts({ facts, corrections, users, busy, disabled, onCorrect, onUndo }: {
  facts: ProfileFact[]; corrections: ProfileCorrection[]; users: Record<string, string>; busy: string | null; disabled: boolean;
  onCorrect: (path: string, note: string) => void; onUndo: (path: string) => void;
}) {
  const [noting, setNoting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!facts.length) return <p className="ob-sub">הפרופיל ריק.</p>;
  return (
    <div className="rd-facts">
      {facts.map((f) => {
        const c = corrections.find((x) => x.path === f.path);
        return (
          <div key={f.path} className={`rd-fact ${f.corrected ? "corrected" : f.tone === "plain" ? "" : f.tone}`}>
            <span className="k">{f.label_he}<Info k={f.concept} /></span>
            <span className="v">{f.value_he}</span>
            <span className="a">
              {f.corrected
                ? <><span className="rd-chip bad">סומן כלא נכון</span><a style={{ cursor: "pointer", fontSize: 11.5 }} onClick={() => !disabled && onUndo(f.path)}>בטל</a></>
                : !disabled && noting !== f.path && <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => { setNoting(f.path); setNote(""); }}>זה לא נכון</button>}
              {!f.corrected && !disabled && noting !== f.path && <Info k="fact_wrong" />}
            </span>
            {f.corrected && c && <span className="note ob-sub">{c.note ? `"${c.note}" · ` : ""}{users[c.by] ?? c.by} · {fmtDate(c.at)}</span>}
            {noting === f.path && (
              <span className="note">
                <input className="rd-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה נכון? (לא חובה)" autoFocus />
                <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => { onCorrect(f.path, note.trim()); setNoting(null); }}>סמן כלא נכון</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setNoting(null)}>ביטול</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── 2. processes and the interview ───────────────────────────────── */

type ProcessesWaiting = { questions: InterviewQuestion[]; evidence: { source: string; title: string; lines: number }[] };

function ProcessesBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "WaitingForUser") return <Interview {...p} />;
  if (step.status === "Running") return <Working text="קלוד מפרק את התהליכים לצעדים ועורך לכל צעד את מבחן הסוכן… קריאה אחת למודל." />;
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const r = (step.result ?? {}) as Partial<ProcessesResult> & { reused?: boolean };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {r.reused && <div className="ob-note info">התהליכים נלקחו מההרצה הקודמת של המאגר — לא נשאלו שאלות ולא נעשתה קריאה למודל.</div>}
      {r.processes != null && (
        <div className="rd-tiles">
          <Tile n={r.processes} label="תהליכים" info="process_list" />
          <Tile n={r.steps ?? 0} label="צעדים" info="agent_test" />
          <Tile n={r.agents ?? 0} label="סוכנים" info="step_decision" />
          <Tile n={r.skills ?? 0} label="skills" info="step_decision" />
          <Tile n={`${r.answered ?? 0} / ${r.assumed ?? 0}`} label="תשובות / הנחות" info="interview_assumed" />
          <Tile n={fmtUsd(r.costUsd ?? 0)} label="עלות הצעד" info="step_cost" />
        </div>
      )}
      <AnswersGiven questions={view.interview.questions} answers={view.interview.answers} />
      <ProcessList processes={view.processes} />
    </div>
  );
}

function Interview(p: StepProps) {
  const w = (p.step.result ?? { questions: [], evidence: [] }) as ProcessesWaiting;
  const { repoId, id: runId } = p.view.run;
  // null = "I don't know": the key is left out of the answer, and the server records the default as an assumption.
  const [answers, setAnswers] = useState<Record<string, string | null>>(() => Object.fromEntries(w.questions.map((q) => [q.key, q.default])));
  const set = (key: string, value: string | null) => setAnswers((a) => ({ ...a, [key]: value }));
  const send = () => {
    const given: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) if (v !== null) given[k] = v;
    void p.act("interview", () => answerInterview(repoId, runId, given));
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <CardTitle info="interview">מה הקוד לא אומר</CardTitle>
      <p className="ob-sub" style={{ margin: 0 }}>{w.questions.length} שאלות. ברירת המחדל מסומנת; תשובה שלא ניתנה נרשמת כהנחה<Info k="interview_assumed" />, כדי שיהיה ברור מה ידוע ומה הונח.</p>
      {w.questions.map((q, i) => {
        const def = q.options.find((o) => o.value === q.default)?.label_he ?? q.default;
        return (
          <div className="rd-q" key={q.key}>
            <div className="qt">{i + 1}. {q.question_he}</div>
            <div className="ob-sub">{q.why_he}</div>
            <div className="opts">
              {q.options.map((o) => (
                <label key={o.value}><input type="radio" name={q.key} checked={answers[q.key] === o.value} onChange={() => set(q.key, o.value)} />{o.label_he}{o.value === q.default && <span className="ob-sub">(ברירת מחדל)</span>}</label>
              ))}
              <label className="dk"><input type="radio" name={q.key} checked={answers[q.key] === null} onChange={() => set(q.key, null)} />לא יודע — נניח "{def}"</label>
            </div>
          </div>
        );
      })}
      {w.evidence.length > 0 && (
        <div>
          <span className="ob-sub">ראיות לתהליכים שנאספו מהמאגר<Info k="process_list" /></span>
          <ul className="rd-list">{w.evidence.map((e, i) => <li key={i}>{PROCESS_SOURCE_HE[e.source] ?? e.source} · {e.title} · {fmtInt(e.lines)} שורות</li>)}</ul>
        </div>
      )}
      <div className="ob-actions">
        <button className="btn btn-primary" disabled={!!p.busy} onClick={send}>{p.busy === "interview" ? "שולח…" : "המשך לפירוק התהליכים"}</button>
        <span className="ob-sub">קריאה אחת למודל, סנטים בודדים.</span>
      </div>
    </div>
  );
}

function AnswersGiven({ questions, answers }: { questions: InterviewQuestion[]; answers: InterviewAnswer[] }) {
  if (!questions.length) return null;
  return (
    <div>
      <CardTitle info="interview">מה נענה בראיון</CardTitle>
      <ul className="rd-list plain" style={{ display: "grid", gap: 4 }}>
        {questions.map((q) => {
          const a = answers.find((x) => x.key === q.key);
          const label = q.options.find((o) => o.value === (a?.value ?? q.default))?.label_he ?? a?.value ?? q.default;
          return <li key={q.key} className="rd-inline"><span className="ob-sub">{q.question_he}</span><b>{label}</b>{a?.assumed && <><span className="rd-chip human">הנחה</span><Info k="interview_assumed" /></>}</li>;
        })}
      </ul>
    </div>
  );
}

function AgentTestIcons({ t }: { t: AgentTest }) {
  return (
    <span className="rd-at">
      {AGENT_TEST_HE.map((a) => <span key={a.key} className={t[a.key] ? "y" : ""} title={`${a.label}: ${t[a.key] ? "כן" : "לא"}${t.why ? ` — ${t.why}` : ""}`}>{t[a.key] ? "✓" : "–"}</span>)}
    </span>
  );
}

function ProcessList({ processes }: { processes: DiscoveredProcess[] }) {
  if (!processes.length) return <p className="ob-sub">לא נמצאו תהליכים חוזרים במאגר הזה.</p>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <CardTitle info="process_list">התהליכים שנמצאו ({processes.length})</CardTitle>
      {processes.map((pr) => (
        <div className="rd-proc" key={pr.key}>
          <div className="ph"><span>{pr.title}</span><span className="rd-chip det">{PROCESS_SOURCE_HE[pr.source] ?? pr.source}</span>{pr.trialTaskKey && <span className="rd-chip">יש משימת ניסיון</span>}</div>
          {pr.impossible && <div className="ob-note warn"><b>אי אפשר כאן<Info k="process_impossible" /></b> — {pr.impossible}</div>}
          {pr.evidence.length > 0 && <ul>{pr.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {pr.steps.length > 0 && (
            <table className="rd-table">
              {/* no-info: the step, what it does and the reason say what they are; the agent test and the decision open theirs */}
              <thead><tr><th>צעד</th><th>מה</th><th>מבחן הסוכן<Info k="agent_test" /></th><th>ההחלטה<Info k="step_decision" /></th><th>למה</th></tr></thead>
              <tbody>
                {pr.steps.map((s) => (
                  <tr key={s.key}>
                    <td><b>{s.title}</b></td>
                    <td>{s.what}</td>
                    <td><AgentTestIcons t={s.agentTest} /></td>
                    <td><span className={`rd-chip ${DECISION_HE[s.decision].cls}`}>{DECISION_HE[s.decision].label}</span></td>
                    <td className="dim">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── 3. the trial run ─────────────────────────────────────────────── */

function TrialBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "WaitingForUser" && view.trials.waiting) return <TrialGate {...p} />;
  if (step.status === "Running") {
    const planned = (step.result as { tasks?: unknown[] } | null)?.tasks?.length;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <Working text={`מריץ את משימות הניסיון ב-Claude Code, בקריאה בלבד… ${view.trials.baseline.length}${planned ? ` מתוך ${planned}` : ""} הסתיימו.`} />
        {view.trials.baseline.length > 0 && <TrialTable rows={view.trials.baseline} />}
      </div>
    );
  }
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const r = (step.result ?? {}) as Partial<TrialStepResult> & { reused?: boolean };
  const rows = view.trials.baseline;
  const passed = rows.filter((t) => t.passed === true).length;
  const cost = rows.reduce((a, t) => a + t.costUsd, 0);
  const byKind = Object.entries(r.byKind ?? {}).filter(([, n]) => n > 0);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {r.reused && <div className="ob-note info">נקודת ההתחלה נלקחה מההרצה הקודמת — משימות הניסיון לא רצו שוב.</div>}
      <CardTitle info="trial_tasks">נקודת ההתחלה: {passed} מתוך {rows.length} עברו · {fmtUsd(cost)}</CardTitle>
      {byKind.length > 0 && (
        <div className="rd-inline"><span className="ob-sub">סוגי הכישלון<Info k="failure_kind" /></span>{byKind.map(([k, n]) => <span key={k} className="rd-chip bad">{FAILURE_HE[k as keyof typeof FAILURE_HE] ?? k} × {n}</span>)}</div>
      )}
      {rows.length ? <TrialTable rows={rows} /> : <p className="ob-sub">לא נגזרו משימות ניסיון למאגר הזה.</p>}
    </div>
  );
}

function TrialGate(p: StepProps) {
  const w = p.view.trials.waiting!;
  const { repoId, id: runId } = p.view.run;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <CardTitle info="trial_tasks">משימות הניסיון ({w.tasks.length})</CardTitle>
      <ul className="rd-list plain" style={{ display: "grid", gap: 4 }}>
        {w.tasks.map((t) => <li key={t.key} className="rd-inline"><span>{t.title_he}</span><span className="rd-chip det">{JUDGE_HE[t.judge] ?? t.judge}</span></li>)}
      </ul>
      <p className="ob-sub" style={{ margin: 0 }}>מי שופט<Info k="trial_judge" />: הקוד כשאפשר לבדוק את התשובה מול הפרופיל, ומודל אחר מזה שביצע כשאי אפשר.</p>
      <div className="rd-inline" style={{ fontSize: 13 }}><span>עלות משוערת<Info k="trial_estimate" />:</span><b>{fmtUsd(w.estimateUsd)}</b></div>
      <div className="ob-actions">
        <button className="btn btn-primary" disabled={!!p.busy} onClick={() => void p.act("trial", () => approveTrial(repoId, runId))}>{p.busy === "trial" ? "מתחיל…" : `▶ הרץ את הניסיון (~${fmtUsd(w.estimateUsd)})`}</button>
        <Info k="trial_approve" />
        <span className="ob-sub">בקריאה בלבד, בעותק המבודד. שום קובץ לא נכתב.</span>
      </div>
    </div>
  );
}

/** The outcomes of one phase of the trial — the baseline, or the run after the build. */
export function TrialTable({ rows }: { rows: TrialOutcome[] }) {
  return (
    <table className="rd-table">
      {/* no-info: the task and the detail say what they are; the failure kind, the judge and the cost open theirs */}
      <thead><tr><th>משימה</th><th>תוצאה</th><th>סוג הכישלון<Info k="failure_kind" /></th><th>פירוט</th><th>מי שפט<Info k="trial_judge" /></th><th>עלות<Info k="ai_cost" /></th></tr></thead>
      <tbody>
        {rows.map((t) => (
          <tr key={`${t.phase}:${t.taskKey}`}>
            <td><b>{t.title_he}</b></td>
            <td>{t.passed === true ? <span className="rd-chip ok">✓ עבר</span> : t.passed === false ? <span className="rd-chip bad">✕ נכשל</span> : <span className="rd-chip">? לא הוכרע</span>}</td>
            <td>{t.failureKind ? FAILURE_HE[t.failureKind] : "—"}</td>
            <td className="dim">{t.detail}</td>
            <td className="dim">{t.judgedBy}</td>
            <td className="num">{fmtUsd(t.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

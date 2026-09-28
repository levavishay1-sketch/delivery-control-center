import { useState } from "react";
import {
  answerInterview, approveTrial, correctProfileFact,
  type AgentTest, type ConnectResult, type DiagnoseResult, type DiscoveredProcess, type EvalTaskKind, type GraderResult, type InterviewAnswer, type InterviewQuestion, type OnboardingStepKey,
  type ProcessesResult, type ProfileCorrection, type ProfileFact, type TrialOutcome, type TrialStepResult, type TrialWaiting,
} from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { CodeMapPanel } from "../../components/CodeMap.tsx";
import { BuildBody, DeliverBody } from "./build.tsx";
import { PlanBody } from "./plan.tsx";
import { Kv, NotYet, Tile, Working, isOver, type StepProps } from "./shared.tsx";
import { AGENT_TEST_HE, ARM_HE, DECISION_HE, FAILURE_HE, GRADER_HE, JUDGE_HE, LEVEL_HE, PROCESS_SOURCE_HE, STEP_KIND_CHIP, TASK_KIND_HE, fmtDate, fmtDuration, fmtInt, fmtUsd, shortSha } from "./labels.ts";

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
      <CardTitle info="step_description">תיאור השלב</CardTitle>
      <ComponentKindCatalog />
      <CardTitle info="profile_card">מה מצאנו</CardTitle>
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

/** The full, fixed catalog of what the diagnosis can end up justifying — every kind of component the system knows how to build, plain, on the page. Not an "i": it belongs to reading the diagnosis, not to one term. */
const KIND_CATALOG: { group: string; items: { name: string; what: string }[] }[] = [
  { group: "מלמדים את קלוד עובדה", items: [
    { name: "שורת הנחיה", what: "שורה שנכנסת ל-AGENTS.md/CLAUDE.md, נטענת בכל סשן." },
    { name: "מסמך", what: "קובץ נפרד (ב-docs/) עם הסבר מורחב על משהו — ארכיטקטורה, אינטגרציה." },
    { name: "skill", what: "נוהל כתוב: איך עושים משהו חוזר, צעד-צעד. קלוד קורא אותו רק כשצריך." },
  ] },
  { group: "מונעים או אוכפים", items: [
    { name: "hook", what: "סקריפט שרץ אוטומטית ועוצר פעולה אסורה בפועל — לא רק ממליץ." },
    { name: "הרשאה", what: "כלל ב-settings.json שחוסם גישה לקריאה או עריכה של קבצים מסוימים." },
    { name: "REVIEW.md", what: "כללים שסוקר-קוד נוסף (בוט או קלוד) בודק לפיהם." },
  ] },
  { group: "עוזרים נפרדים", items: [
    { name: "סוכן", what: "\"עובד\" נפרד עם ההקשר שלו, שקלוד הראשי קורא לו למשימה ספציפית." },
    { name: "LSP", what: "תוסף שנותן לקלוד ניווט מדויק בקוד — מי קורא לפונקציה הזו, מה הטיפוס שלה." },
  ] },
  { group: "חיבורים", items: [
    { name: "MCP", what: "חיבור למערכת חיצונית (מסד נתונים, API) שקלוד יכול לשאול." },
    { name: "plugin", what: "הרחבה מוכנה שמורידים ממקור חיצוני, למשל plugin רשמי." },
  ] },
  { group: "קבצי בסיס ותשתית", items: [
    { name: "קובץ בסיס", what: "קובץ קוד ראשוני שקלוד יוצר, כמו בדיקה ראשונה כשאין אף בדיקה." },
    { name: "הגדרות", what: "עצם קובץ settings.json — permissions ו-hooks מוגדרים." },
    { name: ".gitattributes", what: "מסמן קבצים (כמו קוד מג'ונרט) כך ש-git וסקירות מתייחסים אליהם אחרת." },
    { name: ".gitignore", what: "מוסיף שורות לקבצים שלא צריכים להיכנס למעקב git." },
    { name: "תבנית PR", what: "התבנית שממלאים כשפותחים בקשת מיזוג." },
    { name: "devcontainer", what: "הגדרת סביבת פיתוח קבועה, למשל לתוך Docker." },
    { name: "סקריפט", what: "פקודה אחת שמריצה בדיקה או אימות — קובץ הרצה בפועל, לא נוהל." },
  ] },
  { group: "דורשים מהלקוח", items: [
    { name: "מריץ", what: "לא קובץ — בקשה ממך: מכונה עם יכולת מסוימת (כמו Windows) שקלוד צריך גישה אליה." },
  ] },
  { group: "דיווח בלבד", items: [
    { name: "דיווח", what: "הודעה לבעלים, לא רכיב פעיל — למשל \"לא מומלץ סוכן X כי אין דרך לבדוק אותו\"." },
  ] },
];

function ComponentKindCatalog() {
  return (
    <div className="rd-kind-catalog">
      <p style={{ margin: "0 0 8px", fontSize: 12.5 }}>
        בשלב זה מתבצעת פעולה דטרמיניסטית שחוקרת את הריפו.
        <br />על הממצאים של השלב הזה מתבססות ההחלטות על אילו רכיבים להטמיע בריפו.
        <br />רכיבים אפשריים שיוקמו בעקבות השלב הזה:
      </p>
      {KIND_CATALOG.map((g) => (
        <div key={g.group} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 2 }}>{g.group}</div>
          <ul className="rd-list plain" style={{ display: "grid", gap: 2, paddingInlineStart: 20 }}>
            {g.items.map((it) => <li key={it.name}><b>{it.name}</b> — {it.what}</li>)}
          </ul>
        </div>
      ))}
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
      <ProcessList processes={view.processes} trials={view.trials.baseline} />
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

/** A trial outcome the process is tied to, when the trial already ran — so "already failed" can show the real task, not only a sentence. */
type TrialLink = { title_he: string; passed: boolean | null; failureKind: TrialOutcome["failureKind"]; detail: string } | null;

/**
 * Each question that came back "yes" is a button; pressing it opens what it
 * means for THIS step — the model's own reason for that question, and for
 * "already failed" the trial task that shows it when there is one.
 */
function AgentTestSummary({ t, trial }: { t: AgentTest; trial: TrialLink }) {
  const [open, setOpen] = useState<string | null>(null);
  const yes = AGENT_TEST_HE.filter((a) => t[a.key]);
  if (!yes.length) return <span className="ob-sub">אף תשובה לא "כן" — השלב לא צריך עזרה מיוחדת</span>;
  const shown = yes.find((a) => a.key === open);
  const reason = shown ? (t.reasons?.[shown.key] ?? t.why) : "";
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="rd-tags">
        {yes.map((a) => (
          <button key={a.key} type="button" className="rd-chip" aria-pressed={open === a.key} style={{ cursor: "pointer", border: open === a.key ? "1px solid var(--status-ai)" : undefined }} onClick={() => setOpen(open === a.key ? null : a.key)}>{a.label} ▾</button>
        ))}
      </span>
      {shown && (
        <div className="ob-note info" style={{ fontSize: 12.5 }}>
          <b>{shown.label}:</b> {reason || "המודל לא כתב סיבה לשאלה הזו בשלב הזה."}
          {shown.key === "failsToday" && trial && (
            <div style={{ marginTop: 6 }}>
              משימת המדידה "{trial.title_he}": {trial.passed === false ? `נכשלה — ${trial.failureKind ? FAILURE_HE[trial.failureKind] : "כישלון"}` : trial.passed === true ? "עברה" : "לא הוכרעה"}{trial.detail ? ` · ${trial.detail}` : ""}
            </div>
          )}
          {shown.key === "failsToday" && !trial && <div className="ob-sub" style={{ marginTop: 4 }}>הראיה מההיסטוריה של המאגר; המדידה עוד לא בדקה את התהליך הזה.</div>}
        </div>
      )}
    </div>
  );
}

/** `s.reason` opens with the decision words — the chip beside it says them; showing only the rest avoids saying it twice. */
const REASON_PREFIX = /^(סוכן|skill|כלום|אין צורך בסוכן או סקיל):\s*/;
const reasonTail = (reason: string) => reason.replace(REASON_PREFIX, "");

function ProcessList({ processes, trials }: { processes: DiscoveredProcess[]; trials: TrialOutcome[] }) {
  if (!processes.length) return <p className="ob-sub">לא נמצאו תהליכים חוזרים במאגר הזה.</p>;
  const trialOf = (key: string | null): TrialLink => {
    const o = key ? trials.find((x) => x.taskKey === key) : undefined;
    return o ? { title_he: o.title_he, passed: o.passed, failureKind: o.failureKind, detail: o.detail } : null;
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <CardTitle info="process_list">מועמדים לסקילים ולסוכנים, לפי התהליכים במאגר ({processes.length})</CardTitle>
      <p className="ob-sub" style={{ margin: 0 }}>לחצו על תשובת "כן" במבחן הסוכן כדי לראות מה בדיוק היא אומרת בשלב הזה.</p>
      {processes.map((pr) => (
        <div className="rd-proc" key={pr.key}>
          <div className="ph"><span>{pr.title}</span><span className="rd-chip det">{PROCESS_SOURCE_HE[pr.source] ?? pr.source}</span>{pr.trialTaskKey && <span className="rd-chip">יש משימת מדידה</span>}</div>
          {pr.impossible && <div className="ob-note warn"><b>אי אפשר כאן<Info k="process_impossible" /></b> — {pr.impossible}</div>}
          {pr.evidence.length > 0 && <ul>{pr.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {pr.steps.length > 0 && (
            <table className="rd-table">
              <thead><tr><th>שלב<Info k="process_step" /></th><th>פירוט השלב<Info k="process_step_detail" /></th><th>מבחן הסוכן<Info k="agent_test" /></th><th>ההחלטה<Info k="step_decision" /></th></tr></thead>
              <tbody>
                {pr.steps.map((s) => (
                  <tr key={s.key}>
                    <td><b>{s.title}</b></td>
                    <td>{s.what}</td>
                    <td><AgentTestSummary t={s.agentTest} trial={trialOf(pr.trialTaskKey)} /></td>
                    <td>
                      <span className={`rd-chip ${DECISION_HE[s.decision].cls}`}>{DECISION_HE[s.decision].label}</span>
                      <div className="dim" style={{ marginTop: 4 }}>{reasonTail(s.reason)}</div>
                    </td>
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

/* ── 3. the measurement, "without" ────────────────────────────────── */

function TrialBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "WaitingForUser" && view.trials.waiting) return <TrialGate {...p} />;
  const kinds = taskKinds(p);
  if (step.status === "Running") {
    const planned = (step.result as Partial<TrialWaiting> | null)?.tasks?.length;
    const cap = (step.result as Partial<TrialWaiting> | null)?.capUsd;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <Working text={`מריץ את משימות המדידה ב-Claude Code על עותק נקי, בלי שום רכיב… ${view.trials.baseline.length}${planned ? ` הרצות מתוך ${planned} משימות` : " הרצות"} הסתיימו${cap ? ` · נעצר בתקרה של ${fmtUsd(cap)}` : ""}.`} />
        {view.trials.baseline.length > 0 && <TrialRuns rows={view.trials.baseline} kinds={kinds} />}
      </div>
    );
  }
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const r = (step.result ?? {}) as Partial<TrialStepResult> & { reused?: boolean };
  const rows = view.trials.baseline;
  const tasks = view.trials.eval?.tasks ?? [];
  const total = r.tasks ?? (tasks.length || new Set(rows.map((t) => t.taskKey)).size);
  const passed = r.passed ?? tasks.filter((t) => t.without.passK).length;
  const cost = rows.reduce((a, t) => a + t.costUsd, 0);
  const byKind = Object.entries(r.byKind ?? {}).filter(([, n]) => n > 0);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {r.reused && <div className="ob-note info">נקודת ההתחלה נלקחה מההרצה הקודמת — משימות המדידה לא רצו שוב.</div>}
      <CardTitle info="trial_tasks">בלי שום רכיב: {passed} מתוך {total} משימות עוברות · {fmtUsd(cost)}</CardTitle>
      <p className="ob-sub" style={{ margin: 0 }}>משימה עוברת רק כשעברה בכל הרצה שלה<Info k="pass_k" />. אותן משימות ירוצו שוב אחרי הבנייה, עם בדיוק הסט שיימסר<Info k="eval_arms" />.</p>
      {r.stoppedAtCap && <div className="ob-note warn">המדידה נעצרה בתקרה<Info k="cost_envelope" /> — מה שנמדד עד אז נשמר; משימה שלא הספיקה לרוץ לא נכנסת לחישוב.</div>}
      {byKind.length > 0 && (
        <div className="rd-inline"><span className="ob-sub">סוגי הכישלון<Info k="failure_kind" /></span>{byKind.map(([k, n]) => <span key={k} className="rd-chip bad">{FAILURE_HE[k as keyof typeof FAILURE_HE] ?? k} × {n}</span>)}</div>
      )}
      {rows.length ? <TrialRuns rows={rows} kinds={kinds} /> : <p className="ob-sub">לא נגזרו משימות מדידה למאגר הזה.</p>}
    </div>
  );
}

/** Each task's kind (knowledge / action), from the measurement's summary or from the list that waited for approval. */
function taskKinds(p: StepProps): Record<string, EvalTaskKind> {
  const out: Record<string, EvalTaskKind> = {};
  // While it waits or runs, the step's result is the list of tasks; once it completed, `tasks` is only their count.
  const listed = (p.step.result as { tasks?: unknown } | null)?.tasks;
  if (Array.isArray(listed)) for (const t of listed as TrialWaiting["tasks"]) if (t.kind) out[t.key] = t.kind;
  for (const t of p.view.trials.eval?.tasks ?? []) out[t.key] = t.kind;
  return out;
}

function TrialGate(p: StepProps) {
  const w = p.view.trials.waiting!;
  const { repoId, id: runId } = p.view.run;
  // A run that waited here before the measurement had arms and a cap carries only the tasks and the estimate.
  const arms = w.arms ?? ["without"];
  const cap = typeof w.capUsd === "number" ? w.capUsd : null;
  const runs = (w.runs ?? 1) > 1 ? `${w.runs} הרצות לכל משימה` : "הרצה אחת לכל משימה";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <CardTitle info="trial_tasks">משימות המדידה ({w.tasks.length})</CardTitle>
      <table className="rd-table">
        {/* no-info: the task says what it is; the kind and the judge open theirs */}
        <thead><tr><th>משימה</th><th>סוג<Info k="eval_task_kind" /></th><th>מי שופט<Info k="trial_judge" /></th></tr></thead>
        <tbody>
          {w.tasks.map((t) => (
            <tr key={t.key}>
              <td>{t.title_he}</td>
              <td>{t.kind ? <span className="rd-chip">{TASK_KIND_HE[t.kind] ?? t.kind}</span> : "—"}</td>
              <td><span className="rd-chip det">{JUDGE_HE[t.judge] ?? t.judge}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ob-sub" style={{ margin: 0 }}>זרוע "{arms.map((a) => ARM_HE[a]).join("\" ו-\"")}"<Info k="eval_arms" /> · {runs}; משימה שעוברת רק בחלק מההרצות לא נחשבת עוברת<Info k="pass_k" />.</p>
      <div className="rd-inline" style={{ fontSize: 13 }}>
        <span>עלות משוערת<Info k="trial_estimate" />:</span><b>{fmtUsd(w.estimateUsd)}</b>
        {cap !== null && <><span style={{ marginInlineStart: 12 }}>תקרה<Info k="cost_envelope" />:</span><b>{fmtUsd(cap)}</b></>}
      </div>
      <div className="ob-actions">
        <button className="btn btn-primary" disabled={!!p.busy} onClick={() => void p.act("trial", () => approveTrial(repoId, runId))}>{p.busy === "trial" ? "מתחיל…" : `▶ הרץ את המדידה (~${fmtUsd(w.estimateUsd)}${cap !== null ? `, עד ${fmtUsd(cap)}` : ""})`}</button>
        <Info k="trial_approve" />
        <span className="ob-sub">על עותק זמני ונקי של המאגר. המאגר והענף לא משתנים.</span>
      </div>
    </div>
  );
}

const resultChip = (t: Pick<TrialOutcome, "passed" | "failureKind">) =>
  t.passed === true ? <span className="rd-chip ok">✓ עבר</span>
    : t.passed === false ? <span className="rd-chip bad">✕ נכשל{t.failureKind ? ` · ${FAILURE_HE[t.failureKind]}` : ""}</span>
      : <span className="rd-chip">? לא הוכרע</span>;

/**
 * The runs of one arm of the measurement, grouped by task in the order they first ran: each run with its
 * result and failure kind, cost, turns, the judge's detail and — on demand — what every code grader found.
 */
export function TrialRuns({ rows, kinds }: { rows: TrialOutcome[]; kinds?: Record<string, EvalTaskKind> }) {
  const groups = new Map<string, TrialOutcome[]>();
  for (const t of rows) groups.set(t.taskKey, [...(groups.get(t.taskKey) ?? []), t]);
  return (
    <table className="rd-table">
      {/* no-info: the task, the run number and the detail say what they are; the rest open theirs */}
      <thead><tr><th>משימה</th><th>הרצה</th><th>תוצאה<Info k="failure_kind" /></th><th>עלות<Info k="eval_run_cost" /></th><th>תורות<Info k="eval_turns" /></th><th>פירוט</th><th>הבודקים<Info k="graders_list" /></th></tr></thead>
      <tbody>
        {[...groups.entries()].map(([key, runs]) => [...runs].sort((a, b) => (a.runIndex ?? 0) - (b.runIndex ?? 0)).map((t, i) => (
          <tr key={`${t.phase}:${key}:${t.runIndex ?? i}`}>
            {i === 0 && (
              <td rowSpan={runs.length}>
                <b>{t.title_he}</b>
                {kinds?.[key] && <div style={{ marginTop: 4 }}><span className="rd-chip">{TASK_KIND_HE[kinds[key]!]}</span></div>}
              </td>
            )}
            <td className="num">{(t.runIndex ?? i) + 1}</td>
            <td>{resultChip(t)}</td>
            <td className="num">{fmtUsd(t.costUsd)}</td>
            <td className="num">{t.numTurns ?? "—"}</td>
            <td className="dim">{t.detail}{t.judgedBy ? <div style={{ marginTop: 2 }}>שפט: {t.judgedBy}</div> : null}</td>
            <td><Graders list={t.graders ?? []} /></td>
          </tr>
        )))}
      </tbody>
    </table>
  );
}

/** One run's code graders: a count that opens the list, ✓ or ✗ per grader with its detail. */
function Graders({ list }: { list: GraderResult[] }) {
  const [open, setOpen] = useState(false);
  if (!list.length) return <span className="ob-sub">—</span>;
  const ran = list.filter((g) => !g.skipped);
  const ok = ran.filter((g) => g.passed).length;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button type="button" className="ob-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{ok}✓ · {ran.length - ok}✗{list.length > ran.length ? ` · ${list.length - ran.length} דולגו` : ""} {open ? "▴" : "▾"}</button>
      {open && (
        <ul className="rd-list plain" style={{ display: "grid", gap: 3, minWidth: 220 }}>
          {list.map((g, i) => (
            <li key={i} style={{ color: g.skipped ? "var(--ink-500)" : g.passed ? "var(--status-healthy)" : "var(--status-critical)" }}>
              <b>{g.skipped ? "—" : g.passed ? "✓" : "✗"}</b> {GRADER_HE[g.type] ?? g.type}
              {g.detail ? <div className="ob-sub" style={{ marginInlineStart: 14 }}>{g.skipped ? "דולג: " : ""}{g.detail}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

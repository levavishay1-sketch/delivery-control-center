import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { evaluate, shapes, type Condition } from "./rules.ts";
import type { AgentCriterion, AgentTest, DiscoveredProcess, InterviewAnswer, InterviewQuestion, ProcessStep, RepoProfile, StepDecision } from "./types.ts";

/**
 * The repository's own processes — how a change of some kind is made HERE —
 * and the agent test that decides, per step, whether it needs an agent of
 * its own, a skill, or nothing. The deterministic part (evidence from the
 * history, the CI, the contribution rules, the templates; the interview) is
 * pure and tested; the model breaks processes into steps and answers the
 * five questions; the code decides from the answers. `runs.ts` wires the
 * call.
 */

/* ── the interview: at most four questions, each with a default ───── */

type BankQuestion = InterviewQuestion & { priority: number; when?: Condition };
const BANK = fileURLToPath(new URL("./interview.json", import.meta.url));
let bank: BankQuestion[] | null = null;
const loadBank = () => (bank ??= (JSON.parse(readFileSync(BANK, "utf8")) as { questions: BankQuestion[] }).questions);

export const MAX_QUESTIONS = 4;

export function interviewFor(profile: RepoProfile): InterviewQuestion[] {
  return loadBank()
    .filter((q) => !q.when || evaluate(q.when, profile))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_QUESTIONS)
    .map(({ priority: _p, when: _w, ...q }) => q);
}

/** Every question answered: what the person chose, or the default recorded as an assumption. */
export function resolveAnswers(questions: readonly InterviewQuestion[], given: Readonly<Record<string, string>>): InterviewAnswer[] {
  return questions.map((q) => {
    const v = given[q.key];
    const ok = v !== undefined && q.options.some((o) => o.value === v);
    return { key: q.key, value: ok ? v : q.default, assumed: !ok };
  });
}

export function renderInterview(questions: readonly InterviewQuestion[], answers: readonly InterviewAnswer[]): string {
  if (!questions.length) return "(no questions were needed for this repository)";
  return questions.map((q) => {
    const a = answers.find((x) => x.key === q.key);
    const label = q.options.find((o) => o.value === a?.value)?.label_he ?? a?.value ?? q.default;
    return `- ${q.question_he} → ${label}${a?.assumed ? " (assumed — nobody answered)" : ""}`;
  }).join("\n");
}

/* ── evidence the code gathers before the model is asked ──────────── */

export type ProcessEvidence = { source: DiscoveredProcess["source"]; title: string; lines: string[] };

const read = (dir: string, rel: string, limit = 6000): string | null => {
  const p = path.join(dir, rel);
  try { return existsSync(p) ? readFileSync(p, "utf8").slice(0, limit) : null; } catch { return null; }
};

/** What the code can show about processes without a model: repeated change
 *  shapes and co-changes from the history, what CI runs, the contribution
 *  rules, the pull-request template, the docs that describe a procedure. */
export function gatherEvidence(profile: RepoProfile, dir: string | null): ProcessEvidence[] {
  const out: ProcessEvidence[] = [];
  const sh = shapes(profile);
  if (sh.length) out.push({ source: "git", title: "Change shapes repeated in the history", lines: sh.slice(0, 6).map((s) => `${s.files.slice(0, 8).join(" + ")} — changed together ${s.times} times`) });
  const pairs = (profile.git.cochange_pairs ?? []).slice(0, 6);
  if (pairs.length) out.push({ source: "git", title: "Files that change together", lines: pairs.map((p) => `${p.a} + ${p.b} (${p.times} times)`) });
  const hot = (profile.git.hot_dirs ?? []).filter((h) => h.dir !== ".").slice(0, 4);
  if (hot.length) out.push({ source: "git", title: "Hot directories", lines: hot.map((h) => `${h.dir}: ${h.changes} changes by ${h.authors} authors`) });
  if (profile.ci.present) out.push({ source: "ci", title: `CI (${profile.ci.systems.join(", ")})`, lines: [...profile.ci.workflows.slice(0, 8).map((w) => `${w.file}${w.name ? ` — ${w.name}` : ""}`), ...profile.ci.commands.slice(0, 8).map((c) => `runs: ${c}`)] });
  for (const c of profile.docs.contributing.slice(0, 1)) {
    const text = dir ? read(dir, c) : null;
    out.push({ source: "contributing", title: c, lines: text ? text.split("\n").filter((l) => l.trim()).slice(0, 60) : ["(present; read it in the repository)"] });
  }
  for (const t of (profile.docs.pr_template ?? []).slice(0, 1)) {
    const text = dir ? read(dir, t, 3000) : null;
    out.push({ source: "pr_template", title: t, lines: text ? text.split("\n").filter((l) => l.trim()).slice(0, 40) : ["(present)"] });
  }
  const procDocs = [...profile.docs.architecture_docs, ...profile.docs.adrs].slice(0, 4);
  if (procDocs.length || profile.docs.docs_files) out.push({ source: "docs", title: "Documentation that may describe procedures", lines: [...procDocs, ...(profile.docs.docs_files ? [`docs/ (${profile.docs.docs_files} files)`] : [])] });
  if (profile.external_systems["Azure DevOps"] || profile.external_systems["Jira"]) out.push({ source: "tracker", title: "Work tracker referenced in the code", lines: Object.keys(profile.external_systems).filter((k) => k === "Azure DevOps" || k === "Jira") });
  if (profile.build.commands.length) out.push({ source: "docs", title: "Build and packaging", lines: profile.build.commands.slice(0, 3) });
  return out;
}

export const renderEvidence = (ev: readonly ProcessEvidence[]) => (ev.length ? ev.map((e) => `## ${e.title} (${e.source})\n${e.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n") : "(the code found no process evidence: no history shapes, no CI, no CONTRIBUTING, no PR template)");

/* ── reading the model's answer, and the decision the code makes ──── */

const bool = (v: unknown) => v === true || v === "true" || v === "yes";
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "process";

/**
 * Any yes on the five questions makes the step an agent candidate, named
 * after the step; a step that is a recurring, well-defined procedure with no
 * yes becomes a skill; a one-line action gets nothing. Recurring = the
 * process came from the history, the CI or a written rule (it repeats), or
 * the step names a procedure of several actions.
 */
/** The decision word when a step needs neither an agent nor a skill. */
export const NO_HELPER = "אין צורך בסוכן או סקיל";
const CRITERIA: readonly AgentCriterion[] = ["judgment", "externalInfo", "readsALot", "parallel", "failsToday"];

/** A step that is a procedure — several actions in order — in either language: the model now writes `what` in Hebrew, the history-only fallback may still carry English. */
const PROCEDURAL = /\b(then|after|before|run|update|regenerate|register|deploy|bump|sync|generate|migrat|import|export|publish|release|apply|commit|push)\b|(^|\s)(ואז|אחרי|לפני|להריץ|הרצת|לעדכן|עדכון|ליצור|לייצר|לרשום|רישום|לפרוס|פריסה|לפרסם|פרסום|לשחרר|שחרור|לסנכרן|לייבא|לייצא|מיגרציה|להעלות|לבנות|commit|push)/i;
export const isProcedural = (what: string) => PROCEDURAL.test(what) || what.split(/[,;،]| and | ואז /).length >= 2;

export function decideStep(test: AgentTest, recurring: boolean, what: string): { decision: StepDecision; reason: string } {
  const yes = (["judgment", "externalInfo", "readsALot", "parallel", "failsToday"] as const).filter((k) => test[k]);
  if (yes.length) {
    const he: Record<string, string> = { judgment: "צריך שיפוט עצמאי", externalInfo: "צריך מידע או גישה שאין לסוכן הראשי", readsALot: "צריך לקרוא הרבה", parallel: "יכול לרוץ במקביל", failsToday: "כבר נכשל בפועל" };
    return { decision: "agent", reason: `סוכן: ${yes.map((k) => he[k]).join(", ")}.` };
  }
  if (recurring && isProcedural(what)) return { decision: "skill", reason: "skill: נוהל חוזר עם כמה פעולות, בלי צורך בשיפוט נפרד." };
  return { decision: "none", reason: `${NO_HELPER}: פעולה אחת שהסוכן הראשי עושה לבד.` };
}

/** How strongly a step's answers call for an agent of its own: what fails today and what needs judgment or access weigh most. */
export const agentScore = (t: AgentTest) => (t.failsToday ? 3 : 0) + (t.judgment ? 2 : 0) + (t.externalInfo ? 2 : 0) + (t.readsALot ? 1 : 0) + (t.parallel ? 1 : 0);

export const MAX_AGENTS_PER_RUN = 4;

/**
 * A model answers "yes" generously. The rule of the design holds — any yes
 * makes a step a candidate — but a candidate is not yet an agent: one agent
 * per process (its strongest step), at most four per run, and every other
 * candidate becomes a skill when it is a procedure, or nothing. The person
 * sees the answers either way and can ask for more.
 */
export function capAgents(processes: DiscoveredProcess[], max = MAX_AGENTS_PER_RUN): DiscoveredProcess[] {
  const demote = (p: DiscoveredProcess, s: ProcessStep, why: string) => {
    const recurring = p.source !== "model" && p.source !== "interview";
    s.decision = recurring && isProcedural(s.what) ? "skill" : "none";
    s.reason = `${s.decision === "skill" ? "skill" : NO_HELPER}: ${why}`;
  };
  const winners: { p: DiscoveredProcess; s: ProcessStep; score: number }[] = [];
  for (const p of processes) {
    const candidates = p.steps.filter((s) => s.decision === "agent");
    if (!candidates.length) continue;
    const best = [...candidates].sort((a, b) => agentScore(b.agentTest) - agentScore(a.agentTest))[0]!;
    for (const s of candidates) if (s !== best) demote(p, s, `מועמד לסוכן, אבל התהליך מקבל סוכן אחד — הצעד "${best.title}" חזק יותר.`);
    winners.push({ p, s: best, score: agentScore(best.agentTest) });
  }
  winners.sort((a, b) => b.score - a.score);
  for (const w of winners.slice(max)) demote(w.p, w.s, `מועמד לסוכן, אבל הרצה מקבלת עד ${max} סוכנים והצעדים האחרים חזקים יותר.`);
  return processes;
}

export function parseProcesses(raw: string, trialsFailingSteps: ReadonlySet<string> = new Set()): DiscoveredProcess[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let obj: { processes?: unknown };
  try { obj = JSON.parse(raw.slice(start, end + 1)) as { processes?: unknown }; } catch { return []; }
  if (!Array.isArray(obj.processes)) return [];
  const out: DiscoveredProcess[] = [];
  const seen = new Set<string>();
  for (const p of obj.processes as Record<string, unknown>[]) {
    const title = str(p.title, 120);
    if (!title) continue;
    let key = slug(str(p.key) || title);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    const source = (["git", "ci", "contributing", "pr_template", "docs", "tracker", "interview", "model"] as const).find((s) => s === p.source) ?? "model";
    const recurring = source !== "model" && source !== "interview";
    const steps: ProcessStep[] = [];
    for (const s of (Array.isArray(p.steps) ? p.steps : []) as Record<string, unknown>[]) {
      const st = str(s.title, 120);
      if (!st) continue;
      const t = (s.agentTest ?? {}) as Record<string, unknown>;
      const failedInTrial = trialsFailingSteps.has(`${key}.${slug(str(s.key) || st)}`);
      const r = (t.reasons && typeof t.reasons === "object" ? t.reasons : {}) as Record<string, unknown>;
      const reasons: Partial<Record<AgentCriterion, string>> = {};
      for (const c of CRITERIA) { const v = str(r[c], 400); if (v && bool(t[c])) reasons[c] = v; }
      if (failedInTrial && !reasons.failsToday) reasons.failsToday = "משימת הניסיון שבודקת את התהליך הזה נכשלה.";
      const test: AgentTest = { judgment: bool(t.judgment), externalInfo: bool(t.externalInfo), readsALot: bool(t.readsALot), parallel: bool(t.parallel), failsToday: bool(t.failsToday) || failedInTrial, why: str(t.why, 400), reasons };
      const what = str(s.what, 400);
      const d = decideStep(test, recurring, what);
      steps.push({ key: slug(str(s.key) || st), title: st, what, agentTest: test, decision: d.decision, reason: d.reason });
    }
    if (!steps.length) continue;
    out.push({ key, title, source, evidence: (Array.isArray(p.evidence) ? p.evidence : []).map((e) => str(e, 300)).filter(Boolean).slice(0, 8), steps: steps.slice(0, 8), trialTaskKey: null, impossible: null });
  }
  return capAgents(out.slice(0, 12));
}

/** When the code itself can name a process without a model: the history's change shapes. Used when the model call fails, so the step is never empty by accident. */
export function processesFromEvidence(profile: RepoProfile): DiscoveredProcess[] {
  const out: DiscoveredProcess[] = [];
  for (const s of shapes(profile).slice(0, 3)) {
    const files = s.files.slice(0, 6);
    const key = slug(`change_${files[0]!.split("/").pop() ?? "shape"}`);
    out.push({
      key, title: `שינוי שנוגע יחד ב-${files.map((f) => f.split("/").pop()).join(", ")}`, source: "git",
      evidence: [`${files.join(" + ")} changed together ${s.times} times`],
      steps: files.map((f, i) => ({ key: slug(`edit_${f.split("/").pop() ?? i}`), title: `עדכון ${f.split("/").pop()}`, what: `לעדכן את ${f} כך שיתאים לשאר הקבצים שמשתנים איתו`, agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "מההיסטוריה בלבד" }, decision: "none" as StepDecision, reason: `${NO_HELPER}: חלק מהמתכון.` })),
      trialTaskKey: null, impossible: null,
    });
    // The recipe is the skill: the process as a whole repeats, so its first step carries the decision.
    out[out.length - 1]!.steps[0]!.decision = "skill";
    out[out.length - 1]!.steps[0]!.reason = "skill: נוהל חוזר מההיסטוריה.";
  }
  if (profile.ci.present && profile.ci.commands.length) {
    out.push({
      key: "verify_like_ci", title: "בדיקת שינוי כמו שה-CI בודק", source: "ci", evidence: profile.ci.commands.slice(0, 4),
      steps: [{ key: "run_ci_commands", title: "הרצת פקודות ה-CI מקומית", what: `להריץ ${profile.ci.commands.slice(0, 3).join("; ")} לפני שמכריזים שהשינוי גמור`, agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "ה-CI מגדיר מה נחשב תקין" }, decision: "skill", reason: "skill: נוהל חוזר מה-CI." }],
      trialTaskKey: null, impossible: null,
    });
  }
  return out;
}

export const renderProcesses = (ps: readonly DiscoveredProcess[]) => (ps.length
  ? ps.map((p) => `- ${p.title} [${p.source}]${p.impossible ? ` — impossible here: ${p.impossible}` : ""}\n${p.steps.map((s) => `    ${s.title}: ${s.decision}${s.agentTest.why ? ` (${s.agentTest.why})` : ""}`).join("\n")}`).join("\n")
  : "(no processes found)");

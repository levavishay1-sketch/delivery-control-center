import { FAILURE_TO_KIND, FAILURE_HE } from "./trials.ts";
import type {
  AutomationLevel, Component, ComponentFamily, ComponentGroup, ComponentKind, ComponentSeed, DiscoveredProcess, FailureKind, ProcessStep, Readiness, ReadinessItem, RepoProfile, TrialDelta, TrialOutcome,
} from "./types.ts";
import { FAMILY_ORDER } from "./types.ts";
import type { RuleFiring, RuleSuppression } from "./rules.ts";
import type { EvalSummary, TaskSummary } from "./eval/report.ts";

/**
 * Component cards: what a rule, a failed trial, a process step, the open
 * search, the reviewer or a person seeds becomes one card with its evidence,
 * its group (built and reported / waits for approval / not recommended here),
 * its risk and its decision. Pure: the grouping, the build order, the
 * readiness gate and the report the pull request carries are all here and
 * tested. `runs.ts` stores the cards and takes the decisions.
 */

export const KIND_HE: Record<ComponentKind, string> = {
  rule: "שורת הנחיה", hook: "hook", permission: "הרשאה", skill: "skill", agent: "סוכן", mcp: "MCP", plugin: "plugin", lsp: "LSP", scaffold: "קובץ בסיס",
  doc: "מסמך", report: "דיווח", runner: "מריץ", settings: "הגדרות", gitattributes: ".gitattributes", gitignore: ".gitignore", review: "REVIEW.md", pr_template: "תבנית PR", devcontainer: "devcontainer", script: "סקריפט",
};

export const FAMILY_HE: Record<ComponentFamily, string> = {
  safety: "בטיחות", verification: "אימות", knowledge: "ידע", connections: "חיבורים", skills: "skills", agents: "סוכנים", enforcement: "אכיפה", measurement: "מדידה ודיווח",
};

export const GROUP_HE: Record<ComponentGroup, string> = { auto: "נעשה ודווח", approval: "מחכה לאישורך", not_recommended: "לא מומלץ כאן" };

/** Which group a seed lands in: by problem and risk, then by the run's automation level. */
export function groupFor(seed: Pick<ComponentSeed, "kind" | "risk" | "notRecommended">, level: AutomationLevel): ComponentGroup {
  if (seed.notRecommended) return "not_recommended";
  if (seed.kind === "report") return "auto";
  if (seed.risk === "reversible" && level === "reversible_auto") return "auto";
  return "approval";
}

export function cardFromSeed(seed: ComponentSeed, level: AutomationLevel): Component {
  const group = groupFor(seed, level);
  return {
    key: seed.key, kind: seed.kind, family: seed.family, title_he: seed.title_he, why_he: seed.why_he, what_he: seed.what_he,
    source: seed.source, sourceRef: seed.sourceRef, group, risk: seed.risk, contextTokens: seed.contextTokens ?? estimateContextTokens(seed),
    verifyHow_he: seed.verifyHow_he, status: group === "not_recommended" ? "declined" : seed.kind === "report" ? "reported" : group === "auto" ? "approved" : "proposed",
    params: seed.params, files: [], validation: null, delta: null, questions: seed.questions ?? [], decidedBy: null, decidedAt: null, declineReason: group === "not_recommended" ? seed.why_he : null,
  };
}

/** What an always-loaded component adds to every session, roughly (a rule line ~30 tokens; a doc is read on demand; an MCP tool ~700). */
export function estimateContextTokens(seed: Pick<ComponentSeed, "kind" | "params">): number | null {
  switch (seed.kind) {
    case "rule": return Math.max(20, Math.round(String(seed.params.text ?? "").length / 4));
    case "scaffold": return seed.params.template === "agents-md" ? 1200 : 300;
    case "mcp": return (Array.isArray(seed.params.tools) ? seed.params.tools.length : 10) * 700;
    case "plugin": return 400;
    case "lsp": return 0;
    case "skill": return 60;
    case "agent": return 0;
    default: return 0;
  }
}

/* ── seeds from the other sources ─────────────────────────────────── */

/** A failed trial with no component already answering it becomes a card of the kind the failure points at. */
export function seedsFromTrials(trials: readonly TrialOutcome[], existing: readonly ComponentSeed[]): ComponentSeed[] {
  const out: ComponentSeed[] = [];
  const kindsPresent = new Set(existing.filter((s) => !s.notRecommended).map((s) => s.kind));
  for (const t of trials) {
    if (t.passed !== false || !t.failureKind) continue;
    const map = FAILURE_TO_KIND[t.failureKind];
    if (map.kinds.some((k) => kindsPresent.has(k))) continue; // the rules already put that kind of component in
    const kind = map.kinds[0]!;
    out.push({
      key: `trial_${t.taskKey}_${kind}`.slice(0, 60), kind, family: familyOf(kind), risk: kind === "mcp" || kind === "runner" ? "external" : kind === "rule" || kind === "doc" ? "reversible" : "significant",
      source: "trial", sourceRef: t.taskKey, title_he: `${KIND_HE[kind]} למשימה "${t.title_he}"`,
      why_he: `בריצת הניסיון המשימה "${t.title_he}" נכשלה: ${FAILURE_HE[t.failureKind]}. ${t.detail}`.trim(),
      what_he: `${map.he}. הרכיב נכתב מהמשימה עצמה ומהעובדות שחסרו לה.`, verifyHow_he: "אותה משימה רצה שוב אחרי הבנייה — עוברת או לא.",
      params: { fromTrial: t.taskKey, failureKind: t.failureKind, detail: t.detail },
    });
  }
  return out;
}

/** Every process step decided "agent" gets an agent named after it; every "skill" step gets a skill. */
const CRITERION_HE = { judgment: "שיפוט עצמאי", externalInfo: "מידע או גישה חסרים", readsALot: "הרבה קריאה", parallel: "ריצה במקביל", failsToday: "כבר נכשל בפועל" } as const;
/** The step's own reason per question that came back "yes" — or the older single sentence for a run written before per-question reasons. */
function agentTestWhy(s: DiscoveredProcess["steps"][number]): string {
  const r = s.agentTest.reasons ?? {};
  const parts = (Object.keys(CRITERION_HE) as (keyof typeof CRITERION_HE)[]).filter((k) => s.agentTest[k] && r[k]).map((k) => `${CRITERION_HE[k]}: ${r[k]}`);
  if (parts.length) return `במבחן הסוכן — ${parts.join("; ")}.`;
  return s.agentTest.why ? `במבחן הסוכן: ${s.agentTest.why}` : "";
}

export function seedsFromProcesses(processes: readonly DiscoveredProcess[]): ComponentSeed[] {
  const out: ComponentSeed[] = [];
  for (const p of processes) {
    if (p.impossible) continue;
    for (const s of p.steps) {
      if (s.decision === "none") continue;
      const kind: ComponentKind = s.decision;
      const yes = (["judgment", "externalInfo", "readsALot", "parallel", "failsToday"] as const).filter((k) => s.agentTest[k]);
      out.push({
        key: `${kind}_${p.key}_${s.key}`.slice(0, 60), kind, family: kind === "agent" ? "agents" : "skills", risk: kind === "agent" ? "significant" : "reversible",
        source: "process", sourceRef: `${p.key}.${s.key}`,
        title_he: kind === "agent" ? `סוכן: ${s.title} (${p.title})` : `skill: ${s.title} (${p.title})`,
        why_he: `${s.reason} ${agentTestWhy(s)}${p.evidence.length ? ` ראיה לתהליך: ${p.evidence[0]}` : ""}`.trim(),
        what_he: kind === "agent"
          ? "סוכן משנה עם היקף מהקבצים של הצעד, כלים מינימליים, ורשימת בדיקה שקלוד מנסח מהראיות (הערות סקירה, באגים). \"מתי לקרוא לי\" נבדק על משימות אמיתיות."
          : `נוהל אחד לצעד "${s.title}": הקבצים, הפקודות והסדר — כפי שנעשה כאן.`,
        verifyHow_he: kind === "agent" ? "מריצים על שינוי עם באג ידוע ורואים שנתפס; בודקים שאין אזעקות שווא; עם ובלי." : "validate; eval עם ובלי על משימה מהתהליך.",
        params: { process: p.key, processTitle: p.title, step: s.key, stepTitle: s.title, what: s.what, reasons: yes, evidence: p.evidence, template: kind === "agent" ? "process-agent" : "process-skill" },
      });
    }
  }
  return out;
}

export function familyOf(kind: ComponentKind): ComponentFamily {
  switch (kind) {
    case "permission": case "gitignore": case "gitattributes": case "settings": return "safety";
    case "hook": return "enforcement";
    case "script": case "runner": case "devcontainer": return "verification";
    case "rule": case "doc": case "scaffold": return "knowledge";
    case "mcp": case "plugin": case "lsp": return "connections";
    case "skill": return "skills";
    case "agent": case "review": case "pr_template": return "agents";
    case "report": return "measurement";
  }
}

/** The longest key a seed gets — longer ones are cut, so two different seeds can arrive with one key. */
export const KEY_MAX = 60;

/** The same component seen twice (same kind; a key that was not cut, or the same thing it stands for) — not two different ones whose keys met at the cut. */
function sameComponent(a: ComponentSeed, b: ComponentSeed): boolean {
  if (a.kind !== b.kind) return false;
  if (a.key.length < KEY_MAX) return true;
  const what = (s: ComponentSeed) => (s.source === "process" || s.source === "trial" ? `${s.source}:${s.sourceRef}` : null);
  return what(a) === null || what(b) === null || what(a) === what(b);
}

/**
 * Two seeds for the same component: the later one's evidence joins the earlier one's, nothing is lost. Two different
 * seeds whose keys met (cut at 60 characters, or another kind under the same key) are never merged: the later one
 * gets `-2`, `-3`… so each keeps its own card.
 */
export function mergeSeeds(...lists: readonly (readonly ComponentSeed[])[]): ComponentSeed[] {
  const byKey = new Map<string, ComponentSeed>();
  const join = (into: ComponentSeed, s: ComponentSeed) => {
    if (!into.why_he.includes(s.why_he)) into.why_he = `${into.why_he} וגם: ${s.why_he}`;
    into.sourceRef = [into.sourceRef, s.sourceRef].filter(Boolean).join(",");
  };
  for (const list of lists) for (const s of list) {
    const prev = byKey.get(s.key);
    if (!prev) { byKey.set(s.key, { ...s }); continue; }
    if (sameComponent(prev, s)) { join(prev, s); continue; }
    // A different component under a taken key: the next free `-n`, unless that one is this same component seen before.
    const suffixed = (n: number) => `${s.key.slice(0, KEY_MAX - String(n).length - 1)}-${n}`;
    const same = (twin: ComponentSeed) => twin.kind === s.kind && (twin.source === "process" || twin.source === "trial" ? (twin.sourceRef ?? "").split(",").includes(s.sourceRef ?? "") : true);
    let n = 2;
    while (byKey.has(suffixed(n)) && !same(byKey.get(suffixed(n))!)) n++;
    const twin = byKey.get(suffixed(n));
    if (twin) join(twin, s); else byKey.set(suffixed(n), { ...s, key: suffixed(n) });
  }
  return [...byKey.values()];
}

/** What goes out in the delivery: a component the build verified, or a connection it configured for the client. */
export const deliverable = (c: Pick<Component, "status">): boolean => c.status === "verified" || c.status === "configured";

/* ── the build order and the readiness gate ───────────────────────── */

/** By family; within a family, what was taken from the `/init` draft comes after ours, so it is added to the files ours wrote and never shapes them. */
export const buildOrder = (cards: readonly Component[]): Component[] =>
  [...cards].sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || Number(a.source === "init") - Number(b.source === "init") || a.key.localeCompare(b.key));

export type ReadinessInput = {
  cards: readonly Component[];
  processes: readonly DiscoveredProcess[];
  trials: readonly TrialOutcome[];
  delta: TrialDelta | null;
  reviewerOpen: number;
  suppressed: readonly RuleSuppression[];
  firings: readonly RuleFiring[];
  windowsOnly: boolean;
  hasRunner: boolean;
  /** What every session loads before it starts (AGENTS.md, CLAUDE.md, rules, MCP tools) — `jointCheck.alwaysLoadedTokens`; null before the build. */
  alwaysLoadedTokens?: number | null;
};

/** The most an onboarded repository may load into every session: a line that is always loaded must earn its place. */
export const ALWAYS_LOADED_MAX = 3000;

/** "Have we done everything we could for this repository?" — each question answered from the record. */
export function readiness(i: ReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  // 1. Every process has a passing trial, or an explicit "impossible here because".
  const after = i.trials.filter((t) => t.phase === "after");
  const pool = after.length ? after : i.trials.filter((t) => t.phase === "baseline");
  const noTrial = i.processes.filter((p) => !p.impossible && !pool.some((t) => t.taskKey === `process_${p.key}`.slice(0, 60) && t.passed === true));
  items.push({ key: "processes", title_he: "לכל תהליך יש ריצת ניסיון שעוברת, או הסבר למה אי אפשר כאן", ok: noTrial.length === 0, detail_he: noTrial.length ? `בלי ניסיון שעובר: ${noTrial.map((p) => p.title).slice(0, 4).join(", ")}` : `${i.processes.length} תהליכים, ${i.processes.filter((p) => p.impossible).length} מסומנים כבלתי אפשריים כאן` });
  // 2. Every family has a written decision.
  const undecided = FAMILY_ORDER.filter((f) => i.cards.some((c) => c.family === f && c.status === "proposed"));
  const familiesWithCards = new Set(i.cards.map((c) => c.family));
  const familiesEmpty = FAMILY_ORDER.filter((f) => !familiesWithCards.has(f));
  items.push({ key: "families", title_he: "לכל משפחת רכיבים יש החלטה: הותקן / לא צריך כי / אי אפשר כי / נדחה", ok: undecided.length === 0, detail_he: undecided.length ? `מחכים להחלטה: ${undecided.map((f) => FAMILY_HE[f]).join(", ")}` : familiesEmpty.length ? `בלי רכיב, כי שום כלל לא ירה: ${familiesEmpty.map((f) => FAMILY_HE[f]).join(", ")}` : "כל המשפחות הוכרעו" });
  // 3. The reviewer raised no open gap.
  items.push({ key: "reviewer", title_he: "הסוקר לא השאיר פער פתוח", ok: i.reviewerOpen === 0, detail_he: i.reviewerOpen ? `${i.reviewerOpen} כרטיסים מהסוקר עוד לא הוכרעו` : "כל מה שהסוקר העלה הוכרע" });
  // 4. The set improved on the tasks — "the same" is not an improvement — and every component measured earned its place:
  //    a knowledge component by making its tasks pass, a safety one by being seen blocking (the measurement calls both "improved").
  const d = i.delta;
  const improved = !!d && d.after.passed > d.before.passed;
  const worse = !!d && d.after.passed < d.before.passed;
  const unproven = i.cards.filter((c) => deliverable(c) && c.delta && c.delta.verdict !== "unmeasured" && c.delta.verdict !== "improved");
  // A set with no knowledge component — safety, enforcement, verification, connections only — has nothing that must make tasks
  // pass; it must only not harm. That is the honest end state of a repository that already tells the agent what it needs.
  const knowledgeDelivered = i.cards.filter((c) => deliverable(c) && KNOWLEDGE_KINDS.has(c.kind));
  const nothingToProve = !!d && !worse && knowledgeDelivered.length === 0;
  items.push({
    key: "delta", title_he: "המדידה עם ובלי מראה שיפור, וכל רכיב שנמדד הרוויח את מקומו", ok: (improved && unproven.length === 0) || nothingToProve,
    detail_he: !d ? "עוד לא נמדד — הבנייה מריצה את המשימות עם הסט"
      : nothingToProve ? `אין רכיב ידע בסט — בטיחות וחיבורים לא צריכים לשפר משימות, רק לא להזיק: ${d.before.passed}/${d.before.total} → ${d.after.passed}/${d.after.total}`
      : worse ? `פחות משימות עוברות (${d.before.passed}/${d.before.total} → ${d.after.passed}/${d.after.total}) — משהו בסט מפריע; לבדוק את הרכיבים שנוספו`
      : !improved ? `אותה תוצאה (${d.after.passed}/${d.after.total}) — "אותו דבר" אינו שיפור; רכיב שלא הוכח מוצע להסרה`
      : unproven.length ? `${d.before.passed}/${d.before.total} → ${d.after.passed}/${d.after.total}, אבל לא הוכחו: ${unproven.map((c) => c.title_he).slice(0, 4).join(", ")}${unproven.length > 4 ? ` ועוד ${unproven.length - 4}` : ""}`
      : `${d.before.passed}/${d.before.total} → ${d.after.passed}/${d.after.total}`,
  });
  // 5. What every session loads stays small.
  const tokens = i.alwaysLoadedTokens ?? null;
  items.push({ key: "context", title_he: `ההקשר שנטען בכל סשן עד ${ALWAYS_LOADED_MAX.toLocaleString("en-US")} טוקנים`, ok: tokens !== null && tokens <= ALWAYS_LOADED_MAX, detail_he: tokens === null ? "עוד לא נספר — נספר אחרי הבנייה" : tokens <= ALWAYS_LOADED_MAX ? `~${tokens.toLocaleString("en-US")} טוקנים` : `~${tokens.toLocaleString("en-US")} טוקנים — יותר מדי: כל שורה שנטענת תמיד צריכה להרוויח את מקומה` });
  const honesty: string[] = [];
  if (i.windowsOnly && !i.hasRunner) honesty.push("בריפו הזה אי אפשר להריץ build ובדיקות מהמכונה של DCC (build רק ב-Windows). עד שיהיה מריץ Windows, כל משימה מסומנת \"לא אומת כאן\" והסוקר עובד review-only. מה צריך: מכונת Windows אחת עם Claude Code ו-Visual Studio Build Tools.");
  for (const c of i.cards) if (c.kind === "runner" && c.status !== "declined") honesty.push(`${c.title_he}: ${c.what_he}`);
  for (const t of pool) if (t.passed === false && t.failureKind === "cannot_verify") honesty.push(`המשימה "${t.title_he}" לא ניתנת לאימות כאן: ${t.detail}`);
  for (const s of i.suppressed) honesty.push(`הכלל ${s.rule} לא הופעל כי סימנת את העובדה "${s.fact}" כלא נכונה${s.note ? ` (${s.note})` : ""}.`);
  for (const c of i.cards) if (c.status === "failed") honesty.push(`${c.title_he}: האימות נכשל — ${c.validation?.detail ?? ""}`);
  return { ready: items.every((x) => x.ok), items, honesty: [...new Set(honesty)] };
}

/* ── the report the pull request carries — from the cards, never free text ── */

const VERDICT_HE: Record<TaskSummary["verdict"], string> = { improved: "השתפר", same: "ללא שינוי", worse: "נפגע", unmeasured: "לא נמדד" };
const passedOf = (a: TaskSummary["with"]) => (a.runs ? `${a.passed}/${a.runs}` : "—");

/** The `.mcp.json` entry a client adds once they fill the slot in its address — the build does not write an address it cannot use. */
function mcpInstruction(c: Component): string {
  const server = String(c.params.server ?? c.params.name ?? c.key);
  const url = typeof c.params.url === "string" && c.params.url ? c.params.url : null;
  const entry = url ? { type: "http", url } : { command: String(c.params.command ?? "<command>"), args: Array.isArray(c.params.args) ? c.params.args : [] };
  const slot = url?.match(/\{[a-z_]+\}/gi)?.join(", ");
  return [`**${c.title_he}** — ${slot ? `להשלים את ${slot} בכתובת לפי הסביבה שלכם, ` : ""}ולהוסיף ל-\`.mcp.json\` בשורש הריפו:`, "", "```json", JSON.stringify({ mcpServers: { [server]: entry } }, null, 2), "```"].join("\n");
}

export function pullRequestReport(input: { repoName: string; cards: readonly Component[]; delta: TrialDelta | null; readiness: Readiness; branch: string; baselineSha: string | null; evalSummary?: EvalSummary | null }): string {
  const verified = input.cards.filter((c) => c.status === "verified");
  const configured = input.cards.filter((c) => c.status === "configured");
  const toFill = configured.filter((c) => c.kind === "mcp" && !c.files.includes(".mcp.json"));
  const failed = input.cards.filter((c) => c.status === "failed");
  const declined = input.cards.filter((c) => c.status === "declined" && c.group !== "not_recommended");
  const notHere = input.cards.filter((c) => c.group === "not_recommended");
  const reported = input.cards.filter((c) => c.kind === "report" && c.status === "reported");
  const deferred = input.cards.filter((c) => c.status === "deferred" || c.kind === "runner");
  const files = (c: Component) => (c.files.length ? `: ${c.files.slice(0, 3).map((f) => `\`${f}\``).join(", ")}${c.files.length > 3 ? ` +${c.files.length - 3}` : ""}` : "");
  const checked = (c: Component) => (c.validation ? ` נבדק: ${c.validation.how} → ${c.validation.passed === true ? "עבר" : "נכשל"}${c.validation.detail ? ` (${c.validation.detail})` : ""}.` : "");
  const line = (c: Component) => `- **${c.title_he}** (${KIND_HE[c.kind]}${files(c)}) — כי: ${c.why_he}${checked(c)}`;
  const out: string[] = [`# הטמעת AI ל-${input.repoName}`, ""];
  out.push("## התקנתי ואימתתי", "", ...(verified.length ? verified.map(line) : ["- (שום רכיב לא אומת)"]), "");
  if (configured.length) out.push("## הוגדר, יחובר אצל הלקוח", "", ...configured.map((c) => `- **${c.title_he}** (${KIND_HE[c.kind]}${files(c)}) — כי: ${c.why_he}${c.validation?.detail ? ` ${c.validation.detail}.` : ""}`), "");
  if (toFill.length) out.push("### ‎.mcp.json — להשלים אצלכם", "", ...toFill.map((c) => `${mcpInstruction(c)}\n`), "");
  // What failed is not in this pull request: no files named, only what it was and why it did not pass.
  if (failed.length) out.push("## נבנה ונכשל באימות — לא נכלל", "", ...failed.map((c) => `- **${c.title_he}** (${KIND_HE[c.kind]})${c.validation ? ` — ${c.validation.how}: ${c.validation.detail}` : ""}`), "");
  if (deferred.length) out.push("## דורש משהו מהלקוח", "", ...deferred.map((c) => `- **${c.title_he}** — ${c.what_he}`), "");
  if (declined.length) out.push("## לא התקנתי (נדחה)", "", ...declined.map((c) => `- ${c.title_he}${c.declineReason ? ` — ${c.declineReason}` : ""}`), "");
  if (notHere.length) out.push("## לא מומלץ כאן — ולמה", "", ...notHere.map((c) => `- ${c.title_he} — ${c.why_he}`), "");
  if (reported.length) out.push("## לתשומת לב הבעלים", "", ...reported.map((c) => `- **${c.title_he}** — ${c.what_he}`), "");
  const measured = input.evalSummary;
  if (measured?.tasks.length) {
    const t = measured.totals;
    const cost = t.costChange === null ? "" : ` עלות לריצה עם הסט: ${t.costChange > 0 ? "+" : ""}${Math.round(t.costChange * 100)}%.`;
    out.push("## מה נמדד", "", `אותן משימות, על אותו מודל, בלי הסט ועם הסט שב-PR הזה; משימה עוברת רק אם עברה בכל ההרצות שלה — ${t.improved} השתפרו, ${t.worse} נפגעו, ${t.same} ללא שינוי${t.unmeasured ? `, ${t.unmeasured} לא נמדדו` : ""}.${cost}`, "",
      "| משימה | בלי | עם | תוצאה |", "|---|---|---|---|",
      ...measured.tasks.map((x) => `| ${x.title_he.replace(/\|/g, "\\|")} | ${passedOf(x.without)} | ${passedOf(x.with)} | ${VERDICT_HE[x.verdict]} |`), "");
  }
  if (input.delta) out.push("## לפני / אחרי", "", `- משימות שעברו: ${input.delta.before.passed}/${input.delta.before.total} → ${input.delta.after.passed}/${input.delta.after.total}`, `- עלות למשימה: ${input.delta.costPerTaskChange == null ? "לא נמדד" : `${input.delta.costPerTaskChange > 0 ? "+" : ""}${Math.round(input.delta.costPerTaskChange * 100)}%`}`, "");
  out.push("## כרטיס כנות ומוכנות", "", ...input.readiness.items.map((x) => `- ${x.ok ? "✓" : "✗"} ${x.title_he} — ${x.detail_he}`), ...(input.readiness.honesty.length ? ["", ...input.readiness.honesty.map((h) => `- ${h}`)] : []), "");
  out.push("## איך זה נעשה", "", `אבחון דטרמיניסטי של המאגר, כללי החלטה גלויים, מדידה עם ובלי על משימות אמיתיות, ואימות לכל רכיב — ב-DCC, בענף \`${input.branch}\`${input.baselineSha ? ` מנקודת ההתחלה \`${input.baselineSha.slice(0, 7)}\`` : ""}. אף קובץ לא נכתב מחוץ לענף הזה, ורק מה שאומת או הוגדר נמצא ב-PR. הכול רשום ביומן ההטמעה.`);
  return out.join("\n");
}

/* ── what a process step needs for its agent — read from the cards ── */

export const stepsDeciding = (processes: readonly DiscoveredProcess[], decision: ProcessStep["decision"]) =>
  processes.flatMap((p) => p.steps.filter((s) => s.decision === decision).map((s) => ({ process: p, step: s })));

export const failureKindsOf = (trials: readonly TrialOutcome[]): FailureKind[] => [...new Set(trials.filter((t) => t.failureKind).map((t) => t.failureKind!))];

/* ── what the plan leaves out, with the evidence ──────────────────── */

/** Kinds that exist only to make the agent know or do better — the ones a measurement can show unneeded (a hook, a permission, a gitignore line or a connection is not knowledge). */
export const KNOWLEDGE_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>(["rule", "doc", "scaffold", "skill", "agent", "review", "pr_template"]);

export type BaselineOutcome = Pick<TrialOutcome, "taskKey" | "passed">;
export type TaskNaming = { key: string; title_he: string; exercises: { keys?: readonly string[] } };

/**
 * The measured reason a card is not proposed: every measured task that names it
 * (by key — the strong link; a kind or a file is too loose at plan time) passed
 * without it, in every run. The agent already does that on its own; a line or a
 * file for it is context every session pays for and the ETH study found harmful.
 * The person can still take it ("בכל זאת"); the build's own measurement judges
 * what was built.
 */
export function pruneByBaseline(seeds: readonly ComponentSeed[], tasks: readonly TaskNaming[], baseline: readonly BaselineOutcome[]): { seeds: ComponentSeed[]; pruned: { key: string; tasks: string[] }[] } {
  const rows = new Map<string, BaselineOutcome[]>();
  for (const r of baseline) rows.set(r.taskKey, [...(rows.get(r.taskKey) ?? []), r]);
  const measured = (k: string) => (rows.get(k)?.length ?? 0) > 0;
  const passed = (k: string) => measured(k) && rows.get(k)!.every((r) => r.passed === true);
  const out: ComponentSeed[] = [];
  const pruned: { key: string; tasks: string[] }[] = [];
  for (const s of seeds) {
    if (s.notRecommended || !KNOWLEDGE_KINDS.has(s.kind)) { out.push(s); continue; }
    const naming = tasks.filter((t) => t.exercises.keys?.includes(s.key) && measured(t.key));
    if (!naming.length || !naming.every((t) => passed(t.key))) { out.push(s); continue; }
    pruned.push({ key: s.key, tasks: naming.map((t) => t.key) });
    const which = naming.length === 1 ? `המשימה "${naming[0]!.title_he}" עברה` : `${naming.length} המשימות שהוא אמור לעזור בהן (${naming.map((t) => t.title_he).join(", ")}) עברו`;
    out.push({ ...s, notRecommended: true, why_he: `נמדד בלי הרכיב: ${which} גם בלעדיו — לא מוצע, כי כל שורה שנטענת בכל סשן צריכה להרוויח את מקומה. ${s.why_he}` });
  }
  return { seeds: out, pruned };
}

/** A repository that documents itself: a README of size, a docs folder, an architecture document or a CONTRIBUTING file. */
export function docsRich(profile: Pick<RepoProfile, "docs">): { rich: boolean; what: string[] } {
  const d = profile.docs ?? ({} as RepoProfile["docs"]);
  const what: string[] = [];
  if ((d.readme_bytes ?? 0) >= 8000) what.push("README");
  if ((d.docs_files ?? 0) >= 5) what.push("docs/");
  if (d.architecture_docs?.length) what.push(d.architecture_docs[0]!);
  if (d.contributing?.length) what.push(d.contributing[0]!);
  return { rich: what.length > 0, what };
}

/**
 * A repository that documents its processes already tells the agent how they go;
 * a skill or an agent per process step would duplicate that documentation (the
 * ETH study: written context helps only where the docs are thin). Only a step
 * that fails today keeps its card — there the helper is a fix, not a copy.
 */
export function pruneDocumentedProcessSteps(seeds: readonly ComponentSeed[], profile: Pick<RepoProfile, "docs">): { seeds: ComponentSeed[]; pruned: string[] } {
  const docs = docsRich(profile);
  if (!docs.rich) return { seeds: [...seeds], pruned: [] };
  const pruned: string[] = [];
  const out = seeds.map((s) => {
    if (s.source !== "process" || s.notRecommended) return s;
    const reasons = Array.isArray(s.params.reasons) ? (s.params.reasons as string[]) : [];
    if (reasons.includes("failsToday")) return s;
    pruned.push(s.key);
    return { ...s, notRecommended: true, why_he: `הריפו מתעד את התהליכים שלו (${docs.what.join(", ")}) — ${s.kind === "agent" ? "סוכן" : "skill"} לצעד הזה היה משכפל את התיעוד ונטען בכל סשן. לא מוצע; אם משימה של המדידה תיכשל בו, הוא יוצע מחדש. ${s.why_he}` };
  });
  return { seeds: out, pruned };
}

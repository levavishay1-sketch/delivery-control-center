import { FAILURE_TO_KIND, FAILURE_HE } from "./trials.ts";
import type {
  AutomationLevel, Component, ComponentFamily, ComponentGroup, ComponentKind, ComponentSeed, DiscoveredProcess, FailureKind, ProcessStep, Readiness, ReadinessItem, TrialDelta, TrialOutcome,
} from "./types.ts";
import { FAMILY_ORDER } from "./types.ts";
import type { RuleFiring, RuleSuppression } from "./rules.ts";

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

/** Two seeds for the same key: the later one's evidence joins the earlier one's, nothing is lost. */
export function mergeSeeds(...lists: readonly (readonly ComponentSeed[])[]): ComponentSeed[] {
  const byKey = new Map<string, ComponentSeed>();
  for (const list of lists) for (const s of list) {
    const prev = byKey.get(s.key);
    if (!prev) { byKey.set(s.key, { ...s }); continue; }
    if (!prev.why_he.includes(s.why_he)) prev.why_he = `${prev.why_he} וגם: ${s.why_he}`;
    prev.sourceRef = [prev.sourceRef, s.sourceRef].filter(Boolean).join(",");
  }
  return [...byKey.values()];
}

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
};

/** "Have we done everything we could for this repository?" — the four questions, each answered from the record. */
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
  // 4. The last addition improved — or nothing was measured yet.
  const measured = i.delta !== null;
  const improved = !!i.delta && (i.delta.after.passed > i.delta.before.passed || (i.delta.after.passed === i.delta.before.passed && (i.delta.costPerTaskChange ?? 0) < 0));
  const same = !!i.delta && i.delta.after.passed === i.delta.before.passed && !improved;
  items.push({ key: "delta", title_he: "הניסיון החוזר מראה שיפור מול נקודת ההתחלה", ok: measured && !(i.delta!.after.passed < i.delta!.before.passed), detail_he: !measured ? "עוד לא נמדד — הבנייה מריצה את הניסיון שוב" : improved ? `${i.delta!.before.passed}/${i.delta!.before.total} → ${i.delta!.after.passed}/${i.delta!.after.total}` : same ? "אותה תוצאה — התוספת האחרונה לא שיפרה; רכיב שלא הוכח מוצע להסרה" : "פחות משימות עוברות — משהו בסט מפריע; לבדוק את הרכיבים שנוספו" });
  const honesty: string[] = [];
  if (i.windowsOnly && !i.hasRunner) honesty.push("בריפו הזה אי אפשר להריץ build ובדיקות מהמכונה של DCC (build רק ב-Windows). עד שיהיה מריץ Windows, כל משימה מסומנת \"לא אומת כאן\" והסוקר עובד review-only. מה צריך: מכונת Windows אחת עם Claude Code ו-Visual Studio Build Tools.");
  for (const c of i.cards) if (c.kind === "runner" && c.status !== "declined") honesty.push(`${c.title_he}: ${c.what_he}`);
  for (const t of pool) if (t.passed === false && t.failureKind === "cannot_verify") honesty.push(`המשימה "${t.title_he}" לא ניתנת לאימות כאן: ${t.detail}`);
  for (const s of i.suppressed) honesty.push(`הכלל ${s.rule} לא הופעל כי סימנת את העובדה "${s.fact}" כלא נכונה${s.note ? ` (${s.note})` : ""}.`);
  for (const c of i.cards) if (c.status === "failed") honesty.push(`${c.title_he}: האימות נכשל — ${c.validation?.detail ?? ""}`);
  return { ready: items.every((x) => x.ok), items, honesty: [...new Set(honesty)] };
}

/* ── the report the pull request carries — from the cards, never free text ── */

export function pullRequestReport(input: { repoName: string; cards: readonly Component[]; delta: TrialDelta | null; readiness: Readiness; branch: string; baselineSha: string | null }): string {
  const installed = input.cards.filter((c) => c.status === "verified" || c.status === "installed");
  const failed = input.cards.filter((c) => c.status === "failed");
  const declined = input.cards.filter((c) => c.status === "declined" && c.group !== "not_recommended");
  const notHere = input.cards.filter((c) => c.group === "not_recommended");
  const reported = input.cards.filter((c) => c.kind === "report" && c.status === "reported");
  const deferred = input.cards.filter((c) => c.status === "deferred" || c.kind === "runner");
  const line = (c: Component) => `- **${c.title_he}** (${KIND_HE[c.kind]}${c.files.length ? `: ${c.files.slice(0, 3).map((f) => `\`${f}\``).join(", ")}${c.files.length > 3 ? ` +${c.files.length - 3}` : ""}` : ""}) — כי: ${c.why_he}${c.validation ? ` נבדק: ${c.validation.how} → ${c.validation.passed === true ? "עבר" : c.validation.passed === false ? "נכשל" : "לא נבדק"}${c.validation.detail ? ` (${c.validation.detail})` : ""}.` : ""}`;
  const out: string[] = [`# הטמעת AI ל-${input.repoName}`, ""];
  out.push("## התקנתי", "", ...(installed.length ? installed.map(line) : ["- (שום רכיב לא הותקן)"]), "");
  if (failed.length) out.push("## הותקן אבל האימות נכשל", "", ...failed.map(line), "");
  if (deferred.length) out.push("## דורש משהו מהלקוח", "", ...deferred.map((c) => `- **${c.title_he}** — ${c.what_he}`), "");
  if (declined.length) out.push("## לא התקנתי (נדחה)", "", ...declined.map((c) => `- ${c.title_he}${c.declineReason ? ` — ${c.declineReason}` : ""}`), "");
  if (notHere.length) out.push("## לא מומלץ כאן — ולמה", "", ...notHere.map((c) => `- ${c.title_he} — ${c.why_he}`), "");
  if (reported.length) out.push("## לתשומת לב הבעלים", "", ...reported.map((c) => `- **${c.title_he}** — ${c.what_he}`), "");
  if (input.delta) out.push("## לפני / אחרי", "", `- משימות ניסיון שעברו: ${input.delta.before.passed}/${input.delta.before.total} → ${input.delta.after.passed}/${input.delta.after.total}`, `- עלות למשימה: ${input.delta.costPerTaskChange == null ? "לא נמדד" : `${input.delta.costPerTaskChange > 0 ? "+" : ""}${Math.round(input.delta.costPerTaskChange * 100)}%`}`, "");
  out.push("## כרטיס כנות ומוכנות", "", ...input.readiness.items.map((x) => `- ${x.ok ? "✓" : "✗"} ${x.title_he} — ${x.detail_he}`), ...(input.readiness.honesty.length ? ["", ...input.readiness.honesty.map((h) => `- ${h}`)] : []), "");
  out.push("## איך זה נעשה", "", `אבחון דטרמיניסטי של המאגר, כללי החלטה גלויים, ריצת ניסיון לפני ואחרי, ואימות לכל רכיב — ב-DCC, בענף \`${input.branch}\`${input.baselineSha ? ` מנקודת ההתחלה \`${input.baselineSha.slice(0, 7)}\`` : ""}. אף קובץ לא נכתב מחוץ לענף הזה, ורק מה שאושר נמצא ב-PR. הכול רשום ביומן ההטמעה.`);
  return out.join("\n");
}

/* ── what a process step needs for its agent — read from the cards ── */

export const stepsDeciding = (processes: readonly DiscoveredProcess[], decision: ProcessStep["decision"]) =>
  processes.flatMap((p) => p.steps.filter((s) => s.decision === decision).map((s) => ({ process: p, step: s })));

export const failureKindsOf = (trials: readonly TrialOutcome[]): FailureKind[] => [...new Set(trials.filter((t) => t.failureKind).map((t) => t.failureKind!))];

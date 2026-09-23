/**
 * What the code needs from each prompt on the Prompts screen — pure (no
 * database), so it is tested on its own and both the save and the screen
 * use the same check.
 *
 * The words of every prompt live in `prompt_template` and nowhere else. What
 * lives here is only what the CODE depends on: the values it fills in, the
 * yes/no switches it sets, and the exact text it reads back out of the
 * answer. An edit on the screen may change anything else; an edit that
 * removes one of these is refused on save, because the call would still run
 * and quietly stop working.
 */

export type PromptUse = {
  /** The policy capability that picks the model and effort (config/model-policy.json). */
  capability: string;
  /** The person picks the model for each run of this prompt, starting from the row's default. Everywhere else the policy decides. */
  modelPerRun?: boolean;
  /** Values the code always fills — each `{{NAME}}` must stay in the body. */
  vars: readonly string[];
  /** Values and switches the code sets that the body may use or leave out:
   *  `{{NAME}}`, `{{#NAME}}…{{/NAME}}` (only when set) and `{{^NAME}}…{{/NAME}}` (only when not). */
  optional?: readonly string[];
  /** Text the code reads back from the answer — the reply's format. */
  keeps: readonly string[];
  /** Sent after these prompts rather than on its own. */
  appendedTo?: string;
};

const ASSESS_TIER: PromptUse = {
  capability: "gap_detection", modelPerRun: true,
  vars: ["REQUIREMENT"], optional: ["HAS_REPO", "REPO_NAME"], keeps: [], appendedTo: "assess.readiness",
};

export const PROMPT_USES: Record<string, PromptUse> = {
  "assess.readiness.quick": ASSESS_TIER,
  "assess.readiness.standard": ASSESS_TIER,
  "assess.readiness.thorough": ASSESS_TIER,
  "assess.readiness.audit": ASSESS_TIER,
  "assess.readiness.custom": { ...ASSESS_TIER, vars: ["REQUIREMENT", "CUSTOM_EMPHASIS"] },
  "assess.shared.output_contract": {
    capability: "gap_detection", vars: [], appendedTo: "assess.readiness",
    keeps: ['"title"', '"summary"', '"whatChanges"', '"baked"', '"rationale"', '"gaps"', '"question"', '"why"', '"kind"', '"whoAnswers"', '"options"', '"impactIfWrong"', '"blocking"', '"confidence"'],
  },
  "breakdown.tasks": {
    capability: "decomposition", vars: ["REQUIREMENT"], optional: ["HAS_REPO", "REPO_NAME"],
    keeps: ['"seq"', '"parentSeq"', '"kind"', '"intent"', '"prompt"', '"appetite"', '"affectedPaths"', '"compiledComponents"', '"dependsOnSeq"'],
  },
  "implement.task": {
    capability: "execution", vars: ["INSTRUCTION", "APPETITE", "CONTEXT"], optional: ["SHORT_TITLE", "AFFECTED_PATHS", "CHECKS"],
    keeps: ['"summary"', '"filesChanged"', '"testsRun"', '"followUps"', '"affectedConsumers"', '"checks"', '"passed"', '"likelyCause"'],
  },
  "implement.check": {
    capability: "execution", vars: ["INSTRUCTION", "APPETITE", "CONTEXT"], optional: ["SHORT_TITLE"],
    keeps: ['"summary"', '"filesChanged"', '"testsRun"', '"followUps"', '"affectedConsumers"'],
  },
  "chat.system": {
    capability: "chat", vars: ["UNANSWERED_MARK"],
    keeps: ['<goto key="', '<action key="', "<needs_code>"],
  },
  "chat.rollover_summary": { capability: "conversation_summary", vars: [], keeps: [] },
  "chat.code_read.repo": { capability: "chat_code_read", vars: [], keeps: [] },
  "chat.code_read.pull_request": { capability: "chat_code_read", vars: [], keeps: [] },
  "chat.code_read.onboarding_run": { capability: "chat_code_read", vars: [], keeps: [] },
  "gaps.conversation": {
    capability: "chat_code_read", vars: [],
    keeps: ['<action key="resolve_gap">', '<action key="dismiss_gap">', '"gap":"REF"', '"answer":', '"reason":'],
  },
  "insights.clusters": { capability: "usage_insights", vars: [], keeps: ['"n"', '"finding"', '"recommendation"'] },
  "onboarding.file_notes": { capability: "onboarding_file_notes", vars: [], keeps: ['"path"', '"note"'] },
};

const SECTION = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;

/**
 * Fill a template: `{{NAME}}` becomes its value; `{{#NAME}}…{{/NAME}}` stays
 * only when NAME is set (true, or a non-empty text) and `{{^NAME}}…{{/NAME}}`
 * only when it is not. An unknown `{{NAME}}` is left as it is — visible, not
 * silently swallowed, so a missing value is obvious in the preview.
 */
export function renderPrompt(body: string, vars: Record<string, string | boolean | undefined>): string {
  const on = (k: string) => { const v = vars[k]; return typeof v === "string" ? v.trim() !== "" : !!v; };
  let out = body;
  // Innermost first, until nothing is left to open — so a section may sit inside another.
  for (let prev = ""; prev !== out;) {
    prev = out;
    out = out.replace(SECTION, (_m, sign: string, k: string, inner: string) => ((sign === "#") === on(k) ? inner : ""));
  }
  return out.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (typeof vars[k] === "string" ? (vars[k] as string) : m));
}

/**
 * Why this body would break its caller — in plain Hebrew, one line each;
 * empty when it is fine. A row the code does not use has no contract.
 */
export function contractProblems(key: string, body: string): string[] {
  const use = PROMPT_USES[key];
  if (!use) return [];
  const problems: string[] = [];
  const known = new Set([...use.vars, ...(use.optional ?? [])]);
  const plain = new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!));
  const opened = [...body.matchAll(/\{\{[#^](\w+)\}\}/g)].map((m) => m[1]!);
  const closed = [...body.matchAll(/\{\{\/(\w+)\}\}/g)].map((m) => m[1]!);

  for (const v of use.vars) if (!plain.has(v)) problems.push(`חסר {{${v}}} — הקוד ממלא כאן ערך, ובלעדיו קלוד לא יקבל אותו.`);
  for (const v of new Set([...plain, ...opened, ...closed])) if (!known.has(v)) problems.push(`{{${v}}} לא מוכר — הקוד לא ממלא אותו, והוא יישלח לקלוד כמו שהוא.`);
  for (const v of new Set([...opened, ...closed])) {
    if (opened.filter((x) => x === v).length !== closed.filter((x) => x === v).length) problems.push(`קטע {{#${v}}} / {{^${v}}} לא נסגר ב-{{/${v}}} (או להפך).`);
  }
  for (const k of use.keeps) if (!body.includes(k)) problems.push(`חסר ${k} — הקוד קורא את זה מהתשובה של קלוד; בלעדיו הקריאה תרוץ ולא תעבוד.`);
  return problems;
}

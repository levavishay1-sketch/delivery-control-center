/**
 * Repository AI Enablement v2 — shared types and the stage catalogue.
 *
 * Nine stages, four of them human gates. Every stage declares what kind
 * of work it is (deterministic / AI / human), whether it writes to the
 * repository working tree, how reversible it is, and whether a person's
 * gate can be auto-resolved when the run's automation policy says so.
 * The Hebrew explanation fields are the product copy the onboarding
 * screen shows BEFORE a stage runs (why / what / value / what it
 * supports / output / impact) — kept next to the code that implements
 * the stage so the two cannot drift apart.
 */

export const ONBOARDING_VERSION = "v2";

/** Pending | Running | WaitingForUser | AwaitingExternal | Completed |
 *  CompletedWithWarnings | Failed | Skipped | Cancelled — shared between a
 *  run and its stages. `AwaitingExternal` is a stage that finished its own
 *  work and now waits on something outside DCC (a pull request being
 *  merged) — re-entered on demand, never auto-driven. */
export type OnboardingStatus =
  | "Pending"
  | "Running"
  | "WaitingForUser"
  | "AwaitingExternal"
  | "Completed"
  | "CompletedWithWarnings"
  | "Failed"
  | "Skipped"
  | "Cancelled";

export type StageKind = "deterministic" | "ai" | "human" | "mixed";
export type LifecyclePhase = "requirement" | "understanding" | "planning" | "implementation" | "testing" | "review" | "deployment" | "future_sessions";

export type StageDefinition = {
  key: string;
  order: number;
  kind: StageKind;
  /** The stage stops and waits for a person's decision. */
  gate: boolean;
  /** A gate the automation policy MAY resolve with the suggested defaults. */
  autoApprovable: boolean;
  /** Touches the isolated working tree (never the default branch). */
  writesRepo: boolean;
  /** "yes" — nothing outside DCC changes; "partial" — visible to others
   *  (a pushed branch / an open PR) but undoable; "external" — a step only
   *  people perform (merging), DCC never does it. */
  reversible: "yes" | "partial" | "external";
  title_he: string;
  short_he: string;
  why_he: string;
  what_he: string;
  value_he: string;
  supports: LifecyclePhase[];
  output_he: string;
  impact_he: string;
};

export const STAGES: readonly StageDefinition[] = [
  {
    key: "scan", order: 0, kind: "mixed", gate: false, autoApprovable: false, writesRepo: false, reversible: "yes",
    title_he: "סריקה וסיווג",
    short_he: "מה יש ב-Repository",
    why_he: "לפני שמישהו — אדם או AI — מחליט מה ה-Repository צריך, צריך לדעת מה כבר קיים בו: שפות, מערכות build, בדיקות, CI, תיעוד, ותצורת AI שכבר נמצאת שם (CLAUDE.md, AGENTS.md, rules, skills, hooks, MCP).",
    what_he: "DCC מכין סביבת עבודה מבודדת (git worktree על ענף ייעודי, מוצמד ל-commit בסיס), סורק את מערכת הקבצים באופן דטרמיניסטי (scc לספירת קוד ומורכבות, זיהוי manifests/CI/בדיקות/תיעוד, וזיהוי תיקיות רעש כמו bin/obj/node_modules), ומריץ קריאת AI אחת קטנה שמסווגת את ה-Repository מתוך הסיגנלים בלבד — בלי לקרוא קבצי קוד.",
    value_he: "מונע ניחושים: הסיווג והצעות הגבולות של השלב הבא מבוססים על עובדות מדידות, והקריאה ל-AI כאן זולה כי היא לא נוגעת בקוד.",
    supports: ["understanding", "planning"],
    output_he: "פרופיל Repository (שפות, שורות קוד, מורכבות, build, בדיקות, CI), רשימת מה שכבר קיים (תיעוד ותצורת AI), סיווג (סוג המערכת, stack, תחומים, מורכבות), והצעות לגבולות קריאה ולפרופיל אבטחה.",
    impact_he: "לא נוצר ולא משתנה שום קובץ ב-Repository. נוצר worktree מקומי בלבד.",
  },
  {
    key: "boundaries", order: 1, kind: "human", gate: true, autoApprovable: true, writesRepo: false, reversible: "yes",
    title_he: "גבולות והרשאות",
    short_he: "מה מותר ל-AI לקרוא",
    why_he: "ה-AI עומד לקרוא את הקוד. לפני כן אדם קובע מה אסור לו לקרוא (פלט build, ספריות vendored, סודות), איזה פרופיל אבטחה יחול על ה-Repository, ומה לעשות עם תצורת AI שכבר קיימת בו (לשמור / למזג / להחליף).",
    what_he: "DCC מציג את ההצעות מהסריקה (כללי חסימת קריאה שנמצאו בפועל, פרופיל אבטחה לפי הסיווג, מדיניות לכל קובץ תצורה קיים). אתם עורכים ומאשרים. הכללים המאושרים נאכפים על כל קריאת AI בהמשך התהליך, ונכנסים גם ל-.claude/settings.json שייווצר.",
    value_he: "חוסך טוקנים (ה-AI לא קורא מה שאסור) ומגן על מידע רגיש — לפני שנגרם נזק, לא אחרי.",
    supports: ["implementation", "testing", "review", "deployment"],
    output_he: "מדיניות אפקטיבית: פרופיל אבטחה + כללי חסימת קריאה + החלטה לכל קובץ תצורה קיים + תיקונים לסיווג אם צריך.",
    impact_he: "החלטה בלבד — לא נכתב קובץ. בהרצה אוטומטית מלאה ההצעות מתקבלות כפי שהן (הפעולה הפיכה: ניתן לשנות ולהריץ מחדש).",
  },
  {
    key: "discovery", order: 2, kind: "ai", gate: false, autoApprovable: false, writesRepo: false, reversible: "yes",
    title_he: "Discovery ממוקד",
    short_he: "איך המערכת באמת בנויה",
    why_he: "הידע שיישמר צריך להיות מבוסס ראיות מהקוד, לא על שמות תיקיות. וגם — מה שכבר מתועד היטב לא צריך להיכתב שוב.",
    what_he: "קריאת AI אחת, קריאה-בלבד (Read/Grep/Glob בלבד, ללא Bash, בתוך ה-worktree, עם כללי החסימה שאושרו ותקציב טוקנים). ה-AI קורא קודם את התיעוד הקיים ומדרג מה כבר מכוסה, ואז בוחן קבצים מייצגים בלבד כדי לזהות רכיבים, נקודות כניסה, גבולות, flows, אינטגרציות, אזורים מיוצרים/מוגנים, אילוצים, פקודות build/test מאומתות, ואיפה כדאי לחפש בסוגי עבודה נפוצים. כל מסקנה מצביעה על נתיב ראיה. מה שלא ניתן לקבוע נרשם כ-UNKNOWN, ושאלות שרק אדם יכול לענות עליהן נאספות לשלב הבא.",
    value_he: "זה הידע שעתיד למנוע rediscovery: פעם אחת, מבוסס ראיות, במקום שכל session ילמד את המערכת מחדש.",
    supports: ["understanding", "planning", "implementation", "testing"],
    output_he: "מודל תפעולי של ה-Repository (רכיבים, כניסות, flows, אינטגרציות, אזורים מוגנים, אילוצים, פקודות), מפת כיסוי של התיעוד הקיים, רשימת UNKNOWN, ושאלות לאדם.",
    impact_he: "לא נכתב קובץ. עלות: קריאת AI אחת מתוקצבת (נעצרת אוטומטית בחריגה).",
  },
  {
    key: "confirm", order: 3, kind: "human", gate: true, autoApprovable: true, writesRepo: false, reversible: "yes",
    title_he: "אימות והשלמה אנושית",
    short_he: "מה שרק אתם יודעים",
    why_he: "יש דברים שאי אפשר ללמוד מהקוד: מי צורך את ה-API הזה בחוץ, מה אסור לגעת בו ולמה, איזו החלטה היסטורית עדיין מחייבת. ניחוש כאן יקר יותר משאלה.",
    what_he: "DCC מציג את השאלות שה-Discovery לא הצליח לפתור (עד 10, עם 'למה זה חשוב' ורמת סיכון) ותקציר הממצאים לתיקון. עונים על מה שיודעים; מה שלא נענה נשמר במפורש כ-UNKNOWN — לא מומצא.",
    value_he: "הידע האנושי הוא החלק היחיד שה-AI לא יכול לשחזר לבד — והוא נשמר פעם אחת בקובץ שנטען רק כשצריך.",
    supports: ["requirement", "understanding", "planning", "implementation"],
    output_he: "תשובות מאומתות + תיקונים לממצאים, מסומנים כידע אנושי (לא מסקנת AI).",
    impact_he: "החלטה בלבד. אם אין שאלות — השלב מדולג אוטומטית. בהרצה אוטומטית מלאה השאלות נשארות UNKNOWN.",
  },
  {
    key: "plan", order: 4, kind: "mixed", gate: true, autoApprovable: true, writesRepo: false, reversible: "yes",
    title_he: "תוכנית Artifacts",
    short_he: "מה ייווצר, מה לא, ולמה",
    why_he: "יותר ידע לא אומר יותר יעילות. כל קובץ שנטען בכל session עולה טוקנים ומוריד ציות להוראות. לכן כל artifact חייב להצדיק את קיומו לפני שנכתב — ולא אחרי.",
    what_he: "ה-AI מציע, לכל artifact אפשרי, ליצור / לעדכן / לדלג — עם הצדקה: איזו בעיה זה פותר, מי צורך אותו ובאילו שלבי מחזור חיים, האם זה מקטין rediscovery, האם המידע כבר קיים במקום אחר, מה מקור האמת, ומתי הוא מתיישן. DCC מוסיף באופן דטרמיניסטי את ה-settings, ה-guardrails הרלוונטיים מהקטלוג ו-hooks של DCC. אתם מאשרים או מסירים פריטים.",
    value_he: "שליטה לפני יצירה: לא מייצרים (ולא משלמים על) קבצים שיידחו בסקירה, ורואים במפורש גם מה הוחלט לא ליצור.",
    supports: ["planning", "implementation", "testing", "review", "future_sessions"],
    output_he: "תוכנית מאושרת: רשימת artifacts עם פעולה, נתיב, אופן טעינה (תמיד / לפי דרישה / אף פעם), הצדקה, צרכנים ונתיבים שמעדכנים אותו; ורשימת מה שלא ייווצר ולמה.",
    impact_he: "החלטה בלבד — עדיין לא נכתב קובץ.",
  },
  {
    key: "generate", order: 5, kind: "mixed", gate: false, autoApprovable: false, writesRepo: true, reversible: "yes",
    title_he: "יצירת Artifacts",
    short_he: "כתיבה ל-worktree",
    why_he: "התוכנית אושרה; עכשיו הידע צריך להפוך לקבצים במקום שבו Claude Code באמת ימצא אותם — ובמינון הנכון.",
    what_he: "קריאת AI אחת מנסחת את כל קבצי הידע וההנחיות שאושרו (CLAUDE.md קצר שמפנה הלאה, skills ידע שנטענים לפי דרישה, rules לפי נתיבים, ובמידת הצורך CLAUDE.md מקונן) ומחזירה את התוכן כמידע מובנה; DCC כותב את הקבצים בעצמו, מוסיף חותמת מקור (זולה בטוקנים), כותב באופן דטרמיניסטי את .claude/settings.json, את ה-guardrails ואת hooks של DCC, ומבצע commit בענף ה-onboarding. ה-AI אינו מריץ פקודות shell.",
    value_he: "הפרדה בין ניסוח (AI) לכתיבה (DCC) מונעת כתיבות שנדחו בשקט, שומרת על diff נקי לסקירה, ומאפשרת מעקב אחרי כל קובץ.",
    supports: ["implementation", "testing", "review", "future_sessions"],
    output_he: "רשימת הקבצים שנכתבו/עודכנו (עם שורות, אומדן טוקנים, hash), commit בענף המבודד, ורשימת מה שלא נוצר.",
    impact_he: "כתיבה ל-worktree המבודד בלבד. ה-default branch לא משתנה. ניתן להריץ מחדש עם הערות.",
  },
  {
    key: "validate", order: 6, kind: "mixed", gate: false, autoApprovable: false, writesRepo: false, reversible: "yes",
    title_he: "אימות ותקציב הקשר",
    short_he: "האם זה עובד ומה זה עולה",
    why_he: "קובץ שנוצר אינו הוכחה שהוא נכון. צריך לבדוק שהתצורה נטענת, שה-guardrails באמת חוסמים, שהנתיבים שמוזכרים קיימים, שאין כפילויות, ושה-context שנטען בכל session נשאר קטן.",
    what_he: "בדיקות דטרמיניסטיות: settings.json תקין, hooks עוברים בדיקת תחביר ומופעלים על קלט דוגמה, rules/skills עם frontmatter תקין ו-globs שתואמים קבצים אמיתיים, נתיבים מוזכרים קיימים, כפילות בין CLAUDE.md ל-skills, ואומדן תקציב הקשר (כמה טוקנים נטענים תמיד לעומת לפי דרישה). ואז סקירת AI קריאה-בלבד שמחפשת סתירות מול הקוד, טענות לא מבוססות ומידע גנרי. DCC לא מריץ build/test של ה-Repository בשלב זה (סקריפטים של repo לא מורצים על מכונת המפעיל).",
    value_he: "מוכנות מוכחת, לא מוצהרת. ותקציב ההקשר הוא המדד שמונע 'אנציקלופדיה'.",
    supports: ["review", "future_sessions"],
    output_he: "טבלת בדיקות (עבר/אזהרה/נכשל עם פירוט), תקציב הקשר לפי artifact, ממצאי סקירת AI, וסטטוס מוכנות.",
    impact_he: "לא נכתב קובץ. כישלון מאפשר תיקון אוטומטי אחד (יצירה מחדש עם הממצאים) או חזרה ידנית.",
  },
  {
    key: "review", order: 7, kind: "human", gate: true, autoApprovable: true, writesRepo: false, reversible: "yes",
    title_he: "סקירה ואישור",
    short_he: "ה-diff המלא לפני שיוצא החוצה",
    why_he: "עד כאן שום דבר לא עזב את המחשב. זו הנקודה האחרונה שבה אפשר לראות בדיוק מה ייכנס ל-Repository — ולעצור.",
    what_he: "DCC מציג את ה-diff המלא של ענף ה-onboarding מול ה-commit הבסיסי, קובץ-קובץ, לצד תוצאות האימות, תקציב ההקשר, התוכנית מול מה שנוצר בפועל, ומה שלא נוצר בכוונה. אפשר לאשר, להסיר קבצים בודדים, לבקש שינויים עם הערה (חוזרים ליצירה עם ההערה), או לבטל.",
    value_he: "שקיפות מלאה: מה שמאשרים הוא בדיוק מה שנדחף.",
    supports: ["review"],
    output_he: "החלטת סקירה מתועדת (מי, מתי, מה) — אישור, בקשת שינויים, או ביטול.",
    impact_he: "אישור מפעיל את שלב המסירה. בהרצה אוטומטית מלאה (בהסכמה מפורשת מראש) האישור ניתן אוטומטית — ה-PR נשאר לסקירה אנושית ב-Git.",
  },
  {
    key: "deliver", order: 8, kind: "deterministic", gate: false, autoApprovable: false, writesRepo: false, reversible: "partial",
    title_he: "מסירה ו-Pull Request",
    short_he: "דחיפה, PR, והמתנה למיזוג",
    why_he: "DCC לא עוקף את מנגנון הבקרה של ה-Repository: השינוי מגיע דרך ענף ו-Pull Request, והמיזוג נשאר בידי אנשים.",
    what_he: "DCC דוחף את ענף ה-onboarding ל-remote ופותח Pull Request (דרך gh אם זמין; אחרת מספק קישור ליצירה ידנית). לאחר מכן הריצה ממתינה: DCC בודק לפי בקשה האם הענף מוזג ל-default branch, ורק אז ה-Repository מסומן כמוכן ל-AI — עם גרסת המתודולוגיה וה-commit שממנו הוא מוכן.",
    value_he: "מוכנות שמוגדרת על ידי מיזוג אמיתי, לא על ידי קיום קבצים בענף צדדי.",
    supports: ["deployment", "future_sessions"],
    output_he: "קישור ל-PR (או compare), סטטוס מיזוג, ובסיום: תאריך מוכנות, commit, וגרסת onboarding.",
    impact_he: "ענף נדחף ל-remote ו-PR נפתח — פעולה גלויה לאחרים (ניתן לסגור). המיזוג עצמו נעשה רק על ידי אדם ב-Git; DCC אינו ממזג.",
  },
];

export const STAGE_ORDER: readonly string[] = STAGES.map((s) => s.key);
export const stageDefinition = (key: string): StageDefinition | undefined => STAGES.find((s) => s.key === key);

/* ── automation ─────────────────────────────────────────────────────── */

export type AutomationPreset = "step_by_step" | "guided" | "automatic" | "custom";
/** `run`: does the stage start on its own once the previous one settled?
 *  `gate`: for a human gate, does DCC wait for a person ("approve") or
 *  apply the suggested defaults ("auto")? Only meaningful on gate stages. */
export type StagePolicy = { run: "auto" | "manual"; gate?: "approve" | "auto" };
export type AutomationPolicy = { preset: AutomationPreset; stages: Record<string, StagePolicy> };

export function presetPolicy(preset: Exclude<AutomationPreset, "custom">): AutomationPolicy {
  const stages: Record<string, StagePolicy> = {};
  for (const s of STAGES) {
    if (preset === "step_by_step") stages[s.key] = s.gate ? { run: "manual", gate: "approve" } : { run: "manual" };
    else if (preset === "guided") stages[s.key] = s.gate ? { run: "auto", gate: "approve" } : { run: "auto" };
    else stages[s.key] = s.gate ? { run: "auto", gate: s.autoApprovable ? "auto" : "approve" } : { run: "auto" };
  }
  return { preset, stages };
}

/** Normalises whatever is stored on the run row into a complete policy —
 *  a stage missing from a custom policy falls back to the guided default,
 *  so a policy written by an older client never leaves a stage undefined. */
export function normalizePolicy(raw: unknown): AutomationPolicy {
  const guided = presetPolicy("guided");
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<AutomationPolicy>;
  const preset: AutomationPreset = p.preset === "step_by_step" || p.preset === "automatic" || p.preset === "custom" ? p.preset : "guided";
  const base = preset === "custom" ? guided : presetPolicy(preset);
  const stages: Record<string, StagePolicy> = {};
  for (const s of STAGES) {
    const given = p.stages?.[s.key];
    const run = given?.run === "manual" ? "manual" : given?.run === "auto" ? "auto" : base.stages[s.key]!.run;
    if (s.gate) {
      const gate = given?.gate === "auto" && s.autoApprovable ? "auto" : given?.gate === "approve" ? "approve" : base.stages[s.key]!.gate;
      stages[s.key] = { run, gate };
    } else stages[s.key] = { run };
  }
  return { preset, stages };
}

/* ── model routing choice ───────────────────────────────────────────── */

/** A person's explicit model/effort choice for one AI stage — either
 *  field may be left unset, in which case that field falls back to the
 *  policy's recommendation (`recommend()` in `../routing.ts`). Only the
 *  five AI-calling stages (`scan`'s classify call, `discovery`, `plan`,
 *  `generate`, `validate`) plus `refresh` have an entry worth setting;
 *  every other stage key is simply never read. */
export type ModelChoice = { model?: string; effort?: string };
export type ModelPolicy = Record<string, ModelChoice>;

/** Stage key → the routing capability its AI call uses — the join between
 *  the stage catalogue and `config/model-policy.json`'s `onboarding_*`
 *  capabilities, kept in one place so the UI's "recommended" column and
 *  the runner's actual call agree on which capability a stage means. */
export const STAGE_CAPABILITY: Readonly<Record<string, string>> = {
  scan: "onboarding_classify",
  discovery: "onboarding_discover",
  plan: "onboarding_plan",
  generate: "onboarding_generate",
  validate: "onboarding_validate",
  refresh: "onboarding_refresh",
};

/** Normalises whatever is stored on the run row — drops anything for a
 *  key with no AI capability, keeps only the two known fields per entry,
 *  so a policy written by an older client or hand-edited JSON can't leak
 *  garbage into a live routing decision. */
export function normalizeModelPolicy(raw: unknown): ModelPolicy {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ModelPolicy = {};
  for (const key of Object.keys(STAGE_CAPABILITY)) {
    const entry = p[key];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const choice: ModelChoice = {};
    if (typeof e.model === "string" && e.model.trim()) choice.model = e.model.trim();
    if (typeof e.effort === "string" && e.effort.trim()) choice.effort = e.effort.trim();
    if (choice.model || choice.effort) out[key] = choice;
  }
  return out;
}

/* ── stage handler contract ─────────────────────────────────────────── */

export type StageContext = {
  runId: string;
  repoId: string;
  clientId: string;
  workspaceDir: string;
  baselineSha: string;
  triggeredBy: string;
  mode: "initial" | "refresh";
  /** Completed/CompletedWithWarnings/Skipped stages' `result`, keyed by
   *  stage key — lets a later stage read an earlier one's output without
   *  re-deriving it. Excludes a currently-waiting stage's provisional result. */
  priorResults: Record<string, unknown>;
  /** For a refresh run: the previous completed run's settled results. */
  previousResults?: Record<string, unknown>;
  /** This stage's own row result from a previous entry (a gate being
   *  resumed, an AwaitingExternal stage being re-checked). */
  ownResult?: unknown;
  /** Set only on a resume via `submitStageInput` — the person's raw input. */
  resumeInput?: unknown;
  /** A reviewer's "request changes" note (generate reads it). */
  reviewNote?: string | null;
  automation: AutomationPolicy;
  /** Per-stage model/effort overrides — see `ModelPolicy` above. */
  modelChoices: ModelPolicy;
};

export type StageOutcome = {
  status: Extract<OnboardingStatus, "Completed" | "CompletedWithWarnings" | "Failed" | "Skipped" | "WaitingForUser" | "AwaitingExternal">;
  result?: unknown;
  warnings?: string[];
  errors?: string[];
  claudeExecutionId?: string;
  sourceCommitSha?: string;
  /** Send the run back to an earlier stage (a reviewer's "request changes"):
   *  every stage from `stageKey` on is reset to Pending and the run resumes there. */
  resetTo?: { stageKey: string; note?: string };
};

export type StageHandler = (ctx: StageContext) => Promise<StageOutcome>;

/** A gate stage may expose how to resolve itself with the suggested
 *  defaults — the automation driver calls it when the policy says "auto". */
export type StageAutoResolver = (waitingResult: unknown, ctx: StageContext) => unknown;

/* ── deterministic scan output ──────────────────────────────────────── */

export type BuildSystemSignal = { kind: string; path: string };
export type TestSignal = { path: string; framework?: string };
export type CiSignal = { provider: string; path: string };
export type FrameworkSignal = { name: string; evidence: string };
export type LanguageSignal = {
  name: string; fileCount: number;
  lines?: number; code?: number; comment?: number; blank?: number; complexity?: number;
};
export type DocsSignal = { path: string };
export type IgnoredPathSignal = { pattern: string; reason: "junk_dir" | "junk_extension" };

/** Deterministic repository-scanner output — NOT full comprehension,
 *  just enough signal for classification and discovery to decide where to
 *  look. Mirrors `repository_profile`'s jsonb columns. */
export type RepositoryProfile = {
  scannedCommitSha: string;
  languages: LanguageSignal[];
  buildSystems: BuildSystemSignal[];
  testSignals: TestSignal[];
  ciSignals: CiSignal[];
  frameworkSignals: FrameworkSignal[];
  docsSignals: DocsSignal[];
  ignoredPaths: IgnoredPathSignal[];
  stats: { fileCount: number; dirCount: number; maxDepthHit: boolean; sccUsed: boolean; topLevel?: string[] };
  warnings: string[];
};

export type OnboardingWorkspace = {
  dir: string;
  baselineSha: string;
  branch: string;
  kind: "worktree" | "clone";
};

/* ── artifacts ──────────────────────────────────────────────────────── */

export type ArtifactKind =
  | "claude_md" | "nested_claude_md" | "rule" | "knowledge_skill" | "workflow_skill" | "agent"
  | "settings" | "guardrail_hook" | "dcc_hooks";
export type ArtifactAction = "create" | "update" | "skip" | "remove";
export type ArtifactLoading = "always" | "on_demand" | "never";

/** One line of the artifact plan — what the plan stage proposes and the
 *  person approves; the same shape is persisted to the ledger. */
export type PlannedArtifact = {
  key: string;
  kind: ArtifactKind;
  path: string;
  action: ArtifactAction;
  loading: ArtifactLoading;
  /** Who writes it: the generate AI call ("ai") or DCC deterministically ("dcc"). */
  writer: "ai" | "dcc";
  title_he: string;
  justification: string;
  consumers: LifecyclePhase[];
  watchedPaths: string[];
  sourceOfTruth: string;
  /** For skills: the frontmatter DCC enforces (the model drafts the body). */
  skill?: { name: string; description: string; paths?: string[]; disableModelInvocation?: boolean };
  /** For rules: the `paths:` globs. */
  rulePaths?: string[];
  /** For guardrail hooks / dcc hooks: catalog id. */
  catalogId?: string;
  /** Deterministic reasons the plan stage attached (e.g. "already covered by README"). */
  notes?: string[];
};

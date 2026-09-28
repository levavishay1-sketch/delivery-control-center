import type { Effort } from "../routing.ts";

/**
 * Repository onboarding as a coach (`openspec/changes/repository-coach`):
 * one fixed, deterministic process whose result — the set of components
 * a repository gets — is different for every repository, and each
 * component carries the evidence that justified it.
 *
 * A run walks seven steps; the coach (`coach.ts`) continues after the run
 * from what real sessions show. The step list is the extension point: a
 * new step slots in by adding a definition here and a runner in `runs.ts`.
 */

export const STEP_KEYS = ["connect", "diagnose", "processes", "trial", "plan", "build", "deliver"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export type StepStatus = "Pending" | "Running" | "WaitingForUser" | "Completed" | "Failed" | "Cancelled";
export type RunStatus = StepStatus;
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ["Pending", "Running", "WaitingForUser"];

export type StepDefinition = {
  key: StepKey;
  order: number;
  /** deterministic = DCC alone, no model; ai = Claude does part of the work; human = waits for a person's decision. */
  kind: "deterministic" | "ai" | "human";
  /** Waits for a person before it is over (the automation level may resolve it). */
  gate: boolean;
  title_he: string;
  short_he: string;
  why_he: string;
  what_he: string;
  output_he: string;
  /** What it costs, in words. */
  cost_he: string;
  /** What the person decides here, or what happens if they do nothing. */
  you_he: string;
};

export const STEPS: readonly StepDefinition[] = [
  {
    key: "connect", order: 0, kind: "deterministic", gate: false,
    title_he: "חיבור הריפו", short_he: "עותק מבודד על ענף חדש",
    why_he: "צריך עותק מבודד לעבוד עליו, בלי לגעת בריפו שלך.",
    what_he: "DCC מושך את הריפו, פותח ענף ai/onboarding/<הרצה> ורושם את נקודת ההתחלה. שום קריאה למודל, שום כתיבה לריפו של הלקוח.",
    output_he: "ענף מבודד ונקודת התחלה (commit).",
    cost_he: "חינם", you_he: "בוחרים עד כמה אוטומטי. בלי בחירה: הפיך נעשה ומדווח, משמעותי מחכה לאישור.",
  },
  {
    key: "diagnose", order: 1, kind: "deterministic", gate: false,
    title_he: "אבחון", short_he: "מה יש בריפו הזה — בלי מודל",
    why_he: "כל רכיב נכנס רק כשיש ראיה שהבעיה שלו קיימת בריפו הזה. האבחון הוא הראיה.",
    what_he: "סקריפט אחד לכל הריפואים קורא את הקוד וההיסטוריה: שפות, build, בדיקות, CI, קוד מג'ונרט, סודות (מיקום בלבד), מערכות חיצוניות, הגדרות AI קיימות, תיעוד, נקודות חמות.",
    output_he: "פרופיל הריפו, כל עובדה עם המקור שלה.",
    cost_he: "חינם", you_he: "אפשר לסמן עובדה כ\"זה לא נכון\". בלי פעולה: ממשיכים עם הפרופיל כפי שהוא.",
  },
  {
    key: "processes", order: 2, kind: "ai", gate: true,
    title_he: "תהליכים וראיון", short_he: "איך עובדים כאן, ומה הקוד לא אומר",
    why_he: "סוכן או skill נבנים לתהליך של הריפו הזה, לא לרשימה קבועה. קודם מגלים את התהליכים.",
    what_he: "DCC אוסף ראיות לתהליכים (היסטוריית git, CI, CONTRIBUTING, תבנית PR, תיעוד), שואל עד ארבע שאלות עם ברירת מחדל, ומבקש מקלוד לפרק כל תהליך לצעדים. לכל צעד נערך \"מבחן הסוכן\": חמש שאלות שמכריעות אם צריך סוכן, skill או כלום.",
    output_he: "רשימת תהליכים, כל אחד עם צעדים והחלטה מנומקת לכל צעד.",
    cost_he: "קריאה אחת למודל, סנטים בודדים", you_he: "עונים על השאלות או משאירים את ברירת המחדל. בלי פעולה: ההנחות נרשמות כהנחות.",
  },
  {
    key: "trial", order: 3, kind: "ai", gate: true,
    title_he: "מדידה — בלי", short_he: "מה קלוד מצליח כאן בלי שום רכיב, במשימות אמיתיות",
    why_he: "בלי מדידה אי אפשר לדעת אם רכיב עזר. כאן נמדד הבסיס: אותן משימות ירוצו שוב אחרי הבנייה, עם הסט שיימסר.",
    what_he: "בנק משימות קבוע — שאלות ידע ומשימות פעולה (להוסיף שדה, להריץ בדיקות, לערוך קובץ עם סוד, לבנות) — נבחר לפי מה שהאבחון מצא. כל משימה רצה ב-Claude Code בעותק נקי שטוען רק את ההגדרות של הריפו עצמו. הקוד שופט קודם: מה השתנה, מה רץ, מה נחסם, מה נטען; שופט עם גישה לקוד מכריע רק כשהקוד לא יכול. כל כישלון מסווג: לא ידע עובדה, ידע ועבר על כלל, חסר מידע חיצוני, לא יכול לאמת, שיפוט שגוי.",
    output_he: "תוצאה לכל הרצה של כל משימה: עבר או נכשל, למה, כמה עלה וכמה תורות. הבסיס להשוואה.",
    cost_he: "אומדן ותקרה מוצגים לפני; בערך $0.35 להרצה", you_he: "מאשרים את המדידה על האומדן. במדרגה \"הפיך = עושה ומדווח\" היא רצה לבד ונעצרת בתקרה.",
  },
  {
    key: "plan", order: 4, kind: "human", gate: true,
    title_he: "תוכנית הרכיבים", short_he: "\"שמתי X כי ראיתי Y\" — לאישורך, אחרי הטיוטה",
    why_he: "ל-Claude אין מילה אחרונה. כל רכיב מוצג עם הראיה שלו, ואדם מחליט — פעם אחת, אחרי שכל הראיות (גם טיוטת /init) נכנסו.",
    what_he: "כללי ההחלטה רצים על הפרופיל, הראיון, כישלונות המדידה ומבחן הסוכן; קלוד מחפש רכיבים מוכנים לסטאק והקוד בודק אמון; סוקר נפרד שואל מה חסר ומה מיותר. לפני ההחלטות אפשר לפתוח סשן /init מוגבל בכסף ובזמן; כשהוא נגמר הטיוטה מוזזת הצידה ונסרקת מול העותק הנקי, ומה שהסריקה פסקה מיותר נדחה עם סיבה (אפשר לבטל). רק אז הכרטיסים נפתחים: נעשה ודווח, מחכה לאישורך, לא מומלץ כאן.",
    output_he: "כרטיס לכל רכיב: למה, מה, מקור, סיכון, עלות הקשר, איך נבדוק. אומדן לבנייה ולמדידה. וכרטיס כנות: מה אי אפשר לאמת כאן.",
    cost_he: "חיפוש וסוקר — סנטים; סשן טיוטה — עד התקרה שנקבעה (ברירת מחדל $3, 40 דקות); סריקת הטיוטה — עד $3", you_he: "פותחים טיוטה או מדלגים; ואז אשר / שאל / דחה לכל כרטיס, או אישור כסט. בלי פעולה: רק \"נעשה ודווח\" נבנה; השאר ממתין ולא נכתב.",
  },
  {
    key: "build", order: 5, kind: "ai", gate: false,
    title_he: "בנייה ואימות", short_he: "התקנה בענף, אימות לכל רכיב, מדידה — עם",
    why_he: "רכיב שלא אומת הוא השערה, ולא נמסר. רכיב שלא שיפר — מוצע להסרה.",
    what_he: "הרכיבים המאושרים נבנים לפי סוג בסדר תלות: בטיחות, אימות, ידע, חיבורים, skills, סוכנים, אכיפה. לכל סוג מאמת משלו: hook נבדק בפעולה אסורה, הרשאה בפענוח, skill ומסמך מול נתיבים ופקודות שקיימים כאן — בלי סובלנות. קובץ שנכשל מקבל ניסיון תיקון אחד, ואם עדיין נכשל — נמחק. ואז המדידה שוב: אותן משימות על עותק שמכיל בדיוק את מה שיימסר, ודלתא לכל רכיב מהמשימות שהוא נבחן בהן.",
    output_he: "קבצים בענף המבודד, תוצאת אימות לכל רכיב, והמדידה: עם מול בלי, לכל משימה ולכל רכיב.",
    cost_he: "אומדן מוצג בתוכנית; כתיבה ~$0.3 לרכיב, המדידה ~$0.35 להרצה", you_he: "רואים עם מול בלי. רכיב שלא הוכיח תרומה מוצע להסרה — לוחצים ומסירים לפני המסירה.",
  },
  {
    key: "deliver", order: 6, kind: "deterministic", gate: true,
    title_he: "מסירה", short_he: "PR בזהות שלך, עם דו\"ח שאדם מבין",
    why_he: "השינויים צריכים להגיע ל-git כדי שהצוות יקבל אותם — ורק מה שאומת.",
    what_he: "commit של הקבצים שאומתו (או הוגדרו לחיבור אצל הלקוח) על שמך, push לענף ו-PR עם דו\"ח שנכתב מהכרטיסים: התקנתי X כי Y, נבדק כך, נמדד כך, לא התקנתי W כי. קובץ רשומה אחד בריפו (.dcc/onboarding.json) בלי פרטים פנימיים.",
    output_he: "PR פתוח שממתין למיזוג ידני, והמאמן ממשיך מכאן.",
    cost_he: "חינם", you_he: "לוחצים על המסירה. בלי פעולה: שום דבר לא יוצא מהמחשב.",
  },
];

export const stepDefinition = (key: string): StepDefinition | undefined => STEPS.find((s) => s.key === key);
export const isStepKey = (k: string): k is StepKey => (STEP_KEYS as readonly string[]).includes(k);

/* ── automation ───────────────────────────────────────────────────── */

/**
 * How much the run does without asking (the engagement's setting, chosen at
 * the start of a run): `reversible_auto` — a reversible, cheap component is
 * built and reported, everything else waits for approval; `all_approval` —
 * every component waits; `locked` — every component waits, and nothing that
 * costs money runs before a person says so.
 */
export type AutomationLevel = "reversible_auto" | "all_approval" | "locked";
/** The level, and the caps on the one thing in a run that has no per-call cap — the interactive /init draft session (the Trade run spent $5.55 and 70 minutes in it). */
export type Automation = { level: AutomationLevel; draftCapUsd: number; draftCapMinutes: number };
export const AUTOMATION_LEVELS: readonly AutomationLevel[] = ["reversible_auto", "all_approval", "locked"];
export const DRAFT_CAP_DEFAULTS = { usd: 3, minutes: 40 } as const;

export function normalizeAutomation(raw: unknown): Automation {
  const r = (raw ?? {}) as { level?: unknown; draftCapUsd?: unknown; draftCapMinutes?: unknown };
  const num = (v: unknown, dflt: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt);
  return {
    level: AUTOMATION_LEVELS.includes(r.level as AutomationLevel) ? (r.level as AutomationLevel) : "reversible_auto",
    draftCapUsd: num(r.draftCapUsd, DRAFT_CAP_DEFAULTS.usd, 0.5, 50),
    draftCapMinutes: num(r.draftCapMinutes, DRAFT_CAP_DEFAULTS.minutes, 5, 240),
  };
}

/* ── the profile (what the diagnosis found) ───────────────────────── */

/** The deterministic diagnosis of a repository — the same shape the research
 *  script produced, so the eleven stored diagnoses are fixtures for the rules.
 *  Snake-case on purpose: it is data, read by the rules table by path. */
export type RepoProfile = {
  name: string;
  path: string;
  languages: { language: string; files: number; lines: number }[];
  frameworks: string[];
  package_managers: string[];
  build: { system: string[]; commands: string[]; dotnet_target_frameworks?: Record<string, number> };
  tests: {
    frameworks: string[]; test_files: number; test_dirs: [string, number][];
    /** Directories of the test projects git tracks (a test .csproj, a package or module holding test files) — "." is the root. Absent in a profile older than this field. */
    projects?: string[];
    /** One command per tracked test project, runnable from the repository root (`dotnet test <csproj>`, `vstest.console <dir>/bin/Debug/<asm>.dll`, `npm --prefix <dir> test`, `python -m pytest <dir>`, …). */
    commands?: string[];
  };
  /** Root linters as the manifests name them; a linter only some sub-packages have is one entry `eslint (packages: a, b +3)`. */
  lint_format: string[];
  ci: { present: boolean; systems: string[]; workflows: { file: string; name?: string }[]; commands: string[]; workflow_count?: number };
  monorepo: {
    is_monorepo: boolean; workspaces: unknown[]; packages: string[]; package_count?: number;
    /** True when `packages` stopped short of `package_count` (only past 400). */
    packages_truncated?: boolean;
    /** The manifest kinds the packages have (`package.json`, `*.csproj`, `pyproject.toml`, …) — only the ones this repository uses. */
    manifest_kinds?: string[];
    /** The packages the root command does not cover, each with its own command run from its own folder — empty when one root command builds them all. */
    own_commands?: { dir: string; build: string | null; test: string | null }[];
  };
  generated_code: {
    paths: { dir: string; files: number }[]; header_marked_files: number; header_sample: string[]; header_dirs: { dir: string; files: number }[];
    /** Tracked files over 2000 lines whose head says they are generated — one such file is enough (a 98K-line `Entities.cs`). */
    header_files?: { path: string; lines: number }[];
  };
  secrets: {
    /** `files` and `sensitive_files` are complete — never cut to a first few. */
    total: number; by_kind: Record<string, number>; files: { path: string; hits: number }[]; sensitive_files: string[];
    in_test_files: number; outside_tests: number; dotenv_examples: string[];
    /** Glob deny patterns for the kinds of sensitive file found (`**\/*.snk`, `**\/*.pfx`, `**\/.env`, …); never app.config / web.config. */
    patterns?: string[];
  };
  external_systems: Record<string, { count: number; sample_files: string[] }>;
  ai_config: { present: boolean; files: string[]; count: number; kinds: string[]; sizes: Record<string, number> };
  docs: {
    readme: string | null; readme_bytes: number; docs_dir: boolean; docs_files: number; adrs: string[]; contributing: string[];
    architecture_docs: string[]; license: string[]; changelog: string[]; license_kind: string;
    /** Added by the port: a pull-request template and a code-owners file, when they exist. */
    pr_template?: string[]; codeowners?: string[];
  };
  windows_build: {
    sln: number; csproj: number; snk: number; vbproj: number; packages_config: number; ps1: number; bat_cmd: number;
    legacy_netframework: boolean; dll_checked_in: number; exe_checked_in: number; windows_only_build: boolean;
    /** Projects that import Microsoft.WebApplication.targets — they need Visual Studio's MSBuild; `dotnet msbuild` does not build them. */
    web_app_projects?: number;
  };
  environment: {
    devcontainer: boolean; dockerfile: string[]; docker_compose: string[]; makefile: boolean; nix_flake: boolean; editorconfig: boolean; tool_versions: string[];
    /** The build and test tools on the machine that ran the diagnosis: the resolved path, or null. Keys: msbuild (PATH or a Visual Studio install), dotnet, dotnet_msbuild (= dotnet), vstest.console, npm, node, pac, python, pytest, gradle, gradlew (the repository's wrapper), mvn, mvnw, go, cargo. */
    tools?: Record<string, string | null>;
  };
  size: { files: number; code_lines: number; bytes_on_disk_excl_git: number; largest_files: { path: string; bytes: number }[]; top_level_dirs: string[] };
  git: {
    available: boolean; head?: string; tracked_files?: number; tracked_binaries_dll_exe_pdb?: number; tracked_ide_junk?: number; tracked_package_dirs?: number;
    commits_in_clone?: number; shallow?: boolean; last_commit_date?: string; first_commit_date_in_clone?: string; authors_in_clone?: number;
    hot_files?: { path: string; changes: number; authors: number }[]; hot_dirs?: { dir: string; changes: number; authors: number }[];
    repeated_change_shapes?: { files: string[]; times: number }[]; cochange_pairs?: { a: string; b: string; times: number }[];
    commits_analyzed?: number; churn_by_ext?: Record<string, number>;
    /** Git tracks files under a root `packages/`, `node_modules/` or `vendor/` — such a folder is kept on purpose and must not be gitignored. */
    packages_committed?: boolean;
  };
  /** Where things are, for the measurement tasks and the layout map. Absent in a profile older than this field. */
  layout?: {
    /** Tracked folders named Contracts / Model(s) / Entities / Enums / schema / types / dto holding 10 or more code files. */
    model_dirs: string[];
    /** Sub-folders (never the root) whose package.json has a `build` script. */
    node_packages: string[];
    /** Folders holding 3 or more sibling project folders (a .csproj / package.json / pyproject.toml / go.mod / build.gradle each) — at most 5, members sorted. */
    unit_groups: { parent: string; members: string[] }[];
    /** Up to 5 tracked source files of 30–200 lines that carry a comment. */
    small_source_files: string[];
  };
};

/** A fact the person marked as wrong ("זה לא נכון"): `path` is the dotted
 *  path of the fact in the profile (`tests.frameworks`, `ci.present`,
 *  `external_systems.Dataverse/Dynamics 365`). A rule that relies on a
 *  corrected fact does not fire, and the plan says so. */
export type ProfileCorrection = { path: string; note: string | null; by: string; at: string };

/* ── processes (how work is done here) and the agent test ─────────── */

/** The five questions that decide whether a step of a process needs an
 *  agent of its own: any `true` makes the step an agent candidate. */
export type AgentTest = {
  /** Needs independent judgment (a second opinion, a review, a decision). */
  judgment: boolean;
  /** Needs information or access the main agent does not have. */
  externalInfo: boolean;
  /** Has to read a lot (many files, long logs) — a fresh context is cheaper. */
  readsALot: boolean;
  /** Can run beside the main work. */
  parallel: boolean;
  /** Fails today: the trial or the history shows it going wrong. */
  failsToday: boolean;
  /** One shared sentence — kept for runs written before `reasons` existed. */
  why: string;
  /** Per question, in plain Hebrew and specific to this step: which judgment, which information, which files, which failure. */
  reasons?: Partial<Record<AgentCriterion, string>>;
};

export type AgentCriterion = "judgment" | "externalInfo" | "readsALot" | "parallel" | "failsToday";

export type StepDecision = "agent" | "skill" | "none";

export type ProcessStep = {
  key: string;
  title: string;
  what: string;
  agentTest: AgentTest;
  /** Decided by code from the answers: any yes → agent; a recurring, well-defined step → skill; else nothing. */
  decision: StepDecision;
  reason: string;
};

export type ProcessSource = "git" | "ci" | "contributing" | "pr_template" | "docs" | "tracker" | "interview" | "model";

export type DiscoveredProcess = {
  key: string;
  title: string;
  source: ProcessSource;
  /** What showed it: file paths, counts, quotes. */
  evidence: string[];
  steps: ProcessStep[];
  /** The trial task that exercises this process, when one does. */
  trialTaskKey: string | null;
  /** Why the process cannot be exercised here ("no Windows runner"), when it cannot. */
  impossible: string | null;
};

/* ── the interview ────────────────────────────────────────────────── */

export type InterviewQuestion = {
  key: string;
  question_he: string;
  why_he: string;
  options: { value: string; label_he: string }[];
  default: string;
};
export type InterviewAnswer = { key: string; value: string; /** Nobody answered; the default was taken and recorded as an assumption. */ assumed: boolean };

/* ── trials ───────────────────────────────────────────────────────── */

/** Why a trial task failed — each kind points at a kind of component. */
export type FailureKind = "missing_fact" | "rule_violated" | "needs_external" | "cannot_verify" | "bad_judgment";
export const FAILURE_KINDS: readonly FailureKind[] = ["missing_fact", "rule_violated", "needs_external", "cannot_verify", "bad_judgment"];

/** `baseline` = the arm without the delivered set (step 4); `after` = the arm with exactly the delivered set (step 6). */
export type TrialPhase = "baseline" | "after";

/** What one code grader of the measurement found on one run (`eval/graders.ts`). */
export type GraderResult = { type: string; passed: boolean; skipped: boolean; detail: string };

/** One run of one measurement task in one arm (a task runs more than once: a single sample is noise). */
export type TrialOutcome = {
  taskKey: string;
  title_he: string;
  phase: TrialPhase;
  /** The n-th run of this task in this phase. */
  runIndex?: number;
  numTurns?: number | null;
  graders?: GraderResult[];
  passed: boolean | null;
  failureKind: FailureKind | null;
  detail: string;
  costUsd: number;
  callId: string | null;
  /** How it was judged: by the code, or by which model. */
  judgedBy: string;
};

export type TrialDelta = {
  before: { passed: number; total: number; costUsd: number };
  after: { passed: number; total: number; costUsd: number };
  /** Cost per task, after against before, as a fraction (−0.18 = 18% cheaper). */
  costPerTaskChange: number | null;
};

/* ── components ───────────────────────────────────────────────────── */

export type ComponentKind =
  | "rule" | "hook" | "permission" | "skill" | "agent" | "mcp" | "plugin" | "lsp" | "scaffold" | "doc" | "report" | "runner"
  | "settings" | "gitattributes" | "gitignore" | "review" | "pr_template" | "devcontainer" | "script";

/** The families are the build order (dependencies first) and the readiness checklist. */
export type ComponentFamily = "safety" | "verification" | "knowledge" | "connections" | "skills" | "agents" | "enforcement" | "measurement";
export const FAMILY_ORDER: readonly ComponentFamily[] = ["safety", "verification", "knowledge", "connections", "skills", "agents", "enforcement", "measurement"];

export type ComponentSource = "rule" | "trial" | "process" | "marketplace" | "reviewer" | "user" | "init" | "coach";
export type ComponentGroup = "auto" | "approval" | "not_recommended";
export type ComponentRisk = "reversible" | "significant" | "external";
/** `installed` is only the build's own passing state (written, not yet checked); a finished build leaves `verified`, `configured` (an MCP/LSP/plugin whose configuration was written and parsed — the connection is made at the client) or `failed`. */
export type ComponentStatus = "proposed" | "approved" | "declined" | "installed" | "verified" | "configured" | "failed" | "removed" | "deferred" | "reported";

export type ClarifyingQuestion = { key: string; question_he: string; default: string; answer: string | null };

export type ComponentValidation = { how: string; passed: boolean | null; detail: string; at: string };

export type ComponentDelta = { before: number; after: number; total: number; costPerTaskChange: number | null; verdict: "improved" | "same" | "worse" | "unmeasured" };

export type Component = {
  key: string;
  kind: ComponentKind;
  family: ComponentFamily;
  title_he: string;
  /** "כי ראיתי" — the evidence, in words a manager reads. */
  why_he: string;
  what_he: string;
  source: ComponentSource;
  /** The rule id, the trial task, the process step, the marketplace source — what produced it. */
  sourceRef: string | null;
  group: ComponentGroup;
  risk: ComponentRisk;
  /** What it adds to every session's context, when it is always loaded. */
  contextTokens: number | null;
  verifyHow_he: string;
  status: ComponentStatus;
  /** What the builder needs: paths, commands, patterns, an MCP spec. */
  params: Record<string, unknown>;
  /** Files written for it in the isolated copy, relative to its root. */
  files: string[];
  validation: ComponentValidation | null;
  delta: ComponentDelta | null;
  questions: ClarifyingQuestion[];
  decidedBy: string | null;
  decidedAt: string | null;
  declineReason: string | null;
};

/** What a rule contributes before it becomes a card: the same fields the rules table declares. */
export type ComponentSeed = Pick<Component, "key" | "kind" | "family" | "title_he" | "why_he" | "what_he" | "source" | "sourceRef" | "risk" | "verifyHow_he" | "params"> & {
  contextTokens?: number | null;
  questions?: ClarifyingQuestion[];
  /** A rule may say a component is deliberately NOT recommended here, with the reason in `why_he`. */
  notRecommended?: boolean;
};

/* ── readiness ────────────────────────────────────────────────────── */

export type ReadinessItem = { key: string; title_he: string; ok: boolean; detail_he: string };
export type Readiness = { ready: boolean; items: ReadinessItem[]; /** What cannot be verified here and what it would take — the honesty card. */ honesty: string[] };

/* ── the /init draft session (a window inside the plan step) ──────── */

export type SessionState = "none" | "live" | "ended" | "disconnected";

/** The last status-line snapshot Claude Code handed to DCC. */
export type SessionStatus = {
  costUsd: number;
  apiDurationMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  modelId: string | null;
  effort: string | null;
  linesAdded: number;
  linesRemoved: number;
  updatedAt: string;
};

export type RunSession = {
  id?: string;
  state: SessionState;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  model?: string;
  effort?: string;
  transcriptPath?: string;
  /** Lines of the transcript already turned into events. */
  transcriptCursor?: number;
  /** Assistant responses seen in the transcript (model calls). */
  apiCalls?: number;
  lastMessageId?: string | null;
  /** The current Claude Code process's own counters (each process starts from zero). */
  status?: SessionStatus;
  /** What earlier processes of the same conversation spent — a resume starts a new process. */
  base?: SessionTotals;
  /** Up to where the session's spend is already in the `claude_call` ledger (a live session is recorded in slices). */
  ledgerCursor?: SessionTotals & { stepKey?: string | null; at?: string };
};

export type SessionTotals = { costUsd: number; inputTokens: number; outputTokens: number; apiDurationMs: number };
export const sessionTotals = (s: RunSession): SessionTotals => ({
  costUsd: (s.base?.costUsd ?? 0) + (s.status?.costUsd ?? 0),
  inputTokens: (s.base?.inputTokens ?? 0) + (s.status?.inputTokens ?? 0),
  outputTokens: (s.base?.outputTokens ?? 0) + (s.status?.outputTokens ?? 0),
  apiDurationMs: (s.base?.apiDurationMs ?? 0) + (s.status?.apiDurationMs ?? 0),
});

export type ModelChoice = { model?: string; effort?: Effort };

/* ── step results ─────────────────────────────────────────────────── */

export type ExistingSetup = {
  claudeMdLines: number | null;
  agentsMd: boolean;
  rules: number;
  skills: number;
  hooks: number;
  agents: number;
  settings: boolean;
};

export type ConnectResult = {
  branch: string;
  baselineSha: string;
  defaultBranch: string | null;
  baseFrom: "remote" | "local" | "head";
  fileCount: number;
  existing: ExistingSetup;
  level: AutomationLevel;
};

export type DiagnoseResult = { profileId: string; facts: number; durationMs: number; corrections: number };

export type ProcessesResult = { processes: number; steps: number; agents: number; skills: number; questions: number; answered: number; assumed: number; costUsd: number };

export type TrialResult = { phase: TrialPhase; tasks: number; passed: number; costUsd: number; byKind: Record<string, number>; /** Runs per task and whether the measurement stopped at its cap. */ runs?: number; stoppedAtCap?: boolean };

/** Where the plan step is: the cards are drawn before the draft, shown for decision only after the draft was set aside and scanned. */
export type PlanPhase = "draft" | "aside" | "scan" | "decide";

export type PlanResult = {
  rulesFired: string[];
  rulesSuppressed: { rule: string; fact: string }[];
  components: number;
  byGroup: Record<ComponentGroup, number>;
  marketplace: { searched: boolean; found: number; remembered: number; skipped: string | null };
  reviewer: { missing: number; redundant: number } | null;
  costUsd: number;
  /** The scan of the /init draft, when it was asked for: running, done with its decisions, or failed. */
  initScan?: InitScanState;
  /** The plan's phase (`PlanPhase`); absent on runs made before the draft came first. */
  phase?: PlanPhase;
  /** What the build and its measurement will roughly cost, said before the decision. */
  buildEstimateUsd?: number;
  /** What the plan left out on evidence: cards the baseline measurement showed unneeded, process helpers the repository's docs already cover, cards the reviewer found redundant (declined, undoable). */
  pruned?: { measured: string[]; documented: string[]; reviewer: string[] };
};

/** What the scan of the /init draft decided — kept on the plan step, shown in the draft card. */
export type InitScanState = {
  state: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  by: string;
  /** The files of the draft it read. */
  files: string[];
  error?: string;
  failedAt?: string;
  verdict?: "adopt" | "merge" | "partial" | "keep_ours";
  summary?: string;
  compare?: { topic: string; ours: string; theirs: string; better: "ours" | "theirs" | "both" | "neither"; why: string }[];
  /** The cards it made; "ask" is a decision only a person can take. */
  cards?: { key: string; title: string; decision: string; notRecommended: boolean }[];
  /** Cards of ours it says should not be kept — a note on each, the person decides. */
  dropOurs?: { key: string; title: string; why: string }[];
  /** What it left out of the draft, and why. */
  reject?: { what: string; why: string }[];
  /** What it wanted to take and DCC could not (a settings file, a file that exists, too long). */
  refused?: { title: string; why: string }[];
  costUsd?: number;
};

export type BuildResult = {
  installed: number; verified: number; failed: number; skipped: number;
  files: string[];
  /** The measurement's totals in the before/after shape the coach and older screens read. */
  delta: TrialDelta | null;
  /** The measurement itself: per task and per component, "with" against "without" (`eval/report.ts`). */
  eval?: import("./eval/report.ts").EvalSummary | null;
  /** Files of failed cards the build deleted from the copy. */
  removedFiles?: string[];
  jointCheck: { duplicates: string[]; contradictions: string[]; alwaysLoadedTokens: number };
  costUsd: number;
};

export type ChangedFile = { path: string; status: "A" | "M" | "D" | "R" | string; additions: number; deletions: number };

export type DeliverResult = {
  branch: string;
  base: string;
  commitSha: string | null;
  filesCommitted: number;
  remote: string | null;
  pushed: boolean;
  prNumber: number | null;
  prUrl: string | null;
  compareUrl: string | null;
  localOnly: boolean;
  note?: string;
  /** The report the pull request carries, generated from the cards. */
  report: string;
};

/* ── the coach ────────────────────────────────────────────────────── */

export type CoachProposalKind = "add" | "change" | "remove" | "new_in_world";
export type CoachProposalStatus = "proposed" | "approved" | "declined" | "applied" | "measured";

export type HealthScore = {
  /** Tasks whose checks passed on the first development run, as a fraction; null without data. */
  firstPassRate: number | null;
  /** Reruns a task needed on average (a person's corrections stand in for human edits until sessions report them). */
  rerunsPerTask: number | null;
  costPerTaskUsd: number | null;
  /** Pull requests merged without a follow-up rewrite, as a fraction; null without data. */
  mergedWithoutRewriteRate: number | null;
  tasks: number;
  windowDays: number;
  /** 0–100 from the measures that have data, or null when none has. */
  score: number | null;
  trend: "up" | "down" | "flat" | null;
};

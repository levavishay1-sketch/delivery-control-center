import { useEffect, useState } from "react";
import {
  advanceOnboardingRun, cancelOnboardingRun, getLatestOnboardingRun, getOnboardingExecution, getOnboardingRun, getOnboardingRunCostSummary,
  startOnboardingRun, submitOnboardingStageInput, updateOnboardingPrompt,
  type OnboardingExecution, type OnboardingRunCostSummary, type OnboardingRunView, type OnboardingStage,
} from "../api.ts";
import { PageHead } from "../ui.tsx";
import { StepRail } from "./WorkflowTab.tsx";

/**
 * Repository AI Enablement — the 16-stage onboarding pipeline
 * (`repository-ai-enablement`). The sole "AI management" screen for a
 * repo — mounted at both `#/repo/<id>` and `#/repo-onboarding/<id>`;
 * the old 3-step flow's screen (`RepoAiPanel.tsx`) was fully deleted
 * (2026-09-16), not just unlinked. Deliberately minimal per the earlier
 * design discussion: a real approval block only for the `WaitingForUser`
 * stages that genuinely need a human to decide something — most other
 * stages show a step rail plus a single "advance" button.
 */
// Title/description text below is the user's own exact per-stage
// write-up (supplied verbatim, 2026-09-16, after the source "36-section"
// spec text itself turned out not to be preserved anywhere in the repo
// or this project's history — only a condensed one-liner per stage had
// survived from an earlier pass). The user was explicit: to build trust,
// the person running onboarding has to see all four of these fields —
// what happens now, how it's actually done, why it happens at this point
// in the order, and what it unlocks next — for every stage, not just the
// interactive ones, and BEFORE that stage runs, not only after.
// Titles only — no leading number baked in. The spec's own numbering
// (§8–§23) doesn't match actual run order for two stages (`guardrails`
// is spec stage 12 but runs 11th; `skills_evaluation` is spec stage 11
// but runs last, per Phase 6/4's own rollout-order decisions) — labeling
// by real position (computed from `ONBOARDING_STAGE_ORDER`/`d.stages`,
// see below) avoids showing "12" before "11" in a list that also claims
// to be "exactly this order."
const STAGE_LABELS: Record<string, string> = {
  workspace_setup: "חיבור Repository",
  repository_scan: "סריקה דטרמיניסטית",
  classification: "סיווג Repository",
  security_permissions: "אבטחה והרשאות",
  knowledge_coverage: "בדיקת ידע קיים",
  targeted_discovery: "Discovery ממוקד",
  human_enrichment: "העשרת ידע אנושית",
  knowledge_generation: "יצירת ידע Repository",
  claude_md_generation: "יצירת CLAUDE.md",
  scoped_rules: "בדיקת Scoped Rules",
  skills_evaluation: "בדיקת Skills",
  guardrails: "Guardrails",
  ai_doctor: "AI Doctor / Validation",
  user_review: "בדיקת משתמש",
  github_pull_request: "GitHub Pull Request",
  ai_ready: "AI Ready",
};
const stageLabelWithPos = (key: string, pos: number) => `${String(pos).padStart(2, "0")} — ${STAGE_LABELS[key] ?? key}`;
type StageDetail = {
  now: string; how: string; why: string; next: string;
  /** External references for a stage that names a specific third-party
   *  mechanism (e.g. `scc` for `repository_scan`) — shown as real links
   *  under "how", not just prose naming the tool. */
  links?: { label: string; url: string }[];
};
const STAGE_DETAILS: Record<string, StageDetail> = {
  workspace_setup: {
    now: "DCC מתחבר ל־Repository ומכין סביבת עבודה מבודדת ובטוחה שבה ניתן לבצע את תהליך ה־AI Onboarding.",
    how: "השלב הזה מתבצע על־ידי DCC ואינו משתמש ב־Claude.\n\nDCC מזהה את ה־Repository ומכין סביבת עבודה מבודדת המבוססת על Git. DCC מזהה את ה־default branch ואת ה־commit הנוכחי שעליו מתחיל ה־Onboarding, ושומר את ה־baseline לצורך מעקב והשוואה בהמשך.\n\nהעבודה מתבצעת ב־workspace מבודד ובענף ייעודי ל־Onboarding ולא ישירות על ה־default branch.\n\nבשלב הזה עדיין לא מתבצע ניתוח AI ולא מתבצעים שינויים בקוד של ה־Repository.",
    why: "לפני ש־DCC יכול לנתח או לשנות משהו ב־Repository, הוא חייב לדעת בדיוק על איזה Repository ועל איזה commit הוא עובד ולהבטיח שהעבודה מבודדת.",
    next: "כל שלבי ה־Onboarding הבאים עובדים מול אותה סביבת עבודה ואותו baseline, ולכן ניתן לדעת בדיוק מה היה מצב ה־Repository בתחילת התהליך ומה השתנה במהלכו.",
  },
  repository_scan: {
    now: "DCC ממפה את המבנה של ה־Repository כדי להבין מה קיים בו לפני שמבקשים מ־Claude לבצע ניתוח.",
    how: "השלב הזה אינו משתמש ב־Claude כלל — זהו קוד DCC רגיל (Node.js) שעובר על מערכת הקבצים של ה־Repository, לא מודל שפה. יש לו שני חלקים.\n\nהחלק הראשון הוא ה'הליכה' של DCC על עץ התיקיות (עד עומק 6 רמות — אם נחצית, מתקבלת אזהרה על תיקיות עמוקות שלא נסרקו, אבל השלב לא נכשל). ההליכה הזו מדלגת על תיקיות רעש ידועות (bin, obj, dist, build, node_modules, vendor וכו') ומזהה קבצי manifest של build לפי שם/סיומת (package.json→npm, *.csproj→dotnet וכו'), קבצי CI (.github/workflows, azure-pipelines.yml וכו'), קבצי תיעוד (README*, תיקיות docs), תיקיות בדיקות, וגם 'מציצה' לתוך package.json/*.csproj (עד 200KB לקובץ) כדי לזהות frameworks כמו React או Dynamics 365.\n\nהחלק השני — וזה השינוי המרכזי — הוא ספירת השפות עצמה. במקום לספור קבצים לפי סיומת (מה שהיה כאן קודם, ולא נתן תמונה מדויקת), DCC מפעיל כתהליך חיצוני כלי בשם scc (ראו הקישורים למטה) — כלי קוד-פתוח ייעודי לספירת קוד, שכבר מותקן על מכונת ה-deployment (בדיוק כמו שה-pipeline מניח ש-gh של GitHub כבר מותקן, DCC לא מוריד או מנהל את הבינארי בעצמו). scc סופר במדויק שורות קוד/הערות/רווח לכל שפה בנפרד, ומחשב גם אומדן מורכבות (complexity) — נתון אמיתי שמבוסס על הקוד עצמו, לא ניחוש. scc גם מכבד אוטומטית את קובץ .gitignore של הריפו, אבל בדיקה חיה על Altshuler Trade גילתה שזה לא מספיק לבד: הריפו הזה כן שומר תיקיית packages/ (חבילות NuGet ישנות) בתוך ה-git עצמו — לכן DCC מוסיף באופן מפורש את אותה רשימת תיקיות-רעש שהחלק הראשון כבר משתמש בה, כדי ש-scc לא יספור קוד של ספריות צד-שלישי כאילו הוא קוד הריפו.\n\nאם scc לא מותקן על המכונה, DCC נופל בחזרה לספירה הישנה (לפי סיומת קובץ בלבד, בלי שורות קוד או מורכבות) ומוסיף אזהרה על כך — השלב לא נכשל, פשוט מקבל פחות מידע.\n\nהתוצאה — לא הבנה סמנטית של הקוד עצמו, אלא אותות מבניים מדויקים — נשמרת ב־DCC כ־Repository Profile.",
    why: "לפני ניתוח AI צריך מידע מבני בסיסי ומדויק על ה־Repository — כדי שהסיווג בשלב הבא יתבסס על נתונים אמיתיים (למשל: כמה שורות קוד יש בכל שפה, ומה רמת המורכבות שלה), במקום שClaude יצטרך לנחש 'complexity: high' משום מקום.",
    next: "ה־Repository Profile — כולל שורות הקוד והמורכבות לכל שפה — משמש את שלב הסיווג כדי להבין איזה סוג Repository זה, אילו טכנולוגיות קיימות בו ומה עומק הניתוח שנדרש.",
    links: [
      { label: "scc — איך זה עובד (README)", url: "https://github.com/boyter/scc#readme" },
      { label: "scc — קוד פתוח (MIT), GitHub", url: "https://github.com/boyter/scc" },
    ],
  },
  classification: {
    now: "DCC משתמש במידע המבני שנאסף כדי להבין איזה סוג Repository זה, באילו טכנולוגיות הוא משתמש ומה מאפיין את הארכיטקטורה שלו.",
    how: "בשלב הזה Claude Code כן מעורב.\n\nDCC מעביר ל־Claude Code את המידע המבני שנאסף בשלב הסריקה יחד עם בקשת סיווג מוגדרת מראש. Claude מקבל הקשר ממוקד ולא נדרש להבין את כל ה־Repository.\n\nClaude מחזיר סיווג מובנה הכולל מאפיינים כגון סוג ה־Repository, stack טכנולוגי, ארכיטקטורה, מורכבות, legacy, תחומים מרכזיים, בשלות התיעוד והבדיקות, והאם נדרש discovery נוסף.\n\nהתוצאה נשמרת ב־DCC כחלק מתוצאות ה־Onboarding ואינה מהווה שינוי בקוד.",
    why: "עכשיו כבר קיים מידע מבני בסיסי שמאפשר ל־Claude לבצע סיווג ממוקד במקום להתחיל מניחוש או מסריקה מלאה.",
    next: "הסיווג קובע איזה עומק של discovery נדרש ואילו חלקים ב־Repository חשוב לנתח בשלבים הבאים.",
  },
  security_permissions: {
    now: "DCC קובע באילו הרשאות ובאילו מגבלות מותר לבצע את תהליך ה־Onboarding על ה־Repository.",
    how: "השלב מנוהל על־ידי DCC ואינו דורש ניתוח AI כדי לקבוע את מדיניות האבטחה.\n\nDCC בוחר Security Profile בהתאם למדיניות הארגונית ולמאפייני ה־Repository. הפרופיל קובע אילו פעולות מותר לבצע ואילו אזורים או פעולות צריכים להיות מוגנים.\n\nבהתאם לפרופיל, DCC מכין את הגדרות Claude Code ואת ה־guardrails המתאימים, כולל הגנות מפני פעולות Git מסוכנות, גישה ל־secrets, שינוי קבצים מוגנים ושינוי נתיבים שאינם מורשים.",
    why: "האבטחה חייבת להיקבע לפני ש־Claude מקבל גישה משמעותית יותר ל־Repository.",
    next: "השלבים הבאים יכולים לבצע discovery ויצירת artifacts בתוך סביבת עבודה עם גבולות והרשאות מוגדרים מראש.",
  },
  knowledge_coverage: {
    now: "DCC בודק איזה ידע חשוב על ה־Repository כבר מתועד ואיפה קיימים פערים.",
    how: "בשלב הזה Claude Code קורא את התיעוד הקיים והרלוונטי ב־Repository.\n\nClaude בודק נושאים כמו מטרת המערכת, ארכיטקטורה, גבולות בין רכיבים, build, testing, integrations, deployment, generated code ו־critical constraints.\n\nעבור כל תחום Claude קובע האם המידע קיים ומספיק, קיים באופן חלקי, או חסר.\n\nהמטרה היא להשתמש בתיעוד שכבר קיים במקום ליצור תיעוד כפול.",
    why: "לפני שמתחילים ליצור ידע חדש צריך לדעת איזה ידע כבר קיים.",
    next: "התוצאה מאפשרת ל־DCC ול־Claude להתמקד רק בפערים ובמידע שבאמת חסר במקום לייצר מחדש תיעוד שכבר קיים.",
  },
  targeted_discovery: {
    now: "DCC מבצע ניתוח ממוקד של חלקים חשובים ב־Repository כדי להבין איך המערכת באמת בנויה ומתנהגת.",
    how: "בשלב הזה Claude Code כן מעורב.\n\nClaude מקבל את תוצאות הסריקה, הסיווג ופערי הידע שכבר נמצאו. במקום לסרוק את כל ה־Repository ללא מטרה, הוא מבצע discovery ממוקד של רכיבים, entry points, גבולות בין מערכות, flows, integrations, build/test structure ואזורים מוגנים או generated.\n\nClaude מתעד גם את הנתיבים שבהם נמצא המידע ואת השאלות שלא ניתן היה לפתור מהקוד או מהתיעוד.\n\nהתוצאה נשמרת ב־DCC כ־Targeted Discovery.",
    why: "רק עכשיו קיימים מספיק נתונים כדי לדעת אילו חלקים של ה־Repository באמת דורשים בדיקה מעמיקה.",
    next: "ה־Discovery מספק את הראיות שעל בסיסן ניתן ליצור knowledge קבוע, CLAUDE.md, rules ו־Skills בלי להמציא מידע.",
  },
  human_enrichment: {
    now: "DCC מציג למשתמש שאלות שהמערכת לא יכולה לענות עליהן בצורה אמינה רק מתוך ה־Repository.",
    how: "השלב הזה אינו מבקש מ־Claude לנחש את התשובות.\n\nDCC מציג עד 10 שאלות בעלות ערך גבוה שנוצרו מתוך פערי הידע שהתגלו בשלבים הקודמים. המשתמש יכול לספק את המידע שחסר.\n\nהתשובות נשמרות ב־DCC כידע מאומת שסופק על־ידי המשתמש.\n\nאם לא נמצאו שאלות בעלות ערך, השלב יכול להיסגר ללא צורך בפעולת משתמש.",
    why: "רק לאחר שהמערכת ביצעה את הסריקה וה־discovery ניתן לדעת איזה מידע באמת חסר ולא כדאי לדרוש מהמשתמש מידע שכבר קיים בקוד או בתיעוד.",
    next: "התשובות מספקות ידע מאומת שיכול לשמש ביצירת הידע הקבוע של ה־Repository ובהכנת Claude לעבודה עתידית.",
  },
  knowledge_generation: {
    now: "DCC יוצר ידע קבוע ושימושי על ה־Repository מתוך המידע שכבר נאסף.",
    how: "בשלב הזה Claude Code משתמש בתוצאות ה־Discovery, בתיעוד הקיים ובידע המאומת שהתקבל מהמשתמש.\n\nClaude יוצר רק artifacts שהמערכת זקוקה להם בפועל. בהתאם ל־Repository ולמידע שנמצא, אלה יכולים לכלול מפת Repository, מידע ארכיטקטוני, integrations או critical context.\n\nהידע נשמר בתוך ה־Repository כדי שיהיה זמין גם לסשנים עתידיים ולא רק לסשן ה־Onboarding הנוכחי.",
    why: "כעת כבר נאסף מספיק מידע אמין כדי ליצור ידע קבוע במקום ליצור מסמכים על בסיס ניחושים.",
    next: "הידע הקבוע משמש כבסיס ל־CLAUDE.md, rules ו־Skills ומקטין את הצורך של Claude לבצע rediscovery בעתיד.",
  },
  claude_md_generation: {
    now: "DCC מכין את הקשר הקבוע והמצומצם ש־Claude צריך לקבל בכל עבודה עתידית על ה־Repository.",
    how: "Claude Code יוצר את CLAUDE.md בהתאם למידע שנאסף בשלבים הקודמים ולתבנית ה־Onboarding של DCC.\n\nהקובץ מכיל רק מידע שחשוב להיות זמין באופן קבוע, כגון אופן העבודה עם ה־Repository, מבנה בסיסי, מגבלות חשובות והפניות לידע מפורט יותר.\n\nהקובץ אינו אמור להיות inventory מלא של ה־Repository ואינו אמור להכיל task state או מידע זמני.",
    why: "רק לאחר שה־Repository נחקר ונוצר knowledge אמין ניתן להחליט מה באמת צריך להיות context קבוע עבור Claude.",
    next: "Claude יוכל להתחיל עבודה עתידית עם הקשר בסיסי נכון בלי לבצע בכל פעם מחדש את אותו discovery.",
  },
  scoped_rules: {
    now: "DCC בודק האם קיימים ב־Repository כללי עבודה ספציפיים שצריכים לחול רק על אזורים מסוימים.",
    how: "Claude Code מנתח את הידע והמבנה שכבר נמצאו ומעריך האם קיימים כללים מקומיים חשובים שאינם מתאימים ל־CLAUDE.md הכללי.\n\nRule נוצר רק כאשר קיימת הצדקה ברורה, כגון התנהגות שאינה מובנת מאליה, מגבלה משמעותית או סיכון הקשור לנתיבים מסוימים.\n\nאם אין צורך אמיתי ב־Scoped Rules, לא נוצר rule רק כדי למלא את השלב.",
    why: "רק לאחר שהמערכת מכירה את מבנה ה־Repository ניתן לדעת האם קיימים כללים שצריכים להיות scoped לאזורים מסוימים.",
    next: "Claude יקבל הנחיות ספציפיות רק במקומות שבהם הן באמת נחוצות, בלי להעמיס context גלובלי מיותר.",
  },
  skills_evaluation: {
    now: "DCC בודק האם יש workflow חוזר ושימושי שמצדיק יצירת Skill עבור ה־Repository.",
    how: "Claude Code מעריך את ה־workflows והצרכים שהתגלו במהלך ה־Onboarding.\n\nSkill נוצר רק כאשר מדובר בתהליך שחוזר על עצמו ושיש ערך ממשי להפוך אותו ליכולת reusable.\n\nלא נוצר Skill רק משום שאפשר ליצור Skill.",
    why: "רק לאחר שה־Repository וה־workflows שלו מובנים ניתן לדעת האם קיים תהליך שחוזר על עצמו ושווה להפוך אותו ל־Skill.",
    next: "כאשר קיים Skill מתאים, Claude יכול לבצע workflow חוזר בצורה עקבית ומהירה יותר במקום ללמוד אותו מחדש בכל פעם.",
  },
  guardrails: {
    now: "DCC מתקין ומוודא את מנגנוני ההגנה שמגבילים פעולות מסוכנות של Claude Code.",
    how: "השלב מתבצע באופן דטרמיניסטי על־ידי DCC.\n\nDCC מגדיר guardrails בהתאם ל־Security Profile שנבחר. ההגנות יכולות לכלול מניעת פעולות Git מסוכנות, הגנה על secrets, הגנה על generated/protected code והגבלת כתיבה לנתיבים מותרים.\n\nה־guardrails אינם מסתמכים על Claude כדי להחליט בזמן אמת האם פעולה מסוכנת.",
    why: "כעת כבר ידוע איזה Security Profile חל על ה־Repository ואילו אזורים דורשים הגנה.",
    next: "Claude יכול לעבוד בתוך ה־Repository עם שכבת הגנה נוספת שמונעת פעולות שאינן מורשות.",
  },
  ai_doctor: {
    now: "DCC בודק שה־AI configuration שנוצר עבור ה־Repository תקין ועובד כפי שמצופה.",
    how: "DCC מבצע בדיקות דטרמיניסטיות על artifacts כגון CLAUDE.md, rules, settings ו־hooks.\n\nבנוסף, Claude Code מבצע review של תוצרי ה־Onboarding ומנסה לזהות מידע שגוי, סתירות או בעיות בתוצרים שנוצרו.\n\nהתוצאה מסווגת כ־PASS, WARN או FAIL בהתאם לממצאים.",
    why: "כל התוצרים כבר קיימים ולכן ניתן לבדוק אותם לפני שהם הופכים לחלק קבוע מה־Repository.",
    next: "רק תוצרים שעברו את בדיקות ה־validation יכולים להתקדם ל־User Review ולשלב ה־GitHub Pull Request.",
  },
  user_review: {
    now: "DCC מציג למשתמש את השינויים והתוצרים שהוכנו ומבקש ממנו לאשר אותם לפני שהם נשלחים ל־Repository.",
    how: "DCC מציג את artifacts שנוצרו ואת תוצאות הבדיקות שבוצעו עליהם.\n\nהמשתמש יכול לאשר את התוצרים, לבקש שינויים או לעצור את התהליך.\n\nבשלב הזה DCC עדיין אינו מבצע merge ל־default branch.",
    why: "לפני שינוי קבוע ב־Repository המשתמש צריך לקבל הזדמנות לבדוק ולאשר את התוצרים שנוצרו על־ידי ה־Onboarding.",
    next: "לאחר אישור המשתמש ניתן לבצע commit, push וליצור Pull Request בצורה מבוקרת.",
  },
  github_pull_request: {
    now: "DCC מכין את השינויים שאושרו ומעביר אותם ל־GitHub באמצעות ענף Onboarding ו־Pull Request.",
    how: "DCC עובד על ענף ה־Onboarding המבודד ולא ישירות על ה־default branch.\n\nלאחר אישור המשתמש, DCC מבצע commit של התוצרים שאושרו, דוחף את הענף ל־GitHub ולאחר מכן מנסה ליצור Pull Request.\n\nPush מוצלח ויצירת Pull Request הם שתי פעולות נפרדות.\n\nאם ה־push הצליח אך יצירת ה־Pull Request נכשלה, DCC מציג זאת כמצב שונה ולא מציג את הפעולה כ־PR מוצלח.\n\nה־PR נשמר ב־DCC כאשר הוא נוצר, כולל המידע הדרוש כדי לעקוב אחריו.",
    why: "רק לאחר שהמשתמש אישר את התוצרים וה־validation הסתיים ניתן להעביר אותם ל־GitHub.",
    next: "הארגון יכול לבצע review ו־merge דרך תהליך ה־Git הרגיל, בלי ש־DCC יעקוף את מנגנון הבקרה של ה־Repository.",
  },
  ai_ready: {
    now: "DCC בודק האם תוצרי ה־Onboarding שאושרו אכן נמצאים ב־Repository בצורה שניתן להשתמש בה לעבודה עתידית עם Claude.",
    how: "DCC בודק שהשינויים שאושרו אכן נמצאים ב־Repository ובענף/commit המתאים, ושניתן לזהות אותם כחלק מתהליך ה־Onboarding שהושלם.\n\nהמערכת שומרת את גרסת ה־Onboarding ואת ה־commit שעליו ה־Repository הפך ל־AI Ready.",
    why: "זהו השלב האחרון לאחר שה־artifacts עברו validation, user review ותהליך GitHub.",
    next: "ה־Repository מסומן כ־AI Ready וניתן להשתמש ב־Claude Code עם ה־configuration והידע שנוצרו בתהליך.",
  },
};
// Not a `STAGE_ORDER` stage (it's the separate `checkRepositoryRefresh`
// analysis run after a repo is already `AI Ready` — see decision 6.0.3),
// so it has no row in the step rail. Surfaced only as a closing note on
// the pre-start overview so the user knows the process doesn't end at
// stage 16 forever — the repo keeps getting rechecked as it changes.
const REFRESH_INFO: StageDetail & { title: string } = {
  title: "Repository Refresh (לאחר שה-Repository מוכן)",
  now: "DCC בודק מה השתנה ב־Repository מאז ה־Onboarding האחרון ומעדכן רק את הידע והתצורה שהושפעו מהשינויים.",
  how: "DCC משווה בין מצב ה־Repository הנוכחי לבין ה־commit שעליו התבסס ה־Onboarding הקודם.\n\nבמקום לבצע מחדש את כל תהליך ה־Onboarding, DCC מזהה שינויים רלוונטיים ומעביר לניתוח רק את האזורים שהושפעו מהם.\n\nבהתאם לשינויים, ניתן לעדכן את הידע, ה־CLAUDE.md, rules או Skills הרלוונטיים.",
  why: "Repository שכבר עבר Onboarding לא צריך לעבור בכל פעם מחדש את אותו תהליך מלא.",
  next: "הידע והתצורה נשארים מעודכנים תוך צמצום משמעותי של rediscovery, קריאת קבצים וצריכת Claude.",
};

function StageDetailFields({ d }: { d: StageDetail }) {
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 12.5, color: "var(--ink-600)" }}>
      <div><b style={{ color: "var(--ink-700)" }}>מה קורה עכשיו: </b>{d.now}</div>
      <div>
        <b style={{ color: "var(--ink-700)" }}>איך זה מתבצע בפועל: </b><span style={{ whiteSpace: "pre-line" }}>{d.how}</span>
        {d.links && d.links.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {d.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>{l.label} ↗</a>
            ))}
          </div>
        )}
      </div>
      <div><b style={{ color: "var(--ink-700)" }}>למה עכשיו: </b>{d.why}</div>
      <div><b style={{ color: "var(--ink-700)" }}>מה זה מאפשר בהמשך: </b>{d.next}</div>
    </div>
  );
}
const STATUS_HE: Record<string, string> = {
  Pending: "ממתין להרצה", Running: "רץ עכשיו", WaitingForUser: "ממתין לאדם", Completed: "הושלם",
  CompletedWithWarnings: "הושלם עם אזהרות", Failed: "נכשל", Skipped: "דולג", Cancelled: "בוטל",
};

const humanizeKey = (k: string) => k.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");

/** Generic, stage-agnostic renderer for a stage's `result` jsonb — every
 *  stage owns its own result shape (16 different ones), so rather than
 *  hand-build bespoke UI per stage this walks whatever came back and
 *  renders it as labeled key/value pairs. Not as polished as a tailored
 *  view, but it means EVERY stage's real output is visible, not just the
 *  few that got custom treatment. */
function ResultView({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span style={{ color: "var(--ink-400)" }}>—</span>;
  if (typeof value !== "object") return <span style={{ fontSize: 12.5 }}>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: "var(--ink-400)" }}>(ריק)</span>;
    return (
      <ul style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 6 }}>
        {value.map((v, i) => (
          <li key={i} style={{ fontSize: 12.5 }}>{typeof v === "object" && v !== null ? <ResultView value={v} /> : String(v)}</li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span style={{ color: "var(--ink-400)" }}>(ריק)</span>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <b style={{ color: "var(--ink-700)", fontSize: 11.5 }}>{humanizeKey(k)}: </b>
          {v === null || v === undefined || v === "" ? <span style={{ color: "var(--ink-400)" }}>—</span>
            : typeof v === "object" ? <div style={{ marginTop: 2, marginInlineStart: 10 }}><ResultView value={v} /></div>
            : <span style={{ fontSize: 12.5 }}>{String(v)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Shown for any stage that made a real Claude call (`claudeExecutionId`
 *  set) — the prompt actually sent (the active template's body; the
 *  resolved `{{PLACEHOLDER}}` values themselves aren't persisted, see
 *  `runner.ts`) alongside the raw text Claude returned. Editing and
 *  saving registers a NEW immutable prompt version (`updateOnboardingPrompt`
 *  → `registerPromptVersion`) — it only affects the next run of this
 *  stage, never rewrites what already happened. */
function ClaudeCallPanel({ repoId, executionId }: { repoId: string; executionId: string }) {
  const [exec, setExec] = useState<OnboardingExecution | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setExec(null); setEditing(false); setSaveState("idle");
    getOnboardingExecution(repoId, executionId).then((e) => { setExec(e); setDraft(e.promptBody); }).catch(() => {});
  }, [repoId, executionId]);

  if (!exec) return <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 10 }}>טוען את פרטי הקריאה ל-Claude…</p>;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
      <p className="section-lbl">הפרומפט שנשלח ל-Claude · {exec.promptKey} גרסה {exec.promptVersion}</p>
      {!editing ? (
        <>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--surface-muted)", padding: 10, borderRadius: 8, maxHeight: 260, overflow: "auto", fontFamily: "var(--mono)" }}>{exec.promptBody}</pre>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>ערוך פרומפט</button>
        </>
      ) : (
        <>
          <textarea
            style={{ width: "100%", minHeight: 220, fontSize: 11.5, fontFamily: "var(--mono)" }}
            value={draft} onChange={(e) => setDraft(e.target.value)}
          />
          <p style={{ fontSize: 11, color: "var(--ink-400)", margin: "4px 0" }}>
            השמירה תיצור גרסה חדשה לפרומפט הזה — היא תשפיע רק על ההרצה הבאה של השלב הזה, לא על קריאות שכבר בוצעו.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={saveState === "saving"} onClick={async () => {
              setSaveState("saving");
              try { await updateOnboardingPrompt(exec.promptKey, draft); setSaveState("saved"); setEditing(false); }
              catch { setSaveState("error"); }
            }}>
              {saveState === "saving" ? "שומר…" : "שמור גרסה חדשה"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setDraft(exec.promptBody); }}>ביטול</button>
          </div>
          {saveState === "error" && <p style={{ fontSize: 11, color: "var(--status-critical)", marginTop: 4 }}>שמירת הפרומפט נכשלה.</p>}
        </>
      )}
      {saveState === "saved" && <p style={{ fontSize: 11, color: "var(--status-healthy)", marginTop: 6 }}>נשמרה גרסה חדשה של הפרומפט — היא תחול בהרצה הבאה של השלב הזה.</p>}

      <p className="section-lbl" style={{ marginTop: 12 }}>הפלט שהתקבל מ-Claude</p>
      {exec.resultText ? (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--surface-muted)", padding: 10, borderRadius: 8, maxHeight: 320, overflow: "auto" }}>{exec.resultText}</pre>
      ) : (
        <p style={{ fontSize: 11.5, color: "var(--ink-400)" }}>{exec.errorMessage ?? "אין פלט עדיין."}</p>
      )}
      <p style={{ fontSize: 10.5, color: "var(--ink-400)", marginTop: 4 }}>
        מודל: {exec.model ?? "—"} · הרשאה: {exec.permissionProfile} ·
        {" "}עלות: {exec.costUsd ? `$${Number(exec.costUsd).toFixed(4)}` : "—"} ·
        {" "}טוקנים: {((exec.inputTokens ?? 0) + (exec.outputTokens ?? 0)).toLocaleString()} ·
        {" "}משך: {exec.durationMs ? `${Math.round(exec.durationMs / 1000)}s` : "—"}
      </p>
    </div>
  );
}

type SuggestedRules = {
  suggestedRules: string[]; suggestedProfileId: string;
  profiles: { id: string; label: string; description: string }[];
};
type Questions = { questions: { id: string; question_he: string; why_it_matters_he: string; risk_if_unknown: string }[] };
type GuardrailCandidates = { candidates: { id: string; label: string; description: string; suggested: boolean }[] };
type UserReview = {
  readiness?: { status?: string };
  groups: { group_he: string; items: { label: string }[] }[];
};
type PrOrReadyResult = { prUrl?: string; compareUrl?: string; mergedCommitSha?: string; readinessDate?: string };

// Execution order — mirrors `packages/core/src/repo-onboarding/types.ts`'s
// `STAGE_ORDER` (deliberately duplicated, not imported: the web app has no
// dependency on `@dcc/core`, same reasoning as every other frontend/backend
// duplication in this codebase). Always used to build the full 16-entry
// rail — stage rows only exist in the DB once `advanceRun` actually
// reaches them (and none exist at all before a run is started), so this
// is what fills in every not-yet-reached step as a synthetic `Pending`
// row (see `merged` below), keeping every step visible and clickable
// from before the run even begins.
const ONBOARDING_STAGE_ORDER = [
  "workspace_setup", "repository_scan", "classification", "security_permissions",
  "knowledge_coverage", "targeted_discovery", "human_enrichment",
  "knowledge_generation", "claude_md_generation", "scoped_rules",
  "guardrails", "ai_doctor", "user_review", "github_pull_request", "ai_ready",
  "skills_evaluation",
];

const runIdKey = (repoId: string) => `dcc.onboarding.runId.${repoId}`;

export function RepoOnboardingPanel({ id: repoId, nav }: { id: string; nav: (h: string) => void }) {
  const [runId, setRunId] = useState<string | null>(() => localStorage.getItem(runIdKey(repoId)));
  // `localStorage` only knows about a run started in THIS browser — a repo
  // list, another device, or a cleared browser would otherwise see "no
  // active run" and offer to start a duplicate one even while a real run
  // is genuinely in progress. Fall back to asking the backend for the
  // repo's actual latest run before concluding there isn't one.
  const [checkedBackend, setCheckedBackend] = useState(false);
  const [d, setD] = useState<OnboardingRunView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editableRules, setEditableRules] = useState<string[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedGuardrailIds, setSelectedGuardrailIds] = useState<string[] | null>(null);
  const [cost, setCost] = useState<OnboardingRunCostSummary | null>(null);
  // Which stage's panel is on screen — separate from `r.currentStageKey`
  // (the stage actually executing/waiting) so a completed stage can be
  // clicked and reviewed without losing track of where the run itself
  // is. `null` means "follow the run" — defaults to the current stage
  // and re-syncs there automatically after every action that moves the
  // run forward (start/advance/approve/etc.), so the person always lands
  // back on what just happened instead of staring at whatever they had
  // open before.
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);

  const reload = (rid: string) => getOnboardingRun(repoId, rid).then(setD).catch((e) => setErr(String(e)));
  useEffect(() => { if (runId) reload(runId); }, [runId]);
  useEffect(() => { if (runId) getOnboardingRunCostSummary(repoId, runId).then(setCost).catch(() => {}); }, [runId, d?.run.status]);
  useEffect(() => {
    if (runId) return;
    getLatestOnboardingRun(repoId).then((latest) => {
      if (latest) { localStorage.setItem(runIdKey(repoId), latest.runId); setRunId(latest.runId); }
    }).finally(() => setCheckedBackend(true));
  }, [repoId, runId]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); setSelectedStageKey(null); if (runId) reload(runId); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  if (!runId && !checkedBackend) return <div className="spin">טוען…</div>;

  const r = d?.run ?? null;
  // Stage rows are created lazily in the DB — only once `advanceRun`
  // actually reaches them (and before any run exists, there ARE no rows
  // at all) — so `d.stages` only ever holds rows for stages already
  // reached. The person needs to see all 16 from the very start (gray,
  // not yet reached, but still clickable to read their explanation), not
  // have the rail grow one entry at a time as it runs, so every
  // not-yet-reached key gets a synthetic `Pending` row here — including
  // every single one when there's no run yet at all.
  const byKey = new Map((d?.stages ?? []).map((s) => [s.stageKey, s]));
  const merged: OnboardingStage[] = ONBOARDING_STAGE_ORDER.map((key, i) => byKey.get(key) ?? {
    id: `pending-${key}`, runId: r?.id ?? "", stageKey: key, stageOrder: i, status: "Pending", attempt: 0,
    startedAt: null, completedAt: null, result: null, warnings: [], errors: [],
    claudeExecutionId: null, sourceCommitSha: null, updatedAt: r?.startedAt ?? "",
  });

  const steps = merged.map((s, i) => ({ key: s.stageKey, label: stageLabelWithPos(s.stageKey, i + 1), description: STAGE_DETAILS[s.stageKey]?.now }));
  const done = merged.map((s) => ["Completed", "CompletedWithWarnings", "Skipped"].includes(s.status));
  // Every step is always clickable to preview its explanation, reached or
  // not — "locked" only ever meant "can't act on it yet", never "can't
  // even look at it", and conflating the two hid the very explanations
  // this screen exists to show.
  const unlocked = merged.map(() => true);
  const currentIdx = r?.currentStageKey ? merged.findIndex((s) => s.stageKey === r.currentStageKey) : -1;

  const selectedKey = selectedStageKey ?? r?.currentStageKey ?? merged[0]!.stageKey;
  const selectedIdx = Math.max(0, merged.findIndex((s) => s.stageKey === selectedKey));
  const selectedStage = merged[selectedIdx]!;
  const isLive = r !== null && selectedStage.stageKey === r.currentStageKey;
  const waiting = isLive && r!.status === "WaitingForUser";

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav("#/repositories")}>← Repositories</a>}
        title={r ? "הטמעת AI — Repository Onboarding" : "הטמעת AI — תהליך חדש"}
        sub={r
          ? `run ${r.id.slice(0, 8)} · ${STATUS_HE[r.status] ?? r.status}` + (cost && cost.executionCount > 0 ? ` · עלות AI: $${cost.totalCostUsd.toFixed(2)} · ${(cost.totalInputTokens + cost.totalOutputTokens).toLocaleString()} טוקנים` : "")
          : "לא נמצא תהליך onboarding פעיל לריפו הזה — כל 16 השלבים מוצגים למטה, לחיצה על כל אחד מהם מציגה את ההסבר שלו עוד לפני שהתהליך מתחיל."}
        actions={r && !["Completed", "CompletedWithWarnings", "Cancelled"].includes(r.status) ? (
          <button className="btn btn-secondary btn-sm" disabled={busy === "cancel"} onClick={() => run("cancel", async () => { await cancelOnboardingRun(repoId, r.id); localStorage.removeItem(runIdKey(repoId)); setRunId(null); })}>
            בטל תהליך
          </button>
        ) : undefined}
      />

      {err && <div className="callout" style={{ marginBottom: 14, fontSize: 12, color: "var(--status-critical)" }}>{err}</div>}

      {/* Primary action — always above the rail: "התחל תהליך" before a run
       * exists, "המשך לשלב הבא"/"נסה שוב" once it does. Absent while
       * `waiting`: the interactive form below (approve/answer/etc.) IS the
       * action in that state, a second generic button here would just be
       * confusing. */}
      {!r && (
        <div className="panel" style={{ textAlign: "center", padding: "16px", marginBottom: 16 }}>
          <button className="btn btn-primary" disabled={busy === "start"} onClick={() => run("start", async () => {
            const { runId: newId } = await startOnboardingRun(repoId);
            localStorage.setItem(runIdKey(repoId), newId);
            setRunId(newId);
          })}>
            {busy === "start" ? "מתחיל…" : "התחל תהליך"}
          </button>
          <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 8 }}>
            שלב 01 (חיבור Repository) יכול לקחת כמה דקות ברפוזיטורי גדול — המסך ישאר על "מתחיל…" עד שהוא מסתיים.
          </p>
        </div>
      )}
      {r && !waiting && !["Completed", "CompletedWithWarnings", "Cancelled"].includes(r.status) && (
        <div className="panel" style={{ textAlign: "center", padding: "16px", marginBottom: 16 }}>
          <button className="btn btn-primary" disabled={busy === "advance"} onClick={() => run("advance", () => advanceOnboardingRun(repoId, r.id))}>
            {r.status === "Failed" ? (busy === "advance" ? "מנסה שוב…" : "נסה שוב") : (busy === "advance" ? "מריץ…" : "המשך לשלב הבא")}
          </button>
        </div>
      )}
      {waiting && (
        <div className="panel" style={{ textAlign: "center", padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "var(--ink-500)" }}>
          השלב הנוכחי ממתין לאישור שלך — למטה.
        </div>
      )}
      {r && ["Completed", "CompletedWithWarnings"].includes(r.status) && (
        <div className="panel" style={{ textAlign: "center", padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "var(--status-healthy)" }}>
          התהליך הושלם.
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <StepRail
          steps={steps} done={done} unlocked={unlocked} active={selectedIdx}
          liveIndex={currentIdx >= 0 ? currentIdx : undefined}
          onPick={(i) => setSelectedStageKey(merged[i]!.stageKey)}
        />
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {stageLabelWithPos(selectedStage.stageKey, selectedIdx + 1)}
        </h3>
        <p style={{ fontSize: 11.5, color: isLive ? "var(--color-accent)" : "var(--ink-400)", marginBottom: 8, fontWeight: 600 }}>
          {isLive ? "◀ אתה צופה בשלב הפעיל כרגע" : done[selectedIdx] ? "אתה צופה בשלב שהושלם" : "אתה צופה בשלב שטרם הגיע התור שלו"}
        </p>
        {STAGE_DETAILS[selectedStage.stageKey] && (
          <div style={{ marginBottom: 10 }}><StageDetailFields d={STAGE_DETAILS[selectedStage.stageKey]!} /></div>
        )}
        {r && (
          <>
            <p style={{ fontSize: 12, color: "var(--ink-500)" }}>סטטוס: {STATUS_HE[selectedStage.status] ?? selectedStage.status}</p>
            {selectedStage.warnings.length > 0 && <p style={{ fontSize: 11.5, color: "var(--status-warning)", marginTop: 6 }}>{selectedStage.warnings.join(" · ")}</p>}
            {selectedStage.errors.length > 0 && <p style={{ fontSize: 11.5, color: "var(--status-critical)", marginTop: 6 }}>{selectedStage.errors.join(" · ")}</p>}
          </>
        )}

        {/* Output — shown for any stage that has actually run, whether
         * selected by click or because it's the live one; never for a
         * stage that hasn't been reached yet (nothing to show), and never
         * before a run even exists. */}
        {r && selectedStage.status !== "Pending" && !waiting && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border-hairline)", paddingTop: 10 }}>
            <p className="section-lbl">הפלט של השלב</p>
            {["github_pull_request", "ai_ready"].includes(selectedStage.stageKey) && (() => {
              const pr = selectedStage.result as PrOrReadyResult | null;
              if (!pr) return null;
              return (
                <p style={{ fontSize: 12, marginBottom: 8 }}>
                  {pr.prUrl && <a href={pr.prUrl} target="_blank" rel="noreferrer">Pull Request ↗</a>}
                  {!pr.prUrl && pr.compareUrl && <a href={pr.compareUrl} target="_blank" rel="noreferrer">פתח Pull Request ידנית ↗</a>}
                  {pr.readinessDate && <span style={{ color: "var(--ink-500)" }}> · מוכן מאז {new Date(pr.readinessDate).toLocaleDateString("he-IL")}</span>}
                </p>
              );
            })()}
            <ResultView value={selectedStage.result} />
            {selectedStage.claudeExecutionId && <ClaudeCallPanel repoId={repoId} executionId={selectedStage.claudeExecutionId} />}
          </div>
        )}
      </div>

      <details className="panel" style={{ padding: "10px 14px", opacity: 0.85, marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, listStyle: "revert" }}>{REFRESH_INFO.title}</summary>
        <div style={{ marginTop: 10 }}><StageDetailFields d={REFRESH_INFO} /></div>
      </details>

      {waiting && selectedStage.stageKey === "security_permissions" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">פרופיל אבטחה</p>
          {(() => {
            const result = selectedStage.result as SuggestedRules;
            const profileId = selectedProfileId ?? result.suggestedProfileId;
            const rules = editableRules ?? result.suggestedRules;
            return (
              <>
                <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 10 }}>
                  מגדירים אילו פעולות Claude יכול לבצע אוטומטית ואילו דורשות אישור. המוצע: <b>{result.profiles.find((p) => p.id === result.suggestedProfileId)?.label ?? result.suggestedProfileId}</b>.
                </p>
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {result.profiles.map((p) => (
                    <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, cursor: "pointer" }}>
                      <input type="radio" name="security-profile" checked={profileId === p.id} onChange={() => setSelectedProfileId(p.id)} style={{ marginTop: 3 }} />
                      <span>
                        <b>{p.label}</b>{p.id === result.suggestedProfileId && <span style={{ color: "var(--ink-400)" }}> (מוצע)</span>}
                        <br /><span style={{ color: "var(--ink-500)" }}>{p.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="section-lbl">כללי חסימת קריאה מוצעים</p>
                <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                  {rules.map((rule, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <code style={{ direction: "ltr", flex: 1 }}>{rule}</code>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditableRules(rules.filter((_, j) => j !== i))}>✕ הסר</button>
                    </div>
                  ))}
                  {rules.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>אין כללי חסימה — בחירה תקפה.</p>}
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === "approve"} onClick={() => run("approve", async () => {
                  await submitOnboardingStageInput(repoId, r.id, "security_permissions", { approvedRules: rules, approvedProfileId: profileId });
                  setEditableRules(null); setSelectedProfileId(null);
                })}>
                  {busy === "approve" ? "שומר…" : "✓ אשר הרשאות"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {waiting && selectedStage.stageKey === "human_enrichment" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">שאלות להשלמת ידע</p>
          {(() => {
            const result = selectedStage.result as Questions;
            return (
              <>
                <div style={{ display: "grid", gap: 16, marginBottom: 12 }}>
                  {result.questions.map((q) => (
                    <div key={q.id}>
                      <p style={{ fontSize: 13, fontWeight: 600 }}>{q.question_he}</p>
                      <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>{q.why_it_matters_he}</p>
                      <textarea
                        style={{ width: "100%", minHeight: 50, marginTop: 6 }}
                        placeholder="תשובה (אפשר להשאיר ריק)"
                        value={answers[q.id] ?? ""}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === "answer"} onClick={() => run("answer", async () => {
                  const payload = result.questions.map((q) => ({ id: q.id, answer_he: answers[q.id] ?? "" }));
                  await submitOnboardingStageInput(repoId, r.id, "human_enrichment", { answers: payload });
                  setAnswers({});
                })}>
                  {busy === "answer" ? "שולח…" : "✓ שלח תשובות"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {waiting && selectedStage.stageKey === "guardrails" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">מנגנוני הגנה</p>
          {(() => {
            const result = selectedStage.result as GuardrailCandidates;
            const selected = selectedGuardrailIds ?? result.candidates.filter((c) => c.suggested).map((c) => c.id);
            const toggle = (id: string) => setSelectedGuardrailIds(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
            return (
              <>
                <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 10 }}>מפעילים הגנות אוטומטיות (דטרמיניסטיות, ללא AI) עבור פעולות שאסור לבצע בטעות.</p>
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {result.candidates.map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} style={{ marginTop: 3 }} />
                      <span>
                        <b>{c.label}</b>{c.suggested && <span style={{ color: "var(--ink-400)" }}> (מוצע)</span>}
                        <br /><span style={{ color: "var(--ink-500)" }}>{c.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === "guardrails"} onClick={() => run("guardrails", async () => {
                  await submitOnboardingStageInput(repoId, r.id, "guardrails", { approvedGuardrailIds: selected });
                  setSelectedGuardrailIds(null);
                })}>
                  {busy === "guardrails" ? "שומר…" : "✓ אשר מנגנוני הגנה"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {waiting && selectedStage.stageKey === "user_review" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">סקירת המשתמש לפני Pull Request</p>
          {(() => {
            const result = selectedStage.result as UserReview;
            return (
              <>
                <p style={{ fontSize: 12, marginBottom: 12 }}>
                  תוצאת בדיקת תקינות: <b>{result.readiness?.status ?? "—"}</b>
                </p>
                <div style={{ display: "grid", gap: 14, marginBottom: 14 }}>
                  {result.groups.filter((g) => g.items.length > 0).map((g) => (
                    <div key={g.group_he}>
                      <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{g.group_he}</p>
                      {g.items.map((it, i) => (
                        <p key={i} style={{ fontSize: 12, color: "var(--ink-500)" }}>✓ {it.label}</p>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run("approve-review", () =>
                    submitOnboardingStageInput(repoId, r.id, "user_review", { decision: "approve" }))}>
                    {busy === "approve-review" ? "שומר…" : "אשר ופתח Pull Request"}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => {
                    const note = window.prompt("מה נדרש לשנות?") ?? "";
                    run("request-changes", () => submitOnboardingStageInput(repoId, r.id, "user_review", { decision: "request_changes", note }));
                  }}>
                    {busy === "request-changes" ? "שומר…" : "בקש שינויים"}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

    </>
  );
}

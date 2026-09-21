import type { Concept } from "../index.ts";

/**
 * What each screen is for — the "i" next to a screen's title (`PageHead`).
 * Named `page_<screen>`. A screen that has a chat answers "מה המסך הזה מציג?"
 * from `SCREEN_ABOUT` instead; these are the same idea in a shorter form for
 * someone looking at the title.
 */
export const PAGE_CONCEPTS: Concept[] = [
  { key: "page_requirements", kind: "section", title: "דרישות", explain: "דרישות-העל של כל הלקוחות. דרישה היא מה שביקשו לבנות; בתוכה יושבות דרישות משנה ומשימות. לחיצה על שורה פותחת את הדרישה." },
  { key: "page_works", kind: "section", title: "עבודות", explain: "כל הדרישות של כל הלקוחות בטבלה אחת, עם סינון לפי עדיפות, שלב וחסימות. מכאן רואים מה פתוח ומה תקוע." },
  { key: "page_clients", kind: "section", title: "לקוחות", explain: "הלקוחות שהמערכת עובדת בשבילם. כל לקוח הוא עולם נפרד: הדרישות, המאגרים והחיבורים שלו לא נראים ללקוח אחר." },
  { key: "page_client", kind: "section", title: "לקוח", explain: "הדרישות, המאגרים והחיבור ל-Azure DevOps של לקוח אחד. מכאן מייבאים דרישות ומקשרים מאגר." },
  { key: "page_repositories", kind: "section", title: "Repositories", aliases: ["מאגרים", "ריפוזיטורי"], explain: "מאגרי הקוד של כל הלקוחות. מאגר הוא המקום שבו הקוד גר. כאן מוסיפים מאגר ומקשרים אותו ללקוח." },
  { key: "page_pull_requests", kind: "section", title: "בקשות מיזוג", explain: "כל מה שממתין לאישור, מכל הלקוחות. בקשת מיזוג היא בקשה לחבר שינויים מענף אחד לענף אחר. המיזוג עצמו נעשה באתר המארח." },
  { key: "page_alerts", kind: "section", title: "התראות", explain: "דברים שדורשים תשומת לב: חסימה, תקציב, החלטה שמחכה, דדליין, בדיקה או פער. 'פתיחה' מביאה לדרישה שההתראה מדברת עליה." },
  { key: "page_budgets", kind: "section", title: "תקציבים", explain: "כמה ה-AI עלה החודש לכל לקוח, מול התקציב שהוגדר לו. הסכום נלקח מיומן הקריאות לקלוד ולא מהערכה." },
  { key: "page_audit_trail", kind: "section", title: "Audit Trail", aliases: ["יומן ביקורת"], explain: "כל החלטה, טיוטה, אישור ועלות, לפי הסדר, בלי להסתיר דבר. כך אפשר לשחזר מה קרה, מי אישר ומתי." },
  { key: "page_ado_tasks", kind: "section", title: "Azure DevOps", aliases: ["TFS", "ADO"], explain: "מצב הסנכרון מול Azure DevOps: כמה פריטים כבר קיימים ב-TFS ואילו עדיין לא הוקמו, לפי לקוח." },
  { key: "page_prompts", kind: "section", title: "פרומפטים", explain: "ההוראות ש-DCC שולח ל-Claude. כל קריאה בנויה מתבנית כאן, ולא ממחרוזת קבועה בקוד, כך שאפשר לראות בדיוק מה נשלח." },
  { key: "page_settings", kind: "section", title: "הגדרות", explain: "החיבורים (Azure DevOps), המאגרים ומדיניות המודלים. אלה הגדרות של כל המערכת ולא של לקוח אחד." },
  { key: "page_claude", kind: "section", title: "קלוד", explain: "מרכז הבקרה של קלוד: כל שיחה, כל קריאה וכל הכסף במקום אחד. כל מספר על קלוד במסך אחר הוא חתך ממה שכאן." },
  { key: "page_task", kind: "section", title: "משימה", explain: "משימה אחת מתוך דרישה: מה צריך לעשות, האם אושרה, מה קלוד ביצע בה ומה קרה בבדיקות." },
  { key: "page_onboarding_run", kind: "section", title: "הטמעת AI", explain: "הכנה של מאגר לעבודה עם Claude Code, בארבעה שלבים: הכנת עותק מבודד, הטמעה, סקירת הקבצים ומסירה כבקשת מיזוג." },
  { key: "page_onboarding_intro", kind: "section", title: "לפני שמתחילים", explain: "הסבר קצר על התהליך ובחירת אופן ההרצה. שום דבר לא רץ עד שתאשרו." },
  { key: "page_dashboard", kind: "section", title: "לוח בקרה", explain: "המסך הראשי: מה פתוח, מה חסום, כמה ה-AI עלה החודש, הדרישות האחרונות וההתראות. מכאן מגיעים לכל שאר המסכים." },
  { key: "page_requirement", kind: "section", title: "דרישה", screens: ["requirement"], explain: "הדרישה עצמה: מה ביקשו, באיזה שלב היא, מה עוד פתוח, אילו משימות נגזרו ממנה וכמה עלה עליה ה-AI. מכאן מריצים את שלבי העבודה." },
  { key: "page_flow", kind: "section", title: "מפת הדרישה", aliases: ["flow", "היררכיה"], explain: "ציור של הדרישה וכל מה שמתחתיה — דרישות משנה ומשימות — עם הקשרים ביניהן, כדי לראות את המבנה במבט אחד." },
  { key: "prompt_category", kind: "section", title: "קטגוריית פרומפטים", explain: "קיבוץ של הפרומפטים לפי השלב שהם משרתים. כל פרומפט הוא תבנית ההוראות שקלוד מקבל באותו שלב." },
  { key: "note_correction", kind: "section", title: "תיקון הערה", explain: "כתיבת גרסה מתוקנת להערה. ההערה המקורית נשארת בציר הזמן ומסומנת 'תוקן' — שום דבר לא נמחק, תיקון הוא רשומה חדשה." },
];

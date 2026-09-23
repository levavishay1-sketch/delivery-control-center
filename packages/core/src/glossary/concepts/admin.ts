import type { Concept } from "../index.ts";

/**
 * Clients, repositories, connections and the audit trail — the screens that
 * say who the system works for and what it is wired to.
 */
export const ADMIN_CONCEPTS: Concept[] = [
  { key: "client", kind: "term", title: "לקוח", aliases: ["לקוחות"], explain: "הגוף שעבורו עובדים. כל לקוח הוא עולם סגור: הדרישות, המאגרים והחיבורים שלו לא נראים ללקוח אחר, וזה נאכף במסד הנתונים עצמו." },
  { key: "client_delete", kind: "button", title: "מחיקה", aliases: ["מחיקת לקוח"], explain: "מוחק את הלקוח ואת מה שתחתיו ב-DCC: ה-repositories שלו, החיבורים והתקציב. אפשר למחוק רק לקוח שאין לו דרישות.", press: "הלקוח נעלם מכל המסכים, ואפשר ליצור לקוח חדש באותו שם. repository שגם לקוח אחר משתמש בו נשאר, כמשותף. הקבצים במחשב וב-GitHub לא נמחקים, והיסטוריית העלויות נשמרת. אי אפשר לבטל." },
  { key: "repository", kind: "term", title: "Repository", aliases: ["מאגר", "ריפו", "ריפוזיטורי"], explain: "המקום שבו הקוד של המוצר גר, אצל ספק כמו GitHub או Azure DevOps. DCC מתחבר אליו כדי לקרוא קוד ולפתוח בקשות מיזוג." },
  { key: "shared_repo", kind: "term", title: "Repository משותף", aliases: ["משותף"], explain: "מאגר ששייך ליותר מלקוח אחד. הטמעת AI זמינה רק למאגר של לקוח יחיד, כי קובצי ההנחיה שנכתבים בו הם של אותו לקוח." },
  { key: "onboarding_status", kind: "field", title: "מצב הטמעת AI", aliases: ["הטמעת AI"], screens: ["onboarding"], explain: "האם המאגר כבר הוכן לעבודה עם Claude Code — כלומר נכתבו בו קובצי ההנחיה שמסבירים לקלוד איך הוא בנוי." },
  { key: "git_connection", kind: "field", title: "Git", aliases: ["חיבור git"], explain: "הכתובת של המאגר אצל הספק, והאם DCC מחובר אליו. בלי חיבור אפשר לנהל דרישות, אבל אי אפשר לקרוא קוד או לפתוח בקשות מיזוג." },
  { key: "ado_connection", kind: "section", title: "חיבורי Azure DevOps", aliases: ["חיבור ADO", "חיבור"], explain: "החיבור למערכת שבה פריטי העבודה חיים. דרכו DCC מושך דרישות ומקים משימות; בלי חיבור הדרישות קיימות רק כאן." },
  { key: "model_policy", kind: "section", title: "Model policy", aliases: ["מדיניות מודלים"], explain: "איזה מודל של קלוד מריץ כל סוג פעולה, ומתי הוא עובר למודל חזק יותר. זו שכבת ברירת המחדל לכל הלקוחות; העריכה במסך קלוד." },
  { key: "audit_actor", kind: "field", title: "Actor", aliases: ["מי ביצע"], explain: "מי ביצע את הפעולה. גם פעולה של AI נרשמת על שם האדם שבשמו היא רצה — אין פעולה בלי בעלים." },
  { key: "audit_action", kind: "field", title: "Action", aliases: ["סוג הפעולה"], explain: "איזו פעולה נרשמה: אישור, שינוי סטטוס, הרצה, עריכה. הסינון לפי סוג עוזר למצוא מתי בדיוק משהו השתנה." },
  { key: "open_requirements", kind: "field", title: "דרישות פתוחות", screens: ["dashboard"], explain: "דרישות שעוד לא הושלמו, בכל הלקוחות. זה המספר שאומר כמה עבודה פתוחה יש במערכת כרגע." },
  { key: "client_requirements", kind: "section", title: "דרישות הלקוח", screens: ["dashboard"], explain: "כל הדרישות של הלקוח הזה, עם השלב שבו הן נמצאות וכמה חסמים פתוחים יש בכל אחת." },
  { key: "requirement_type", kind: "field", title: "סוג הדרישה", aliases: ["סוג"], explain: "איזה סוג עבודה זו: Epic, Feature, Story, Bug, Task או Spike. הסוג נקבע לפי מקומה בעץ, והוא מה שנוצר גם ב-Azure DevOps." },
  { key: "owner", kind: "field", title: "אחראי", aliases: ["מי אחראי"], explain: "האדם שהדרישה רשומה עליו. גם כשקלוד מבצע, האחריות והשאלות מגיעות לאדם הזה." },
  { key: "subrequirements", kind: "field", title: "תת-דרישות", explain: "כמה דרישות יושבות מתחת לדרישה הזו. דרישה גדולה מתפרקת לדרישות משנה, ורק הן מתפרקות למשימות." },
  { key: "updated_at", kind: "field", title: "עודכן", explain: "מתי נרשם בדרישה משהו בפעם האחרונה — הערה, החלטה, הרצה או שינוי סטטוס. דרישה שלא זזה זמן רב שווה בדיקה." },
  { key: "task_size", kind: "field", title: "גודל", aliases: ["appetite", "אפטייט"], explain: "כמה עבודה המשימה אמורה לקחת: קטנה, רגילה או גדולה. זו תחימה מראש, לא הערכת שעות." },
  { key: "task_state", kind: "field", title: "מצב המשימה", aliases: ["מצב"], explain: "איפה המשימה עומדת: ממתינה, בעבודה, חסומה, נפלה בבדיקות, הושלמה או נדחתה." },
  { key: "prompt_template", kind: "section", title: "פרומפט", aliases: ["תבנית פרומפט"], explain: "תבנית ההוראות שקלוד מקבל בשלב מסוים. עריכה כאן משנה כל קריאה עתידית מאותו שלב, בכל הלקוחות." },
  { key: "prompt_body", kind: "field", title: "גוף הפרומפט", explain: "ההוראות עצמן שנשלחות לקלוד, בדיוק כפי שהן כאן. עריכה משנה את הקריאה הבאה מאותו שלב, בכל הלקוחות. שמירה שמוחקת חלק שהקוד תלוי בו נחסמת, עם הסבר מה חסר." },
  { key: "prompt_default_model", kind: "field", title: "מודל ברירת מחדל", explain: "איזה מודל של קלוד מריץ את הפרומפט הזה, כשאף אחד לא בחר אחרת להרצה מסוימת. מודל חזק יותר עולה יותר." },
  { key: "prompt_policy_model", kind: "field", title: "מי מריץ אותו", explain: "איזה מודל ובאיזה מאמץ מריצים את הפרומפט הזה. זה נקבע במדיניות המודלים (מסך קלוד ← מדיניות ושמירה) ולא כאן, כדי שיהיה מקום אחד שקובע את זה לכל סוג קריאה." },
  { key: "prompt_contract", kind: "field", title: "מה חייב להישאר", explain: "החלקים בפרומפט שהקוד תלוי בהם: ערכים שהוא ממלא בזמן הריצה, ושמות שדות שהוא קורא מהתשובה של קלוד. שמירה שמוחקת אחד מהם נחסמת — הקריאה הייתה ממשיכה לרוץ, אבל מפסיקה לעבוד בשקט." },
  { key: "prompt_appended", kind: "field", title: "נשלח יחד עם", explain: "הפרומפט הזה לא נשלח לבד — הוא מצורף לסוף של פרומפטים אחרים, כך ששינוי בו משנה את כולם." },
  { key: "prompt_read", kind: "button", title: "הצג את הפרומפט", explain: "פותח את הטקסט המלא של הפרומפט: התרגום לעברית לקריאה, והאנגלית שבאמת נשלחת לקלוד.", press: "רק מציג — שום דבר לא משתנה ולא נשלח." },
  { key: "prompt_unused", kind: "field", title: "בשימוש", explain: "אף קריאה במערכת לא נבנית מהפרומפט הזה, אז עריכה שלו לא משנה שום דבר. כנראה שארית של שלב שהוחלף." },
  { key: "alert_kind", kind: "field", title: "סוג ההתראה", explain: "על מה ההתראה: חסימה, חריגת תקציב, החלטה שממתינה, דדליין, בדיקה או פער. הצבע לצד השורה אומר כמה זה דחוף." },
  { key: "ado_sync_state", kind: "section", title: "מצב מול Azure DevOps", explain: "כמה מהמשימות של הלקוח כבר קיימות כפריטי עבודה ב-TFS וכמה עדיין לא הוקמו. הקמה היא פעולה שמאשרים במסך הדרישה." },
];

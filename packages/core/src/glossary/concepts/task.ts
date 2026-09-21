import type { Concept } from "../index.ts";

/** A single task: approval, development in an isolated copy, checks, push. */
export const TASK_CONCEPTS: Concept[] = [
  { key: "approve", kind: "button", title: "אישור המשימה", aliases: ["אשר", "אישור", "approve"], screens: ["task"], explain: "מסמן שהמשימה מוגדרת נכון ואפשר לפתח אותה. עד האישור קלוד לא יכול לפתח אותה.", press: "המשימה מסומנת כמאושרת. אפשר לתקן קודם את הניסוח ואת גודל המשימה." },
  { key: "implement", kind: "button", title: "פיתוח המשימה", aliases: ["פתח", "פיתוח", "implement", "בצע"], screens: ["task"], explain: "קלוד כותב את הקוד של המשימה בעותק מבודד של המאגר, על ענף משלה, ומקומיט מקומית. שום דבר לא נדחף ולא מתמזג לבד.", press: "תיפתח תצוגה של מה שיישלח; אחרי אישור, ההרצה נמשכת דקות ועולה כסף. בסוף רואים מה השתנה ואת הבדיקות." },
  { key: "check", kind: "term", title: "בדיקה", aliases: ["בדיקות", "check"], screens: ["task"], explain: "משימה שרק מוודאת שמשהו עובד — קלוד מריץ אותה בלי יכולת לשנות קוד. משימה שנכשלו בה בדיקות מסומנת 'failed_checks' ומחכה להחלטה של אדם." },
  { key: "rollback", kind: "button", title: "ביטול השינויים", aliases: ["rollback", "שחזר"], screens: ["task"], explain: "מוחק את הענף המקומי שקלוד יצר למשימה, כאילו לא פותחה.", press: "השינויים בעותק המבודד נמחקים. מה שכבר נדחף לשרת לא נמחק." },
  { key: "push", kind: "button", title: "דחיפה", aliases: ["push", "דחוף"], screens: ["task"], explain: "שולח את הענף של המשימה לשרת ה-git, כדי לפתוח ממנו בקשת מיזוג.", press: "הענף עולה לשרת בשם שלכם. בקשת המיזוג עצמה נפתחת במסך בקשות מיזוג." },

  /* the cards of the task screen */
  { key: "task_result", kind: "section", title: "מה Claude עשה", screens: ["task"], explain: "מה קלוד שינה בפועל בהרצה: אילו קבצים נגע בהם, מה כתב ומה עלו הבדיקות. זה מה שתקבלו לסקירה לפני שמשהו נדחף." },
  { key: "task_delete", kind: "section", title: "מחיקת משימה", screens: ["task"], explain: "הסרת המשימה מהדרישה. אם היא כבר קיימת ב-TFS, המחיקה שם היא פעולה נפרדת — המסך אומר מה בדיוק יקרה לפני שמאשרים." },
  { key: "task_previous_run", kind: "section", title: "הרצה קודמת", screens: ["task"], explain: "הרצה שבוטלה או הוחלפה. היא נשארת כאן כדי שאפשר יהיה לראות מה נוסה קודם ולמה — שום דבר לא נמחק מההיסטוריה." },
];

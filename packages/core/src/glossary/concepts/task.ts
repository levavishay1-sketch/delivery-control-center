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

  /* the fields of the task screen */
  { key: "expected_files", kind: "field", title: "קבצים צפויים", screens: ["task"], explain: "הקבצים שצפוי שהמשימה תיגע בהם, לפי מה שנכתב בה. זו הערכה מראש — הרשימה של מה שבאמת השתנה מופיעה אחרי ההרצה." },
  { key: "compiled_components", kind: "field", title: "רכיבים מתקמפלים", screens: ["task"], explain: "החלקים בתוכנה שצריך לבנות ולהתקין מחדש יחד עם השינוי הזה, אחרת הוא לא ייכנס לתוקף בסביבה." },
  { key: "files_changed", kind: "field", title: "קבצים שהשתנו", screens: ["task"], explain: "הקבצים שקלוד באמת נגע בהם בהרצה. אלה השינויים שיעברו סקירה ואחר כך יידחפו — כרגע הם רק בעותק המבודד." },
  { key: "where_it_sits", kind: "field", title: "איפה זה יושב", screens: ["task"], explain: "התיקייה והענף שבהם השינוי נמצא כרגע, ומספר השמירה שלו. זה עותק מבודד — העותק שאתם עובדים בו לא נגוע." },
  { key: "local_check", kind: "field", title: "לבדיקה מקומית", screens: ["task"], explain: "הפקודות להעתקה למי שרוצה לפתוח את השינוי במחשב שלו ולהסתכל עליו. אפשר גם פשוט לקרוא את רשימת הקבצים כאן." },
  { key: "subtasks", kind: "field", title: "תת-משימות", screens: ["task"], explain: "משימות שנגזרו מהמשימה הזו. הן נעשות לפני שהיא נחשבת גמורה, וכל אחת מנוהלת במסך משלה." },
  { key: "task_intent", kind: "field", title: "כותרת / intent", aliases: ["intent"], screens: ["task"], explain: "מה המשימה אמורה להשיג, במשפט אחד. זו גם הכותרת שתופיע ב-TFS, ולכן כדאי שהיא תיקרא למי שלא ישב בדיון." },
  { key: "remaining_work", kind: "field", title: "המשך שנשאר", screens: ["task"], explain: "מה קלוד סימן שעוד לא הסתיים בהרצה — עבודה שנשארה פתוחה. זה לא קורה לבד: צריך להחליט אם להריץ שוב או לפצל למשימה נוספת." },
  { key: "check_results", kind: "field", title: "תוצאות הבדיקות", screens: ["task"], explain: "מה עברו הבדיקות שרצו על המשימה, וכמה נכשלו. משימה שנפלה בבדיקות מחכה להחלטה של אדם ולא ממשיכה לבד." },
];

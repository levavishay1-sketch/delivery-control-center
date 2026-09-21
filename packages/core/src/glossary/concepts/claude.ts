import type { Concept } from "../index.ts";

/** The Claude control center: the ledger, routing policy, chat, insights. */
export const CLAUDE_CONCEPTS: Concept[] = [
  { key: "ledger", kind: "term", title: "יומן הקריאות", aliases: ["קריאות", "רשומה", "ledger"], screens: ["claude"], explain: "רשומה אחת לכל קריאה לקלוד, מכל מסלול: מתי, מי, על מה, איזו יכולת, מודל, מאמץ, טוקנים, עלות, זמן ותוצאה. זה המקור היחיד לכל מספר על עלות." },
  { key: "without_model", kind: "term", title: "נענו בלי מודל", aliases: ["בלי מודל", "מהמערכת"], screens: ["claude"], explain: "שאלות בצ'אט שהמערכת ענתה עליהן ישירות מהמילון או מהעובדות שעל המסך, בלי לפנות למודל. הן חינם ומיידיות." },
  { key: "unhelpful", kind: "term", title: "לא עזר", aliases: ["לא עזרה", "unhelpful"], screens: ["claude"], explain: "תשובה שאדם סימן שלא עזרה, או שאותה שאלה נשאלה שוב מיד אחריה. בלי הסימון הזה נדע כמה שאלנו, לא אם זה היה שווה." },
  { key: "escalated", kind: "term", title: "הוסלם", aliases: ["נדרש מודל חזק", "הסלמה"], screens: ["claude"], explain: "קריאה שהמדיניות העבירה למודל חזק מברירת המחדל לפי כלל, או שאדם בחר בה מודל חזק ידנית. הרבה הסלמות בכלל אחד = ברירת מחדל מוסווית." },
  { key: "cache", kind: "term", title: "מטמון", aliases: ["cache", "נקראו מהמטמון"], screens: ["claude"], explain: "טוקני קלט שהמודל כבר ראה בקריאה קודמת ונקראו מהמטמון — עולים עשירית מהמחיר. שיעור נמוך אומר שהחלק הקבוע של הפרומפט קצר מדי או משתנה." },
  { key: "policy", kind: "term", title: "מדיניות", aliases: ["מדיניות ניתוב", "policy"], screens: ["claude"], explain: "איזה מודל לאיזו יכולת, איזה מאמץ, ומה התקרות. נערכת במקום אחד וחלה על כל קריאה; כל קריאה נושאת את גרסת המדיניות שלפיה נותבה." },
  { key: "rollover", kind: "term", title: "גלגול שיחה", aliases: ["גלגול", "התגלגלה להמשך"], screens: ["claude"], explain: "שיחה שהתארכה או התקררה ממשיכה בשיחה חדשה עם סיכום קצר. מה שכבר ראיתם נשאר על המסך; הסיכום הוא קריאה שנרשמת ועולה כסף כמו כל קריאה." },
  { key: "retention", kind: "term", title: "שמירה", aliases: ["תקופת שמירה", "retention"], screens: ["claude"], explain: "כמה זמן תוכן השיחות נשמר. אחרי התקופה הטקסט נמחק; רשומות הקריאה והעלות נשארות לתמיד. ללקוח אפשר לקבוע תקופה משלו." },
  { key: "insights", kind: "term", title: "מסקנות", aliases: ["שאלות חוזרות", "שאלות שחוזרות", "insights"], screens: ["claude"], explain: "שאלות שחזרו על אותו מסך, מקובצות. שאלה שחוזרת היא פער במסך ולא בקלוד — המסך לא אמר את זה מספיק טוב. הקיבוץ עצמו לא עולה כסף." },
  { key: "analyse", kind: "button", title: "נתח שאלות", aliases: ["ניתוח שאלות", "ניתוח", "analyse"], screens: ["claude"], explain: "מבקש מקלוד לנסח ממצא והמלצה לכל שאלה שחזרה מעל סף החזרות.", press: "קריאה אחת בשמכם, שנרשמת ביומן עם עלותה. שום מסך לא משתנה — נכתבים ממצא והמלצה, ומהם אפשר לפתוח משימת שיפור." },
  { key: "improvement_task", kind: "button", title: "פתח משימת שיפור", aliases: ["משימת שיפור"], screens: ["claude"], explain: "הופך ממצא לדרישה על הלקוח הפנימי של DCC, בשמכם, עם הממצא וההמלצה כהערה הראשונה שלה.", press: "נוצרת דרישה חדשה במסך הדרישות (לא ב-TFS), והמסקנה מסומנת כמטופלת ומקושרת אליה." },
  { key: "threshold", kind: "term", title: "סף החזרות", aliases: ["סף", "insightsMinRepeats"], screens: ["claude"], explain: "כמה פעמים שאלה צריכה לחזור כדי שקלוד יתבקש לנסח לה ממצא. ערך במדיניות." },

  /* the cards and sections of the control center */
  { key: "cost_this_month", kind: "field", title: "עלות החודש", aliases: ["כמה הוצאנו"], screens: ["claude"], explain: "כמה כסף ה-AI הוציא מתחילת החודש, בכל המסלולים יחד. המספר הוא סכום של קריאות אמיתיות ביומן, לא הערכה." },
  { key: "cost_by_client", kind: "section", title: "לאן הולך הכסף · לפי לקוח", aliases: ["לפי לקוח"], screens: ["claude"], explain: "חלוקת ההוצאה של החודש בין הלקוחות. עמודה ארוכה = לקוח שצורך יותר AI; המספר לצד השם הוא מספר הקריאות." },
  { key: "cost_by_capability", kind: "section", title: "לפי סוג פעולה", aliases: ["לפי יכולת"], screens: ["claude"], explain: "על מה הכסף הלך: בחינת בשלות, פירוק, פיתוח, צ'אט, הטמעה. כך רואים איזו פעולה יקרה באמת, ולא רק כמה קראנו." },
  { key: "cost_by_model", kind: "section", title: "לפי מודל", screens: ["claude"], explain: "כמה עלה כל מודל של קלוד החודש. מודל חזק עולה פי כמה מאחד קל, ולכן חלוקה לא צפויה כאן היא סימן לבדוק את המדיניות." },
  { key: "cost_by_screen", kind: "section", title: "לפי מסך", screens: ["claude"], explain: "מאיזה מסך במערכת יצאו הקריאות. מסך עם הרבה קריאות הוא בדרך כלל מסך שעובדים בו הרבה, או כזה שלא מספיק ברור מעצמו." },
  { key: "cost_by_person", kind: "section", title: "לפי אדם", screens: ["claude"], explain: "כמה קריאות וכמה כסף לכל אדם. כל פעולה של AI רצה תמיד בשם של אדם אמיתי, גם כשהיא רצה ברקע." },
  { key: "chat_how_conversations_open", kind: "section", title: "איך שיחות נפתחות", screens: ["claude"], explain: "ההסבר לאופן שבו הצ'אט מתנהל: הנושא נקבע לפי המסך, לכל נושא שיחה נפרדת לכל אדם, ושיחה ארוכה ממשיכה בשיחה חדשה עם סיכום." },
  { key: "chat_targets", kind: "section", title: "מה מכוונים לפיו", screens: ["claude"], explain: "המספרים שלפיהם מחליטים אם הצ'אט עובד טוב: כמה עולה שאלה, כמה נענו בלי לפנות למודל, וכמה סומנו כלא עוזרות." },
  { key: "policy_in_practice", kind: "section", title: "המדיניות בפועל", screens: ["claude"], explain: "כמה קריאות רצו לפי ברירת המחדל, כמה עברו למודל חזק לפי כלל, כמה נבחרו ידנית וכמה נדחו כי חרגו מהתקרה." },
  { key: "tokens", kind: "section", title: "טוקנים", aliases: ["טוקן", "tokens"], screens: ["claude"], explain: "טוקן הוא פיסת טקסט קטנה, והיחידה שלפיה קלוד מחויב. כאן רואים כמה נשלחו, כמה נקראו מהמטמון וכמה קלוד החזיר." },
  { key: "unanswered", kind: "section", title: "\"אין לי את זה במסך\"", aliases: ["לא נענה", "אין לי את זה"], screens: ["claude"], explain: "שאלות שקלוד לא יכול היה לענות עליהן כי המידע פשוט לא מוצג במסך. כל שורה כזו היא רמז למה שכדאי להוסיף למסך." },
  { key: "failed_calls", kind: "section", title: "לא עבד", aliases: ["שגיאות", "פסק זמן"], screens: ["claude"], explain: "קריאות שנגמרו בשגיאה, בפסק זמן או בדחייה. דחייה קורית כשהקריאה גדולה מהתקרה שהוגדרה, כדי לא להוציא כסף בטעות." },
  { key: "insight_actions", kind: "section", title: "מה עושים עם מסקנה", screens: ["claude"], explain: "שלוש הדרכים לטפל בשאלה שחוזרת: לבקש מקלוד לנסח ממצא, לפתוח ממנה משימת שיפור, או לסמן שהיא לא רלוונטית." },
  { key: "policy_tiers", kind: "section", title: "הדרגות", aliases: ["דרגה", "tier"], screens: ["claude"], explain: "שלוש רמות של מודל — קל, רגיל וחזק — ולכל אחת המודל שמריץ אותה ותקרת עלות לקריאה אחת. כל סוג פעולה משויך לדרגה." },
  { key: "chat_settings", kind: "section", title: "הצ'אט", screens: ["claude"], explain: "ההגדרות של הצ'אט: מתי שיחה ארוכה מדי ממשיכה בשיחה חדשה, כמה זמן שומרים תוכן, ומאיזה סכום קלוד מצהיר על עלות לפני שהוא רץ." },
  { key: "retention_per_client", kind: "section", title: "שמירה לפי לקוח", screens: ["claude"], explain: "כמה זמן נשמר תוכן השיחות של לקוח מסוים. ריק = לפי ברירת המחדל. רשומות העלות נשארות תמיד, גם אחרי שהטקסט נמחק." },
  { key: "price_list", kind: "section", title: "מחירון", screens: ["claude"], explain: "דולר למיליון טוקנים לכל מודל, לפי המחירון הרשמי. משמש להערכה מראש; החיוב בפועל נלקח ממה שהקריאה עצמה דיווחה." },
  { key: "policy_save_effect", kind: "section", title: "מה קורה כששומרים", screens: ["claude"], explain: "שמירת המדיניות משפיעה על הקריאה הבאה מכל מסך; קריאות שכבר רצות לא משתנות, והשינוי נרשם ביומן עם מי שינה ומתי." },
];

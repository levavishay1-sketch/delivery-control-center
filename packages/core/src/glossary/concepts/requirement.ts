import type { Concept } from "../index.ts";

/** A requirement and its workflow: assessment, breakdown, gaps, blockers, cost. */
export const REQUIREMENT_CONCEPTS: Concept[] = [
  { key: "assess", kind: "button", title: "בחינת בשלות", aliases: ["בחן בשלות", "בדיקת בשלות", "assess"], screens: ["requirement"], explain: "קלוד קורא את הדרישה (ואת הקוד, אם יש מאגר מקושר) ובודק אם היא ברורה מספיק כדי להתחיל לעבוד. התוצאה: סיכום, ורשימת פערים — שאלות שצריך לשאול לפני שמתחילים.", press: "תיפתח תצוגה של מה שיישלח לקלוד, ורק אחרי אישור ההרצה תתחיל. היא נמשכת כמה דקות ועולה כסף; שום דבר בדרישה לא משתנה בלי שתאשרו את הפערים." },
  { key: "breakdown", kind: "button", title: "פירוק למשימות", aliases: ["פרק למשימות", "פירוק", "breakdown"], screens: ["requirement"], explain: "קלוד קורא את הדרישה ואת הפערים שנסגרו, ומציע רשימת משימות עם סדר ותלות ביניהן.", press: "תיפתח תצוגה של מה שיישלח, ורק אחרי אישור ההרצה תתחיל. המשימות מוצעות בלבד — הן לא נוצרות ב-TFS עד שתאשרו אותן בשלב הבא." },
  { key: "materialize", kind: "button", title: "אישור יצירת משימות ב-TFS", aliases: ["יצירת משימות", "אישור משימות", "materialize"], screens: ["requirement"], explain: "המשימות שקלוד הציע נכתבות ל-Azure DevOps (TFS) כפריטי עבודה אמיתיים, תחת הדרישה.", press: "המשימות נוצרות ב-TFS. זו כתיבה למערכת חיצונית — אפשר לערוך משימה לפני האישור, ואי אפשר לבטל את היצירה בלחיצה אחת." },
  { key: "start", kind: "button", title: "התחלת עבודה", aliases: ["התחל עבודה", "start building"], screens: ["requirement"], explain: "הדרישה עוברת לשלב הבנייה: מקבלת מפתח, ענף, ומעכשיו הפעילות בקוד נרשמת אליה.", press: "הדרישה מסומנת כ'בבנייה'. אם יש חוסם פתוח, זה נרשם — אבל לא מונע." },
  { key: "gap", kind: "term", title: "פער", aliases: ["פערים", "gap", "gaps"], screens: ["requirement"], explain: "שאלה שהדרישה לא עונה עליה ושצריך לשאול לפני שמתחילים. קלוד מציע פערים; אדם מאשר, סוגר או דוחה אותם, וכל תשובה נרשמת." },
  { key: "blocker", kind: "term", title: "חוסם", aliases: ["חוסמים", "blocker"], screens: ["requirement"], explain: "משהו שעוצר את העבודה עד שמישהו עונה — גישה חסרה, החלטה, מידע. חוסם פתוח מסומן באדום בראש המסך." },
  { key: "phase", kind: "field", title: "Phase", aliases: ["פאזה", "phase"], screens: ["requirement"], explain: "באיזה שלב הדרישה: intake (נקלטה), shaping (בעיצוב — פערים ופירוק), building (בבנייה), review (בבדיקה), done (הושלמה)." },
  { key: "ai_budget", kind: "field", title: "AI budget", aliases: ["תקציב AI", "תקציב"], screens: ["requirement"], explain: "כמה כסף מותר ל-AI להוציא על הדרישה הזו. 'default' = לפי תקציב הלקוח." },
  { key: "ai_cost", kind: "field", title: "עלות AI בפועל", aliases: ["עלות AI", "כמה עלה", "עלות"], screens: ["requirement"], explain: "כמה כסף ה-AI הוציא על הדרישה עד עכשיו — סכום כל הקריאות לקלוד עליה, מיומן הקריאות. לחיצה פותחת את הפירוט: כל קריאה, המודל, הטוקנים והעלות." },
  { key: "timeline", kind: "term", title: "Timeline", aliases: ["ציר זמן", "יומן"], screens: ["requirement"], explain: "כל מה שקרה בדרישה, לפי סדר: הערות, פערים, הרצות של קלוד, החלטות. שום דבר לא נמחק — תיקון הוא רשומה חדשה." },
  { key: "tfs", kind: "term", title: "TFS", aliases: ["azure devops", "ado"], screens: ["requirement"], explain: "Azure DevOps — המערכת שבה המשימות חיות באמת. DCC משקף ומעשיר, ולא מחליף אותה." },

  /* the cards of the requirement's workflow */
  { key: "assess_result", kind: "section", title: "מה Claude הבין ומה הוא חושב", screens: ["requirement"], explain: "סיכום הבשלות: מה קלוד הבין מהדרישה, ומה לדעתו חסר כדי להתחיל. אפשר להריץ שוב אם הדרישה השתנתה מאז." },
  { key: "how_to_continue", kind: "section", title: "איך ממשיכים?", screens: ["requirement"], explain: "הצעד הראשון בדרישה חדשה: קלוד קורא אותה ואת הקוד ואומר אם היא ברורה מספיק כדי לפרק אותה למשימות." },
  { key: "research_work", kind: "section", title: "עבודת תחקור או בדיקות", aliases: ["תחקור", "עבודת בדיקות"], screens: ["requirement"], explain: "דרישה שהתוצאה שלה היא ממצאים או תוצאת אימות, ולא קוד. לכן אין פירוק למשימות פיתוח, אלא משימת מעקב אחת ב-TFS." },
  { key: "prompt_preview", kind: "section", title: "מה יישלח ל-Claude", aliases: ["תצוגה מקדימה", "הפרומפט", "פרומפט"], screens: ["requirement", "task"], explain: "ההוראות המדויקות שיישלחו לקלוד, לפני שנשלחות. שום דבר לא רץ ולא עולה כסף עד שתאשרו כאן. ההרצה עצמה תמיד באנגלית; העברית היא לקריאה." },
];

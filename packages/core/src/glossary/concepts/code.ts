import type { Concept } from "../index.ts";

/**
 * The pictures of the code itself — the code map and the before/after
 * comparison — shown on the task, the pull request and the onboarding run.
 */
export const CODE_CONCEPTS: Concept[] = [
  { key: "code_map", kind: "section", title: "מצב הקוד", aliases: ["מפת הקוד", "code map"], explain: "ציור של הענפים: איפה יושב השינוי שלכם ביחס לענף הראשי, ומה כבר נכנס לכל אחד. נקודה היא שמירה של עבודה, לפי הסדר." },
  { key: "file_compare", kind: "section", title: "לפני ואחרי", aliases: ["השוואת קבצים", "diff"], explain: "התוכן של הקובץ לפני השינוי ואחריו, זה לצד זה, והשינויים מסומנים. אפשר לראות את הקובץ במלואו, או רק את השינויים עם קצת סביבם, ולעבור בין שינוי לשינוי." },
  { key: "workflow_steps", kind: "section", title: "שלבי העבודה", aliases: ["השלבים", "צעדים"], explain: "הסדר שבו דרישה מתקדמת. כל שלב נפתח רק כשהקודם הסתיים, כדי שלא נדלג על החלטה שצריך לקבל לפניו." },
  { key: "prompt_emphasis", kind: "field", title: "דגש מיוחד לבדיקה הזו", explain: "משפט חופשי שנוסף להוראות שקלוד מקבל, למשל לשים לב לתרחיש מסוים. לא חובה — בלעדיו הוא עובד לפי הדרישה כפי שהיא." },
  { key: "run_branch", kind: "field", title: "ענף ההרצה", aliases: ["ענף"], screens: ["onboarding"], explain: "הענף שנוצר להרצה הזו, שאליו נכתב כל מה שהיא עושה. העותק שאתם עובדים בו לא נגוע בשום שלב." },
  { key: "run_baseline", kind: "field", title: "נקודת התחלה", screens: ["onboarding"], explain: "מצב הקוד שממנו ההרצה יצאה. כך אפשר לדעת בדיוק מה היא הוסיפה, גם אם בינתיים נכנסו שינויים אחרים." },
  { key: "run_base_branch", kind: "field", title: "נוצר מהענף", aliases: ["מאיזה ענף", "ענף הבסיס"], screens: ["onboarding"], explain: "הענף הראשי של המאגר, שההרצה נגזרה ממנו ושאליו תחזור בקשת המיזוג בסוף. אם נגזרה מענף אחר, היא תישא איתה גם את העבודה שיש בו." },
  { key: "run_files", kind: "field", title: "קבצים בהרצה", aliases: ["קבצים"], screens: ["onboarding"], explain: "כמה קבצים יש במאגר שנסרק, וכמה מהם ההרצה שינתה בפועל. רק מה ששונה ייכנס לבקשת המיזוג." },
  { key: "stage_cost", kind: "field", title: "עלות השלב", screens: ["onboarding"], explain: "כמה הוציא השלב הזה לבדו, מיומן הקריאות. סכום כל השלבים הוא עלות ההרצה." },
  { key: "run_pr", kind: "field", title: "Pull Request", aliases: ["בקשת המיזוג של ההרצה"], screens: ["onboarding"], explain: "בקשת המיזוג שנפתחה בסוף ההרצה. משם הקבצים נכנסים למאגר האמיתי, אחרי סקירה ומיזוג שאדם מאשר." },
  { key: "what_gets_written", kind: "section", title: "מה ייכתב לריפו", screens: ["onboarding"], explain: "קובצי ההנחיה שההטמעה מוסיפה למאגר, כדי שקלוד יבין איך הוא בנוי. מה בדיוק — הוא מציע ואתם מחליטים בשיחה." },
  { key: "what_youll_be_asked", kind: "section", title: "על מה תישאלו", screens: ["onboarding"], explain: "השאלות שקלוד לא יכול לענות עליהן מהקוד לבדו: מה לעשות עם הגדרות קיימות, ואיך דברים נהוגים אצלכם." },
  { key: "stage_overview", kind: "section", title: "מה יקרה, בשלבים", screens: ["onboarding"], explain: "סקירה של כל שלבי ההטמעה לפי הסדר ומה כל אחד עושה, לפני שמתחילים. שום שלב לא רץ בלי שתאשרו, אלא אם בחרתם אחרת." },
];

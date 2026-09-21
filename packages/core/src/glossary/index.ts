/**
 * The glossary of every screen (claude-in-dcc §4.6, §6.2, §11.4): for each
 * button and term, one Hebrew name, one sentence that says what it is, and
 * — for a button — what happens if you press it. ONE wording, three
 * readers: the `?` next to the control, the chat (which answers from here
 * with no model call), and whoever documents the screen.
 *
 * A screen registered with `useClaudeContext` must have an entry here;
 * `scripts/audit-stale.mjs` checks that.
 */

export type GlossaryEntry = {
  key: string;
  /** The name as it appears on the screen. */
  title: string;
  /** Other ways a person says it. */
  aliases?: string[];
  /** What it is / what it shows — one or two plain sentences. */
  explain: string;
  /** For a button: what happens if you press it (and what does NOT happen). */
  press?: string;
  kind: "button" | "term" | "field";
};

export type ScreenGlossary = {
  screen: string;
  /** What the screen is for — the answer to "מה המסך הזה מציג?". */
  about: string;
  entries: GlossaryEntry[];
};

const requirement: ScreenGlossary = {
  screen: "requirement",
  about: "מסך של דרישה אחת: מה ביקשו, באיזה שלב זה, מה עדיין פתוח (פערים וחוסמים), אילו משימות נגזרו ממנה, וכמה עלה ה-AI עליה עד עכשיו. מכאן מריצים את השלבים: בחינת בשלות, פירוק למשימות, ואישור המשימות ב-TFS.",
  entries: [
    { key: "assess", kind: "button", title: "בחינת בשלות", aliases: ["בחן בשלות", "בדיקת בשלות", "assess"], explain: "קלוד קורא את הדרישה (ואת הקוד, אם יש מאגר מקושר) ובודק אם היא ברורה מספיק כדי להתחיל לעבוד. התוצאה: סיכום, ורשימת פערים — שאלות שצריך לשאול לפני שמתחילים.", press: "תיפתח תצוגה של מה שיישלח לקלוד, ורק אחרי אישור ההרצה תתחיל. היא נמשכת כמה דקות ועולה כסף; שום דבר בדרישה לא משתנה בלי שתאשרו את הפערים." },
    { key: "breakdown", kind: "button", title: "פירוק למשימות", aliases: ["פרק למשימות", "פירוק", "breakdown"], explain: "קלוד קורא את הדרישה ואת הפערים שנסגרו, ומציע רשימת משימות עם סדר ותלות ביניהן.", press: "תיפתח תצוגה של מה שיישלח, ורק אחרי אישור ההרצה תתחיל. המשימות מוצעות בלבד — הן לא נוצרות ב-TFS עד שתאשרו אותן בשלב הבא." },
    { key: "materialize", kind: "button", title: "אישור יצירת משימות ב-TFS", aliases: ["יצירת משימות", "אישור משימות", "materialize"], explain: "המשימות שקלוד הציע נכתבות ל-Azure DevOps (TFS) כפריטי עבודה אמיתיים, תחת הדרישה.", press: "המשימות נוצרות ב-TFS. זו כתיבה למערכת חיצונית — אפשר לערוך משימה לפני האישור, ואי אפשר לבטל את היצירה בלחיצה אחת." },
    { key: "start", kind: "button", title: "התחלת עבודה", aliases: ["התחל עבודה", "start building"], explain: "הדרישה עוברת לשלב הבנייה: מקבלת מפתח, ענף, ומעכשיו הפעילות בקוד נרשמת אליה.", press: "הדרישה מסומנת כ'בבנייה'. אם יש חוסם פתוח, זה נרשם — אבל לא מונע." },
    { key: "gap", kind: "term", title: "פער", aliases: ["פערים", "gap", "gaps"], explain: "שאלה שהדרישה לא עונה עליה ושצריך לשאול לפני שמתחילים. קלוד מציע פערים; אדם מאשר, סוגר או דוחה אותם, וכל תשובה נרשמת." },
    { key: "blocker", kind: "term", title: "חוסם", aliases: ["חוסמים", "blocker"], explain: "משהו שעוצר את העבודה עד שמישהו עונה — גישה חסרה, החלטה, מידע. חוסם פתוח מסומן באדום בראש המסך." },
    { key: "phase", kind: "field", title: "Phase", aliases: ["פאזה", "phase"], explain: "באיזה שלב הדרישה: intake (נקלטה), shaping (בעיצוב — פערים ופירוק), building (בבנייה), review (בבדיקה), done (הושלמה)." },
    { key: "ai_budget", kind: "field", title: "AI budget", aliases: ["תקציב AI", "תקציב"], explain: "כמה כסף מותר ל-AI להוציא על הדרישה הזו. 'default' = לפי תקציב הלקוח." },
    { key: "ai_cost", kind: "field", title: "עלות AI בפועל", aliases: ["עלות AI", "כמה עלה", "עלות"], explain: "כמה כסף ה-AI הוציא על הדרישה עד עכשיו — סכום כל הקריאות לקלוד עליה, מיומן הקריאות. לחיצה פותחת את הפירוט: כל קריאה, המודל, הטוקנים והעלות." },
    { key: "timeline", kind: "term", title: "Timeline", aliases: ["ציר זמן", "יומן"], explain: "כל מה שקרה בדרישה, לפי סדר: הערות, פערים, הרצות של קלוד, החלטות. שום דבר לא נמחק — תיקון הוא רשומה חדשה." },
    { key: "tfs", kind: "term", title: "TFS", aliases: ["azure devops", "ado"], explain: "Azure DevOps — המערכת שבה המשימות חיות באמת. DCC משקף ומעשיר, ולא מחליף אותה." },
  ],
};

const task: ScreenGlossary = {
  screen: "task",
  about: "מסך של משימה אחת מתוך דרישה: מה צריך לעשות, האם היא אושרה, מה קלוד ביצע בה, ומה קרה בבדיקות. מכאן מאשרים משימה, מריצים את הפיתוח בעותק מבודד, ודוחפים את התוצאה.",
  entries: [
    { key: "approve", kind: "button", title: "אישור המשימה", aliases: ["אשר", "אישור", "approve"], explain: "מסמן שהמשימה מוגדרת נכון ואפשר לפתח אותה. עד האישור קלוד לא יכול לפתח אותה.", press: "המשימה מסומנת כמאושרת. אפשר לתקן קודם את הניסוח ואת גודל המשימה." },
    { key: "implement", kind: "button", title: "פיתוח המשימה", aliases: ["פתח", "פיתוח", "implement", "בצע"], explain: "קלוד כותב את הקוד של המשימה בעותק מבודד של המאגר, על ענף משלה, ומקומיט מקומית. שום דבר לא נדחף ולא מתמזג לבד.", press: "תיפתח תצוגה של מה שיישלח; אחרי אישור, ההרצה נמשכת דקות ועולה כסף. בסוף רואים מה השתנה ואת הבדיקות." },
    { key: "check", kind: "term", title: "בדיקה", aliases: ["בדיקות", "check"], explain: "משימה שרק מוודאת שמשהו עובד — קלוד מריץ אותה בלי יכולת לשנות קוד. משימה שנכשלו בה בדיקות מסומנת 'failed_checks' ומחכה להחלטה של אדם." },
    { key: "rollback", kind: "button", title: "ביטול השינויים", aliases: ["rollback", "שחזר"], explain: "מוחק את הענף המקומי שקלוד יצר למשימה, כאילו לא פותחה.", press: "השינויים בעותק המבודד נמחקים. מה שכבר נדחף לשרת לא נמחק." },
    { key: "push", kind: "button", title: "דחיפה", aliases: ["push", "דחוף"], explain: "שולח את הענף של המשימה לשרת ה-git, כדי לפתוח ממנו בקשת מיזוג.", press: "הענף עולה לשרת בשם שלכם. בקשת המיזוג עצמה נפתחת במסך בקשות מיזוג." },
  ],
};

const pullRequest: ScreenGlossary = {
  screen: "pull_request",
  about: "מסך של בקשת מיזוג אחת: מאיזה ענף לאיזה, האם היא עדיין מבוססת על קוד עדכני, מה חסר לפני מיזוג (סקירה, בדיקות, התנגשויות), ומה קרה לה לאורך הזמן. הפעולות עצמן — עדכון, סקירה, מיזוג — נעשות בשם שלכם באתר המארח.",
  entries: [
    { key: "update_branch", kind: "button", title: "עדכן מהבסיס", aliases: ["עדכון מהבסיס", "update branch", "עדכן את הענף"], explain: "מכניס לענף של הבקשה את כל מה שנוסף לענף שהיא מיועדת אליו מאז שנפתחה.", press: "אם אין התנגשות — הענף מתעדכן ומסומן 'עדכנית'. אם יש התנגשות — העדכון נעצר, הענף נשאר בדיוק כמו שהיה, והמסך אומר איך ממשיכים." },
    { key: "request_review", kind: "button", title: "בקש סקירה", aliases: ["בקשת סקירה", "request review"], explain: "שולח למישהו בקשה לקרוא את השינויים ולאשר אותם.", press: "נשלחת בקשה באתר המארח בשם שלכם. הסקירה עצמה נעשית שם." },
    { key: "merge", kind: "button", title: "מזג", aliases: ["מיזוג", "merge", "למזג"], explain: "מחבר את הענף של הבקשה לענף היעד. זו פעולה של האתר המארח (GitHub / Azure DevOps) בשם שלכם.", press: "המיזוג מתבצע באתר המארח ואי אפשר לבטל אותו בלחיצה. הכפתור זמין רק כשיש סקירה מאושרת, אין התנגשות, והבקשה שמעליה (אם יש) כבר מוזגה." },
    { key: "review", kind: "term", title: "סקירה", aliases: ["review", "סקירה מאושרת"], explain: "מישהו אחר קורא את השינויים ומאשר אותם, או מבקש תיקונים. בלי סקירה מאושרת אי אפשר למזג." },
    { key: "stale", kind: "term", title: "לא עדכנית", aliases: ["מאחורי הבסיס", "behind", "stale"], explain: "מאז שהענף נפתח נוספו לענף היעד שינויים שאין בו. המספר אומר כמה, ו'קבצים בסיכון' אומר כמה מהם נוגעים באותם קבצים — זה מה שקובע אם העדכון דחוף." },
    { key: "conflict", kind: "term", title: "התנגשות", aliases: ["conflict", "קונפליקט"], explain: "שני ענפים שינו את אותן שורות בצורה שונה, ו-git לא יודע איזו לקחת. מישהו צריך להחליט ידנית." },
    { key: "project_branch", kind: "term", title: "ענף פרויקט", aliases: ["project branch", "ענף של פרויקט"], explain: "ענף שאוסף כמה משימות של אותו פרויקט. כל משימה מתמזגת לתוכו, והוא מתמזג ל-master בסוף, בבקשת מיזוג אחת שאדם מאשר." },
    { key: "task_branch", kind: "term", title: "ענף משימה", aliases: ["task branch"], explain: "ענף של משימה אחת, שנפתח מענף הפרויקט ומתמזג חזרה אליו כשהמשימה גמורה." },
    { key: "checks", kind: "term", title: "בדיקות", aliases: ["checks", "בנייה", "build"], explain: "מה שהאתר המארח מריץ אוטומטית על הבקשה: בנייה ובדיקות. 'עבר' ירוק — אפשר להמשיך; 'נכשל' — צריך תיקון לפני מיזוג." },
  ],
};

const onboarding: ScreenGlossary = {
  screen: "onboarding",
  about: "הטמעת מאגר: הכנה של המאגר לעבודה עם Claude Code, בארבעה שלבים סביב סשן חי אחד — הכנת עותק מבודד, ההטמעה עצמה (/init של Claude Code, בטרמינל), סקירה של כל קובץ שנוצר, ומסירה ל-git כבקשת מיזוג.",
  entries: [
    { key: "prepare", kind: "button", title: "הכנת הריפו", aliases: ["הכנה", "prepare", "עותק מבודד"], explain: "יוצר עותק מבודד של המאגר על ענף חדש, כדי שההטמעה לא תיגע בעותק העבודה שלכם.", press: "נוצר עותק ועליו ענף בשם ai/onboarding/<מזהה>. שום דבר לא נכתב למאגר המקורי." },
    { key: "init", kind: "button", title: "הטמעה", aliases: ["init", "/init", "הרץ הטמעה"], explain: "Claude Code האמיתי רץ בטרמינל שלמטה ומריץ /init: קורא את המאגר וכותב את קובצי ההנחיה (CLAUDE.md ועוד) בעותק המבודד. אתם עונים לו בטרמינל.", press: "נפתח סשן חי בטרמינל. הוא עולה כסף כל עוד הוא רץ, וכשמסיימים לוחצים 'סיימתי עם ההטמעה'." },
    { key: "review", kind: "button", title: "סקירה", aliases: ["review", "סקירת הקבצים"], explain: "רשימת כל הקבצים שהסשן שינה, עם לפני/אחרי. אפשר לבקש מהסשן תיקונים ולרענן.", press: "אישור הסקירה מעביר למסירה. שום דבר לא נמסר לפני האישור, אלא אם הגדרתם שער אוטומטי." },
    { key: "deliver", kind: "button", title: "מסירה", aliases: ["deliver", "מסור"], explain: "מקומיט את הקבצים בעותק המבודד, דוחף את הענף ופותח בקשת מיזוג.", press: "הענף נדחף לשרת ונפתחת בקשת מיזוג בשם שלכם. המיזוג עצמו — במסך בקשות מיזוג, אחרי סקירה." },
    { key: "automation", kind: "term", title: "אוטומציה", aliases: ["מדיניות אוטומציה", "לבד", "ידני"], explain: "אילו שלבים מתחילים לבד כשהקודם מסתיים, והאם שער הסקירה מחכה לאדם. 'צעד אחר צעד' = הכול ידני." },
    { key: "model_effort", kind: "term", title: "מודל ומאמץ", aliases: ["מודל", "מאמץ", "effort"], explain: "איזה מודל של Claude מריץ את ההטמעה וכמה מאמץ הוא משקיע. ברירת המחדל מהמדיניות; אפשר לשנות להרצה אחת." },
    { key: "run_cost", kind: "field", title: "עלות ההרצה", aliases: ["עלות", "כמה עלה"], explain: "כמה ההרצה עלתה עד עכשיו, מיומן הקריאות, לפי שלב. חלק שהסשן הפעיל הוציא ועדיין לא נרשם מסומן בנפרד." },
  ],
};

const claude: ScreenGlossary = {
  screen: "claude",
  about: "מרכז הבקרה של קלוד: כל קריאה, כל שיחה, כל הכסף, המדיניות והמסקנות — במקום אחד. כל מספר על קלוד במסך אחר הוא חתך ממה שכאן.",
  entries: [
    { key: "ledger", kind: "term", title: "יומן הקריאות", aliases: ["קריאות", "רשומה", "ledger"], explain: "רשומה אחת לכל קריאה לקלוד, מכל מסלול: מתי, מי, על מה, איזו יכולת, מודל, מאמץ, טוקנים, עלות, זמן ותוצאה. זה המקור היחיד לכל מספר על עלות." },
    { key: "without_model", kind: "term", title: "נענו בלי מודל", aliases: ["בלי מודל", "מהמערכת"], explain: "שאלות בצ'אט שהמערכת ענתה עליהן ישירות מהמילון או מהעובדות שעל המסך, בלי לפנות למודל. הן חינם ומיידיות." },
    { key: "unhelpful", kind: "term", title: "לא עזר", aliases: ["לא עזרה", "unhelpful"], explain: "תשובה שאדם סימן שלא עזרה, או שאותה שאלה נשאלה שוב מיד אחריה. בלי הסימון הזה נדע כמה שאלנו, לא אם זה היה שווה." },
    { key: "escalated", kind: "term", title: "הוסלם", aliases: ["נדרש מודל חזק", "הסלמה"], explain: "קריאה שהמדיניות העבירה למודל חזק מברירת המחדל לפי כלל, או שאדם בחר בה מודל חזק ידנית. הרבה הסלמות בכלל אחד = ברירת מחדל מוסווית." },
    { key: "cache", kind: "term", title: "מטמון", aliases: ["cache", "נקראו מהמטמון"], explain: "טוקני קלט שהמודל כבר ראה בקריאה קודמת ונקראו מהמטמון — עולים עשירית מהמחיר. שיעור נמוך אומר שהחלק הקבוע של הפרומפט קצר מדי או משתנה." },
    { key: "policy", kind: "term", title: "מדיניות", aliases: ["מדיניות ניתוב", "policy"], explain: "איזה מודל לאיזו יכולת, איזה מאמץ, ומה התקרות. נערכת במקום אחד וחלה על כל קריאה; כל קריאה נושאת את גרסת המדיניות שלפיה נותבה." },
    { key: "rollover", kind: "term", title: "גלגול שיחה", aliases: ["גלגול", "התגלגלה להמשך"], explain: "שיחה שהתארכה או התקררה ממשיכה בשיחה חדשה עם סיכום קצר. מה שכבר ראיתם נשאר על המסך; הסיכום הוא קריאה שנרשמת ועולה כסף כמו כל קריאה." },
    { key: "retention", kind: "term", title: "שמירה", aliases: ["תקופת שמירה", "retention"], explain: "כמה זמן תוכן השיחות נשמר. אחרי התקופה הטקסט נמחק; רשומות הקריאה והעלות נשארות לתמיד. ללקוח אפשר לקבוע תקופה משלו." },
    { key: "insights", kind: "term", title: "מסקנות", aliases: ["שאלות חוזרות", "שאלות שחוזרות", "insights"], explain: "שאלות שחזרו על אותו מסך, מקובצות. שאלה שחוזרת היא פער במסך ולא בקלוד — המסך לא אמר את זה מספיק טוב. הקיבוץ עצמו לא עולה כסף." },
    { key: "analyse", kind: "button", title: "נתח שאלות", aliases: ["ניתוח שאלות", "ניתוח", "analyse"], explain: "מבקש מקלוד לנסח ממצא והמלצה לכל שאלה שחזרה מעל סף החזרות.", press: "קריאה אחת בשמכם, שנרשמת ביומן עם עלותה. שום מסך לא משתנה — נכתבים ממצא והמלצה, ומהם אפשר לפתוח משימת שיפור." },
    { key: "improvement_task", kind: "button", title: "פתח משימת שיפור", aliases: ["משימת שיפור"], explain: "הופך ממצא לדרישה על הלקוח הפנימי של DCC, בשמכם, עם הממצא וההמלצה כהערה הראשונה שלה.", press: "נוצרת דרישה חדשה במסך הדרישות (לא ב-TFS), והמסקנה מסומנת כמטופלת ומקושרת אליה." },
    { key: "threshold", kind: "term", title: "סף החזרות", aliases: ["סף", "insightsMinRepeats"], explain: "כמה פעמים שאלה צריכה לחזור כדי שקלוד יתבקש לנסח לה ממצא. ערך במדיניות." },
  ],
};

const dashboard: ScreenGlossary = {
  screen: "dashboard",
  about: "לוח הבקרה: מה פתוח, מה חסום, כמה ה-AI עלה החודש, הדרישות האחרונות וההתראות. מכאן מוסיפים דרישה חדשה ומגיעים לכל מסך אחר.",
  entries: [
    { key: "initiatives", kind: "term", title: "דרישות-על", aliases: ["דרישת על", "initiatives"], explain: "דרישה שאין לה דרישת אב — מה שפעם נקרא פרויקט. תחתיה עץ של דרישות ומשימות." },
    { key: "blocked", kind: "term", title: "דרישות חסומות", aliases: ["חסומות", "חסימות"], explain: "דרישות עם חוסם פתוח — משהו שמחכה לתשובה של אדם לפני שאפשר להמשיך." },
    { key: "ai_cost_month", kind: "field", title: "עלות AI החודש", aliases: ["עלות AI", "כמה עלה החודש"], explain: "סכום כל הקריאות לקלוד מתחילת החודש, מיומן הקריאות, מול סך תקציבי הלקוחות." },
    { key: "new_requirement", kind: "button", title: "הוספת דרישה", aliases: ["דרישה חדשה", "הוסף דרישה"], explain: "פותח טופס לדרישה חדשה תחת לקוח.", press: "הדרישה נוצרת ב-DCC. אם הלקוח מסונכרן ל-Azure DevOps היא נוצרת גם שם." },
  ],
};

const budgets: ScreenGlossary = {
  screen: "budgets",
  about: "תקציבים: עלות ה-AI החודשית של כל לקוח מול התקציב שהוגדר לו. הכסף שמוצג כאן הוא סכום הקריאות ביומן הקריאות של קלוד מתחילת החודש.",
  entries: [
    { key: "budget", kind: "field", title: "תקציב", aliases: ["תקציב חודשי"], explain: "כמה מותר ל-AI להוציא על הלקוח בחודש. מעל 80% מופיעה אזהרה." },
    { key: "spent", kind: "field", title: "מנוצל", aliases: ["עלות", "כמה נוצל"], explain: "כמה כבר הוצא החודש — מיומן הקריאות, לא הערכה." },
  ],
};

export const GLOSSARY: Record<string, ScreenGlossary> = Object.fromEntries(
  [requirement, task, pullRequest, onboarding, claude, dashboard, budgets].map((g) => [g.screen, g]),
);

export const glossaryFor = (screen: string | null | undefined): ScreenGlossary | null => (screen ? GLOSSARY[screen] ?? null : null);

/* ── step zero: answer from the glossary, no model ──────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[?!.,"'״׳()\[\]:;]/g, " ").replace(/\s+/g, " ").trim();
/** Hebrew questions carry prefixes ("ה", "ב", "ל", "ש", "מה זה ה…") — strip the common ones from each word once. */
const stem = (w: string) => w.replace(/^(ו|ה|ב|ל|מ|ש|כש|וה|וב|ול|שה|בה)(?=.{2,})/, "");
const words = (s: string) => norm(s).split(" ").filter(Boolean).map(stem);

const QUESTION_WORDS = /(^|\s)(מה|מהו|מהי|למה|איך|כמה|האם|הסבר|תסביר|מי|איפה|מתי)(\s|$)|\?/;

export type GlossaryMatch = { entry: GlossaryEntry; screen: ScreenGlossary; certainty: "certain" | "likely" };

/** Does the question name a glossary term of this screen? The longest name
 *  wins; a question that only contains the term in passing is "likely",
 *  a short question about it is "certain". */
export function matchGlossary(screen: string | null | undefined, question: string): GlossaryMatch | null {
  const g = glossaryFor(screen);
  if (!g) return null;
  const q = norm(question);
  const qw = words(question);
  if (!qw.length) return null;
  let best: { entry: GlossaryEntry; len: number } | null = null;
  for (const entry of g.entries) {
    for (const name of [entry.title, ...(entry.aliases ?? [])]) {
      const n = norm(name);
      const hit = q.includes(n) || words(name).every((w) => qw.includes(w));
      if (hit && (!best || n.length > best.len)) best = { entry, len: n.length };
    }
  }
  if (!best) return null;
  const isQuestion = QUESTION_WORDS.test(question);
  const certainty: GlossaryMatch["certainty"] = isQuestion && qw.length <= 12 ? "certain" : "likely";
  return { entry: best.entry, screen: g, certainty };
}

/** "מה המסך הזה מציג?" and the like. */
export const asksAboutScreen = (question: string) => /מה (ה)?מסך|מה רואים|מה יש (כאן|פה)|איפה אני|מה זה (המסך|הדף)/.test(norm(question));

/** The answer for a matched entry, in the words the `?` hint uses too. */
export function glossaryAnswer(m: GlossaryMatch): string {
  const e = m.entry;
  const head = e.kind === "button" ? `"${e.title}" — כפתור.` : e.kind === "field" ? `"${e.title}" — שדה במסך.` : `"${e.title}":`;
  return [head, e.explain, e.press ? `מה יקרה אם תלחצו: ${e.press}` : ""].filter(Boolean).join("\n");
}

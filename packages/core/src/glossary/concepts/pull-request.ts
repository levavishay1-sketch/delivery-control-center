import type { Concept } from "../index.ts";

/** Pull requests and branches: freshness, review, conflicts, the merge itself. */
export const PULL_REQUEST_CONCEPTS: Concept[] = [
  { key: "update_branch", kind: "button", title: "עדכן מהבסיס", aliases: ["עדכון מהבסיס", "update branch", "עדכן את הענף"], screens: ["pull_request"], explain: "מכניס לענף של הבקשה את כל מה שנוסף לענף שהיא מיועדת אליו מאז שנפתחה.", press: "אם אין התנגשות — הענף מתעדכן ומסומן 'עדכנית'. אם יש התנגשות — העדכון נעצר, הענף נשאר בדיוק כמו שהיה, והמסך אומר איך ממשיכים." },
  { key: "request_review", kind: "button", title: "בקש סקירה", aliases: ["בקשת סקירה", "request review"], screens: ["pull_request"], explain: "שולח למישהו בקשה לקרוא את השינויים ולאשר אותם.", press: "נשלחת בקשה באתר המארח בשם שלכם. הסקירה עצמה נעשית שם." },
  { key: "merge", kind: "button", title: "מזג", aliases: ["מיזוג", "merge", "למזג"], screens: ["pull_request"], explain: "מחבר את הענף של הבקשה לענף היעד. זו פעולה של האתר המארח (GitHub / Azure DevOps) בשם שלכם.", press: "המיזוג מתבצע באתר המארח ואי אפשר לבטל אותו בלחיצה. הכפתור זמין רק כשיש סקירה מאושרת, אין התנגשות, והבקשה שמעליה (אם יש) כבר מוזגה." },
  { key: "pr_review", kind: "term", title: "סקירה", aliases: ["review", "סקירה מאושרת"], screens: ["pull_request"], explain: "מישהו אחר קורא את השינויים ומאשר אותם, או מבקש תיקונים. בלי סקירה מאושרת אי אפשר למזג." },
  { key: "stale", kind: "term", title: "לא עדכנית", aliases: ["מאחורי הבסיס", "behind", "stale"], screens: ["pull_request"], explain: "מאז שהענף נפתח נוספו לענף היעד שינויים שאין בו. המספר אומר כמה, ו'קבצים בסיכון' אומר כמה מהם נוגעים באותם קבצים — זה מה שקובע אם העדכון דחוף." },
  { key: "conflict", kind: "term", title: "התנגשות", aliases: ["conflict", "קונפליקט"], screens: ["pull_request"], explain: "שני ענפים שינו את אותן שורות בצורה שונה, ו-git לא יודע איזו לקחת. מישהו צריך להחליט ידנית." },
  { key: "project_branch", kind: "term", title: "ענף פרויקט", aliases: ["project branch", "ענף של פרויקט"], screens: ["pull_request"], explain: "ענף שאוסף כמה משימות של אותו פרויקט. כל משימה מתמזגת לתוכו, והוא מתמזג ל-master בסוף, בבקשת מיזוג אחת שאדם מאשר." },
  { key: "task_branch", kind: "term", title: "ענף משימה", aliases: ["task branch"], screens: ["pull_request"], explain: "ענף של משימה אחת, שנפתח מענף הפרויקט ומתמזג חזרה אליו כשהמשימה גמורה." },
  { key: "pr_checks", kind: "term", title: "בדיקות", aliases: ["checks", "בנייה", "build"], screens: ["pull_request"], explain: "מה שהאתר המארח מריץ אוטומטית על הבקשה: בנייה ובדיקות. 'עבר' ירוק — אפשר להמשיך; 'נכשל' — צריך תיקון לפני מיזוג." },

  /* the cards of the pull request screen */
  { key: "pr_review_checklist", kind: "section", title: "מה לבדוק לפני שמחליטים", screens: ["pull_request"], explain: "רשימת הדברים שכדאי לעבור עליהם לפני החלטה: הקבצים שהשתנו, מה נמחק, וחסמים פתוחים. סימון שורה הוא אמירה שלכם שראיתם אותה." },
  { key: "pr_decision", kind: "section", title: "ההחלטה שלכם", screens: ["pull_request"], explain: "מה אתם אומרים על הבקשה: לאשר, לבקש תיקונים, או למזג. ההחלטה נשלחת לאתר המארח בשם שלכם ונרשמת גם כאן." },
  { key: "pr_blockers", kind: "section", title: "מה חוסם מיזוג", screens: ["pull_request"], explain: "כל מה שעוצר את המיזוג כרגע — סקירה חסרה, בדיקה שנכשלה, התנגשות, או בקשה קודמת שעוד לא מוזגה. המיזוג נפתח רק כשאין שורה אדומה." },
  { key: "pr_branch_topics", kind: "section", title: "על מה הענף", screens: ["pull_request"], explain: "הנושאים שהשינויים בענף נוגעים בהם, לפי הקבצים שהשתנו. זה נותן תמונה מהירה של הבקשה בלי לקרוא את כל הקוד." },
  { key: "pr_facts", kind: "section", title: "עובדות", screens: ["pull_request"], explain: "המספרים היבשים של הבקשה: כמה שינויים יש בה, כמה קבצים, כמה התקדם הענף שאליו היא מיועדת, וכמה קבצים משותפים לשניהם." },
  { key: "pr_people", kind: "section", title: "אנשים", screens: ["pull_request"], explain: "מי פתח את הבקשה, מה מצב הסקירה שלה ומתי עודכנה לאחרונה. כל פעולה נעשית בשם של אדם אמיתי." },
  { key: "branch", kind: "section", title: "מה זה ענף, ולמה יש כאלה", aliases: ["ענף", "branch", "ענפים"], screens: ["pull_request"], explain: "ענף הוא עותק עבודה מקביל של הקוד. כל עבודה מתחילה בענף משלה, ובסוף בקשת מיזוג מכניסה אותה לענף הראשי. ענפים לא נמחקים לבד." },

  /* the figures of the pull request screens */
  { key: "commits", kind: "field", title: "commits", aliases: ["קומיטים", "שמירות"], screens: ["pull_request"], explain: "כמה שמירות של עבודה נוספו בענף מאז שנפתח. כל שמירה היא צעד אחד עם הסבר מה נעשה בו." },
  { key: "pr_file_count", kind: "field", title: "קבצים בבקשה", aliases: ["קבצים"], screens: ["pull_request"], explain: "כמה קבצים הבקשה משנה. מספר גדול לא בהכרח אומר שינוי גדול — לפעמים זו החלפה של שם בהרבה מקומות." },
  { key: "base_advanced", kind: "field", title: "היעד התקדם", screens: ["pull_request"], explain: "כמה שינויים נוספו לענף היעד מאז שהבקשה נפתחה. ככל שהמספר גדל, כדאי לעדכן את הענף לפני שממזגים." },
  { key: "shared_files", kind: "field", title: "קבצים משותפים", screens: ["pull_request"], explain: "כמה מהשינויים שנוספו ליעד נוגעים באותם קבצים שהבקשה משנה. זה מה שקובע אם צפויה התנגשות." },
  { key: "prs_open", kind: "field", title: "פתוחות", screens: ["pull_request"], explain: "בקשות מיזוג שעדיין לא מוזגו ולא נסגרו. כל אחת ממתינה למישהו — לסקירה, לתיקון, או למיזוג." },
  { key: "prs_attention", kind: "field", title: "דורש תשומת לב", screens: ["pull_request"], explain: "בקשות שמשהו בהן תקוע: בדיקה שנכשלה, התנגשות, או המתנה ארוכה מדי לסקירה." },
  { key: "prs_ready", kind: "field", title: "מוכן למיזוג", screens: ["pull_request"], explain: "בקשות שעברו סקירה, הבדיקות שלהן ירוקות ואין בהן התנגשות. נשאר רק להחליט למזג." },
  { key: "prs_synced", kind: "field", title: "סונכרן", screens: ["pull_request"], explain: "מתי DCC שאל לאחרונה את האתר המארח מה מצב הבקשות. 'סנכרן' שואל שוב עכשיו." },
  { key: "branch_deletable", kind: "field", title: "אפשר למחוק", screens: ["pull_request"], explain: "ענפים שכבר מוזגו, ולכן כל מה שיש בהם נמצא בענף הראשי. מחיקה שלהם לא מאבדת שום עבודה." },
  { key: "branch_origin", kind: "field", title: "איך הגיע לכאן", screens: ["pull_request"], explain: "מי פתח את הענף ולמה: אדם, סשן של Claude Code, או הרצה של DCC. כך יודעים למי לפנות לגבי ענף נשכח." },
];

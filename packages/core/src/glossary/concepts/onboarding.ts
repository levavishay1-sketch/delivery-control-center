import type { Concept } from "../index.ts";

/** Repository onboarding: prepare, init, review, deliver. */
export const ONBOARDING_CONCEPTS: Concept[] = [
  { key: "prepare", kind: "button", title: "הכנת הריפו", aliases: ["הכנה", "prepare", "עותק מבודד"], screens: ["onboarding"], explain: "יוצר עותק מבודד של המאגר על ענף חדש, כדי שההטמעה לא תיגע בעותק העבודה שלכם.", press: "נוצר עותק ועליו ענף בשם ai/onboarding/<מזהה>. שום דבר לא נכתב למאגר המקורי." },
  { key: "init", kind: "button", title: "הטמעה", aliases: ["init", "/init", "הרץ הטמעה"], screens: ["onboarding"], explain: "Claude Code האמיתי רץ בטרמינל שלמטה ומריץ /init: קורא את המאגר וכותב את קובצי ההנחיה (CLAUDE.md ועוד) בעותק המבודד. אתם עונים לו בטרמינל.", press: "נפתח סשן חי בטרמינל. הוא עולה כסף כל עוד הוא רץ, כש-Claude מסיים לכתוב, DCC מזהה את זה וממשיך לסקירה בעצמו." },
  { key: "onboarding_review", kind: "button", title: "סקירת הקבצים", aliases: ["review", "סקירה"], screens: ["onboarding"], explain: "רשימת כל הקבצים שהסשן שינה, עם לפני/אחרי. אפשר לבקש מהסשן תיקונים בטרמינל ולרענן.", press: "אישור הסקירה מעביר למסירה. שום דבר לא נמסר לפני האישור, אלא אם הגדרתם שער אוטומטי." },
  { key: "deliver", kind: "button", title: "מסירה", aliases: ["deliver", "מסור"], screens: ["onboarding"], explain: "מקומיט את הקבצים בעותק המבודד, דוחף את הענף ופותח בקשת מיזוג.", press: "הענף נדחף לשרת ונפתחת בקשת מיזוג בשם שלכם. המיזוג עצמו — במסך בקשות מיזוג, אחרי סקירה." },
  { key: "automation", kind: "term", title: "אוטומציה", aliases: ["מדיניות אוטומציה", "לבד", "ידני"], screens: ["onboarding"], explain: "אילו שלבים מתחילים לבד כשהקודם מסתיים, והאם שער הסקירה מחכה לאדם. 'צעד אחר צעד' = הכול ידני." },
  { key: "model_effort", kind: "term", title: "מודל ומאמץ", aliases: ["מודל", "מאמץ", "effort"], screens: ["onboarding"], explain: "איזה מודל של Claude מריץ את ההטמעה וכמה מאמץ הוא משקיע. ברירת המחדל מהמדיניות; אפשר לשנות להרצה אחת." },
  { key: "run_cost", kind: "field", title: "עלות ההרצה", aliases: ["עלות", "כמה עלה"], screens: ["onboarding"], explain: "כמה ההרצה עלתה עד עכשיו, מיומן הקריאות, לפי שלב. חלק שהסשן הפעיל הוציא ועדיין לא נרשם מסומן בנפרד." },

  /* the cards of the onboarding screen */
  { key: "onboarding_intro", kind: "section", title: "מכינים את Claude לריפו הזה", screens: ["onboarding"], explain: "המטרה: שמפתח שמקבל משימה במאגר הזה יקבל מההתחלה את ההקשר שהוא צריך, בלי להסביר לקלוד כל פעם מחדש איך המאגר בנוי." },
  { key: "decision_log", kind: "section", title: "יומן החלטות ואירועים", screens: ["onboarding"], explain: "כל מה שקרה בהרצה לפי הסדר: שלב שהתחיל או נכשל, החלטה של אדם, אישור שער. שום דבר לא נמחק — זה התיעוד של ההרצה." },
  { key: "previous_runs", kind: "section", title: "הרצות קודמות", screens: ["onboarding"], explain: "הטמעות קודמות של אותו מאגר. אפשר לפתוח הרצה ישנה ולראות מה נעשה בה ומה עלתה, בלי להשפיע על ההרצה הנוכחית." },
];

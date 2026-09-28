import type { Concept } from "../index.ts";

/** The dashboard and the budgets screen: what is open, blocked and spent. */
export const OVERVIEW_CONCEPTS: Concept[] = [
  { key: "initiatives", kind: "term", title: "דרישות-על", aliases: ["דרישת על", "initiatives"], screens: ["dashboard"], explain: "דרישה שאין לה דרישת אב — מה שפעם נקרא פרויקט. תחתיה עץ של דרישות ומשימות." },
  { key: "blocked", kind: "term", title: "דרישות חסומות", aliases: ["חסומות", "חסימות"], screens: ["dashboard"], explain: "דרישות עם חוסם פתוח — משהו שמחכה לתשובה של אדם לפני שאפשר להמשיך." },
  { key: "ai_cost_month", kind: "field", title: "עלות AI החודש", aliases: ["עלות AI", "כמה עלה החודש"], screens: ["dashboard"], explain: "סכום כל הקריאות לקלוד מתחילת החודש, מיומן הקריאות, מול סך תקציבי הלקוחות." },
  { key: "new_requirement", kind: "button", title: "הוספת דרישה", aliases: ["דרישה חדשה", "הוסף דרישה"], screens: ["dashboard"], explain: "פותח טופס לדרישה חדשה תחת לקוח.", press: "הדרישה נוצרת ב-DCC. אם הלקוח מסונכרן ל-Azure DevOps היא נוצרת גם שם." },
  { key: "budget", kind: "field", title: "תקציב", aliases: ["תקציב חודשי"], screens: ["budgets"], explain: "כמה מותר ל-AI להוציא על הלקוח בחודש. מעל 80% מופיעה אזהרה." },
  { key: "spent", kind: "field", title: "מנוצל", aliases: ["עלות", "כמה נוצל"], screens: ["budgets"], explain: "כמה כבר הוצא החודש — מיומן הקריאות, לא הערכה." },

  /* the cards of the dashboard and the budgets screen */
  { key: "quick_actions", kind: "section", title: "פעולות מהירות", screens: ["dashboard"], explain: "קיצורי דרך לפעולות שחוזרות: פתיחת דרישה חדשה, מעבר להתראות ודוח התקציב. אפשר להגיע לכולן גם מהתפריט." },
  { key: "recent_alerts", kind: "section", title: "התראות אחרונות", screens: ["dashboard"], explain: "הדברים האחרונים שדורשים תשומת לב — חסימה, חריגת תקציב, החלטה שממתינה. אדום הוא דחוף; המסך המלא נמצא ב'התראות'." },
  { key: "client_budget", kind: "section", title: "תקציב הלקוח", screens: ["budgets"], explain: "כמה מתוך התקציב החודשי של הלקוח כבר נוצל. מעל 80% הפס נצבע באדום כדי שתשימו לב לפני שנגמר." },
];

import type { ResolvedTopic, TopicKind } from "../chat/index.ts";

/**
 * The map the chat walks (claude-in-dcc §4, design §3): every place in DCC
 * the chat may take the person to in order to answer them, described once —
 * what it is called, what it answers that the other places do not, and how
 * to get there from the topic the person is on.
 *
 * Three rules hold this together, and all three are enforced here rather
 * than trusted to the model:
 *
 * - **A place is a screen that registers its facts.** The chat moves in
 *   order to answer, so a screen the chat would land on with nothing to
 *   read is not a destination. `scripts/audit-stale.mjs` checks that every
 *   place's screen has a glossary, and `apps/web` registers the place it
 *   is on with `useClaudeContext`.
 * - **The chat moves inside its own topic.** The topic decides the
 *   conversation, so moving within it keeps the person in the same
 *   conversation; a place belonging to another topic is never offered.
 * - **The key comes from here.** A key the model invents, or one whose
 *   route this topic cannot build, is refused in words — never followed.
 */

export type PlaceDef = {
  key: string;
  /** The name of the place, as the person would say it. */
  title: string;
  /** The glossary key of the screen it lands on. */
  screen: string;
  /** The topic it belongs to. */
  topic: TopicKind;
  /** One line for the model: what this place answers that the others do not. */
  answers: string;
  /** The route, built from the topic — `null` when this topic cannot reach it. */
  route: (t: ResolvedTopic) => string | null;
};

/** A pull request's tabs live under one route; the topic carries `repoId/number`. */
const prTab = (t: ResolvedTopic, tab: string): string | null => {
  const [repoId, number] = (t.id ?? "").split("/");
  return repoId && number ? `#/pull-requests/${repoId}/${number}${tab ? `/${tab}` : ""}` : null;
};

export const PLACES: PlaceDef[] = [
  {
    key: "pr_overview", title: "סקירה", screen: "pull_request", topic: "pr",
    answers: "מה חוסם את המיזוג, מה הצעד הבא, כמה הבקשה מאחורי הענף שהיא מיועדת אליו, ומפת הקוד שלה.",
    route: (t) => prTab(t, ""),
  },
  {
    key: "pr_files", title: "הקבצים שהשתנו", screen: "pull_request", topic: "pr",
    answers: "כל קובץ שהבקשה משנה, מקובץ לפי נושא, עם כמה שורות נוספו ונמחקו בכל אחד — כאן רואים מה בדיוק השתנה.",
    route: (t) => prTab(t, "files"),
  },
  {
    key: "pr_timeline", title: "היומן", screen: "pull_request", topic: "pr",
    answers: "מה קרה לבקשה לאורך הזמן, לפי סדר: קומיטים, סקירות, בדיקות והערות.",
    route: (t) => prTab(t, "timeline"),
  },
  {
    key: "pr_branches", title: "הענפים", screen: "pull_request", topic: "pr",
    answers: "כל ענף במאגר ומצבו: מה יש בו שאין בענף הראשי, אם יש לו בקשת מיזוג, ומה מומלץ לעשות איתו.",
    route: (t) => prTab(t, "branches"),
  },
  {
    key: "dashboard", title: "לוח הבקרה", screen: "dashboard", topic: "app",
    answers: "כמה דרישות פתוחות וחסומות יש, מה ההתראות האחרונות, וכמה ה-AI עלה החודש מול התקציב.",
    route: () => "#/",
  },
  {
    key: "budgets", title: "תקציבים", screen: "budgets", topic: "app",
    answers: "התקציב החודשי של כל לקוח בנפרד, וכמה מתוכו כבר נוצל.",
    route: () => "#/budgets",
  },
];

export const placeByKey = (key: string): PlaceDef | null => PLACES.find((p) => p.key === key) ?? null;

/** Where the chat may go from where it stands: its own topic, and never the place it is already on. */
export function placesFor(topic: ResolvedTopic, at: string | null): { def: PlaceDef; route: string }[] {
  const out: { def: PlaceDef; route: string }[] = [];
  for (const def of PLACES) {
    if (def.topic !== topic.kind || def.key === at) continue;
    const route = def.route(topic);
    if (route) out.push({ def, route });
  }
  return out;
}

/** What the model is told it may reach from here. Empty when there is nowhere to go. */
export function renderPlaces(list: { def: PlaceDef; route: string }[]): string {
  if (!list.length) return "";
  return ["מסכים שאפשר לעבור אליהם מכאן (רק אלה):", ...list.map(({ def }) => `- ${def.key} — "${def.title}": ${def.answers}`)].join("\n");
}

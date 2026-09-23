import { eq } from "drizzle-orm";
import { db, type CallTrigger } from "@dcc/db";
import { repositoryOnboardingRun, task } from "@dcc/db/schema";
import { approveTask, previewAssessPrompt, previewBreakdownPrompt, previewImplementPrompt, startFlowRun } from "../ai-assist.ts";
import { sendToOnboardingSession } from "../repo-onboarding/runs.ts";
import { terminalState } from "../repo-onboarding/session.ts";
import { estimateUsd, recommend, type Capability } from "../routing.ts";
import { gapByRef, verifyGap } from "../gaps.ts";
import { isOpenGapState } from "../gap-ref.ts";

/**
 * The action registry (claude-in-dcc §5, design §4): every action a screen
 * offers, described once — what it is, what it will do, who may do it, what
 * it costs, and how it runs. The screen's button and the chat's proposal
 * are two doors to the same `run`; the chat never runs one without the
 * person's click.
 */

export type ActionKey = "assess" | "breakdown" | "implement" | "approve_task" | "send_to_session" | "resolve_gap" | "dismiss_gap";
export type ActionTopic = "wi" | "task" | "run" | "gaps";
export type Actor = { userId: string };
export type ActionEntity = { kind: ActionTopic; id: string; clientId: string; workitemId: string | null; repoId?: string | null };
export type ActionParams = Record<string, unknown>;
export type ActionEstimate = { capability: Capability; model: string; effort: string; usd: number | null } | null;
export type Allowed = { ok: true } | { ok: false; reason: string };

export type ActionDef = {
  key: ActionKey;
  title: string;
  /** Changes something outside the conversation → always behind the person's approval. */
  consequential: boolean;
  /** The topic the action belongs to — a proposal on another topic is refused. */
  topic: ActionTopic;
  params: { name: string; explain: string; required?: boolean }[];
  /** "What is about to happen", in plain Hebrew, with the parameters filled in. */
  describe: (p: ActionParams, e: ActionEntity) => string | Promise<string>;
  /** The approve button's words on the card, when "אשר והרץ" would say the wrong thing. */
  approveLabel?: string;
  /** For an action with no model estimate: what approving it costs, in words. A bare "$0" under a paid answer reads as if the answer were free. */
  costNote?: string;
  allowed: (by: Actor, e: ActionEntity, p: ActionParams) => Promise<Allowed>;
  estimate: (p: ActionParams, e: ActionEntity) => Promise<ActionEstimate>;
  /** The exact prompt — the same "what will be sent" gate every button opens. */
  preview?: (p: ActionParams, e: ActionEntity) => Promise<{ prompt: string; promptHe: string }>;
  run: (p: ActionParams, e: ActionEntity, by: Actor, trigger: CallTrigger) => Promise<unknown>;
};

const typical = (cap: Capability, tokens: { input: number; output: number }): ActionEstimate => {
  const r = recommend(cap);
  return { capability: cap, model: r.model, effort: r.effort, usd: estimateUsd(r.model, tokens) };
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The gap a proposal names, still open, on this requirement — or why not. */
async function openGap(e: ActionEntity, p: ActionParams) {
  const ref = str(p.gap);
  if (!ref) return { gap: null, reason: "לא צוין איזה פער" } as const;
  const found = await gapByRef(e.clientId, e.workitemId ?? e.id, ref);
  if (!found.gap) return found;
  if (!isOpenGapState(found.gap.state)) return { gap: null, reason: "הפער הזה כבר נסגר" } as const;
  return found;
}
const gapQuote = (d: string) => `"${d.length > 110 ? `${d.slice(0, 110)}…` : d}"`;

async function taskRow(id: string) {
  const [t] = await db.select({ id: task.id, seq: task.seq, intent: task.intent, approvedAt: task.approvedAt, kind: task.kind }).from(task).where(eq(task.id, id)).limit(1);
  return t ?? null;
}

export const ACTIONS: Record<ActionKey, ActionDef> = {
  assess: {
    key: "assess", title: "בחינת בשלות", consequential: true, topic: "wi",
    params: [{ name: "customEmphasis", explain: "דגש נוסף לבדיקה, בעברית (לא חובה)" }],
    describe: (p) => `קלוד יקרא את הדרישה (ואת המאגר אם יש) ויכתוב סיכום ורשימת פערים${str(p.customEmphasis) ? `, עם דגש על: ${str(p.customEmphasis)}` : ""}. הפערים מוצעים בלבד — אדם מאשר או דוחה כל אחד.`,
    allowed: async () => ({ ok: true }),
    estimate: async () => typical("gap_detection", { input: 12_000, output: 1_500 }),
    preview: (p, e) => previewAssessPrompt({ clientId: e.clientId, workitemId: e.id, promptKey: str(p.promptKey) ?? "assess.standard", customEmphasis: str(p.customEmphasis) }).then((r) => ({ prompt: r.prompt, promptHe: r.promptHe ?? "" })),
    run: (p, e, by, trigger) => startFlowRun({ clientId: e.clientId, workitemId: e.id, kind: "assess", by, trigger, assessOpts: { promptKey: str(p.promptKey), customEmphasis: str(p.customEmphasis) } }),
  },
  breakdown: {
    key: "breakdown", title: "פירוק למשימות", consequential: true, topic: "wi",
    params: [],
    describe: () => "קלוד יקרא את הדרישה ואת הפערים שנסגרו ויציע רשימת משימות עם סדר ותלות. המשימות לא נוצרות ב-TFS עד שתאשרו אותן במסך הדרישה.",
    allowed: async () => ({ ok: true }),
    estimate: async () => typical("decomposition", { input: 15_000, output: 2_500 }),
    preview: (_p, e) => previewBreakdownPrompt({ clientId: e.clientId, workitemId: e.id }).then((r) => ({ prompt: r.prompt, promptHe: r.promptHe })),
    run: (_p, e, by, trigger) => startFlowRun({ clientId: e.clientId, workitemId: e.id, kind: "breakdown", by, trigger }),
  },
  implement: {
    key: "implement", title: "פיתוח המשימה", consequential: true, topic: "task",
    params: [],
    describe: () => "קלוד יכתוב את הקוד של המשימה בעותק מבודד של המאגר, על ענף משלה, ויקומיט מקומית. שום דבר לא נדחף ולא מתמזג לבד.",
    allowed: async (_by, e) => {
      const t = await taskRow(e.id);
      if (!t) return { ok: false, reason: "המשימה לא נמצאה" };
      if (!t.approvedAt) return { ok: false, reason: "המשימה עדיין לא אושרה — קודם מאשרים אותה, ואז מפתחים" };
      return { ok: true };
    },
    estimate: async () => typical("execution", { input: 60_000, output: 6_000 }),
    preview: (_p, e) => previewImplementPrompt({ clientId: e.clientId, workitemId: e.workitemId!, taskId: e.id }).then((r) => ({ prompt: r.prompt, promptHe: r.promptHe })),
    run: (_p, e, by, trigger) => startFlowRun({ clientId: e.clientId, workitemId: e.workitemId!, kind: "implement", taskId: e.id, by, trigger }),
  },
  approve_task: {
    key: "approve_task", title: "אישור המשימה", consequential: true, topic: "task",
    costNote: "האישור לא עולה כסף — הוא רק מסמן את המשימה כמאושרת",
    params: [],
    describe: () => "המשימה תסומן כמאושרת לפיתוח, בשמכם. אפשר לתקן קודם את הניסוח ואת הגודל במסך המשימה.",
    allowed: async (_by, e) => {
      const t = await taskRow(e.id);
      if (!t) return { ok: false, reason: "המשימה לא נמצאה" };
      if (t.approvedAt) return { ok: false, reason: "המשימה כבר מאושרת" };
      return { ok: true };
    },
    estimate: async () => null,
    // The screen's approve dialog may correct the wording, size and prompt in the same stroke; the chat declares no parameters, so a proposal carries none.
    run: (p, e, by) => approveTask(e.clientId, e.id, by, { intent: str(p.intent), appetite: p.appetite === "small" || p.appetite === "standard" || p.appetite === "large" ? p.appetite : undefined, prompt: typeof p.prompt === "string" ? p.prompt : undefined }),
  },
  send_to_session: {
    key: "send_to_session", title: "שליחת הוראה לסשן ההטמעה", consequential: true, topic: "run",
    costNote: "ההוראה נכנסת לסשן שכבר רץ — מה שקלוד יעשה בעקבותיה נרשם בעלות של הסשן",
    params: [{ name: "text", explain: "ההוראה לסשן, באנגלית, פסקה אחת", required: true }],
    describe: (p) => `ההוראה תוקלד לתוך הסשן החי של Claude Code, בשמכם, כאילו כתבתם אותה בטרמינל:\n"${str(p.text) ?? ""}"`,
    allowed: async (_by, e, p) => {
      if (!str(p.text)) return { ok: false, reason: "אין הוראה לשלוח" };
      if (terminalState(e.id) !== "live") return { ok: false, reason: "סשן Claude לא פעיל — חדשו אותו משלב ההטמעה ואז שלחו" };
      return { ok: true };
    },
    estimate: async () => null,
    run: (p, e, by) => sendToOnboardingSession(e.repoId!, e.id, by, { text: str(p.text)! }),
  },
  // The conversation about a requirement's gaps settles them one by one, but
  // only the person closes a gap: each of these is a card they approve.
  resolve_gap: {
    key: "resolve_gap", title: "סגירת פער עם הכרעה", consequential: true, topic: "gaps", approveLabel: "אשר וסגור את הפער",
    costNote: "האישור לא עולה כסף — הוא רק שומר את ההכרעה. העלות של התשובה של קלוד רשומה מעליה",
    params: [
      { name: "gap", explain: "המזהה הקצר של הפער (8 התווים שבסוגריים בעובדות)", required: true },
      { name: "answer", explain: "ההכרעה כפי שסוכמה בשיחה, בעברית, שלמה ועומדת בפני עצמה — מי שיקרא אותה בלי השיחה יבין מה הוחלט", required: true },
    ],
    describe: async (p, e) => {
      const g = await openGap(e, p);
      return `הפער ${g.gap ? gapQuote(g.gap.description) : ""} ייסגר עם ההכרעה:\n"${str(p.answer) ?? ""}"\nההכרעה נשמרת כהערה בדרישה, בשמכם, ונכנסת לפירוק למשימות.`;
    },
    allowed: async (_by, e, p) => {
      const g = await openGap(e, p);
      if (!g.gap) return { ok: false, reason: g.reason };
      if (!str(p.answer)) return { ok: false, reason: "אין הכרעה לשמור" };
      return { ok: true };
    },
    estimate: async () => null,
    run: async (p, e, by) => {
      const g = await openGap(e, p);
      if (!g.gap) throw new ActionRefused(g.reason);
      return verifyGap({ clientId: e.clientId, gapId: g.gap.id, by, outcome: "resolved", answer: str(p.answer) });
    },
  },
  dismiss_gap: {
    key: "dismiss_gap", title: "סימון כלא-פער", consequential: true, topic: "gaps", approveLabel: "אשר — זה לא פער",
    costNote: "האישור לא עולה כסף — הוא רק שומר את הסיבה. העלות של התשובה של קלוד רשומה מעליה",
    params: [
      { name: "gap", explain: "המזהה הקצר של הפער (8 התווים שבסוגריים בעובדות)", required: true },
      { name: "reason", explain: "למה זה לא פער אמיתי, כפי שעלה בשיחה — נשמר כדי שהשאלה לא תעלה שוב", required: true },
    ],
    describe: async (p, e) => {
      const g = await openGap(e, p);
      return `הפער ${g.gap ? gapQuote(g.gap.description) : ""} יסומן כלא-פער, מהסיבה:\n"${str(p.reason) ?? ""}"\nהסיבה נשמרת כדי שבחינת הבשלות הבאה לא תעלה את השאלה שוב.`;
    },
    allowed: async (_by, e, p) => {
      const g = await openGap(e, p);
      if (!g.gap) return { ok: false, reason: g.reason };
      if (!str(p.reason)) return { ok: false, reason: "חסרה הסיבה" };
      return { ok: true };
    },
    estimate: async () => null,
    run: async (p, e, by) => {
      const g = await openGap(e, p);
      if (!g.gap) throw new ActionRefused(g.reason);
      return verifyGap({ clientId: e.clientId, gapId: g.gap.id, by, outcome: "dismissed", answer: str(p.reason) });
    },
  },
};

/** The actions a topic may propose, narrowed to what the screen declared. */
export function actionsFor(topic: string, declared?: string[] | null): ActionDef[] {
  return (Object.values(ACTIONS) as ActionDef[]).filter((a) => a.topic === topic && (!declared || declared.includes(a.key)));
}

export function actionEntityFor(topic: { kind: string; id: string | null; clientId: string; workitemId: string | null }): Promise<ActionEntity | null> {
  return (async () => {
    if (!topic.id) return null;
    if (topic.kind === "wi") return { kind: "wi", id: topic.id, clientId: topic.clientId, workitemId: topic.id };
    if (topic.kind === "gaps") return { kind: "gaps", id: topic.id, clientId: topic.clientId, workitemId: topic.id };
    if (topic.kind === "task") return { kind: "task", id: topic.id, clientId: topic.clientId, workitemId: topic.workitemId };
    if (topic.kind === "run") {
      const [r] = await db.select({ repoId: repositoryOnboardingRun.repoId }).from(repositoryOnboardingRun).where(eq(repositoryOnboardingRun.id, topic.id)).limit(1);
      return r ? { kind: "run", id: topic.id, clientId: topic.clientId, workitemId: null, repoId: r.repoId } : null;
    }
    return null;
  })();
}

/** Run an action in a person's name — the one implementation behind every button and every approved proposal. */
export async function runAction(key: ActionKey, params: ActionParams, entity: ActionEntity, by: Actor, trigger: CallTrigger): Promise<unknown> {
  const def = ACTIONS[key];
  if (!def) throw new Error(`unknown action ${key}`);
  const ok = await def.allowed(by, entity, params);
  if (!ok.ok) throw new ActionRefused(ok.reason);
  return def.run(params, entity, by, trigger);
}

export class ActionRefused extends Error {}

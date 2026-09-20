import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runClaudeRaw } from "../ai-assist.ts";
import { recommend } from "../routing.ts";
import { changeSummary } from "./changes.ts";
import { digestTranscript } from "./transcript.ts";
import { runtimeDir } from "./workspace.ts";

/**
 * The Hebrew assistant next to the onboarding terminal
 * (`openspec/changes/onboarding-assistant`). A separate Claude conversation —
 * never the onboarding session — that is told what the session is doing and
 * answers the person's questions about it.
 *
 * It is kept cheap on purpose: one long-lived conversation resumed with
 * `--resume` (what it already read is not paid for again), and every question
 * carries only what is NEW since the previous one — transcript lines after a
 * cursor, the screen only if it changed, the file list only if it changed.
 * Read-only tools, no thinking, short answers.
 */

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  /** An instruction the assistant proposes for the session — sent only when the person presses send. */
  send?: { text: string; sentAt?: string; forced?: boolean };
};

type Store = {
  sessionId: string;
  /** The conversation exists on disk, so the next call resumes it. */
  started: boolean;
  /** Transcript lines already handed over. */
  cursor: number;
  screenHash: string;
  filesHash: string;
  /** `total_cost_usd` of a resumed conversation is cumulative; this is what was already counted. */
  costSoFar: number;
  messages: AssistantMessage[];
};

const MAX_MESSAGES = 200;
const FIRST_DIGEST_CHARS = 14_000;
const DELTA_DIGEST_CHARS = 10_000;
const SCREEN_CHARS = 3_500;

const storeFile = (runId: string) => path.join(runtimeDir(runId), "assistant.json");
const systemFile = (runId: string) => path.join(runtimeDir(runId), "assistant-system.txt");
const hash = (s: string) => createHash("sha1").update(s).digest("hex");

function fresh(): Store {
  return { sessionId: randomUUID(), started: false, cursor: 0, screenHash: "", filesHash: "", costSoFar: 0, messages: [] };
}

function load(runId: string): Store {
  try { return { ...fresh(), ...(JSON.parse(readFileSync(storeFile(runId), "utf8")) as Partial<Store>) }; } catch { return fresh(); }
}

function save(runId: string, s: Store) {
  mkdirSync(runtimeDir(runId), { recursive: true });
  writeFileSync(storeFile(runId), JSON.stringify({ ...s, messages: s.messages.slice(-MAX_MESSAGES) }), "utf8");
}

export const assistantMessages = (runId: string): AssistantMessage[] => (existsSync(storeFile(runId)) ? load(runId).messages : []);
export const assistantModel = () => recommend("onboarding_assistant").model;

/** A new conversation: the long context is dropped (and with it what it costs to carry). The chat on screen is cleared too. */
export function resetAssistant(runId: string) {
  save(runId, fresh());
}

/** The message the person's send button acted on. */
export function markAssistantSent(runId: string, messageId: string, forced: boolean) {
  const s = load(runId);
  const m = s.messages.find((x) => x.id === messageId);
  if (m?.send) { m.send.sentAt = new Date().toISOString(); m.send.forced = forced; save(runId, s); }
}

const SYSTEM = `You are the assistant next to an onboarding terminal in DCC (Delivery Control Center). In that terminal a developer runs a real Claude Code session ("the session") that sets Claude up for a repository: it runs /init, writes files in an isolated copy of the repository, and then the developer reviews them. The developer reads English slowly and asks you questions in Hebrew. You answer in Hebrew.

You are NOT the session. You cannot type into it, write files or run commands. You have read-only tools (Read, Grep, Glob) on the isolated copy of the repository.

Every message from the developer starts with an update from the session since their previous message. In it: lines starting with "אתה:" are what the developer typed, "Claude:" what the session said, "→" a tool it ran, "✗" a failure, "⏳" a call that is still waiting (an approval from the developer, or an action still running). After that may come the text currently on the terminal screen and a summary of the files changed in the repository copy (tracked files that differ from the starting point, and files git does not track yet — those are in no commit), and then "השאלה שלי:". Answer from that update and from what was said earlier in this conversation. Use your tools only when the update cannot answer (for example to see what a changed file says), and read as little as possible: the developer pays for every token.

How to answer:
- Short and plain, usually under 120 words. Plain text only: no headings, no bold or other markdown (short lines starting with "-" are fine). Explain consequences in everyday words ("if you pick 2, Claude rewrites the file from scratch").
- Say what you know from the update and what you are guessing. Never present a guess as fact. If the update does not show something, say you cannot see it.
- Put commands, file paths, code and keyboard keys in backticks, exactly as written, never translated.
- When asked what the session wants from the developer, say it plainly: the pending question or approval, the options, and what each one leads to.
- When the developer wants to tell the session something, or an instruction would clearly help, add ONE block after your answer: <send>the instruction, in English, self-contained, one short paragraph</send>. The developer reads it, may edit it, and presses send themselves. Do not add a block otherwise, and never say that you sent anything.
`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type AssistantInput = {
  runId: string;
  clientId: string;
  /** The person asking — every call is recorded in their name. */
  userId: string;
  question: string;
  /** The text on the terminal screen right now. */
  screen?: string;
  transcriptPath?: string;
  workspacePath?: string | null;
  baselineSha?: string | null;
};

export type AssistantAnswer = { message: AssistantMessage; costUsd: number; inputTokens: number; outputTokens: number };

const asking = new Set<string>();
export const assistantBusy = (runId: string) => asking.has(runId);

function parseAnswer(raw: string): { text: string; send: string | null } {
  const m = raw.match(/<send>([\s\S]*?)<\/send>/i);
  const text = raw.replace(/<send>[\s\S]*?<\/send>/gi, "").trim();
  const send = m?.[1]?.trim() || null;
  return { text: text || (send ? "הנה הוראה מוצעת לסשן:" : "(אין תשובה)"), send };
}

export async function askAssistant(input: AssistantInput): Promise<AssistantAnswer> {
  const { runId } = input;
  if (asking.has(runId)) throw new Error("העוזר עדיין עונה על השאלה הקודמת");
  asking.add(runId);
  try {
    let store = load(runId);
    const cwd = runtimeDir(runId);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(systemFile(runId), SYSTEM, "utf8");

    const filesText = input.workspacePath && input.baselineSha ? await changeSummary(input.workspacePath, input.baselineSha).catch(() => "") : "";
    const screen = clip((input.screen ?? "").trim(), SCREEN_CHARS);

    const build = (s: Store) => {
      const digest = input.transcriptPath ? digestTranscript(input.transcriptPath, s.cursor, s.started ? DELTA_DIGEST_CHARS : FIRST_DIGEST_CHARS) : { text: "", cursor: s.cursor, entries: 0 };
      const parts = [`עדכון מהסשן:\n${digest.text || "(אין חדש מאז השאלה הקודמת)"}`];
      const screenHash = screen ? hash(screen) : "";
      const filesHash = filesText ? hash(filesText) : "";
      if (screen && screenHash !== s.screenHash) parts.push(`המסך כרגע:\n${screen}`);
      if (filesText && filesHash !== s.filesHash) parts.push(filesText);
      parts.push(`השאלה שלי: ${input.question.trim()}`);
      return { prompt: parts.join("\n\n"), cursor: digest.cursor, screenHash, filesHash };
    };

    const call = (s: Store, prompt: string) =>
      runClaudeRaw(cwd, prompt, {
        ledger: {
          clientId: input.clientId, userId: input.userId, capability: "onboarding_assistant", trigger: "chat",
          entity: { kind: "onboarding_run", id: runId }, screen: "onboarding", label: "העוזר של ההטמעה",
          // `total_cost_usd` of a resumed conversation is cumulative; the row is the difference.
          baseline: { costUsd: s.costSoFar },
        },
        maxTurns: 8,
        timeoutMs: 180_000,
        env: { MAX_THINKING_TOKENS: "0" },
        lean: {
          systemPromptFile: systemFile(runId),
          tools: "Read,Grep,Glob",
          session: { id: s.sessionId, resume: s.started },
          addDirs: input.workspacePath ? [input.workspacePath] : [],
        },
      });

    let turn = build(store);
    let res: Awaited<ReturnType<typeof call>>;
    try {
      res = await call(store, turn.prompt);
    } catch (e) {
      // A conversation that cannot be reopened (its file is gone) starts again, and is told everything from the start.
      if (!store.started || !/no conversation|not found|session/i.test(String(e))) throw e;
      store = { ...fresh(), messages: store.messages };
      turn = build(store);
      res = await call(store, turn.prompt);
    }

    const parsed = parseAnswer(res.text);
    const now = new Date().toISOString();
    const message: AssistantMessage = { id: randomUUID(), role: "assistant", text: parsed.text, at: now, ...(parsed.send ? { send: { text: parsed.send } } : {}) };
    store.messages.push({ id: randomUUID(), role: "user", text: input.question.trim(), at: now }, message);
    store.started = true;
    store.cursor = turn.cursor;
    store.screenHash = turn.screenHash || store.screenHash;
    store.filesHash = turn.filesHash || store.filesHash;
    const total = res.meta.costUsd ?? 0;
    const costUsd = Math.max(0, total - store.costSoFar);
    store.costSoFar = total;
    save(runId, store);
    return { message, costUsd, inputTokens: res.meta.inputTokens ?? 0, outputTokens: res.meta.outputTokens ?? 0 };
  } finally {
    asking.delete(runId);
  }
}

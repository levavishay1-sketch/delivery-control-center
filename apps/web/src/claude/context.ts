import { useEffect, useSyncExternalStore } from "react";

/**
 * What the screen tells the one chat (claude-in-dcc design §3): which
 * screen it is, the topic it is about (that alone decides the
 * conversation — the person never chooses), the facts it shows, and the
 * questions and actions worth one click. A screen registers itself with
 * `useClaudeContext`; the dock, mounted once in `App.tsx`, reads it.
 */

export type ChatTopic = { kind: "wi" | "task" | "pr" | "run" | "app"; id?: string | null; title?: string };

export type ClaudeScreenContext = {
  /** The glossary key — `requirement`, `task`, `pull_request`, `onboarding`, `claude`, `dashboard`, `budgets`. */
  screen: string;
  topic: ChatTopic;
  /** What the screen shows right now, in the words a person would use. Sent only when it changed. */
  facts?: Record<string, unknown>;
  /** Facts read at the moment of asking (a terminal's screen text, a live counter). */
  liveFacts?: () => Record<string, unknown>;
  /** Questions worth one click on this screen. */
  suggestions?: string[];
  /** Registry actions this screen allows the person (stage 3). */
  actions?: string[];
};

let current: ClaudeScreenContext | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setClaudeContext(ctx: ClaudeScreenContext | null) {
  current = ctx;
  notify();
}

/** Register the screen's context for as long as it is mounted. Pass `null` while the screen is still loading. */
export function useClaudeContext(ctx: ClaudeScreenContext | null) {
  // Only what the model would see matters for "did it change" — not function identity.
  const key = ctx ? JSON.stringify({ s: ctx.screen, t: ctx.topic, f: ctx.facts ?? null, q: ctx.suggestions ?? null, a: ctx.actions ?? null }) : "";
  useEffect(() => {
    setClaudeContext(ctx);
    return () => setClaudeContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useCurrentClaudeContext(): ClaudeScreenContext | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
}

/* ── the dock's own commands: open it, open a past conversation ──────── */

type Command = { type: "open" } | { type: "openConversation"; id: string } | { type: "toggle" };
const commandListeners = new Set<(c: Command) => void>();
export const chatCommand = (c: Command) => commandListeners.forEach((l) => l(c));
export function onChatCommand(l: (c: Command) => void) {
  commandListeners.add(l);
  return () => { commandListeners.delete(l); };
}

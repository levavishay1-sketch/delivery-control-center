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
  /**
   * Which place of the screen map this is (`packages/core/src/screens`), when
   * it is one. A screen that names its place can be navigated to by the chat:
   * it is where the chat lands, and where it knows not to send anyone twice.
   */
  place?: string;
  /**
   * `false` while this place's own facts are still loading. The chat waits for
   * it before asking there, so a question never lands on a half-loaded screen.
   */
  ready?: boolean;
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
  const key = ctx ? JSON.stringify({ s: ctx.screen, p: ctx.place ?? null, r: ctx.ready ?? null, t: ctx.topic, f: ctx.facts ?? null, q: ctx.suggestions ?? null, a: ctx.actions ?? null }) : "";
  useEffect(() => {
    setClaudeContext(ctx);
    return () => setClaudeContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useCurrentClaudeContext(): ClaudeScreenContext | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
}

/**
 * Wait for the person to have arrived at a place, with its facts loaded —
 * what the chat does after it moves them there, before asking its question
 * again. `null` means it did not arrive in time (a screen that failed to
 * load, or one that never registered the place), and then nothing is asked.
 */
export function waitForPlace(place: string, timeoutMs = 8000): Promise<ClaudeScreenContext | null> {
  const arrived = (c: ClaudeScreenContext | null) => (c && c.place === place && c.ready !== false ? c : null);
  const now = arrived(current);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (c: ClaudeScreenContext | null) => { listeners.delete(check); clearTimeout(timer); resolve(c); };
    const check = () => { const c = arrived(current); if (c) done(c); };
    const timer = setTimeout(() => done(null), timeoutMs);
    listeners.add(check);
  });
}

/* ── the dock's own commands: open it, open a past conversation ──────── */

type Command = { type: "open" } | { type: "openConversation"; id: string } | { type: "toggle" };
const commandListeners = new Set<(c: Command) => void>();
export const chatCommand = (c: Command) => commandListeners.forEach((l) => l(c));
export function onChatCommand(l: (c: Command) => void) {
  commandListeners.add(l);
  return () => { commandListeners.delete(l); };
}

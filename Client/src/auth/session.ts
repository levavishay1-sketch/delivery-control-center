// The signed-in session, for the whole client.
//
// - The access token (a JWT, one hour) is kept in memory only — never in
//   localStorage, where any injected script could read it.
// - The refresh token lives in an httpOnly cookie the server sets; this code
//   never sees it. POST /api/auth/refresh sends it along automatically.
// - `authFetch` adds the token to every request. When the server answers 401
//   with token_stale (permissions changed) or token_expired, it refreshes once
//   and retries; if that fails, the session is over and the login screen shows.
//
// The permissions in the token are for display only — which parts of a screen
// to show. The server checks every request on its own.

export type Permissions = Record<string, string[]>;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  kind: "person" | "guest" | "agent";
};

export type Session = {
  accessToken: string;
  expiresAt: string;
  mustChangePassword: boolean;
  user: SessionUser;
  permissions: Permissions;
};

type Listener = (s: Session | null) => void;

let current: Session | null = null;
const listeners = new Set<Listener>();

export const getSession = () => current;
export const currentAccessToken = () => current?.accessToken ?? null;

export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSession(s: Session | null) {
  current = s;
  for (const fn of listeners) fn(s);
}

/** The server's refusal, as `{ error, message }`. */
export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function sessionFrom(r: Response): Promise<Session> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(body.error ?? String(r.status), body.message ?? r.statusText);
  return body as Session;
}

export async function login(email: string, password: string): Promise<Session> {
  const s = await sessionFrom(await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "same-origin",
  }));
  setSession(s);
  return s;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<Session> {
  const s = await sessionFrom(await authFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  }));
  setSession(s);
  return s;
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    setSession(null);
  }
}

let refreshing: Promise<Session | null> | null = null;

/**
 * Asks for a new access token with the refresh cookie. One request at a time:
 * callers that arrive while one is running share its result. A 409 means
 * another tab rotated the cookie a moment ago — retry once with the new one.
 */
export function refresh(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
        if (r.status === 409) {
          await new Promise((res) => setTimeout(res, 300));
          continue;
        }
        if (!r.ok) {
          setSession(null);
          return null;
        }
        const s = await sessionFrom(r);
        setSession(s);
        return s;
      }
      setSession(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const RETRY_ON = new Set(["token_stale", "token_expired"]);

/** `fetch` with the access token, refreshing once when the server says the token is stale or expired. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers);
    const token = currentAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers, credentials: "same-origin" });
  };

  const first = await send();
  if (first.status !== 401) return first;

  const code = await first.clone().json().then((b) => b?.error as string | undefined).catch(() => undefined);
  if (code && !RETRY_ON.has(code) && code !== "unauthorized") {
    if (code === "account_disabled") setSession(null);
    return first;
  }
  return (await refresh()) ? send() : first;
}

/** On load: a refresh cookie from an earlier visit (or an Entra sign-in) restores the session. */
export const restore = () => refresh();

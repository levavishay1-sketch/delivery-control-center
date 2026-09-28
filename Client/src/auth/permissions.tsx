// Showing or hiding parts of a screen by what the signed-in user may do.
//
// READY, NOT YET WIRED: no screen uses these yet, so every screen looks as it
// did. Hiding a part later is one wrapper:
//
//   <Can permission="requirements.edit" scope={{ requirement: id, client: clientId }}>
//     <button>…</button>
//   </Can>
//
// This is display only. The server checks every request itself
// ([RequirePermission]); a hidden button that someone forces anyway still
// gets 403.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSession, onSessionChange, type Permissions, type Session } from "./session.ts";

/**
 * Where a check applies. Rules mirror the server's:
 * a global grant counts everywhere; a client grant counts on that client and
 * its requirements; a requirement grant counts on it and everything under it
 * (pass the requirement's ancestors in `ancestors`).
 */
export type PermissionScope = {
  client?: string;
  requirement?: string;
  ancestors?: string[];
};

/** Permissions that mean something only across the whole system (mirrors the server's catalog). */
const GLOBAL_ONLY = new Set([
  "prompts.manage", "claude.manage", "settings.read", "settings.manage", "audit.read",
  "users.read", "users.manage", "users.invite_guest", "teams.manage", "roles.manage",
  "agents.manage", "agents.make_independent", "tokens.manage_own",
]);

export function hasPermission(perms: Permissions | undefined, permission: string, scope: PermissionScope = {}): boolean {
  if (!perms) return false;
  const holds = (key: string) => perms[key]?.includes(permission) ?? false;
  if (holds("*")) return true;
  if (GLOBAL_ONLY.has(permission)) return false;
  if (scope.client && holds(`c:${scope.client}`)) return true;
  for (const r of [scope.requirement, ...(scope.ancestors ?? [])])
    if (r && holds(`r:${r}`)) return true;
  return false;
}

const SessionContext = createContext<Session | null>(null);

/** Keeps the tree in step with the session (sign-in, refresh, sign-out). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(getSession());
  useEffect(() => onSessionChange(setSession), []);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

export function useCan(permission: string, scope?: PermissionScope): boolean {
  return hasPermission(useSession()?.permissions, permission, scope);
}

/** Renders its children only when the user holds `permission` at `scope`; otherwise `fallback` (default: nothing). */
export function Can({ permission, scope, fallback = null, children }: {
  permission: string;
  scope?: PermissionScope;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return <>{useCan(permission, scope) ? children : fallback}</>;
}

/** For a whole screen: shows `fallback` (a "no access" note) instead of the screen when the permission is missing. */
export function RequirePermission({ permission, scope, fallback, children }: {
  permission: string;
  scope?: PermissionScope;
  fallback: ReactNode;
  children: ReactNode;
}) {
  return <>{useCan(permission, scope) ? children : fallback}</>;
}

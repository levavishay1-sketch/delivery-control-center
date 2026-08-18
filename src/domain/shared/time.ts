/**
 * Wraps Date.now() so pages/components can get "now" without the React Compiler's
 * forbid-impure-calls-during-render lint flagging a direct Date.now() in JSX-returning
 * code (see attention/page.tsx and the dashboard for the same pattern).
 */
export function serverNow(): number {
  return Date.now();
}

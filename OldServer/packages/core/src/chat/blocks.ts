/**
 * The blocks a model answer may carry, and the text without them. Pure — no
 * database, no model — so it is tested on its own.
 *
 * An answer may propose several actions at once (a conversation about the
 * gaps closes one per gap it settled); each becomes its own card, and each
 * still runs only on the person's click.
 */

export type ParsedAction = { key: string; params: Record<string, unknown> };
export type ParsedBlocks = {
  text: string;
  actions: ParsedAction[];
  needsCode: string | null;
  goto: { key: string; reason: string } | null;
};

/** More than this in one answer is a model listing everything, not proposing. */
const MAX_ACTIONS = 12;

export function parseBlocks(raw: string): ParsedBlocks {
  let text = raw;
  const actions: ParsedAction[] = [];
  for (const a of raw.matchAll(/<action\s+key="([^"]+)"\s*>([\s\S]*?)<\/action>/gi)) {
    text = text.replace(a[0], "");
    if (actions.length >= MAX_ACTIONS) continue;
    let params: Record<string, unknown> = {};
    try {
      const j = JSON.parse(a[2]!.trim() || "{}");
      if (j && typeof j === "object" && !Array.isArray(j)) params = j as Record<string, unknown>;
    } catch { /* not JSON: no params */ }
    actions.push({ key: a[1]!.trim(), params });
  }
  const n = raw.match(/<needs_code\s*\/?>([\s\S]*?)(?:<\/needs_code>|$)/i);
  const needsCode = n ? n[1]!.trim() || null : null;
  if (n) text = text.replace(n[0], "");
  const g = raw.match(/<goto\s+key="([^"]+)"\s*>([\s\S]*?)(?:<\/goto>|$)/i);
  const goto = g ? { key: g[1]!.trim(), reason: g[2]!.trim() } : null;
  if (g) text = text.replace(g[0], "");
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), actions, needsCode, goto };
}

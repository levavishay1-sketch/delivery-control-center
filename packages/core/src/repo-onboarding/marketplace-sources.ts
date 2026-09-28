import { execFileSync } from "node:child_process";
import type { marketplaceSource } from "@dcc/db/schema";
import type { ComponentSeed } from "./types.ts";

/**
 * The database-free half of the marketplace (so its test never opens the
 * local database): reading what the model found, grading trust in code,
 * and turning a source into a card. The memory lives in `marketplace.ts`.
 *
 * Ready-made components for a stack: the open search (a model with web
 * search, keyed by the tags the diagnosis derived — never a fixed list of
 * marketplaces), the trust checks the CODE runs on what it found, and the
 * memory: a source found for one repository is remembered and offered to
 * the next repository with the same stack, and re-checked weekly.
 *
 * Trust is graded by the code, not by the model: official — the vendor or
 * maintainer of the very thing it connects to, or Anthropic's own
 * marketplace; known_community — a well-known organisation with activity
 * and a licence; unverified — everything else. An unverified source is shown
 * with a warning and never installed by itself.
 */

export type FoundSource = {
  kind: "plugin" | "mcp" | "skill" | "lsp";
  name: string;
  url: string;
  publisher: string | null;
  description: string | null;
  tags: string[];
  official: boolean;
  why: string;
  toolCount: number | null;
  readOnly: boolean | null;
  license: string | null;
  lastActivity: string | null;
};

export type Trust = "official" | "known_community" | "unverified";
export type TrustChecks = {
  publisherVerified: boolean;
  officialMarketplace: boolean;
  vendorNamespace: boolean;
  hasLicense: boolean;
  activeLastYear: boolean | null;
  readOnlyMode: boolean | null;
  toolCount: number | null;
  /** Tool descriptions were scanned for injections when the page listed them. */
  descriptionsScanned: boolean;
  suspicious: string[];
};

/* ── reading what the model found ─────────────────────────────────── */

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseSources(raw: string): FoundSource[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let o: { sources?: unknown };
  try { o = JSON.parse(raw.slice(start, end + 1)) as { sources?: unknown }; } catch { return []; }
  if (!Array.isArray(o.sources)) return [];
  const out: FoundSource[] = [];
  const seen = new Set<string>();
  for (const s of o.sources as Record<string, unknown>[]) {
    const url = str(s.url, 500);
    const kind = (["plugin", "mcp", "skill", "lsp"] as const).find((k) => k === s.kind);
    if (!kind || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      kind, url, name: str(s.name, 120) || url, publisher: str(s.publisher, 120) || null, description: str(s.description, 400) || null,
      tags: (Array.isArray(s.tags) ? s.tags : []).map((t) => str(t, 40).toLowerCase()).filter(Boolean).slice(0, 10),
      official: s.official === true, why: str(s.why, 400),
      toolCount: typeof s.toolCount === "number" ? s.toolCount : null, readOnly: typeof s.readOnly === "boolean" ? s.readOnly : null,
      license: str(s.license, 60) || null, lastActivity: str(s.lastActivity, 10) || null,
    });
  }
  return out.slice(0, 12);
}

/* ── the trust checks the code runs ───────────────────────────────── */

/** Publishers whose own components are trusted for what they publish — the vendors of the stacks the rules know, and Anthropic. */
const VENDORS: { pattern: RegExp; names: string[] }[] = [
  { pattern: /github\.com\/anthropics\//i, names: ["anthropic", "anthropics"] },
  { pattern: /github\.com\/microsoft\//i, names: ["microsoft"] },
  { pattern: /github\.com\/(azure|azure-samples)\//i, names: ["microsoft", "azure"] },
  { pattern: /github\.com\/dotnet\//i, names: ["microsoft", ".net", "dotnet"] },
  { pattern: /github\.com\/hashicorp\//i, names: ["hashicorp"] },
  { pattern: /github\.com\/github\//i, names: ["github"] },
  { pattern: /github\.com\/atlassian\//i, names: ["atlassian"] },
  { pattern: /github\.com\/getsentry\//i, names: ["sentry"] },
  { pattern: /github\.com\/grafana\//i, names: ["grafana"] },
  { pattern: /github\.com\/docker\//i, names: ["docker"] },
  { pattern: /github\.com\/modelcontextprotocol\//i, names: ["anthropic", "modelcontextprotocol"] },
  { pattern: /github\.com\/(vercel|vercel-labs)\//i, names: ["vercel"] },
  { pattern: /github\.com\/supabase\//i, names: ["supabase"] },
  { pattern: /github\.com\/prisma\//i, names: ["prisma"] },
  { pattern: /github\.com\/stripe\//i, names: ["stripe"] },
  { pattern: /github\.com\/salesforce(cli)?\//i, names: ["salesforce"] },
  { pattern: /github\.com\/sap\//i, names: ["sap"] },
  { pattern: /learn\.microsoft\.com\//i, names: ["microsoft"] },
  { pattern: /registry\.modelcontextprotocol\.io\//i, names: ["anthropic", "modelcontextprotocol"] },
  { pattern: /hub\.docker\.com\/mcp\//i, names: ["docker"] },
];
const OFFICIAL_MARKETPLACE = /github\.com\/anthropics\/claude-plugins-official/i;

/** Words in a tool description that read as an instruction to the agent rather than a description — the shape of a prompt injection. */
const INJECTION = /(ignore (all|any|previous|prior) instructions|do not tell the user|before (using|calling) (this|any) tool,? (read|send|post)|exfiltrat|send .* to http|curl .* \| (sh|bash)|<\s*system\s*>|you must always|secretly)/i;

export function checkTrust(s: FoundSource, page: string | null): { trust: Trust; checks: TrustChecks } {
  const vendor = VENDORS.find((v) => v.pattern.test(s.url));
  const publisher = (s.publisher ?? "").toLowerCase();
  const publisherVerified = !!vendor && (vendor.names.some((n) => publisher.includes(n)) || !s.publisher);
  const officialMarketplace = OFFICIAL_MARKETPLACE.test(s.url);
  const vendorNamespace = !!vendor;
  const hasLicense = !!s.license && !/none|unknown|proprietary/i.test(s.license);
  const year = s.lastActivity ? Number(s.lastActivity.slice(0, 4)) : NaN;
  const activeLastYear = Number.isFinite(year) ? new Date().getFullYear() - year <= 1 : null;
  const suspicious: string[] = [];
  if (page) for (const line of page.split("\n")) if (INJECTION.test(line)) suspicious.push(line.trim().slice(0, 160));
  const checks: TrustChecks = { publisherVerified, officialMarketplace, vendorNamespace, hasLicense, activeLastYear, readOnlyMode: s.readOnly, toolCount: s.toolCount, descriptionsScanned: page !== null, suspicious: suspicious.slice(0, 5) };
  let trust: Trust = "unverified";
  if (suspicious.length) trust = "unverified";
  else if (officialMarketplace || (vendorNamespace && publisherVerified)) trust = "official";
  else if (vendorNamespace || (hasLicense && activeLastYear === true && /github\.com\/[^/]+\/[^/]+/.test(s.url))) trust = "known_community";
  return { trust, checks };
}

/** Best effort, bounded: the page is read only to scan tool descriptions; a network that refuses is "not scanned", never a failure of the run. */
export function fetchPage(url: string, timeoutMs = 8000): string | null {
  try {
    return execFileSync("curl", ["-sSL", "--max-time", String(Math.ceil(timeoutMs / 1000)), "--max-filesize", "400000", url], { encoding: "utf8", timeout: timeoutMs + 2000, stdio: ["ignore", "pipe", "ignore"] }).slice(0, 200_000);
  } catch {
    return null;
  }
}

/** A remembered source — the row shape of `marketplace_source` (type only; nothing here touches the database). */
export type RememberedSource = typeof marketplaceSource.$inferSelect;

/** The tags the memory already covers well enough (at least two sources) — the search is asked only about the rest, so a new tag costs a search once. */
export function tagsToSearch(tags: readonly string[], remembered: readonly RememberedSource[]): string[] {
  const covered = new Map<string, number>();
  for (const r of remembered) for (const t of r.tags as string[]) covered.set(t, (covered.get(t) ?? 0) + 1);
  return tags.filter((t) => (covered.get(t) ?? 0) < 2);
}

/* ── from a source to a card ──────────────────────────────────────── */

export function seedFromSource(r: Pick<RememberedSource, "id" | "kind" | "name" | "url" | "publisher" | "description" | "trust" | "trustChecks" | "toolCount" | "tags">, why: string, matchedTags: string[]): ComponentSeed {
  const kind = r.kind as ComponentSeed["kind"];
  const checks = r.trustChecks as Partial<TrustChecks>;
  const trustHe = r.trust === "official" ? "רשמי" : r.trust === "known_community" ? "קהילה מוכרת" : "לא מאומת";
  const risk: ComponentSeed["risk"] = kind === "mcp" ? "external" : r.trust === "unverified" ? "significant" : "reversible";
  const contextTokens = kind === "mcp" && r.toolCount != null ? Math.min(r.toolCount, 5) * 700 : kind === "plugin" ? 400 : 0;
  return {
    key: `${kind}_${r.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 60),
    kind, family: "connections", risk, source: "marketplace", sourceRef: r.id, contextTokens,
    title_he: `${r.name} (${kind === "mcp" ? "MCP" : kind === "lsp" ? "LSP" : kind}) — ${trustHe}${r.publisher ? `, ${r.publisher}` : ""}`,
    why_he: `${why || r.description || ""} מתאים לסטאק: ${matchedTags.slice(0, 4).join(", ")}. ${r.trust === "unverified" ? "אזהרה: המקור לא אומת (לא יצרן, בלי רישיון או פעילות) — לא מותקן לבד." : r.trust === "official" ? "מקור רשמי של היצרן או של Anthropic." : "מקור קהילתי מוכר (רישיון, פעילות בשנה האחרונה)."}${checks.suspicious?.length ? ` נמצאו תיאורי כלים חשודים: ${checks.suspicious.length}.` : ""}`.trim(),
    what_he: kind === "mcp"
      ? `חיבור לשרת MCP${r.toolCount != null ? ` (${r.toolCount} כלים; מותקן עם דגל צמצום — עד 5 כלים נטענים, השאר דרך חיפוש כלים)` : ""}${checks.readOnlyMode ? "; במצב קריאה בלבד" : ""}. כתובת: ${r.url}`
      : kind === "plugin" ? `התקנת plugin ל-Claude Code מ-${r.url}, בגרסה נעוצה.`
      : kind === "lsp" ? `plugin של שרת שפה: ניווט מדויק בקוד ("מי קורא לזה"), שגיאות טיפוס בסשן. ${r.url}`
      : `ספריית skills: ${r.url}`,
    verifyHow_he: kind === "mcp" ? "חיבור וספירת הטוקנים שהכלים מוסיפים; תיאורי הכלים נסרקים שוב בכל עדכון." : kind === "plugin" ? "claude plugin validate, ואז eval עם ובלי על משימות הניסיון." : "התקנה; בדיקה שהסשן טוען אותו.",
    params: { name: r.name, url: r.url, kind: r.kind, trust: r.trust, toolCount: r.toolCount, publisher: r.publisher, sourceId: r.id, tags: r.tags },
  };
}

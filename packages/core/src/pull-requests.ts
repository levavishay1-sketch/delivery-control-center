import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@dcc/db";
import { client, repo } from "@dcc/db/schema";
import { httpsRepoUrl } from "./ai-assist.ts";

/**
 * Pull requests across every client, from the hosts DCC is connected to
 * (`openspec/changes/pull-request-center`).
 *
 * The host stays the source of truth: this reads, links what DCC knows (which
 * client, which repository, which branch belongs to which run), and says what
 * is waiting. Nothing here merges, and nothing here writes to a host.
 *
 * Version one speaks GitHub through the operator's own `gh` login, behind the
 * `Provider` seam so Azure DevOps slots in beside it without touching a caller.
 */

export type PullRequestState = "open" | "merged" | "closed";
export type ReviewState = "approved" | "changes_requested" | "none";
export type ChecksState = "passing" | "failing" | "running" | "none";

export type PullRequestRow = {
  id: string;
  provider: "github" | "ado";
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  draft: boolean;
  author: string;
  headBranch: string;
  baseBranch: string;
  createdAt: string;
  updatedAt: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  /** null when the host has not finished working it out yet. */
  mergeable: boolean | null;
  conflicts: boolean;
  review: ReviewState;
  checks: ChecksState;
  /** Set when another open request's branch is this one's base. */
  parentId: string | null;
  repo: { id: string; name: string };
  client: { id: string | null; name: string | null };
  /** Why it needs a person, in the order that matters. */
  flags: { key: string; text: string; tone: "critical" | "warning" | "healthy" | "neutral" }[];
  waitingHours: number;
};

export type PullRequestList = {
  rows: PullRequestRow[];
  repos: { id: string; name: string; clientId: string | null; clientName: string | null; provider: "github" | "ado" | null; reason?: string }[];
  syncedAt: string;
  /** A host that could not be reached keeps the screen honest rather than empty. */
  problems: { repo: string; reason: string }[];
};

/* ── the seam ─────────────────────────────────────────────────────── */

type RepoRef = { id: string; name: string; url: string; clientId: string | null; clientName: string | null };

type Provider = {
  id: "github" | "ado";
  list(repo: RepoRef): Promise<Omit<PullRequestRow, "repo" | "client" | "flags" | "parentId" | "waitingHours">[]>;
};

const run = (file: string, args: string[], timeoutMs = 25_000) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => {
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(stdout ?? ""), err: String(stderr ?? "") });
    });
  });

/** Where `gh` actually is. A server started before the CLI was installed does
 *  not have it on PATH, so the usual install locations are tried too — the same
 *  approach the onboarding session uses to find Claude Code. */
let ghPath: string | null | undefined;
function ghBin(): string | null {
  if (ghPath !== undefined) return ghPath;
  const candidates = [
    process.env.DCC_GH_BIN,
    path.join(process.env["ProgramFiles"] ?? "C:/Program Files", "GitHub CLI", "gh.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "GitHub CLI", "gh.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "GitHub CLI", "gh.exe"),
    "/usr/bin/gh", "/usr/local/bin/gh", "/opt/homebrew/bin/gh",
  ].filter(Boolean) as string[];
  // An installed copy is preferred; a bare "gh" (found through PATH) is the last resort, and is checked by ghAvailable().
  // Trying "gh" first made a caller that never ran that check spawn a command that does not exist on the server's PATH.
  ghPath = candidates.find((c) => existsSync(c)) ?? "gh";
  return ghPath;
}

async function ghAvailable(): Promise<boolean> {
  const bin = ghBin();
  if (!bin) return false;
  if (bin !== "gh") return true;
  const r = await run(bin, ["--version"], 8_000);
  if (r.code === 0) return true;
  // PATH did not have it after all; try the install locations before giving up.
  ghPath = undefined;
  const again = ([] as string[]).concat(
    path.join(process.env["ProgramFiles"] ?? "C:/Program Files", "GitHub CLI", "gh.exe"),
  ).find((c) => existsSync(c));
  ghPath = again ?? null;
  return !!again;
}

const GH_FIELDS = "number,title,url,state,isDraft,author,headRefName,baseRefName,createdAt,updatedAt,changedFiles,additions,deletions,mergeable,reviewDecision,statusCheckRollup";

type GhPr = {
  number: number; title: string; url: string; state: string; isDraft: boolean;
  author?: { login?: string } | null; headRefName: string; baseRefName: string;
  createdAt: string; updatedAt: string; changedFiles?: number; additions?: number; deletions?: number;
  mergeable?: string; reviewDecision?: string | null;
  statusCheckRollup?: { state?: string; conclusion?: string; status?: string }[] | null;
};

function checksOf(pr: GhPr): ChecksState {
  const list = pr.statusCheckRollup ?? [];
  if (!list.length) return "none";
  const norm = list.map((c) => (c.conclusion || c.state || c.status || "").toUpperCase());
  if (norm.some((s) => s === "FAILURE" || s === "ERROR" || s === "TIMED_OUT")) return "failing";
  if (norm.some((s) => s === "IN_PROGRESS" || s === "PENDING" || s === "QUEUED")) return "running";
  return "passing";
}

/** One `gh` call that returns JSON, or null when the host could not answer. */
export async function ghJson<T>(args: string[]): Promise<T | null> {
  const bin = ghBin();
  if (!bin) return null;
  const r = await run(bin, args, 30_000);
  if (r.code !== 0) return null;
  try { return JSON.parse(r.out || "null") as T; } catch { return null; }
}

/** One `gh` call whose answer is text (a file's contents), or null when the host could not give it. */
export async function ghText(args: string[]): Promise<string | null> {
  const bin = ghBin();
  if (!bin) return null;
  const r = await run(bin, args, 30_000);
  return r.code === 0 ? r.out : null;
}

const github: Provider = {
  id: "github",
  async list(r) {
    const res = await run(ghBin() ?? "gh", ["pr", "list", "--repo", r.url, "--state", "open", "--limit", "50", "--json", GH_FIELDS]);
    if (res.code !== 0) throw new Error(res.err.split("\n")[0] || "gh pr list נכשל");
    const parsed = JSON.parse(res.out || "[]") as GhPr[];
    return parsed.map((p) => ({
      id: `github:${r.id}:${p.number}`,
      provider: "github" as const,
      number: p.number,
      title: p.title,
      url: p.url,
      state: (p.state || "OPEN").toLowerCase() === "merged" ? "merged" : (p.state || "OPEN").toLowerCase() === "closed" ? "closed" : "open",
      draft: !!p.isDraft,
      author: p.author?.login ?? "—",
      headBranch: p.headRefName,
      baseBranch: p.baseRefName,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      changedFiles: p.changedFiles ?? 0,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      mergeable: p.mergeable === "MERGEABLE" ? true : p.mergeable === "CONFLICTING" ? false : null,
      conflicts: p.mergeable === "CONFLICTING",
      review: p.reviewDecision === "APPROVED" ? "approved" : p.reviewDecision === "CHANGES_REQUESTED" ? "changes_requested" : "none",
      checks: checksOf(p),
    }));
  },
};

const PROVIDERS: Provider[] = [github];

/* ── what needs a person ──────────────────────────────────────────── */

/** A request bigger than this is hard to review in one sitting (a well-known threshold). */
const BIG_PR_FILES = 40;
/** A first answer within a working day is the usual agreement. */
const WAITING_HOURS = 24;

function flagsFor(pr: Omit<PullRequestRow, "flags" | "waitingHours" | "parentId">, waitingHours: number, parentOpen: boolean): PullRequestRow["flags"] {
  const f: PullRequestRow["flags"] = [];
  if (pr.conflicts) f.push({ key: "conflict", text: "התנגשות מול היעד", tone: "critical" });
  if (pr.checks === "failing") f.push({ key: "checks", text: "בדיקות נכשלו", tone: "critical" });
  if (parentOpen) f.push({ key: "parent", text: "ממתין ל-PR אחר שעוד לא מוזג", tone: "warning" });
  if (pr.draft) f.push({ key: "draft", text: "טיוטה", tone: "neutral" });
  else if (pr.review === "approved") f.push({ key: "approved", text: "אושר", tone: "healthy" });
  else if (waitingHours > WAITING_HOURS) f.push({ key: "waiting", text: `ממתין ${Math.round(waitingHours / 24)} ימים`, tone: "warning" });
  if (pr.review === "changes_requested") f.push({ key: "changes", text: "התבקשו שינויים", tone: "warning" });
  if (pr.changedFiles > BIG_PR_FILES) f.push({ key: "big", text: `${pr.changedFiles} קבצים — שקלו לפצל`, tone: "warning" });
  if (pr.checks === "passing") f.push({ key: "green", text: "בדיקות עברו", tone: "healthy" });
  return f;
}

/* ── the list ─────────────────────────────────────────────────────── */

async function reposToWatch(): Promise<{ refs: RepoRef[]; skipped: PullRequestList["repos"] }> {
  const rows = await db
    .select({ id: repo.id, name: repo.name, adoRepoRef: repo.adoRepoRef, clientId: repo.clientId, clientName: client.name })
    .from(repo).leftJoin(client, eq(client.id, repo.clientId)).orderBy(repo.name);
  const refs: RepoRef[] = [];
  const skipped: PullRequestList["repos"] = [];
  for (const r of rows) {
    const url = r.adoRepoRef && /^(https?:\/\/|git@)/.test(r.adoRepoRef) ? httpsRepoUrl(r.adoRepoRef) : null;
    const entry = { id: r.id, name: r.name, clientId: r.clientId, clientName: r.clientName ?? null };
    if (!url) { skipped.push({ ...entry, provider: null, reason: "אין כתובת git לריפו" }); continue; }
    if (!/github\.com/i.test(url)) { skipped.push({ ...entry, provider: "ado", reason: "Azure DevOps — עדיין לא מחובר למסך הזה" }); continue; }
    refs.push({ ...entry, url });
  }
  return { refs, skipped };
}

let cache: { at: number; list: PullRequestList } | null = null;
const LIST_TTL_MS = 60_000;

/** Every open request DCC can see, with what DCC knows about it added. */
export async function listPullRequests(opts: { refresh?: boolean } = {}): Promise<PullRequestList> {
  if (!opts.refresh && cache && Date.now() - cache.at < LIST_TTL_MS) return cache.list;
  const { refs, skipped } = await reposToWatch();
  const problems: PullRequestList["problems"] = [];
  const watched: PullRequestList["repos"] = [...skipped];
  const raw: (Omit<PullRequestRow, "flags" | "waitingHours" | "parentId"> & { repo: { id: string; name: string }; client: { id: string | null; name: string | null } })[] = [];

  if (refs.length && !(await ghAvailable())) {
    for (const r of refs) watched.push({ id: r.id, name: r.name, clientId: r.clientId, clientName: r.clientName, provider: "github", reason: "GitHub CLI לא מותקן — התקינו gh והתחברו" });
  } else {
    // One repository's host call must not wait for another's.
    await Promise.all(refs.map(async (r) => {
      watched.push({ id: r.id, name: r.name, clientId: r.clientId, clientName: r.clientName, provider: "github" });
      for (const p of PROVIDERS) {
        try {
          const prs = await p.list(r);
          for (const pr of prs) raw.push({ ...pr, repo: { id: r.id, name: r.name }, client: { id: r.clientId, name: r.clientName } });
        } catch (e) {
          problems.push({ repo: r.name, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) });
        }
      }
    }));
  }

  // A request whose base is another open request's branch hangs under it, at any depth.
  const byHead = new Map(raw.map((p) => [`${p.repo.id}|${p.headBranch}`, p]));
  const now = Date.now();
  const rows: PullRequestRow[] = raw.map((p) => {
    const parent = byHead.get(`${p.repo.id}|${p.baseBranch}`);
    const waitingHours = (now - new Date(p.updatedAt).getTime()) / 3_600_000;
    return {
      ...p,
      parentId: parent && parent.id !== p.id ? parent.id : null,
      waitingHours,
      flags: flagsFor(p, waitingHours, !!parent),
    };
  });
  rows.sort((a, b) => {
    const rank = (r: PullRequestRow) => (r.flags.some((f) => f.tone === "critical") ? 0 : r.flags.some((f) => f.tone === "warning") ? 1 : 2);
    return rank(a) - rank(b) || b.waitingHours - a.waitingHours;
  });

  const list: PullRequestList = { rows, repos: watched, syncedAt: new Date().toISOString(), problems };
  cache = { at: Date.now(), list };
  return list;
}

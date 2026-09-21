import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo } from "@dcc/db/schema";
import { httpsRepoUrl } from "./ai-assist.ts";
import { codeMapFrom, type CodeMap, type CodeMapCommit, type CodeMapFacts } from "./code-map.ts";
import { ghJson, ghText, listPullRequests, type PullRequestRow } from "./pull-requests.ts";

/**
 * One pull request, as its screen needs it
 * (`openspec/changes/pull-request-center`, screens 2 to 5).
 *
 * Everything here comes from the host, not from a local clone: a person's
 * machine may not have the branch at all, and a map drawn from a copy that
 * lacks it would quietly say "empty branch" instead of the truth. When the
 * host cannot answer, the screen says so rather than guessing.
 */

export type Blocker = {
  key: string;
  /** true = fine, false = blocks the merge, null = nothing to check. */
  ok: boolean | null;
  title: string;
  detail: string;
};

export type NextStep = { title: string; detail: string; action: "update_branch" | "request_review" | "merge" | "open_host" | "wait" | "done" };

export type FileGroupKey = "code" | "instructions" | "docs" | "config" | "build" | "other";

export type PullRequestFile = { path: string; status: string; additions: number; deletions: number; note?: string; /** The name it had before, when it was renamed. */ from?: string };
export type FileGroup = { key: FileGroupKey; title: string; note?: string; files: PullRequestFile[]; additions: number; deletions: number };

export type TimelineItem = { at: string; kind: "commit" | "review" | "comment" | "base" | "opened" | "pushed" | "merged" | "dcc"; text: string; detail?: string; tag?: string; tone?: "warning" | "healthy" | "neutral" };

export type PullRequestDetail = {
  pr: PullRequestRow;
  blockers: Blocker[];
  nextStep: NextStep;
  codeMap: CodeMap | null;
  /** Why the map could not be drawn, when it could not. */
  codeMapProblem: string | null;
  /** `sharedFiles`: files both the target and this request changed. The host does not say which commit touched which. */
  freshness: { behind: number; sharedFiles: number; ahead: number; baseBranch: string } | null;
  groups: FileGroup[];
  /** What the branch is about, in a few lines. */
  topics: Topic[];
  /** The two versions a file is compared between: where the branch left the base, and where it is now. */
  refs: { base: string; head: string } | null;
  fileCount: number;
  timeline: TimelineItem[];
  body: string;
};

/* ── what the host says ───────────────────────────────────────────── */

type GhCommit = { sha: string; parents?: { sha: string }[]; commit: { message: string; author: { name: string; date: string } } };
type GhFile = { filename: string; status?: string; additions: number; deletions: number; previous_filename?: string };
type GhCompare = { ahead_by: number; behind_by: number; commits: GhCommit[]; files?: GhFile[]; merge_base_commit?: GhCommit };
type GhReview = { state: string; body?: string; author?: { login?: string } | null; submittedAt?: string };
type GhComment = { author?: { login?: string } | null; body: string; createdAt: string };

const short = (sha: string) => sha.slice(0, 7);
const subject = (message: string) => message.split("\n")[0]!.trim();
const asCommit = (c: GhCommit, files: string[] = []): CodeMapCommit => ({
  sha: short(c.sha), subject: subject(c.commit.message), author: c.commit.author.name, at: c.commit.author.date, files,
  body: c.commit.message.split("\n").slice(1).join("\n").trim() || undefined,
  merge: (c.parents?.length ?? 0) > 1 || undefined,
});

/* ── files, grouped the way a person reads them ───────────────────── */

const GROUPS: { key: FileGroupKey; title: string; note?: string; match: (p: string) => boolean }[] = [
  { key: "build", title: "קבצי בנייה", note: "נוצרים מחדש בכל מחשב — בדרך כלל לא אמורים להיכנס", match: (p) => /(^|\/)(bin|obj|dist|build|node_modules)\//i.test(p) || /\.(dll|exe|pdb|map)$/i.test(p) },
  { key: "instructions", title: "הוראות ל-Claude", note: "משפיעות על כל מי שעובד בריפו", match: (p) => /^CLAUDE\.md$|^AGENTS\.md$|^\.claude\//i.test(p) },
  { key: "docs", title: "תיעוד", match: (p) => /\.(md|mdx|txt|adoc)$/i.test(p) || /^docs\//i.test(p) },
  { key: "config", title: "הגדרות", match: (p) => /\.(json|ya?ml|toml|ini|config|csproj|sln|editorconfig|gitignore|gitattributes)$/i.test(p) || /^\./.test(p) },
  { key: "code", title: "קוד", match: (p) => /\.(ts|tsx|js|jsx|mjs|cjs|cs|py|go|rb|java|sql|css|html)$/i.test(p) },
];

/** The host says "removed" and "renamed"; both would shorten to R, so the letters are named. */
const STATUS_LETTER: Record<string, string> = { added: "A", modified: "M", removed: "D", renamed: "R", copied: "A", changed: "M" };

const GENERATED = /Entities\.cs$|OptionSets\.cs$|\.designer\.cs$|\.g\.ts$|packages\//i;

function groupFiles(files: GhFile[]): FileGroup[] {
  const out = new Map<FileGroupKey, FileGroup>();
  const add = (g: { key: FileGroupKey; title: string; note?: string }, f: PullRequestFile) => {
    const cur = out.get(g.key) ?? { ...g, files: [], additions: 0, deletions: 0 };
    cur.files.push(f);
    cur.additions += f.additions;
    cur.deletions += f.deletions;
    out.set(g.key, cur);
  };
  for (const f of files) {
    const g = GROUPS.find((x) => x.match(f.filename)) ?? { key: "other" as FileGroupKey, title: "אחר" };
    add(g, {
      path: f.filename, status: STATUS_LETTER[f.status ?? "modified"] ?? "M", additions: f.additions, deletions: f.deletions,
      ...(GENERATED.test(f.filename) ? { note: "נוצר אוטומטית — לא לערוך ידנית" } : {}),
      ...(f.previous_filename ? { from: f.previous_filename } : {}),
    });
  }
  const order: FileGroupKey[] = ["code", "instructions", "config", "docs", "other", "build"];
  return order.filter((k) => out.has(k)).map((k) => out.get(k)!);
}

/* ── what the branch is about ─────────────────────────────────────── */

export type Topic = { title: string; detail: string };

const humanize = (slug: string) => { const t = slug.replace(/-/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const filesLine = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** The subjects a branch touches, worked out from where its files are — no model involved. Each
 *  OpenSpec change it touches is a subject (its folder name is the subject's name); what is left
 *  is grouped by the part of the repository it lives in. */
function topicsOf(files: GhFile[]): Topic[] {
  const changes = new Map<string, { n: number; removed: number }>();
  const areas = new Map<string, number>();
  for (const f of files) {
    const m = f.filename.match(/^openspec\/changes\/([^/]+)\//);
    if (m && m[1] !== "archive") {
      const cur = changes.get(m[1]!) ?? { n: 0, removed: 0 };
      cur.n++; if (f.status === "removed") cur.removed++;
      changes.set(m[1]!, cur);
      continue;
    }
    const parts = f.filename.split("/");
    const area = parts.length > 2 && /^(apps|packages)$/.test(parts[0]!) ? `${parts[0]}/${parts[1]}` : parts.length > 1 ? parts[0]! : "repository root";
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }
  // The OpenSpec changes are the branch's real subjects and come first; the parts of the repository follow.
  const out: (Topic & { n: number })[] = [];
  let retired = 0;
  let minor = 0;
  const live = [...changes].filter(([, c]) => c.removed !== c.n).sort((a, b) => b[1].n - a[1].n);
  // A change that was deleted outright is not a subject of this branch, only something it cleared away.
  retired = changes.size - live.length;
  live.forEach(([name, c], i) => {
    // Past the first three, a change touched by a line or two is housekeeping, not a subject.
    if (i >= 3 && c.n < 2) { minor++; return; }
    out.push({ title: humanize(name), detail: `OpenSpec change · ${filesLine(c.n)}`, n: c.n });
  });
  if (minor) out.push({ title: "Other OpenSpec changes touched", detail: `${minor} ${minor === 1 ? "change" : "changes"}, a line or two each`, n: minor });
  const shown = [...areas].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [area, n] of shown) out.push({ title: area === "repository root" ? "Files in the repository root" : `Code in ${area}`, detail: filesLine(n), n });
  if (retired) out.push({ title: "Old OpenSpec changes removed", detail: `${retired} ${retired === 1 ? "change" : "changes"}`, n: retired });
  return out.slice(0, 9).map(({ title, detail }) => ({ title, detail }));
}

/* ── what blocks a merge, in the order that matters ───────────────── */

function blockersFor(pr: PullRequestRow, parentOpen: boolean, checksKnown: boolean): Blocker[] {
  // Nothing blocks a request that has already been merged or closed.
  if (pr.state !== "open") return [];
  const b: Blocker[] = [];
  b.push(pr.conflicts
    ? { key: "conflict", ok: false, title: "התנגשות מול היעד", detail: `הענף והיעד נוגעים באותן שורות. צריך לעדכן את הענף ולהכריע איזו גרסה נשארת.` }
    : { key: "conflict", ok: pr.mergeable === null ? null : true, title: pr.mergeable === null ? "מצב המיזוג עדיין נבדק" : "אין התנגשות", detail: pr.mergeable === null ? "הגיט־האוסט עדיין בודק אם אפשר למזג. כדאי לרענן בעוד רגע." : "הגיט־האוסט מצא שאפשר למזג בלי הכרעה ידנית." });
  b.push(pr.review === "approved"
    ? { key: "review", ok: true, title: "אושר בסקירה", detail: "לפחות אדם אחד עבר על השינוי ואישר." }
    : pr.review === "changes_requested"
      ? { key: "review", ok: false, title: "התבקשו שינויים", detail: "סוקר ביקש תיקון לפני המיזוג. הפרטים בגיט־האוסט." }
      : { key: "review", ok: false, title: "אין אישור סקירה", detail: "אף אחד עדיין לא אישר את השינוי. אפשר לעבור עליו ולאשר בכרטיס הסקירה שלך." });
  b.push(checksKnown
    ? pr.checks === "failing"
      ? { key: "checks", ok: false, title: "בדיקות אוטומטיות נכשלו", detail: "הריפו מריץ בדיקות, והן לא עברו על הגרסה הזו." }
      : pr.checks === "running"
        ? { key: "checks", ok: null, title: "בדיקות רצות", detail: "הבדיקות עדיין באמצע. כדאי לחכות לתוצאה." }
        : { key: "checks", ok: true, title: "הבדיקות עברו", detail: "כל הבדיקות שהריפו מריץ הסתיימו בהצלחה." }
    : { key: "checks", ok: null, title: "אין בדיקות אוטומטיות", detail: "לריפו הזה לא מוגדרות בדיקות. זה לא חוסם, אבל גם לא מגן." });
  b.push(parentOpen
    ? { key: "parent", ok: false, title: "ממתין לבקשה אחרת", detail: "היעד של הבקשה הזו הוא ענף של בקשה שעוד לא מוזגה. צריך למזג אותה קודם." }
    : { key: "parent", ok: true, title: "אין בקשה שצריך למזג לפני", detail: "הבקשה מכוונת ישירות לענף היעד." });
  if (pr.draft) b.unshift({ key: "draft", ok: false, title: "הבקשה היא טיוטה", detail: "טיוטה לא ניתנת למיזוג. כשהיא מוכנה, מסמנים אותה כמוכנה לסקירה בגיט־האוסט." });
  return b;
}

function nextStepFor(pr: PullRequestRow, blockers: Blocker[], behind: number, sharedFiles: number): NextStep {
  if (pr.state === "merged") return { title: "הבקשה כבר מוזגה", detail: `השינוי נכנס ל-${pr.baseBranch}${pr.closedAt ? ` ב-${new Date(pr.closedAt).toLocaleDateString("he-IL")}` : ""}. אין מה לעשות בה, והענף שלה אפשר למחוק אם לא נמחק.`, action: "done" };
  if (pr.state === "closed") return { title: "הבקשה נסגרה בלי מיזוג", detail: "השינוי לא נכנס. אם העבודה עדיין נחוצה, אפשר לפתוח בקשה חדשה מאותו ענף.", action: "done" };
  if (sharedFiles > 0 || pr.conflicts) {
    return {
      title: "עדכנו את הענף מהיעד" + (blockers.some((b) => b.key === "review" && b.ok === false) ? ", ואז בקשו סקירה" : ""),
      detail: `${pr.baseBranch} התקדם ב-${behind} מאז שהענף נפתח${sharedFiles ? `, ויש ${sharedFiles === 1 ? "קובץ אחד" : `${sharedFiles} קבצים`} שגם הבקשה הזו משנה` : ""}. לכן מה שנבדק כאן אינו מה שיתקבל אחרי המיזוג.`,
      action: "update_branch",
    };
  }
  if (pr.draft) return { title: "סמנו את הבקשה כמוכנה לסקירה", detail: "כל עוד היא טיוטה, אף אחד לא מתבקש לעבור עליה והיא לא ניתנת למיזוג.", action: "open_host" };
  const review = blockers.find((b) => b.key === "review");
  if (review?.ok === false && pr.review === "changes_requested") return { title: "טפלו בשינויים שהתבקשו", detail: "סוקר ביקש תיקון. אחרי שהוא ייכנס, בקשו סקירה חוזרת.", action: "open_host" };
  if (review?.ok === false) return { title: "בקשו סקירה", detail: "הכול ירוק חוץ מאישור. עברו על השינוי וכתבו את החלטתכם בכרטיס הסקירה שלך.", action: "request_review" };
  if (blockers.some((b) => b.ok === false)) return { title: "יש חסימה שצריך לטפל בה", detail: "ראו את הרשימה למעלה. המיזוג ייפתח כשכל השורות ירוקות.", action: "open_host" };
  if (blockers.some((b) => b.ok === null && b.key === "checks")) return { title: "המתינו לסיום הבדיקות", detail: "הבדיקות עדיין רצות. כשיסתיימו, אפשר למזג.", action: "wait" };
  return { title: "אפשר למזג", detail: `כל התנאים מתקיימים. המיזוג יכניס את השינוי ל-${pr.baseBranch}, ומשם הצוות יקבל אותו ב-pull הבא.`, action: "merge" };
}

/* ── the whole thing ──────────────────────────────────────────────── */

/** What the screen can show at once: the header, what blocks the merge and the next step come from
 *  the list already held, with no further call to the host. The heavy parts (the map, the files, the
 *  timeline) arrive separately, so a person sees something useful immediately and the rest fills in. */
export type PullRequestQuick = { pr: PullRequestRow; blockers: Blocker[]; nextStep: NextStep };

const findRequest = (list: { rows: PullRequestRow[]; history: PullRequestRow[] }, repoId: string, number: number) =>
  list.rows.find((r) => r.repo.id === repoId && r.number === number) ?? list.history.find((r) => r.repo.id === repoId && r.number === number);

export async function pullRequestQuick(repoId: string, number: number): Promise<PullRequestQuick> {
  const list = await listPullRequests({});
  const pr = findRequest(list, repoId, number);
  if (!pr) throw new Error("בקשת המיזוג לא נמצאה");
  const blockers = blockersFor(pr, !!pr.parentId, pr.checks !== "none");
  return { pr, blockers, nextStep: nextStepFor(pr, blockers, 0, 0) };
}

/** A request's detail costs several calls to the host; a person switching tabs
 *  should not pay for them again. Kept briefly, and skipped on an explicit refresh. */
const cache = new Map<string, { at: number; value: PullRequestDetail }>();
const TTL_MS = 45_000;

export async function pullRequestDetail(repoId: string, number: number, opts: { refresh?: boolean } = {}): Promise<PullRequestDetail> {
  const key = `${repoId}:${number}`;
  if (!opts.refresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  }
  const list = await listPullRequests({ refresh: opts.refresh });
  const pr = findRequest(list, repoId, number);
  if (!pr) throw new Error("בקשת המיזוג לא נמצאה");
  const [r] = await db.select({ adoRepoRef: repo.adoRepoRef }).from(repo).where(eq(repo.id, repoId)).limit(1);
  const url = r?.adoRepoRef ? httpsRepoUrl(r.adoRepoRef) : null;
  const slug = url ? url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") : null;

  // Three independent questions to the host, asked together rather than one after the other:
  // what the request holds, what the branch gained, and what the base gained since.
  // A request that is no longer open has no live comparison to make: its branch may be gone, and the base has moved on.
  const [view, ours, theirs] = slug
    ? await Promise.all([
        ghJson<{ body?: string; files?: GhFile[]; reviews?: GhReview[]; comments?: GhComment[] }>(["pr", "view", String(number), "--repo", url!, "--json", "body,files,reviews,comments"]),
        pr.state === "open" ? ghJson<GhCompare>(["api", `repos/${slug}/compare/${pr.baseBranch}...${pr.headBranch}`]) : Promise.resolve(null),
        pr.state === "open" ? ghJson<GhCompare>(["api", `repos/${slug}/compare/${pr.headBranch}...${pr.baseBranch}`]) : Promise.resolve(null),
      ])
    : [null, null, null];
  // The base's history before the branch point is not fetched: listing it took ~8s on the host,
  // more than everything else on this screen together. The drawing gives its line a short lead-in instead.
  const mergeBase = ours?.merge_base_commit?.sha ?? null;

  // The compare API names a file `filename` and says what happened to it; `gh pr view`
  // only gives `path`. Prefer compare, fall back to the view when it is unavailable.
  const files: GhFile[] = (ours?.files?.length ? ours.files : (view?.files ?? []).map((f) => ({ ...f, filename: (f as unknown as { path?: string }).path ?? f.filename, status: f.status ?? "modified" })))
    .filter((f) => !!f.filename);
  const groups = groupFiles(files);
  const ourPaths = new Set((ours?.files ?? []).map((f) => f.filename));
  const theirCommits = (theirs?.commits ?? []).map((c) => asCommit(c));
  const behind = theirs?.ahead_by ?? 0;
  // Which of the base's new commits touch a file this request also changes.
  const theirFiles = new Set((theirs?.files ?? []).map((f) => f.filename));
  const overlap = [...theirFiles].filter((f) => ourPaths.has(f));

  let codeMap: CodeMap | null = null;
  let codeMapProblem: string | null = null;
  if (pr.state !== "open") {
    codeMapProblem = pr.state === "merged" ? "הבקשה כבר מוזגה, ולכן אין מפה חיה של מיקום הענף. רשימת הקבצים והיומן מציגים מה נכנס." : "הבקשה נסגרה, ולכן אין מפה חיה של מיקום הענף.";
  } else if (!ours || !theirs) {
    codeMapProblem = "אין כרגע מידע מהגיט־האוסט על הענף הזה, ולכן אי אפשר לצייר את מיקומו. נסו לרענן.";
  } else {
    const facts: CodeMapFacts = {
      baseBranch: pr.baseBranch,
      branch: pr.headBranch,
      baselineSha: mergeBase ? short(mergeBase) : null,
      baselineCommit: ours.merge_base_commit ? asCommit(ours.merge_base_commit) : null,
      baseBefore: [],
      // The host lists only the files both sides changed, not which commit changed what — so no commit is drawn as "touching".
      baseAfter: theirCommits.map((c) => ({ ...c, files: [] })),
      ourCommits: (ours.commits ?? []).map((c) => asCommit(c, [...ourPaths])),
      uncommittedFiles: 0,
      behind,
      behindTouching: 0,
      sharedFiles: overlap.length,
      perCommitFiles: false,
      pushed: true,
      merged: false,
      prUrl: pr.url,
      prNumber: pr.number,
      fetchedAt: null,
      repoUrl: url,
      dir: null,
      unreadable: null,
    };
    codeMap = codeMapFrom(facts, { branchLabel: pr.headBranch });
  }

  const parentOpen = !!pr.parentId;
  const checksKnown = pr.checks !== "none";
  const blockers = blockersFor(pr, parentOpen, checksKnown);
  const nextStep = nextStepFor(pr, blockers, behind, overlap.length);

  const timeline: TimelineItem[] = [];
  if (pr.state !== "open" && pr.closedAt) timeline.push({ at: pr.closedAt, kind: "merged", text: pr.state === "merged" ? `הבקשה מוזגה ל-${pr.baseBranch}` : "הבקשה נסגרה בלי מיזוג", tone: pr.state === "merged" ? "healthy" : "warning" });
  timeline.push({ at: pr.createdAt, kind: "opened", text: `הבקשה נפתחה על ידי ${pr.author}`, tone: "neutral" });
  for (const c of (ours?.commits ?? []).slice(-8)) timeline.push({ at: c.commit.author.date, kind: "commit", text: subject(c.commit.message), detail: `${short(c.sha)} · ${c.commit.author.name}` });
  for (const c of theirCommits.slice(-5)) timeline.push({ at: c.at, kind: "base", text: `${pr.baseBranch} התקדם: ${c.subject}`, detail: `${c.sha} · ${c.author}`, tag: overlap.length ? "נוגע באותם קבצים" : undefined, tone: overlap.length ? "warning" : undefined });
  for (const rv of view?.reviews ?? []) {
    const said = (rv.body ?? "").trim();
    timeline.push({
      at: rv.submittedAt ?? pr.updatedAt, kind: "review",
      text: `${rv.author?.login ?? "מישהו"} ${rv.state === "APPROVED" ? "אישר את השינוי" : rv.state === "CHANGES_REQUESTED" ? "ביקש שינויים" : "כתב הערת סקירה"}`,
      ...(said ? { detail: said.slice(0, 300) } : {}),
      tone: rv.state === "APPROVED" ? "healthy" : rv.state === "CHANGES_REQUESTED" ? "warning" : "neutral",
    });
  }
  for (const cm of (view?.comments ?? []).slice(-5)) timeline.push({ at: cm.createdAt, kind: "comment", text: `${cm.author?.login ?? "מישהו"} כתב הערה`, detail: subject(cm.body).slice(0, 120) });
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const value: PullRequestDetail = {
    pr, blockers, nextStep, codeMap, codeMapProblem,
    freshness: ours && theirs ? { behind, sharedFiles: overlap.length, ahead: ours.ahead_by ?? 0, baseBranch: pr.baseBranch } : null,
    groups, topics: topicsOf(files), fileCount: files.length, timeline, body: view?.body ?? "",
    refs: mergeBase && ours?.commits?.length ? { base: mergeBase, head: ours.commits[ours.commits.length - 1]!.sha } : null,
  };
  cache.set(key, { at: Date.now(), value });
  keptForFiles.set(key, { at: Date.now(), value });
  return value;
}

/* ── one file, before and after ───────────────────────────────────── */

/** Past this, a file is shown as "too big to compare here" and linked, not loaded. */
const MAX_FILE_BYTES = 400_000;

export type FileVersions = {
  path: string;
  /** The file as it was before the change; null when it did not exist. */
  before: string | null;
  /** The file as it is after the change; null when it was removed. */
  after: string | null;
  binary: boolean;
  tooLarge: boolean;
  /** Where the two versions live on the host. */
  beforeUrl: string | null;
  afterUrl: string | null;
};

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Opening a file needs only the two versions' addresses, which the detail already worked out. That is kept
 *  longer than the detail itself, so a file opened a minute later does not repeat the four calls to the host. */
const keptForFiles = new Map<string, { at: number; value: PullRequestDetail }>();
const FILE_TTL_MS = 3 * 60_000;

export async function pullRequestFile(repoId: string, number: number, filePath: string): Promise<FileVersions> {
  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) throw new Error("נתיב לא חוקי");
  const kept = keptForFiles.get(`${repoId}:${number}`);
  const d = kept && Date.now() - kept.at < FILE_TTL_MS ? kept.value : await pullRequestDetail(repoId, number);
  const file = d.groups.flatMap((g) => g.files).find((f) => f.path === filePath);
  if (!file) throw new Error("הקובץ הזה לא נמצא בבקשה");
  if (d.pr.state !== "open") throw new Error("השוואת קובץ לפני ואחרי זמינה רק בבקשות פתוחות.");
  if (!d.refs) throw new Error("אין כרגע מידע מהגיט־האוסט על הגרסאות. נסו לרענן.");
  const [r] = await db.select({ adoRepoRef: repo.adoRepoRef }).from(repo).where(eq(repo.id, repoId)).limit(1);
  const url = r?.adoRepoRef ? httpsRepoUrl(r.adoRepoRef) : null;
  const slug = url ? url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") : null;
  if (!slug || !url) throw new Error("אין כתובת GitHub לריפו הזה");

  const oldPath = file.from ?? file.path;
  const isNew = file.status === "A";
  const isGone = file.status === "D";
  const fetchAt = (p: string, ref: string) =>
    ghText(["api", `repos/${slug}/contents/${encodePath(p)}?ref=${ref}`, "-H", "Accept: application/vnd.github.raw"]);
  const [before, after] = await Promise.all([
    isNew ? Promise.resolve(null) : fetchAt(oldPath, d.refs.base),
    isGone ? Promise.resolve(null) : fetchAt(file.path, d.refs.head),
  ]);
  const values = [before, after].filter((v): v is string => v !== null);
  const binary = values.some((v) => v.includes("\u0000"));
  const tooLarge = values.some((v) => Buffer.byteLength(v) > MAX_FILE_BYTES);
  return {
    path: file.path,
    before: binary || tooLarge ? null : before,
    after: binary || tooLarge ? null : after,
    binary, tooLarge,
    beforeUrl: isNew ? null : `${url}/blob/${d.refs.base}/${encodePath(oldPath)}`,
    afterUrl: isGone ? null : `${url}/blob/${d.pr.headBranch}/${encodePath(file.path)}`,
  };
}

import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo } from "@dcc/db/schema";
import { httpsRepoUrl } from "./ai-assist.ts";
import { ghJson } from "./pull-requests.ts";

/**
 * Every branch of a repository, with what to do about it
 * (`openspec/changes/pull-request-center`).
 *
 * A branch is created by someone or something and then left behind, and after a
 * while nobody remembers which ones matter. This answers, for each one: how did
 * it get here, is what it holds already in the main branch, is a merge request
 * waiting on it, and — in words — what is sensible to do. It only reads and
 * advises; deleting stays a decision made on the host.
 */

export type BranchStatus = "default" | "merged" | "open_pr" | "work" | "stale";

export type BranchHealth = {
  name: string;
  status: BranchStatus;
  /** Commits it holds that the main branch does not. */
  unique: number;
  /** Commits the main branch gained that it does not have. */
  behind: number;
  pr: { number: number; state: string; draft: boolean } | null;
  lastAt: string | null;
  lastBy: string | null;
  lastMessage: string | null;
  /** How it came to exist, in plain words. */
  origin: string;
  advice: { title: string; detail: string; tone: "healthy" | "warning" | "critical" | "neutral" };
  url: string | null;
};

export type RepoBranches = { defaultBranch: string; rows: BranchHealth[]; syncedAt: string };

function originOf(name: string): string {
  if (/^claude\//.test(name)) return "נוצר אוטומטית על ידי סשן של Claude Code בשולחן העבודה. כל סשן פותח ענף משלו, והוא לא נמחק לבד.";
  if (/^ai\/onboarding\//.test(name)) return "נוצר על ידי הרצת הטמעה של DCC, ענף אחד לכל הרצה.";
  if (/^project\//.test(name)) return "ענף פרויקט, לפי שיטת העבודה שלנו: ענף אחד לפרויקט, וממנו יוצאים ענפי המשימות.";
  if (/^(task|feature)\//.test(name)) return "ענף משימה, לפי שיטת העבודה שלנו.";
  if (/^(fix|cleanup|perf|bug)\//.test(name)) return "ענף לשינוי קטן וממוקד, שנפתח ידנית.";
  return "לא ידוע מי פתח אותו. אפשר לראות את מי שכתב בו לאחרונה.";
}

function adviceFor(b: Pick<BranchHealth, "name" | "unique" | "behind" | "pr" | "lastAt">, base: string, isBase: boolean): { status: BranchStatus; advice: BranchHealth["advice"] } {
  if (isBase) return { status: "default", advice: { title: "הענף הראשי", detail: "הגרסה הרשמית של הריפו. לא נוגעים בו ישירות ולא מוחקים אותו.", tone: "neutral" } };
  if (b.pr?.state === "OPEN") {
    return {
      status: "open_pr",
      advice: { title: `ממתין בבקשת מיזוג #${b.pr.number}`, detail: `הבקשה פתוחה${b.pr.draft ? " (כטיוטה)" : ""}. אין מה למחוק עד שהיא תמוזג או תיסגר, ואז הענף נמחק.`, tone: "neutral" },
    };
  }
  if (b.unique === 0) {
    return {
      status: "merged",
      advice: { title: "אפשר למחוק", detail: `כל מה שהיה בענף הזה כבר נמצא ב-${base}. המחיקה לא מאבדת שום דבר, וההיסטוריה נשארת.`, tone: "healthy" },
    };
  }
  const closed = b.pr && b.pr.state !== "OPEN" && b.pr.state !== "MERGED";
  // A branch is not called forgotten because of its age — long work is legitimate — but because its request was closed unmerged.
  if (closed) {
    return {
      status: "stale",
      advice: {
        title: "הבקשה שלו נסגרה בלי מיזוג",
        detail: `יש בו ${b.unique} commits שלא נכנסו ל-${base}, והבקשה שנפתחה עליהם נסגרה בלי מיזוג. אם העבודה כבר לא רלוונטית, אפשר למחוק. אם היא כן, כדאי לפתוח בקשת מיזוג. עדיף להסתכל בה קודם.`,
        tone: "warning",
      },
    };
  }
  return {
    status: "work",
    advice: {
      title: `עבודה שעוד לא נכנסה ל-${base}`,
      detail: `יש בו ${b.unique} commits שעוד אין להם בקשת מיזוג${b.behind > 0 ? `, ו-${base} התקדם ב-${b.behind} מאז שנפתח, כך שלפני מיזוג צריך לעדכן אותו` : ""}. אם זו עבודה שממשיכים בה, ממשיכים. כשהיא מוכנה, פותחים בקשת מיזוג. אם היא כבר לא נחוצה, אפשר למחוק, אבל קודם לראות מה יש בה.`,
      tone: b.behind > 10 ? "warning" : "neutral",
    },
  };
}

type GqlNode = {
  name: string;
  target?: { committedDate?: string; messageHeadline?: string; author?: { name?: string; user?: { login?: string } | null } | null } | null;
  associatedPullRequests?: { nodes: { number: number; state: string; isDraft: boolean; baseRefName: string }[] };
  compare?: { aheadBy: number; behindBy: number } | null;
};

const QUERY = `query($owner:String!,$name:String!,$base:String!){
  repository(owner:$owner,name:$name){
    refs(refPrefix:"refs/heads/", first:60, orderBy:{field:TAG_COMMIT_DATE, direction:DESC}){
      nodes{
        name
        target{ ... on Commit { committedDate messageHeadline author{ name user{ login } } } }
        associatedPullRequests(first:5, states:[OPEN,MERGED,CLOSED]){ nodes{ number state isDraft baseRefName } }
        compare(headRef:$base){ aheadBy behindBy }
      }
    }
  }
}`;

const cache = new Map<string, { at: number; value: RepoBranches }>();
const TTL_MS = 60_000;

export async function repoBranches(repoId: string, opts: { refresh?: boolean } = {}): Promise<RepoBranches> {
  const hit = cache.get(repoId);
  if (!opts.refresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [r] = await db.select({ adoRepoRef: repo.adoRepoRef }).from(repo).where(eq(repo.id, repoId)).limit(1);
  const url = r?.adoRepoRef ? httpsRepoUrl(r.adoRepoRef) : null;
  const slug = url ? url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") : null;
  if (!slug) throw new Error("אין כתובת GitHub לריפו הזה");
  const [owner, name] = slug.split("/") as [string, string];

  // The default branch is asked first, because every other branch is compared to it.
  const meta = await ghJson<{ default_branch?: string }>(["api", `repos/${slug}`]);
  const base = meta?.default_branch ?? "main";
  const res = await ghJson<{ data?: { repository?: { refs: { nodes: GqlNode[] } } } }>(["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `base=${base}`]);
  const nodes = res?.data?.repository?.refs.nodes;
  if (!nodes) throw new Error("GitHub לא החזיר את רשימת הענפים. נסו לסנכרן שוב.");

  const rows: BranchHealth[] = nodes.map((n) => {
    const prs = n.associatedPullRequests?.nodes ?? [];
    // The request that matters is the open one, else the newest.
    const pr = prs.find((p) => p.state === "OPEN") ?? prs[0] ?? null;
    const partial = {
      name: n.name,
      unique: n.compare?.behindBy ?? 0,
      behind: n.compare?.aheadBy ?? 0,
      pr: pr ? { number: pr.number, state: pr.state, draft: pr.isDraft } : null,
      lastAt: n.target?.committedDate ?? null,
    };
    const { status, advice } = adviceFor(partial, base, n.name === base);
    return {
      ...partial, status, advice,
      lastBy: n.target?.author?.user?.login ?? n.target?.author?.name ?? null,
      lastMessage: n.target?.messageHeadline ?? null,
      origin: n.name === base ? "הענף הראשי של הריפו." : originOf(n.name),
      url: `${url}/tree/${encodeURIComponent(n.name)}`,
    };
  });
  const order: Record<BranchStatus, number> = { open_pr: 0, work: 1, stale: 2, merged: 3, default: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  const value: RepoBranches = { defaultBranch: base, rows, syncedAt: new Date().toISOString() };
  cache.set(repoId, { at: Date.now(), value });
  return value;
}


import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo, users } from "@dcc/db/schema";
import { httpsRepoUrl } from "./ai-assist.ts";
import { dccApprovalMark, ghExec, ghLogin, listPullRequests } from "./pull-requests.ts";

/**
 * A review written in DCC and sent to the host
 * (`openspec/changes/pull-request-center`).
 *
 * A person does not have to open the host to review: they choose here, and DCC
 * writes it there through the operator's own login. The host stays where the
 * decision lives — nothing is kept only in DCC.
 *
 * The one thing DCC cannot do is make the host accept what it refuses: a
 * request's own author cannot approve it or ask for changes on it there. For
 * that person an approval is posted as an ordinary review comment that says so
 * and carries a mark, and DCC reads the mark back (see `reviewOf`).
 */

export type ReviewDecision = "comment" | "approve" | "request_changes" | "dcc_approve";

/** A refusal with a message written for the person, not a failure to hide. */
export class ReviewRefused extends Error {}

export async function submitReview(input: { repoId: string; number: number; decision: ReviewDecision; text: string; by: { userId: string } }): Promise<{ posted: true }> {
  const text = input.text.trim().slice(0, 4000);
  const list = await listPullRequests({});
  const pr = list.rows.find((r) => r.repo.id === input.repoId && r.number === input.number);
  if (!pr) throw new ReviewRefused("הבקשה כבר לא פתוחה, ולכן אי אפשר לסקור אותה.");

  const [r] = await db.select({ adoRepoRef: repo.adoRepoRef }).from(repo).where(eq(repo.id, input.repoId)).limit(1);
  const url = r?.adoRepoRef ? httpsRepoUrl(r.adoRepoRef) : null;
  if (!url) throw new ReviewRefused("אין כתובת GitHub לריפו הזה.");

  const login = await ghLogin();
  const isAuthor = !!login && login.toLowerCase() === pr.author.toLowerCase();

  if ((input.decision === "comment" || input.decision === "request_changes") && !text) {
    throw new ReviewRefused(input.decision === "comment" ? "כתבו את ההערה." : "כשמבקשים שינויים חייבים לכתוב מה לשנות.");
  }
  if (isAuthor && (input.decision === "approve" || input.decision === "request_changes")) {
    throw new ReviewRefused("הגיט־האוסט לא מאפשר לכותב הבקשה לאשר אותה או לבקש בה שינויים. אפשר לכתוב הערה, או לאשר ב-DCC.");
  }

  let flag: string;
  let body = text;
  if (input.decision === "approve") flag = "--approve";
  else if (input.decision === "request_changes") flag = "--request-changes";
  else if (input.decision === "comment") flag = "--comment";
  else {
    // Approval made in DCC: a comment on the host that says who gave it, with the mark DCC reads back.
    const [u] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, input.by.userId)).limit(1);
    const name = u?.name || u?.email || "משתמש DCC";
    flag = "--comment";
    body = `נסקר ואושר ב-DCC על ידי ${name}.${text ? `\n\n${text}` : ""}\n\nזה אישור של DCC ולא אישור רשמי של הגיט־האוסט.\n\n${dccApprovalMark(name)}`;
  }

  const res = await ghExec(["pr", "review", String(input.number), "--repo", url, flag, ...(body ? ["--body", body] : [])]);
  if (!res.ok) {
    const why = res.err.split("\n").find((l) => l.trim()) ?? "";
    if (/own pull request/i.test(why)) throw new ReviewRefused("הגיט־האוסט לא מאפשר לכותב הבקשה לאשר אותה. אפשר לאשר ב-DCC.");
    throw new ReviewRefused(`הגיט־האוסט לא קיבל את הסקירה${why ? `: ${why.slice(0, 160)}` : "."}`);
  }
  return { posted: true };
}

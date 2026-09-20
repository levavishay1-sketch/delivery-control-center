import { eq } from "drizzle-orm";
import { db } from "@dcc/db";
import { repo } from "@dcc/db/schema";
import { httpsRepoUrl } from "./ai-assist.ts";
import { ghExec, ghLogin, listPullRequests } from "./pull-requests.ts";

/**
 * A review written in DCC and sent to the host
 * (`openspec/changes/pull-request-center`).
 *
 * A person does not have to open the host to review: they choose here, and DCC
 * writes it there through the operator's own login. The host stays where the
 * decision lives — nothing is kept only in DCC.
 *
 * DCC cannot make the host accept what it refuses: a request's own author cannot
 * approve it or ask for changes on it there, so the account DCC acts as can only
 * comment on a request it opened. That is said in words when it is tried, and it
 * goes away when each person acts as their own account.
 */

export type ReviewDecision = "comment" | "approve" | "request_changes";

/** A refusal with a message written for the person, not a failure to hide. */
export class ReviewRefused extends Error {}

export async function submitReview(input: { repoId: string; number: number; decision: ReviewDecision; text: string }): Promise<{ posted: true }> {
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
    throw new ReviewRefused("הבקשה הזו נפתחה בחשבון הגיט־האוסט שבו DCC עובד עכשיו, והגיט־האוסט לא נותן לאותו חשבון לאשר אותה או לבקש בה תיקון. אישור רשמי ייתן משתמש אחר, ואפשר לכתוב הערה. נטפל בזה כשכל משתמש יעבוד בחשבון שלו.");
  }

  const flag = input.decision === "approve" ? "--approve" : input.decision === "request_changes" ? "--request-changes" : "--comment";
  const body = text;

  const res = await ghExec(["pr", "review", String(input.number), "--repo", url, flag, ...(body ? ["--body", body] : [])]);
  if (!res.ok) {
    const why = res.err.split("\n").find((l) => l.trim()) ?? "";
    if (/own pull request/i.test(why)) throw new ReviewRefused("הגיט־האוסט לא נותן לכותב הבקשה לאשר אותה. אישור רשמי ייתן משתמש אחר.");
    throw new ReviewRefused(`הגיט־האוסט לא קיבל את הסקירה${why ? `: ${why.slice(0, 160)}` : "."}`);
  }
  return { posted: true };
}

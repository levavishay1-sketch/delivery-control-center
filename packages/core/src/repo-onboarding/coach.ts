import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { claudeCall, flowRun, marketplaceSource, onboardingComponent, repo, repoCoachProposal, repoProfile, repositoryOnboardingRun, repositoryOnboardingStep, task, workitemRepo } from "@dcc/db/schema";
import { appendRepoAiEvent } from "./events.ts";
import { checkTrust, fetchPage, type FoundSource, type TrustChecks } from "./marketplace.ts";
import { stackTags } from "./rules.ts";
import { KIND_HE } from "./components.ts";
import type { BuildResult, CoachProposalKind, ComponentSeed, HealthScore, RepoProfile } from "./types.ts";

/**
 * The coach — what continues after the run, from real work: the checks
 * that fail, the tasks that need a second development run, the cost per
 * task, and what changed in the world. Thresholds are relative (the same
 * failure on two or more tasks; a measure worse than the repository's own
 * earlier average), never one event. Every proposal carries its evidence
 * and the measure it will be judged by after it is applied; a proposal
 * never interrupts work — it waits in the dossier. Across repositories the
 * coach learns from numbers only (how many repositories a component was
 * verified in, and with what change), never from a client's content.
 */

export class CoachError extends Error {}

const WINDOW_DAYS = 30;

type TaskFacts = { id: string; intent: string; seq: number; runs: number; checks: { kind: string | null; result: string | null; cause: string | null }[]; costUsd: number; at: Date | null };

async function repoTasks(clientId: string, repoId: string, since: Date): Promise<TaskFacts[]> {
  const rows = await withTenant(clientId, (tx) =>
    tx.select({ id: task.id, intent: task.intent, seq: task.seq, workitemId: task.workitemId })
      .from(task).innerJoin(workitemRepo, eq(workitemRepo.workitemId, task.workitemId))
      .where(and(eq(workitemRepo.repoId, repoId), eq(task.kind, "task"))),
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const runs = await withTenant(clientId, (tx) => tx.select({ taskId: flowRun.taskId, state: flowRun.state, startedAt: flowRun.startedAt }).from(flowRun).where(and(inArray(flowRun.taskId, ids), eq(flowRun.kind, "implement"), gte(flowRun.startedAt, since))));
  const checks = await withTenant(clientId, (tx) => tx.select({ parentTaskId: task.parentTaskId, checkKind: task.checkKind, checkResult: task.checkResult, checkCause: task.checkCause }).from(task).where(and(inArray(task.parentTaskId, ids), eq(task.kind, "check"))));
  const cost = await withTenant(clientId, (tx) => tx.select({ entityId: claudeCall.entityId, usd: sql<number>`coalesce(sum(${claudeCall.costUsd}), 0)` }).from(claudeCall).where(and(eq(claudeCall.entityKind, "task"), inArray(claudeCall.entityId, ids), gte(claudeCall.startedAt, since))).groupBy(claudeCall.entityId));
  return rows.map((r) => {
    const rs = runs.filter((x) => x.taskId === r.id);
    return {
      id: r.id, intent: r.intent, seq: r.seq, runs: rs.length,
      checks: checks.filter((c) => c.parentTaskId === r.id).map((c) => ({ kind: c.checkKind, result: c.checkResult, cause: c.checkCause })),
      costUsd: Number(cost.find((c) => c.entityId === r.id)?.usd ?? 0), at: rs.map((x) => x.startedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    };
  }).filter((t) => t.runs > 0);
}

/* ── the health score ─────────────────────────────────────────────── */

export function healthFrom(tasks: readonly TaskFacts[], previous: readonly TaskFacts[] = []): HealthScore {
  const developed = tasks.filter((t) => t.runs > 0);
  const n = developed.length;
  const firstPass = developed.filter((t) => t.runs === 1 && t.checks.length > 0 && t.checks.every((c) => c.result === "passed"));
  const withChecks = developed.filter((t) => t.checks.length > 0);
  const firstPassRate = withChecks.length ? firstPass.length / withChecks.length : null;
  const rerunsPerTask = n ? developed.reduce((a, t) => a + (t.runs - 1), 0) / n : null;
  const costs = developed.filter((t) => t.costUsd > 0);
  const costPerTaskUsd = costs.length ? costs.reduce((a, t) => a + t.costUsd, 0) / costs.length : null;
  const parts: number[] = [];
  if (firstPassRate !== null) parts.push(firstPassRate * 100);
  if (rerunsPerTask !== null) parts.push(Math.max(0, 100 - rerunsPerTask * 50));
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  const prev = previous.length ? healthFrom(previous) : null;
  const trend = score !== null && prev?.score != null ? (score > prev.score + 5 ? "up" : score < prev.score - 5 ? "down" : "flat") : null;
  return { firstPassRate, rerunsPerTask, costPerTaskUsd, mergedWithoutRewriteRate: null, tasks: n, windowDays: WINDOW_DAYS, score, trend };
}

/* ── signals → proposals ──────────────────────────────────────────── */

export type Signal = { key: string; kind: CoachProposalKind; componentKey: string; title: string; why: string; evidence: Record<string, unknown>; measure: Record<string, unknown>; seed?: ComponentSeed };

/** Relative thresholds: the same check failing on at least two tasks and on at least a third of the tasks that ran it. */
export function signalsFrom(tasks: readonly TaskFacts[], installed: readonly { key: string; kind: string; contextTokens: number | null; title: string }[], previous: readonly TaskFacts[]): Signal[] {
  const out: Signal[] = [];
  const kinds = ["build", "tests", "regression", "e2e"] as const;
  for (const k of kinds) {
    const ran = tasks.filter((t) => t.checks.some((c) => c.kind === k));
    const failed = ran.filter((t) => t.checks.some((c) => c.kind === k && c.result === "failed"));
    if (failed.length >= 2 && failed.length >= ran.length / 3) {
      const want = k === "build" ? { componentKey: "build_gate_hook", title: "hook: build עובר לפני \"סיימתי\"", kind: "hook" as const } : k === "tests" ? { componentKey: "run_affected_tests_skill", title: "skill: הרצת הבדיקות של מה ששונה", kind: "skill" as const } : { componentKey: "regression_reviewer_agent", title: "סוכן סוקר לרגרסיות", kind: "agent" as const };
      if (installed.some((c) => c.key === want.componentKey)) continue;
      out.push({
        key: `check_${k}`, kind: "add", componentKey: want.componentKey, title: want.title,
        why: `בדיקת ${k} נכשלה ב-${failed.length} מתוך ${ran.length} משימות ב-${WINDOW_DAYS} הימים האחרונים (${failed.map((t) => `#${t.seq}`).slice(0, 5).join(", ")}). זה לא אירוע בודד.`,
        evidence: { check: k, failed: failed.map((t) => ({ seq: t.seq, intent: t.intent.slice(0, 80) })), ran: ran.length }, measure: { key: `check_${k}_fail_rate`, before: Math.round((failed.length / ran.length) * 100) / 100 },
        seed: { key: want.componentKey, kind: want.kind, family: want.kind === "hook" ? "verification" : want.kind === "skill" ? "skills" : "agents", risk: want.kind === "agent" ? "significant" : "reversible", source: "coach", sourceRef: `check_${k}`, title_he: want.title, why_he: `בדיקת ${k} נכשלה ב-${failed.length}/${ran.length} משימות.`, what_he: `${KIND_HE[want.kind]} שעונה על הכישלון החוזר.`, verifyHow_he: "שיעור הכישלון של אותה בדיקה ב-30 הימים שאחרי.", params: want.kind === "hook" ? { template: "build-gate", command: "" } : want.kind === "skill" ? { template: "run-affected-tests", command: "", dirs: [], frameworks: [] } : { template: "reviewer", withReviewMd: true } },
      });
    }
  }
  const reruns = tasks.filter((t) => t.runs >= 2);
  const implCauses = reruns.filter((t) => t.checks.some((c) => c.cause === "implementation"));
  if (reruns.length >= 2 && implCauses.length >= 2 && !installed.some((c) => c.kind === "agent")) {
    out.push({
      key: "reruns_implementation", kind: "add", componentKey: "implementation_reviewer_agent", title: "סוכן סוקר לפני \"סיימתי\"",
      why: `${reruns.length} משימות נזקקו לסבב פיתוח שני, ב-${implCauses.length} מהן הסיבה הייתה במימוש (${implCauses.map((t) => `#${t.seq}`).slice(0, 5).join(", ")}). סוקר בהקשר טרי תופס את זה לפני הסבב השני.`,
      evidence: { tasks: reruns.map((t) => ({ seq: t.seq, runs: t.runs })) }, measure: { key: "reruns_per_task", before: Math.round((reruns.reduce((a, t) => a + t.runs - 1, 0) / Math.max(1, tasks.length)) * 100) / 100 },
      seed: { key: "implementation_reviewer_agent", kind: "agent", family: "agents", risk: "significant", source: "coach", sourceRef: "reruns_implementation", title_he: "סוכן סוקר לפני \"סיימתי\"", why_he: `${reruns.length} משימות נזקקו לסבב שני.`, what_he: "סוקר קריאה בלבד עם רשימת בדיקה מהכישלונות שהיו.", verifyHow_he: "סבבי פיתוח למשימה ב-30 הימים שאחרי.", params: { template: "reviewer", withReviewMd: true } },
    });
  }
  const env = tasks.filter((t) => t.checks.some((c) => c.cause === "environment"));
  if (env.length >= 2 && !installed.some((c) => c.kind === "runner" || c.kind === "devcontainer")) {
    out.push({ key: "environment", kind: "add", componentKey: "environment_note", title: "שורת הנחיה: מה חסר בסביבה של הסוכן", why: `${env.length} משימות נכשלו מסיבת סביבה (${env.map((t) => `#${t.seq}`).slice(0, 5).join(", ")}) — הסוכן לא ידע מה לא רץ כאן.`, evidence: { tasks: env.map((t) => t.seq) }, measure: { key: "environment_failures", before: env.length }, seed: { key: "environment_note", kind: "rule", family: "knowledge", risk: "reversible", source: "coach", sourceRef: "environment", title_he: "שורת הנחיה: מה לא רץ בסביבה של הסוכן", why_he: `${env.length} כישלונות סביבה.`, what_he: "שורה ב-AGENTS.md שאומרת מה אי אפשר להריץ כאן ומה לעשות במקום.", verifyHow_he: "כישלונות סביבה ב-30 הימים שאחרי.", params: { text: "Some checks cannot run in the agent's environment; say so instead of retrying, and name what would be needed." } } });
  }
  // Cost: the last five tasks against the repository's own earlier average — a rise of a quarter or more points at the always-loaded context.
  const recent = [...tasks].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)).slice(0, 5).filter((t) => t.costUsd > 0);
  const earlier = previous.filter((t) => t.costUsd > 0);
  if (recent.length >= 3 && earlier.length >= 3) {
    const avg = (xs: readonly TaskFacts[]) => xs.reduce((a, t) => a + t.costUsd, 0) / xs.length;
    const r = avg(recent), e = avg(earlier);
    const heavy = [...installed].filter((c) => (c.contextTokens ?? 0) >= 1500).sort((a, b) => (b.contextTokens ?? 0) - (a.contextTokens ?? 0))[0];
    if (r > e * 1.25 && heavy) {
      out.push({ key: `cost_${heavy.key}`, kind: "remove", componentKey: heavy.key, title: `הסר או צמצם: ${heavy.title}`, why: `העלות למשימה עלתה מ-$${e.toFixed(2)} ל-$${r.toFixed(2)} (${Math.round(((r - e) / e) * 100)}%). הרכיב הזה טוען ~${(heavy.contextTokens ?? 0).toLocaleString("en-US")} טוקנים בכל סשן — המועמד הראשון.`, evidence: { before: e, after: r, component: heavy.key }, measure: { key: "cost_per_task", before: Math.round(r * 100) / 100 } });
    }
  }
  return out;
}

/* ── what the coach shows, and what it writes ─────────────────────── */

export type CoachView = {
  health: HealthScore;
  proposals: { id: string; kind: CoachProposalKind; componentKey: string | null; title: string; why: string; evidence: Record<string, unknown>; measure: Record<string, unknown>; status: string; createdAt: string; decidedAt: string | null; runId: string | null }[];
  installed: { key: string; kind: string; title: string; contextTokens: number | null; status: string; runId: string }[];
  lastRun: { id: string; completedAt: string | null; kind: string } | null;
  newInWorld: { name: string; kind: string; url: string; changedAt: string }[];
  acrossRepos: { key: string; title: string; repos: number; improved: number }[];
};

async function latestDeliveredRun(clientId: string, repoId: string) {
  const [run] = await withTenant(clientId, (tx) => tx.select().from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.repoId, repoId), eq(repositoryOnboardingRun.status, "Completed"))).orderBy(desc(repositoryOnboardingRun.completedAt)).limit(1));
  return run ?? null;
}

export async function coachView(repoId: string): Promise<CoachView> {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r?.clientId) throw new CoachError("הריפו לא נמצא או משותף");
  const clientId = r.clientId;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const before = new Date(since.getTime() - WINDOW_DAYS * 86_400_000);
  const tasks = await repoTasks(clientId, repoId, since);
  const previousAll = await repoTasks(clientId, repoId, before);
  const previous = previousAll.filter((t) => t.at && t.at < since);
  const last = await latestDeliveredRun(clientId, repoId);
  const runs = await withTenant(clientId, (tx) => tx.select({ id: repositoryOnboardingRun.id }).from(repositoryOnboardingRun).where(and(eq(repositoryOnboardingRun.repoId, repoId), eq(repositoryOnboardingRun.status, "Completed"))));
  const installedRows = runs.length ? await withTenant(clientId, (tx) => tx.select().from(onboardingComponent).where(and(inArray(onboardingComponent.runId, runs.map((x) => x.id)), inArray(onboardingComponent.status, ["verified", "installed"])))) : [];
  const installed = installedRows.map((c) => ({ key: c.key, kind: c.kind, title: c.title, contextTokens: c.contextTokens, status: c.status, runId: c.runId }));
  const signals = signalsFrom(tasks, installed, previous);
  // What changed in the world since the last run, for this stack.
  let newInWorld: CoachView["newInWorld"] = [];
  if (last) {
    const [prof] = await withTenant(clientId, (tx) => tx.select().from(repoProfile).where(eq(repoProfile.runId, last.id)).limit(1));
    if (prof) {
      const tags = stackTags(prof.profile as RepoProfile);
      const changed = await db.select().from(marketplaceSource).where(gte(marketplaceSource.changedAt, last.completedAt ?? last.startedAt));
      newInWorld = changed.filter((s) => (s.tags as string[]).some((t) => tags.includes(t))).map((s) => ({ name: s.name, kind: s.kind, url: s.url, changedAt: s.changedAt!.toISOString() }));
      for (const s of newInWorld) signals.push({ key: `world_${s.url}`, kind: "new_in_world", componentKey: `${s.kind}_${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.slice(0, 60), title: `חדש בעולם: ${s.name} (${s.kind}) השתנה`, why: `המקור עודכן ב-${s.changedAt.slice(0, 10)} ומתאים לסטאק של הריפו. כדאי לבדוק על ריפו אחד לפני אימוץ.`, evidence: { url: s.url, changedAt: s.changedAt }, measure: { key: "manual" } });
    }
  }
  // New proposals are written once; one already proposed, declined or applied for the same thing is not written again.
  const existing = await withTenant(clientId, (tx) => tx.select().from(repoCoachProposal).where(eq(repoCoachProposal.repoId, repoId)).orderBy(desc(repoCoachProposal.createdAt)));
  for (const s of signals) {
    if (existing.some((p) => p.componentKey === s.componentKey && p.kind === s.kind && (p.status === "proposed" || p.status === "applied" || p.status === "approved" || (p.status === "declined" && p.decidedAt && Date.now() - p.decidedAt.getTime() < 60 * 86_400_000)))) continue;
    const [row] = await withTenant(clientId, (tx) => tx.insert(repoCoachProposal).values({ repoId, clientId, kind: s.kind, componentKey: s.componentKey, title: s.title, why: s.why, evidence: { ...s.evidence, seed: s.seed ?? null }, measure: s.measure }).returning());
    existing.unshift(row!);
    await appendRepoAiEvent({ clientId, repoId, type: "coach.proposal.created", payload: { proposalId: row!.id, kind: s.kind, title: s.title, componentKey: s.componentKey }, actorUserId: null });
  }
  return {
    health: healthFrom(tasks, previous),
    proposals: existing.map((p) => ({ id: p.id, kind: p.kind as CoachProposalKind, componentKey: p.componentKey, title: p.title, why: p.why, evidence: (p.evidence ?? {}) as Record<string, unknown>, measure: (p.measure ?? {}) as Record<string, unknown>, status: p.status, createdAt: p.createdAt.toISOString(), decidedAt: p.decidedAt?.toISOString() ?? null, runId: p.runId })),
    installed, lastRun: last ? { id: last.id, completedAt: last.completedAt?.toISOString() ?? null, kind: last.kind } : null, newInWorld,
    acrossRepos: await acrossRepos(),
  };
}

export async function decideProposal(repoId: string, proposalId: string, by: { userId: string }, input: { decision: "approve" | "decline"; reason?: string | null }) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r?.clientId) throw new CoachError("הריפו לא נמצא");
  const [p] = await withTenant(r.clientId, (tx) => tx.select().from(repoCoachProposal).where(and(eq(repoCoachProposal.id, proposalId), eq(repoCoachProposal.repoId, repoId))).limit(1));
  if (!p) throw new CoachError("ההצעה לא נמצאה");
  if (p.status !== "proposed") throw new CoachError("ההצעה כבר הוכרעה");
  const status = input.decision === "approve" ? "approved" : "declined";
  await withTenant(r.clientId, (tx) => tx.update(repoCoachProposal).set({ status, decidedBy: by.userId, decidedAt: new Date(), declineReason: input.decision === "decline" ? input.reason?.trim() || null : null }).where(eq(repoCoachProposal.id, p.id)));
  await appendRepoAiEvent({ clientId: r.clientId, repoId, type: "coach.proposal.decided", payload: { proposalId: p.id, decision: input.decision, reason: input.reason ?? null, title: p.title }, actorUserId: by.userId });
  return { id: p.id, status };
}

/** Across repositories, numbers only: in how many repositories a component was verified, and how many of those runs improved on their baseline. */
export async function acrossRepos(): Promise<CoachView["acrossRepos"]> {
  const rows = await db.select({ key: onboardingComponent.key, title: onboardingComponent.title, runId: onboardingComponent.runId, repoId: repositoryOnboardingRun.repoId })
    .from(onboardingComponent).innerJoin(repositoryOnboardingRun, eq(repositoryOnboardingRun.id, onboardingComponent.runId))
    .where(and(eq(onboardingComponent.status, "verified"), eq(repositoryOnboardingRun.status, "Completed")));
  if (!rows.length) return [];
  const builds = await db.select({ runId: repositoryOnboardingStep.runId, result: repositoryOnboardingStep.result }).from(repositoryOnboardingStep).where(and(eq(repositoryOnboardingStep.stepKey, "build"), inArray(repositoryOnboardingStep.runId, [...new Set(rows.map((x) => x.runId))])));
  const improved = new Set(builds.filter((b) => { const d = (b.result as Partial<BuildResult> | null)?.delta; return !!d && d.after.passed > d.before.passed; }).map((b) => b.runId));
  const by = new Map<string, { title: string; repos: Set<string>; improved: Set<string> }>();
  for (const x of rows) {
    const e = by.get(x.key) ?? { title: x.title, repos: new Set<string>(), improved: new Set<string>() };
    e.repos.add(x.repoId);
    if (improved.has(x.runId)) e.improved.add(x.repoId);
    by.set(x.key, e);
  }
  return [...by].map(([key, e]) => ({ key, title: e.title, repos: e.repos.size, improved: e.improved.size })).sort((a, b) => b.repos - a.repos).slice(0, 30);
}

/* ── weekly: what is new in the world ─────────────────────────────── */

const pageHash = (page: string) => createHash("sha256").update(page.replace(/\s+/g, " ").slice(0, 60_000)).digest("hex").slice(0, 16);

/** Every remembered source is looked at again: the page's tool descriptions are rescanned for injections and its content hashed; a change marks the source, and the dossiers of the repositories with that stack show it as "new in the world". Best effort — a network that refuses leaves the row as it was. */
export async function recheckMarketplaceSources(log?: (line: string) => void): Promise<{ checked: number; changed: number }> {
  const rows = await db.select().from(marketplaceSource);
  let checked = 0, changed = 0;
  for (const r of rows) {
    const page = fetchPage(r.url, 8000);
    if (page === null) continue;
    checked++;
    const prev = (r.trustChecks ?? {}) as Partial<TrustChecks> & { pageHash?: string };
    const hash = pageHash(page);
    const src: FoundSource = { kind: r.kind as FoundSource["kind"], name: r.name, url: r.url, publisher: r.publisher, description: r.description, tags: r.tags as string[], official: r.trust === "official", why: "", toolCount: r.toolCount, readOnly: prev.readOnlyMode ?? null, license: null, lastActivity: null };
    const { trust, checks } = checkTrust(src, page);
    const isChange = !!prev.pageHash && prev.pageHash !== hash;
    if (isChange) changed++;
    await db.update(marketplaceSource).set({ trustChecks: { ...checks, pageHash: hash, license: prev.hasLicense }, trust: checks.suspicious.length ? "unverified" : r.trust === "unverified" ? trust : r.trust, lastCheckedAt: new Date(), ...(isChange ? { changedAt: new Date() } : {}) }).where(eq(marketplaceSource.id, r.id));
    if (checks.suspicious.length) log?.(`marketplace: ${r.name} now has suspicious tool descriptions — marked unverified`);
  }
  return { checked, changed };
}

export function scheduleCoach(log: { info: (msg: string) => void; error: (err: unknown) => void }, everyMs = 7 * 24 * 3600 * 1000): () => void {
  const run = () => recheckMarketplaceSources((l) => log.info(l)).then((r) => { if (r.checked) log.info(`coach: ${r.checked} marketplace source(s) rechecked, ${r.changed} changed`); }).catch((e) => log.error(e));
  const first = setTimeout(run, 120_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

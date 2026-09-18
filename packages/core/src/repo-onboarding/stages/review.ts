import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { git } from "../../ai-assist.ts";
import { markDropped } from "../artifacts.ts";
import { commitWorkspaceChanges } from "../commit.ts";
import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { GenerateResult } from "./generate.ts";
import type { PlanResult } from "./plan.ts";
import type { ValidateResult } from "./validate.ts";

/**
 * Stage 8 — Review. The last human gate before anything leaves the
 * machine: the full diff (fetched per file through the API), the
 * validation table, the context budget, plan-vs-produced, and what was
 * intentionally not created. "Request changes" sends the run back to
 * generate with the note; dropping files removes them and re-validates;
 * approving hands over to deliver.
 */
export type ChangedFile = { path: string; status: "A" | "M" | "D" | "R" | string; additions: number; deletions: number };
export type ReviewResult = {
  baselineSha: string;
  changedFiles: ChangedFile[];
  validation: { status: ValidateResult["status"]; failed: number; warned: number; passed: number; reviewStatus: string | null; issueCount: number };
  budget: ValidateResult["budget"] | null;
  planned: { key: string; kind: string; path: string; action: string; produced: boolean; lines?: number; estimatedTokens?: number }[];
  notCreated: PlanResult["notCreated"];
  decision?: "approve" | "request_changes";
  note?: string;
  droppedPaths?: string[];
  decidedAt?: string;
  decidedBy?: string;
};

export async function changedFilesSince(dir: string, baselineSha: string): Promise<ChangedFile[]> {
  const status = await git(["diff", "--name-status", `${baselineSha}..HEAD`], dir);
  const numstat = await git(["diff", "--numstat", `${baselineSha}..HEAD`], dir);
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstat.out.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) counts.set(m[3]!.trim(), { additions: m[1] === "-" ? 0 : Number(m[1]), deletions: m[2] === "-" ? 0 : Number(m[2]) });
  }
  const out: ChangedFile[] = [];
  for (const line of status.out.split("\n")) {
    const m = line.match(/^([AMDRT])\S*\t(.+?)(?:\t(.+))?$/);
    if (!m) continue;
    const p = (m[3] ?? m[2])!.trim();
    out.push({ path: p, status: m[1]!, ...(counts.get(p) ?? { additions: 0, deletions: 0 }) });
  }
  return out;
}

registerStage("review", async (ctx): Promise<StageOutcome> => {
  const plan = ctx.priorResults.plan as PlanResult | undefined;
  const gen = ctx.priorResults.generate as GenerateResult | undefined;
  const val = ctx.priorResults.validate as ValidateResult | undefined;
  if (!plan?.approved || !gen || !val) return { status: "Failed", errors: ["validate has not completed"] };

  if (ctx.resumeInput !== undefined) {
    const prior = ctx.ownResult as ReviewResult | undefined;
    if (!prior) return { status: "Failed", errors: ["nothing to review"] };
    const input = ctx.resumeInput as { decision?: unknown; note?: unknown; dropPaths?: unknown };
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : undefined;
    const dropPaths = Array.isArray(input.dropPaths) ? (input.dropPaths as unknown[]).filter((p): p is string => typeof p === "string") : [];
    if (input.decision === "request_changes") {
      if (!note) return { status: "Failed", errors: ["בקשת שינויים חייבת הערה — מה צריך להשתנות?"] };
      return { status: "Completed", result: { ...prior, decision: "request_changes", note, decidedAt: new Date().toISOString(), decidedBy: ctx.triggeredBy }, resetTo: { stageKey: "generate", note } };
    }
    if (input.decision !== "approve") return { status: "Failed", errors: ['decision must be "approve" or "request_changes"'] };
    if (dropPaths.length) {
      const allowed = new Set(prior.changedFiles.map((f) => f.path));
      const removed: string[] = [];
      for (const p of dropPaths) {
        if (!allowed.has(p)) continue;
        const full = path.join(ctx.workspaceDir, p);
        if (existsSync(full)) { rmSync(full, { recursive: true, force: true }); removed.push(p); }
      }
      if (removed.length) {
        await commitWorkspaceChanges(ctx.workspaceDir, ctx.triggeredBy, `DCC: drop ${removed.length} artifact(s) per review`);
        await markDropped(ctx.clientId, ctx.runId, removed);
        // The tree changed — validate again before delivering.
        return { status: "Completed", result: { ...prior, droppedPaths: removed, note, decidedAt: new Date().toISOString(), decidedBy: ctx.triggeredBy }, resetTo: { stageKey: "validate", note: undefined } };
      }
    }
    return { status: "Completed", result: { ...prior, decision: "approve", note, decidedAt: new Date().toISOString(), decidedBy: ctx.triggeredBy } };
  }

  const changedFiles = await changedFilesSince(ctx.workspaceDir, ctx.baselineSha);
  const produced = new Set(gen.artifacts.map((a) => a.path));
  const result: ReviewResult = {
    baselineSha: ctx.baselineSha, changedFiles,
    validation: {
      status: val.status, failed: val.checks.filter((c) => c.status === "fail").length, warned: val.checks.filter((c) => c.status === "warn").length,
      passed: val.checks.filter((c) => c.status === "pass").length, reviewStatus: val.review?.overall_status ?? null, issueCount: val.review?.issues.length ?? 0,
    },
    budget: val.budget,
    planned: plan.approved.filter((a) => a.action !== "skip").map((a) => {
      const g = gen.artifacts.find((x) => x.key === a.key);
      return { key: a.key, kind: a.kind, path: a.path, action: a.action, produced: produced.has(a.path) || !!g, lines: g?.lines, estimatedTokens: g?.estimatedTokens };
    }),
    notCreated: [...plan.notCreated, ...gen.missing.map((m) => ({ kind: m.key, reason_he: m.reason_he }))],
  };
  return { status: "WaitingForUser", result };
}, () => ({ decision: "approve" }));

import { existsSync } from "node:fs";
import path from "node:path";
import { replaceLedger } from "../artifacts.ts";
import { dccHooksAvailable } from "../dcc-hooks.ts";
import { cleanPathFragment, GUARDRAIL_CATALOG } from "../guardrails.ts";
import { renderInventoryForPrompt } from "../inventory.ts";
import { getActiveOnboardingPrompt } from "../prompts.ts";
import { createClaudeCodeRunner, READ_ONLY_TOOLS } from "../runner.ts";
import { PLAN_SCHEMA } from "../schemas.ts";
import { registerStage } from "../state-machine.ts";
import type { ArtifactKind, LifecyclePhase, PlannedArtifact, StageOutcome } from "../types.ts";
import type { BoundariesResult } from "./boundaries.ts";
import type { ConfirmResult } from "./confirm.ts";
import type { DiscoveryResult } from "./discovery.ts";
import type { ScanResult } from "./scan.ts";

/**
 * Stage 5 — Plan. The AI proposes which prose artifacts are justified
 * (create / update / skip, each with the ten-question justification);
 * DCC adds the deterministic ones (settings, applicable guardrails, its
 * own capture hooks). The plan is then a human gate: nothing is written
 * until the list is approved, so rejected artifacts cost no generation
 * tokens and the person sees "what will NOT be created" explicitly.
 */
type AiPlanItem = {
  kind: Exclude<ArtifactKind, "settings" | "guardrail_hook" | "dcc_hooks">;
  path: string; action: "create" | "update" | "skip"; title_he?: string; justification: string;
  consumers?: LifecyclePhase[]; watched_paths?: string[]; source_of_truth?: string;
  skill_name?: string; skill_description?: string; skill_paths?: string[]; disable_model_invocation?: boolean;
  rule_paths?: string[]; estimated_lines?: number;
};
type AiPlan = { artifacts: AiPlanItem[]; not_created: { kind: string; reason_he: string }[]; rationale_he?: string };

export type StaleArtifactWarning = { path: string; verdict: "outdated" | "conflicting"; reason?: string };
export type PlanResult = {
  artifacts: PlannedArtifact[];
  notCreated: { kind: string; reason_he: string }[];
  rationale_he?: string;
  protectedGlobs: string[];
  claudeExecutionId?: string;
  approved?: PlannedArtifact[];
  approvedAt?: string;
  /** Existing AI artifacts Discovery found outdated/conflicting — never
   *  silently dropped: every one must be acknowledged (or addressed by an
   *  artifact in the plan) before the plan can be approved. */
  staleArtifactWarnings: StaleArtifactWarning[];
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
const CLAUDE_MD_TITLE_HE = "CLAUDE.md — המפה הקצרה שנטענת בכל session";
const CLAUDE_MD_JUSTIFICATION = "Claude Code loads it every session: build/test commands it cannot guess, hard constraints, and pointers to on-demand knowledge — never an inventory of the code. When AGENTS.md exists it is imported (@AGENTS.md), not duplicated.";
const PHASES: LifecyclePhase[] = ["requirement", "understanding", "planning", "implementation", "testing", "review", "deployment", "future_sessions"];
const phases = (xs: unknown): LifecyclePhase[] => (Array.isArray(xs) ? xs.filter((x): x is LifecyclePhase => PHASES.includes(x as LifecyclePhase)) : []);

function normalizeAiItems(items: AiPlanItem[], scan: ScanResult, boundaries: BoundariesResult, workspaceDir: string): { artifacts: PlannedArtifact[]; notes: string[] } {
  const out: PlannedArtifact[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const existingPolicy = boundaries.approved?.existingConfig ?? {};
  for (const it of items) {
    let kind = it.kind;
    let p = (it.path || "").replace(/\\/g, "/").replace(/^\.?\//, "");
    let key = "";
    let skill: PlannedArtifact["skill"] | undefined;
    let rulePaths: string[] | undefined;
    if (kind === "claude_md") { p = scan.inventory.items.find((i) => i.type === "claude_md" && i.path !== "CLAUDE.local.md")?.path ?? "CLAUDE.md"; key = "claude_md"; }
    else if (kind === "nested_claude_md") { if (!p.endsWith("CLAUDE.md")) p = `${p.replace(/\/$/, "")}/CLAUDE.md`; key = `nested:${p}`; }
    else if (kind === "rule") { const name = slug(path.basename(p, ".md") || it.title_he || "rule"); p = `.claude/rules/${name}.md`; key = `rule:${name}`; rulePaths = (it.rule_paths ?? []).filter((x) => typeof x === "string" && x.trim()); if (rulePaths.length === 0) { notes.push(`rule ${name}: no paths given — a rule without paths loads every session; converted to skip`); it.action = "skip"; } }
    else if (kind === "knowledge_skill" || kind === "workflow_skill") {
      const name = slug(it.skill_name || path.basename(path.dirname(p)) || it.title_he || "skill");
      p = `.claude/skills/${name}/SKILL.md`; key = `skill:${name}`;
      skill = { name, description: (it.skill_description || it.justification || "").slice(0, 250), paths: it.skill_paths?.filter((x) => typeof x === "string" && x.trim()), disableModelInvocation: kind === "workflow_skill" ? !!it.disable_model_invocation : false };
    }
    else if (kind === "agent") { const name = slug(path.basename(p, ".md") || it.title_he || "agent"); p = `.claude/agents/${name}.md`; key = `agent:${name}`; }
    else continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const exists = existsSync(path.join(workspaceDir, p));
    let action: PlannedArtifact["action"] = it.action;
    if (exists && action === "create") action = "update";
    if (!exists && action === "update") action = "create";
    const policy = existingPolicy[p];
    if (exists && policy === "keep" && action !== "skip") { action = "skip"; notes.push(`${p}: kept as-is per the boundaries decision`); }
    // CLAUDE.md is the one file Claude Code actually loads. A model that
    // proposes skipping it "because AGENTS.md covers it" has confused the
    // two: AGENTS.md is not read by Claude Code — CLAUDE.md imports it.
    let title = it.title_he || p;
    let justification = it.justification || "";
    if (kind === "claude_md" && action === "skip" && !(exists && policy === "keep")) {
      action = exists ? "update" : "create";
      title = CLAUDE_MD_TITLE_HE;
      justification = CLAUDE_MD_JUSTIFICATION;
      notes.push(`${p}: the model proposed skipping CLAUDE.md — kept in the plan: Claude Code loads CLAUDE.md, not AGENTS.md (CLAUDE.md imports it with @AGENTS.md and adds only what is Claude-specific)`);
    }
    const loading: PlannedArtifact["loading"] = kind === "claude_md" ? "always" : kind === "rule" ? (rulePaths?.length ? "on_demand" : "always") : "on_demand";
    out.push({
      key, kind, path: p, action, loading, writer: "ai",
      title_he: title, justification, consumers: phases(it.consumers),
      watchedPaths: (it.watched_paths ?? []).filter((x) => typeof x === "string"), sourceOfTruth: it.source_of_truth || "repository code",
      skill, rulePaths, notes: [],
    });
  }
  // Exactly one root CLAUDE.md, always.
  if (!out.some((a) => a.kind === "claude_md")) {
    const p = scan.inventory.items.find((i) => i.type === "claude_md" && i.path !== "CLAUDE.local.md")?.path ?? "CLAUDE.md";
    const exists = existsSync(path.join(workspaceDir, p));
    const keep = existingPolicy[p] === "keep";
    out.unshift({
      key: "claude_md", kind: "claude_md", path: p, action: keep ? "skip" : exists ? "update" : "create", loading: "always", writer: "ai",
      title_he: CLAUDE_MD_TITLE_HE, justification: CLAUDE_MD_JUSTIFICATION,
      consumers: ["understanding", "planning", "implementation", "testing", "review", "future_sessions"], watchedPaths: [], sourceOfTruth: "repository code + team decisions", notes: keep ? ["kept as-is per the boundaries decision"] : [],
    });
  }
  return { artifacts: out, notes };
}

function deterministicItems(scan: ScanResult, boundaries: BoundariesResult, discovery: DiscoveryResult, workspaceDir: string): { artifacts: PlannedArtifact[]; protectedGlobs: string[]; notCreated: { kind: string; reason_he: string }[] } {
  const artifacts: PlannedArtifact[] = [];
  const notCreated: { kind: string; reason_he: string }[] = [];
  const protectedGlobs = Array.from(new Set((discovery.discovery.generated_or_protected_areas ?? []).map((a) => cleanPathFragment(a.path)).filter(Boolean)));
  const settingsExists = existsSync(path.join(workspaceDir, ".claude", "settings.json"));
  const settingsPolicy = boundaries.approved?.existingConfig?.[".claude/settings.json"];
  artifacts.push({
    key: "settings", kind: "settings", path: ".claude/settings.json", action: settingsExists ? (settingsPolicy === "keep" ? "skip" : "update") : "create", loading: "never", writer: "dcc",
    title_he: "הרשאות Claude Code (settings.json)", justification: "Read-deny rules keep build output, vendored code and secrets out of Claude's context (fewer tokens, no leaks); the profile's allow/deny axes and the hook wiring live here. Enforced by the client, zero context cost.",
    consumers: ["implementation", "testing", "review", "deployment"], watchedPaths: [], sourceOfTruth: "boundaries decision (security profile + approved deny rules)", catalogId: "settings",
    notes: settingsExists ? [settingsPolicy === "keep" ? "kept as-is per the boundaries decision" : "merged into the existing file — no existing rule is removed"] : [],
  });
  for (const def of GUARDRAIL_CATALOG) {
    if (!def.isApplicable({ protectedGlobs })) { notCreated.push({ kind: `guardrail:${def.id}`, reason_he: `${def.label_he}: לא נמצאו אזורים מוגנים/מיוצרים ב-Discovery — אין מה להגן עליו.` }); continue; }
    artifacts.push({
      key: `hook:${def.id}`, kind: "guardrail_hook", path: `.claude/hooks/${def.id}.mjs`, action: existsSync(path.join(workspaceDir, ".claude", "hooks", `${def.id}.mjs`)) ? "update" : "create", loading: "never", writer: "dcc",
      title_he: def.label_he, justification: def.description_he, consumers: ["implementation", "testing", "deployment"],
      watchedPaths: def.needsProtectedGlobs ? protectedGlobs : [], sourceOfTruth: "DCC guardrail catalog (reviewed templates)", catalogId: def.id, notes: [],
    });
  }
  if (dccHooksAvailable()) {
    const exists = existsSync(path.join(workspaceDir, ".claude", "hooks", "dcc", "session-start.mjs"));
    artifacts.push({
      key: "dcc_hooks", kind: "dcc_hooks", path: ".claude/hooks/dcc/", action: exists ? "update" : "create", loading: "never", writer: "dcc",
      title_he: "hooks של DCC (תיעוד sessions ו-git)", justification: "SessionStart injects the WorkItem Context Brief; SessionEnd and PostToolUse(Bash) record sessions and git activity on the DCC timeline — 'no silent actions' for every Claude session on this repository. Zero context cost unless a brief exists.",
      consumers: ["requirement", "understanding", "implementation", "review", "future_sessions"], watchedPaths: [], sourceOfTruth: "DCC hooks/ (this DCC instance)", catalogId: "dcc_hooks",
      notes: ["דורש DCC_DEV_EMAIL ו-DCC_HOOK_TOKEN בסביבת כל מפתח (ראו hooks/README.md)"],
    });
  } else notCreated.push({ kind: "dcc_hooks", reason_he: "קבצי ה-hooks של DCC לא נמצאו על מכונת ה-DCC." });
  void scan;
  return { artifacts, protectedGlobs, notCreated };
}

registerStage("plan", async (ctx): Promise<StageOutcome> => {
  const scan = ctx.priorResults.scan as ScanResult | undefined;
  const boundaries = ctx.priorResults.boundaries as BoundariesResult | undefined;
  const discovery = ctx.priorResults.discovery as DiscoveryResult | undefined;
  const confirm = ctx.priorResults.confirm as ConfirmResult | undefined;
  if (!scan || !boundaries?.approved || !discovery) return { status: "Failed", errors: ["scan, boundaries and discovery must complete first"] };

  if (ctx.resumeInput !== undefined) {
    const prior = ctx.ownResult as PlanResult | undefined;
    if (!prior) return { status: "Failed", errors: ["no plan to approve"] };
    const input = ctx.resumeInput as { approvedKeys?: unknown; acknowledgedStaleWarnings?: unknown; note?: unknown };
    if (!Array.isArray(input.approvedKeys) || !input.approvedKeys.every((k) => typeof k === "string")) return { status: "Failed", errors: ["approvedKeys must be a string[]"] };
    const acknowledged = new Set(Array.isArray(input.acknowledgedStaleWarnings) ? (input.acknowledgedStaleWarnings as unknown[]).filter((x): x is string => typeof x === "string") : []);
    const unacknowledged = (prior.staleArtifactWarnings ?? []).filter((w) => !acknowledged.has(w.path));
    if (unacknowledged.length) {
      return { status: "Failed", errors: [`Discovery found ${unacknowledged.length} existing AI artifact(s) outdated or conflicting with the code — acknowledge each one before approving: ${unacknowledged.map((w) => w.path).join(", ")}`] };
    }
    const approvedSet = new Set(input.approvedKeys as string[]);
    const approved: PlannedArtifact[] = prior.artifacts.map((a) => ({ ...a, action: approvedSet.has(a.key) ? (a.action === "skip" ? "create" : a.action) : "skip" }));
    if (!approved.some((a) => a.kind === "claude_md" && a.action !== "skip") && !scan.inventory.summary.hasClaudeMd) {
      return { status: "Failed", errors: ["CLAUDE.md is the one artifact every onboarded repository needs — approve it (or keep the existing one via the boundaries stage)"] };
    }
    await replaceLedger(ctx.clientId, ctx.repoId, ctx.runId, approved);
    const result: PlanResult = { ...prior, approved, approvedAt: new Date().toISOString() };
    const skipped = approved.filter((a) => a.action === "skip").length;
    const note = typeof input.note === "string" ? input.note.trim() : "";
    return { status: "Completed", warnings: skipped ? [`${skipped} פריטים הוסרו מהתוכנית על ידי המשתמש`] : [], result, carryNote: note };
  }

  const prompt = await getActiveOnboardingPrompt("onboarding.v2.plan");
  if (!prompt) return { status: "Failed", errors: ["no active prompt for onboarding.v2.plan — run seed-prompts.ts"] };

  const det = deterministicItems(scan, boundaries, discovery, ctx.workspaceDir);
  const humanKnowledge = JSON.stringify({
    answers: (confirm?.answers ?? []).map((a) => ({ question: confirm?.questions.find((q) => q.id === a.id)?.question_he, answer: a.status === "answered" ? a.answer_he : "UNKNOWN" })),
    corrections: confirm?.corrections ?? null, classificationOverride: boundaries.approved.classificationOverride ?? null, notes: boundaries.approved.notes ?? null,
  });
  const runner = createClaudeCodeRunner();
  const exec = await runner.run({
    runId: ctx.runId, stageKey: "plan", repoId: ctx.repoId, clientId: ctx.clientId, cwd: ctx.workspaceDir,
    promptId: prompt.id, capability: "onboarding_plan", modelOverride: ctx.modelChoices.plan, tools: [...READ_ONLY_TOOLS], denyRules: boundaries.approved.rules,
    jsonSchema: PLAN_SCHEMA as unknown as Record<string, unknown>,
    promptVars: {
      CLASSIFICATION: JSON.stringify(scan.classification ?? {}),
      DISCOVERY: JSON.stringify(discovery.discovery),
      HUMAN_KNOWLEDGE: humanKnowledge,
      INVENTORY: renderInventoryForPrompt(scan.inventory),
      EXISTING_POLICY: JSON.stringify(boundaries.approved.existingConfig),
      MODE: ctx.mode,
      PREVIOUS_ARTIFACTS: ctx.mode === "refresh" ? JSON.stringify(((ctx.previousResults?.plan as PlanResult | undefined)?.approved ?? []).map((a) => ({ key: a.key, path: a.path, kind: a.kind }))) : "(initial onboarding — none)",
    },
    maxTurns: 30, timeoutMs: 600_000,
  });
  if (exec.status !== "Completed" || !exec.json) return { status: "Failed", errors: [exec.errorMessage ?? "plan call did not complete"], claudeExecutionId: exec.executionId };
  const aiPlan = exec.json as AiPlan;
  const norm = normalizeAiItems(aiPlan.artifacts ?? [], scan, boundaries, ctx.workspaceDir);
  const artifacts = [...norm.artifacts, ...det.artifacts];
  const staleArtifactWarnings: StaleArtifactWarning[] = (discovery.discovery.existing_instructions_assessment ?? [])
    .filter((a): a is typeof a & { verdict: "outdated" | "conflicting" } => a.verdict === "outdated" || a.verdict === "conflicting")
    .map((a) => ({ path: a.path, verdict: a.verdict, reason: a.reason }));
  const result: PlanResult = {
    artifacts, notCreated: [...(aiPlan.not_created ?? []), ...det.notCreated], rationale_he: aiPlan.rationale_he, protectedGlobs: det.protectedGlobs, claudeExecutionId: exec.executionId,
    staleArtifactWarnings,
  };
  return { status: "WaitingForUser", warnings: norm.notes, claudeExecutionId: exec.executionId, result };
}, (waiting) => ({
  approvedKeys: (waiting as PlanResult).artifacts.filter((a) => a.action !== "skip").map((a) => a.key),
  // Automation only reaches here with explicit prior consent (the "automatic"
  // preset requires `consent: true`) — auto-acknowledging is that same consent
  // applied to this gate, not a new silent skip.
  acknowledgedStaleWarnings: (waiting as PlanResult).staleArtifactWarnings.map((w) => w.path),
}));

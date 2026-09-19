import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, db, dbKind } from "@dcc/db";
import { users } from "@dcc/db/schema";
import { getActiveOnboardingPrompt, registerPromptVersion } from "./prompts.ts";

/**
 * Idempotent seed for the v2 onboarding prompts. Runnable directly:
 *
 *   npx tsx packages/core/src/repo-onboarding/seed-prompts.ts
 *
 * `seedOnboardingPrompts()` below is also called automatically at API
 * boot against an embedded PGlite database (never a real Postgres) —
 * `dev:reset` wipes prompts along with everything else, and forgetting
 * the manual re-seed step ("no active prompt for onboarding.v2.classify")
 * was recurring friction (see `tasks.md` §6 for the incident). That
 * auto-seed ONLY fills genuinely missing keys — an existing active
 * version, however old, is always left alone; editing a prompt or rolling
 * out a changed one still requires the explicit `SEED_REPLACE=` step
 * below, exactly as before.
 *
 * Every prompt states the same discipline the pipeline enforces: ground
 * every claim in an inspected path, never document what Claude can derive
 * from the code, mark UNKNOWN instead of guessing, keep always-loaded
 * context tiny and push detail to on-demand files.
 */

const PROMPTS: { promptKey: string; stage: string; title: string; body: string }[] = [
  {
    promptKey: "onboarding.v2.classify",
    stage: "scan",
    title: "Classify the repository from scan signals",
    body: `Classify this repository for AI onboarding. You have NO tools: work only from the structured scan below. Do not guess file contents.

REPOSITORY SCAN (deterministic: languages with lines/complexity, build systems, frameworks, CI, tests, docs, top-level entries):
{{REPOSITORY_SCAN}}

WHAT ALREADY EXISTS (documentation and AI-tool configuration found in the repository):
{{INVENTORY}}

Determine: repository_type (what kind of system this is, in one line), architecture_shape, legacy_indicator, detected_technology_stack, detected_domains (business domains visible from names — say "unknown" rather than invent), complexity (low/medium/high, from real size and complexity numbers), documentation_maturity, testing_maturity, discovery_areas_required (which parts deserve a targeted read), discovery_areas_not_required (what can safely be skipped and why), uncertainties, confidence.
Write summary_he in Hebrew: 2-3 sentences a non-technical stakeholder understands.

Return only the JSON object.`,
  },
  {
    promptKey: "onboarding.v2.discover",
    stage: "discovery",
    title: "Targeted discovery + coverage + questions (one read-only pass)",
    body: `Perform targeted repository discovery for AI onboarding. You are read-only (Read/Grep/Glob). Mode: {{MODE}}.

Classification:
{{CLASSIFICATION}}

Scan facts:
{{REPOSITORY_SCAN}}

What already exists (read these FIRST — never re-describe what a maintained file already says well):
{{INVENTORY}}

From the team:
{{HUMAN_NOTES}}

On a refresh run only — paths changed since the previous onboarding (focus there; keep unchanged parts of the previous model unless evidence contradicts them):
{{CHANGED_PATHS}}

Previous operating model (refresh only):
{{PREVIOUS_MODEL}}

Do, in this order:
1. COVERAGE: read the existing README/docs/AGENTS.md/CLAUDE.md/other-agent rules. For each area — purpose, architecture, component_boundaries, build_process, testing, integrations, deployment, generated_code_boundaries, critical_constraints — say COVERED / PARTIAL / MISSING and cite the source files. Existing well-written documentation is a source of truth to point at, not to rewrite.
2. OPERATING MODEL: inspect representative and structurally important files only (entry points, manifests, the biggest modules, one example per pattern). Never attempt full comprehension; never list every class or file. Identify: components (with paths), entry_points (with how to run), boundaries, key_flows, integrations (system, direction, where implemented, compatibility constraints), generated_or_protected_areas (generated code, vendored code, infrastructure, sensitive), build_test commands (only ones you found in scripts/manifests/CI — set confidence honestly; never invent a command), constraints (repository-specific, non-obvious, with evidence), where_to_look (for common task types: "add an API endpoint", "change a data model", "fix a plugin", … → the paths), and existing_instructions_assessment.
   existing_instructions_assessment covers EVERY existing AI-facing artifact from the inventory — not only CLAUDE.md/AGENTS.md/rules, but also every existing skill, agent, settings.json, and any docs/*.md file that a CLAUDE.md, rule, or skill already cites by name as a knowledge source (e.g. a "Where to look" pointer, an "architecture" doc, an old docs/ai/*.md left from a previous onboarding). For each one: read it and spot-check its concrete, checkable claims — a referenced file/class/method path, a glob pattern, a security/config guarantee — against files you actually inspected. Assign: keep (claims you checked still hold, nothing to change) / merge (accurate but incomplete — safe to add to) / outdated (a specific claim no longer matches the code — name the mismatch) / conflicting (a claim is directly contradicted by something you found — e.g. a documented "secrets are never hardcoded" guarantee next to an actual hardcoded secret). reason must cite the concrete evidence, never a guess from the filename or topic alone. Do this for every such artifact you can check within budget, even ones that look well-maintained — existence and topical relevance are not accuracy.
3. UNKNOWNS: anything you could not determine safely goes in unknowns — do not guess.
4. QUESTIONS: at most 10 high-value questions ONLY a person can answer (external consumers not visible in the repo, business-critical areas, legacy restrictions, backward-compatibility requirements, historical decisions, areas that must not be modified, operational ownership, production constraints). Never ask something answerable by reading more code. question_he and why_it_matters_he in Hebrew; ids q1..q10.

Every repository-specific conclusion must cite a path you actually inspected (evidence_paths). Do not modify any file. Return only the JSON object.`,
  },
  {
    promptKey: "onboarding.v2.plan",
    stage: "plan",
    title: "Propose the artifact plan (justify every file)",
    body: `Decide which AI-enablement artifacts this repository is justified in having. Mode: {{MODE}}. You may Read/Grep/Glob briefly to check a specific fact; do not re-discover the repository.

Classification:
{{CLASSIFICATION}}

Operating model from discovery:
{{DISCOVERY}}

Verified human knowledge (answers from the team; "UNKNOWN" means nobody knows — never fill it in):
{{HUMAN_KNOWLEDGE}}

What already exists:
{{INVENTORY}}

The team's decision for each existing configuration file (keep = do not touch; merge = add only what is missing; replace = regenerate):
{{EXISTING_POLICY}}

Artifacts from the previous onboarding (refresh only — propose "update" only for artifacts the changes actually affect, "skip" for the rest):
{{PREVIOUS_ARTIFACTS}}

How Claude Code loads things (this is what your plan must optimize for):
- CLAUDE.md is loaded into EVERY session. Target 40-80 lines, hard maximum 120. Longer files reduce instruction adherence. It is a map, not an encyclopedia: purpose in 2-3 lines, build/test commands Claude cannot guess, hard constraints and gotchas, repository etiquette, and pointers to the on-demand files by name. Never directory trees, dependency lists, file-by-file descriptions, generic advice, or anything derivable by reading the code.
- .claude/skills/<name>/SKILL.md loads ON DEMAND: only its description (~1 line) is in context every session; the body loads when the task matches. Use knowledge_skill for repository knowledge that is only sometimes needed (a repository map with where-to-look, integrations, verified critical context). Use workflow_skill only for a recurring, error-prone, repository-specific multi-step procedure with evidence it recurs.
- .claude/rules/<topic>.md with paths: globs loads only when Claude works with matching files. Use for conventions bound to a clear area (generated code, migrations, a plugin folder). A rule without paths loads every session — do not propose one.
- A nested CLAUDE.md in a subdirectory loads when Claude reads files there. Propose only for a genuinely separate subsystem with its own conventions (monorepo package, separate app).
- agent (.claude/agents) — almost never justified at onboarding; propose only with a concrete, recurring isolated task.

For EVERY candidate answer the ten questions in the justification: what problem it solves, who consumes it and at which lifecycle stages (requirement/understanding/planning/implementation/testing/review/deployment/future_sessions), how often, does it reduce rediscovery, is the information already available elsewhere (then point, don't copy), can it go stale, what is its source of truth, how it is maintained, could the problem be solved more simply. If a candidate cannot justify itself, put it in not_created with the reason in Hebrew — an explicit "not created" is a valid, expected outcome.

Rules for items:
- exactly one claude_md item (path from the inventory if it exists, else CLAUDE.md), action create or update — skip ONLY when an existing CLAUDE.md itself has the policy keep. AGENTS.md is NOT loaded by Claude Code: when it exists, CLAUDE.md is still required and simply starts with @AGENTS.md, adding only what is Claude-specific;
- knowledge/workflow skills: skill_name (lowercase-hyphen), skill_description (≤ 200 characters, lead with the words a request would contain, e.g. "Where things live in this repo: ..."), optional skill_paths globs, disable_model_invocation true for workflows with side effects;
- rules: rule_paths globs that match real files;
- watched_paths: the repository paths whose change would make this artifact stale (used for refresh detection);
- title_he in Hebrew; justification in English, concrete, citing paths.

Return only the JSON object.`,
  },
  {
    promptKey: "onboarding.v2.generate",
    stage: "generate",
    title: "Draft the approved artifacts (content only — DCC writes the files)",
    body: `Draft the content of the approved artifacts below. Mode: {{MODE}}. You are read-only: return the content in the JSON result; DCC writes the files, adds provenance and frontmatter metadata, and commits. Do NOT write, edit, or run anything.

APPROVED ARTIFACTS (key, kind, path, action, justification, skill/rule frontmatter DCC will enforce, max_lines):
{{ARTIFACTS}}

Operating model (your evidence — cite paths from it; do not re-discover):
{{DISCOVERY}}

Verified human knowledge ("UNKNOWN" = nobody knows; write "unknown — ask the team" rather than inventing):
{{HUMAN_KNOWLEDGE}}

Classification:
{{CLASSIFICATION}}

AGENTS.md:
{{AGENTS_MD}}

Reviewer feedback to apply in this pass (empty on the first pass):
{{REVIEW_NOTE}}

Writing rules — these are enforced by validation, not suggestions:
- Facts only from the operating model, the human knowledge, or a file you read now. Every command must be one discovery confirmed; label its confidence when not high. No invented paths.
- Do not document what Claude can derive by reading code: no directory trees, no dependency lists, no class/function inventories, no framework tutorials, no generic best practices, no personality instructions.
- Point instead of copy: reference existing docs and the on-demand files by name; do not paste their content.
- Claude Code strips block-level HTML comments from CLAUDE.md before loading it; DCC adds its own provenance comment — do not add one.
- claude_md (max_lines applies): "# <repo name>", 2-3 lines of purpose, "## Commands" (build/test/lint/run that Claude cannot guess, with the cwd when it matters), "## Constraints" (hard rules and gotchas, each one line, most important first), "## Where to look" (3-8 lines pointing to paths or to the skills by name), "## Etiquette" (branching, commits, PRs — only if repository-specific). If the repository has AGENTS.md, the very first line must be @AGENTS.md and you must not repeat its content. For action=update, read the existing file first, keep what is correct and specific, remove what is derivable or stale, and fold in what is missing.
- knowledge_skill: markdown body only (DCC adds the frontmatter). Structure with short headings and bullets; every bullet points at a path. A "repository map" skill lists areas → paths → what lives there, entry points, and where to look for common task types. An "integrations" skill lists system, direction, implementation path, and constraints. A "critical context" skill records the verified human answers and non-obvious constraints, each with its source ("team answer", "path"). Keep within max_lines.
- workflow_skill: body only; numbered steps a session can follow, each with the exact command or path; the trigger sentence first.
- rule: body only (DCC adds the paths frontmatter). Conventions specific to those paths, each with the reason; ≤ max_lines.
- nested_claude_md: same rules as claude_md but only what differs from the root.
- Write user-facing prose in English (code identifiers stay as-is); notes_he in Hebrew.

Return only the JSON object: {"files":[{"key","path","content","notes_he"}], "summary_he", "skipped":[{"key","reason_he"}]}. Every approved key must appear in files or in skipped.`,
  },
  {
    promptKey: "onboarding.v2.validate",
    stage: "validate",
    title: "Review the generated artifacts against the code",
    body: `Review the repository's freshly generated AI-enablement artifacts. You are read-only. Do not modify any file.

Artifacts to review (read each one from the repository):
{{ARTIFACT_PATHS}}

Deterministic checks DCC already ran (do not repeat them; use them as context):
{{CHECKS}}

Read the artifacts, then verify their claims against the code (open the files they point at, check that commands exist in scripts/manifests, that paths exist, that constraints match what the code does). Report:
- contradiction: a statement the code contradicts (cite the evidence path);
- unsupported_claim: a statement with no evidence in the repository;
- duplication: content that repeats another artifact or a maintained README/doc instead of pointing at it;
- generic_filler: advice that is not repository-specific;
- missing_critical: a durable, non-obvious fact discovery established that no artifact records;
- broken_reference: a path or command that does not exist.
Severity high = a future session would act wrongly; medium = wasted time or confusion; low = polish.
overall_status: FAIL if any high-severity issue, WARN if medium, else PASS. strengths_he: 2-4 things done well, in Hebrew. problem_he and recommended_correction_he in Hebrew.

Return only the JSON object.`,
  },
  {
    promptKey: "onboarding.v2.refresh",
    stage: "refresh",
    title: "Judge whether repository changes make the artifacts stale",
    body: `Deterministic staleness signals fired for this repository's AI-enablement artifacts. Judge whether the changes MATERIALLY affect them. You are read-only.

Previous analyzed commit: {{OLD_COMMIT}}
Current commit: {{NEW_COMMIT}}

Changed paths:
{{CHANGED_PATHS}}

Artifacts DCC maintains (path, kind, watched_paths):
{{ARTIFACTS}}

Signals:
{{SIGNALS}}

Read the artifacts and the relevant changed files. Decide update_required (true only if an artifact now states something wrong, misses a new command/constraint/integration/boundary, or references something gone). impacted_artifacts = paths to regenerate; required_updates_he = what must change, in Hebrew, one line each; evidence = paths. Do not propose regenerating an artifact the changes don't touch. reason_he in Hebrew.

Return only the JSON object.`,
  },
];

/** Finds the configured dev user; on the embedded PGlite database only, an
 *  absent one is auto-created (same dev convenience as `actingUser()` in
 *  `apps/api/src/context.ts`) so this can run standalone, before the API
 *  has ever handled a request — exactly the state right after `dev:reset`. */
const AUTO_SEED_EMAIL = "system@dcc.local";
async function resolveSeedingUser(): Promise<string> {
  const email = process.env.SEED_USER_EMAIL ?? "you@dcc.local";
  const [dev] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (dev) return dev.id;
  if (dbKind !== "pglite") throw new Error("no dev user found — set SEED_USER_EMAIL or run the app once first");
  // The synthetic seed user itself may already exist from an earlier boot
  // (this only runs when the configured dev user hasn't shown up yet) —
  // reuse it rather than re-insert and hit the unique email constraint.
  const [existingSeedUser] = await db.select().from(users).where(eq(users.email, AUTO_SEED_EMAIL)).limit(1);
  if (existingSeedUser) return existingSeedUser.id;
  const [created] = await db.insert(users).values({ entraOid: `seed-${randomUUID()}`, email: AUTO_SEED_EMAIL, displayName: "DCC (auto-seed)" }).returning({ id: users.id });
  return created!.id;
}

/** Registers every prompt in `PROMPTS` that has no active version yet.
 *  `replace` (key set, or `"all"`) additionally re-registers keys that
 *  already have an active version — omit it to only fill gaps, which is
 *  exactly what the boot-time auto-seed does. `log` defaults to silent so
 *  the boot-time call doesn't spam the server log when nothing changes. */
export async function seedOnboardingPrompts(opts: { replace?: Set<string>; log?: (msg: string) => void } = {}): Promise<{ created: number; skipped: number }> {
  const log = opts.log ?? (() => {});
  const replace = opts.replace ?? new Set<string>();
  const userId = await resolveSeedingUser();
  let created = 0, skipped = 0;
  for (const p of PROMPTS) {
    const existing = await getActiveOnboardingPrompt(p.promptKey);
    if (existing && !(replace.has("all") || replace.has(p.promptKey))) {
      log(`  skip (already active v${existing.version}): ${p.promptKey}`);
      skipped++;
      continue;
    }
    const row = await registerPromptVersion({ ...p, by: { userId } });
    log(`  created v${row.version}: ${p.promptKey}`);
    created++;
  }
  return { created, skipped };
}

/** Read-only: which prompt keys have an active DB version whose text no
 *  longer matches the code's `PROMPTS` entry. This is the drift that bit
 *  us live — a code change to a prompt's wording sat inactive because
 *  nobody remembered the exact `SEED_REPLACE=<key>` command, and nothing
 *  said so out loud. Never auto-fixed: the active version might just as
 *  well be someone's deliberate edit made from the Prompts screen, and
 *  silently overwriting that would be exactly the kind of silent action
 *  this system is built to avoid — this only makes the mismatch visible,
 *  by whichever channel the caller logs it to (server boot, a CLI check). */
export async function checkOnboardingPromptDrift(): Promise<{ promptKey: string; activeVersion: number }[]> {
  const drifted: { promptKey: string; activeVersion: number }[] = [];
  for (const p of PROMPTS) {
    const existing = await getActiveOnboardingPrompt(p.promptKey);
    if (existing && existing.body !== p.body) drifted.push({ promptKey: p.promptKey, activeVersion: existing.version });
  }
  return drifted;
}

if (import.meta.main) {
  // SEED_REPLACE=key1,key2 (or "all") registers a NEW version for those
  // keys even when one is active — the way to roll out an edited seed
  // prompt without touching the immutable history.
  const replace = new Set((process.env.SEED_REPLACE ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  try {
    const { created, skipped } = await seedOnboardingPrompts({ replace, log: console.log });
    console.log(`\n${created} created, ${skipped} already active.`);
  } catch (e) {
    console.log((e as Error).message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

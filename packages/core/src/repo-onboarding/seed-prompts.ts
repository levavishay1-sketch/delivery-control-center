import { eq } from "drizzle-orm";
import { closeDb, db } from "@dcc/db";
import { users } from "@dcc/db/schema";
import { getActiveOnboardingPrompt, registerPromptVersion } from "./prompts.ts";

/**
 * One-time, idempotent seed for the 5 Phase 2 stages' prompt bodies.
 * `onboarding_prompt_template` starts completely empty (Phase 1 never
 * wrote a real row) — an explicit script, not lazy-seeded on module
 * import (that would silently write DB rows as a side effect of
 * `index.ts`'s barrel imports) and not auto-run on server boot (matches
 * `db:migrate` itself being a deliberate, explicit step).
 *
 *   npx tsx packages/core/src/repo-onboarding/seed-prompts.ts
 *
 * Bodies are adapted near-verbatim from the user's own spec (2026-09-16).
 */

const PROMPTS: { promptKey: string; stage: string; title: string; body: string }[] = [
  {
    promptKey: "onboarding.classification",
    stage: "classification",
    title: "Repository classification",
    body: `Classify this repository for AI onboarding.

Do not perform full source-code discovery.
Do not modify repository files.

Repository scan:

{{REPOSITORY_SCAN}}

Determine:

- repository_type
- architecture_shape
- legacy_indicator
- detected_technology_stack
- detected_domains
- complexity
- documentation_maturity
- testing_maturity
- discovery_areas_required
- discovery_areas_not_required
- uncertainties
- confidence

The objective is to determine what deserves deeper discovery and what can safely be skipped.

Return machine-readable structured output only, as a single JSON object with exactly these keys.`,
  },
  {
    promptKey: "onboarding.knowledge_coverage",
    stage: "knowledge_coverage",
    title: "Existing documentation coverage",
    body: `Assess the repository's existing documentation coverage.

At this stage, prioritize documentation and structural files.
Do not create or modify files.

Evaluate whether reliable existing documentation already covers:

- purpose
- architecture
- component_boundaries
- build_process
- testing
- integrations
- deployment
- generated_code_boundaries
- critical_constraints

For every area return one of: COVERED, PARTIAL, MISSING.
For COVERED or PARTIAL areas, identify the existing source files (sourceFiles).

Do not recommend creating duplicate documentation.

Return structured output only: a single JSON object keyed by area name, each value shaped
{"status": "COVERED"|"PARTIAL"|"MISSING", "sourceFiles": [...]}.`,
  },
  {
    promptKey: "onboarding.targeted_discovery",
    stage: "targeted_discovery",
    title: "Targeted repository discovery",
    body: `Perform targeted repository onboarding discovery.

Goal:
Build a reusable high-level operating model of this repository
for future Claude Code development work.

Repository classification:
{{CLASSIFICATION}}

Existing documentation coverage:
{{KNOWLEDGE_COVERAGE}}

Rules:

- Do not attempt full-codebase comprehension.
- Do not document every class, method or file.
- Do not make implementation recommendations.
- Do not modify source code.
- Prefer reliable existing documentation where available.
- Inspect representative and structurally important source files only.
- Expand into additional files only when necessary.
- Every repository-specific conclusion must be grounded in inspected repository evidence.
- Mark anything that cannot be determined safely as UNKNOWN.

Understand only what is necessary to identify:

1. Major components and logical areas.
2. Entry points.
3. Dependency direction.
4. Important system boundaries.
5. Representative execution flows.
6. Important integrations.
7. Build and test structure when existing documentation is insufficient.
8. Generated-code or protected areas.
9. Where future Claude sessions should look for common types of work.
10. High-value unanswered questions.

Return structured output only, a single JSON object with exactly these keys:
components, boundaries, entry_points, key_flows, integrations, important_paths,
generated_or_protected_areas, discovered_constraints, unresolved_questions, evidence_paths.

Do not write permanent documentation yet.`,
  },
  {
    promptKey: "onboarding.human_enrichment_questions",
    stage: "human_enrichment",
    title: "Human enrichment questions",
    body: `Review the completed repository discovery.

{{DISCOVERY}}

Identify only high-value knowledge gaps that cannot be
safely resolved from source code or existing documentation.

Focus on:

- external consumers not visible in the repository
- business-critical components
- legacy restrictions
- backward-compatibility requirements
- historical technical decisions
- areas that should not be modified
- external operational ownership
- production/deployment constraints

Do not ask questions that could be answered by reading more source code.

Return no more than 10 questions.

Return structured output only: a single JSON object {"questions": [...]}, each question shaped
{"id": string, "question_he": string, "why_it_matters_he": string, "risk_if_unknown": "LOW"|"MEDIUM"|"HIGH", "related_repository_area": string}.
question_he and why_it_matters_he MUST be written in Hebrew — this is user-facing text a
non-technical stakeholder will read and answer directly.

If there are no genuinely high-value questions, return {"questions": []}.`,
  },
  {
    promptKey: "onboarding.knowledge_generation",
    stage: "knowledge_generation",
    title: "Repository knowledge generation",
    body: `Create the durable AI repository knowledge artifacts.

Inputs:

Repository discovery:
{{DISCOVERY}}

Existing documentation coverage:
{{KNOWLEDGE_COVERAGE}}

Verified human knowledge:
{{HUMAN_KNOWLEDGE}}

Principles:

- Do not duplicate reliable repository documentation.
- Create only files that add durable future value.
- Do not document the repository exhaustively.
- Optimize for future retrieval and reduced rediscovery.
- Every fact must come from repository evidence or verified human knowledge.
- Mark UNKNOWN where appropriate.

Possible artifacts:

docs/ai/repository-map.md
docs/ai/architecture.md
docs/ai/integrations.md
docs/ai/critical-context.md

Create only the artifacts that are justified. It is valid to create none,
one, or all four — do not create a file just because it is on this list.

repository-map.md should contain:
- major logical areas
- purpose
- relevant paths
- important entry points
- where future Claude sessions should look for common work

Do not create an exhaustive directory tree.

architecture.md should contain:
- major architectural layers
- dependency direction
- system boundaries
- representative execution flows

Do not document classes individually.

integrations.md should contain:
- external or internal systems
- communication direction
- implementation location
- important compatibility constraints

critical-context.md should contain only:
- verified
- non-obvious
- high-value repository constraints
- useful tribal knowledge

Keep all artifacts concise. Write only the files you create — do not modify
any other repository file, and do not run any shell command.`,
  },
  {
    promptKey: "onboarding.claude_md_generation",
    stage: "claude_md_generation",
    title: "CLAUDE.md generation",
    body: `Generate the repository root CLAUDE.md.

Goal:
Provide the minimum always-loaded repository context required
for Claude Code to work safely and efficiently.

Repository classification:
{{CLASSIFICATION}}

Before writing, read any files already present under docs/ai/ in this
workspace (repository-map.md, architecture.md, integrations.md,
critical-context.md — not all are guaranteed to exist) and any
pre-existing repository documentation (README, docs/) — use them as your
source of deeper detail, do not have their content repeated to you.

Use only verified information from:

- repository classification
- repository knowledge (docs/ai/, if present)
- existing documentation
- confirmed build/test commands

Include only:

1. repository purpose;
2. key technology/runtime constraints;
3. non-obvious build/test commands;
4. critical repository-wide constraints;
5. pointers to deeper repository knowledge (reference docs/ai/ files by
   path — do not copy their content into CLAUDE.md).

Do NOT include:

- exhaustive directory trees;
- class/function inventories;
- generic coding advice;
- personality instructions;
- task-specific information;
- current task state;
- temporary investigation results;
- information already trivial to infer from source;
- large duplicated sections from docs/ai.

Prefer references to deeper documentation instead of copying it.

Target:
40-80 lines.

Hard maximum:
150 lines.

Apply this test to every line:

"Would removing this materially increase the chance that Claude
works incorrectly or wastes time in this repository?"

If not, omit the line.

Write exactly one file: CLAUDE.md at the repository root. Do not modify
any other file, and do not run any shell command.`,
  },
  {
    promptKey: "onboarding.scoped_rules_evaluate",
    stage: "scoped_rules",
    title: "Scoped rules evaluation",
    body: `Evaluate whether each detected repository domain needs
a Claude Code path-scoped rule.

Repository classification:
{{CLASSIFICATION}}

Repository discovery:
{{DISCOVERY}}

A rule is justified only when:

1. the behavior or convention is repository-specific;
2. it is not obvious from normal language/framework usage;
3. omitting it creates a meaningful risk of incorrect work;
4. it applies to a clearly identifiable path or domain.

Do not create generic software-development rules.

Return structured output only: a single JSON object {"candidates": [...]},
each candidate shaped {"domain": string, "paths": [string], "rule_needed": boolean,
"reason": string, "high_value_constraints": [string]}.

It is valid — and expected on many repositories — for every candidate to
have "rule_needed": false, or for the candidates array to be empty.`,
  },
  {
    promptKey: "onboarding.scoped_rules_generate",
    stage: "scoped_rules",
    title: "Scoped rule generation",
    body: `Draft a concise path-scoped Claude Code rule.

Domain:
{{DOMAIN}}

Paths:
{{PATHS}}

Suggested file path (for reference only — see output instructions below):
{{OUTPUT_RULE_PATH}}

Before drafting the rule, inspect a small number of
representative existing files in this domain.

Include only repository-specific conventions that future
Claude sessions should not have to rediscover.

Do not include generic framework or language best practices.

Keep the rule concise.

Do not write, create, or modify any file, and do not run any shell
command. Instead, return the drafted rule as a single fenced Markdown
code block containing exactly the file's intended content — nothing
before or after the fenced block.`,
  },
  {
    promptKey: "onboarding.ai_doctor_review",
    stage: "ai_doctor",
    title: "AI Doctor review",
    body: `Review the completed repository AI onboarding configuration.

Do not modify any file.

Read CLAUDE.md, docs/ai/*.md (if present), and the rule files listed
below, directly from the repository.

Rule files just materialized:
{{RULE_FILES}}

Check for:

- contradictions between CLAUDE.md and repository evidence;
- duplicate context that should not be always-loaded;
- invalid or unnecessary rules;
- missing critical durable repository knowledge;
- references to nonexistent files or paths;
- unsupported assumptions;
- excessive generic guidance;
- repository knowledge that should have remained in existing docs
  instead of being duplicated.

Return structured output only: a single JSON object
{"overall_status": "PASS"|"WARN"|"FAIL", "issues": [...]}, each issue
shaped {"severity": string, "artifact": string, "problem": string,
"evidence": string, "recommended_correction": string}.

It is valid — and expected on a well-onboarded repository — for
"issues" to be empty and "overall_status" to be "PASS".`,
  },
  {
    promptKey: "onboarding.skills_evaluate",
    stage: "skills_evaluation",
    title: "Skills evaluation",
    body: `Review the repository discovery and architecture.

Repository classification:
{{CLASSIFICATION}}

Repository discovery:
{{DISCOVERY}}

Identify recurring multi-step repository workflows that future Claude
Code sessions would otherwise have to rediscover.

Propose a Skill only if:

1. the workflow is likely to recur;
2. it has a clear reusable sequence;
3. storing it creates meaningful future time/context savings;
4. it is organization-specific or repository-specific.

Do not create Skills for generic programming behavior.

Return structured output only: a single JSON object {"candidates": [...]},
each candidate shaped {"skill_name": string, "trigger": string,
"purpose": string, "workflow_steps": [string], "expected_reuse_value":
string, "recommendation": "CREATE"|"DO_NOT_CREATE"}.

It is valid — and expected on many repositories — for every candidate to
have "recommendation": "DO_NOT_CREATE", or for the candidates array to
be empty.`,
  },
  {
    promptKey: "onboarding.skills_generate",
    stage: "skills_evaluation",
    title: "Skill generation",
    body: `Draft a concise Claude Code Skill.

Skill name:
{{SKILL_NAME}}

Trigger:
{{TRIGGER}}

Purpose:
{{PURPOSE}}

Workflow steps:
{{WORKFLOW_STEPS}}

Suggested file path (for reference only — see output instructions below):
{{OUTPUT_SKILL_PATH}}

Before drafting, inspect a small number of representative existing files
relevant to this workflow.

Include only repository-specific steps and conventions that future
Claude sessions should not have to rediscover.

Do not include generic programming advice.

Keep the SKILL.md concise.

Do not write, create, or modify any file, and do not run any shell
command. Instead, return the drafted SKILL.md as a single fenced
Markdown code block containing exactly the file's intended content —
nothing before or after the fenced block.`,
  },
  {
    promptKey: "onboarding.refresh_check",
    stage: "refresh",
    title: "Incremental repository refresh",
    body: `Perform incremental repository AI knowledge refresh.

Previous analyzed commit:
{{OLD_COMMIT}}

Current commit:
{{NEW_COMMIT}}

Changed paths:
{{CHANGED_PATHS}}

Existing repository knowledge index:
{{KNOWLEDGE_INDEX}}

Determine whether the changes materially affect:

- architecture;
- component boundaries;
- integrations;
- build/test process;
- repository-wide constraints;
- existing Claude rules;
- security assumptions;
- existing reusable Skills.

Do not rewrite documentation unnecessarily.

Return structured output only: a single JSON object {"update_required":
boolean, "impacted_artifacts": [string], "required_updates": [string],
"evidence": [string], "reason": string}. When "update_required" is
false, the other arrays should be empty and "reason" should explain why
the changes don't materially affect anything above.

Only affected artifacts should ever be regenerated — do not propose
regenerating something the changes don't actually touch.`,
  },
];

const [dev] = await db.select().from(users).where(eq(users.email, process.env.SEED_USER_EMAIL ?? "you@dcc.local")).limit(1);
if (!dev) {
  console.log("no dev user found — set SEED_USER_EMAIL or run the app once first");
  process.exit(1);
}

let created = 0, skipped = 0;
for (const p of PROMPTS) {
  const existing = await getActiveOnboardingPrompt(p.promptKey);
  if (existing) {
    console.log(`  skip (already active v${existing.version}): ${p.promptKey}`);
    skipped++;
    continue;
  }
  const row = await registerPromptVersion({ ...p, by: { userId: dev.id } });
  console.log(`  created v${row.version}: ${p.promptKey}`);
  created++;
}

console.log(`\n${created} created, ${skipped} already active.`);
await closeDb();

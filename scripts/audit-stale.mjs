#!/usr/bin/env node
// Repo-wide check for old, unused or inconsistent leftovers — the things a
// replaced design leaves behind. Run: `npm run audit:stale`.
// Exit code 1 when something needs fixing; the report says what and where.
// It is heuristic (a name match, not a type-aware analysis), so the checks
// that can false-positive are reports, not failures.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP = new Set(["node_modules", "dist", ".git", ".pgdata", "scratchpad"]);
const norm = (p) => p.split(path.sep).join("/");
function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const all = walk(root).map((p) => norm(path.relative(root, p)));
const text = new Map(all.filter((f) => /\.(ts|tsx|mjs|json|md|sql|css|html)$/.test(f)).map((f) => [f, readFileSync(f, "utf8")]));
const isSrc = (f) => /^(packages|apps)\/[^/]+\/src\/.*\.(ts|tsx|mjs)$/.test(f) && !f.endsWith(".d.ts");

let failures = 0;
const fail = (title, lines) => { failures++; console.log(`\n✗ ${title}`); lines.forEach((l) => console.log("   " + l)); };
const ok = (title) => console.log(`✓ ${title}`);
const note = (title, lines) => { console.log(`\n· ${title}`); lines.forEach((l) => console.log("   " + l)); };

// 1. Compiled output tracked by git inside a package's src/ (stale copies of the .ts next to them).
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const built = tracked.filter((f) => /^packages\/[^/]+\/src\/.*\.(js|js\.map|d\.ts|d\.ts\.map)$/.test(f));
built.length ? fail(`compiled files committed inside packages/*/src (${built.length})`, built.slice(0, 10)) : ok("no compiled output committed inside packages/*/src");

// 2. Names of retired designs. Keep this list growing: when a change replaces a design, add its old names here.
const RETIRED = [
  "workspace_setup", "repository_scan", "knowledge_generation", "claude_md_generation", "scoped_rules", "skills_evaluation",
  "targeted_discovery", "human_enrichment", "user_review", "ai_doctor", "github_pull_request", "repo-ai/", "repository-ai-management",
  "16-stage", "16 stages", "16 → 9", "16 שלבים", "v1 stage", "repository-ai-enablement`", "AiComponents",
  // the nine-stage onboarding pipeline, retired 2026-09-19 (docs/history/repository-onboarding-v2.md)
  "9-stage", "nine-stage", "nine stages", "9 שלבים", "onboarding.v2", "repository-ai-enablement-v2", "repository-ai-reshape-assessment",
  "RepoOnboardingPanel", "stageViews", "seed-prompts", "SEED_REPLACE", "onboardingPromptTemplate", "onboarding_prompt_template",
  "repositoryOnboardingClaudeExecution", "repository_onboarding_claude_execution", "repositoryAiArtifact", "repository_ai_artifact",
  "repositoryProfile", "repository_profile", "legacy_artifact", "staleArtifactWarnings", "existing_instructions_assessment",
  "onboarding_classify", "onboarding_discover", "onboarding_plan", "onboarding_generate", "onboarding_validate", "onboarding_refresh",
  "guardrail-templates", "security-profiles", "settings-adapter", "dcc-hooks.ts", "recoverInterruptedRuns", "checkOnboardingPromptDrift",
  "onboarding_translate", "translateOnboardingScreen", "translateScreenText", "onboarding-terminal-translation", "ob-tr-text",
  // a review approved inside DCC instead of on the host, retired 2026-09-20: the decision is the host's own
  "dcc_approve", "dccApprovedBy", "DCC_APPROVAL", "dccApprovalMark", "dcc-review:approved", "reviewOf(", "אישור פנימי של DCC",
  "repo_ai_profile", "repoAiProfile", "ai_component", "aiComponent", "repo_knowledge_snapshot", "repo_ai_recommendation",
  // three separate cost paths, a routing audit event nothing read, and a summariser that never summarised —
  // retired 2026-09-20 by the one ledger (openspec/changes/claude-in-dcc)
  "recordRunCost", "recordRouting", "model.routed", "modelRouted", "summariseTimeline", "summarise.ts",
  "costAtStart", "costAtEnd", "getCostDetail", "CostDetailModal", "COST_KIND_LABELS", "run-cost-tracking",
];
// Applied migrations are history and cannot be edited; CLAUDE.md quotes examples of what to search for;
// docs/history/ holds the design records the user asked to keep. Everything else — the replacing
// change included — may not name a retired design.
const HISTORY = /^(CLAUDE\.md$|scripts\/audit-stale\.mjs$|packages\/db\/migrations\/|docs\/history\/|docs\/architecture-review\.md$)/;
const re = new RegExp(RETIRED.map((r) => r.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|"));
const stale = [];
for (const [f, t] of text) {
  if (HISTORY.test(f)) continue;
  t.split("\n").forEach((line, i) => { if (re.test(line)) stale.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`); });
}
stale.length ? fail(`names of retired designs still mentioned (${stale.length}) — remove them, git history is the record`, stale.slice(0, 15)) : ok("no names of retired designs anywhere");

// 3. OpenSpec: every change declares a Status, and none claims "not implemented/backlog" while all its tasks are ticked.
const spec = [];
for (const d of readdirSync("openspec/changes")) {
  const p = `openspec/changes/${d}/proposal.md`;
  if (!existsSync(p)) { spec.push(`${d}: no proposal.md`); continue; }
  const status = readFileSync(p, "utf8").match(/^Status:\s*(.+)/m)?.[1] ?? "";
  if (!status) spec.push(`${d}: no "Status:" line`);
  const tasks = `openspec/changes/${d}/tasks.md`;
  if (status && /backlog|proposed|not (started|implemented)/i.test(status) && existsSync(tasks)) {
    const t = readFileSync(tasks, "utf8");
    const done = (t.match(/\[x\]/g) ?? []).length, open = (t.match(/\[ \]/g) ?? []).length;
    if (done > 0 && open === 0) spec.push(`${d}: says "${status.slice(0, 40)}…" but all ${done} tasks are ticked`);
  }
}
spec.length ? fail("OpenSpec status out of step with the tasks", spec) : ok("every OpenSpec change has an accurate Status");

// 4. Source files nothing imports. Entry points are excluded by name; a report, not a failure.
const ENTRY = /(server|main|index|smoke|demo|seed|prove|setup|reset|migrate|scenario|vite-env|guards)/i;
const orphans = all.filter(isSrc).filter((f) => {
  const base = path.basename(f).replace(/\.(ts|tsx|mjs)$/, "");
  if (ENTRY.test(base)) return false;
  const r = new RegExp(`["'/]${base}(\\.(ts|tsx|mjs))?["']`);
  for (const [g, t] of text) if (g !== f && /\.(ts|tsx|mjs|json)$/.test(g) && r.test(t)) return false;
  return true;
});
orphans.length ? note(`source files nothing imports (${orphans.length}) — delete or wire up`, orphans) : ok("no orphaned source files");

// 5. DB tables no application code references. Known-inert tables are listed so a NEW one stands out.
const KNOWN_INERT = new Set(["repo_dependency"]);
const schemaFiles = all.filter((f) => /^packages\/db\/src\/schema\/.*\.ts$/.test(f));
const tables = [];
for (const f of schemaFiles) for (const m of text.get(f).matchAll(/export const (\w+)\s*=\s*pgTable\(\s*["'](\w+)["']/g)) tables.push({ id: m[1], name: m[2] });
const unusedTables = tables.filter((t) => {
  const r = new RegExp(`\\b${t.id}\\b`);
  for (const [g, x] of text) if (!schemaFiles.includes(g) && !/migrations/.test(g) && /\.(ts|tsx)$/.test(g) && r.test(x)) return false;
  return true;
});
const newUnused = unusedTables.filter((t) => !KNOWN_INERT.has(t.name));
newUnused.length ? fail("tables no application code references (new)", newUnused.map((t) => t.name)) : ok(`no new unreferenced tables (${unusedTables.length} known-inert)`);

// 6. Dependencies declared but never imported (per package; @types/*, @dcc/* and root tooling excluded).
const depIssues = [];
for (const pj of tracked.filter((f) => /(^|\/)package\.json$/.test(f) && f !== "package.json")) {
  const j = JSON.parse(readFileSync(pj, "utf8"));
  const dir = path.dirname(pj) + "/";
  const code = [...text].filter(([g]) => g.startsWith(dir) && /\.(ts|tsx|mjs|css|html)$/.test(g)).map(([, t]) => t).join("\n") + JSON.stringify(j.scripts ?? {});
  const unused = Object.keys({ ...j.dependencies, ...j.devDependencies }).filter((d) => !d.startsWith("@types/") && !d.startsWith("@dcc/") && !code.includes(d));
  if (unused.length) depIssues.push(`${pj}: ${unused.join(", ")}`);
}
depIssues.length ? note("dependencies never imported — verify, then remove", depIssues) : ok("no unused dependencies");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);

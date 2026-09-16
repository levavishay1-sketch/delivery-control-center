import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db, withTenant } from "@dcc/db";
import { repo, repoAiProfile, repoKnowledgeSnapshot } from "@dcc/db/schema";
import { ensureCheckout, git, runClaudeRaw, type RunMeta } from "../ai-assist.ts";
import { getPromptByKey, renderPrompt } from "../prompts.ts";
import { appendRepoAiEvent } from "./events.ts";
import { scanRepoDir } from "./inventory.ts";
import { getApprovedDenyRules } from "./permissions.ts";

/**
 * P2 — Repository Knowledge Baseline (`repository-ai-management` §6.4,
 * §8). Deliberately NOT a copy of the repo's Skills/Agents/MCPs (those
 * stay inventoried, not duplicated — see `inventory.ts`): this describes
 * the repository itself, for future Task executions to reuse instead of
 * rediscovering it from zero.
 *
 * Storage decision (2026-09-14, "keep the architecture flexible enough
 * that the final physical storage/materialization strategy can be
 * adjusted later"): kept as structured rows in `repo_knowledge_snapshot`
 * only, NOT committed into the client's own repository — the spec's
 * default of writing `docs/ai-knowledge/*.md` into the repo would mean
 * DCC committing generated files into a client's codebase under some
 * author identity, which is a materially bigger decision than the
 * spec's own appendix treats it as. Left for an explicit future call;
 * this shape can migrate to committed Markdown later without changing
 * any caller, since every reader goes through `getRepoKnowledge`.
 *
 * Model call is READ-ONLY (`write: false`/plan mode — Read/Grep/Glob
 * only), matching the spec's own "P2 changes no business code".
 */

const SECTION_KEYS = ["overview", "architecture", "components", "delivery", "risks"] as const;
export type KnowledgeSections = Record<(typeof SECTION_KEYS)[number], string>;

/** Shallow structural map — manifests, top two directory levels, config
 *  files — the "read deterministic evidence before spending model
 *  context on rediscovery" input the spec's P2 process asks for. Never
 *  reads full file contents; Claude reads whatever it needs itself via
 *  its own Read/Grep/Glob tools once given this starting map. */
function structuralMap(root: string): string {
  const manifestNames = ["package.json", "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "*.csproj", "*.sln", "Gemfile", "go.mod", "composer.json"];
  const lines: string[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 2 || !existsSync(dir)) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      let isDir: boolean;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      const relPath = rel ? `${rel}/${name}` : name;
      if (isDir) { lines.push(`${"  ".repeat(depth)}${relPath}/`); walk(full, relPath, depth + 1); }
      else if (manifestNames.some((m) => m === name || (m.includes("*") && name.endsWith(m.slice(1))))) lines.push(`${"  ".repeat(depth)}${relPath}  ← manifest`);
    }
  };
  walk(root, "", 0);
  return lines.slice(0, 400).join("\n");
}

function buildKnowledgePrompt(input: { repoName: string; mode: string; structure: string; inventorySummary: string; previousSections: Partial<KnowledgeSections> | null; diffSummary: string | null }) {
  const prev = input.previousSections
    ? `\nEXISTING KNOWLEDGE (from the previous snapshot — update only what the evidence below shows has changed; keep the rest as-is unless it's now wrong):\n${SECTION_KEYS.map((k) => `--- ${k} ---\n${input.previousSections![k] ?? "(none)"}`).join("\n\n")}\n`
    : "";
  return [
    `You are building a durable KNOWLEDGE BASELINE for the repository "${input.repoName}" (mode: ${input.mode}) — a reusable understanding future AI-assisted work on this repo can load instead of rediscovering it from scratch.`,
    "",
    "STRUCTURAL MAP (top-level, depth-limited — read further into the tree yourself with Read/Grep/Glob only where you need to verify a specific conclusion; do not read the entire repository):",
    input.structure || "(empty or unreadable)",
    "",
    "AI-CONFIGURATION ALREADY PRESENT (deterministic scan, not your job to re-detect):",
    input.inventorySummary || "(none detected)",
    prev,
    input.diffSummary ? `\nFILES CHANGED SINCE THE PREVIOUS SNAPSHOT:\n${input.diffSummary}\n` : "",
    "RULES:",
    "- Do not change any file. This is read-only investigation.",
    "- Every material claim should be grounded in something you actually read — do not invent architecture, ownership or conventions from folder names alone.",
    "- Mark anything you're not confident about as such in `risks` rather than stating it as fact.",
    "- Keep each section concise and genuinely reusable — not exhaustive documentation.",
    "- Write every section IN HEBREW (code identifiers, paths, and technology names stay as they are, wrapped in single backticks like `this`).",
    "",
    "FORMATTING — this is read by a human, not just fed back into another prompt, so structure it like a real document, not a wall of text. Use this exact lightweight markdown, nothing fancier:",
    "  `## Sub-heading`     — break a section into named sub-topics whenever it covers more than one thing (e.g. inside `architecture`: one `## ` per layer; inside `components`: one `## ` per top-level folder/module; inside `delivery`: one `## ` per concern like CI/CD, package management, build).",
    "  `- item`             — a bullet list, for any set of genuinely distinct facts/items (module names, conventions, examples). A bullet may have nested sub-bullets directly under it, indented two spaces, for detail specific to that one item — do not nest more than one level deep.",
    "  `1. item`            — an ordered list, specifically for `risks`: one numbered item per distinct risk/unknown, each a short title-like first clause followed by 1-3 sentences of explanation (and nested bullets under it if it has multiple concrete sub-points).",
    "  blank line           — paragraph break. Never write one long dense paragraph — 2-4 sentences per paragraph, one idea per paragraph or bullet, no chaining unrelated facts with semicolons.",
    "  `` `code` ``           — wrap every code identifier, file path, project name, or technical name.",
    "- `overview` is prose (paragraphs, maybe one bullet list) — it does not need `## ` headings. `architecture`, `components`, and `delivery` SHOULD use `## ` headings once there's more than one sub-topic. `risks` SHOULD be a `1. ` numbered list once there's more than one risk.",
    "",
    "Respond with EXACTLY these 5 sections, each starting with its own marker line on its own — no JSON, no markdown fence, no other text before the first marker or after the last section:",
    "===OVERVIEW===\n(free text)\n===ARCHITECTURE===\n(free text)\n===COMPONENTS===\n(free text)\n===DELIVERY===\n(free text)\n===RISKS===\n(free text)\n===COVERAGE===\n(comma-separated: which of the 5 sections above you actually produced/updated with real evidence this run, vs. left unchanged — e.g. \"overview,architecture\")",
  ].filter(Boolean).join("\n");
}

/** Long free-text Hebrew paragraphs are a known bad fit for strict JSON —
 *  a live run this session produced a section long enough that the model's
 *  own JSON-string escaping broke ("Expected ',' or '}' ... " parse
 *  failure), even with an explicit JSON-only instruction. A delimiter
 *  format sidesteps that failure mode entirely instead of trying to win
 *  a JSON-escaping discipline fight for paragraph-length content. */
function parseKnowledgeResponse(text: string): Partial<KnowledgeSections> & { coverage?: string[] } {
  const markers = ["OVERVIEW", "ARCHITECTURE", "COMPONENTS", "DELIVERY", "RISKS", "COVERAGE"];
  const out: Record<string, string> = {};
  for (let i = 0; i < markers.length; i++) {
    const name = markers[i]!;
    const re = new RegExp(`===\\s*${name}\\s*===\\s*\\n?([\\s\\S]*?)(?=\\n===|$)`, "i");
    const m = text.match(re);
    if (m) out[name.toLowerCase()] = m[1]!.trim();
  }
  return {
    overview: out.overview, architecture: out.architecture, components: out.components, delivery: out.delivery, risks: out.risks,
    coverage: out.coverage ? out.coverage.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  };
}

export async function generateRepoKnowledge(
  repoId: string,
  by: { userId: string },
  opts: { mode?: "CREATE_BASELINE" | "UPDATE_BASELINE" | "REASSESS_EXISTING" } = {},
) {
  const [r] = await db.select().from(repo).where(eq(repo.id, repoId)).limit(1);
  if (!r) throw new Error("repo not found");
  if (!r.clientId) throw new Error("ניהול AI זמין רק ל-repository ששייך ללקוח יחיד");
  const clientId = r.clientId;

  // Same lock as `/init` (bootstrap.ts) — no exploration of the repo,
  // knowledge generation included, runs before step 2's deny rules exist.
  const denyRules = await getApprovedDenyRules(clientId, repoId);
  if (denyRules === null) throw new Error("שלב 2 (אישור הרשאות קריאה) עדיין לא הושלם — לא ניתן לבנות ידע לפניו");

  const dir = await ensureCheckout({ ...r, localPath: null });
  if (!dir) throw new Error(`לא הצלחתי להביא עותק של ${r.name}`);
  const commit = (await git(["rev-parse", "HEAD"], dir)).out.trim() || null;

  const [previous] = await withTenant(clientId, (tx) =>
    tx.select().from(repoKnowledgeSnapshot).where(eq(repoKnowledgeSnapshot.repoId, repoId)).orderBy(desc(repoKnowledgeSnapshot.generatedAt)).limit(1),
  );
  const mode = opts.mode ?? (previous ? "UPDATE_BASELINE" : "CREATE_BASELINE");

  let diffSummary: string | null = null;
  if (previous?.analyzedCommit && commit && previous.analyzedCommit !== commit) {
    const d = await git(["diff", "--name-status", previous.analyzedCommit, commit], dir);
    diffSummary = d.out.trim().slice(0, 3000) || null;
  }

  const inventory = scanRepoDir(dir);
  const inventorySummary = inventory.map((c) => `- [${c.type}] ${c.name}${c.description ? ` — ${c.description}` : ""} (${c.detectedPath})`).join("\n");

  const tmpl = await getPromptByKey("repo_ai.knowledge_baseline");
  const vars = {
    REPO_NAME: r.name, MODE: mode,
    STRUCTURE: structuralMap(dir), INVENTORY: inventorySummary,
    DIFF: diffSummary ?? "",
  };
  const prompt = tmpl
    ? renderPrompt(tmpl.body, vars)
    : buildKnowledgePrompt({
        repoName: r.name, mode, structure: structuralMap(dir), inventorySummary,
        previousSections: (previous?.sections as Partial<KnowledgeSections>) ?? null, diffSummary,
      });

  let meta: RunMeta | undefined;
  const { text } = await runClaudeRaw(dir, prompt, {
    timeoutMs: 300_000, maxTurns: 30, model: tmpl?.defaultModel || "sonnet", onMeta: (m) => { meta = m; }, denyRules,
  });
  const res = parseKnowledgeResponse(text);

  const sections: KnowledgeSections = {
    overview: res.overview ?? (previous?.sections as KnowledgeSections | undefined)?.overview ?? "",
    architecture: res.architecture ?? (previous?.sections as KnowledgeSections | undefined)?.architecture ?? "",
    components: res.components ?? (previous?.sections as KnowledgeSections | undefined)?.components ?? "",
    delivery: res.delivery ?? (previous?.sections as KnowledgeSections | undefined)?.delivery ?? "",
    risks: res.risks ?? (previous?.sections as KnowledgeSections | undefined)?.risks ?? "",
  };

  const [snapshot] = await withTenant(clientId, (tx) =>
    tx.insert(repoKnowledgeSnapshot).values({
      repoId, clientId, analyzedCommit: commit, previousSnapshotId: previous?.id ?? null,
      mode, freshnessStatus: "fresh", sections, coverage: res.coverage ?? [],
      model: meta?.model ?? tmpl?.defaultModel ?? null,
      costUsd: meta?.costUsd != null ? String(meta.costUsd) : null,
      inputTokens: meta?.inputTokens ?? null, outputTokens: meta?.outputTokens ?? null, durationMs: meta?.durationMs ?? null,
      generatedBy: by.userId,
    }).returning(),
  );

  await withTenant(clientId, (tx) =>
    tx.update(repoAiProfile).set({ lastKnowledgeSnapshotId: snapshot!.id, state: "MANAGED", updatedAt: new Date() }).where(eq(repoAiProfile.repoId, repoId)),
  );

  await appendRepoAiEvent({
    clientId, repoId, type: "knowledge.generated",
    payload: { snapshotId: snapshot!.id, mode, commit, coverage: res.coverage ?? [], costUsd: meta?.costUsd ?? null },
    actorUserId: by.userId,
  });

  return snapshot!;
}

/** Read-only — never regenerates. What a Repository's execution profile
 *  resolver (`resolve.ts`) and the UI both load. */
export async function getRepoKnowledge(clientId: string, repoId: string) {
  const [row] = await withTenant(clientId, (tx) =>
    tx.select().from(repoKnowledgeSnapshot).where(eq(repoKnowledgeSnapshot.repoId, repoId)).orderBy(desc(repoKnowledgeSnapshot.generatedAt)).limit(1),
  );
  return row ?? null;
}

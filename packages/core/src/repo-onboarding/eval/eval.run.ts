/**
 * The measurement as a standalone research script: a repository checkout, a
 * baseline commit, the files that would be delivered — and every task of the
 * bank runs in both arms, graded, into one JSON and one Hebrew Markdown.
 *
 *   npm run -w @dcc/core eval:onboarding -- --repo <dir> --baseline <sha> --files <list.json> [--from <dir>]
 *       [--runs 1] [--extra] [--max-usd 30] [--out <path-without-extension>] [--processes <json>] [--only key,key]
 *
 * Its ledger goes to a scratch database of its own (DCC_PGLITE_DIR, set before
 * anything that opens the database loads — the API's PGlite is never touched),
 * so it is safe while the API is up. `--repo` may be the shared clone under
 * ~/.dcc-repos/<repoId> or any checkout; the arms are detached worktrees of it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name: string) => args.includes(`--${name}`);
const repoDir = opt("repo");
const baseline = opt("baseline");
const filesArg = opt("files");
if (!repoDir || !baseline || !filesArg) {
  console.error("usage: eval:onboarding --repo <dir> --baseline <sha> --files <list.json> [--from <dir>] [--runs 1] [--extra] [--max-usd 30] [--out <path>] [--processes <json>] [--only a,b]");
  process.exit(2);
}
const fromDir = opt("from", repoDir)!;
const runs = Number(opt("runs", "1"));
const maxUsd = Number(opt("max-usd", "30"));
const outBase = opt("out", path.join(process.cwd(), `onboarding-eval-${Date.now()}`))!;
const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const files = JSON.parse(readFileSync(filesArg, "utf8")) as string[];
const processes = opt("processes") ? (JSON.parse(readFileSync(opt("processes")!, "utf8")) as unknown[]) : [];

// A world of its own, before anything that reads DCC_PGLITE_DIR or the CLI path loads.
const work = mkdtempSync(path.join(os.tmpdir(), "dcc-eval-"));
process.env.DCC_PGLITE_DIR = path.join(work, "pgdata");
execFileSync(process.execPath, ["src/dev/setup.ts"], { cwd: fileURLToPath(new URL("../../../../db/", import.meta.url)), env: process.env, stdio: "ignore" });

const dbm = await import("@dcc/db");
const schema = await import("@dcc/db/schema");
const { diagnoseRepository } = await import("../diagnose.ts");
const { factsForJudge } = await import("../profile.ts");
const { evalContext, evalTasksFor } = await import("./tasks.ts");
const { runEval } = await import("./run.ts");
const { renderEvalMarkdown } = await import("./report.ts");
const { renderPrompt, requirePrompt } = await import("../../prompts.ts");
const { runtimeDir } = await import("../workspace.ts");

const stamp = Date.now();
const [dev] = await dbm.db.insert(schema.users).values({ entraOid: `eval-${stamp}`, email: `eval-${stamp}@example.com`, displayName: "Eval" }).returning();
const [client] = await dbm.db.insert(schema.client).values({ name: `eval-${stamp}` }).returning();

// A stored diagnosis (`--profile`, e.g. a run's `profile.raw`) stands in for a fresh one; either way the tools
// on this host are probed when the diagnosis does not carry them, so the bank knows what can run here.
const profile = opt("profile") ? (JSON.parse(readFileSync(opt("profile")!, "utf8")) as Awaited<ReturnType<typeof diagnoseRepository>>) : await (async () => { console.log(`diagnosing ${fromDir} …`); return diagnoseRepository(fromDir, path.basename(fromDir)); })();
const env = profile.environment as typeof profile.environment & { tools?: Record<string, string | null> };
if (!env.tools) {
  const which = (cmd: string): string | null => { try { return execFileSync(process.platform === "win32" ? "where.exe" : "which", [cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0]?.trim() ?? null; } catch { return null; } };
  env.tools = Object.fromEntries(["msbuild", "dotnet", "vstest.console", "npm", "node", "pac", "python", "pytest", "gradle", "mvn", "go", "cargo"].map((c) => [c, which(c)]));
  env.tools.dotnet_msbuild = env.tools.dotnet ?? null;
}
const tasks = evalTasksFor(profile, processes as never[]).filter((t) => !only || only.includes(t.key));
console.log(`${tasks.length} tasks: ${tasks.map((t) => t.key).join(", ")}`);
const ctx = evalContext(profile, processes as never[]);
const armsRoot = path.join(runtimeDir(`eval-${stamp}`), "arms");
mkdirSync(armsRoot, { recursive: true });

const result = await runEval({
  ledger: { clientId: client!.id, userId: dev!.id, trigger: "button", screen: "onboarding", meta: { research: true } },
  sharedDir: repoDir, baselineSha: baseline, delivered: { fromDir, files }, armsRoot, workDir: path.join(work, "judge"),
  tasks, ctx, hints: factsForJudge(profile), runsPerTask: runs, extraRunWhenDiffer: flag("extra"), maxUsd,
  capability: "onboarding_eval",
  render: async (key, vars) => renderPrompt((await requirePrompt(key)).body, vars),
  log: (l) => console.log(l),
});

const out = { at: new Date().toISOString(), repo: fromDir, baseline, files, tasks: tasks.map((t) => ({ key: t.key, title_he: t.title_he, kind: t.kind, prompt: t.prompt, graders: t.graders, judge: t.judge })), runs: result.runs, summary: result.summary, stoppedAtCap: result.stoppedAtCap, spentUsd: result.spentUsd };
mkdirSync(path.dirname(outBase), { recursive: true });
writeFileSync(`${outBase}.json`, JSON.stringify(out, null, 2));
writeFileSync(`${outBase}.md`, renderEvalMarkdown(result.summary, `מדידת ההטמעה — ${path.basename(fromDir)} (${baseline.slice(0, 7)})`) + `\nנעצר בתקרה: ${result.stoppedAtCap ? "כן" : "לא"} · הוצאה: $${result.spentUsd}\n`);
console.log(`\nwritten: ${outBase}.json, ${outBase}.md — spent $${result.spentUsd}${result.stoppedAtCap ? " (stopped at the cap)" : ""}`);
await dbm.closeDb();
if (!existsSync(`${outBase}.json`)) process.exit(1);

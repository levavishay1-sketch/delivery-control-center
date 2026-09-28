/**
 * What the development prove scripts share: a world of their own — a fresh
 * PGlite directory, a bare git repository as the host with DCC's cache clone
 * of it, a requirement linked to it — and a stand-in for the Claude CLI
 * (DCC_CLAUDE_BIN) that answers in the real output format without calling a
 * model. Safe while the API is up: nothing here touches its database or clones.
 *
 * The stand-in: a development prompt writes the file its instruction names
 * ("write b.txt"). A checks prompt reports each check — a check that "needs
 * x.txt" waits for it when x.txt is not in the branch, a check that says
 * "tamper" changes a tracked file (which DCC must put back), everything else
 * passes. The build is never the stand-in's: the repository is a real npm
 * package whose own build script fails while "broken.txt" is there, and DCC
 * runs it directly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAKE = `
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
let raw = "", done = false;
// A run DCC can steer sends its prompt as one stream-json line and keeps stdin open.
process.stdin.on("data", (d) => {
  raw += d;
  const first = raw.split("\\n")[0];
  if (!done && raw.includes("\\n") && first.startsWith("{")) { done = true; answer(JSON.parse(first).message.content[0].text); }
}).on("end", () => { if (!done) { done = true; answer(raw); } });
function answer(rawInput) {
  // A lean call carries its whole instruction as the system prompt file; the stdin message is only "answer now".
  const sysIdx = process.argv.indexOf("--system-prompt-file");
  const input = sysIdx >= 0 ? readFileSync(process.argv[sysIdx + 1], "utf8") + "\\n" + rawInput : rawInput;
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt: input }) + "\\n");
  let out;
  let plain = null;
  if (input.includes("You are VERIFYING a change in this repository")) {
    const block = input.split("do not skip any:\\n")[1]?.split("\\n\\n")[0] ?? "";
    const checks = block.split("\\n").map((l) => l.match(/^#(\\d+)(?: \\[(\\w+)\\])?: (.*)$/)).filter(Boolean).map((m) => {
      const seq = Number(m[1]), kind = m[2], text = m[3];
      if (/tamper/.test(text)) writeFileSync("base.txt", "tampered\\n");
      const needs = text.match(/needs (\\S+)/)?.[1];
      if (needs && !existsSync(needs)) return { seq, passed: false, detail: needs + " is not here", likelyCause: "dependency_missing" };
      return { seq, passed: true, detail: "ok" + (kind ? " (" + kind + ")" : ""), likelyCause: null };
    });
    out = { summary: "checked", checks };
  } else if (input.includes("You are mapping how work is actually done in the repository")) {
    // The onboarding's processes call: two processes, one step that needs external information, one recurring procedure.
    out = { processes: [
      { key: "release", title: "Release a version", source: "docs", evidence: ["package.json build script"], steps: [
        { key: "build", title: "Build the package", what: "run npm run build, then check the output", agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "a fixed procedure" } },
        { key: "publish", title: "Publish", what: "publish to the registry", agentTest: { judgment: false, externalInfo: true, readsALot: false, parallel: false, failsToday: false, why: "needs registry credentials" } } ] },
      { key: "edit_base", title: "Change base.txt", source: "git", evidence: ["base.txt in every commit"], steps: [
        { key: "edit", title: "Edit base.txt", what: "edit the file", agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: "one action" } } ] } ] };
  } else if (input.includes("You are working in this repository with no instructions")) {
    // A trial task: honest about tests, right about the build, lost on entry points (so one failure reaches the plan).
    const task = input.split("TASK:\\n")[1]?.split("\\n")[0] ?? "";
    plain = /automated tests/.test(task) ? "I looked for a test runner. There is no test framework in this repository.\\nRESULT: there are no automated tests"
      : /built\\?/.test(task) || /build/.test(task) ? "package.json has a build script.\\nRESULT: npm run build"
      : /entry points/.test(task) ? "I could not find any entry point.\\nRESULT: could not find"
      : "Looked around.\\nRESULT: done";
  } else if (input.includes("You judge whether an AI coding agent did a task correctly")) {
    out = /could not find/.test(input) ? { passed: false, failureKind: "missing_fact", detail: "הסוכן לא מצא את נקודת הכניסה" } : { passed: true, failureKind: null, detail: "עבר" };
  } else if (input.includes("You search the web for ready-made components")) {
    out = { sources: [{ kind: "lsp", name: "typescript-lsp", url: "https://github.com/anthropics/claude-plugins-official/tree/main/plugins/typescript-lsp", publisher: "Anthropic", description: "Language server plugin", tags: ["npm", "typescript"], official: true, why: "navigation", toolCount: null, readOnly: null, license: "MIT", lastActivity: "2026-09" },
      { kind: "mcp", name: "Random MCP", url: "https://github.com/someone/random-mcp", publisher: "someone", description: "73 tools", tags: ["npm"], official: true, why: "everything", toolCount: 73, readOnly: false, license: null, lastActivity: "2020-01" }] };
  } else if (input.includes("You review a plan for setting up an AI coding agent")) {
    out = { missing: [{ kind: "doc", title: "מסמך הרצה", why: "אין README ואין הוראות הרצה" }], redundant: [] };
  } else if (input.includes("You are the editor who decides what goes into the AI instructions")) {
    // The scan of the /init draft: a section and a line taken, a permission left to the person, a settings file
    // DCC does not take whole, a section naming paths the code does not have, one of ours marked redundant.
    out = { verdict: "merge", summary: "הטיוטה מדויקת יותר על מבנה הריפו; ההנחיה הכללית שלה לא נלקחה.",
      compare: [{ topic: "מבנה", ours: "רשימת תיקיות", theirs: "הקובץ היחיד והפקודה", better: "theirs", why: "base.txt ו-npm run build קיימים" }],
      items: [
        { decision: "take", form: "section", title: "איפה הדברים", target: "AGENTS.md", heading: "Where things are", text: "The one file is \`base.txt\`; build with \`npm run build\`.", origin: "theirs", need: "ניסיון נקודות הכניסה נכשל", evidence: "base.txt", alternative: "אין בשלנו", verify: "ניסיון חוזר", cost: "שתי שורות" },
        { decision: "take", form: "line", title: "build לפני סיום", target: "AGENTS.md", text: "Run \`npm run build\` before saying a change is done", origin: "merged", need: "אין CI", evidence: "package.json", alternative: "סקריפט האימות", verify: "ה-build gate", cost: "שורה", replaces: ["reviewer_1_doc", "no_such_card"] },
        { decision: "ask", form: "line", title: "פרסום אחרי מיזוג", target: "AGENTS.md", text: "Publish to the npm registry after every merge", origin: "theirs", need: "תהליך release", evidence: "תהליך release", alternative: "ידני", verify: "—", cost: "הרשאת פרסום", question: "מותר לסוכן לפרסם ל-npm? ידוע: יש תהליך release. חסר: מדיניות" },
        { decision: "take", form: "file", title: "הגדרות", target: ".claude/settings.json", text: "{}", origin: "theirs" },
        { decision: "take", form: "section", title: "ארכיטקטורה", target: "AGENTS.md", heading: "Architecture", text: "Handlers are in \`src/api/\`, models in \`lib/models.ts\`, and \`base.txt\` is the data.", origin: "theirs" } ],
      drop_ours: [{ key: "reviewer_1_doc", why: "הסעיף מהטיוטה מכסה את זה" }], reject: [{ what: "Use async/await everywhere", why: "כללי — לא ספציפי לריפו" }] };
  } else if (input.includes("A person asked, in their own words, for a helper")) {
    out = { kind: "skill", title: "skill: עדכון base.txt", what: "נוהל לעדכון הקובץ", questions: [{ key: "when", question_he: "מתי מריצים?", default: "אחרי כל שינוי" }] };
  } else if (input.includes("You write ONE file for an AI coding agent's setup")) {
    const format = input.split("FORMAT REQUIRED:\\n")[1] ?? "";
    plain = /SKILL\\.md/.test(format) ? "---\\nname: update-base\\ndescription: Updates base.txt the way this repository does it. Use whenever base.txt must change.\\nallowed-tools: Read, Grep, Glob, Bash\\n---\\n\\n# Update base.txt\\n\\n1. Open \`base.txt\`.\\n2. Change the line.\\n3. Run \`npm run build\` and make sure it passes.\\n4. Do not touch \`package.json\`.\\n\\nThis skill exists because base.txt is in every commit of the history, and the build is the only gate.\\n"
      : /subagent definition/.test(format) ? "---\\nname: publish-checker\\ndescription: Checks a release before it is published; call it when a version is about to go out.\\ntools: Glob, Grep, Read, Bash\\nmodel: sonnet\\n---\\n\\nYou check a release.\\n\\n- [ ] \`package.json\` version bumped\\n- [ ] \`npm run build\` passes\\n- [ ] \`base.txt\` unchanged\\n- [ ] no \`broken.txt\` present\\n\\nOutput: a JSON array of findings {file, line, severity, note}.\\n"
      : /One paragraph/.test(format) ? "A small package used to prove DCC's onboarding: one file, base.txt, and a build script that fails while broken.txt exists."
      : /body of the Markdown document/.test(format) ? "## Layout\\n\\n- \`base.txt\` — the one file\\n- \`package.json\` — the build script\\n\\n## Run\\n\\n\`npm run build\`\\n"
      : /checklist/.test(format) ? "- [ ] \`base.txt\` unchanged unless the task says so\\n- [ ] \`npm run build\` passes\\n- [ ] no \`broken.txt\`\\n- [ ] \`package.json\` version bumped when releasing\\n- [ ] the change is small\\n- [ ] no secrets"
      : "content";
  } else {
    const task = input.split("TASK — this is the instruction, follow it exactly:\\n")[1]?.split("\\n")[0] ?? "";
    const file = task.match(/write (\\S+)/)?.[1];
    if (file) writeFileSync(file, "made by " + task + "\\n");
    out = { summary: "did " + task, filesChanged: file ? [file] : [], testsRun: null, followUps: [], affectedConsumers: [] };
  }
  const result = plain ?? JSON.stringify(out);
  process.stdout.write(JSON.stringify({ type: "result", result, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } }) + "\\n", () => process.exit(0));
}
`;

export async function proveKit(name: string) {
  const work = mkdtempSync(path.join(os.tmpdir(), `dcc-prove-${name}-`));
  process.env.DCC_PGLITE_DIR = path.join(work, "pgdata");
  const log = path.join(work, "claude-calls.ndjson");
  writeFileSync(log, "");
  process.env.FAKE_CLAUDE_LOG = log;
  const fake = path.join(work, "fake-claude.mjs");
  writeFileSync(fake, FAKE);
  if (process.platform === "win32") {
    writeFileSync(path.join(work, "fake-claude.cmd"), `@node "${fake}" %*\r\n`);
    process.env.DCC_CLAUDE_BIN = path.join(work, "fake-claude.cmd");
  } else {
    writeFileSync(path.join(work, "fake-claude"), `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 });
    process.env.DCC_CLAUDE_BIN = path.join(work, "fake-claude");
  }
  // A fresh database, migrated by the same script dev:setup runs.
  execFileSync(process.execPath, ["src/dev/setup.ts"], { cwd: fileURLToPath(new URL("../../db/", import.meta.url)), env: process.env, stdio: "ignore" });

  // Imported only now: the CLI path and the database directory are read when these modules load.
  const dbm = await import("@dcc/db");
  const schema = await import("@dcc/db/schema");
  const { eq } = await import("drizzle-orm");
  const core = await import("./index.ts");
  const ai = await import("./ai-assist.ts");

  const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=prove", "-c", "user.email=prove@example.com", ...args], { cwd, encoding: "utf8" }).trim();
  let failed = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "✓" : "✕"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
    if (!ok) failed++;
  };

  const stamp = Date.now();
  const [dev] = await dbm.db.insert(schema.users).values({ entraOid: `prove-${stamp}`, email: `prove-${stamp}@example.com`, displayName: "Prove" }).returning();
  const by = { userId: dev!.id };
  const [c] = await dbm.db.insert(schema.client).values({ name: `prove-${name}-${stamp}` }).returning();
  const clientId = c!.id;
  const [wi] = await dbm.withTenant(clientId, (tx) => tx.insert(schema.workitem).values({ clientId, ownerId: dev!.id, key: "PRV-1", title: name, type: "story", phase: "building" }).returning());
  const workitemId = wi!.id;

  // A bare repository as the host, and the cache clone DCC would have made of it.
  const origin = path.join(work, "origin.git");
  g(work, "init", "--bare", "--initial-branch=main", origin);
  const seed = path.join(work, "seed");
  g(work, "clone", "--quiet", origin, seed);
  writeFileSync(path.join(seed, "base.txt"), "base\n");
  // A real package with a real build: it fails while broken.txt is in the tree.
  writeFileSync(path.join(seed, "package.json"), JSON.stringify({ name: "prove-repo", private: true, scripts: { build: "node -e \"process.exit(require('fs').existsSync('broken.txt') ? 1 : 0)\"" } }, null, 2));
  g(seed, "add", "-A"); g(seed, "commit", "--quiet", "-m", "base"); g(seed, "push", "--quiet", "origin", "HEAD:main");
  const r = await core.linkRepoToClient({ clientId, name: `prove-repo-${stamp}`, gitUrl: "https://example.invalid/prove.git", by });
  const cache = path.join(os.homedir(), ".dcc-repos", r.id);
  g(work, "clone", "--quiet", origin, cache);
  await core.linkRepoToRequirement({ clientId, workitemId, repoId: r.id, by });

  const T = schema.task;
  let seq = 0;
  /** A task under the requirement (a check when `parent` is given), inserted as the breakdown would. */
  const addTask = async (intent: string, prompt: string, o: { parent?: string; dependsOn?: string[] } = {}) => {
    const [row] = await dbm.withTenant(clientId, (tx) => tx.insert(T).values({
      clientId, workitemId, seq: ++seq, intent, prompt, origin: "ai", kind: o.parent ? "check" : "task", parentTaskId: o.parent ?? null,
    }).returning());
    for (const d of o.dependsOn ?? []) await dbm.withTenant(clientId, (tx) => tx.insert(schema.taskDependency).values({ clientId, taskId: row!.id, dependsOnTaskId: d, reason: "prove" }));
    return row!;
  };
  /** Keeps the local seq counter ahead of rows the code added itself (the checks DCC adds). */
  const syncSeq = async () => {
    const all = await dbm.withTenant(clientId, (tx) => tx.select({ seq: T.seq }).from(T).where(eq(T.workitemId, workitemId)));
    seq = Math.max(seq, ...all.map((x) => x.seq));
  };
  const row = async (id: string) => (await dbm.withTenant(clientId, (tx) => tx.select().from(T).where(eq(T.id, id)).limit(1)))[0]!;
  /** What creating the task in TFS does: a work item id on it, and on its checks (they are recorded on the task's item). */
  const inTfs = async (id: string) => {
    const adoId = 90_000 + (await row(id)).seq;
    await dbm.withTenant(clientId, (tx) => tx.update(T).set({ linkedAdoId: adoId }).where(eq(T.id, id)));
    await dbm.withTenant(clientId, (tx) => tx.update(T).set({ linkedAdoId: adoId }).where(eq(T.parentTaskId, id)));
  };
  const checksOf = async (id: string) => (await dbm.withTenant(clientId, (tx) => tx.select().from(T).where(eq(T.parentTaskId, id)))).sort((a, b) => a.seq - b.seq);
  const develop = async (taskId: string) => {
    const { runId } = await core.startFlowRun({ clientId, workitemId, kind: "implement", taskId, by });
    for (let i = 0; i < 480; i++) {
      const [run] = await dbm.db.select().from(schema.flowRun).where(eq(schema.flowRun.id, runId)).limit(1);
      if (run && run.state !== "running") {
        if (run.state !== "done") throw new Error(`run ${run.state}: ${run.error}`);
        await syncSeq();
        return run;
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("run did not finish");
  };
  /** Every call the stand-in answered since `from`, in order. */
  const calls = (from = 0) => readFileSync(log, "utf8").split("\n").filter(Boolean).slice(from).map((l) => JSON.parse(l) as { args: string[]; prompt: string });
  const callCount = () => calls().length;
  const branchOf = (t: { seq: number; intent: string }) => ai.taskBranchName("PRV-1", t);

  const finish = async () => {
    await dbm.closeDb();
    rmSync(cache, { recursive: true, force: true });
    if (existsSync(work)) rmSync(work, { recursive: true, force: true });
    console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
    process.exit(failed ? 1 : 0);
  };

  return { work, cache, clientId, workitemId, by, g, check, addTask, syncSeq, row, inTfs, checksOf, develop, calls, callCount, branchOf, finish, core, ai, dbm, schema, eq };
}


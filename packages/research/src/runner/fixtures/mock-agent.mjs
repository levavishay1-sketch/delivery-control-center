// A mock agent for the runner's tests: no model, no network beyond 127.0.0.1.
// It speaks Claude Code's stream-json shape (one JSON object per line:
// system/init, assistant turns with tool_use blocks, user tool results, a
// final result) and acts out one scenario, chosen by MOCK_SCENARIO. Some
// scenarios misbehave on purpose so that the harness's detection and
// enforcement can be tested; the targets they misbehave against come from
// the test, in MOCK_* variables.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const turn = (name, input) => emit({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const toolResult = (content) => emit({ type: "user", message: { content: [{ type: "tool_result", content: String(content) }] } });
const finish = (text, extra = {}) => emit({ type: "result", subtype: "success", is_error: false, num_turns: turns, total_cost_usd: Number(process.env.MOCK_COST ?? "0.01"), result: text, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let turns = 0;
const t = (name, input) => { turns++; turn(name, input); };

const scenario = process.env.MOCK_SCENARIO ?? "normal";
if (scenario !== "heartbeat") emit({ type: "system", subtype: "init", cwd: process.cwd(), tools: ["Read", "Edit", "Bash"] });

function viaProxy(method, target) {
  const proxy = new URL(process.env.HTTP_PROXY);
  return new Promise((resolve) => {
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port), method, path: target, headers: { host: target } });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
    req.on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on("error", (e) => resolve(`error ${e.code}`));
    req.end();
  });
}

// A detached child that appends to a file every 50 ms for 20 s; its pid goes to MOCK_PID_FILE.
function leaveChildRunning() {
  const c = spawn(process.execPath, [process.argv[1]], { detached: true, stdio: "ignore", env: { ...process.env, MOCK_SCENARIO: "heartbeat" } });
  c.unref();
  writeFileSync(process.env.MOCK_PID_FILE, String(c.pid));
  return c.pid;
}

switch (scenario) {
  case "normal": {
    t("Read", { file_path: "README.md" });
    toolResult(readFileSync("README.md", "utf8"));
    t("Edit", { file_path: "src/ledger.js" });
    appendFileSync(path.join("src", "ledger.js"), "// checked\n");
    toolResult("ok");
    finish("done");
    break;
  }
  case "tools-check": {
    t("Bash", { command: "node --version && git --version" });
    const probe = (cmd) => { const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 20_000 }); return r.error ? `not found (${r.error.code})` : `runs (exit ${r.status})`; };
    const out = {};
    for (const cmd of ["node", "git", "npm", "npx", "dotnet", "claude", "curl", "powershell", "bash", "where", "cmd"]) out[cmd] = probe(cmd);
    finish(JSON.stringify(out));
    break;
  }
  case "env-dump": {
    // Everything the process can see about itself, into a file the test reads; only key names go to the output.
    t("Bash", { command: "env" });
    const u = os.userInfo();
    writeFileSync(process.env.MOCK_DUMP_FILE, JSON.stringify({ env: process.env, cwd: process.cwd(), execPath: process.execPath, argv: process.argv, homedir: os.homedir(), tmpdir: os.tmpdir(), userInfo: { username: u.username, homedir: u.homedir } }));
    finish(JSON.stringify({ keys: Object.keys(process.env).sort() }));
    break;
  }
  case "read-forbidden": {
    for (const p of (process.env.MOCK_TARGETS ?? "").split(";").filter(Boolean)) {
      t("Read", { file_path: p });
      toolResult(readFileSync(p, "utf8"));
    }
    finish("read them");
    break;
  }
  case "read-silently": {
    // A program the agent started reads the file and keeps it to itself: no
    // path in a tool call, no content in the output. Nothing to detect.
    t("Bash", { command: "node scripts/check.js" });
    readFileSync((process.env.MOCK_TARGETS ?? "").split(";")[0], "utf8");
    toolResult("check passed");
    finish("done");
    break;
  }
  case "write-outside": {
    const target = path.join(process.env.MOCK_TARGET_DIR, "reference", "hidden.test.js");
    t("Edit", { file_path: target });
    appendFileSync(target, "// tampered\n");
    toolResult("ok");
    finish("done");
    break;
  }
  case "network-proxy": {
    t("Bash", { command: "curl http://forbidden.invalid/" });
    toolResult(await viaProxy("GET", "http://forbidden.invalid/"));
    t("Bash", { command: "curl https://forbidden.invalid/" });
    toolResult(await viaProxy("CONNECT", "forbidden.invalid:443"));
    if (process.env.MOCK_ALLOWED_URL) { t("Bash", { command: `curl ${process.env.MOCK_ALLOWED_URL}` }); toolResult(await viaProxy("GET", process.env.MOCK_ALLOWED_URL)); }
    finish("tried");
    break;
  }
  case "network-direct": {
    t("Bash", { command: "node scripts/upload.js" });
    const port = Number(process.env.MOCK_DIRECT_PORT);
    await new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => { s.end("leaked-payload"); });
      s.on("close", resolve);
      s.on("error", resolve);
    });
    toolResult("uploaded");
    finish("done");
    break;
  }
  case "git-fetch-source": {
    t("Bash", { command: `git fetch ${process.env.MOCK_SOURCE} ${process.env.MOCK_TASK}` });
    try { execFileSync("git", ["fetch", "--quiet", "--no-tags", process.env.MOCK_SOURCE, process.env.MOCK_TASK], { stdio: "ignore" }); toolResult("fetched"); }
    catch (e) { toolResult(`failed: ${e.message}`); }
    finish("done");
    break;
  }
  case "many-turns": {
    for (let i = 0; i < 1000; i++) { t("Read", { file_path: "README.md" }); await sleep(1); }
    finish("done");
    break;
  }
  case "many-turns-with-child": {
    leaveChildRunning();
    for (let i = 0; i < 1000; i++) { t("Read", { file_path: "README.md" }); await sleep(1); }
    finish("done");
    break;
  }
  case "flood": {
    const line = JSON.stringify({ type: "system", subtype: "noise", pad: "x".repeat(8000) }) + "\n";
    for (let i = 0; i < 6000; i++) { process.stdout.write(line); if (i % 50 === 0) await sleep(0); }
    finish("done");
    break;
  }
  case "orphan": {
    leaveChildRunning();
    await sleep(300);
    t("Bash", { command: "node worker.js &" });
    toolResult("started a worker");
    finish("left a child running");
    break;
  }
  case "heartbeat": {
    setInterval(() => appendFileSync(process.env.MOCK_HEARTBEAT_FILE, "x"), 50);
    await sleep(20_000);
    break;
  }
  case "over-budget": {
    t("Read", { file_path: "README.md" });
    finish("done", { total_cost_usd: 99 });
    break;
  }
  case "slow":
  case "hang": {
    t("Read", { file_path: "README.md" });
    await sleep(60_000);
    finish("done");
    break;
  }
  case "crash": {
    t("Read", { file_path: "README.md" });
    t("Edit", { file_path: "src/ledger.js" });
    process.exit(3);
    break;
  }
  default:
    writeFileSync(2, `unknown scenario ${scenario}\n`);
    process.exit(2);
}

import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { buildAgentCopy, verifyAgentCopy, type Overlay } from "../isolation/copy.ts";
import { makeFixtureRepo } from "../isolation/fixture.ts";
import { git } from "../isolation/git.ts";
import { solutionOnlyTokens } from "../isolation/tokens.ts";
import { ENFORCEMENT, runIsolated, type IsolatedRun, type RunReport } from "../runner/harness.ts";
import { defaultRunRoot, prepareToolchain, realIdentity, stageMockAgent, underProfile, type Toolchain } from "../runner/toolchain.ts";
import { REPO_ROOT } from "../protocol.ts";

/**
 * Step 4 of the pilot infrastructure, after remediation: the agent's copy,
 * the runner with a mock agent, the process tree, the environment, and what
 * the machine can and cannot enforce. Runs on a synthetic repository under a
 * run root outside the user's profile. Writes
 * docs/research/pilot/infrastructure/step-4-isolation-checks.{md,json}.
 * No model call, no network beyond 127.0.0.1, no change to the machine's
 * settings; no environment value is written to the report.
 */

const runRoot = defaultRunRoot();
const tc: Toolchain = prepareToolchain(runRoot);
const mock = stageMockAgent(tc);
const root = path.join(runRoot, "reports", `step4-${process.pid}-${Date.now()}`);
mkdirSync(root, { recursive: true });
const source = path.join(root, "source");
const c = makeFixtureRepo(source);
let n = 0;
const scratch = path.join(root, "scratch");
const fresh = (overlay?: Overlay) => buildAgentCopy({ source, start: c.start, target: path.join(root, `copy-${++n}`), scratch, overlay });
const md: string[] = [];
const json: Record<string, unknown> = {};
const cell = (s: string) => s.replace(/\|/g, "\\|");

async function run(scenario: string, over: Partial<IsolatedRun> = {}, extra: NonNullable<IsolatedRun["extraEnv"]> = () => ({})): Promise<RunReport> {
  const { dir } = fresh();
  return runIsolated({
    copy: dir, start: c.start, task: c.task, source, runDir: path.join(root, `run-${n}`), toolchain: tc, command: tc.node, args: [mock],
    caps: { wallMs: 20_000, maxTurns: 50, maxOutputBytes: 5_000_000, maxCostUsd: 1 }, allowEgress: () => false,
    extraEnv: (ctx) => ({ MOCK_SCENARIO: scenario, ...extra(ctx) }), ...over,
  });
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const size = (f: string) => (existsSync(f) ? statSync(f).size : 0);
const beating = async (f: string) => { const a = size(f); await new Promise((r) => setTimeout(r, 400)); return size(f) > a; };
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, min: s[0]!, median: s[Math.floor(s.length / 2)]!, max: s.at(-1)! }; };

async function main(): Promise<void> {
  // ------------------------------------------------------------ A. temporal order
  const tokens = solutionOnlyTokens(source, c.start, c.task);
  const cases: { name: string; expect: string; make: () => { dir: string; overlay?: Overlay } }[] = [
    { name: "עותק תקין, עם קבצים שנוצרו מ-F", expect: "PASS", make: () => { const overlay = { generatedFrom: c.F, files: [{ path: "CLAUDE.md", content: "Sum entries with sumEntries.\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
    { name: "קומיט עתידי נמשך למאגר והמצביע נמחק", expect: "FAIL, INVALID", make: () => { const { dir } = fresh(); git(dir, ["fetch", "--quiet", "--no-tags", source, "main:refs/heads/tmp"]); git(dir, ["update-ref", "-d", "refs/heads/tmp"]); return { dir }; } },
    { name: "תג, remote, alternates, reflog ו-FETCH_HEAD", expect: "FAIL, INVALID", make: () => { const { dir } = fresh(); git(dir, ["tag", "extra"]); git(dir, ["remote", "add", "origin", source]); mkdirSync(path.join(dir, ".git", "objects", "info"), { recursive: true }); writeFileSync(path.join(dir, ".git", "objects", "info", "alternates"), path.join(source, ".git", "objects") + "\n"); mkdirSync(path.join(dir, ".git", "logs"), { recursive: true }); writeFileSync(path.join(dir, ".git", "FETCH_HEAD"), "x\n"); return { dir }; } },
    { name: "קבצים שנוצרו מקומיט המשימה", expect: "FAIL, INVALID", make: () => { const overlay = { generatedFrom: c.task, files: [{ path: "CLAUDE.md", content: "notes\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
    { name: "קבצים מקומיט מוקדם בתאריך שאינו אב של S_c", expect: "FAIL, INVALID, והאי-התאמה UNKNOWN", make: () => { const overlay = { generatedFrom: c.side, files: [{ path: "CLAUDE.md", content: "notes\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
    { name: "קבצים שנוקבים בשם שהפתרון מוסיף", expect: "UNKNOWN", make: () => { const overlay = { generatedFrom: c.F, files: [{ path: "CLAUDE.md", content: "Use computeLedgerChecksum.\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
    { name: "קובץ עתידי ושינוי בעץ העבודה", expect: "FAIL, INVALID", make: () => { const { dir } = fresh(); mkdirSync(path.join(dir, "src"), { recursive: true }); writeFileSync(path.join(dir, "src", "checksum.js"), git(source, ["show", `${c.task}:src/checksum.js`]) + "\n"); appendFileSync(path.join(dir, "README.md"), "x\n"); return { dir }; } },
  ];
  md.push("## א. סדר זמנים: העותק מול מצב ההתחלה S_c", "", "בדיקת קוד על מאגר סינתטי. כל שורה מלבד הראשונה היא הפרה מכוונת. מצב התנאי ב-PASS, FAIL או UNKNOWN, וההשלכה על הראיה INVALID או אין.", "",
    "| מקרה | צפוי | מה נמצא | תנאי | ראיה |", "|---|---|---|---|---|");
  const temporal: Record<string, unknown>[] = [];
  for (const k of cases) {
    const { dir, overlay } = k.make();
    const v = verifyAgentCopy({ dir, start: c.start, task: c.task, overlay, source, solutionTokens: tokens });
    temporal.push({ name: k.name, expect: k.expect, status: v.status, evidence: v.evidence, violations: v.violations.map((x) => ({ kind: x.kind, consequence: x.consequence })) });
    md.push(`| ${k.name} | ${k.expect} | ${v.violations.map((x) => `${x.kind} (${x.consequence})`).join(", ") || "—"} | ${v.status} | ${v.evidence ?? "—"} |`);
  }
  json.temporal = temporal;

  // ------------------------------------------------------------ B. environment
  let dumpFile = "";
  await run("env-dump", {}, (ctx) => ({ MOCK_DUMP_FILE: (dumpFile = path.join(ctx.runDir, "dump.json")) }));
  const seen = JSON.parse(readFileSync(dumpFile, "utf8")) as { env: Record<string, string>; cwd: string; execPath: string; argv: string[]; homedir: string; tmpdir: string; userInfo: { username: string; homedir: string } };
  rmSync(dumpFile, { force: true });
  const { profiles, user } = realIdentity();
  const shortUser = path.basename(profiles.at(-1)!);
  const exposes = (v: string) => { const l = String(v).toLowerCase(); return profiles.some((p) => l.includes(p)) || (user !== "" && l.includes(user)) || l.includes(shortUser); };
  const injected = Object.keys(seen.env).filter((k) => /^BPPDOMAIN_MANAGER_/.test(k));
  const harnessKeys = Object.keys(seen.env).filter((k) => !injected.includes(k));
  const envExposure = {
    variablesChecked: harnessKeys.length,
    variablesExposingRealUser: harnessKeys.filter((k) => exposes(seen.env[k]!)),
    workingDirectoryExposes: exposes(seen.cwd), execPathExposes: exposes(seen.execPath), argvExposes: exposes(seen.argv.join(" ")),
    homeExposes: exposes(seen.homedir), tempExposes: exposes(seen.tmpdir),
    pathFolders: tc.pathDirs.length, pathFoldersUnderProfile: tc.pathDirs.filter(underProfile).length,
    osAccountExposes: exposes(seen.userInfo.username) || exposes(seen.userInfo.homedir),
    machineInjected: injected.map((k) => ({ name: k, valueExposesRealUser: exposes(seen.env[k]!) })),
  };
  json.environment = envExposure;
  const tools = JSON.parse(String((await run("tools-check")).process!.resultEvent!.result)) as Record<string, string>;
  json.tools = tools;
  md.push("", "## ב. הסביבה שהסוכן רואה", "", "נבדק בתוך תהליך הסוכן עצמו. אף ערך לא נרשם בדוח, רק אם הוא חושף את המשתמש האמיתי: נתיב הפרופיל, בכתיב המלא או המקוצר, או שם המשתמש.", "",
    "| מה נבדק | תוצאה |", "|---|---|",
    `| משתנים שהרתמה שולטת בהם | ${envExposure.variablesChecked}, מהם חושפים: ${envExposure.variablesExposingRealUser.length} |`,
    `| תיקיית העבודה, נתיב node, argv, הבית, תיקיית הזמניים | ${[envExposure.workingDirectoryExposes, envExposure.execPathExposes, envExposure.argvExposes, envExposure.homeExposes, envExposure.tempExposes].some(Boolean) ? "חושף" : "לא חושף"} |`,
    `| PATH | ${envExposure.pathFolders} תיקיות, מהן תחת הפרופיל: ${envExposure.pathFoldersUnderProfile} |`,
    `| חשבון מערכת ההפעלה, דרך קריאות המערכת | ${envExposure.osAccountExposes ? "חושף, ואי אפשר להסתיר בלי חשבון נפרד" : "לא חושף"} |`,
    ...envExposure.machineInjected.map((m) => `| ${m.name}, מוזרק בידי תוכנה על המחשב | ${m.valueExposesRealUser ? "הערך חושף" : "הערך אינו חושף"} |`),
    "", "**כלים שהסוכן יכול להריץ דרך ה-PATH:** " + Object.entries(tools).map(([k, v]) => `${k}: ${v.startsWith("runs") ? "רץ" : "לא נמצא"}`).join(", ") + ".");

  // ------------------------------------------------------------ C. scenarios
  const received: string[] = [];
  const listener = net.createServer((s) => { let d = ""; s.on("data", (b) => { d += b.toString(); }); s.on("end", () => received.push(d)); });
  await new Promise<void>((res) => listener.listen(0, "127.0.0.1", res));
  const directPort = (listener.address() as net.AddressInfo).port;
  const endpoint = http.createServer((_q, s) => { s.writeHead(200); s.end("ok"); });
  await new Promise<void>((res) => endpoint.listen(0, "127.0.0.1", res));
  const endpointPort = (endpoint.address() as net.AddressInfo).port;
  type S = { name: string; scenario: string; expect: string; extra?: NonNullable<IsolatedRun["extraEnv"]>; over?: Partial<IsolatedRun>; abortAfterMs?: number };
  const scenarios: S[] = [
    { name: "הרצה תקינה", scenario: "normal", expect: "אין ממצאים; הבידוד BLOCKED" },
    { name: "קריאת הזיכרון הסינתטי ובדיקת הייחוס, בנתיב מוחלט", scenario: "read-forbidden", expect: "מזוהה; INVALID", extra: (x) => ({ MOCK_TARGETS: x.canaries.map((k) => k.file).join(";") }) },
    { name: "קריאה שקטה של בדיקת הייחוס", scenario: "read-silently", expect: "לא מזוהה; BLOCKED, לעולם לא נקי", extra: (x) => ({ MOCK_TARGETS: x.canaries.find((k) => k.kind === "future-information")!.file }) },
    { name: "כתיבה לחומרי הרתמה", scenario: "write-outside", expect: "מזוהה; UNKNOWN", extra: (x) => ({ MOCK_TARGET_DIR: x.harnessDir }) },
    { name: "רשת דרך הפרוקסי", scenario: "network-proxy", expect: "נרשם ונחסם ללקוח משתף; מסומן", extra: () => ({ MOCK_ALLOWED_URL: `http://127.0.0.1:${endpointPort}/v1` }), over: { allowEgress: (h, p) => h === "127.0.0.1" && p === endpointPort } },
    { name: "רשת ישירה שעוקפת את הפרוקסי", scenario: "network-direct", expect: "לא נחסם ולא נרשם; BLOCKED", extra: () => ({ MOCK_DIRECT_PORT: String(directPort) }) },
    { name: "משיכת קומיט המשימה מהמאגר המקורי בנתיב מקומי", scenario: "git-fetch-source", expect: "מזוהה; INVALID", extra: () => ({ MOCK_SOURCE: source, MOCK_TASK: c.task }) },
    { name: "עלות מעל התקרה, מדווחת בסוף", scenario: "over-budget", expect: "UNKNOWN" },
    { name: "עצירה מבחוץ באמצע ההרצה", scenario: "hang", expect: "INVALID", abortAfterMs: 700 },
    { name: "קריסת הסוכן באמצע ההרצה", scenario: "crash", expect: "UNKNOWN" },
  ];
  md.push("", "## ג. תרחישים, וסיווגם במונחי הפרוטוקול בלבד", "",
    "\"run\" הוא INCOMPLETE, INVALID או UNKNOWN, או ריק כשאף מהם לא חל. \"בידוד\" הוא FAIL כשזוהתה פריצה, ואחרת BLOCKED: אין אכיפה במחשב הזה, ולכן גלאי שלא מצא דבר אינו מוכיח דבר. אין כאן אף מצב \"תקין\".", "",
    "| מקרה | צפוי | סטטוס ההרצה | run | סדר זמנים בזמן ההרצה | בידוד | זוהה על ידי | סימונים |", "|---|---|---|---|---|---|---|---|");
  const runs: Record<string, unknown>[] = [];
  for (const s of scenarios) {
    const ctl = new AbortController();
    if (s.abortAfterMs) setTimeout(() => ctl.abort(), s.abortAfterMs);
    const r = await run(s.scenario, { ...(s.over ?? {}), signal: ctl.signal }, s.extra);
    const k = r.classification;
    const mechanisms = [...new Set(r.findings.map((f) => f.mechanism))];
    runs.push({ name: s.name, scenario: s.scenario, expect: s.expect, process: r.process && { status: r.process.status, reason: r.process.reason, exitCode: r.process.exitCode, treeKill: r.process.treeKill }, classification: k, findings: r.findings.map((f) => f.mechanism) });
    md.push(`| ${s.name} | ${s.expect} | ${r.process ? `${r.process.status} (${cell(r.process.reason)})` : "לא הופעל"} | ${k.run ?? "—"} | ${k.temporalOrderDuringRun} | ${k.isolation} | ${mechanisms.join(", ") || "לא התגלה"} | ${k.marks.length} |`);
  }
  await new Promise((res) => setTimeout(res, 200));
  md.push("", `**הרשת הישירה:** המאזין המקומי של הבדיקה עצמה קיבל ${received.length} חיבור(ים). הרתמה לא חסמה ולא רשמה אותם.`);
  json.runs = runs;
  json.directReceived = received.length;
  listener.close();
  endpoint.close();

  // ------------------------------------------------------------ D. caps and the process tree
  const REPS = 5;
  const measure = async (label: string, scenario: string, caps: IsolatedRun["caps"], toolchain: Toolchain) => {
    const out: { stopToCloseMs: number[]; past: number[]; turns: number[]; bytes: number[] } = { stopToCloseMs: [], past: [], turns: [], bytes: [] };
    for (let i = 0; i < REPS; i++) {
      const r = await run(scenario, { caps, toolchain });
      const o = r.process!.overshoot;
      if (o.stopToCloseMs !== null) out.stopToCloseMs.push(o.stopToCloseMs);
      if (o.pastDeadlineMs !== null) out.past.push(o.pastDeadlineMs);
      if (o.turnsAfterCap !== null) out.turns.push(o.turnsAfterCap);
      if (o.bytesAfterCap !== null) out.bytes.push(o.bytesAfterCap);
    }
    return { label, stopToCloseMs: stats(out.stopToCloseMs), pastDeadlineMs: out.past.length ? stats(out.past) : null, turnsAfterCap: out.turns.length ? stats(out.turns) : null, bytesAfterCap: out.bytes.length ? stats(out.bytes) : null };
  };
  const noJob: Toolchain = { ...tc, jobHelper: null };
  const caps = [
    await measure("תקרת תורות 5, Job Object", "many-turns", { wallMs: 20_000, maxTurns: 5, maxOutputBytes: 5_000_000 }, tc),
    await measure("תקרת תורות 5, taskkill בלי Job Object", "many-turns", { wallMs: 20_000, maxTurns: 5, maxOutputBytes: 5_000_000 }, noJob),
    await measure("תקרת זמן 1,500 ms, Job Object", "slow", { wallMs: 1500, maxTurns: 50, maxOutputBytes: 5_000_000 }, tc),
    await measure("תקרת זמן 1,500 ms, taskkill בלי Job Object", "slow", { wallMs: 1500, maxTurns: 50, maxOutputBytes: 5_000_000 }, noJob),
    await measure("תקרת פלט 256 KiB, Job Object", "flood", { wallMs: 20_000, maxTurns: 50, maxOutputBytes: 256 * 1024 }, tc),
  ];
  json.caps = caps;
  const fmt = (s: { min: number; median: number; max: number } | null, unit: string) => (s ? `${s.min} / ${s.median} / ${s.max} ${unit}` : "—");
  md.push("", "## ד. תקרות ועץ התהליכים", "", `כל שורה: ${REPS} הרצות, מינימום / חציון / מקסימום. "עד סגירה" הוא הזמן מהרגע שהרתמה החליטה לעצור ועד שצינורות התהליך נסגרו. התקרות אינן גבולות קשיחים: הן מזוהות ואז נאכפות, וזו החריגה שנמדדה.`, "",
    "| תקרה | עד סגירה | אחרי המועד | תורות אחרי התקרה | בייטים אחרי התקרה |", "|---|---|---|---|---|",
    ...caps.map((x) => `| ${x.label} | ${fmt(x.stopToCloseMs, "ms")} | ${fmt(x.pastDeadlineMs, "ms")} | ${fmt(x.turnsAfterCap, "")} | ${fmt(x.bytesAfterCap, "B")} |`));

  const orphan = async (toolchain: Toolchain) => {
    let pidFile = "", beat = "";
    const r = await run("orphan", { toolchain }, (ctx) => ({ MOCK_PID_FILE: (pidFile = path.join(ctx.runDir, "child.pid")), MOCK_HEARTBEAT_FILE: (beat = path.join(ctx.runDir, "beat.txt")) }));
    const pid = Number(readFileSync(pidFile, "utf8"));
    const result = { treeKill: r.process!.treeKill, lingeringAtExit: r.process!.lingeringAtExit, childAliveAfter: alive(pid), stillBeating: await beating(beat) };
    try { process.kill(pid); } catch { /* gone */ }
    return result;
  };
  const withJob = await orphan(tc);
  const withoutJob = await orphan(noJob);
  json.orphan = { withJob, withoutJob };
  md.push("", "**ילד שנשאר רץ אחרי שהסוכן יצא:**", "", "| מנגנון | תהליכים חיים ביציאה | הילד חי אחרי ההרצה | ממשיך לכתוב |", "|---|---|---|---|",
    `| Job Object | ${withJob.lingeringAtExit ?? "—"} | ${withJob.childAliveAfter ? "כן" : "לא"} | ${withJob.stillBeating ? "כן" : "לא"} |`,
    `| taskkill בלי Job Object | ${withoutJob.lingeringAtExit ?? "לא ידוע"} | ${withoutJob.childAliveAfter ? "כן" : "לא"} | ${withoutJob.stillBeating ? "כן" : "לא"} |`);

  // ------------------------------------------------------------ E. enforcement and the machine
  let machine: Record<string, string> = {};
  if (process.platform === "win32") {
    const ps = (cmd: string) => { try { return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", timeout: 60_000 }).trim(); } catch { return "query failed"; } };
    machine = {
      elevated: ps("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"),
      administratorsMember: ps("[bool]([Security.Principal.WindowsIdentity]::GetCurrent().Groups | Where-Object { $_.Value -eq 'S-1-5-32-544' })"),
      windowsSandbox: ps("Test-Path \"$env:SystemRoot\\System32\\WindowsSandbox.exe\""),
      docker: ps("[bool](Get-Command docker -ErrorAction SilentlyContinue)"),
      wslDistribution: ps("[bool]((wsl.exe -l -q 2>$null) -join '' -replace \"`0\", '' -match '\\w')"),
      firewallDefaultOutbound: ps("(Get-NetFirewallProfile | ForEach-Object { $_.Name + '=' + $_.DefaultOutboundAction }) -join ', '"),
    };
  }
  json.machine = machine;
  md.push("", "## ה. מה הסביבה אוכפת בפועל", "", "| תחום | מצב |", "|---|---|", ...Object.entries(ENFORCEMENT).map(([k, v]) => `| ${k} | ${String(v)} |`),
    "", "**בדיקה לקריאה בלבד של המחשב:**", "", "| מה | תוצאה |", "|---|---|", ...Object.entries(machine).map(([k, v]) => `| ${k} | ${v} |`));
  json.enforcement = ENFORCEMENT;

  const commit = (() => { try { return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
  const header = [
    "# שלב 4 של תשתית הפיילוט, אחרי תיקון: עותק הסוכן, ה-runner, עץ התהליכים והבידוד",
    "",
    `נוצר על ידי \`npm run -w @dcc/research sim:step4\` מהקוד בקומיט \`${commit}\`, על מאגר סינתטי ועם סוכן מדומה, תחת תיקיית ריצה מחוץ לפרופיל המשתמש. אין קריאת מודל, אין רשת מחוץ ל-127.0.0.1, ואין שינוי בהגדרות המחשב. אף ערך של משתנה סביבה לא נכתב לדוח.`,
    "",
    "**שלושה סוגי תוצאה שאינם מחליפים זה את זה.** נמנע: מנגנון אכיפה עצר. זוהה: מנגנון מצא אחרי מעשה. לא זוהה או לא נבדק: כל השאר, וגלאי שלא מצא דבר אינו ראיה שלא קרה דבר.",
    "",
  ];
  const outDir = path.join(REPO_ROOT, "docs/research/pilot/infrastructure");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "step-4-isolation-checks.md"), [...header, ...md, ""].join("\n"));
  writeFileSync(path.join(outDir, "step-4-isolation-checks.json"), JSON.stringify(json, null, 1) + "\n");
  rmSync(root, { recursive: true, force: true });
  console.log("written");
}

void main();

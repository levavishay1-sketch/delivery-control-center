import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentCopy, verifyAgentCopy, type Overlay } from "../isolation/copy.ts";
import { makeFixtureRepo } from "../isolation/fixture.ts";
import { git } from "../isolation/git.ts";
import { solutionOnlyTokens } from "../isolation/tokens.ts";
import { ENFORCEMENT, runIsolated, type RunReport } from "../runner/harness.ts";
import { REPO_ROOT } from "../protocol.ts";

/**
 * Step 4 of the pilot infrastructure: the agent's copy, the runner with a
 * mock agent, and leak detection, run on a synthetic repository. Writes
 * docs/research/pilot/infrastructure/step-4-isolation-checks.{md,json}.
 * No model call, no network beyond 127.0.0.1, no change to the machine.
 */

const MOCK = fileURLToPath(new URL("../runner/fixtures/mock-agent.mjs", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "dcc-step4-"));
const source = path.join(root, "source");
const c = makeFixtureRepo(source);
let n = 0;
const scratch = path.join(root, "scratch");
const fresh = (overlay?: Overlay) => buildAgentCopy({ source, start: c.start, target: path.join(root, `copy-${++n}`), scratch, overlay });
const md: string[] = [];
const json: Record<string, unknown> = {};

// ------------------------------------------------------------ temporal order
const tokens = solutionOnlyTokens(source, c.start, c.task);
type Case = { name: string; expect: string; make: () => { dir: string; overlay?: Overlay } };
const cases: Case[] = [
  { name: "עותק תקין, עם קבצים שנוצרו מ-F", expect: "אין הפרה", make: () => { const overlay = { generatedFrom: c.F, files: [{ path: "CLAUDE.md", content: "Sum entries with sumEntries.\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
  { name: "קומיט עתידי נמשך למאגר והמצביע נמחק", expect: "אובייקט זר, קומיט המשימה קיים", make: () => { const { dir } = fresh(); git(dir, ["fetch", "--quiet", "--no-tags", source, "main:refs/heads/tmp"]); git(dir, ["update-ref", "-d", "refs/heads/tmp"]); return { dir }; } },
  { name: "תג, remote, alternates, reflog ו-FETCH_HEAD", expect: "כל אחד מהם", make: () => { const { dir } = fresh(); git(dir, ["tag", "extra"]); git(dir, ["remote", "add", "origin", source]); mkdirSync(path.join(dir, ".git", "objects", "info"), { recursive: true }); writeFileSync(path.join(dir, ".git", "objects", "info", "alternates"), path.join(source, ".git", "objects") + "\n"); mkdirSync(path.join(dir, ".git", "logs"), { recursive: true }); writeFileSync(path.join(dir, ".git", "FETCH_HEAD"), "x\n"); return { dir }; } },
  { name: "קבצים שנוצרו מקומיט המשימה", expect: "INVALID", make: () => { const overlay = { generatedFrom: c.task, files: [{ path: "CLAUDE.md", content: "notes\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
  { name: "קבצים מקומיט מוקדם בתאריך שאינו אב של S_c", expect: "INVALID, ואי-ההתאמה מדווחת", make: () => { const overlay = { generatedFrom: c.side, files: [{ path: "CLAUDE.md", content: "notes\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
  { name: "קבצים שנוקבים בשם שהפתרון מוסיף", expect: "FLAG", make: () => { const overlay = { generatedFrom: c.F, files: [{ path: "CLAUDE.md", content: "Use computeLedgerChecksum.\n" }] }; return { dir: fresh(overlay).dir, overlay }; } },
  { name: "קובץ עתידי ושינוי בעץ העבודה", expect: "INVALID", make: () => { const { dir } = fresh(); mkdirSync(path.join(dir, "src"), { recursive: true }); writeFileSync(path.join(dir, "src", "checksum.js"), git(source, ["show", `${c.task}:src/checksum.js`]) + "\n"); appendFileSync(path.join(dir, "README.md"), "x\n"); return { dir }; } },
];
md.push("## א. סדר זמנים: העותק מול מצב ההתחלה S_c", "",
  "בדיקת קוד של הבונה והבודק על מאגר סינתטי. כל שורה מלבד הראשונה היא הפרה מכוונת.", "",
  "| מקרה | צפוי | מה נמצא | השלכה |", "|---|---|---|---|");
const temporal: Record<string, unknown>[] = [];
for (const k of cases) {
  const { dir, overlay } = k.make();
  const v = verifyAgentCopy({ dir, start: c.start, task: c.task, overlay, source, solutionTokens: tokens });
  temporal.push({ name: k.name, expect: k.expect, violations: v.violations, consequence: v.consequence });
  md.push(`| ${k.name} | ${k.expect} | ${v.violations.map((x) => x.kind).join(", ") || "—"} | ${v.consequence} |`);
}
json.temporal = temporal;
json.solutionTokens = tokens;

// ------------------------------------------------------------ runner scenarios
type Scenario = { name: string; scenario: string; kind: string; extra?: (ctx: { harnessDir: string; canaries: { file: string }[] }) => Record<string, string>; caps?: { wallMs: number; maxTurns: number }; abortAfterMs?: number };
async function main(): Promise<void> {
  const received: string[] = [];
  const listener = net.createServer((s) => { let d = ""; s.on("data", (b) => { d += b.toString(); }); s.on("end", () => received.push(d)); });
  await new Promise<void>((res) => listener.listen(0, "127.0.0.1", res));
  const directPort = (listener.address() as net.AddressInfo).port;
  const endpoint = http.createServer((_q, s) => { s.writeHead(200); s.end("ok"); });
  await new Promise<void>((res) => endpoint.listen(0, "127.0.0.1", res));
  const endpointPort = (endpoint.address() as net.AddressInfo).port;

  const scenarios: Scenario[] = [
    { name: "הרצה תקינה", scenario: "normal", kind: "בסיס" },
    { name: "קריאת הזיכרון הסינתטי ובדיקת הייחוס, בנתיב מוחלט", scenario: "read-forbidden", kind: "זיהוי", extra: (x) => ({ MOCK_TARGETS: x.canaries.map((k) => k.file).join(";") }) },
    { name: "קריאה בידי תוכנה שהסוכן הפעיל, בלי עקבות", scenario: "read-silently", kind: "מגבלת זיהוי", extra: (x) => ({ MOCK_TARGETS: x.canaries[1]!.file }) },
    { name: "כתיבה לחומרי הרתמה", scenario: "write-outside", kind: "זיהוי", extra: (x) => ({ MOCK_TARGET_DIR: x.harnessDir }) },
    { name: "רשת דרך הפרוקסי, יעד שאינו ברשימה", scenario: "network-proxy", kind: "רישום וחסימה", extra: () => ({ MOCK_ALLOWED_URL: `http://127.0.0.1:${endpointPort}/v1` }) },
    { name: "רשת ישירה שעוקפת את הפרוקסי", scenario: "network-direct", kind: "לא נחסם ולא נרשם", extra: () => ({ MOCK_DIRECT_PORT: String(directPort) }) },
    { name: "משיכת קומיט המשימה מהמאגר המקורי בנתיב מקומי", scenario: "git-fetch-source", kind: "זיהוי", extra: () => ({ MOCK_SOURCE: source, MOCK_TASK: c.task }) },
    { name: "חריגה מתקרת התורות", scenario: "many-turns", kind: "אכיפת תקרה", caps: { wallMs: 20_000, maxTurns: 5 } },
    { name: "חריגה מתקרת הזמן", scenario: "slow", kind: "אכיפת תקרה", caps: { wallMs: 1500, maxTurns: 50 } },
    { name: "עלות מעל התקרה, מדווחת בסוף", scenario: "over-budget", kind: "בדיקה לאחר ההרצה" },
    { name: "עצירה מבחוץ באמצע ההרצה", scenario: "hang", kind: "סיווג", abortAfterMs: 700 },
    { name: "קריסת הסוכן באמצע ההרצה", scenario: "crash", kind: "סיווג" },
  ];
  md.push("", "## ב. ה-runner עם סוכן מדומה", "",
    "כל שורה היא הרצה אחת על עותק טרי. \"מנגנון\" הוא המנגנון שמצא את הממצא, ואם אין, הממצא לא התגלה. \"אכיפה\" נכונה רק לתקרות ולמשתני הסביבה.", "",
    "| מקרה | סוג | סטטוס ההרצה | מנגנונים שמצאו | רשומות יציאה | סטטוס הראיה |", "|---|---|---|---|---|---|");
  const runs: Record<string, unknown>[] = [];
  for (const s of scenarios) {
    const { dir } = fresh();
    const ctl = new AbortController();
    if (s.abortAfterMs) setTimeout(() => ctl.abort(), s.abortAfterMs);
    const r: RunReport = await runIsolated({
      copy: dir, start: c.start, task: c.task, source, runDir: path.join(root, `run-${n}`), command: process.execPath, args: [MOCK],
      caps: { wallMs: s.caps?.wallMs ?? 20_000, maxTurns: s.caps?.maxTurns ?? 50, maxOutputBytes: 5_000_000, maxCostUsd: 1 },
      allowEgress: (h, p) => h === "127.0.0.1" && p === endpointPort,
      extraEnv: (ctx) => ({ MOCK_SCENARIO: s.scenario, ...(s.extra?.(ctx) ?? {}) }),
      signal: ctl.signal,
    });
    const mechanisms = [...new Set(r.findings.map((f) => f.mechanism))];
    runs.push({ name: s.name, scenario: s.scenario, process: r.process, findings: r.findings, egress: r.egress, evidence: r.evidence });
    md.push(`| ${s.name} | ${s.kind} | ${r.process.status} (${r.process.reason}) | ${mechanisms.join(", ") || "לא התגלה"} | ${r.egress.map((e) => `${e.method} ${e.host}:${e.port} ${e.decision}`).join("; ") || "—"} | ${r.evidence.status} |`);
  }
  await new Promise((res) => setTimeout(res, 200));
  md.push("", `**הרשת הישירה:** המאזין המקומי של הבדיקה עצמה קיבל ${received.length} חיבור(ים) עם המטען \`${received.join(",")}\`. הרתמה לא חסמה ולא רשמה אותם. בהרצה אמיתית אין מאזין כזה, ולכן אין שום עדות.`);
  json.runs = runs;
  json.directReceived = received;
  listener.close();
  endpoint.close();

  md.push("", "## ג. מה הסביבה אוכפת בפועל", "", "| תחום | מצב |", "|---|---|",
    ...Object.entries(ENFORCEMENT).map(([k, v]) => `| ${k} | ${String(v)} |`));
  json.enforcement = ENFORCEMENT;

  const commit = (() => { try { return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
  const header = [
    "# שלב 4 של תשתית הפיילוט: עותק הסוכן, ה-runner וזיהוי זליגה",
    "",
    `נוצר על ידי \`npm run -w @dcc/research sim:step4\` מהקוד בקומיט \`${commit}\`, על מאגר סינתטי ועם סוכן מדומה. אין קריאת מודל, אין רשת מחוץ ל-127.0.0.1, ואין שינוי בהגדרות המחשב.`,
    "",
    "**שלושה סוגי תוצאה שאינם מחליפים זה את זה.** בדיקת קוד אומרת שהקוד עושה מה שהוא מתאר. זיהוי אומר שמנגנון מצא ממצא בהרצה. אכיפה אומרת שהסביבה מנעה משהו. זיהוי מוצלח אינו אכיפה, ובדיקת קוד מוצלחת אינה זיהוי בהרצה אמיתית.",
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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendEvidence, type RecordStatus } from "../evidence.ts";
import { verifyAgentCopy, type VerifyResult } from "../isolation/copy.ts";
import { git } from "../isolation/git.ts";
import { sha256 } from "../protocol.ts";
import { buildAgentEnv, makeSyntheticHome } from "./env.ts";
import { diffSnapshots, newCanaryToken, readTextTree, scanCanaries, scanTranscriptPaths, snapshot, type Canary, type Finding } from "./leak.ts";
import { runProcess, type Caps, type ProcessResult } from "./process.ts";
import { startEgressProxy, type EgressEntry } from "./proxy.ts";
import type { Toolchain } from "./toolchain.ts";

/**
 * One isolated run: a check of the copy before it, a synthetic home with a
 * canary, harness materials with a canary, the egress proxy, the process in
 * its Job Object with its caps, and the checks after it. The report keeps
 * three kinds of result apart and never lets one stand for another:
 *
 *   prevented   what an enforcement mechanism stopped (`ENFORCEMENT`, a fixed
 *               statement of what this harness can and cannot do);
 *   detected    what a mechanism found after the fact (`findings`);
 *   not known   everything else. A detector that found nothing is not
 *               evidence that nothing happened.
 */

export const ENFORCEMENT = {
  environmentVariables: "ENFORCED at spawn: the child receives only the variables the harness lists; PATH is a synthetic list of tool folders, never the user's",
  processIdentity: "NOT HIDDEN: the process runs as the real OS account, whose name and profile folder remain available through operating-system calls",
  userSettingsLocation: "REDIRECTED: home, AppData, temp and CLAUDE_CONFIG_DIR point into a synthetic home outside the user's profile; the real ones stay readable by absolute path",
  processTree: "ENFORCED on Windows by a Job Object for the processes the run creates itself: they cannot leave the job and are killed when the run stops or ends. A process a system service starts on the run's behalf (Task Scheduler, WMI, an out-of-process COM server) is outside the job; not tested",
  caps: "DETECTED, THEN ENFORCED: turn, output and wall-clock caps stop the tree after the runner sees them crossed; not hard limits, overshoot measured per run",
  fileSystemReads: "NOT ENFORCED: same OS account; detected by canaries and by paths in the transcript only",
  fileSystemWrites: "NOT ENFORCED: detected by snapshots of watched directories only",
  egressThroughProxy: "BLOCKED AND RECORDED for programs that honour HTTP(S)_PROXY",
  egressDirect: "NOT BLOCKED AND NOT RECORDED: a direct socket never reaches the proxy",
  operatingSystemIsolation: "ABSENT: no firewall rule, network namespace, container, sandbox or separate OS account (each needs an administrator on this machine)",
  isolationProven: false,
} as const;

/**
 * The classification of a run, in the frozen protocol's terms only.
 *   run                     INCOMPLETE (3.2), INVALID (17.3, 5.4.5), UNKNOWN when the protocol
 *                           does not define the case; null when none applies (the run ended).
 *   copyBeforeRun           PASS, FAIL or UNKNOWN: the mechanical check of 5.4.6.
 *   temporalOrderDuringRun  INVALID when information later than S_c was detected reaching the
 *                           agent (5.4.5); otherwise BLOCKED: nothing enforces it during a run
 *                           on this machine, so a clean result cannot be assessed (0.2).
 *   isolation               FAIL when a breach was detected; otherwise BLOCKED, for the same
 *                           reason. Never PASS here: detection finding nothing proves nothing.
 *   marks                   attempts recorded, "marked and reported separately" (3.2, 5.4.6).
 */
export type Classification = {
  run: "INCOMPLETE" | "INVALID" | "UNKNOWN" | null;
  runReasons: string[];
  copyBeforeRun: VerifyResult["status"];
  temporalOrderDuringRun: "INVALID" | "BLOCKED";
  isolation: "FAIL" | "BLOCKED";
  marks: string[];
};

export type RunReport = {
  process: Omit<ProcessResult, "events"> | null;
  findings: Finding[];
  egress: EgressEntry[];
  copyBeforeRun: VerifyResult;
  copyAfterRun: VerifyResult | null;
  classification: Classification;
  enforcement: typeof ENFORCEMENT;
  runDir: string;
};

export type IsolatedRun = {
  copy: string;
  start: string;
  task?: string;
  /** The source repository, harness side; its refs are watched and it identifies foreign commits. */
  source?: string;
  runDir: string;
  toolchain: Toolchain;
  command: string;
  args: readonly string[];
  caps: Caps;
  allowEgress: (host: string, port: number) => boolean;
  /** Extra variables for the child (a mock agent's scenario); never secrets. */
  extraEnv?: (ctx: { home: string; runDir: string; harnessDir: string; canaries: Canary[] }) => Record<string, string>;
  signal?: AbortSignal;
  campaign?: { dir: string; protocolSha256: string; paramsSha256: string };
};

const RUN_RANK = [null, "INCOMPLETE", "UNKNOWN", "INVALID"] as const;

export async function runIsolated(o: IsolatedRun): Promise<RunReport> {
  mkdirSync(o.runDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const reasons: string[] = [];
  let run: Classification["run"] = null;
  const raise = (s: Exclude<Classification["run"], null>, why: string) => {
    reasons.push(`${s}: ${why}`);
    if (RUN_RANK.indexOf(s) > RUN_RANK.indexOf(run)) run = s;
  };

  const copyBeforeRun = verifyAgentCopy({ dir: o.copy, start: o.start, task: o.task, source: o.source });
  if (copyBeforeRun.status === "FAIL") {
    raise("INVALID", "the copy failed its check before the run (5.4.6); the agent was not started");
    const classification: Classification = { run, runReasons: reasons, copyBeforeRun: "FAIL", temporalOrderDuringRun: "BLOCKED", isolation: "BLOCKED", marks: [] };
    return { process: null, findings: [], egress: [], copyBeforeRun, copyAfterRun: null, classification, enforcement: ENFORCEMENT, runDir: o.runDir };
  }

  const home = makeSyntheticHome(o.runDir);
  const harnessDir = path.join(o.runDir, "harness");
  mkdirSync(path.join(harnessDir, "reference"), { recursive: true });
  const canaries: Canary[] = [
    { kind: "user-context", token: newCanaryToken(), file: path.join(home.claudeConfig, "CLAUDE.md") },
    { kind: "future-information", token: newCanaryToken(), file: path.join(harnessDir, "reference", "hidden.test.js") },
  ];
  writeFileSync(canaries[0]!.file, `# user memory\n${canaries[0]!.token}\n`);
  writeFileSync(canaries[1]!.file, `// reference test from the task commit\n// ${canaries[1]!.token}\n`);

  const proxy = await startEgressProxy(o.allowEgress);
  const harnessBefore = snapshot(harnessDir);
  const sourceRefsBefore = o.source ? git(o.source, ["for-each-ref"]) : "";
  const env = buildAgentEnv({ home, pathDirs: o.toolchain.pathDirs, proxyUrl: proxy.url, extra: o.extraEnv?.({ home: home.home, runDir: o.runDir, harnessDir, canaries }) });
  const stdoutPath = path.join(o.runDir, "stdout.jsonl");
  const stderrPath = path.join(o.runDir, "stderr.txt");
  let result: ProcessResult;
  try {
    result = await runProcess({
      command: o.command, args: o.args, cwd: o.copy, env, caps: o.caps, stdoutPath, stderrPath, signal: o.signal,
      jobHelper: o.toolchain.jobHelper, statusPath: path.join(o.runDir, "job-status.json"),
    });
  } finally {
    await proxy.close();
  }

  const stdout = readFileSync(stdoutPath, "utf8");
  const stderr = readFileSync(stderrPath, "utf8");
  const findings: Finding[] = [
    ...scanCanaries({ stdout, stderr, ...Object.fromEntries(Object.entries(readTextTree(o.copy)).map(([k, v]) => [`copy/${k}`, v])) }, canaries),
    ...scanTranscriptPaths(result.events, o.copy),
    ...diffSnapshots("harness materials", harnessBefore, snapshot(harnessDir)),
    ...proxy.entries.filter((e) => e.decision === "denied").map((e): Finding => ({ mechanism: "egress-log", detail: `${e.method} ${e.host}:${e.port} denied` })),
  ];
  if (o.source && git(o.source, ["for-each-ref"]) !== sourceRefsBefore) findings.push({ mechanism: "snapshot", detail: "source repository refs changed" });
  const copyAfterRun = verifyAgentCopy({ dir: o.copy, start: o.start, task: o.task, source: o.source, afterRun: true });
  for (const v of copyAfterRun.violations) findings.push({ mechanism: "git-after-run", detail: `${v.kind}: ${v.detail}` });

  const marks: string[] = [];
  let temporal: Classification["temporalOrderDuringRun"] = "BLOCKED";
  let isolation: Classification["isolation"] = "BLOCKED";
  if (result.status === "ABORTED") raise("INVALID", `stopped from outside (17.3): ${result.reason}`);
  if (copyAfterRun.evidence === "INVALID") { temporal = "INVALID"; isolation = "FAIL"; raise("INVALID", "information later than S_c reached the copy (5.4.5)"); }
  const futureCanary = findings.some((f) => f.mechanism === "canary" && f.detail.startsWith("future-information"));
  const contextCanary = findings.some((f) => f.mechanism === "canary" && f.detail.startsWith("user-context"));
  if (futureCanary) { temporal = "INVALID"; isolation = "FAIL"; raise("INVALID", "a reference test from the task commit was read: information later than S_c reached the agent (5.4.5)"); }
  if (contextCanary) { isolation = "FAIL"; raise("UNKNOWN", "user-level context was read (3.2 excludes it); the protocol does not define the status of such a run"); }
  if (findings.some((f) => f.mechanism === "snapshot")) { isolation = "FAIL"; raise("UNKNOWN", "harness material or the source repository was written; the protocol does not define the status of such a run"); }
  if (result.status === "CRASHED") raise("UNKNOWN", `the agent process ended without a result: ${result.reason}; the protocol does not define this case`);
  if (result.status === "CAPPED") raise("INCOMPLETE", `stopped at a cap (3.2): ${result.reason}`);
  if (result.costAboveCapWithoutStop) raise("UNKNOWN", "the reported cost is above the budget cap and the run was not stopped; the protocol defines INCOMPLETE only for a run stopped at its cap");
  for (const f of findings) if (f.mechanism === "egress-log" || f.mechanism === "transcript-path") marks.push(`${f.mechanism}: ${f.detail}`);
  if (result.lingeringAtExit && result.lingeringAtExit > 0) marks.push(`process-tree: ${result.lingeringAtExit} process(es) still running when the agent exited; killed by the Job Object`);

  const { events: _events, ...processWithoutEvents } = result;
  const classification: Classification = { run, runReasons: reasons, copyBeforeRun: copyBeforeRun.status, temporalOrderDuringRun: temporal, isolation, marks };
  const report: RunReport = { process: processWithoutEvents, findings, egress: proxy.entries, copyBeforeRun, copyAfterRun, classification, enforcement: ENFORCEMENT, runDir: o.runDir };
  if (o.campaign) {
    const status: RecordStatus = run ?? (isolation === "FAIL" ? "FAIL" : "BLOCKED");
    appendEvidence(o.campaign.dir, {
      kind: "isolated-run", question: "F2", status,
      protocolSha256: o.campaign.protocolSha256, paramsSha256: o.campaign.paramsSha256, startedAt, finishedAt: new Date().toISOString(),
      outputs: [{ path: stdoutPath, sha256: sha256(stdout) }, { path: stderrPath, sha256: sha256(stderr) }],
      data: { classification, process: processWithoutEvents, findings, egress: proxy.entries, enforcement: ENFORCEMENT },
    });
  }
  return report;
}

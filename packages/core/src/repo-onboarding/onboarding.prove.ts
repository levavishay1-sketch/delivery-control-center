/**
 * Proves the onboarding run end to end (openspec/changes/repository-coach):
 *
 *   The run connects an isolated copy, diagnoses it without a model, waits
 *   for the interview, maps the processes and decides each step, waits for
 *   the trial's cost (the level says so), runs the trial with the code as
 *   judge where it can and the stand-in judge where it cannot, draws the
 *   plan from the rules, the trial, the processes, the open search (trust
 *   graded by the code: an "official" claim by the model counts for
 *   nothing), the reviewer and a person's request; scans a /init draft left in
 *   the copy (what it takes waits for a person, a permission is a question,
 *   a path the code lacks is not recommended); takes decisions; sets the
 *   draft aside and builds
 *   only what was approved, validates every component its own way (a hook
 *   is really run), runs the trial again; delivers only the approved files
 *   by name to the bare host with a report written from the cards. The
 *   coach reads the repository afterwards.
 *
 * Its own database, git host and Claude stand-in (prove-kit.ts).
 * Run: `npm run -w @dcc/core prove:onboarding`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { proveKit } from "../prove-kit.ts";

const k = await proveKit("onboarding");
// Only now: a module that reaches the CLI or the database reads where they are when it loads (see prove-kit.ts).
const { runtimeDir } = await import("./workspace.ts");
const { check, g, core, dbm, schema, eq } = k;
type View = Awaited<ReturnType<typeof core.getOnboardingRunView>>;

const repoRow = (await dbm.db.select().from(schema.repo).where(eq(schema.repo.name, `prove-repo-${k.work.split("-").pop()}`))).at(0);
const repoId = (await dbm.db.select({ id: schema.repo.id }).from(schema.repo)).at(-1)!.id;
void repoRow;
const by = k.by;

// The seed repository gets a lock file, so the stack has one tag ("npm") for the open search to be asked about.
const seed = path.join(k.work, "seed");
writeFileSync(path.join(seed, "package-lock.json"), JSON.stringify({ name: "prove-repo", lockfileVersion: 3 }, null, 2));
g(seed, "add", "package-lock.json"); g(seed, "commit", "--quiet", "-m", "lock"); g(seed, "push", "--quiet", "origin", "HEAD:main");
g(k.cache, "pull", "--quiet", "--ff-only");

const view = (runId: string) => core.getOnboardingRunView(repoId, runId);
const stepOf = (v: View, key: string) => v.steps.find((s) => s.stepKey === key)!;
async function waitFor(runId: string, pred: (v: View) => boolean, what: string, ms = 120_000): Promise<View> {
  const t0 = Date.now();
  for (;;) {
    const v = await view(runId);
    if (pred(v)) return v;
    if (v.run.status === "Failed") throw new Error(`run failed while waiting for ${what}: ${v.steps.filter((s) => s.status === "Failed").map((s) => `${s.stepKey}: ${(s.errors as string[]).join("; ")}`).join(" | ")}`);
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what} (run ${v.run.status}, step ${v.run.currentStepKey})`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

try {
  // 0–1. connect and diagnose run by themselves; the processes step waits for the interview.
  const { runId } = await core.startOnboardingRun(repoId, by, { automation: { level: "all_approval" } });
  let v = await waitFor(runId, (x) => stepOf(x, "processes").status === "WaitingForUser", "the interview");
  check("connect: an isolated copy on its own branch, from the host's main line", stepOf(v, "connect").status === "Completed" && /^ai\/onboarding\//.test(v.run.branchName ?? "") && (stepOf(v, "connect").result as { baseFrom: string }).baseFrom === "remote");
  check("diagnose: no model, a profile with facts the person can correct", stepOf(v, "diagnose").status === "Completed" && (v.profile?.facts.length ?? 0) >= 12 && v.cost.calls === 0);
  const facts = Object.fromEntries((v.profile?.facts ?? []).map((f) => [f.path, f]));
  check("the profile says what is missing: no tests, no CI, no lint, no AI setup", facts.tests?.tone === "warn" && facts.ci?.tone === "warn" && facts.lint_format?.tone === "warn" && /אין/.test(facts.ai_config?.value_he ?? ""), JSON.stringify([facts.tests?.value_he, facts.ci?.value_he]));
  check("the interview asks only what the code cannot tell, each with a default", v.interview.questions.length > 0 && v.interview.questions.length <= 4 && v.interview.questions.every((q) => q.options.some((o) => o.value === q.default)), JSON.stringify(v.interview.questions.map((q) => q.key)));

  // A correction before the plan: the rule that reads the fact is held back later.
  await core.correctProfileFact(repoId, runId, by, { path: "lint_format", note: "יש לנו פורמטר בחוץ" });

  // 2. the answers (one given, the rest assumed) → the model maps the processes; the code decides each step.
  await core.answerInterview(repoId, runId, by, { done_means: "build_tests" });
  v = await waitFor(runId, (x) => stepOf(x, "trial").status === "WaitingForUser", "the trial's gate");
  const proc = stepOf(v, "processes").result as { answered: number; assumed: number; agents: number; skills: number; processes: number };
  check("processes: the answer given counts, the rest are assumptions", proc.answered === 1 && proc.assumed === v.interview.questions.length - 1, JSON.stringify(proc));
  check("the agent test decided from the answers: an external-info step is an agent, a recurring procedure is a skill, one action is nothing", proc.agents === 1 && proc.skills === 1 && v.processes.some((p) => p.steps.some((s) => s.decision === "none")), JSON.stringify(v.processes.map((p) => p.steps.map((s) => [s.key, s.decision]))));
  check("trial: with 'everything waits for approval' the cost is declared before it is spent", v.trials.waiting !== null && v.trials.waiting!.estimateUsd > 0 && v.trials.waiting!.tasks.some((t) => t.key === "no_tests_honesty"), JSON.stringify(v.trials.waiting));

  // 3. the trial: the code judges the honesty task; the stand-in judges the rest, one fails.
  await core.approveTrial(repoId, runId, by);
  v = await waitFor(runId, (x) => stepOf(x, "plan").status === "WaitingForUser", "the plan");
  const base = v.trials.baseline;
  const byKey = Object.fromEntries(base.map((t) => [t.taskKey, t]));
  check("the code judged the honesty task itself (no judge call), and it passed", byKey.no_tests_honesty?.passed === true && byKey.no_tests_honesty?.judgedBy === "code", JSON.stringify(byKey.no_tests_honesty));
  check("a model other than the executor judged the rest; one failed as 'did not know a fact'", byKey.how_to_build?.passed === true && byKey.how_to_build?.judgedBy !== "code" && byKey.entry_points?.passed === false && byKey.entry_points?.failureKind === "missing_fact", JSON.stringify([byKey.how_to_build, byKey.entry_points]));
  check("every trial task is a ledger row carrying its step", v.cost.rows.filter((r) => r.capability === "onboarding_trial").length === base.length && v.cost.rows.every((r) => typeof r.meta.stepKey === "string"));

  // 4. the plan: cards from the rules, the processes, the search, the reviewer — and the correction held a rule back.
  const plan = v.plan!;
  check("the rules that fired are the repository's signals: no tests, no CI, no AI setup, thin docs", ["R02", "R05", "R17", "R22b"].every((r) => plan.rulesFired.includes(r)), JSON.stringify(plan.rulesFired));
  check("the corrected fact held its rule back, and the plan says which", !plan.rulesFired.includes("R21") && plan.rulesSuppressed.some((s) => s.rule === "R21" && s.fact === "lint_format"), JSON.stringify(plan.rulesSuppressed));
  const cards = v.components;
  const card = (key: string) => cards.find((c) => c.key === key);
  check("a process step decided 'agent' became an agent card named for the step; 'skill' became a skill", !!card("agent_release_publish") && card("agent_release_publish")!.kind === "agent" && !!card("skill_release_build") && card("skill_release_build")!.kind === "skill");
  check("the open search's finds were graded by the code: the vendor's LSP is official, the '73 tools' stranger is unverified despite the model's claim", card("lsp_typescript_lsp")?.params.trust === "official" && card("mcp_random_mcp")?.params.trust === "unverified" && /אזהרה/.test(card("mcp_random_mcp")?.why_he ?? ""), JSON.stringify(cards.filter((c) => c.source === "marketplace").map((c) => [c.key, c.params.trust])));
  check("the reviewer's gap became a card that waits for approval", cards.some((c) => c.source === "reviewer" && c.group === "approval" && c.status === "proposed"));
  check("with 'everything waits for approval' nothing is in the auto group except reports; the not-recommended group says why", cards.filter((c) => c.group === "auto").every((c) => c.kind === "report") && cards.some((c) => c.group === "not_recommended" && c.status === "declined" && c.declineReason), JSON.stringify(cards.filter((c) => c.group === "auto").map((c) => c.key)));
  check("every card carries its evidence in words and how it will be verified", cards.every((c) => c.why_he.length > 10 && (c.kind === "report" || c.kind === "runner" || c.verifyHow_he.length > 3)));
  check("the readiness gate is not passed yet, and says what waits", v.readiness !== null && !v.readiness.ready && v.readiness.items.some((i) => !i.ok));

  // A person's request from the chat becomes a card with questions.
  const req = await core.requestComponent(repoId, runId, by, { text: "תכין skill לעדכון base.txt" });
  check("'תכין skill לתהליך X' became a skill card with at most three questions", req.kind === "skill" && req.questions.length >= 1 && req.questions.length <= 3);

  // Decisions: everything as a set, then one declined with a reason, then the build.
  await core.decideComponentSet(repoId, runId, by, { decision: "approve" });
  await core.decideComponent(repoId, runId, by, { key: "mcp_random_mcp", decision: "decline", reason: "לא מאומת ויקר בהקשר" });
  await core.decideComponent(repoId, runId, by, { key: req.key, decision: "approve", answers: { when: "לפני כל release" } });
  v = await view(runId);
  check("the decisions are recorded with who and why", v.components.find((c) => c.key === "mcp_random_mcp")?.status === "declined" && v.components.find((c) => c.key === "mcp_random_mcp")?.declineReason === "לא מאומת ויקר בהקשר" && v.components.filter((c) => c.status === "proposed").length === 0);

  // The /init draft: a session left AGENTS.md and a settings file in the copy; the scan decides what of it to take.
  const ws = v.run.workspacePath!;
  writeFileSync(path.join(ws, "AGENTS.md"), "# prove-repo\n\nUse async/await everywhere.\n\nThe one file is `base.txt`; build with `npm run build`.\n");
  mkdirSync(path.join(ws, ".claude"), { recursive: true });
  writeFileSync(path.join(ws, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(*)"] } }));
  const callsBefore = k.calls().length;
  const started = await core.scanInitDraft(repoId, runId, by);
  v = await waitFor(runId, (x) => x.plan?.initScan?.state === "done" || x.plan?.initScan?.state === "failed", "the scan of the draft");
  const scan = v.plan!.initScan!;
  check("the scan read the draft the session left: its AGENTS.md and its settings file", started.files === 2 && scan.state === "done" && scan.files.includes("AGENTS.md") && scan.files.includes(".claude/settings.json"), JSON.stringify(scan));
  const scanCall = k.calls(callsBefore).find((x) => x.prompt.includes("You are the editor who decides"));
  check("the editor was handed our AGENTS.md, our cards and the draft, and a scan is a ledger row of the plan step", !!scanCall && /THEIRS[\s\S]*AGENTS\.md \(NEW/.test(scanCall.prompt) && scanCall.prompt.includes("[reviewer_1_doc]") && v.cost.rows.some((r) => r.capability === "onboarding_init_scan" && r.meta.stepKey === "plan"));
  const fromDraft = v.components.filter((c) => c.source === "init");
  const taken = (title: string) => fromDraft.find((c) => c.title_he === title);
  check("what the scan took is a card that waits for a person, even at a level that builds reversible cards alone — with its exact text", fromDraft.length === 4 && ["איפה הדברים", "build לפני סיום", "פרסום אחרי מיזוג"].every((t) => taken(t)?.group === "approval" && taken(t)?.status === "proposed") && taken("איפה הדברים")?.params.text === "The one file is `base.txt`; build with `npm run build`.", JSON.stringify(fromDraft.map((c) => [c.title_he, c.group, c.status])));
  check("a permission is not the scan's to grant: it is a question on its card", /צריך החלטה שלך: מותר לסוכן לפרסם/.test(taken("פרסום אחרי מיזוג")?.why_he ?? ""));
  check("a section naming paths the code does not have is not recommended, with the paths", taken("ארכיטקטורה")?.group === "not_recommended" && /src\/api\//.test(taken("ארכיטקטורה")?.why_he ?? ""));
  check("a settings file is not taken whole, and the generic line is left out — both said, with why", (scan.refused ?? []).some((r) => /settings\.json/.test(r.why)) && (scan.reject ?? []).some((r) => /async/.test(r.what)));
  check("a card of ours the scan finds redundant gets a note and stays the person's to decide; 'replaces' names only real cards", /סריקת \/init: /.test(v.components.find((c) => c.key === "reviewer_1_doc")?.why_he ?? "") && JSON.stringify(taken("build לפני סיום")?.params.replaces) === JSON.stringify(["reviewer_1_doc"]));
  await core.decideComponent(repoId, runId, by, { key: taken("איפה הדברים")!.key, decision: "approve" });
  await core.decideComponent(repoId, runId, by, { key: taken("build לפני סיום")!.key, decision: "approve" });
  await core.decideComponent(repoId, runId, by, { key: taken("פרסום אחרי מיזוג")!.key, decision: "decline", reason: "לא — אין פרסום אוטומטי" });
  const rescan = await core.scanInitDraft(repoId, runId, by);
  v = await waitFor(runId, (x) => x.plan?.initScan?.state === "done" && x.events.filter((e) => e.type === "onboarding.draft.scanned").length === 2, "the second scan");
  check("a second scan keeps the decisions already taken on the same text", rescan.files === 2 && v.components.find((c) => c.title_he === "איפה הדברים")?.status === "approved" && v.components.find((c) => c.title_he === "פרסום אחרי מיזוג")?.status === "declined");

  // 5. the build: by family, validated per kind, the trial again.
  await core.startBuild(repoId, runId, by);
  v = await waitFor(runId, (x) => stepOf(x, "deliver").status === "WaitingForUser", "the build", 300_000);
  const built = v.components;
  const dir = v.run.workspacePath!;
  const c = (key: string) => built.find((x) => x.key === key)!;
  check("the build gate hook was written and really run: a Stop that already continued does not loop", c("build_gate_hook").status === "verified" && c("build_gate_hook").files.includes(".claude/hooks/build-gate.mjs") && c("build_gate_hook").validation?.passed === true, JSON.stringify(c("build_gate_hook").validation));
  check("the local gate ran the real build and passed", c("local_gate_script").status === "verified" && /ok/.test(c("local_gate_script").validation?.detail ?? ""), JSON.stringify(c("local_gate_script").validation));
  check("AGENTS.md carries the facts and the approved rule lines; CLAUDE.md is the one-line pointer", existsSync(path.join(dir, "AGENTS.md")) && readFileSync(path.join(dir, "AGENTS.md"), "utf8").includes("npm run build") && readFileSync(path.join(dir, "CLAUDE.md"), "utf8").trim() === "@AGENTS.md");
  check("the skill from the process and the skill the person asked for have a frontmatter Claude Code loads", c("skill_release_build").status === "verified" && c(req.key).status === "verified" && existsSync(path.join(dir, c(req.key).files[0]!)), JSON.stringify([c("skill_release_build").validation, c(req.key).validation]));
  check("the agent from the process is read-only with a checklist", c("agent_release_publish").status === "verified" && /קריאה בלבד/.test(c("agent_release_publish").validation?.detail ?? ""), JSON.stringify(c("agent_release_publish").validation));
  check("the LSP plugin is registered in settings and honestly 'not verified here'", c("lsp_typescript_lsp").status === "installed" && c("lsp_typescript_lsp").validation?.passed === null && JSON.parse(readFileSync(path.join(dir, ".claude/settings.json"), "utf8")).enabledPlugins["typescript-lsp@claude-plugins-official"] === true);
  check("the declined component was not built", c("mcp_random_mcp").status === "declined" && c("mcp_random_mcp").files.length === 0 && !existsSync(path.join(dir, ".mcp.json")));
  check("a first test for a language the catalog has no template for is deferred, not faked", c("first_tests_scaffold").status === "deferred");
  const agents = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  const section = built.find((x) => x.title_he === "איפה הדברים")!;
  check("the draft was set aside before the build: its generic line and its settings are gone, and it is kept", !agents.includes("Use async/await") && !readFileSync(path.join(dir, ".claude/settings.json"), "utf8").includes("Bash(*)") && v.events.some((e) => e.type === "onboarding.draft.set_aside") && existsSync(path.join(runtimeDir(runId), "init-draft", "AGENTS.md")));
  check("what was approved from the draft went in after ours, as written, and was checked against the code", section.status === "verified" && agents.includes("## Where things are\n\nThe one file is `base.txt`") && agents.indexOf("## Where things are") > agents.indexOf("npm run build") && agents.includes("- Run `npm run build` before saying a change is done"), JSON.stringify(section.validation));
  check("what was declined or not recommended from the draft was not written", !agents.includes("Publish to the npm registry") && !agents.includes("## Architecture"));
  const build = v.build!;
  check("the trial ran again and the delta is measured against the baseline", build.delta !== null && build.delta!.before.total === base.length && build.delta!.after.total === base.length, JSON.stringify(build.delta));
  check("the joint check counted the always-loaded context and found no duplicate owner of a file", build.jointCheck.alwaysLoadedTokens > 0 && build.jointCheck.duplicates.length === 0, JSON.stringify(build.jointCheck));
  const files = (stepOf(v, "deliver").result as { files: string[] }).files;
  check("only the files of installed or verified components are offered for delivery, plus the repository's own dossier", files.includes("AGENTS.md") && files.includes(".claude/hooks/build-gate.mjs") && files.includes(".dcc/components.json") && !files.some((f) => f.includes(".mcp.json")), JSON.stringify(files));
  const dossier = JSON.parse(readFileSync(path.join(dir, ".dcc/components.json"), "utf8")) as { components: { key: string; status: string; declineReason: string | null }[] };
  check("the dossier in the repository records every card with its decision, the declined one included", dossier.components.some((x) => x.key === "mcp_random_mcp" && x.status === "declined" && x.declineReason) && !readFileSync(path.join(dir, ".dcc/profile.json"), "utf8").includes("Sup3r"));

  // 6. delivery: by name, in the person's identity, to the bare host, with the report from the cards.
  await core.deliverRun(repoId, runId, by);
  v = await waitFor(runId, (x) => x.run.status === "Completed", "delivery");
  const d = v.deliver!;
  check("the branch reached the host with one commit of the approved files", d.pushed && d.commitSha !== null && g(k.work, "--git-dir", path.join(k.work, "origin.git"), "rev-parse", "--verify", `refs/heads/${v.run.branchName}`).length > 0);
  const committed = g(k.work, "--git-dir", path.join(k.work, "origin.git"), "diff", "--name-only", `main..${v.run.branchName}`).split("\n").filter(Boolean);
  check("the commit holds exactly the delivered files — nothing else from the copy", committed.length === files.length && files.every((f) => committed.includes(f)), JSON.stringify({ committed, files }));
  check("the report reads 'התקנתי X כי Y', names what was declined and why, and the before/after", d.report.includes("## התקנתי") && d.report.includes("לא מאומת ויקר בהקשר") && d.report.includes("## לפני / אחרי") && d.report.includes("## כרטיס כנות ומוכנות"));
  check("the run is complete and every step ended", v.run.status === "Completed" && v.steps.every((s) => s.status === "Completed"));
  const events = v.events.map((e) => e.type);
  check("nothing was silent: the log has the profile, the correction, the interview, every trial task, the plan, every decision, every component built, the delivery", ["onboarding.profile.written", "onboarding.profile.corrected", "onboarding.interview.answered", "onboarding.trial.task", "onboarding.plan.drawn", "onboarding.card.decided", "onboarding.cards.decided_set", "onboarding.card.requested", "onboarding.draft.scanned", "onboarding.draft.set_aside", "onboarding.build.component", "onboarding.delivered", "onboarding.run.completed"].every((t) => events.includes(t)), JSON.stringify([...new Set(events)]));

  // 7. the coach reads the repository afterwards: no tasks yet, honest zeros; across repositories, numbers only.
  const coach = await core.coachView(repoId);
  check("the coach has no data yet and says so rather than inventing a score", coach.health.score === null && coach.health.tasks === 0 && coach.proposals.length === 0);
  check("across repositories the verified components are counted, nothing more", coach.acrossRepos.some((x) => x.key === "build_gate_hook" && x.repos === 1));
  check("the search's finds are remembered for the next repository with the same stack", (await core.listOnboardingRuns(repoId)).length === 1 && (await dbm.db.select().from(schema.marketplaceSource)).length === 2);
} catch (e) {
  check("the proof ran to the end", false, e instanceof Error ? e.stack ?? e.message : String(e));
}
await k.finish();

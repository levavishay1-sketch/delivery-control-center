import { readFileSync } from "node:fs";
import { POLICY_PATH, estimateUsd, formatPolicy, route } from "./routing.ts";

/**
 * Proves the routing rules against the global policy.
 *   npx tsx src/routing.prove.ts
 */
let pass = 0;
let fail = 0;
const eq = (name: string, got: string, want: string) =>
  got === want ? (pass++, console.log(`  \x1b[32mPASS\x1b[0m ${name}: ${got}`)) : (fail++, console.log(`  \x1b[31mFAIL\x1b[0m ${name}: got ${got}, want ${want}`));

console.log("\x1b[1mmodel routing\x1b[0m");
eq("chat is always cheap", route("chat", {}).tier, "haiku");
eq("chat, low effort", route("chat", {}).effort, "low");
eq("chat carries an input cap", String(route("chat", {}).maxInputTokens), "60000");
eq("code reading from the chat is sonnet", route("chat_code_read", {}).tier, "sonnet");
eq("gap_detection default", route("gap_detection", { ambiguity: "low" }).tier, "sonnet");
eq("gap_detection, high ambiguity escalates", route("gap_detection", { ambiguity: "high" }).tier, "opus");
eq("decomposition default", route("decomposition", { breadth: 2, openGaps: 0 }).tier, "sonnet");
eq("decomposition, cross-repo + gaps escalates", route("decomposition", { breadth: 5, openGaps: 4 }).tier, "opus");
eq("execution default", route("execution", { ambiguity: "medium" }).tier, "sonnet");
eq("execution, mechanical downgrades", route("execution", { mechanical: true }).tier, "haiku");
eq("execution, hairy escalates", route("execution", { novelty: "high", breadth: 6 }).tier, "opus");
eq("a person's model wins", route("decomposition", {}, undefined, { model: "claude-opus-5" }).model, "claude-opus-5");
eq("a tier alias equal to the default is not an override", String(route("gap_detection", {}, undefined, { model: "sonnet" }).rationale.includes("overridden")), "false");
eq("a tier alias resolves to its model", route("gap_detection", {}, undefined, { model: "opus" }).model, "claude-opus-5");
eq("the decision names the policy version", String(route("chat", {}).policyVersion > 0), "true");
eq("an estimate uses the list price", (estimateUsd("claude-haiku-4-5-20251001", { input: 1_000_000, output: 0 }) ?? 0).toFixed(2), "1.00");
eq("a tier alias prices like its model", (estimateUsd("sonnet", { output: 1_000_000 }) ?? 0).toFixed(2), "10.00");
// The editor writes the file back in its own layout, so a save reads as the changed lines (JSON cannot keep a trailing ".0", so those are normalised before comparing).
const fileText = readFileSync(POLICY_PATH, "utf8");
eq("a save keeps the file's layout", String(formatPolicy(JSON.parse(fileText)) + "\n" === fileText.replace(/(\d)\.0(?=[,\s}])/g, "$1")), "true");

const d = route("decomposition", { breadth: 5, openGaps: 4 });
console.log(`\n  sample rationale: "${d.rationale}"  → ${d.model}  (budget $${d.budgetUsd}, policy v${d.policyVersion})`);

console.log(`\n${fail === 0 ? `\x1b[32m✓ all ${pass} passed` : `\x1b[31m✗ ${fail} failed`}\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);

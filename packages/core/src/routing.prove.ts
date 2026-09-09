import { route } from "./routing.ts";

/**
 * Proves the routing rules against the global policy.
 *   node src/routing.prove.ts
 */
let pass = 0;
let fail = 0;
const eq = (name: string, got: string, want: string) =>
  got === want ? (pass++, console.log(`  \x1b[32mPASS\x1b[0m ${name}: ${got}`)) : (fail++, console.log(`  \x1b[31mFAIL\x1b[0m ${name}: got ${got}, want ${want}`));

console.log("\x1b[1mmodel routing\x1b[0m");
eq("brief, quiet", route("brief", { recentEvents: 5 }).tier, "haiku");
eq("brief, busy WorkItem escalates", route("brief", { recentEvents: 55 }).tier, "sonnet");
eq("matching is always cheap", route("matching", {}).tier, "haiku");
eq("gap_detection default", route("gap_detection", { ambiguity: "low" }).tier, "sonnet");
eq("gap_detection, high ambiguity escalates", route("gap_detection", { ambiguity: "high" }).tier, "opus");
eq("decomposition default", route("decomposition", { breadth: 2, openGaps: 0 }).tier, "sonnet");
eq("decomposition, cross-repo + gaps escalates", route("decomposition", { breadth: 5, openGaps: 4 }).tier, "opus");
eq("execution default", route("execution", { ambiguity: "medium" }).tier, "sonnet");
eq("execution, mechanical downgrades", route("execution", { mechanical: true }).tier, "haiku");
eq("execution, hairy escalates", route("execution", { novelty: "high", breadth: 6 }).tier, "opus");

const d = route("decomposition", { breadth: 5, openGaps: 4 });
console.log(`\n  sample rationale: "${d.rationale}"  → ${d.model}  (budget $${d.budgetUsd})`);

console.log(`\n${fail === 0 ? `\x1b[32m✓ all ${pass} passed` : `\x1b[31m✗ ${fail} failed`}\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);

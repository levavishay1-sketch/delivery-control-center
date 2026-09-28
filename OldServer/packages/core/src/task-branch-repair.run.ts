import { closeDb } from "@dcc/db";
import { recordTaskBranches } from "./task-branch-repair.ts";

const rows = await recordTaskBranches();
for (const r of rows) {
  const what = r.recorded ? (r.wasRight ? "already the right name" : `recorded ${r.recorded} (was looking for ${r.lookedFor})`) : "LOST — no branch of it exists in the clone";
  console.log(`${r.requirement ?? "?"} #${r.seq}: ${what}`);
}
console.log(`${rows.filter((r) => r.recorded).length} recorded, ${rows.filter((r) => r.lost).length} lost, ${rows.filter((r) => r.recorded && !r.wasRight).length} of them had been pointing at the wrong name`);
await closeDb();

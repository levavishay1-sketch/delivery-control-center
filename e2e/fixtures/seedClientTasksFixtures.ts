import "dotenv/config";
import { db } from "@/lib/db";
import { createProject } from "@/domain/project/commands";
import { createWorkItem, updateWorkItemStatus } from "@/domain/work-item/commands";
import type { AuthContext } from "@/domain/shared/context";

/**
 * A standalone CLI script (run via `tsx`, matching this project's convention for scripts outside
 * the Next.js/Vitest module systems — see worker.ts and seedModelSnapshot.ts) that seeds a
 * project plus WorkItem hierarchy fixtures for e2e/client-tasks-section.spec.ts.
 *
 * The project is created here (not via the Dashboard's AddProjectForm) because selecting a
 * client from that form's dropdown hits a pre-existing, already-documented environmental
 * hydration-mismatch flake (React discards and asynchronously remounts the tree, wiping the
 * form's local `name`/`key` state — reproduced consistently, unrelated to this slice's own
 * changes; see openspec/changes/client-tasks-section/tasks.md task 4.1's note). Going through
 * the real `createProject`/`createWorkItem`/`updateWorkItemStatus` domain commands (not raw DB
 * inserts) sidesteps that flake while still exercising real business logic, the same precedent
 * `seedModelSnapshot.ts` already established for "Playwright can't reliably drive this UI path."
 *
 * The standard UI's AddWorkItemForm can only create top-level TASK items — it has no type
 * selector and no way to set a parent — so a top-level PROJECT-type item, a BUG, and a child
 * WorkItem are also seeded here.
 */
async function main() {
  const command = process.argv[2];
  const clientId = process.argv[3];

  if (command !== "create" || !clientId) {
    throw new Error("Usage: seedClientTasksFixtures.ts create <clientId>");
  }

  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  const ctx: AuthContext = { userId: admin.id, displayName: "Admin", isOrgAdmin: true, memberships: [] };

  const suffix = Date.now().toString(36);
  const project = await createProject(ctx, { clientId, name: `Tasks Section Project ${suffix}`, key: `TSE${suffix}`.toUpperCase().slice(0, 10) });

  const { workItem: topLevelTask } = await createWorkItem(ctx, { projectId: project.id, title: `Top-level Task ${suffix}` });
  const { workItem: topLevelBug } = await createWorkItem(ctx, { projectId: project.id, title: `Top-level Bug ${suffix}`, type: "BUG" });
  const { workItem: topLevelProjectItem } = await createWorkItem(ctx, { projectId: project.id, title: `Top-level PROJECT item ${suffix}`, type: "PROJECT" });
  const { workItem: childItem } = await createWorkItem(ctx, {
    projectId: project.id,
    title: `Child item ${suffix}`,
    parentId: topLevelProjectItem.id,
  });
  const { workItem: closedItem } = await createWorkItem(ctx, { projectId: project.id, title: `Closed item ${suffix}` });
  await updateWorkItemStatus(ctx, closedItem.id, "CLOSED");

  process.stdout.write(
    JSON.stringify({
      topLevelTaskTitle: topLevelTask.title,
      topLevelBugTitle: topLevelBug.title,
      topLevelProjectTitle: topLevelProjectItem.title,
      childItemTitle: childItem.title,
      closedItemTitle: closedItem.title,
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

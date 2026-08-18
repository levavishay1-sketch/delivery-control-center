import "dotenv/config";
import { db } from "@/lib/db";

/**
 * A standalone CLI script (run via `tsx`, matching this project's convention for scripts outside
 * the Next.js/Vitest module systems — see worker.ts) that seeds/clears ModelSnapshot rows for
 * e2e/ai-model-knowledge-snapshot.spec.ts. Playwright's own test bundler cannot import
 * `@/lib/db` directly (the generated Prisma client's ESM `import.meta` usage fails under
 * Playwright's transform), so this runs as a child process instead, printing JSON to stdout for
 * the spec to parse.
 */
async function main() {
  const command = process.argv[2];

  if (command === "create") {
    const agent = await db.agent.findFirstOrThrow({ where: { isDefault: true } });
    const snapshot = await db.modelSnapshot.create({
      data: {
        status: "SUCCESS",
        rawContent: "e2e fixture",
        extractedModels: [{ modelId: agent.model, pricingText: "$3 per million tokens", contextWindowText: "200K token context" }],
      },
    });
    process.stdout.write(JSON.stringify({ agentModel: agent.model, snapshotId: snapshot.id, fetchedAt: snapshot.fetchedAt.toISOString() }));
    return;
  }

  if (command === "clear") {
    await db.modelSnapshot.deleteMany({});
    const agent = await db.agent.findFirstOrThrow({ where: { isDefault: true } });
    process.stdout.write(JSON.stringify({ agentModel: agent.model }));
    return;
  }

  if (command === "delete") {
    const id = process.argv[3];
    if (!id) throw new Error("Usage: seedModelSnapshot.ts delete <id>");
    await db.modelSnapshot.delete({ where: { id } });
    return;
  }

  throw new Error(`Unknown command "${command}". Expected create | clear | delete <id>.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

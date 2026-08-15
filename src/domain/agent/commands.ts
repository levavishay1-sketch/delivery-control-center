import { db } from "@/lib/db";
import { loadAgents } from "@/lib/config";

/**
 * Upserts every config/workflow.yaml `agents:` entry into the Agent table by
 * name — config is authoritative (design.md Decision 3's "no new config
 * file"); the DB row exists only so AgentRun/Pipeline.agentRouting can FK to
 * a stable id. Resets every row's isDefault to false first, then reapplies
 * from config in the same transaction, so a config change that moves
 * `default: true` to a different entry never leaves two rows marked default
 * (loadAgents() already validated the config itself names exactly one).
 */
export async function syncAgentRegistry() {
  const configured = loadAgents();
  return db.$transaction(async (tx) => {
    await tx.agent.updateMany({ data: { isDefault: false } });
    for (const agent of configured) {
      await tx.agent.upsert({
        where: { name: agent.name },
        create: { name: agent.name, provider: agent.provider, model: agent.model, isDefault: agent.isDefault },
        update: { provider: agent.provider, model: agent.model, isDefault: agent.isDefault },
      });
    }
    return tx.agent.findMany({ orderBy: { name: "asc" } });
  });
}

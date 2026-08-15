import { db } from "@/lib/db";

/** The registry's current default agent — the one config/workflow.yaml's `agents:` list marks `default: true`. */
export function getDefaultAgent() {
  return db.agent.findFirst({ where: { isDefault: true } });
}

export function getAgentById(id: string) {
  return db.agent.findUnique({ where: { id } });
}

export function listAgents() {
  return db.agent.findMany({ orderBy: { name: "asc" } });
}

/** The AgentRun tracking a given Job's attempt-cycle, if one has been started yet. */
export function getAgentRunByJobId(jobId: string) {
  return db.agentRun.findFirst({ where: { jobId } });
}

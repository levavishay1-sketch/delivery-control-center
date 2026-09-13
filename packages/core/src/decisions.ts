import { appendEvent } from "@dcc/db";

export type DecisionTrigger = "rebreakdown" | "task_closed_override" | "task_reopened" | "requirement_reopened" | "direction_changed";

/**
 * Records the WHY behind a course-changing decision — re-breakdown, a
 * task closed/reopened despite something unresolved, a requirement
 * reopened, or a direction change. A separate event type from
 * `note.added` on purpose (architecture notes, `decision-history`): the
 * requirement's history and final summary need to be able to pull out
 * "what decisions were made and why" without guessing which freeform
 * notes happen to be decisions versus routine commentary.
 */
export async function recordDecision(input: {
  clientId: string;
  workitemId: string;
  by: { userId: string };
  trigger: DecisionTrigger;
  reason: string;
  links?: { rel: "task" | "ado_workitem"; ref: string }[];
}) {
  return appendEvent({
    clientId: input.clientId,
    workitemId: input.workitemId,
    source: "manual",
    type: "decision.made",
    actor: { kind: "user", userId: input.by.userId, identityType: "interactive" },
    links: input.links ?? [],
    payload: { trigger: input.trigger, reason: input.reason.trim() },
  });
}

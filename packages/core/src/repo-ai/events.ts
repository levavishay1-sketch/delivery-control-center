import { withTenant } from "@dcc/db";
import { repoAiEvent } from "@dcc/db/schema";

/**
 * The ONE way to write to `repo_ai_event` — same discipline as
 * `appendEvent()` for `event_log` (CLAUDE.md: "Only appendEvent() writes
 * to event_log — never a raw INSERT"), applied to this Repository-scoped
 * sibling stream. See the schema file for why this is a separate table
 * rather than `event_log` rows with a null `workitem_id`.
 */
export async function appendRepoAiEvent(input: {
  clientId: string;
  repoId: string;
  type: string;
  payload: unknown;
  actorUserId?: string | null;
}) {
  return withTenant(input.clientId, (tx) =>
    tx.insert(repoAiEvent).values({
      clientId: input.clientId,
      repoId: input.repoId,
      type: input.type,
      payload: input.payload as object,
      actorUserId: input.actorUserId ?? null,
    }).returning(),
  );
}

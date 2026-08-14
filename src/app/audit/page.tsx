import Link from "next/link";
import { listRecentAuditEvents } from "@/domain/audit/queries";
import { requireAuthContext } from "@/domain/shared/session";

export const dynamic = "force-dynamic";

const ACTOR_ICON: Record<string, string> = { SYSTEM: "⚙️", AI: "🤖", USER: "🧑" };

export default async function AuditTrailPage() {
  const ctx = await requireAuthContext();
  const events = await listRecentAuditEvents(ctx);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Audit Trail</h1>
      <p className="text-sm opacity-60">Every decision, draft, approval, and cost — in order, nothing hidden.</p>

      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
        {events.map((event) => (
          <div key={event.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {ACTOR_ICON[event.actor]} {event.action}
              </span>
              <time className="shrink-0 text-xs opacity-50">{event.createdAt.toLocaleString()}</time>
            </div>
            <div className="flex flex-wrap gap-2 text-xs opacity-50">
              {event.actorName && <span>by {event.actorName}</span>}
              {event.pipeline && (
                <Link href={`/pipelines/${event.pipeline.id}`} className="underline">
                  {event.pipeline.workItem.title}
                </Link>
              )}
              {event.project && !event.pipeline && <span>{event.project.name}</span>}
              {event.stage && <span>· {event.stage.type}</span>}
            </div>
            {event.detail !== null && event.detail !== undefined && (
              <pre className="mt-1 whitespace-pre-wrap rounded bg-black/[.03] dark:bg-white/[.05] p-2 text-xs font-mono">
                {JSON.stringify(event.detail)}
              </pre>
            )}
          </div>
        ))}
        {events.length === 0 && <p className="px-4 py-6 text-sm opacity-50">No events recorded yet.</p>}
      </div>
    </div>
  );
}

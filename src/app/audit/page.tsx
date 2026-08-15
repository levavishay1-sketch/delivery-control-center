import Link from "next/link";
import { listAuditEvents, getAuditActors, ACTION_CATEGORIES, type ActionCategoryKey } from "@/domain/audit/queries";
import { listProjectsWithCounts } from "@/domain/project/queries";
import { requireAuthContext } from "@/domain/shared/session";

export const dynamic = "force-dynamic";

const ACTOR_ICON: Record<string, string> = { SYSTEM: "⚙️", AI: "🤖", USER: "🧑" };
const PAGE_SIZES = [20, 50, 100];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditTrailPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await requireAuthContext();
  const sp = await searchParams;

  const projectId = firstParam(sp.project) || undefined;
  const actorId = firstParam(sp.actor) || undefined;
  const actionCategoryRaw = firstParam(sp.action) || undefined;
  const actionCategory = ACTION_CATEGORIES.some((c) => c.key === actionCategoryRaw) ? (actionCategoryRaw as ActionCategoryKey) : undefined;
  const dateFrom = firstParam(sp.from) ? new Date(`${firstParam(sp.from)}T00:00:00.000Z`) : undefined;
  const dateTo = firstParam(sp.to) ? new Date(`${firstParam(sp.to)}T23:59:59.999Z`) : undefined;
  const page = Math.max(1, Number(firstParam(sp.page)) || 1);
  const pageSizeRaw = Number(firstParam(sp.pageSize));
  const pageSize = PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : 20;

  const [{ events, total }, projects, actors] = await Promise.all([
    listAuditEvents(ctx, { projectId, actorId, actionCategory, dateFrom, dateTo, page, pageSize }),
    listProjectsWithCounts(ctx),
    getAuditActors(ctx, projectId),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const hasFilters = !!(projectId || actorId || actionCategory || firstParam(sp.from) || firstParam(sp.to));

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    if (actorId) params.set("actor", actorId);
    if (actionCategory) params.set("action", actionCategory);
    if (firstParam(sp.from)) params.set("from", firstParam(sp.from)!);
    if (firstParam(sp.to)) params.set("to", firstParam(sp.to)!);
    params.set("pageSize", String(pageSize));
    params.set("page", String(targetPage));
    return `/audit?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Audit Trail</h1>
        <p className="text-sm opacity-60">Every decision, draft, approval, and cost — in order, nothing hidden.</p>
        <p className="mt-1 text-xs opacity-50">
          Showing {from}–{to} of {total} events{hasFilters ? " (filtered)" : ""}
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 dark:border-white/15 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="project" className="text-xs opacity-70">
            Project
          </label>
          <select id="project" name="project" defaultValue={projectId ?? ""} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="actor" className="text-xs opacity-70">
            Actor
          </label>
          <select id="actor" name="actor" defaultValue={actorId ?? ""} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            <option value="">All actors</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-xs opacity-70">
            Action
          </label>
          <select id="action" name="action" defaultValue={actionCategory ?? ""} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            <option value="">All actions</option>
            {ACTION_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs opacity-70">
            From
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={firstParam(sp.from) ?? ""}
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs opacity-70">
            To
          </label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={firstParam(sp.to) ?? ""}
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="pageSize" className="text-xs opacity-70">
            Rows per page
          </label>
          <select id="pageSize" name="pageSize" defaultValue={String(pageSize)} className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm">
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background">
            Apply Filters
          </button>
          {hasFilters && (
            <Link href="/audit" className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 text-sm hover:bg-black/[.03] dark:hover:bg-white/[.04]">
              Clear Filters
            </Link>
          )}
        </div>
      </form>

      <div className="flex flex-col divide-y divide-black/10 dark:divide-white/10 rounded-lg border border-black/10 dark:border-white/15">
        {events.map((event) => (
          <div key={event.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {ACTOR_ICON[event.actor]} {event.action}
              </span>
              <time className="shrink-0 text-xs opacity-50" title={event.createdAt.toISOString()}>
                {event.createdAt.toLocaleString()}
              </time>
            </div>
            <div className="flex flex-wrap gap-2 text-xs opacity-50">
              {event.actorName && <span>by {event.actorName}</span>}
              {event.workItem?.pipeline && (
                <Link href={`/pipelines/${event.workItem.pipeline.id}`} className="underline">
                  {event.workItem.title}
                </Link>
              )}
              {!event.workItem && event.pipeline && (
                <Link href={`/pipelines/${event.pipeline.id}`} className="underline">
                  {event.pipeline.workItem.title}
                </Link>
              )}
              {event.project && !event.workItem && !event.pipeline && <span>{event.project.name}</span>}
              {event.stage && <span>· {event.stage.type}</span>}
            </div>
            {event.detail !== null && event.detail !== undefined && (
              <pre className="mt-1 whitespace-pre-wrap rounded bg-black/[.03] dark:bg-white/[.05] p-2 text-xs font-mono">
                {JSON.stringify(event.detail)}
              </pre>
            )}
          </div>
        ))}
        {events.length === 0 && (
          <p className="px-4 py-6 text-sm opacity-50">{hasFilters ? "No events match these filters." : "No events recorded yet."}</p>
        )}
      </div>

      {totalPages > 1 && (
        <nav aria-label="Audit trail pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/[.03] dark:hover:bg-white/[.04]">
              Previous
            </Link>
          ) : (
            <span className="rounded border border-black/10 dark:border-white/10 px-3 py-1.5 opacity-40">Previous</span>
          )}
          <span className="opacity-60">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="rounded border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/[.03] dark:hover:bg-white/[.04]">
              Next
            </Link>
          ) : (
            <span className="rounded border border-black/10 dark:border-white/10 px-3 py-1.5 opacity-40">Next</span>
          )}
        </nav>
      )}
    </div>
  );
}

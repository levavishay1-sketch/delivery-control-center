import Link from "next/link";
import { listAuditEvents, getAuditActors, ACTION_CATEGORIES, type ActionCategoryKey } from "@/domain/audit/queries";
import { listProjectsWithCounts } from "@/domain/project/queries";
import { requireAuthContext } from "@/domain/shared/session";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, Input, Select } from "@/components/ui/FormField";
import { RowList, RowEmpty } from "@/components/ui/Row";
import { AuditEventRow } from "@/components/ui/AuditEventRow";

export const dynamic = "force-dynamic";

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
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Audit Trail</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Every decision, draft, approval, and cost — in order, nothing hidden.
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          Showing {from}–{to} of {total} events{hasFilters ? " (filtered)" : ""}
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-card border border-border-hairline bg-surface-muted p-4">
        <FormField label="Project" htmlFor="project">
          <Select id="project" name="project" defaultValue={projectId ?? ""}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Actor" htmlFor="actor">
          <Select id="actor" name="actor" defaultValue={actorId ?? ""}>
            <option value="">All actors</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Action" htmlFor="action">
          <Select id="action" name="action" defaultValue={actionCategory ?? ""}>
            <option value="">All actions</option>
            {ACTION_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="From" htmlFor="from">
          <Input id="from" type="date" name="from" defaultValue={firstParam(sp.from) ?? ""} />
        </FormField>

        <FormField label="To" htmlFor="to">
          <Input id="to" type="date" name="to" defaultValue={firstParam(sp.to) ?? ""} />
        </FormField>

        <FormField label="Rows per page" htmlFor="pageSize">
          <Select id="pageSize" name="pageSize" defaultValue={String(pageSize)}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            Apply Filters
          </Button>
          {hasFilters && (
            <Link href="/audit" className={buttonClasses("secondary")}>
              Clear Filters
            </Link>
          )}
        </div>
      </form>

      <RowList>
        {events.map((event) => (
          <AuditEventRow
            key={event.id}
            actor={event.actor}
            action={event.action}
            time={event.createdAt.toLocaleString()}
            timeTitle={event.createdAt.toISOString()}
            detail={event.detail}
            meta={
              <>
                {event.actorName && <span>by {event.actorName}</span>}
                {event.workItem?.pipeline && (
                  <Link href={`/pipelines/${event.workItem.pipeline.id}`} className="text-accent hover:underline">
                    {event.workItem.title}
                  </Link>
                )}
                {!event.workItem && event.pipeline && (
                  <Link href={`/pipelines/${event.pipeline.id}`} className="text-accent hover:underline">
                    {event.pipeline.workItem.title}
                  </Link>
                )}
                {event.project && !event.workItem && !event.pipeline && <span>{event.project.name}</span>}
                {event.stage && <span>· {event.stage.type}</span>}
              </>
            }
          />
        ))}
        {events.length === 0 && <RowEmpty>{hasFilters ? "No events match these filters." : "No events recorded yet."}</RowEmpty>}
      </RowList>

      {totalPages > 1 && (
        <nav aria-label="Audit trail pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonClasses("secondary", "sm")}>
              Previous
            </Link>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Previous
            </Button>
          )}
          <span className="text-neutral-500 dark:text-neutral-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className={buttonClasses("secondary", "sm")}>
              Next
            </Link>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Next
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}

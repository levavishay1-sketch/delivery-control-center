import type { ReactNode } from "react";
import { Row } from "@/components/ui/Row";

const ACTOR_ICON: Record<string, string> = { SYSTEM: "⚙️", AI: "🤖", USER: "🧑" };

/**
 * The shared audit-event row presentation (design-system spec's "Duplicate
 * status and action components are consolidated" requirement) — used by
 * both the full Audit Trail page (server-paginated, every project) and the
 * 360° Record's Timeline tab (client-paginated, one work item), which
 * previously hand-rolled the same actor-icon/action/time/meta/detail
 * layout independently. Each caller keeps its own pagination mechanism —
 * that difference is real (global feed vs. scoped feed), not duplication —
 * only the row's presentation is shared. Reuses `Row` in its existing
 * flex-column mode, the same pattern the Dashboard's recent-activity list
 * already established, rather than a new row shell.
 */
export function AuditEventRow({
  actor,
  action,
  time,
  timeTitle,
  meta,
  detail,
}: {
  actor: string;
  action: string;
  time: string;
  timeTitle?: string;
  /** by-actor text, links to the related pipeline/project, stage type — varies per caller. */
  meta?: ReactNode;
  detail?: unknown;
}) {
  return (
    <Row className="flex-col items-start gap-1">
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-sm">
          {ACTOR_ICON[actor]} {action}
        </span>
        <time className="shrink-0 text-xs text-neutral-400" title={timeTitle}>
          {time}
        </time>
      </div>
      {meta && <div className="flex flex-wrap gap-2 text-xs text-neutral-500 dark:text-neutral-400">{meta}</div>}
      {detail !== null && detail !== undefined && (
        <pre className="mt-1 w-full whitespace-pre-wrap rounded-md bg-surface-muted p-2 text-xs font-mono">
          {JSON.stringify(detail)}
        </pre>
      )}
    </Row>
  );
}

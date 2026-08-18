"use client";

import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { formatDateTime, formatMessage } from "@/lib/i18n/format";

const ACTOR_ICON: Record<string, string> = { SYSTEM: "⚙️", AI: "🤖", USER: "🧑" };

interface AuditEventRow {
  id: string;
  actor: string;
  actorName: string | null;
  action: string;
  detail: unknown;
  createdAt: string;
}

export function TimelineTab({ workItemId, initialEvents, initialTotal }: { workItemId: string; initialEvents: AuditEventRow[]; initialTotal: number }) {
  const t = useT();
  const { locale } = useLocale();
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState(initialEvents);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function goToPage(nextPage: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/work-items/${workItemId}/audit?page=${nextPage}`);
      const data = await res.json();
      setEvents(data.events);
      setTotal(data.total);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }

  if (total === 0) {
    return <p className="text-sm opacity-50">{t.timeline.noActivity}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-border-hairline rounded-lg border border-border-hairline">
        {events.map((event) => (
          <div key={event.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {ACTOR_ICON[event.actor]} {event.action}
              </span>
              <time
                className="shrink-0 text-xs opacity-50"
                title={formatDateTime(event.createdAt, locale)}
              >
                {formatDateTime(event.createdAt, locale)}
              </time>
            </div>
            {event.actorName && <span className="text-xs opacity-50">{formatMessage(t.common.byActor, { name: event.actorName })}</span>}
            {event.detail !== null && event.detail !== undefined && (
              <pre className="mt-1 whitespace-pre-wrap rounded bg-surface-muted p-2 text-xs font-mono">
                {JSON.stringify(event.detail)}
              </pre>
            )}
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => goToPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="rounded border border-border-hairline px-2 py-1 disabled:opacity-40"
          >
            {t.timeline.previous}
          </button>
          <span className="opacity-60">{formatMessage(t.timeline.pageOf, { page, total: totalPages })}</span>
          <button
            onClick={() => goToPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="rounded border border-border-hairline px-2 py-1 disabled:opacity-40"
          >
            {t.timeline.next}
          </button>
        </div>
      )}
    </div>
  );
}

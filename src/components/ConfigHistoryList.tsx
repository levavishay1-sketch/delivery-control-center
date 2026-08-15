interface ConfigChangeEntry {
  id: string;
  oldValueUsd: string | null;
  newValueUsd: string | null;
  changedByUser: { name: string | null; email: string };
  createdAt: string;
}

/** Renders a scope's AI-budget change history, most recent first (configuration-center spec's version-history requirement). */
export function ConfigHistoryList({ history }: { history: ConfigChangeEntry[] }) {
  if (history.length === 0) {
    return <p className="text-xs opacity-50">No budget changes yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {history.map((entry) => (
        <div
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 dark:border-white/10 px-3 py-2 text-xs"
        >
          <span className="font-mono">
            {entry.oldValueUsd ? `$${entry.oldValueUsd}` : "No limit"} → {entry.newValueUsd ? `$${entry.newValueUsd}` : "No limit"}
          </span>
          <span className="opacity-60">{entry.changedByUser.name ?? entry.changedByUser.email}</span>
          <span className="opacity-50">{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

import { RowList, RowListHeader, Row } from "@/components/ui/Row";

interface ConfigChangeEntry {
  id: string;
  oldValueUsd: string | null;
  newValueUsd: string | null;
  changedByUser: { name: string | null; email: string };
  createdAt: string;
}

const COLUMNS = "2fr 1fr 1fr";

/**
 * Renders a scope's AI-budget change history, most recent first
 * (configuration-center spec's version-history requirement) — each entry
 * has three genuinely comparable fields (value change, changed-by, when),
 * so this uses `Row`'s column-grid mode (design-system spec's aligned-
 * column requirement) rather than the single-line row shape.
 */
export function ConfigHistoryList({ history }: { history: ConfigChangeEntry[] }) {
  if (history.length === 0) {
    return <p className="text-xs text-neutral-400">No budget changes yet.</p>;
  }

  return (
    <RowList>
      <RowListHeader columns={COLUMNS}>
        <span>Change</span>
        <span>Changed by</span>
        <span className="text-end">When</span>
      </RowListHeader>
      {history.map((entry) => (
        <Row key={entry.id} columns={COLUMNS} className="text-xs">
          <span className="font-mono">
            {entry.oldValueUsd ? `$${entry.oldValueUsd}` : "No limit"} → {entry.newValueUsd ? `$${entry.newValueUsd}` : "No limit"}
          </span>
          <span className="text-neutral-500 dark:text-neutral-400">{entry.changedByUser.name ?? entry.changedByUser.email}</span>
          <span className="text-end text-neutral-400">{new Date(entry.createdAt).toLocaleString()}</span>
        </Row>
      ))}
    </RowList>
  );
}

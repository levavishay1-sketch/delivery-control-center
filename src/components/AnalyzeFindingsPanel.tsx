const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "WARNING", "INFO"] as const;

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "text-status-critical",
  HIGH: "text-status-critical",
  MEDIUM: "text-status-warning",
  WARNING: "text-status-warning",
  INFO: "text-status-inactive",
};

export interface AnalyzeFinding {
  id: string;
  severity: string;
  message: string;
  relatedStageType: string;
}

/** Read-only display of an ANALYZE stage's findings, grouped by severity — Task Group 7.4. */
export function AnalyzeFindingsPanel({ findings }: { findings: AnalyzeFinding[] }) {
  if (findings.length === 0) {
    return <p className="mt-3 text-xs text-status-healthy">No consistency issues found.</p>;
  }

  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: findings.filter((f) => f.severity === severity),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mt-3 flex flex-col gap-2" aria-label="Analyze findings">
      {grouped.map((g) => (
        <div key={g.severity}>
          <p className={`text-xs font-semibold ${SEVERITY_STYLE[g.severity] ?? ""}`}>
            {g.severity} ({g.items.length})
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
            {g.items.map((f) => (
              <li key={f.id}>
                <span className="text-neutral-400">[{f.relatedStageType}]</span> {f.message}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

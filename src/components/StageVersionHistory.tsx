export interface StageVersionItem {
  id: string;
  versionNumber: number;
  content: string | null;
  createdAsResultOf: string;
  createdAt: Date;
  aiModel: string | null;
}

/** Expandable, append-only draft history for a stage (Task Group 5's StageVersion model) — Task Group 10.2. */
export function StageVersionHistory({ versions }: { versions: StageVersionItem[] }) {
  if (versions.length <= 1) return null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-accent hover:underline">Version history ({versions.length})</summary>
      <div className="mt-2 flex flex-col gap-2">
        {versions.map((v) => (
          <details key={v.id} className="rounded-md border border-border-hairline bg-surface p-2">
            <summary className="flex cursor-pointer items-center justify-between text-xs">
              <span>
                v{v.versionNumber} — {v.createdAsResultOf.toLowerCase()}
              </span>
              <span className="text-neutral-400">{v.createdAt.toDateString()}</span>
            </summary>
            {v.aiModel && <p className="mt-1 text-xs text-neutral-400">{v.aiModel}</p>}
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-muted p-2 text-xs font-mono">{v.content}</pre>
          </details>
        ))}
      </div>
    </details>
  );
}

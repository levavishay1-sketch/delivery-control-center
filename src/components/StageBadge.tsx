const STYLES: Record<string, string> = {
  PENDING: "bg-black/5 dark:bg-white/10 text-current",
  AI_DRAFTING: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  APPROVED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  DONE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  REJECTED: "bg-red-500/15 text-red-600 dark:text-red-400",
  ACTIVE: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  BLOCKED: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function StageBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.PENDING}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

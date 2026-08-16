interface AvatarMember {
  id: string;
  name: string | null;
  email: string;
}

function initials(member: AvatarMember): string {
  const source = member.name ?? member.email;
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * Overlapping member avatars with an overflow count — "who's involved," per
 * the dashboard-motifs-refresh proposal's adopted reference motif. No avatar
 * image is populated anywhere in this app yet (Credentials auth, no OAuth
 * image upload flow), so every avatar renders as an initials circle — not a
 * placeholder image, an honest fallback.
 */
export function AvatarStack({ members, max = 3, className = "" }: { members: AvatarMember[]; max?: number; className?: string }) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <div className={`flex items-center ${className}`}>
      {shown.map((member, i) => (
        <span
          key={member.id}
          title={member.name ?? member.email}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-muted text-2xs font-medium text-neutral-600 ring-2 ring-surface dark:text-neutral-300"
          style={i > 0 ? { marginInlineStart: "-0.5rem" } : undefined}
        >
          {initials(member)}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-2xs font-medium text-neutral-600 ring-2 ring-surface dark:bg-neutral-700 dark:text-neutral-300"
          style={{ marginInlineStart: "-0.5rem" }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

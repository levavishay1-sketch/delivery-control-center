import type { ReactNode } from "react";

export const initials = (s: string) =>
  s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export function Icon({ d, size = 17 }: { d: ReactNode; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}
export const ICONS = {
  dashboard: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" /></>,
  folder: <><path d="M4 4h5l2 3h9v13H4z" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  branch: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></>,
  slash: <><circle cx="12" cy="12" r="10" /><path d="M4.9 4.9l14.2 14.2" /></>,
  triangle: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  export: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
};

export function Pill({ tone, children }: { tone: "warning" | "critical" | "active" | "healthy" | "ai" | "inactive"; children: ReactNode }) {
  return <span className={`pill ${tone}`}><span className="dot" />{children}</span>;
}

export function TypeChip({ type }: { type: "epic" | "feature" | "story" | "bug" | "task" | "spike" }) {
  const label = { epic: "Epic", feature: "Feature", story: "Story", bug: "Bug", task: "Task", spike: "Spike" }[type];
  return <span className={`type-chip ${type}`}>{label}</span>;
}

const PILL_FOR: Record<string, { tone: "critical" | "active" | "ai" | "healthy"; label: string }> = {
  blocked: { tone: "critical", label: "Blocked" },
  in_pipeline: { tone: "active", label: "In pipeline" },
  ai_drafting: { tone: "ai", label: "AI drafting" },
  done: { tone: "healthy", label: "Done" },
};
export function StatusPill({ status }: { status: string }) {
  const p = PILL_FOR[status] ?? { tone: "active" as const, label: status };
  return <Pill tone={p.tone}>{p.label}</Pill>;
}

export function PageHead({ title, sub, crumb, actions }: { title: ReactNode; sub?: string; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="titles">
        {crumb && <p className="crumb">{crumb}</p>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

export function StatTile({ tone, num, label, onClick }: { tone: string; num: ReactNode; label: string; onClick?: () => void }) {
  return (
    <div className="stat-tile" onClick={onClick} role="button" tabIndex={0}>
      <span className={`badge-circle tone-${tone}`}>
        <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {tone === "critical" ? ICONS.slash : tone === "warning" ? ICONS.alert : ICONS.calendar}
        </svg>
      </span>
      <span><span className="num">{num}</span><span className="lbl">{label}</span></span>
    </div>
  );
}

import { useState, type ReactNode } from "react";

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
  message: <><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
};

export function Pill({ tone, children }: { tone: "warning" | "critical" | "active" | "healthy" | "ai" | "inactive" | "neutral"; children: ReactNode }) {
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

/**
 * The one mandatory checkpoint before anything reaches Claude: the user
 * sees the exact prompt — Hebrew for reading, English because that's what
 * actually runs — and sending only happens from the confirm button here.
 * There is deliberately no other way to fire the underlying action; every
 * screen that talks to Claude opens this first (architecture decision,
 * 2026-09-12).
 */
export function PromptPreviewModal({
  title, data, loading, error, onClose, onConfirm, confirming, confirmLabel, disabledReason, reasonField,
}: {
  title: string;
  data: { prompt: string; promptHe: string } | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
  confirmLabel: string;
  /** set = confirm is disabled and this explains why (e.g. not approved yet) */
  disabledReason?: string | null;
  /** A course-changing action (e.g. re-breakdown) asks for a reason
   *  right here, before confirm — the decision-history capture point
   *  (design notes, `decision-history`). Confirm stays disabled until
   *  it's filled. */
  reasonField?: { label: string; value: string; onChange: (v: string) => void };
}) {
  const [lang, setLang] = useState<"he" | "en">("he");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(760px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)",
        border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl", textAlign: "start",
        boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
          <a onClick={onClose} style={{
            fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)",
          }}>✕</a>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>
          זה בדיוק מה שיישלח ל-Claude (הפרומפט האמיתי תמיד רץ באנגלית — התצוגה בעברית היא לנוחות הקריאה בלבד).
        </p>
        {loading ? (
          <div className="spin">טוען…</div>
        ) : data ? (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              <button className={`btn btn-sm ${lang === "he" ? "btn-primary" : "btn-secondary"}`} onClick={() => setLang("he")}>עברית</button>
              <CopyBtn text={data.promptHe} />
              <span style={{ width: 1, height: 16, background: "var(--border-hairline)", margin: "0 4px" }} />
              <button className={`btn btn-sm ${lang === "en" ? "btn-primary" : "btn-secondary"}`} onClick={() => setLang("en")}>English</button>
              <CopyBtn text={data.prompt} />
            </div>
            <pre style={{
              whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.7, fontFamily: lang === "en" ? "var(--mono)" : "inherit",
              direction: lang === "en" ? "ltr" : "rtl", textAlign: lang === "en" ? "left" : "start",
              background: "var(--surface-muted)", borderRadius: 10, padding: 14, margin: "0 0 16px",
              maxHeight: "40vh", overflowY: "auto",
            }}>
              {lang === "he" ? data.promptHe : data.prompt}
            </pre>
          </>
        ) : null}
        {error && <p style={{ fontSize: 12.5, color: "var(--status-critical)", marginBottom: 12 }}>{error}</p>}
        {disabledReason && <p style={{ fontSize: 12.5, color: "var(--status-warning)", marginBottom: 12 }}>{disabledReason}</p>}
        {reasonField && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label>{reasonField.label}</label>
            <textarea
              value={reasonField.value} onChange={(e) => reasonField.onChange(e.target.value)} rows={2}
              placeholder="למה עכשיו? מה השתנה מאז הפעם הקודמת?"
              style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={!data || confirming || !!disabledReason || (!!reasonField && !reasonField.value.trim())} onClick={onConfirm}>
            {confirming ? "שולח…" : confirmLabel}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

/** A copy-to-clipboard link, used everywhere a prompt (or any long text
 *  block) is shown — next to the language it copies, so it stays correct
 *  even when that language isn't the one currently displayed. */
export function CopyBtn({ text, label = "העתק" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <a
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ fontSize: 11, color: copied ? "var(--status-healthy)" : "var(--ink-500)", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
    >
      {copied ? "✓ הועתק" : `⧉ ${label}`}
    </a>
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

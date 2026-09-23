import { useState, type CSSProperties, type ReactNode } from "react";
import { Info } from "./claude/Info.tsx";

export const initials = (s: string) =>
  s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Inline `code`/**bold** spans within one line of RichText. */
function inlineSpans(line: string, keyBase: string): ReactNode[] {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={`${keyBase}-${i}`} style={{ background: "var(--surface-muted)", padding: "1px 5px", borderRadius: 4, fontSize: "0.92em", direction: "ltr", unicodeBidi: "isolate" }}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}

type RichLine = { kind: "h" | "p" | "ul" | "ol"; text: string; indent: number };

/** One list item, with its (at most one level of) nested sub-items. */
type ListItem = { text: string; sub: string[] };

/**
 * Renders AI-generated / hand-formatted free text (knowledge baseline
 * sections etc.) with real structure instead of one raw pre-wrap blob:
 *   `## Heading`        — a sub-heading within the section
 *   `- item` / `* item` — a bullet; a further-indented `- `/`* ` right
 *                         after it nests as that bullet's sub-list
 *   `1. item`           — an ordered list (numbering from the text itself)
 *   blank line          — paragraph break
 *   `` `code` ``, `**bold**` — inline, everywhere
 * Deliberately lightweight — not a full Markdown parser, just what these
 * prompts (and hand-authored corrections) actually use.
 */
export function RichText({ text }: { text: string }) {
  if (!text?.trim()) return null;
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const lines: RichLine[] = [];
  for (const l of raw) {
    if (!l.trim()) { lines.push({ kind: "p", text: "", indent: 0 }); continue; }
    const indent = (l.match(/^\s*/)?.[0].length ?? 0) >= 2 ? 1 : 0;
    const trimmed = l.trim();
    const h = trimmed.match(/^#{1,3}\s+(.*)$/);
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    const ul = trimmed.match(/^[-*•]\s+(.*)$/);
    if (h) lines.push({ kind: "h", text: h[1]!, indent: 0 });
    else if (ol) lines.push({ kind: "ol", text: ol[1]!, indent });
    else if (ul) lines.push({ kind: "ul", text: ul[1]!, indent });
    else lines.push({ kind: "p", text: trimmed, indent: 0 });
  }

  type Block = { kind: "h" | "p" | "ul" | "ol"; items: ListItem[] };
  const blocks: Block[] = [];
  for (const ln of lines) {
    const last = blocks[blocks.length - 1];
    if (ln.kind === "p" && !ln.text) { if (last?.kind === "p") blocks.push({ kind: "p", items: [] }); continue; }
    if (ln.kind === "h") { blocks.push({ kind: "h", items: [{ text: ln.text, sub: [] }] }); continue; }
    if (ln.kind === "p") {
      if (last?.kind === "p" && last.items.length) last.items[last.items.length - 1]!.text += ` ${ln.text}`;
      else blocks.push({ kind: "p", items: [{ text: ln.text, sub: [] }] });
      continue;
    }
    // ul / ol
    if (ln.indent === 1 && (last?.kind === "ul" || last?.kind === "ol") && last.items.length) {
      last.items[last.items.length - 1]!.sub.push(ln.text);
    } else if (last?.kind === ln.kind) {
      last.items.push({ text: ln.text, sub: [] });
    } else {
      blocks.push({ kind: ln.kind, items: [{ text: ln.text, sub: [] }] });
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {blocks.filter((b) => b.items.length > 0).map((b, bi) => {
        if (b.kind === "h") return <p key={bi} style={{ margin: "4px 0 -4px", fontSize: 13, fontWeight: 700, color: "var(--ink-700)" }}>{inlineSpans(b.items[0]!.text, `${bi}`)}</p>;
        if (b.kind === "p") return (
          <div key={bi} style={{ display: "grid", gap: 6 }}>
            {b.items.map((it, li) => <p key={li} style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7 }}>{inlineSpans(it.text, `${bi}-${li}`)}</p>)}
          </div>
        );
        const Tag = b.kind === "ol" ? "ol" : "ul";
        return (
          <Tag key={bi} style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 6 }}>
            {b.items.map((it, li) => (
              <li key={li} style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                {inlineSpans(it.text, `${bi}-${li}`)}
                {it.sub.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingInlineStart: 18, display: "grid", gap: 4 }}>
                    {it.sub.map((s, si) => <li key={si} style={{ fontSize: 12, color: "var(--ink-500)" }}>{inlineSpans(s, `${bi}-${li}-${si}`)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}

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
  layers: <><path d="m12 2 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
  repo: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  /** Clients — a briefcase, so the navbar's client entry is not another branch icon */
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
  /** Users — one person */
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  /** Claude — the chat launcher and the control center */
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z" /></>,
};

export function Pill({ tone, children }: { tone: "warning" | "critical" | "active" | "healthy" | "ai" | "inactive" | "neutral"; children: ReactNode }) {
  return <span className={`pill ${tone}`}><span className="dot" />{children}</span>;
}

/**
 * The number of a pull request, shown next to its branch name — in the list
 * and on the request's own page, so the same request is recognised in both.
 * One component: a number on its own says nothing to whoever reads it.
 */
export function PrNumber({ n }: { n: number }) {
  return <span className="pr-num" dir="ltr" title={`בקשת מיזוג מספר ${n}`}>#{n}</span>;
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

/**
 * The heading of a screen. `info` is the key of the concept that says what the
 * screen is for (openspec/changes/info-hints) — required, so a screen without
 * one is a written decision (`null`), not an oversight.
 */
export function PageHead({ title, sub, crumb, actions, info }: { title: ReactNode; sub?: string; crumb?: ReactNode; actions?: ReactNode; info: string | null }) {
  return (
    <div className="page-head">
      <div className="titles">
        {crumb && <p className="crumb">{crumb}</p>}
        <h1>{title}{info && <Info k={info} />}</h1>
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
  title, data, loading, error, onClose, onConfirm, confirming, confirmLabel, disabledReason, reasonField, loadingHint,
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
  /** Shown instead of the bare "טוען…" when building the prompt does real,
   *  possibly slow work (a git checkout) — otherwise a first-time clone
   *  reads as the screen being stuck. */
  loadingHint?: string;
  /** A course-changing action (e.g. re-breakdown) asks for a reason
   *  right here, before confirm — the decision-history capture point
   *  (design notes, `decision-history`). Confirm stays disabled until
   *  it's filled. */
  reasonField?: { label: string; value: string; onChange: (v: string) => void };
}) {
  const [pick, setLang] = useState<"he" | "en">("he");
  // Not every prompt has a Hebrew rendering; an empty tab would read as "nothing will be sent".
  const hasHe = !!data?.promptHe?.trim();
  const lang = pick === "he" && !hasHe ? "en" : pick;
  return (
    // No dismiss-on-backdrop-click: a real request may be running behind
    // this (a checkout, an approval decision), and a stray click outside
    // must never look like it silently discarded that in progress.
    <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{
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
          <div className="spin">{loadingHint ?? "טוען…"}</div>
        ) : data ? (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              {hasHe ? <>
                <button className={`btn btn-sm ${lang === "he" ? "btn-primary" : "btn-secondary"}`} onClick={() => setLang("he")}>עברית</button>
                <CopyBtn text={data.promptHe} />
                <span style={{ width: 1, height: 16, background: "var(--border-hairline)", margin: "0 4px" }} />
              </> : <span className="ob-sub">לפעולה הזו אין תצוגה בעברית — זה הפרומפט עצמו, כפי שיישלח</span>}
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
        {error && <p style={{ fontSize: 12.5, color: "var(--status-critical)", marginBottom: 12, whiteSpace: "pre-wrap" }}>{error}</p>}
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

/**
 * The one card / section heading of a screen — every title inside a panel goes
 * through here so it carries its "i" (`info`, required: a concept key, or
 * `null` when the heading needs no explanation).
 */
export function CardTitle({ info, as: Tag = "h4", className, style, children }: { info: string | null; as?: "h1" | "h2" | "h3" | "h4"; className?: string; style?: CSSProperties; children: ReactNode }) {
  return <Tag className={className} style={style}>{children}{info && <Info k={info} />}</Tag>;
}

export function StatTile({ tone, num, label, onClick, info }: { tone: string; num: ReactNode; label: string; onClick?: () => void; info?: string }) {
  return (
    <div className="stat-tile" onClick={onClick} role="button" tabIndex={0}>
      <span className={`badge-circle tone-${tone}`}>
        <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {tone === "critical" ? ICONS.slash : tone === "warning" ? ICONS.alert : ICONS.calendar}
        </svg>
      </span>
      <span><span className="num">{num}</span><span className="lbl">{label}{info && <Info k={info} />}</span></span>
    </div>
  );
}

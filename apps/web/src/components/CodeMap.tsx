import { useEffect, useState } from "react";
import { openFolder, type CodeMap, type CodeMapLane, type CodeMapNode, type CodeMapNodeKind, type CodeMapPlace } from "../api.ts";

/**
 * The code map — the one drawing DCC uses wherever git is involved: the
 * onboarding stages, a task's branch, a pull request, a repository's branches.
 *
 * Screens pass a `CodeMap` (built on the server) and never draw anything
 * themselves, so the visual language lives here alone: change `D` below and
 * every screen changes with it.
 */

/** The whole design of the map: geometry and colour, in one object. */
const D = {
  width: 680,
  laneGap: 86,
  firstLaneY: 44,
  right: 600,
  leftPad: 150,
  maxSpacing: 70,
  minSpacing: 24,
  curveDx: 60,
  lead: 36,
  radius: { other: 4, ours: 5, attention: 5, current: 7, branchPoint: 6, pr: 12, uncommitted: 6, empty: 6 },
  color: {
    line: "var(--border-hairline)",
    lineStroke: "#D3D1C7",
    other: "#B3B0C9",
    ours: "var(--color-accent)",
    attention: "var(--status-warning)",
    current: "var(--ink-900)",
    surface: "var(--surface)",
    label: "var(--ink-900)",
    muted: "var(--ink-500)",
    oursText: "var(--color-accent-dark)",
    attentionText: "#B07214",
    badgeBase: "var(--badge-bg)",
    badgeOurs: "var(--color-accent-muted)",
  },
  font: 'var(--font)',
  size: { label: 12, note: 11, badge: 11, arrow: 11 },
} as const;

const PLACE_HE: Record<CodeMapPlace, string> = { cloud: "בענן", local: "במחשב בלבד", both: "בענן ובמחשב" };

type Placed = { lane: CodeMapLane; y: number; xs: number[]; index: number };

/** Right to left: the oldest change sits on the right, the newest on the left. */
function layout(map: CodeMap): Placed[] {
  const placed: Placed[] = [];
  map.lanes.forEach((lane, index) => {
    const y = D.firstLaneY + index * D.laneGap;
    const parent = lane.from ? placed.find((p) => p.lane.id === lane.from!.lane) : undefined;
    const startX = parent ? (parent.xs[lane.from!.at] ?? D.right) - D.curveDx : D.right;
    const n = lane.nodes.length;
    const span = Math.max(0, startX - D.leftPad);
    const spacing = n > 1 ? Math.max(D.minSpacing, Math.min(D.maxSpacing, span / (n - 1))) : 0;
    const xs = lane.nodes.map((_, i) => startX - i * spacing);
    placed.push({ lane, y, xs, index });
  });
  return placed;
}

function Node({ node, x, y, onPick, picked }: { node: CodeMapNode; x: number; y: number; onPick: () => void; picked: boolean }) {
  const kind = node.kind;
  const r = D.radius[kind];
  const el = (() => {
    switch (kind) {
      case "ours": return <circle cx={x} cy={y} r={r} fill={D.color.ours} />;
      case "attention": return <circle cx={x} cy={y} r={r} fill={D.color.attention} />;
      case "current": return <circle cx={x} cy={y} r={r} fill={D.color.current} />;
      case "branchPoint": return <circle cx={x} cy={y} r={r} fill={D.color.surface} stroke={D.color.ours} strokeWidth={2} />;
      case "uncommitted": return <circle cx={x} cy={y} r={r} fill={D.color.surface} stroke={D.color.attention} strokeWidth={2} strokeDasharray="3 2" />;
      case "empty": return <circle cx={x} cy={y} r={r} fill={D.color.surface} stroke={D.color.ours} strokeWidth={2} />;
      case "pr": return (
        <>
          <circle cx={x} cy={y} r={r} fill={D.color.surface} stroke={D.color.ours} strokeWidth={2} />
          <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fill={D.color.oursText} fontFamily={D.font}>PR</text>
        </>
      );
      default: return <circle cx={x} cy={y} r={r} fill={D.color.other} />;
    }
  })();
  const label = node.subject ?? node.title ?? "פרטים";
  return (
    <g className="cm-node" role="button" tabIndex={0} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}>
      {/* A dot is small; the invisible disc is what a finger or a mouse actually hits. */}
      <circle cx={x} cy={y} r={Math.max(r + 8, 14)} fill="transparent" />
      {picked && <circle cx={x} cy={y} r={r + 5} fill="none" stroke={D.color.ours} strokeWidth={1.5} />}
      {el}
      <title>{label}</title>
    </g>
  );
}

const KIND_HE: Record<CodeMapNodeKind, string> = {
  other: "שינוי של מישהו אחר",
  ours: "שינוי שלנו",
  attention: "שינוי שנוגע בקבצים שלנו",
  current: "המצב העדכני",
  branchPoint: "נקודת ההתחלה של הענף",
  pr: "בקשת מיזוג",
  uncommitted: "שינויים שעוד לא נשמרו",
  empty: "הענף ריק",
};

/** The server answers a refusal with { "error": "<message for the person>" }. */
function errMessage(e: unknown): string {
  const body = (e instanceof Error ? e.message : String(e)).replace(/^\d{3}\s+/, "");
  try { const j = JSON.parse(body) as { error?: unknown }; if (typeof j.error === "string") return j.error; } catch { /* not JSON */ }
  return body || "לא הצלחתי לפתוח את התיקייה";
}

/** What pressing a line shows: the branch it draws. */
const laneNode = (l: CodeMapLane): CodeMapNode => ({ kind: "other", heading: "ענף", subject: l.name ?? l.label, detail: l.detail, url: l.url, folder: l.folder });

const fmtWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : null);

/** A folder on this computer: its path, a button that opens it, and one that copies the path. */
function FolderBlock({ folder, label = "נמצא במחשב הזה, בתיקייה" }: { folder: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(folder); ok = true; } catch { /* blocked or unavailable: fall back below */ }
    if (!ok) {
      // The older route works without the clipboard permission, from a plain button press.
      const ta = document.createElement("textarea");
      ta.value = folder;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    if (ok) { setErr(null); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    else setErr("הדפדפן חסם את ההעתקה. סמנו את הנתיב והעתיקו ידנית.");
  };
  const open = async () => {
    setErr(null);
    try { await openFolder(folder); } catch (e) { setErr(errMessage(e)); }
  };
  return (
    <div className="fd">
      <div className="k">{label}</div>
      <div className="p">{folder}</div>
      <div className="b">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void open()}>פתח בסייר הקבצים</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>{copied ? "הועתק ✓" : "העתק נתיב"}</button>
      </div>
      {err && <div className="e">{err}</div>}
    </div>
  );
}

/** The floating details of one dot. */
function NodePopover({ node, xPct, yPct, onClose }: { node: CodeMapNode; xPct: number; yPct: number; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  const when = fmtWhen(node.at);
  return (
    <div className="cm-pop" style={{ insetInlineStart: `${100 - xPct}%`, top: `${yPct}%` }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="x" aria-label="סגור" onClick={onClose}>×</button>
      <div className="k">{node.heading ?? KIND_HE[node.kind]}</div>
      {node.subject && <div className={node.heading ? "s br" : "s"}>{node.subject}</div>}
      {node.message && <div className="msg">{node.message}</div>}
      {node.detail && <div className="d">{node.detail}</div>}
      <div className="m">
        {node.sha && <span className="sha">{node.sha}</span>}
        {node.author && <span>{node.author}</span>}
        {when && <span>{when}</span>}
        {typeof node.files === "number" && <span>{node.files} קבצים</span>}
      </div>
      {node.url && <div style={{ marginTop: 6 }}><a href={node.url} target="_blank" rel="noreferrer">פתח בגיט־האוסט ↗</a></div>}
      {node.folder && <FolderBlock folder={node.folder} />}
    </div>
  );
}

function Badge({ place, x, y, ours }: { place: CodeMapPlace; x: number; y: number; ours: boolean }) {
  const text = PLACE_HE[place];
  const w = text.length * 6.6 + 26;
  const left = Math.max(8, x - w);
  return (
    <g>
      <rect x={left} y={y - 11} width={w} height={22} rx={11} fill={ours ? D.color.badgeOurs : D.color.badgeBase} />
      <text x={left + w / 2} y={y + 4} textAnchor="middle" fontSize={D.size.badge} fill={ours ? D.color.oursText : "var(--ink-700)"} fontFamily={D.font}>{text}</text>
    </g>
  );
}

export function CodeMapDrawing({ map, picked, onPick }: { map: CodeMap; picked?: string | null; onPick?: (id: string, node: CodeMapNode, x: number, y: number) => void }) {
  const placed = layout(map);
  const height = D.firstLaneY + (map.lanes.length - 1) * D.laneGap + 78;
  const byId = new Map(placed.map((p) => [p.lane.id, p]));
  return (
    <svg viewBox={`0 0 ${D.width} ${height}`} role="img" className="cm-svg" style={{ width: "100%", height: "auto" }} data-h={height}>
      <title>מפת הקוד</title>
      <desc>{map.caption ?? "היכן העבודה יושבת מול הענף הראשי"}</desc>
      <defs>
        <marker id="cm-ar-ours" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill={D.color.ours} /></marker>
        <marker id="cm-ar-mute" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill={D.color.other} /></marker>
      </defs>

      {/* The pressable strips come first, underneath everything: a branch's curve ends on the dot of the line it
          springs from, and drawn on top of that dot it would take the press meant for the dot. */}
      <g>
        {placed.map((p) => {
          const first = p.xs[0] ?? D.right;
          const last = p.xs[p.xs.length - 1] ?? first;
          const parent = p.lane.from ? byId.get(p.lane.from.lane) : undefined;
          const px = parent ? parent.xs[p.lane.from!.at] ?? first : first;
          const py = parent ? parent.y : p.y;
          const lineStart = parent ? first : Math.min(D.width - 24, first + D.lead);
          return <g key={p.lane.id}>
            {/* A wide invisible strip over the whole line, curve included: pressing it says which branch it is. */}
            {(() => {
              const at = (parent ? (px + last) / 2 : (lineStart + last) / 2);
              const pick = () => onPick?.(`lane:${p.lane.id}`, laneNode(p.lane), at, p.y);
              const hit = {
                className: "cm-lane", fill: "none", stroke: "transparent", strokeWidth: 22, strokeLinecap: "round" as const, pointerEvents: "stroke" as const,
                role: "button", tabIndex: 0, "aria-label": `ענף ${p.lane.name ?? p.lane.label ?? ""}`,
                onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); pick(); },
                onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } },
              };
              // A lane with a single dot has a zero-length straight part; the curve that joins it to its parent is what can be pressed.
              return parent
                ? <path d={`M${px},${py} C${px},${py + 34} ${px - 14},${p.y} ${px - 44},${p.y} L${last},${p.y}`} {...hit} />
                : <line x1={lineStart} y1={p.y} x2={Math.min(last, lineStart - 24)} y2={p.y} {...hit} />;
            })()}
          </g>;
        })}
      </g>

      {placed.map((p) => {
        const first = p.xs[0] ?? D.right;
        const last = p.xs[p.xs.length - 1] ?? first;
        const parent = p.lane.from ? byId.get(p.lane.from.lane) : undefined;
        const px = parent ? parent.xs[p.lane.from!.at] ?? first : first;
        const py = parent ? parent.y : p.y;
        // Labels hang above the line, starting at the point the line starts, so they
        // never sit on the dots and never collide with an arrow label.
        const labelX = Math.min(D.width - 8, first + 6);
        // The line that has no parent starts a little before its first dot, so a lane with one or two dots still reads as a line.
        const lineStart = parent ? first : Math.min(D.width - 24, first + D.lead);
        return (
          <g key={p.lane.id}>
            {parent
              ? <path d={`M${px},${py} C${px},${py + 34} ${px - 14},${p.y} ${px - 44},${p.y} L${last},${p.y}`} fill="none" stroke={D.color.ours} strokeWidth={2} pointerEvents="none" />
              : <line x1={lineStart} y1={p.y} x2={last} y2={p.y} stroke={D.color.lineStroke} strokeWidth={2} pointerEvents="none" />}
            {p.lane.label && <text x={labelX} y={p.y - 32} textAnchor="end" fontSize={D.size.label} fill={parent ? D.color.oursText : D.color.label} fontFamily={D.font}>{p.lane.label}</text>}
            {p.lane.note && <text x={labelX} y={p.y - (p.lane.label ? 17 : 32)} textAnchor="end" fontSize={D.size.note} fill={D.color.muted} fontFamily={D.font}>{p.lane.note}</text>}
            {p.lane.nodes.map((n: CodeMapNode, i) => (
              <Node key={i} node={n} x={p.xs[i]!} y={p.y} picked={picked === `${p.lane.id}:${i}`}
                onPick={() => onPick?.(`${p.lane.id}:${i}`, n, p.xs[i]!, p.y)} />
            ))}
            {/* The base line keeps its badge above, so the arrow that arrives from below has a clear landing. */}
            {p.lane.place && <Badge place={p.lane.place} x={last - 16} y={p.y + (parent ? 24 : -24)} ours={!!parent} />}
          </g>
        );
      })}

      {map.arrows.map((a, i) => {
        const from = byId.get(a.from);
        const to = byId.get(a.to);
        if (!from || !to) return null;
        const fx = (from.xs[from.xs.length - 1] ?? 0) - 12;
        const fy = from.y - 10;
        const tx = (to.xs[to.xs.length - 1] ?? 0) + 24;
        const ty = to.y + 13;
        const done = a.state === "done";
        return (
          <g key={i}>
            <path d={`M${fx},${fy} L${tx},${ty}`} fill="none" stroke={done ? D.color.ours : D.color.other} strokeWidth={1.5} strokeDasharray="5 4" markerEnd={`url(#${done ? "cm-ar-ours" : "cm-ar-mute"})`} />
            {/* The label sits on the arrow, so it carries its own background. */}
            <rect x={(fx + tx) / 2 - 6 - (a.label.length * 6.2 + 12) / 2} y={(fy + ty) / 2 - 27} width={a.label.length * 6.2 + 12} height={17} rx={6} fill={D.color.surface} />
            <text x={(fx + tx) / 2 - 6} y={(fy + ty) / 2 - 15} textAnchor="middle" fontSize={D.size.arrow} fill={done ? D.color.oursText : D.color.muted} fontFamily={D.font}>{a.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

const LEGEND: { color: string; ring?: boolean; text: string }[] = [
  { color: D.color.other, text: "שינוי של אחרים" },
  { color: D.color.ours, text: "שינוי שלנו" },
  { color: D.color.attention, text: "דורש תשומת לב" },
  { color: D.color.current, text: "המצב העדכני" },
  { color: D.color.ours, ring: true, text: "נקודת התחלה או בקשת מיזוג" },
];

/**
 * The map with its title, sentence and legend — what screens actually place.
 * `title` names the moment ("מצב הקוד"), the rest is the same everywhere.
 */
export function CodeMapPanel({ map, title = "מצב הקוד", legend = true }: { map: CodeMap | null | undefined; title?: string; legend?: boolean }) {
  const [pick, setPick] = useState<{ id: string; node: CodeMapNode; xPct: number; yPct: number } | null>(null);
  if (map?.problem) {
    return (
      <div className="cm">
        <div className="cm-t">{title}</div>
        <div className="ob-note warn">{map.problem.text}</div>
        {map.problem.folder && <FolderBlock folder={map.problem.folder} label="התיקייה שנבדקה" />}
      </div>
    );
  }
  if (!map?.lanes?.length) return null;
  const height = D.firstLaneY + (map.lanes.length - 1) * D.laneGap + 78;
  return (
    <div className="cm" onClick={() => setPick(null)}>
      <div className="cm-t">{title} <span className="cm-hint">· לחצו על נקודה או על קו לפרטים</span></div>
      <div className="cm-wrap">
        <CodeMapDrawing map={map} picked={pick?.id ?? null}
          onPick={(id, node, x, y) => setPick((cur) => (cur?.id === id ? null : { id, node, xPct: (x / D.width) * 100, yPct: (y / height) * 100 }))} />
        {pick && <NodePopover node={pick.node} xPct={pick.xPct} yPct={pick.yPct} onClose={() => setPick(null)} />}
      </div>
      {map.caption && <p className="cm-cap">{map.caption}</p>}
      {legend && (
        <div className="cm-lg">
          {LEGEND.map((l) => (
            <span key={l.text}><i style={l.ring ? { background: "var(--surface)", border: `2px solid ${l.color}` } : { background: l.color }} />{l.text}</span>
          ))}
          <span>תווית = איפה הקוד נמצא · חץ מקווקו = פעולה שעוד לא קרתה</span>
          <span>העלאה = שליחת הענף ל-GitHub · בקשת מיזוג = הצעה להכניס אותו לענף הראשי. אחת לא מחליפה את השנייה.</span>
        </div>
      )}
    </div>
  );
}

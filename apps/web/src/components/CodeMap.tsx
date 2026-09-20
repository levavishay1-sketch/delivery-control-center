import type { CodeMap, CodeMapLane, CodeMapNode, CodeMapNodeKind, CodeMapPlace } from "../api.ts";

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

function Node({ kind, x, y, title }: { kind: CodeMapNodeKind; x: number; y: number; title?: string }) {
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
  return <g>{el}{title ? <title>{title}</title> : null}</g>;
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

export function CodeMapDrawing({ map }: { map: CodeMap }) {
  const placed = layout(map);
  const height = D.firstLaneY + (map.lanes.length - 1) * D.laneGap + 78;
  const byId = new Map(placed.map((p) => [p.lane.id, p]));
  return (
    <svg viewBox={`0 0 ${D.width} ${height}`} role="img" className="cm-svg" style={{ width: "100%", height: "auto" }}>
      <title>מפת הקוד</title>
      <desc>{map.caption ?? "היכן העבודה יושבת מול הענף הראשי"}</desc>
      <defs>
        <marker id="cm-ar-ours" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill={D.color.ours} /></marker>
        <marker id="cm-ar-mute" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill={D.color.other} /></marker>
      </defs>

      {placed.map((p) => {
        const first = p.xs[0] ?? D.right;
        const last = p.xs[p.xs.length - 1] ?? first;
        const parent = p.lane.from ? byId.get(p.lane.from.lane) : undefined;
        const px = parent ? parent.xs[p.lane.from!.at] ?? first : first;
        const py = parent ? parent.y : p.y;
        // Labels hang above the line, starting at the point the line starts, so they
        // never sit on the dots and never collide with an arrow label.
        const labelX = Math.min(D.width - 8, first + 6);
        return (
          <g key={p.lane.id}>
            {parent
              ? <path d={`M${px},${py} C${px},${py + 34} ${px - 14},${p.y} ${px - 44},${p.y} L${last},${p.y}`} fill="none" stroke={D.color.ours} strokeWidth={2} />
              : <line x1={first} y1={p.y} x2={last} y2={p.y} stroke={D.color.lineStroke} strokeWidth={2} />}
            {p.lane.label && <text x={labelX} y={p.y - 32} textAnchor="end" fontSize={D.size.label} fill={parent ? D.color.oursText : D.color.label} fontFamily={D.font}>{p.lane.label}</text>}
            {p.lane.note && <text x={labelX} y={p.y - (p.lane.label ? 17 : 32)} textAnchor="end" fontSize={D.size.note} fill={D.color.muted} fontFamily={D.font}>{p.lane.note}</text>}
            {p.lane.nodes.map((n: CodeMapNode, i) => <Node key={i} kind={n.kind} x={p.xs[i]!} y={p.y} title={n.title} />)}
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
  { color: D.color.ours, ring: true, text: "נקודת התחלה או PR" },
];

/**
 * The map with its title, sentence and legend — what screens actually place.
 * `title` names the moment ("מצב הקוד"), the rest is the same everywhere.
 */
export function CodeMapPanel({ map, title = "מצב הקוד", legend = true }: { map: CodeMap | null | undefined; title?: string; legend?: boolean }) {
  if (!map?.lanes?.length) return null;
  return (
    <div className="cm">
      <div className="cm-t">{title}</div>
      <CodeMapDrawing map={map} />
      {map.caption && <p className="cm-cap">{map.caption}</p>}
      {legend && (
        <div className="cm-lg">
          {LEGEND.map((l) => (
            <span key={l.text}><i style={l.ring ? { background: "var(--surface)", border: `2px solid ${l.color}` } : { background: l.color }} />{l.text}</span>
          ))}
          <span>תווית = איפה הקוד נמצא · חץ מקווקו = פעולה שעוד לא קרתה</span>
        </div>
      )}
    </div>
  );
}

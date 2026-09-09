import { useEffect, useMemo, useState } from "react";
import { getBrief, getTimeline, listWorkItems, type EventRow, type WorkItemLite } from "./api.ts";

const C = {
  ai: "var(--ai)", aiBg: "var(--ai-bg)", aiLine: "var(--ai-line)",
  human: "var(--human)", humanBg: "var(--human-bg)",
  crit: "var(--crit)", critBg: "var(--crit-bg)", ok: "var(--ok)",
  ink: "var(--ink)", ink2: "var(--ink2)", ink3: "var(--ink3)",
  rule: "var(--rule)", rule2: "var(--rule2)", surface: "var(--surface)", sunk: "var(--sunk)", sunk2: "var(--sunk2)",
  mono: "var(--mono)",
};

/** An event authored by an AI proposal (dashed + amber) vs a human fact (solid). */
function isAiProposal(e: EventRow) {
  return (
    e.actor.kind !== "user" ||
    e.type === "gap.proposed" ||
    e.type === "tasks.proposed" ||
    e.type.startsWith("model.")
  );
}

const SOURCE_GLYPH: Record<string, string> = {
  email: "✉", slack: "◇", phone: "☎", meeting: "☎", claude_session: "◆",
  git: "⎇", ado: "▤", manual: "✎", system: "⚙",
};

function fmt(ts: string) {
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

function gist(e: EventRow): string {
  const p = e.payload;
  return (
    (p.summary as string) ??
    (p.body as string) ??
    (p.description as string) ??
    (p.question as string) ??
    [p.kind, p.branch && `on ${p.branch}`, p.count && `×${p.count}`].filter(Boolean).join(" ") ??
    e.type
  );
}

function Confidence({ value }: { value: number }) {
  const lvl = value >= 0.75 ? "hi" : value >= 0.5 ? "mid" : "lo";
  const bar = (i: number) => {
    const on = lvl === "hi" || (lvl === "mid" && i < 2) || (lvl === "lo" && i < 1);
    const col = lvl === "hi" ? C.ok : lvl === "lo" ? C.crit : "#8A6008";
    return <i key={i} style={{ width: 4, height: 9, borderRadius: 1, background: on ? col : C.rule2 }} />;
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: C.mono, fontSize: 10.5, color: lvl === "lo" ? C.crit : C.ink2 }}>
      <span style={{ display: "flex", gap: 1.5 }}>{[0, 1, 2].map(bar)}</span>
      {value.toFixed(2)}
    </span>
  );
}

function Badge({ kind, children }: { kind: "ai" | "human" | "crit" | "plain"; children: React.ReactNode }) {
  const map = {
    ai: { color: C.ai, border: C.aiLine, bg: C.aiBg },
    human: { color: C.human, border: C.human, bg: C.humanBg },
    crit: { color: C.crit, border: C.crit, bg: C.critBg },
    plain: { color: C.ink3, border: C.rule2, bg: "transparent" },
  }[kind];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontFamily: C.mono, fontSize: 9.5,
      letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 3,
      border: `1px solid ${map.border}`, color: map.color, background: map.bg, whiteSpace: "nowrap",
    }}>
      {kind === "ai" ? "◇ " : kind === "human" ? "◆ " : ""}{children}
    </span>
  );
}

function Event({ e }: { e: EventRow }) {
  const ai = isAiProposal(e);
  const superseded = false; // supersedes chains rendered as-is; older row still shown
  const conf = typeof e.payload.confidence === "number" ? (e.payload.confidence as number) : undefined;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "22px 1fr", gap: 11, padding: "12px 18px",
      borderBottom: `1px solid ${C.rule}`,
      background: ai ? C.aiBg : "transparent",
      borderInlineStart: ai ? `2px dashed ${C.aiLine}` : e.actor.kind === "user" ? `2px solid ${C.human}` : "2px solid transparent",
      opacity: superseded ? 0.55 : 1,
    }}>
      <div style={{ color: C.ink3, textAlign: "center", paddingTop: 2 }}>{SOURCE_GLYPH[e.source] ?? "•"}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>
            {e.actor.kind === "user" ? "אדם" : e.actor.kind === "delegated" ? "Claude (בשם המשתמש)" : "מערכת"}
          </span>
          {ai ? <Badge kind="ai">הצעה · ממתין</Badge> : <Badge kind="human">{e.source} · אדם</Badge>}
          {conf !== undefined && <Confidence value={conf} />}
          {e.supersedes && <Badge kind="plain">מתקן אירוע קודם</Badge>}
          <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3, marginInlineStart: "auto" }}>{fmt(e.occurredAt)}</span>
        </div>
        <div style={{ fontSize: 13, color: C.ink2 }}>
          <b style={{ color: C.ink, fontWeight: 500, fontFamily: C.mono, fontSize: 11 }}>{e.type}</b>
          {"  "}
          {String(gist(e)).slice(0, 220)}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [items, setItems] = useState<WorkItemLite[]>([]);
  const [sel, setSel] = useState<string | null>(new URLSearchParams(location.search).get("wi"));
  const [data, setData] = useState<Awaited<ReturnType<typeof getTimeline>> | null>(null);
  const [brief, setBrief] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listWorkItems().then((xs) => {
      setItems(xs);
      if (!sel && xs[0]) setSel(xs[0].id);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!sel) return;
    setErr(null);
    history.replaceState(null, "", `?wi=${sel}`);
    Promise.all([getTimeline(sel), getBrief(sel)])
      .then(([d, b]) => { setData(d); setBrief(b); })
      .catch((e) => setErr(String(e)));
  }, [sel]);

  const wi = data?.workitem;
  const events = data?.events ?? [];
  const counts = useMemo(() => {
    const ai = events.filter(isAiProposal).length;
    return { total: events.length, ai, human: events.length - ai };
  }, [events]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 300px", minHeight: "100vh" }}>
      {/* nav */}
      <aside style={{ background: C.sunk, borderInlineEnd: `1px solid ${C.rule}`, padding: "14px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 14px", fontWeight: 600 }}>
          <span style={{ width: 18, height: 18, borderRadius: 4, background: `linear-gradient(135deg, ${C.ai}, ${C.human})` }} />
          Delivery Control
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3, padding: "0 16px 6px" }}>
          WorkItems
        </div>
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setSel(it.id)}
            style={{
              display: "block", width: "100%", textAlign: "right", border: 0, cursor: "pointer",
              font: "inherit", padding: "6px 16px", background: it.id === sel ? C.sunk2 : "transparent",
              color: it.id === sel ? C.ink : C.ink2, fontWeight: it.id === sel ? 600 : 400,
              borderInlineStart: it.id === sel ? `2px solid ${C.ai}` : "2px solid transparent",
            }}
          >
            <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3 }}>{it.key ?? "—"}</span>{" "}
            {it.title}
          </button>
        ))}
        {items.length === 0 && !err && <div style={{ padding: "6px 16px", color: C.ink3 }}>אין WorkItems. הרץ את demo / smoke.</div>}
      </aside>

      {/* timeline */}
      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.rule}` }}>
          {wi ? (
            <>
              <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3 }}>{wi.key ?? "(no key)"}</div>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 0" }}>{wi.title}</h2>
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Badge kind="plain">phase: {wi.phase}</Badge>
                <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3 }}>
                  {counts.total} אירועים · {counts.human} אדם · {counts.ai} הצעת AI
                </span>
              </div>
            </>
          ) : (
            <h2 style={{ fontSize: 15, margin: 0, color: C.ink3 }}>בחר WorkItem</h2>
          )}
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {err && <div style={{ padding: 18, color: C.crit, fontFamily: C.mono, fontSize: 12 }}>{err}</div>}
          {events.map((e) => <Event key={e.id} e={e} />)}
          {wi && events.length === 0 && !err && (
            <div style={{ padding: 18, color: C.ink3 }}>אין אירועים עדיין ל-WorkItem הזה.</div>
          )}
        </div>
      </main>

      {/* brief */}
      <aside style={{ borderInlineStart: `1px solid ${C.rule}`, background: C.sunk, overflow: "auto" }}>
        <div style={{ padding: "13px 15px", borderBottom: `1px solid ${C.rule}`, fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3 }}>
          Context Brief · מה ש-SessionStart מזריק
        </div>
        <pre style={{
          margin: 0, padding: "13px 15px", whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontFamily: C.mono, fontSize: 11, lineHeight: 1.55, color: C.ink2,
        }}>
          {brief || "—"}
        </pre>
      </aside>
    </div>
  );
}

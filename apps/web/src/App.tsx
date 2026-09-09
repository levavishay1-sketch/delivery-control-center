import { useCallback, useEffect, useMemo, useState } from "react";
import {
  answerBlocker,
  getBlockers,
  getBrief,
  getDetail,
  getInbox,
  listWorkItems,
  progressTask,
  verifyGap,
  type Blocker,
  type EventRow,
  type Gap,
  type Task,
  type WorkItemDetail,
  type WorkItemLite,
} from "./api.ts";

const C = {
  ai: "var(--ai)", aiBg: "var(--ai-bg)", aiLine: "var(--ai-line)",
  human: "var(--human)", humanBg: "var(--human-bg)",
  crit: "var(--crit)", critBg: "var(--crit-bg)", ok: "var(--ok)", okBg: "var(--ok-bg)",
  ink: "var(--ink)", ink2: "var(--ink2)", ink3: "var(--ink3)",
  rule: "var(--rule)", rule2: "var(--rule2)", surface: "var(--surface)", sunk: "var(--sunk)", sunk2: "var(--sunk2)",
  mono: "var(--mono)",
};

const AI_TYPES = new Set(["gap.proposed", "tasks.proposed", "blocker.raised", "model.routed"]);
const isAi = (e: EventRow) => e.actor.kind !== "user" || AI_TYPES.has(e.type);
const SRC: Record<string, string> = { email: "✉", slack: "◇", phone: "☎", meeting: "☎", claude_session: "◆", git: "⎇", ado: "▤", manual: "✎", system: "⚙" };
const fmt = (t: string) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const gist = (e: EventRow) => {
  const p = e.payload;
  return (
    (p.summary as string) || (p.body as string) || (p.answer as string) || (p.description as string) ||
    (p.question as string) || (p.outcome ? `→ ${p.outcome}` : "") ||
    [p.kind, p.branch && `on ${p.branch}`].filter(Boolean).join(" ") || e.type
  );
};

function Btn({ onClick, tone, children }: { onClick: () => void; tone?: "go" | "plain"; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        font: "inherit", fontSize: 11.5, fontWeight: 500, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
        border: `1px solid ${tone === "go" ? C.human : C.rule2}`,
        background: tone === "go" ? C.human : C.surface, color: tone === "go" ? "#fff" : C.ink,
      }}
    >
      {children}
    </button>
  );
}

function Badge({ kind, children }: { kind: "ai" | "human" | "crit" | "ok" | "plain"; children: React.ReactNode }) {
  const m = {
    ai: [C.ai, C.aiLine, C.aiBg], human: [C.human, C.human, C.humanBg],
    crit: [C.crit, C.crit, C.critBg], ok: [C.ok, C.ok, C.okBg], plain: [C.ink3, C.rule2, "transparent"],
  }[kind];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".04em",
      textTransform: "uppercase", padding: "2px 6px", borderRadius: 3, border: `1px solid ${m[1]}`, color: m[0], background: m[2], whiteSpace: "nowrap",
    }}>
      {kind === "ai" ? "◇ " : kind === "human" ? "◆ " : ""}{children}
    </span>
  );
}

function Confidence({ value }: { value: number }) {
  const lvl = value >= 0.75 ? "hi" : value >= 0.5 ? "mid" : "lo";
  const col = lvl === "hi" ? C.ok : lvl === "lo" ? C.crit : "#8A6008";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: C.mono, fontSize: 10.5, color: lvl === "lo" ? C.crit : C.ink2 }}>
      <span style={{ display: "flex", gap: 1.5 }}>
        {[0, 1, 2].map((i) => {
          const on = lvl === "hi" || (lvl === "mid" && i < 2) || (lvl === "lo" && i < 1);
          return <i key={i} style={{ width: 4, height: 9, borderRadius: 1, background: on ? col : C.rule2 }} />;
        })}
      </span>
      {value.toFixed(2)}
    </span>
  );
}

function EventItem({ e }: { e: EventRow }) {
  const ai = isAi(e);
  const conf = typeof e.payload.confidence === "number" ? (e.payload.confidence as number) : undefined;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "22px 1fr", gap: 11, padding: "12px 18px", borderBottom: `1px solid ${C.rule}`,
      background: ai ? C.aiBg : "transparent",
      borderInlineStart: ai ? `2px dashed ${C.aiLine}` : e.actor.kind === "user" ? `2px solid ${C.human}` : "2px solid transparent",
    }}>
      <div style={{ color: C.ink3, textAlign: "center", paddingTop: 2 }}>{SRC[e.source] ?? "•"}</div>
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
          <b style={{ color: C.ink, fontWeight: 500, fontFamily: C.mono, fontSize: 11 }}>{e.type}</b>{"  "}
          {String(gist(e)).slice(0, 240)}
        </div>
      </div>
    </div>
  );
}

function GapCard({ g, onAct }: { g: Gap; onAct: (outcome: "verified" | "dismissed" | "spun_off") => void }) {
  const pending = g.state === "proposed";
  return (
    <div style={{ padding: "9px 0", borderBottom: `1px dotted ${C.rule2}`, fontSize: 12 }}>
      <div style={{ color: C.ink2, marginBottom: 6 }}>{g.description}</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        {g.blocking ? <Badge kind="crit">חוסם</Badge> : <Badge kind="plain">לא חוסם</Badge>}
        {g.state === "proposed" && <Badge kind="ai">לא אומת</Badge>}
        {g.state === "verified" && <Badge kind="ok">אומת</Badge>}
        {g.state === "dismissed" && <Badge kind="plain">נדחה</Badge>}
        {g.state === "spun_off" && <Badge kind="plain">הופרד ל-WorkItem</Badge>}
        <Confidence value={Number(g.confidence)} />
      </div>
      {pending && (
        <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
          <Btn tone="go" onClick={() => onAct("verified")}>אמת</Btn>
          <Btn onClick={() => onAct("dismissed")}>בטל</Btn>
          {!g.blocking && <Btn onClick={() => onAct("spun_off")}>הפרד למשימה</Btn>}
        </div>
      )}
    </div>
  );
}

function BlockerCard({ b, onAnswer }: { b: Blocker; onAnswer: (answer: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div style={{ padding: "9px 0", borderBottom: `1px dotted ${C.rule2}`, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
        <Badge kind={b.state === "open" ? "crit" : "ok"}>{b.state === "open" ? "פתוח" : "נענה"}</Badge>
        <Badge kind="plain">{b.questionType}</Badge>
      </div>
      <div style={{ color: C.ink2 }}>{b.question}</div>
      {b.answer && <div style={{ color: C.ok, marginTop: 5 }}>← {b.answer}</div>}
      {b.state === "open" && (
        <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="תשובה שקלוד ימשיך איתה…"
            style={{ flex: 1, font: "inherit", fontSize: 12, padding: "4px 8px", border: `1px solid ${C.rule2}`, borderRadius: 4 }}
          />
          <Btn tone="go" onClick={() => text.trim() && onAnswer(text.trim())}>שלח</Btn>
        </div>
      )}
    </div>
  );
}

const TASK_MARK: Record<Task["state"], { m: string; c: string }> = {
  done: { m: "✓", c: "var(--ok)" },
  in_progress: { m: "◐", c: "var(--ai)" },
  blocked: { m: "⚑", c: "var(--crit)" },
  pending: { m: "○", c: "var(--ink3)" },
  dropped: { m: "×", c: "var(--ink3)" },
};

function TaskRow({ t, onProgress }: { t: Task; onProgress: (to: Task["state"]) => void }) {
  const mk = TASK_MARK[t.state];
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "baseline", padding: "4px 0", fontSize: 12 }}>
      <span style={{ fontFamily: C.mono, fontSize: 11, color: mk.c, flex: "none" }}>{mk.m}</span>
      <span style={{ color: t.state === "done" || t.state === "dropped" ? C.ink3 : C.ink2, textDecoration: t.state === "done" ? "line-through" : "none", flex: 1 }}>
        <span style={{ fontFamily: C.mono, fontSize: 10, color: C.ink3 }}>{t.seq}. </span>{t.intent}
      </span>
      {t.state !== "done" && t.state !== "dropped" && (
        <button onClick={() => onProgress(t.state === "in_progress" ? "done" : "in_progress")} style={{
          font: "inherit", fontSize: 10, border: `1px solid ${C.rule2}`, background: C.surface, borderRadius: 3, cursor: "pointer", padding: "1px 5px", color: C.ink3, flex: "none",
        }}>
          {t.state === "in_progress" ? "→ done" : "→ start"}
        </button>
      )}
    </div>
  );
}

type View = "workitem" | "inbox" | "blockers";

export function App() {
  const [items, setItems] = useState<WorkItemLite[]>([]);
  const [sel, setSel] = useState<string | null>(new URLSearchParams(location.search).get("wi"));
  const [view, setView] = useState<View>("workitem");
  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [brief, setBrief] = useState("");
  const [inbox, setInbox] = useState<EventRow[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const clientId = detail?.workitem.clientId ?? null;

  const reloadDetail = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [d, b] = await Promise.all([getDetail(id), getBrief(id)]);
      setDetail(d);
      setBrief(b);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => {
    listWorkItems().then((xs) => { setItems(xs); if (!sel && xs[0]) setSel(xs[0].id); }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!sel) return;
    history.replaceState(null, "", `?wi=${sel}`);
    reloadDetail(sel);
  }, [sel, reloadDetail]);

  useEffect(() => {
    if (!clientId) return;
    if (view === "inbox") getInbox(clientId).then((r) => setInbox(r.events)).catch((e) => setErr(String(e)));
    if (view === "blockers") getBlockers(clientId).then((r) => setBlockers(r.blockers)).catch((e) => setErr(String(e)));
  }, [view, clientId]);

  const wi = detail?.workitem;
  const events = detail?.events ?? [];
  const counts = useMemo(() => {
    const ai = events.filter(isAi).length;
    return { total: events.length, ai, human: events.length - ai, openGaps: (detail?.gaps ?? []).filter((g) => g.state === "proposed").length, openBlk: (detail?.blockers ?? []).filter((b) => b.state === "open").length };
  }, [events, detail]);

  const onGapAct = async (g: Gap, outcome: "verified" | "dismissed" | "spun_off") => {
    if (!wi) return;
    const body: Parameters<typeof verifyGap>[1] = { outcome, clientId: wi.clientId };
    if (outcome === "spun_off") body.spunOffTitle = g.description.slice(0, 80);
    try {
      await verifyGap(g.id, body);
      await reloadDetail(wi.id);
    } catch (e) { setErr(String(e)); }
  };

  const onTaskProgress = async (t: Task, to: Task["state"]) => {
    if (!wi) return;
    try {
      await progressTask(t.id, { to, clientId: wi.clientId });
      await reloadDetail(wi.id);
    } catch (e) { setErr(String(e)); }
  };

  const onAnswer = async (b: Blocker, answer: string) => {
    if (!clientId) return;
    try {
      await answerBlocker(b.id, { answer, clientId });
      if (view === "blockers") setBlockers((xs) => xs.filter((x) => x.id !== b.id));
      if (sel) await reloadDetail(sel);
    } catch (e) { setErr(String(e)); }
  };

  const tab = (v: View, label: string, n?: number) => (
    <button
      onClick={() => setView(v)}
      style={{
        font: "inherit", fontSize: 12, fontWeight: view === v ? 600 : 400, border: 0, cursor: "pointer",
        background: "transparent", color: view === v ? C.ink : C.ink3, padding: "6px 0", borderBottom: view === v ? `2px solid ${C.ai}` : "2px solid transparent",
      }}
    >
      {label}{n ? ` (${n})` : ""}
    </button>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 300px", minHeight: "100vh" }}>
      <aside style={{ background: C.sunk, borderInlineEnd: `1px solid ${C.rule}`, padding: "14px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 14px", fontWeight: 600 }}>
          <span style={{ width: 18, height: 18, borderRadius: 4, background: `linear-gradient(135deg, ${C.ai}, ${C.human})` }} />
          Delivery Control
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3, padding: "0 16px 6px" }}>WorkItems</div>
        {items.map((it) => (
          <button key={it.id} onClick={() => { setSel(it.id); setView("workitem"); }} style={{
            display: "block", width: "100%", textAlign: "right", border: 0, cursor: "pointer", font: "inherit", padding: "6px 16px",
            background: it.id === sel ? C.sunk2 : "transparent", color: it.id === sel ? C.ink : C.ink2, fontWeight: it.id === sel ? 600 : 400,
            borderInlineStart: it.id === sel ? `2px solid ${C.ai}` : "2px solid transparent",
          }}>
            <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3 }}>{it.key ?? "—"}</span> {it.title}
          </button>
        ))}
        {items.length === 0 && !err && <div style={{ padding: "6px 16px", color: C.ink3 }}>אין WorkItems. הרץ demo / scenario.</div>}
      </aside>

      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.rule}` }}>
          {wi ? (
            <>
              <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3 }}>{wi.key ?? "(no key)"}</div>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 8px" }}>{wi.title}</h2>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                {tab("workitem", "Timeline", counts.total)}
                {tab("inbox", "לא משויך")}
                {tab("blockers", "Blockers שלי", counts.openBlk || undefined)}
              </div>
            </>
          ) : <h2 style={{ fontSize: 15, margin: 0, color: C.ink3 }}>בחר WorkItem</h2>}
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          {err && <div style={{ padding: 18, color: C.crit, fontFamily: C.mono, fontSize: 12 }}>{err}</div>}

          {view === "workitem" && (
            <>
              {wi && (
                <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.rule}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge kind="plain">phase: {wi.phase}</Badge>
                  <span style={{ fontFamily: C.mono, fontSize: 10.5, color: C.ink3 }}>
                    {counts.human} אדם · {counts.ai} הצעת AI · {counts.openGaps} Gaps פתוחים
                  </span>
                </div>
              )}
              {events.map((e) => <EventItem key={e.id} e={e} />)}
              {wi && events.length === 0 && !err && <div style={{ padding: 18, color: C.ink3 }}>אין אירועים.</div>}
            </>
          )}

          {view === "inbox" && (
            <>
              {inbox.map((e) => <EventItem key={e.id} e={e} />)}
              {inbox.length === 0 && <div style={{ padding: 18, color: C.ink3 }}>תיבת "לא משויך" ריקה.</div>}
            </>
          )}

          {view === "blockers" && (
            <div style={{ padding: "12px 18px" }}>
              {blockers.map((b) => <BlockerCard key={b.id} b={b} onAnswer={(a) => onAnswer(b, a)} />)}
              {blockers.length === 0 && <div style={{ color: C.ink3 }}>אין Blockers שממתינים לך.</div>}
            </div>
          )}
        </div>
      </main>

      <aside style={{ borderInlineStart: `1px solid ${C.rule}`, background: C.sunk, overflow: "auto" }}>
        {view === "workitem" && detail && (
          <>
            <div style={{ padding: "13px 15px", borderBottom: `1px solid ${C.rule}` }}>
              <div style={{ fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3, marginBottom: 8 }}>
                Gaps ({detail.gaps.length})
              </div>
              {detail.gaps.map((g) => <GapCard key={g.id} g={g} onAct={(o) => onGapAct(g, o)} />)}
              {detail.gaps.length === 0 && <div style={{ fontSize: 12, color: C.ink3 }}>אין.</div>}
            </div>
            <div style={{ padding: "13px 15px", borderBottom: `1px solid ${C.rule}` }}>
              <div style={{ fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3, marginBottom: 8 }}>
                Blockers ({detail.blockers.length})
              </div>
              {detail.blockers.map((b) => <BlockerCard key={b.id} b={b} onAnswer={(a) => onAnswer(b, a)} />)}
              {detail.blockers.length === 0 && <div style={{ fontSize: 12, color: C.ink3 }}>אין.</div>}
            </div>
            <div style={{ padding: "13px 15px", borderBottom: `1px solid ${C.rule}` }}>
              <div style={{ fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3, marginBottom: 8 }}>
                Tasks ({detail.tasks.filter((t) => t.state === "done").length}/{detail.tasks.length})
              </div>
              {detail.tasks.map((t) => <TaskRow key={t.id} t={t} onProgress={(to) => onTaskProgress(t, to)} />)}
              {detail.tasks.length === 0 && <div style={{ fontSize: 12, color: C.ink3 }}>אין פירוק עדיין.</div>}
            </div>
          </>
        )}
        <div style={{ padding: "13px 15px", borderBottom: `1px solid ${C.rule}`, fontFamily: C.mono, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: C.ink3 }}>
          Context Brief
        </div>
        <pre style={{ margin: 0, padding: "13px 15px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: C.mono, fontSize: 11, lineHeight: 1.55, color: C.ink2 }}>
          {brief || "—"}
        </pre>
      </aside>
    </div>
  );
}

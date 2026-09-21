import { useCallback, useEffect, useRef, useState } from "react";
import { askChat, getConversation, markHelpful, openChat, type ChatAnswer, type ChatMessage, type ConversationView, type TopicRef } from "../api.ts";
import { Icon, ICONS } from "../ui.tsx";
import { CostLine } from "./CostLine.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { errText } from "../screens/onboarding/labels.ts";
import { onChatCommand, useCurrentClaudeContext, waitForPlace, type ClaudeScreenContext } from "./context.ts";
import { BidiText } from "./BidiText.tsx";

/**
 * The one chat (claude-in-dcc §4): a floating button on every screen, a
 * dock that floats over the screen or is pinned beside it (the person's
 * choice, remembered), and a conversation per topic that the screen
 * decides. Everything it shows is a message row or a ledger row.
 */

const PIN_KEY = "dcc.chat.pinned";
const canPin = () => window.innerWidth >= 1100;

/** Backticked commands, paths and code become left-to-right chips, so they do not scramble inside a
 *  Hebrew sentence; a stray `**bold**` (the model is asked for plain text, but slips) reads as emphasis, not asterisks. */
function withCode(line: string) {
  return line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <bdi key={i} className="ob-chip">{part.slice(1, -1)}</bdi>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <BidiText key={i} text={part} />;
  });
}
function Text({ text }: { text: string }) {
  return <>{text.split("\n").map((line, i) => <div key={i} dir="rtl">{withCode(line)}</div>)}</>;
}

const topicOf = (ctx: ClaudeScreenContext | null): TopicRef => ctx ? { kind: ctx.topic.kind, id: ctx.topic.id ?? null } : { kind: "app" };
const contextPayload = (ctx: ClaudeScreenContext | null) => ctx ? {
  screen: ctx.screen, place: ctx.place ?? null, facts: { ...(ctx.facts ?? {}), ...(ctx.liveFacts?.() ?? {}) }, suggestions: ctx.suggestions, actions: ctx.actions,
} : { screen: "dashboard" };

export function ClaudeChat({ nav }: { nav: (h: string) => void }) {
  const ctx = useCurrentClaudeContext();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; } });
  const [wide, setWide] = useState(canPin);
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [title, setTitle] = useState("המערכת");
  const [override, setOverride] = useState<{ id: string; topic: TopicRef } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [flash, setFlash] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const on = () => setWide(canPin());
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  useEffect(() => onChatCommand((c) => {
    if (c.type === "toggle") setOpen((o) => !o);
    else if (c.type === "open") setOpen(true);
    else if (c.type === "openConversation") {
      setOpen(true);
      getConversation(c.id).then((r) => {
        setOverride({ id: c.id, topic: r.topic });
        setConv(r.conversation); setMessages(r.messages); setSuggestions(r.suggestions); setTitle(r.conversation.topicTitle);
      }).catch((e) => setErr(errText(e)));
    }
  }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape" && open && !(pinned && wide)) setOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, pinned, wide]);

  // The screen decides the topic. Moving to another screen switches the
  // conversation; the one left behind is found again from "כל השיחות".
  const topicKey = ctx ? `${ctx.topic.kind}:${ctx.topic.id ?? ""}` : "app:";
  useEffect(() => {
    setOverride(null);
    let live = true;
    openChat({ topic: topicOf(ctx), context: contextPayload(ctx) }).then((r) => {
      if (!live) return;
      setConv(r.conversation); setMessages(r.messages); setSuggestions(r.suggestions); setTitle(r.topic.title); setErr(null);
      setFlash(true); setTimeout(() => setFlash(false), 1400);
    }).catch((e) => { if (live) setErr(errText(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey]);

  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, busy, open]);
  useEffect(() => { if (open) box.current?.focus({ preventScroll: true }); }, [open]);

  const ask = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null); setQuestion("");
    setMessages((m) => [...m, { id: `pending-${Date.now()}`, conversationId: conv?.id ?? "", role: "user", kind: "answer", source: "system", text, callId: null, payload: {}, helpful: null, helpfulSource: null, createdAt: new Date().toISOString(), cost: null }]);
    const show = async (r: ChatAnswer) => {
      if (r.rolledOver) setMessages((await getConversation(r.conversation.id)).messages);
      else setMessages((m) => [...m.filter((x) => !x.id.startsWith("pending-")), ...r.messages]);
      setConv(r.conversation); setSuggestions(r.suggestions);
    };
    try {
      const topic = override?.topic ?? topicOf(ctx);
      const r = await askChat({ topic, context: override ? { screen: null } : contextPayload(ctx), question: text });
      await show(r);
      // The answer may be on another screen of the same topic. Then the chat
      // takes the person there and asks their question again once that screen
      // has loaded — one move per question, into the same conversation.
      const go = override ? undefined : r.messages.find((m) => m.kind === "navigate");
      const route = typeof go?.payload.route === "string" ? go.payload.route : null;
      if (go && route) {
        nav(route);
        const landed = await waitForPlace(String(go.payload.key));
        if (!landed) { setErr(`עברתי אל "${String(go.payload.title ?? "")}", אבל מה שיש שם עוד לא נטען. שאלו שוב בעוד רגע.`); return; }
        await show(await askChat({ topic: topicOf(landed), context: contextPayload(landed), question: text }));
      }
    } catch (e) {
      setErr(errText(e));
      setMessages((m) => m.filter((x) => !x.id.startsWith("pending-")));
    } finally {
      setBusy(false);
    }
  }, [busy, ctx, conv, override, nav]);

  const helpful = async (m: ChatMessage, v: boolean) => {
    const next = m.helpful === v ? null : v;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, helpful: next, helpfulSource: next == null ? null : "person" } : x)));
    if (next != null) await markHelpful(m.id, next).catch(() => {});
  };

  const togglePin = () => {
    const next = !(pinned && wide);
    setPinned(next);
    try { localStorage.setItem(PIN_KEY, next ? "1" : "0"); } catch { /* fine */ }
  };
  const isPinned = open && pinned && wide;

  return (
    <>
      {!open && (
        <button className="cc-fab" type="button" onClick={() => setOpen(true)} title="Ctrl K">
          <Icon d={ICONS.spark} size={16} />שאל את קלוד<kbd>Ctrl K</kbd>
        </button>
      )}
      {open && (
        <aside className={`cc-dock ${isPinned ? "pinned" : "float"}`} aria-label="הצ'אט של קלוד">
          <div className="cc-head">
            <div className="top">
              <span className="badge-soft ai" style={{ width: 30, height: 30, borderRadius: 9 }}><Icon d={ICONS.spark} size={15} /></span>
              <h3>קלוד</h3>
              {wide && (
                <button className="cc-pin" type="button" aria-pressed={isPinned} onClick={togglePin} title={isPinned ? "הצ'אט יחזור לצוף מעל המסך" : "הצ'אט יישאר פתוח ליד המסך, והמסך יצטמצם"}>
                  {isPinned ? "בטל עיגון" : "עגן ליד המסך"}
                </button>
              )}
              <button className="x" type="button" aria-label="סגור" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className={`cc-topic${flash ? " flash" : ""}`}>
              <span className="k">השיחה על</span>
              <span className="t">{title}</span>
              <a onClick={() => nav("#/claude/conversations")}>כל השיחות</a>
            </div>
            {override && <p className="ob-sub">שיחה שנפתחה מהרשימה. מעבר למסך אחר יחזיר את הצ'אט לנושא של המסך.</p>}
          </div>

          <div className="cc-msgs">
            {messages.length === 0 && !busy && (
              <div className="cc-msg assistant">
                <div className="src"><span className="ob-chip ai">קלוד</span></div>
                שאלו על המסך שאתם בו — מה כפתור עושה, מה השלב הבא, כמה עלה — או על המערכת כולה. שאלה שיש לה תשובה ודאית במסך נענית בלי מודל, בחינם.
              </div>
            )}
            {messages.map((m) => {
              if (m.role === "system") return <div key={m.id} className="cc-divider" title={m.text}><span>{m.text.split("\n")[0]}</span></div>;
              if (m.role === "user") return <div key={m.id} className="cc-msg user"><Text text={m.text} /></div>;
              if (m.kind === "navigate") {
                const route = typeof m.payload.route === "string" ? m.payload.route : null;
                return (
                  <div key={m.id} className="cc-msg assistant">
                    <div className="src"><span className="ob-chip ai">קלוד</span><span className="ob-sub">עבר אל "{String(m.payload.title ?? "")}" כדי לענות</span></div>
                    <Text text={m.text} />
                    <div className="foot">
                      {route && <button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(route)}>פתח שוב את "{String(m.payload.title ?? "")}"</button>}
                      {m.cost
                        ? <CostLine model={m.cost.model} effort={m.cost.effort} inputTokens={m.cost.inputTokens} outputTokens={m.cost.outputTokens} cacheReadTokens={m.cost.cacheReadTokens} costUsd={m.cost.costUsd} />
                        : <span className="ob-sub">המעבר עצמו לא עולה כלום</span>}
                    </div>
                  </div>
                );
              }
              if (m.kind === "proposal" || m.kind === "declared_cost" || m.kind === "refusal") {
                return (
                  <div key={m.id} className="cc-msg assistant" style={{ paddingTop: 6 }}>
                    <ProposalCard message={m} onUpdate={(next, extra) => setMessages((ms) => {
                      const out = ms.map((x) => (x.id === next.id ? next : x));
                      return extra ? [...out, extra] : out;
                    })} />
                  </div>
                );
              }
              const system = m.source === "system";
              return (
                <div key={m.id} className="cc-msg assistant">
                  <div className="src">
                    {system ? <><span className="ob-chip det">נענה מהמערכת</span><span className="ob-sub">בלי מודל · ללא עלות</span></> : <><span className="ob-chip ai">קלוד</span>{m.payload.from === "code" ? <span className="ob-sub">מקריאה בקוד של המאגר, באישורכם</span> : m.payload.unanswered ? <span className="ob-sub">אין לו את זה במסך</span> : <span className="ob-sub">מהעובדות שעל המסך</span>}</>}
                  </div>
                  <Text text={m.text} />
                  <div className="foot">
                    {system
                      ? <CostLine costUsd={0} source="system" note={m.payload.from === "glossary" ? "מהמילון של המסך" : "מהעובדות שעל המסך"} />
                      : m.cost ? <CostLine model={m.cost.model} effort={m.cost.effort} inputTokens={m.cost.inputTokens} outputTokens={m.cost.outputTokens} cacheReadTokens={m.cost.cacheReadTokens} costUsd={m.cost.costUsd} /> : <span className="ob-sub">העלות נרשמת ביומן הקריאות</span>}
                    <span className="cc-help">
                      <button type="button" aria-pressed={m.helpful === true} onClick={() => helpful(m, true)}>עזר</button>
                      <button type="button" aria-pressed={m.helpful === false} onClick={() => helpful(m, false)} title={m.helpfulSource === "reasked" ? "נשאל שוב מיד — נספר כ'לא עזר'" : undefined}>לא עזר</button>
                    </span>
                  </div>
                </div>
              );
            })}
            {busy && <div className="cc-msg assistant ob-sub"><span className="spinner" style={{ width: 12, height: 12, marginInlineEnd: 6, verticalAlign: "middle" }} />חושב…</div>}
            <div ref={end} />
          </div>

          {err && <div className="ob-note crit" style={{ margin: "0 18px 8px" }}>{err}</div>}
          <div className="cc-chips">
            {suggestions.map((s) => <button key={s} className="cc-chip" type="button" disabled={busy} onClick={() => void ask(s)}>{s}</button>)}
          </div>
          <div className="cc-input">
            <textarea
              ref={box}
              value={question}
              placeholder="שאלו על המסך, או על המערכת"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); } }}
            />
            <button className="btn btn-primary btn-sm" type="button" disabled={busy || !question.trim()} onClick={() => void ask(question)}>{busy ? "…" : "שאל"}</button>
          </div>
          <div className="cc-foot">Enter שולח, Shift+Enter שורה חדשה. קלוד עונה מהעובדות שעל המסך ולא מבצע דבר בעצמו. כל תשובה נשמרת, ועלותה נרשמת במרכז הבקרה.</div>
        </aside>
      )}
    </>
  );
}
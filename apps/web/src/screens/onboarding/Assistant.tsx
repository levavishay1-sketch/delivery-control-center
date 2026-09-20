import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { askOnboardingAssistant, getOnboardingAssistant, resetOnboardingAssistant, sendToOnboardingSession, type AssistantMessage, type OnboardingCost } from "../../api.ts";
import { errText, fmtInt, fmtTime, fmtUsd, modelLabel } from "./labels.ts";

/** Questions worth one click; each is an ordinary question to the assistant. */
const QUESTIONS = ["מה הוא רוצה ממני עכשיו?", "מה הוא עשה עד עכשיו?", "מה ההשלכות של כל אפשרות?", "איך ממשיכים מכאן?"];

/** Backticked commands, paths and code become left-to-right chips, so they do not scramble inside a Hebrew sentence. */
function withCode(line: string) {
  return line.split(/`([^`]+)`/g).map((part, i) => (i % 2 ? <bdi key={i} className="ob-chip">{part}</bdi> : part));
}

function Text({ text }: { text: string }) {
  return <>{text.split("\n").map((line, i) => <div key={i} dir="rtl">{withCode(line)}</div>)}</>;
}

/** The instruction the assistant proposes: the person reads it, may edit it, and only their click sends it. */
function SendCard({ repoId, runId, message, onSent }: { repoId: string; runId: string; message: AssistantMessage; onSent: (sentAt: string) => void }) {
  const [text, setText] = useState(message.send!.text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const sentAt = message.send!.sentAt;

  const send = async (force: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await sendToOnboardingSession(repoId, runId, { text, messageId: message.id, force });
      if (r.sent) { setUnconfirmed(!r.confirmed); onSent(new Date().toISOString()); }
      else if (confirm(`${r.reason}.\nלשלוח את ההוראה בכל זאת?`)) await send(true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ob-as-send">
      <div className="l">הוראה מוצעת לסשן של Claude — היא נשלחת רק כשאתם לוחצים, ואפשר לערוך אותה קודם</div>
      <textarea value={text} disabled={!!sentAt} onChange={(e) => setText(e.target.value)} />
      {err && <div className="ob-note crit" style={{ marginTop: 6 }}>{err}</div>}
      <div className="ob-actions" style={{ marginTop: 6 }}>
        {sentAt
          ? <span className="ob-sub">{unconfirmed ? `נשלח ב-${fmtTime(sentAt)}, אבל לא ראיתי שהסשן קיבל אותו — בדקו בטרמינל; אם הטקסט מחכה בתיבת ההקלדה, לחצו שם Enter` : `✓ נשלח לסשן ב-${fmtTime(sentAt)}`}</span>
          : <button type="button" className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void send(false)}>{busy ? "שולח…" : "↗ שלח לסשן"}</button>}
      </div>
    </div>
  );
}

/**
 * The Hebrew assistant under the terminal: a separate Claude conversation that
 * is told what the session is doing (the server sends it only what is new since
 * the last question). It answers; it never types into the session by itself.
 */
export function Assistant({ repoId, runId, screenRef, cost }: { repoId: string; runId: string; screenRef: MutableRefObject<(() => string) | null>; cost: OnboardingCost["assistant"] }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getOnboardingAssistant(repoId, runId).then((r) => { if (live) { setMessages(r.messages); setModel(r.model); } }).catch(() => {});
    return () => { live = false; };
  }, [repoId, runId]);

  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, busy]);

  const ask = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    setQuestion("");
    setMessages((m) => [...m, { id: `pending-${Date.now()}`, role: "user", text, at: new Date().toISOString() }]);
    try {
      const r = await askOnboardingAssistant(repoId, runId, text, screenRef.current?.() ?? "");
      setMessages((m) => [...m, r.message]);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }, [repoId, runId, busy, screenRef]);

  const reset = async () => {
    if (messages.length && !confirm("להתחיל שיחה חדשה עם העוזר? השיחה הנוכחית תימחק מהמסך, וההקשר הארוך שלה לא ייסחב (וזה חוסך עלות).")) return;
    try { await resetOnboardingAssistant(repoId, runId); setMessages([]); setErr(null); } catch (e) { setErr(errText(e)); }
  };

  const markSent = (id: string, sentAt: string) => setMessages((ms) => ms.map((m) => (m.id === id && m.send ? { ...m, send: { ...m.send, sentAt } } : m)));

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="ob-as-head">
        <h4>העוזר · שואלים אותו על מה שקורה בסשן</h4>
        <span className="ob-as-meta">{modelLabel(model)} · קורא בלבד, לא כותב ולא מקליד בסשן בעצמו{cost && cost.calls > 0 ? ` · עלות עד כה ${fmtUsd(cost.costUsd)} (${fmtInt(cost.calls)} שאלות)` : ""}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void reset()}>שיחה חדשה</button>
      </div>

      {messages.length > 0 && (
        <div className="ob-as-msgs">
          {messages.map((m) => (
            <div key={m.id} className={`ob-as-msg ${m.role}`}>
              <Text text={m.text} />
              {m.role === "assistant" && m.send && <SendCard repoId={repoId} runId={runId} message={m} onSent={(t) => markSent(m.id, t)} />}
            </div>
          ))}
          {busy && <div className="ob-as-msg assistant ob-sub">חושב…</div>}
          <div ref={end} />
        </div>
      )}
      {err && <div className="ob-note crit" style={{ marginBottom: 8 }}>{err}</div>}

      <div className="ob-as-chips">
        {QUESTIONS.map((q) => <button key={q} type="button" className="ob-as-chip" disabled={busy} onClick={() => void ask(q)}>{q}</button>)}
      </div>
      <div className="ob-as-input">
        <textarea
          value={question}
          placeholder="שאלו כל דבר על הסשן, או כתבו מה לומר לו — למשל: הוא סיים משהו, מה עשה ואיך ממשיכים?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); } }}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !question.trim()} onClick={() => void ask(question)}>{busy ? "…" : "שאל"}</button>
      </div>
      <p className="ob-sub" style={{ margin: "6px 2px 0" }}>Enter שולח, Shift+Enter שורה חדשה. העוזר מקבל בכל שאלה רק מה שהתחדש בסשן ומה שעל המסך.</p>
    </div>
  );
}

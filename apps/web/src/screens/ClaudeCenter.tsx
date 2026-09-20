import { useEffect, useMemo, useState } from "react";
import {
  analyseInsights, dismissInsight, getClaudeCalls, getClaudeOverview, getClients, getConversations, getInsights, getPolicy, openImprovementTask, putPolicy, setClientRetention,
  type ClaudeCallView, type ClaudeOverview, type ConversationView, type InsightsView, type PolicyCapability, type PolicyDoc, type PolicyPrice, type PolicyView,
} from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { CallsTable } from "../claude/CallsTable.tsx";
import { CostLine } from "../claude/CostLine.tsx";
import { GlossaryHint } from "../claude/GlossaryHint.tsx";
import { chatCommand, useClaudeContext } from "../claude/context.ts";
import { CAPABILITY_HE, EFFORTS, EFFORT_HE, MODEL_OPTIONS, OUTCOME_HE, capabilityLabel, effortLabel, fmtInt, fmtUsd, fmtWhen, modelLabel, outcomeOf, screenLabel } from "../claude/labels.ts";
import { errText } from "./onboarding/labels.ts";

/**
 * Claude's control center (claude-in-dcc §9): the one place with every
 * call, every conversation, all the money, the policy and the
 * conclusions. Every number here is a slice of the ledger; every number
 * about Claude on another screen is a slice of what is here.
 */
export type CenterTab = "overview" | "calls" | "conversations" | "insights" | "policy";
const TABS: { key: CenterTab; label: string; ready: boolean }[] = [
  { key: "overview", label: "סקירה", ready: true },
  { key: "calls", label: "קריאות", ready: true },
  { key: "conversations", label: "שיחות", ready: true },
  { key: "insights", label: "מסקנות", ready: true },
  { key: "policy", label: "מדיניות ושמירה", ready: true },
];

const monthOptions = () => {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ value: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, label: m.toLocaleDateString("he-IL", { month: "long", year: "numeric" }) });
  }
  return out;
};

export function ClaudeCenter({ tab, openId, nav }: { tab: CenterTab; openId?: string | undefined; nav: (h: string) => void }) {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]!.value);
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { getClients().then((r) => setClients(r.clients.map((c) => ({ id: c.id, name: c.name })))).catch(() => {}); }, []);
  // `#/claude/conversations/<id>` opens that conversation in the chat itself.
  useEffect(() => { if (openId) chatCommand({ type: "openConversation", id: openId }); }, [openId]);
  useClaudeContext({ screen: "claude", topic: { kind: "app" }, facts: { "לשונית": tab, "חודש": month }, suggestions: ["מה זה \"נענו בלי מודל\"?", "מה זה הסלמה?", "איך מורידים עלות?"] });

  const current = TABS.find((t) => t.key === tab) ?? TABS[0]!;
  return (
    <>
      <PageHead
        title="קלוד"
        sub="מרכז הבקרה: כל שיחה, כל קריאה, כל הכסף — במקום אחד. כל מספר על קלוד במסך אחר הוא חתך ממה שכאן."
        actions={
          <>
            <div className="field"><select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
            <div className="field"><select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">כל הלקוחות</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </>
        }
      />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} className="tab" role="tab" aria-selected={tab === t.key} disabled={!t.ready} title={t.ready ? undefined : "בשלב הבא של השינוי"} onClick={() => nav(`#/claude/${t.key}`)}>{t.label}</button>
        ))}
      </div>
      {current.key === "calls" ? <CallsTab month={month} clientId={clientId} nav={nav} />
        : current.key === "conversations" ? <ConversationsTab clientId={clientId} nav={nav} />
        : current.key === "insights" ? <InsightsTab month={month} clientId={clientId} nav={nav} />
        : current.key === "policy" ? <PolicyTab />
        : <OverviewTab month={month} clientId={clientId} nav={nav} />}
    </>
  );
}

/* ── שיחות ─────────────────────────────────────────────────────────── */

const TOPIC_KIND_HE: Record<string, string> = { wi: "דרישה", task: "משימה", pr: "בקשת מיזוג", run: "הטמעת מאגר", app: "המערכת" };
const dayOf = (iso: string) => {
  const d = new Date(iso), t = new Date();
  const diff = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  return diff <= 0 ? "היום" : diff === 1 ? "אתמול" : diff < 7 ? "השבוע" : "ישן יותר";
};

function ConversationsTab({ clientId, nav }: { clientId: string; nav: (h: string) => void }) {
  const [rows, setRows] = useState<ConversationView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRows(null); getConversations(clientId ? { clientId } : {}).then((r) => setRows(r.conversations)).catch((e) => setErr(String(e))); }, [clientId]);
  if (err) return <div className="empty">{err}</div>;
  if (!rows) return <div className="spin">טוען…</div>;
  const groups = ["היום", "אתמול", "השבוע", "ישן יותר"].map((g) => ({ g, rows: rows.filter((r) => dayOf(r.lastMessageAt) === g) })).filter((x) => x.rows.length);
  return (
    <div className="dash">
      <div>
        {rows.length === 0 && <div className="empty">עדיין אין שיחות. הצ'אט נפתח מהכפתור למטה משמאל, מכל מסך.</div>}
        {groups.map(({ g, rows: rs }) => (
          <div key={g} style={{ marginBottom: 22 }}>
            <p className="section-lbl">{g}</p>
            <div className="rowlist">
              {rs.map((c) => (
                <div key={c.id} className="cv-row" onClick={() => chatCommand({ type: "openConversation", id: c.id })}>
                  <span className="ic">{(TOPIC_KIND_HE[c.topicKind] ?? "?").slice(0, 1)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{TOPIC_KIND_HE[c.topicKind] ?? c.topicKind} · {c.topicTitle}</div>
                    <div className="s">{c.createdByName} · {fmtInt(c.messageCount)} הודעות · {fmtWhen(c.lastMessageAt)}{c.lastText ? ` — "${c.lastText}"` : ""}</div>
                  </div>
                  <div className="r">
                    <CostLine costUsd={c.costUsd} note={`${fmtInt(c.calls)} קריאות · ${fmtInt(Math.max(0, Math.floor(c.messageCount / 2) - c.calls))} מהמערכת`} />
                    {c.status === "active" ? <Pill tone="healthy">פעילה</Pill> : c.status === "rolled" ? <Pill tone="inactive">התגלגלה להמשך</Pill> : <Pill tone="inactive">נמחקה לפי השמירה</Pill>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {rows.length > 0 && <p className="ob-sub">לחיצה על שיחה פותחת אותה בצ'אט. <a onClick={() => nav("#/claude/calls")}>הקריאות שמאחורי העלויות ←</a></p>}
      </div>
      <div className="rail">
        <div className="panel">
          <h4>איך שיחות נפתחות</h4>
          <div className="ob-explain" style={{ marginTop: 0 }}>
            <div><b>לבד</b><span>המסך שאתם בו קובע את הנושא: דרישה, משימה, בקשת מיזוג, הטמעה — או "המערכת" כשאין ישות.</span></div>
            <div><b>נפרד</b><span>לכל נושא שיחה אחת לכל אדם. חוזרים אליה אחרי שבוע ומוצאים אותה כפי שהייתה.</span></div>
            <div><b>המשך</b><span>שיחה שהתארכה או התקררה ממשיכה בשיחה חדשה עם סיכום קצר. הסיכום הוא קריאה שנרשמת ועולה כסף — כמו כל קריאה.</span></div>
            <div><b>נשמר</b><span>מה שראיתם נשאר על המסך גם אם המודל כבר לא נושא אותו איתו.</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── סקירה ─────────────────────────────────────────────────────────── */

function Bars({ title, rows, labelOf, tone }: { title: string; rows: { key: string; label: string; usd: number; calls: number }[]; labelOf?: (k: string) => string; tone?: "ai" | "healthy" }) {
  const max = Math.max(0, ...rows.map((r) => r.usd));
  return (
    <div className="panel">
      <h4>{title}</h4>
      {rows.length === 0 ? <p className="ob-sub">אין קריאות בחודש הזה.</p> : (
        <div className="bars">
          {rows.slice(0, 8).map((r) => (
            <div className="bar" key={r.key}>
              <span className="n" title={r.label}>{labelOf ? labelOf(r.key) : r.label} <span className="muted small">· {fmtInt(r.calls)}</span></span>
              <span className="meter-track"><span className={`meter-fill${tone ? ` ${tone}` : ""}`} style={{ width: `${max > 0 ? Math.max(2, (r.usd / max) * 100) : 0}%` }} /></span>
              <span className="v">{fmtUsd(r.usd)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ month, clientId, nav }: { month: string; clientId: string; nav: (h: string) => void }) {
  const [o, setO] = useState<ClaudeOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setO(null);
    getClaudeOverview({ month, ...(clientId ? { clientId } : {}) }).then(setO).catch((e) => setErr(String(e)));
  }, [month, clientId]);
  if (err) return <div className="empty">{err}</div>;
  if (!o) return <div className="spin">טוען…</div>;
  const t = o.tiles;
  const failed = t.errors + t.timeouts;
  return (
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-top"><div><div className="lbl">עלות החודש</div><div className="num">{fmtUsd(t.costUsd)}</div></div><span className="badge-soft ai">$</span></div>
          <div className="stat-sub muted">{t.budgetPct != null ? `${t.budgetPct}% מהתקציב · ` : ""}{fmtInt(t.calls)} קריאות</div>
          <a className="stat-link" onClick={() => nav("#/claude/calls")}>כל הקריאות ←</a>
        </div>
        <div className="stat-tile">
          <div className="stat-top"><div><div className="lbl">נענו בלי מודל<GlossaryHint screen="claude" entry="without_model" /></div><div className="num">{t.questions > 0 ? `${t.answeredWithoutModelPct}%` : "—"}</div></div><span className="badge-soft healthy">✓</span></div>
          <div className="stat-sub muted">{t.questions > 0 ? `${fmtInt(t.answeredWithoutModel)} מתוך ${fmtInt(t.questions)} שאלות בצ'אט` : "הצ'אט מגיע בשלב הבא"}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-top"><div><div className="lbl">"לא עזר"<GlossaryHint screen="claude" entry="unhelpful" /></div><div className="num">{t.questions > 0 ? `${t.unhelpfulPct}%` : "—"}</div></div><span className="badge-soft warning">!</span></div>
          <div className="stat-sub muted">{t.questions > 0 ? `${fmtInt(t.unhelpful)} תשובות · ${fmtInt(t.reasked)} נשאלו שוב מיד` : "נמדד מהצ'אט"}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-top"><div><div className="lbl">לא עבד</div><div className="num">{fmtInt(failed + t.escalated)}</div></div><span className="badge-soft critical">✕</span></div>
          <div className="stat-sub muted">{fmtInt(t.errors)} שגיאות · {fmtInt(t.timeouts)} פסק זמן · {fmtInt(t.escalated)} נדרש מודל חזק יותר</div>
          <a className="stat-link" onClick={() => nav("#/claude/calls")}>מה לא עבד ←</a>
        </div>
      </div>

      <div className="dash">
        <div>
          <div className="section" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Bars title="לאן הולך הכסף · לפי לקוח" rows={o.byClient} />
            <Bars title="לפי סוג פעולה" rows={o.byCapability} labelOf={capabilityLabel} tone="ai" />
            <Bars title="לפי מודל" rows={o.byModel} labelOf={modelLabel} />
            <Bars title="לפי מסך" rows={o.byScreen} labelOf={screenLabel} tone="healthy" />
          </div>
          <div className="panel">
            <div className="section-head" style={{ marginBottom: 8 }}><h4 style={{ margin: 0 }}>לפי אדם</h4><a onClick={() => nav("#/claude/calls")}>לכל הקריאות ←</a></div>
            {o.byUser.length === 0 ? <p className="ob-sub">אין קריאות בחודש הזה.</p> : (
              <table className="wtable">
                <thead><tr><th>מי</th><th className="num">קריאות</th><th className="num">עלות</th></tr></thead>
                <tbody>{o.byUser.map((u) => <tr key={u.key}><td>{u.label}</td><td className="num">{fmtInt(u.calls)}</td><td className="num">{fmtUsd(u.usd)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
        <div className="rail">
          <div className="panel">
            <h4>המדיניות בפועל</h4>
            <div className="stat-line"><span className="l">קריאות לפי ברירת המחדל</span><span>{fmtInt(o.policy.defaults)}</span></div>
            <div className="stat-line"><span className="l">הוסלמו לפי כלל<GlossaryHint screen="claude" entry="escalated" /></span><span>{fmtInt(o.policy.escalated)}</span></div>
            <div className="stat-line"><span className="l">נבחרו ידנית</span><span>{fmtInt(o.policy.manual)}</span></div>
            <div className="stat-line"><span className="l">נדחו בתקרה</span><span>{fmtInt(o.policy.capped)}</span></div>
            <p className="ob-sub" style={{ marginTop: 8 }}>גרסת מדיניות {o.policy.version}. כל קריאה נושאת את הגרסה שלפיה נותבה.</p>
          </div>
          <div className="panel">
            <h4>טוקנים</h4>
            <div className="stat-line"><span className="l">קלט</span><span>{fmtInt(o.tokens.input)}</span></div>
            <div className="stat-line"><span className="l">נקראו מהמטמון<GlossaryHint screen="claude" entry="cache" /></span><span>{fmtInt(o.tokens.cacheRead)} ({o.tokens.cacheSharePct}%)</span></div>
            <div className="stat-line"><span className="l">נכתבו למטמון</span><span>{fmtInt(o.tokens.cacheWrite)}</span></div>
            <div className="stat-line"><span className="l">פלט</span><span>{fmtInt(o.tokens.output)}</span></div>
            <p className="ob-sub" style={{ marginTop: 8 }}>קריאה מהמטמון עולה עשירית ממחיר הקלט. שיעור נמוך אומר שהחלק הקבוע של הפרומפט קצר מדי או משתנה.</p>
          </div>
          <div className="panel">
            <h4>לא נענה</h4>
            <div className="stat-line"><span className="l">"אין לי את זה במסך"</span><span>{fmtInt(t.unanswered)}</span></div>
            <p className="ob-sub" style={{ marginTop: 8 }}>כל אחת כזו היא מועמדת לעובדה שהמסך צריך למסור (סעיף 7.2).</p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── קריאות ────────────────────────────────────────────────────────── */

function CallsTab({ month, clientId, nav }: { month: string; clientId: string; nav: (h: string) => void }) {
  const [capability, setCapability] = useState("");
  const [model, setModel] = useState("");
  const [outcome, setOutcome] = useState("");
  const [escalated, setEscalated] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: ClaudeCallView[]; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const limit = 50;
  useEffect(() => {
    setData(null);
    getClaudeCalls({
      month, limit, offset: page * limit,
      ...(clientId ? { clientId } : {}), ...(capability ? { capability } : {}), ...(model ? { model } : {}), ...(outcome ? { outcome } : {}), ...(escalated ? { escalated: "1" } : {}),
    }).then(setData).catch((e) => setErr(String(e)));
  }, [month, clientId, capability, model, outcome, escalated, page]);
  useEffect(() => { setPage(0); }, [month, clientId, capability, model, outcome, escalated]);

  return (
    <>
      <div className="filter-bar">
        <div className="field"><label>יכולת</label><select value={capability} onChange={(e) => setCapability(e.target.value)}><option value="">הכול</option>{Object.entries(CAPABILITY_HE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>מודל</label><select value={model} onChange={(e) => setModel(e.target.value)}><option value="">הכול</option>{MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
        <div className="field"><label>תוצאה</label><select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">הכול</option>{Object.entries(OUTCOME_HE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <div className="field"><label>הסלמה</label><select value={escalated ? "1" : ""} onChange={(e) => setEscalated(!!e.target.value)}><option value="">הכול</option><option value="1">רק כאלה שנדרש מודל חזק יותר</option></select></div>
        {data && <span className="ob-sub" style={{ alignSelf: "center" }}>{fmtInt(data.total)} קריאות · <CostLine costUsd={data.rows.reduce((a, r) => a + r.costUsd, 0)} note="בעמוד הזה" /></span>}
      </div>
      {err && <div className="empty">{err}</div>}
      {!data && !err && <div className="spin">טוען…</div>}
      {data && (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <CallsTable rows={data.rows} nav={nav} emptyText="אין קריאות שמתאימות לסינון." />
        </div>
      )}
      {data && data.total > limit && (
        <div className="pager">
          <span>{page * limit + 1}–{Math.min((page + 1) * limit, data.total)} מתוך {fmtInt(data.total)}</span>
          <div className="links">
            {page > 0 && <a onClick={() => setPage(page - 1)}>← הקודם</a>}
            {(page + 1) * limit < data.total && <a onClick={() => setPage(page + 1)}>הבא →</a>}
          </div>
        </div>
      )}
      <p className="ob-sub" style={{ marginTop: 10 }}>יומן הקריאות הוא המקור היחיד: "עלות AI בפועל" בדרישה, התקציבים ופאנל ההטמעה קוראים ממנו.</p>
    </>
  );
}

/* ── מסקנות (§9.3–§9.4, §9.6) ─────────────────────────────────────────── */

function InsightsTab({ month, clientId, nav }: { month: string; clientId: string; nav: (h: string) => void }) {
  const [v, setV] = useState<InsightsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () => { getInsights({ month, ...(clientId ? { clientId } : {}) }).then(setV).catch((e) => setErr(String(e))); };
  useEffect(() => { setV(null); setNote(null); load(); }, [month, clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err && !v) return <div className="empty">{err}</div>;
  if (!v) return <div className="spin">טוען…</div>;

  // What "נתח שאלות" would send: clusters above the threshold that were never worded, or grew since.
  const due = v.clusters.filter((c) => c.aboveThreshold && c.status !== "dismissed" && (c.analysedCount == null || c.analysedCount !== c.count || !c.finding));
  const act = async (key: string, fn: () => Promise<string | null | void>) => {
    setBusy(key); setErr(null);
    try { const n = await fn(); if (n) setNote(n); load(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const estimate = v.estimate.usd != null ? `כ-${fmtUsd(v.estimate.usd)}, ${modelLabel(v.estimate.model)}` : modelLabel(v.estimate.model);
  const openConv = (id: string | null) => { if (id) chatCommand({ type: "openConversation", id }); };

  return (
    <div className="dash">
      <div>
        <div className="panel">
          <div className="section-head" style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>שאלות שחוזרות<GlossaryHint screen="claude" entry="insights" /></h4>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy === "analyse" || due.length === 0} title={due.length ? undefined : "אין שאלה מעל הסף שעוד לא נותחה"}
              onClick={() => void act("analyse", () => analyseInsights({ month, ...(clientId ? { clientId } : {}) }).then((r) => r.analysed
                ? `נוסחו ${r.analysed} ממצאים בקריאה אחת${r.costUsd != null ? ` · ${fmtUsd(r.costUsd)}` : ""} · הקריאה רשומה ביומן בשמכם`
                : "אין שאלות חדשות לנתח"))}>
              {busy === "analyse" ? "מנתח…" : `נתח שאלות${due.length ? ` (${due.length})` : ""}`}<GlossaryHint screen="claude" entry="analyse" />
            </button>
          </div>
          <p className="ob-sub">שאלה שחוזרת על אותו מסך היא פער במסך, לא בקלוד. הקיבוץ כאן לא עולה כסף. "נתח שאלות" היא קריאה אחת בשמכם ({estimate}) שמנסחת ממצא והמלצה לכל שאלה שחזרה {v.threshold} פעמים ומעלה — ונרשמת ביומן כמו כל קריאה.</p>
          {note && <div className="ob-note" style={{ marginBottom: 10 }}>{note}</div>}
          {err && <div className="ob-note crit" style={{ marginBottom: 10 }}>{err}</div>}
          {v.clusters.length === 0 ? <p className="ob-sub">בחודש הזה אף שאלה עוד לא חזרה על עצמה.</p> : (
            <table className="wtable">
              <thead><tr><th>מסך</th><th>השאלה</th><th className="num">פעמים</th><th>ממצא והמלצה</th><th>מה עושים</th></tr></thead>
              <tbody>
                {v.clusters.map((c) => (
                  <tr key={`${c.clientId}|${c.screen}|${c.questionKey}`}>
                    <td>{screenLabel(c.screen)}<div className="muted small">{c.clientName}</div></td>
                    <td>"{c.sampleQuestion}"<div className="muted small">לאחרונה {fmtWhen(c.lastAskedAt)}</div></td>
                    <td className="num">{fmtInt(c.count)}{!c.aboveThreshold && <div className="muted small">מתחת לסף ({v.threshold})</div>}</td>
                    <td>{c.finding ? <><div>{c.finding}</div>{c.recommendation && <div className="muted small">המלצה: {c.recommendation}</div>}</> : <span className="muted small">{c.aboveThreshold ? "עדיין לא נותח" : "—"}</span>}</td>
                    <td>
                      {c.status === "task_opened" && c.workitemId ? <a onClick={() => nav(`#/wi/${c.workitemId}`)}>משימת שיפור נפתחה ←</a>
                        : c.status === "dismissed" ? <Pill tone="inactive">לא רלוונטי</Pill>
                        : c.id && c.finding ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button className="btn btn-primary btn-sm" type="button" disabled={busy === c.id} onClick={() => void act(c.id!, () => openImprovementTask(c.id!).then(() => "נפתחה משימת שיפור על הלקוח הפנימי, בשמכם — הממצא וההמלצה הם ההערה הראשונה שלה"))}>פתח משימת שיפור<GlossaryHint screen="claude" entry="improvement_task" /></button>
                            <button className="btn btn-secondary btn-sm" type="button" disabled={busy === c.id} onClick={() => void act(c.id!, () => dismissInsight(c.id!).then(() => null))}>לא רלוונטי</button>
                          </div>
                        ) : <span className="muted small">{c.aboveThreshold ? "ממתין לניתוח" : `ינותח מ-${v.threshold} פעמים`}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h4>"אין לי את זה במסך"</h4>
          <p className="ob-sub">קלוד אמר שהמסך לא מוסר את מה שנשאל. כל שורה כזו היא מועמדת לעובדה שהמסך צריך להציג (סעיף 7.2).</p>
          {v.unanswered.length === 0 ? <p className="ob-sub">אין כאלה בחודש הזה.</p> : (
            <div className="rowlist">
              {v.unanswered.map((r) => (
                <div key={r.id} className="cv-row" onClick={() => openConv(r.conversationId)}>
                  <span className="ic">?</span>
                  <div style={{ minWidth: 0 }}><div className="t">"{r.label}"</div><div className="s">{screenLabel(r.screen)} · {r.userName} · {fmtWhen(r.startedAt)}</div></div>
                  <div className="r"><CostLine costUsd={r.costUsd} model={r.modelUsed} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h4>"לא עזר"<GlossaryHint screen="claude" entry="unhelpful" /></h4>
          <p className="ob-sub">תשובות שאדם סימן שלא עזרו, או שאותה שאלה נשאלה שוב מיד אחריהן.</p>
          {v.unhelpful.length === 0 ? <p className="ob-sub">אין כאלה בחודש הזה.</p> : (
            <div className="rowlist">
              {v.unhelpful.map((r) => (
                <div key={r.id} className="cv-row" onClick={() => openConv(r.conversationId)}>
                  <span className="ic">!</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{r.question ? `"${r.question}"` : "(שאלה לא נמצאה)"}</div>
                    <div className="s">{screenLabel(r.screen)} · {fmtWhen(r.createdAt)} · {r.source === "reasked" ? "נשאלה שוב מיד" : "סומן על ידי אדם"}{r.note ? ` — "${r.note}"` : ""}</div>
                    <div className="s muted">{r.answer}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rail">
        <div className="panel">
          <h4>לא עבד</h4>
          {v.failed.length === 0 ? <p className="ob-sub">אין שגיאות, פסקי זמן או דחיות בחודש הזה.</p> : v.failed.slice(0, 8).map((r) => (
            <div key={r.id} className="stat-line" style={{ alignItems: "flex-start" }}>
              <span className="l"><a onClick={() => nav(`#/claude/calls`)}>{capabilityLabel(r.capability)}</a><div className="muted small">{fmtWhen(r.startedAt)} · {r.userName}{r.errorText ? ` — ${r.errorText.slice(0, 80)}` : ""}</div></span>
              <Pill tone={outcomeOf(r.outcome).tone}>{outcomeOf(r.outcome).label}</Pill>
            </div>
          ))}
        </div>
        <div className="panel">
          <h4>נדרש מודל חזק יותר<GlossaryHint screen="claude" entry="escalated" /></h4>
          {v.escalated.length === 0 ? <p className="ob-sub">אף קריאה לא הוסלמה בחודש הזה.</p> : v.escalated.slice(0, 8).map((r) => (
            <div key={r.id} className="stat-line" style={{ alignItems: "flex-start" }}>
              <span className="l">{capabilityLabel(r.capability)}<div className="muted small">{r.policyRule ?? ""}</div></span>
              <span>{modelLabel(r.modelUsed)}</span>
            </div>
          ))}
          <p className="ob-sub" style={{ marginTop: 8 }}>הרבה הסלמות באותו כלל = ברירת מחדל מוסווית. משנים אותה בלשונית "מדיניות ושמירה".</p>
        </div>
        <div className="panel">
          <h4>מה עושים עם מסקנה</h4>
          <div className="ob-explain" style={{ marginTop: 0 }}>
            <div><b>מנתחים</b><span>קלוד מנסח ממצא והמלצה לכל שאלה שחזרה מעל הסף. קריאה אחת, בשמכם, ביומן.</span></div>
            <div><b>פותחים משימה</b><span>הממצא הופך לדרישה על הלקוח הפנימי של DCC — כמו כל דרישה: בחינת בשלות, פירוק, פיתוח.</span></div>
            <div><b>או מסמנים</b><span>"לא רלוונטי" משאיר את הספירה ומוריד את השורה מהרשימה.</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── מדיניות ושמירה (§9.9–§9.10) ──────────────────────────────────────── */

const TIER_HE: Record<string, string> = { haiku: "קל", sonnet: "רגיל", opus: "חזק" };
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

function PolicyTab() {
  const [v, setV] = useState<PolicyView | null>(null);
  const [draft, setDraft] = useState<PolicyDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [retention, setRetention] = useState<Record<string, string>>({});
  const load = () => getPolicy().then((p) => {
    setV(p); setDraft(JSON.parse(JSON.stringify(p.policy)) as PolicyDoc);
    setRetention(Object.fromEntries(p.retention.clients.map((c) => [c.clientId, c.days == null ? "" : String(c.days)])));
  }).catch((e) => setErr(String(e)));
  useEffect(() => { void load(); }, []);
  if (err && !v) return <div className="empty">{err}</div>;
  if (!v || !draft) return <div className="spin">טוען…</div>;

  const caps = Object.entries(draft.capabilities).filter((e): e is [string, PolicyCapability] => typeof e[1] === "object");
  const prices = Object.entries(draft.prices).filter((e): e is [string, PolicyPrice] => typeof e[1] === "object");
  const tiers = Object.entries(draft.tiers);
  const dirty = JSON.stringify(draft) !== JSON.stringify(v.policy);
  const setCap = (k: string, patch: Partial<PolicyCapability>) => setDraft({ ...draft, capabilities: { ...draft.capabilities, [k]: { ...(draft.capabilities[k] as PolicyCapability), ...patch } } });
  const setTier = (k: string, patch: Partial<{ model: string; maxUsdPerCall: number }>) => setDraft({ ...draft, tiers: { ...draft.tiers, [k]: { ...draft.tiers[k]!, ...patch } } });
  const setChat = (patch: Partial<PolicyDoc["chat"]>) => setDraft({ ...draft, chat: { ...draft.chat, ...patch } });

  const save = async () => {
    setSaving(true); setErr(null); setSaved(null);
    try {
      // Only what the editor changes travels; an emptied cap goes as null so the file drops it.
      const r = await putPolicy({
        tiers: draft.tiers,
        capabilities: Object.fromEntries(caps.map(([k, c]) => [k, { default: c.default, effort: c.effort, maxUsdPerCall: c.maxUsdPerCall ?? null, maxInputTokens: c.maxInputTokens ?? null }])),
        chat: draft.chat, guardrails: draft.guardrails,
      });
      setSaved(r.changes.length ? `נשמר כגרסה ${r.policy.version} · ${r.changes.length} שינויים: ${r.changes.map((c) => c.path).join(", ")} · נרשם ביומן הפעילות בשמכם` : "אין שינוי לשמור");
      await load();
    } catch (e) { setErr(errText(e)); } finally { setSaving(false); }
  };
  const saveRetention = async (clientId: string) => {
    setErr(null);
    try {
      const raw = retention[clientId] ?? "";
      await setClientRetention(clientId, raw.trim() === "" ? null : Number(raw));
      setSaved("תקופת השמירה של הלקוח נשמרה ונרשמה ביומן הפעילות שלו");
      await load();
    } catch (e) { setErr(errText(e)); }
  };

  return (
    <div className="dash">
      <div>
        <div className="panel">
          <div className="section-head" style={{ marginBottom: 6 }}>
            <h4 style={{ margin: 0 }}>המדיניות<GlossaryHint screen="claude" entry="policy" /> · גרסה {v.policy.version}</h4>
            <div style={{ display: "flex", gap: 8 }}>
              {dirty && <button className="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={() => setDraft(JSON.parse(JSON.stringify(v.policy)) as PolicyDoc)}>בטל שינויים</button>}
              <button className="btn btn-primary btn-sm" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "שומר…" : "שמור מדיניות"}</button>
            </div>
          </div>
          <p className="ob-sub">
            איזה מודל לאיזו פעולה, באיזה מאמץ ועם איזו תקרה. השינוי חל על הקריאה הבאה; כל קריאה נושאת את גרסת המדיניות שלפיה נותבה, ושמירה נרשמת ביומן הפעילות בשמכם.
            {v.lastChange && <> שינוי אחרון: {fmtWhen(v.lastChange.at)}{v.lastChange.byName ? ` · ${v.lastChange.byName}` : ""} · {v.lastChange.fromVersion === v.lastChange.toVersion ? "תקופת השמירה של לקוח" : `גרסה ${v.lastChange.fromVersion} → ${v.lastChange.toVersion} (${v.lastChange.changes.map((c) => c.path).join(", ")})`}.</>}
          </p>
          {saved && <div className="ob-note" style={{ marginBottom: 10 }}>{saved}</div>}
          {err && <div className="ob-note crit" style={{ marginBottom: 10 }}>{err}</div>}
          <table className="wtable">
            <thead><tr><th>פעולה</th><th>מודל</th><th>מאמץ</th><th>תקרה לקריאה ($)</th><th>תקרת קלט (טוקנים)</th></tr></thead>
            <tbody>
              {caps.map(([k, c]) => (
                <tr key={k}>
                  <td>{capabilityLabel(k)}<div className="muted small">{k}{c.escalateOn?.length ? ` · ${c.escalateOn.length} כללי הסלמה` : ""}</div></td>
                  <td><select value={c.default} onChange={(e) => setCap(k, { default: e.target.value })}>{tiers.map(([t, tv]) => <option key={t} value={t}>{TIER_HE[t] ?? t} · {modelLabel(tv.model)}</option>)}</select></td>
                  <td><select value={c.effort ?? "medium"} onChange={(e) => setCap(k, { effort: e.target.value })}>{EFFORTS.map((e) => <option key={e} value={e}>{EFFORT_HE[e]}</option>)}</select></td>
                  <td><input type="number" step="0.01" min="0" placeholder={`לפי הדרגה (${draft.tiers[c.default]?.maxUsdPerCall ?? "—"})`} value={c.maxUsdPerCall ?? ""} onChange={(e) => setCap(k, { maxUsdPerCall: num(e.target.value) })} style={{ width: 110 }} /></td>
                  <td><input type="number" step="1000" min="0" placeholder="ללא" value={c.maxInputTokens ?? ""} onChange={(e) => setCap(k, { maxInputTokens: num(e.target.value) })} style={{ width: 110 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ob-sub" style={{ marginTop: 8 }}>"מודל" בוחר דרגה — קל, רגיל או חזק — והדרגה אומרת איזה מודל בדיוק (למטה). "תקרה לקריאה" עוצרת קריאה שעברה את הסכום; ריק = תקרת הדרגה. "תקרת קלט" דוחה קריאה שהקלט שלה גדול מדי עוד לפני שהיא רצה — הסימן שהצ'אט שולח יותר מדי.</p>
        </div>

        <div className="panel">
          <h4>הדרגות</h4>
          <table className="wtable">
            <thead><tr><th>דרגה</th><th>המודל</th><th>תקרה לקריאה ($)</th></tr></thead>
            <tbody>
              {tiers.map(([t, tv]) => (
                <tr key={t}>
                  <td>{TIER_HE[t] ?? t}<div className="muted small">{t}</div></td>
                  <td><select value={tv.model} onChange={(e) => setTier(t, { model: e.target.value })}>{MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></td>
                  <td><input type="number" step="0.05" min="0.01" value={tv.maxUsdPerCall} onChange={(e) => setTier(t, { maxUsdPerCall: Number(e.target.value) })} style={{ width: 110 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h4>הצ'אט</h4>
          <div className="ob-explain" style={{ marginTop: 0 }}>
            <div><b>גלגול לפי אורך</b><span><input type="number" step="1000" min="2000" value={draft.chat.rolloverInputTokens} onChange={(e) => setChat({ rolloverInputTokens: Number(e.target.value) })} style={{ width: 110 }} /> טוקנים — שיחה שהקשר שלה גדל מעבר לזה ממשיכה בשיחה חדשה עם סיכום קצר (קריאה שנרשמת).</span></div>
            <div><b>גלגול לפי שקט</b><span><input type="number" min="1" value={draft.chat.rolloverColdDays} onChange={(e) => setChat({ rolloverColdDays: Number(e.target.value) })} style={{ width: 80 }} /> ימים — אחרי שקט כזה השאלה הבאה פותחת המשך במקום להעמיס את כל העבר.</span></div>
            <div><b>שמירה<GlossaryHint screen="claude" entry="retention" /></b><span><input type="number" min="1" value={draft.chat.retentionDays} onChange={(e) => setChat({ retentionDays: Number(e.target.value) })} style={{ width: 80 }} /> ימים — ברירת המחדל לכל הלקוחות; אחריהם טקסט השיחה נמחק, רשומות העלות נשארות.</span></div>
            <div><b>סף החזרות<GlossaryHint screen="claude" entry="threshold" /></b><span><input type="number" min="2" value={draft.chat.insightsMinRepeats} onChange={(e) => setChat({ insightsMinRepeats: Number(e.target.value) })} style={{ width: 80 }} /> פעמים — כמה פעמים שאלה צריכה לחזור כדי שתנותח בלשונית "מסקנות".</span></div>
            <div><b>הצהרת עלות</b><span>מעל <input type="number" step="0.05" min="0" value={draft.chat.declareCostAboveUsd} onChange={(e) => setChat({ declareCostAboveUsd: Number(e.target.value) })} style={{ width: 80 }} /> $ — שאלה שדורשת קריאה בקוד מוצגת עם עלות משוערת ומחכה לאישור.</span></div>
          </div>
        </div>
      </div>

      <div className="rail">
        <div className="panel">
          <h4>שמירה לפי לקוח</h4>
          <p className="ob-sub">ריק = ברירת המחדל ({v.retention.defaultDays} ימים). שינוי נרשם ביומן הפעילות של הלקוח.</p>
          {v.retention.clients.map((c) => (
            <div key={c.clientId} className="stat-line" style={{ gap: 8 }}>
              <span className="l">{c.clientName}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="number" min="1" max="3650" placeholder={String(v.retention.defaultDays)} value={retention[c.clientId] ?? ""} onChange={(e) => setRetention({ ...retention, [c.clientId]: e.target.value })} style={{ width: 70 }} />
                <button className="btn btn-secondary btn-sm" type="button" disabled={(retention[c.clientId] ?? "") === (c.days == null ? "" : String(c.days))} onClick={() => void saveRetention(c.clientId)}>שמור</button>
              </span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h4>מחירון</h4>
          <p className="ob-sub">דולר למיליון טוקנים, לפי המחירון הרשמי. הקריאה מדווחת את עלותה בעצמה; המחירון כאן משמש לאומדנים ולחישוב מחדש. עורכים בקובץ <code>config/model-policy.json</code>.</p>
          {prices.map(([m, p]) => (
            <div key={m} className="stat-line" style={{ alignItems: "flex-start" }}>
              <span className="l">{modelLabel(m)}</span>
              <span className="small">קלט {p.input} · פלט {p.output} · מטמון {p.cacheRead}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h4>מה קורה כששומרים</h4>
          <div className="ob-explain" style={{ marginTop: 0 }}>
            <div><b>מיד</b><span>הקריאה הבאה מכל מסך מנותבת לפי הגרסה החדשה. קריאות שכבר רצות לא משתנות.</span></div>
            <div><b>נרשם</b><span>גרסה חדשה, מי שינה, מתי ומה — ביומן הפעילות של הלקוח הפנימי. כל שורה ביומן הקריאות נושאת את הגרסה שלה.</span></div>
            <div><b>לא נמחק</b><span>אי אפשר להוסיף או להסיר פעולה מכאן — רק לשנות את הערכים שלה. פעולה שאין לה קורא היא הצהרה, לא מדיניות.</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

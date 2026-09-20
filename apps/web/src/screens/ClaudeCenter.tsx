import { useEffect, useMemo, useState } from "react";
import { getClaudeCalls, getClaudeOverview, getClients, type ClaudeCallView, type ClaudeOverview } from "../api.ts";
import { PageHead } from "../ui.tsx";
import { CallsTable } from "../claude/CallsTable.tsx";
import { CostLine } from "../claude/CostLine.tsx";
import { CAPABILITY_HE, MODEL_OPTIONS, OUTCOME_HE, capabilityLabel, fmtInt, fmtUsd, modelLabel, screenLabel } from "../claude/labels.ts";

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
  { key: "conversations", label: "שיחות", ready: false },
  { key: "insights", label: "מסקנות", ready: false },
  { key: "policy", label: "מדיניות ושמירה", ready: false },
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

export function ClaudeCenter({ tab, nav }: { tab: CenterTab; nav: (h: string) => void }) {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]!.value);
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { getClients().then((r) => setClients(r.clients.map((c) => ({ id: c.id, name: c.name })))).catch(() => {}); }, []);

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
      {current.key === "calls" ? <CallsTab month={month} clientId={clientId} nav={nav} /> : <OverviewTab month={month} clientId={clientId} nav={nav} />}
    </>
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
          <div className="stat-top"><div><div className="lbl">נענו בלי מודל</div><div className="num">{t.questions > 0 ? `${t.answeredWithoutModelPct}%` : "—"}</div></div><span className="badge-soft healthy">✓</span></div>
          <div className="stat-sub muted">{t.questions > 0 ? `${fmtInt(t.answeredWithoutModel)} מתוך ${fmtInt(t.questions)} שאלות בצ'אט` : "הצ'אט מגיע בשלב הבא"}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-top"><div><div className="lbl">"לא עזר"</div><div className="num">{t.questions > 0 ? `${t.unhelpfulPct}%` : "—"}</div></div><span className="badge-soft warning">!</span></div>
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
            <div className="stat-line"><span className="l">הוסלמו לפי כלל</span><span>{fmtInt(o.policy.escalated)}</span></div>
            <div className="stat-line"><span className="l">נבחרו ידנית</span><span>{fmtInt(o.policy.manual)}</span></div>
            <div className="stat-line"><span className="l">נדחו בתקרה</span><span>{fmtInt(o.policy.capped)}</span></div>
            <p className="ob-sub" style={{ marginTop: 8 }}>גרסת מדיניות {o.policy.version}. כל קריאה נושאת את הגרסה שלפיה נותבה.</p>
          </div>
          <div className="panel">
            <h4>טוקנים</h4>
            <div className="stat-line"><span className="l">קלט</span><span>{fmtInt(o.tokens.input)}</span></div>
            <div className="stat-line"><span className="l">נקראו מהמטמון</span><span>{fmtInt(o.tokens.cacheRead)} ({o.tokens.cacheSharePct}%)</span></div>
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

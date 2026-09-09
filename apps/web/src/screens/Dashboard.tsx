import { useEffect, useState } from "react";
import { getDashboard, REQ_TYPE_HE, type Dashboard as D } from "../api.ts";
import { ICONS, Icon, initials } from "../ui.tsx";
import { NewRequirement } from "../forms.tsx";

const PHASE: Record<string, { label: string; tone: string }> = {
  intake: { label: "קליטה", tone: "inactive" }, shaping: { label: "עיצוב", tone: "healthy" },
  building: { label: "בבנייה", tone: "healthy" }, review: { label: "בבדיקה", tone: "healthy" },
  done: { label: "הושלם", tone: "active" }, archived: { label: "אורכב", tone: "inactive" },
};
const PRIO: Record<string, string> = { critical: "קריטית", high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const TREND_LABEL: Record<string, string> = { up: "גבוהה", down: "נמוכה", flat: "יציבה" };
const money = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שעות`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};

export function Dashboard({ nav }: { nav: (h: string) => void }) {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"req" | null>(null);
  const reload = () => getDashboard().then(setD).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); }, []);

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <h1>לוח בקרה</h1>
          <p>ברוך הבא למערכת ניהול הפרויקטים</p>
        </div>
        <div className="head-actions">
          <div className="search-field">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS.search}</svg>
            חיפוש…
          </div>
          <button className="btn btn-primary" onClick={() => setModal("req")}><Icon d={ICONS.plus} size={14} /> הוספת דרישה</button>
        </div>
      </div>

      {modal === "req" && <NewRequirement onClose={() => setModal(null)} onDone={(id) => { setModal(null); if (id) nav(`#/wi/${id}`); else reload(); }} />}

      {err && <div className="empty">{err}</div>}
      {!d && !err && <div className="spin">טוען…</div>}

      {d && (
        <div className="dash">
          <div>
            {/* ---- stat tiles ---- */}
            <div className="stat-row">
              <Stat ic={ICONS.folder} tone="accent" label="דרישות-על פעילות" num={d.stats.initiatives} sub={d.stats.initiativesDelta ? `+${d.stats.initiativesDelta} החודש` : "ללא שינוי"} link="כל הדרישות" onLink={() => nav("#/requirements")} />
              <Stat ic={ICONS.list} tone="healthy" label="דרישות פתוחות" num={d.stats.openItems} sub={d.stats.itemsDelta ? `+${d.stats.itemsDelta} החודש` : "ללא שינוי"} link="כל הדרישות" onLink={() => nav("#/work")} />
              <Stat ic={ICONS.triangle} tone="warning" warn label="דרישות חסומות" num={d.stats.blockedItems} sub="לטיפול מיידי" link="חסימות" onLink={() => nav("#/work?filter=blocked")} />
              <Stat ic={ICONS.slash} tone="ai" label="עלות AI החודש" num={money(d.stats.aiCostUsd)} sub={`${d.stats.aiBudgetPct}% מהתקציב`} warn={d.stats.aiBudgetPct >= 80} link="תקציבים" onLink={() => nav("#/budgets")} />
            </div>

            {/* ---- recent top-level requirements ---- */}
            <div className="section">
              <div className="section-head">
                <p className="section-lbl" style={{ margin: 0 }}>דרישות-על אחרונות</p>
                <a onClick={() => nav("#/requirements")}>צפייה בכל הדרישות ←</a>
              </div>
              <div className="proj-grid">
                {d.initiatives.map((p) => {
                  const st = PHASE[p.phase] ?? { label: p.phase, tone: "inactive" };
                  return (
                    <div className="pcard" key={p.id} onClick={() => nav(`#/wi/${p.id}`)}>
                      <div className="pc-top">
                        <span className={`pill ${st.tone}`}><span className="dot" />{st.label}</span>
                        <button className="kebab" onClick={(e) => e.stopPropagation()}>⋮</button>
                      </div>
                      <div>
                        <div className="pc-name">{p.name}</div>
                        <div className="pc-client">לקוח: {p.clientName}</div>
                      </div>
                      <dl>
                        <div><dt>סוג</dt><dd>{REQ_TYPE_HE[p.type] ?? p.type}</dd></div>
                        <div><dt>תקציב</dt><dd>{money(p.budgetUsd)}</dd></div>
                        <div><dt>עלות AI החודש</dt><dd>{money(p.aiCostUsd ?? 0)}</dd></div>
                      </dl>
                      <div className="pc-foot">
                        <div className="avatar-stack">
                          {p.ownerName && <span className="a">{initials(p.ownerName)}</span>}
                        </div>
                        <span style={{ fontSize: 11, color: "var(--ink-400)" }}>{p.children ?? 0} תת-דרישות</span>
                      </div>
                    </div>
                  );
                })}
                {d.initiatives.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>אין דרישות.</div>}
              </div>
            </div>

            {/* ---- recent work items ---- */}
            <div className="section">
              <div className="section-head">
                <p className="section-lbl" style={{ margin: 0 }}>דרישות אחרונות</p>
                <a onClick={() => nav("#/work")}>צפייה בכל הדרישות ←</a>
              </div>
              <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
                <table className="wtable">
                  <thead><tr><th>דרישה</th><th>תחת</th><th>אחראי</th><th>עדיפות</th><th>תקציב AI</th><th>עודכן לאחרונה</th><th></th></tr></thead>
                  <tbody>
                    {d.recentWorkItems.map((w) => (
                      <tr key={w.id}>
                        <td><span className="w-title" onClick={() => nav(`#/wi/${w.id}`)}>{w.title}</span></td>
                        <td style={{ color: "var(--ink-500)" }}>{w.parentTitle ?? w.clientName}</td>
                        <td><span className="w-owner"><span className="a">{initials(w.ownerName)}</span>{w.ownerName}</span></td>
                        <td><span className={`prio ${w.priority}`}>{PRIO[w.priority] ?? w.priority}</span></td>
                        <td><span className={`trend ${w.trend}`}>{w.trend === "up" ? "↑" : w.trend === "down" ? "↓" : "—"} {TREND_LABEL[w.trend]}</span>{w.aiBudgetUsd ? <span style={{ color: "var(--ink-400)", marginInlineStart: 6 }}>${w.aiSpentUsd}/${w.aiBudgetUsd}</span> : null}</td>
                        <td style={{ color: "var(--ink-400)" }}>{ago(w.updatedAt)}</td>
                        <td><button className="kebab">⋮</button></td>
                      </tr>
                    ))}
                    {d.recentWorkItems.length === 0 && <tr><td colSpan={7}><div className="empty">אין דרישות.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ---- right rail ---- */}
          <div className="rail">
            <div className="panel">
              <h4>פעולות מהירות</h4>
              <div className="qa-row" onClick={() => setModal("req")}><span className="qa-ic"><Icon d={ICONS.plus} size={13} /></span>הוספת דרישה</div>
              <div className="qa-row" onClick={() => nav("#/alerts")}><span className="qa-ic"><Icon d={ICONS.bell} size={13} /></span>צפייה בהתראות</div>
              <div className="qa-row" onClick={() => nav("#/budgets")}><span className="qa-ic"><Icon d={ICONS.slash} size={13} /></span>דוח תקציב</div>
            </div>

            <div className="panel">
              <h4>התראות אחרונות</h4>
              {d.alerts.map((a) => (
                <div className="alert-row" key={a.id}>
                  <span className={`adot ${a.severity === "critical" ? "critical" : a.severity === "warn" ? "warn" : "info"}`} />
                  <div className="abody">
                    <p className="at">{a.title}</p>
                    {a.body && <p className="as">{a.body}</p>}
                    <p className="am">{ago(a.createdAt)}</p>
                  </div>
                </div>
              ))}
              {d.alerts.length === 0 && <p className="as" style={{ color: "var(--ink-400)" }}>אין התראות.</p>}
              <a className="rail-link" onClick={() => nav("#/alerts")}>צפייה בכל ההתראות ←</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ ic, tone, label, num, sub, warn, link, onLink }: {
  ic: React.ReactNode; tone: string; label: string; num: React.ReactNode; sub: string; warn?: boolean; link: string; onLink: () => void;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-top">
        <div>
          <div className="lbl">{label}</div>
          <div className="num">{num}</div>
          <div className={`stat-sub ${warn ? "warn" : ""}`}>{sub}</div>
        </div>
        <span className={`badge-soft ${tone}`}><Icon d={ic} size={18} /></span>
      </div>
      <a className="stat-link" onClick={onLink}>צפייה ב{link} ←</a>
    </div>
  );
}

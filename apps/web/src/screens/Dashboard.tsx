import { useEffect, useState } from "react";
import { getDashboard, type Dashboard as D } from "../api.ts";
import { ICONS, Icon, initials } from "../ui.tsx";
import { NewProject, NewWorkItem } from "../forms.tsx";

const CONNECTOR_LABEL: Record<string, string> = { manual: "ידני", ado: "Azure DevOps", github: "GitHub", jira: "Jira", dcc: "DCC" };
const STATUS: Record<string, { label: string; tone: string }> = {
  planning: { label: "בתכנון", tone: "inactive" }, active: { label: "פעיל", tone: "healthy" },
  blocked: { label: "חסום", tone: "critical" }, done: { label: "הושלם", tone: "active" },
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
  const [modal, setModal] = useState<"project" | "work" | null>(null);
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
          <button className="btn btn-primary" onClick={() => setModal("project")}><Icon d={ICONS.plus} size={14} /> הוספת פרויקט</button>
        </div>
      </div>

      {modal === "project" && <NewProject onClose={() => setModal(null)} onDone={(id) => { setModal(null); if (id) nav(`#/project/${id}`); else reload(); }} />}
      {modal === "work" && <NewWorkItem onClose={() => setModal(null)} onDone={(id) => { setModal(null); if (id) nav(`#/wi/${id}`); else reload(); }} />}

      {err && <div className="empty">{err}</div>}
      {!d && !err && <div className="spin">טוען…</div>}

      {d && (
        <div className="dash">
          <div>
            {/* ---- stat tiles ---- */}
            <div className="stat-row">
              <Stat ic={ICONS.folder} tone="accent" label="פרויקטים פעילים" num={d.stats.activeProjects} sub={d.stats.projectsDelta ? `+${d.stats.projectsDelta} החודש` : "ללא שינוי"} link="כל הפרויקטים" onLink={() => nav("#/projects")} />
              <Stat ic={ICONS.list} tone="healthy" label="עבודות פתוחות" num={d.stats.openItems} sub={d.stats.itemsDelta ? `+${d.stats.itemsDelta} החודש` : "ללא שינוי"} link="כל העבודות" onLink={() => nav("#/work")} />
              <Stat ic={ICONS.triangle} tone="warning" warn label="עבודות חסומות" num={d.stats.blockedItems} sub="לטיפול מיידי" link="חסימות" onLink={() => nav("#/work?filter=blocked")} />
              <Stat ic={ICONS.slash} tone="ai" label="עלות AI החודש" num={money(d.stats.aiCostUsd)} sub={`${d.stats.aiBudgetPct}% מהתקציב`} warn={d.stats.aiBudgetPct >= 80} link="תקציבים" onLink={() => nav("#/budgets")} />
            </div>

            {/* ---- recent projects ---- */}
            <div className="section">
              <div className="section-head">
                <p className="section-lbl" style={{ margin: 0 }}>פרויקטים אחרונים</p>
                <a onClick={() => nav("#/projects")}>צפייה בכל הפרויקטים ←</a>
              </div>
              <div className="proj-grid">
                {d.projects.map((p) => {
                  const st = STATUS[p.status]!;
                  return (
                    <div className="pcard" key={p.id} onClick={() => nav(`#/project/${p.id}`)}>
                      <div className="pc-top">
                        <span className={`pill ${st.tone}`}><span className="dot" />{st.label}</span>
                        <button className="kebab" onClick={(e) => e.stopPropagation()}>⋮</button>
                      </div>
                      <div>
                        <div className="pc-name">{p.name}</div>
                        <div className="pc-client">לקוח: {p.clientName}</div>
                      </div>
                      <dl>
                        <div><dt>סוג אינטגרציה</dt><dd>{CONNECTOR_LABEL[p.connectorType]}</dd></div>
                        <div><dt>תקציב</dt><dd>{money(p.budgetUsd)}</dd></div>
                        <div><dt>עלות AI החודש</dt><dd>{money(p.aiCostUsd)}</dd></div>
                      </dl>
                      <div className="pc-foot">
                        <div className="avatar-stack">
                          {p.members.slice(0, 3).map((m) => <span key={m.id} className="a">{initials(m.name)}</span>)}
                          {p.members.length > 3 && <span className="a overflow">+{p.members.length - 3}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {d.projects.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>אין פרויקטים.</div>}
              </div>
            </div>

            {/* ---- recent work items ---- */}
            <div className="section">
              <div className="section-head">
                <p className="section-lbl" style={{ margin: 0 }}>עבודות אחרונות</p>
                <a onClick={() => nav("#/work")}>צפייה בכל העבודות ←</a>
              </div>
              <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
                <table className="wtable">
                  <thead><tr><th>עבודה</th><th>פרויקט</th><th>אחראי</th><th>עדיפות</th><th>תקציב AI</th><th>עודכן לאחרונה</th><th></th></tr></thead>
                  <tbody>
                    {d.recentWorkItems.map((w) => (
                      <tr key={w.id}>
                        <td><span className="w-title" onClick={() => nav(`#/wi/${w.id}`)}>{w.title}</span></td>
                        <td style={{ color: "var(--ink-500)" }}>{w.projectName}</td>
                        <td><span className="w-owner"><span className="a">{initials(w.ownerName)}</span>{w.ownerName}</span></td>
                        <td><span className={`prio ${w.priority}`}>{PRIO[w.priority] ?? w.priority}</span></td>
                        <td><span className={`trend ${w.trend}`}>{w.trend === "up" ? "↑" : w.trend === "down" ? "↓" : "—"} {TREND_LABEL[w.trend]}</span>{w.aiBudgetUsd ? <span style={{ color: "var(--ink-400)", marginInlineStart: 6 }}>${w.aiSpentUsd}/${w.aiBudgetUsd}</span> : null}</td>
                        <td style={{ color: "var(--ink-400)" }}>{ago(w.updatedAt)}</td>
                        <td><button className="kebab">⋮</button></td>
                      </tr>
                    ))}
                    {d.recentWorkItems.length === 0 && <tr><td colSpan={7}><div className="empty">אין עבודות.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ---- right rail ---- */}
          <div className="rail">
            <div className="panel">
              <h4>פעולות מהירות</h4>
              <div className="qa-row" onClick={() => setModal("project")}><span className="qa-ic"><Icon d={ICONS.plus} size={13} /></span>הוספת פרויקט חדש</div>
              <div className="qa-row" onClick={() => setModal("work")}><span className="qa-ic"><Icon d={ICONS.list} size={13} /></span>הוספת עבודה</div>
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

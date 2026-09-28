import { useEffect, useState } from "react";
import { getAllAdoTasks, approveTask, type AllAdoTasks, type AdoTaskRow } from "../api.ts";
import { PageHead, Pill, TaskStatusPill } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";

/**
 * The Azure DevOps screen: the org-wide mirror of what DCC has put (or
 * will put) into TFS. Requirements never reach TFS — these tasks are the
 * tracked work items, shown by client → requirement → hierarchy.
 */

const TYPE_TONE = (t: string | null) => (t && t !== "Task" ? "ai" : "inactive");

function TaskRows({ rows, clientId, nav, onChanged }: {
  rows: AdoTaskRow[]; clientId: string; nav: (h: string) => void; onChanged: () => void;
}) {
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const doApprove = async (id: string) => {
    setApprovingId(id);
    try { await approveTask(id, { clientId }); onChanged(); }
    finally { setApprovingId(null); }
  };
  return (
    <>
      {rows.map((t, i) => {
        const prev = rows[i - 1];
        const newReq = !prev || prev.requirementId !== t.requirementId;
        return (
          <tr key={t.id} style={{ opacity: t.active ? 1 : 0.55, ...(newReq && i > 0 ? { borderTop: "2px solid var(--border-hairline)" } : {}) }}>
            <td style={{ paddingInlineStart: 14 + t.level * 22 }}>
              {t.level > 0 && <span style={{ color: "var(--ink-300)" }}>↳ </span>}
              <span className="w-title" onClick={() => nav(`#/task/${t.id}`)} title={t.intent}>{t.intent.length > 100 ? `${t.intent.slice(0, 100)}…` : t.intent}</span>
              {!t.active && <span style={{ fontSize: 10.5, color: "var(--ink-400)", marginInlineStart: 6 }}>⚪ לא פעיל</span>}
              {t.checksCount > 0 && (
                <span title={`${t.checksCount} בדיקות — לא work items בפני עצמן, מתועדות ב-Discussion של המשימה הזו`} style={{ fontSize: 10.5, color: "var(--ink-400)", marginInlineStart: 6 }}>
                  +{t.checksCount} בדיקות{t.checksPosted < t.checksCount ? "" : " ✓"}
                </span>
              )}
            </td>
            <td><Pill tone={TYPE_TONE(t.adoType)}>{t.adoType ?? "Task"}</Pill></td>
            <td>
              {t.linkedAdoId
                ? <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer">#{t.linkedAdoId} ↗</a>
                : t.approved
                  ? <span style={{ color: "var(--ink-400)", fontSize: 11.5 }}>מאושר, ממתין להקמה</span>
                  : <button className="btn btn-primary btn-sm" disabled={approvingId === t.id} onClick={() => doApprove(t.id)}>
                      {approvingId === t.id ? "מאשר…" : "✓ אישור הקמת משימה ב-TFS"}
                    </button>}
            </td>
            <td style={{ fontSize: 11.5 }}>{t.status ? <TaskStatusPill status={t.status} /> : t.state.replace(/_/g, " ")}</td>
            <td style={{ fontSize: 11.5 }}>{t.appetite}</td>
            <td>
              <button className="btn btn-secondary btn-sm" onClick={() => nav(`#/wi/${t.requirementId}`)} title={t.requirementTitle}>
                ⬅ {t.requirementKey ?? (t.requirementTitle.length > 24 ? `${t.requirementTitle.slice(0, 24)}…` : t.requirementTitle)}
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function AdoTasks({ nav }: { nav: (h: string) => void }) {
  const [d, setD] = useState<AllAdoTasks | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyTfs, setOnlyTfs] = useState(false);
  const load = () => { getAllAdoTasks().then(setD).catch((e) => setErr(String(e))); };

  useEffect(() => { load(); }, []);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;

  const clients = d.clients
    .map((c) => ({ ...c, rows: onlyTfs ? c.rows.filter((r) => r.linkedAdoId) : c.rows }))
    .filter((c) => c.rows.length > 0);

  return (
    <>
      <PageHead info="page_ado_tasks"
        title="Azure DevOps"
        sub={`${d.inTfs} פריטים ב-TFS${d.pending ? ` · ${d.pending} טרם הוקמו` : ""} · ${d.clients.length} לקוחות`}
        actions={
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" style={{ minWidth: 0 }} checked={onlyTfs} onChange={(e) => setOnlyTfs(e.target.checked)} />
            רק מה שכבר ב-TFS
          </label>
        }
      />

      <div className="callout" style={{ marginBottom: 18 }}>
        <div className="body">
          <p className="r">
            הדרישות נשארות ב-DCC ולא מגיעות ל-TFS. מה שמופיע כאן הן <b>המשימות</b> שיצאו מהן — הן פריטי העבודה של הצוות.
          </p>
          <p className="meta">
            הסוג ב-TFS נקבע לפי התפקיד של המשימה: עלה הוא Task, משימה שמתחתיה משימות היא User Story, ומעליה Feature.
          </p>
        </div>
      </div>

      {clients.map((c) => (
        <div key={c.clientId} style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p className="section-lbl">
              <span className="w-title" onClick={() => nav(`#/client/${c.clientId}`)}>{c.clientName}</span>
            </p>
            <span style={{ fontSize: 11.5, color: "var(--ink-400)" }}>
              {c.inTfs} ב-TFS{c.pending ? ` · ${c.pending} טרם הוקמו` : ""}
            </span>
          </div>
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <table className="wtable">
              {/* no-info: the first column is the thing the row is about */}
              <thead><tr><th>משימה</th><th>סוג<Info k="requirement_type" /></th><th>TFS<Info k="tfs" /></th><th>מצב<Info k="task_state" /></th><th>גודל<Info k="task_size" /></th><th>מתוך דרישה</th></tr></thead>
              <tbody><TaskRows rows={c.rows} clientId={c.clientId} nav={nav} onChanged={load} /></tbody>
            </table>
          </div>
        </div>
      ))}

      {clients.length === 0 && (
        <div className="empty">
          {onlyTfs ? "עוד לא הוקמו משימות ב-TFS." : 'אין משימות. פרק דרישה למשימות בטאב "מהלך עבודה" שלה.'}
        </div>
      )}
    </>
  );
}

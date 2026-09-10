import { useEffect, useState } from "react";
import { getAllAdoTasks, ADO_LADDER, type AllAdoTasks, type AdoTaskRow } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";

/**
 * The Azure DevOps screen: the org-wide mirror of what DCC has put (or
 * will put) into TFS. Requirements never reach TFS — these tasks are the
 * tracked work items, shown by client → requirement → hierarchy.
 */

const TYPE_TONE = (t: string | null) => (t && t !== "Task" ? "ai" : "inactive");

function TaskRows({ rows, nav }: { rows: AdoTaskRow[]; nav: (h: string) => void }) {
  return (
    <>
      {rows.map((t, i) => {
        const prev = rows[i - 1];
        const newReq = !prev || prev.requirementId !== t.requirementId;
        return (
          <tr key={t.id} style={newReq && i > 0 ? { borderTop: "2px solid var(--border-hairline)" } : undefined}>
            <td style={{ paddingInlineStart: 14 + t.level * 22 }}>
              {t.level > 0 && <span style={{ color: "var(--ink-300)" }}>↳ </span>}
              <span className="w-title" onClick={() => nav(`#/task/${t.id}`)} title={t.intent}>{t.intent.length > 100 ? `${t.intent.slice(0, 100)}…` : t.intent}</span>
            </td>
            <td><Pill tone={TYPE_TONE(t.adoType)}>{t.adoType ?? "Task"}</Pill></td>
            <td>
              {t.linkedAdoId
                ? <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer">#{t.linkedAdoId} ↗</a>
                : <span style={{ color: "var(--ink-400)", fontSize: 11.5 }}>{t.approved ? "מאושר, טרם הוקם" : "ממתין לאישור"}</span>}
            </td>
            <td style={{ fontSize: 11.5 }}>{t.state.replace(/_/g, " ")}</td>
            <td style={{ fontSize: 11.5 }}>{t.appetite}</td>
            <td>
              <span className="w-title" onClick={() => nav(`#/wi/${t.requirementId}`)} title={t.requirementTitle}>
                {t.requirementKey ?? (t.requirementTitle.length > 30 ? `${t.requirementTitle.slice(0, 30)}…` : t.requirementTitle)}
              </span>
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

  useEffect(() => { getAllAdoTasks().then(setD).catch((e) => setErr(String(e))); }, []);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;

  const clients = d.clients
    .map((c) => ({ ...c, rows: onlyTfs ? c.rows.filter((r) => r.linkedAdoId) : c.rows }))
    .filter((c) => c.rows.length > 0);

  return (
    <>
      <PageHead
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
          <p className="meta" style={{ direction: "ltr", textAlign: "left", fontFamily: "var(--mono)" }}>
            {ADO_LADDER.join(" › ")} — עומק הפירוק קובע מאיזו דרגה מתחילים
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
              <thead><tr><th>משימה</th><th>סוג</th><th>TFS</th><th>מצב</th><th>גודל</th><th>מתוך דרישה</th></tr></thead>
              <tbody><TaskRows rows={c.rows} nav={nav} /></tbody>
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

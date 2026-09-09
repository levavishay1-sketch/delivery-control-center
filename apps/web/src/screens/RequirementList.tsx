import { useEffect, useState } from "react";
import { deleteRequirement, getInitiatives, REQ_TYPE_HE, type Initiative } from "../api.ts";
import { PageHead } from "../ui.tsx";
import { NewRequirement } from "../forms.tsx";

const PH: Record<string, { label: string; tone: string }> = {
  intake: { label: "קליטה", tone: "inactive" }, shaping: { label: "עיצוב", tone: "healthy" },
  building: { label: "בבנייה", tone: "healthy" }, review: { label: "בבדיקה", tone: "healthy" },
  done: { label: "הושלם", tone: "active" }, archived: { label: "אורכב", tone: "inactive" },
};
const money = (n: number | null) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);

export function RequirementList({ nav }: { nav: (h: string) => void }) {
  const [rows, setRows] = useState<Initiative[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const reload = () => getInitiatives().then((r) => setRows(r.initiatives)).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); }, []);

  return (
    <>
      <PageHead
        title="דרישות"
        sub={rows ? `${rows.length} דרישות-על` : undefined}
        actions={<button className="btn btn-primary" onClick={() => setModal(true)}>+ דרישה חדשה</button>}
      />
      {modal && <NewRequirement onClose={() => setModal(false)} onDone={(id) => { setModal(false); if (id) nav(`#/wi/${id}`); else reload(); }} />}
      {err && <div className="empty">{err}</div>}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table className="wtable">
          <thead><tr><th>דרישה</th><th>לקוח</th><th>סוג</th><th>שלב</th><th>תקציב</th><th>תת-דרישות</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((p) => {
              const ph = PH[p.phase] ?? { label: p.phase, tone: "inactive" };
              return (
                <tr key={p.id}>
                  <td><span className="w-title" onClick={() => nav(`#/wi/${p.id}`)}>{p.name}</span></td>
                  <td style={{ color: "var(--ink-500)" }}>
                    <span onClick={() => nav(`#/client/${p.clientId}`)} style={{ cursor: "pointer" }}>{p.clientName}</span>
                  </td>
                  <td>{REQ_TYPE_HE[p.type] ?? p.type}</td>
                  <td><span className={`pill ${ph.tone}`}><span className="dot" />{ph.label}</span></td>
                  <td>{money(p.budgetUsd)}</td>
                  <td>{p.items ?? 0}</td>
                  <td style={{ textAlign: "end" }}>
                    <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={async () => {
                      if (!confirm(`למחוק את "${p.name}"?`)) return;
                      try { await deleteRequirement(p.id); reload(); } catch (e) { alert(String(e)); }
                    }}>מחק</a>
                  </td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && <tr><td colSpan={7}><div className="empty">אין דרישות. לחץ "+ דרישה חדשה".</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { getProjectList } from "../api.ts";
import { PageHead } from "../ui.tsx";
import { NewProject } from "../forms.tsx";

const CONN: Record<string, string> = { manual: "ידני", ado: "Azure DevOps", github: "GitHub", jira: "Jira", dcc: "DCC" };
const ST: Record<string, { label: string; tone: string }> = {
  planning: { label: "בתכנון", tone: "inactive" }, active: { label: "פעיל", tone: "healthy" },
  blocked: { label: "חסום", tone: "critical" }, done: { label: "הושלם", tone: "active" },
};
const money = (n: string | null) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);

export function ProjectList({ nav }: { nav: (h: string) => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getProjectList>>["projects"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const reload = () => getProjectList().then((r) => setRows(r.projects)).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); }, []);

  return (
    <>
      <PageHead title="פרויקטים" sub={rows ? `${rows.length} פרויקטים` : undefined} actions={<button className="btn btn-primary" onClick={() => setModal(true)}>+ הוספת פרויקט</button>} />
      {modal && <NewProject onClose={() => setModal(false)} onDone={(id) => { setModal(false); if (id) nav(`#/project/${id}`); else reload(); }} />}
      {err && <div className="empty">{err}</div>}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table className="wtable">
          <thead><tr><th>פרויקט</th><th>לקוח</th><th>סטטוס</th><th>אינטגרציה</th><th>תקציב</th><th>עבודות</th></tr></thead>
          <tbody>
            {(rows ?? []).map((p) => {
              const st = ST[p.status]!;
              return (
                <tr key={p.id}>
                  <td><span className="w-title" onClick={() => nav(`#/project/${p.id}`)}>{p.name}</span></td>
                  <td style={{ color: "var(--ink-500)" }}>{p.clientName}</td>
                  <td><span className={`pill ${st.tone}`}><span className="dot" />{st.label}</span></td>
                  <td>{CONN[p.connectorType] ?? p.connectorType}</td>
                  <td>{money(p.budgetUsd)}</td>
                  <td>{p.items}</td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && <tr><td colSpan={6}><div className="empty">אין פרויקטים.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

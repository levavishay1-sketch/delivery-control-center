import { useEffect, useState } from "react";
import { checkConnection, deleteConnection, getClient, type ClientDetail as CD } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { AddRequirement, ConnectAdo, LinkRepo, NewProject } from "../forms.tsx";

const CONN: Record<string, string> = { manual: "ידני", ado: "Azure DevOps", github: "GitHub", jira: "Jira", dcc: "DCC" };
const ST: Record<string, { label: string; tone: string }> = {
  planning: { label: "בתכנון", tone: "inactive" }, active: { label: "פעיל", tone: "healthy" },
  blocked: { label: "חסום", tone: "critical" }, done: { label: "הושלם", tone: "active" },
};

export function ClientDetail({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<CD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"req" | "repo" | "ado" | "project" | null>(null);
  const reload = () => getClient(id).then(setD).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); }, [id]);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav("#/clients")}>← לקוחות</a>}
        title={d.client.name}
        sub={`${d.projects.length} פרויקטים · ${d.repos.length} repositories · ${d.connections.filter((c) => !c.revokedAt).length} חיבורים`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setModal("project")}>+ פרויקט</button>
            <button className="btn btn-primary" onClick={() => setModal("req")} disabled={d.projects.length === 0}>+ הוסף דרישה</button>
          </>
        }
      />

      {modal === "req" && <AddRequirement clientId={id} projects={d.projects} onClose={() => setModal(null)} onDone={(wi) => { setModal(null); if (wi) nav(`#/wi/${wi}`); else reload(); }} />}
      {modal === "repo" && <LinkRepo clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "ado" && <ConnectAdo clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "project" && <NewProject fixedClientName={d.client.name} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}

      {/* ---- projects ---- */}
      <p className="section-lbl">פרויקטים</p>
      <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 26 }}>
        <table className="wtable">
          <thead><tr><th>פרויקט</th><th>סטטוס</th><th>אינטגרציה</th><th>עבודות</th></tr></thead>
          <tbody>
            {d.projects.map((p) => {
              const st = ST[p.status]!;
              return (
                <tr key={p.id}>
                  <td><span className="w-title" onClick={() => nav(`#/project/${p.id}`)}>{p.name}</span></td>
                  <td><span className={`pill ${st.tone}`}><span className="dot" />{st.label}</span></td>
                  <td>{CONN[p.connectorType] ?? p.connectorType}</td>
                  <td>{p.items}</td>
                </tr>
              );
            })}
            {d.projects.length === 0 && <tr><td colSpan={4}><div className="empty">אין פרויקטים. לחץ "+ פרויקט".</div></td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---- connections ---- */}
      <div className="settings-grid">
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p className="card-title" style={{ margin: 0 }}>Repositories</p>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal("repo")}>+ חיבור repository</button>
          </div>
          {d.repos.map((r) => (
            <div className="stat-line" key={r.id}>
              <span className="l">{r.name}</span>
              <span style={{ fontSize: 11, color: "var(--ink-400)", direction: "ltr" }}>{r.adoRepoRef ?? "—"}</span>
            </div>
          ))}
          {d.repos.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>לא מחובר repository.</p>}
        </div>

        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p className="card-title" style={{ margin: 0 }}>Azure DevOps</p>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal("ado")}>+ חיבור</button>
          </div>
          {d.connections.filter((c) => c.kind === "ado" && !c.revokedAt).map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, borderTop: "1px solid var(--border-hairline)", paddingTop: 10, marginTop: 10 }}>
              <div style={{ fontWeight: 600 }}>{c.displayName}</div>
              <div style={{ color: "var(--ink-400)", direction: "ltr", fontSize: 11 }}>{c.config.orgUrl}{c.config.project ? ` · ${c.config.project}` : " · (רמת collection)"}</div>
              {c.lastCheckOk && <div style={{ marginTop: 4 }}><Pill tone={c.lastCheckOk.startsWith("FAILED") ? "critical" : "healthy"}>{c.lastCheckOk.startsWith("FAILED") ? "חיבור נכשל" : "מחובר"}</Pill> <span style={{ color: "var(--ink-400)", fontSize: 11 }}>{c.lastCheckOk.replace("FAILED — ", "")}</span></div>}
              <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                <a style={{ fontSize: 11, cursor: "pointer" }} onClick={() => checkConnection(id, c.id).then(reload)}>בדוק שוב</a>
                <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={() => { if (confirm(`להסיר את החיבור "${c.displayName}"?`)) deleteConnection(id, c.id).then(reload); }}>הסר</a>
              </div>
            </div>
          ))}
          {d.connections.filter((c) => c.kind === "ado" && !c.revokedAt).length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>לא מחובר ל-Azure DevOps.</p>}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { checkConnection, deleteConnection, getClient, REQ_TYPE_HE, type ClientDetail as CD, type Requirement } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { ConnectAdo, LinkRepo, NewRequirement } from "../forms.tsx";

const PH: Record<string, { label: string; tone: string }> = {
  intake: { label: "קליטה", tone: "inactive" }, shaping: { label: "עיצוב", tone: "healthy" },
  building: { label: "בבנייה", tone: "healthy" }, review: { label: "בבדיקה", tone: "healthy" },
  done: { label: "הושלם", tone: "active" }, archived: { label: "אורכב", tone: "inactive" },
};
const CONN: Record<string, string> = { manual: "ידני", ado: "Azure DevOps", github: "GitHub", jira: "Jira", dcc: "DCC" };

/** flatten the forest into rows with a depth, parents before children */
function ordered(reqs: Requirement[]): { r: Requirement; depth: number }[] {
  const byParent = new Map<string | null, Requirement[]>();
  for (const r of reqs) {
    const k = r.parentId && reqs.some((x) => x.id === r.parentId) ? r.parentId : null;
    byParent.set(k, [...(byParent.get(k) ?? []), r]);
  }
  const out: { r: Requirement; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) { out.push({ r, depth }); walk(r.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

export function ClientDetail({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<CD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"req" | "repo" | "ado" | null>(null);
  const reload = () => getClient(id).then(setD).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); }, [id]);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;

  const rows = ordered(d.requirements);
  const activeConns = d.connections.filter((c) => c.kind === "ado" && !c.revokedAt);

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav("#/clients")}>← לקוחות</a>}
        title={d.client.name}
        sub={`${d.requirements.length} דרישות · ${d.repos.length} repositories · ${activeConns.length} חיבורים${d.client.adoProjectRef ? ` · ADO: ${d.client.adoProjectRef}` : ""}`}
        actions={<button className="btn btn-primary" onClick={() => setModal("req")}>+ הוסף דרישה</button>}
      />

      {modal === "req" && <NewRequirement fixedClientId={id} onClose={() => setModal(null)} onDone={(wi) => { setModal(null); if (wi) nav(`#/wi/${wi}`); else reload(); }} />}
      {modal === "repo" && <LinkRepo clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "ado" && <ConnectAdo clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}

      {/* ---- requirements ---- */}
      <p className="section-lbl">דרישות</p>
      <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 26 }}>
        <table className="wtable">
          <thead><tr><th>דרישה</th><th>סוג</th><th>שלב</th><th>עדיפות</th><th>חסמים</th></tr></thead>
          <tbody>
            {rows.map(({ r, depth }) => {
              const ph = PH[r.phase] ?? { label: r.phase, tone: "inactive" };
              return (
                <tr key={r.id}>
                  <td style={{ paddingInlineStart: 14 + depth * 22 }}>
                    {depth > 0 && <span style={{ color: "var(--ink-300)" }}>↳ </span>}
                    <span className="w-title" onClick={() => nav(`#/wi/${r.id}`)}>{r.title}</span>
                  </td>
                  <td>{REQ_TYPE_HE[r.type] ?? r.type}</td>
                  <td><span className={`pill ${ph.tone}`}><span className="dot" />{ph.label}</span></td>
                  <td>{r.priority}</td>
                  <td>{r.openBlockers > 0 ? <Pill tone="critical">{r.openBlockers}</Pill> : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5}><div className="empty">אין דרישות. לחץ "+ הוסף דרישה".</div></td></tr>}
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
          {activeConns.map((c) => (
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
          {activeConns.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>לא מחובר ל-Azure DevOps.</p>}
          {CONN[d.client.connectorType] && d.client.connectorType !== "manual" && (
            <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 8 }}>סוג סנכרון: {CONN[d.client.connectorType]}</p>
          )}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { checkConnection, deleteClient, deleteConnection, deleteRepo, getClient, getClientAdoTasks, unlinkClientRepo, approveTask, REQ_TYPE_HE, type AdoTasks, type ClientDetail as CD, type Requirement } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { errText } from "./onboarding/labels.ts";
import { ConnectAdo, EditClient, EditRepo, ImportCsv, LinkRepo, NewRequirement } from "../forms.tsx";

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
  const [modal, setModal] = useState<"req" | "repo" | "ado" | "editClient" | "import" | null>(null);
  const [editRepo, setEditRepo] = useState<{ id: string; name: string; adoRepoRef: string | null } | null>(null);
  const [ado, setAdo] = useState<AdoTasks | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const reload = () => {
    getClient(id).then(setD).catch((e) => setErr(String(e)));
    getClientAdoTasks(id).then(setAdo).catch(() => {});
  };
  const doApprove = async (taskId: string) => {
    setApprovingId(taskId);
    try { await approveTask(taskId, { clientId: id }); reload(); }
    finally { setApprovingId(null); }
  };
  useEffect(() => { reload(); }, [id]);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;

  const rows = ordered(d.requirements);
  const activeConns = d.connections.filter((c) => c.kind === "ado" && !c.revokedAt);

  // Requirements are DCC-only and never pushed to TFS — the TFS side is
  // the task tree, materialised per requirement from its flow tab.
  const onDeleteClient = async () => {
    if (!confirm(`למחוק את הלקוח "${d.client.name}"?\n\nיימחקו גם ה-repositories שלו ב-DCC, החיבורים והתקציב. repository שגם לקוח אחר משתמש בו יישאר, כמשותף. הקבצים במחשב וב-GitHub לא נמחקים.\n\nאי אפשר לבטל.`)) return;
    try { await deleteClient(id); nav("#/clients"); }
    catch (e) { alert(errText(e)); }
  };

  return (
    <>
      <PageHead info="page_client"
        crumb={<a onClick={() => nav("#/clients")}>← לקוחות</a>}
        title={d.client.name}
        sub={`${d.requirements.length} דרישות · ${d.repos.length} repositories · ${activeConns.length} חיבורים${d.client.adoProjectRef ? ` · ADO: ${d.client.adoProjectRef}` : ""}`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setModal("import")}>ייבוא מ-ADO</button>
            <button className="btn btn-secondary" onClick={() => setModal("editClient")}>עריכה</button>
            <button className="btn btn-secondary" style={{ color: "var(--status-critical)" }} onClick={onDeleteClient}>מחיקה</button><Info k="client_delete" />
            <button className="btn btn-primary" onClick={() => setModal("req")}>+ הוסף דרישה</button>
          </>
        }
      />

      {modal === "req" && <NewRequirement fixedClientId={id} onClose={() => setModal(null)} onDone={(wi) => { setModal(null); if (wi) nav(`#/wi/${wi}`); else reload(); }} />}
      {modal === "repo" && <LinkRepo clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "ado" && <ConnectAdo clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "editClient" && <EditClient client={d.client} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "import" && <ImportCsv clientId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {editRepo && <EditRepo repo={editRepo} onClose={() => setEditRepo(null)} onDone={() => { setEditRepo(null); reload(); }} />}

      {/* ---- requirements ---- */}
      <p className="section-lbl">דרישות<Info k="client_requirements" /></p>
      <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 26 }}>
        <table className="wtable">
          {/* no-info: the first column is the thing the row is about */}<thead><tr><th>דרישה</th><th>סוג</th><th>שלב<Info k="phase" /></th><th>עדיפות<Info k="priority" /></th><th>חסמים<Info k="blocker" /></th></tr></thead>
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

      {/* ---- Azure DevOps: the client's task hierarchy ---- */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p className="section-lbl">Azure DevOps<Info k="ado_sync_state" /></p>
        {ado && (
          <span style={{ fontSize: 11.5, color: "var(--ink-400)" }}>
            {ado.inTfs} ב-TFS{ado.pending ? ` · ${ado.pending} טרם הוקמו` : ""}
          </span>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: -6, marginBottom: 10 }}>
        המשימות שיצאו מהדרישות, לפי ההיררכיה. הדרישות עצמן נשארות ב-DCC — רק אלה מגיעות ל-TFS.
      </p>
      <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 26 }}>
        <table className="wtable">
          {/* no-info: the first column is the thing the row is about */}<thead><tr><th>משימה</th><th>סוג</th><th>TFS</th><th>מצב</th><th>מתוך דרישה</th></tr></thead>
          <tbody>
            {(ado?.rows ?? []).map((t, i) => {
              const prev = ado!.rows[i - 1];
              const newReq = !prev || prev.requirementId !== t.requirementId;
              return (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.55, ...(newReq && i > 0 ? { borderTop: "2px solid var(--border-hairline)" } : {}) }}>
                  <td style={{ paddingInlineStart: 14 + t.level * 22 }}>
                    {t.level > 0 && <span style={{ color: "var(--ink-300)" }}>↳ </span>}
                    {!t.active && <span style={{ fontSize: 10.5, color: "var(--ink-400)", marginInlineStart: 6 }}>⚪ לא פעיל</span>}
                    <span className="w-title" onClick={() => nav(`#/task/${t.id}`)} title={t.intent}>{t.intent.length > 90 ? `${t.intent.slice(0, 90)}…` : t.intent}</span>
                    {t.checksCount > 0 && (
                      <span title={`${t.checksCount} בדיקות — לא work items בפני עצמן, מתועדות ב-Discussion של המשימה הזו`} style={{ fontSize: 10.5, color: "var(--ink-400)", marginInlineStart: 6 }}>
                        +{t.checksCount} בדיקות{t.checksPosted < t.checksCount ? "" : " ✓"}
                      </span>
                    )}
                  </td>
                  <td><Pill tone={t.adoType && t.adoType !== "Task" ? "ai" : "inactive"}>{t.adoType ?? "Task"}</Pill></td>
                  <td>
                    {t.linkedAdoId
                      ? <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer">#{t.linkedAdoId} ↗</a>
                      : t.approved
                        ? <span style={{ color: "var(--ink-400)", fontSize: 11.5 }}>מאושר, ממתין להקמה</span>
                        : <button className="btn btn-primary btn-sm" disabled={approvingId === t.id} onClick={() => doApprove(t.id)}>
                            {approvingId === t.id ? "מאשר…" : "✓ אישור הקמת משימה ב-TFS"}
                          </button>}
                  </td>
                  <td style={{ fontSize: 11.5 }}>{t.state.replace(/_/g, " ")}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => nav(`#/wi/${t.requirementId}`)} title={t.requirementTitle}>
                      ⬅ {t.requirementKey ?? (t.requirementTitle.length > 24 ? `${t.requirementTitle.slice(0, 24)}…` : t.requirementTitle)}
                    </button>
                  </td>
                </tr>
              );
            })}
            {ado && ado.rows.length === 0 && (
              <tr><td colSpan={5}><div className="empty">אין משימות. פרק דרישה למשימות בטאב "מהלך עבודה" שלה.</div></td></tr>
            )}
            {!ado && <tr><td colSpan={5}><div className="empty">טוען…</div></td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---- connections ---- */}
      <div className="settings-grid">
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p className="card-title" style={{ margin: 0 }}>Repositories<Info k="repository" /></p>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal("repo")}>+ חיבור repository</button>
          </div>
          {d.repos.map((r) => (
            <div className="stat-line" key={r.id} style={{ alignItems: "flex-start" }}>
              <span className="l">{r.name}
                <span style={{ display: "block", fontSize: 11, color: "var(--ink-400)", direction: "ltr" }}>{r.adoRepoRef ?? "—"}</span>
              </span>
              <span style={{ display: "flex", gap: 10 }}>
                <a style={{ fontSize: 11, cursor: "pointer", color: "var(--color-accent)", fontWeight: 600 }} onClick={() => nav(`#/repo/${r.id}`)}>✦ הטמעת AI</a>
                <a style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setEditRepo(r)}>ערוך</a>
                <a style={{ fontSize: 11, cursor: "pointer" }} onClick={async () => { if (confirm(`לנתק את ${r.name} מהלקוח? (ה-repository עצמו יישאר)`)) { await unlinkClientRepo(id, r.id); reload(); } }}>נתק</a>
                <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)" }} onClick={async () => { if (confirm(`למחוק לגמרי את ${r.name}? יימחק מכל הלקוחות והדרישות.`)) { await deleteRepo(r.id); reload(); } }}>מחק</a>
              </span>
            </div>
          ))}
          {d.repos.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>לא מחובר repository.</p>}
        </div>

        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p className="card-title" style={{ margin: 0 }}>Azure DevOps<Info k="ado_connection" /></p>
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

import { useEffect, useState } from "react";
import { getConnections, getRepos } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { ConnectAdo, LinkRepo } from "../forms.tsx";

export function Settings({ nav }: { nav: (h: string) => void }) {
  const [conns, setConns] = useState<Awaited<ReturnType<typeof getConnections>>["connections"] | null>(null);
  const [repos, setRepos] = useState<Awaited<ReturnType<typeof getRepos>>["repos"] | null>(null);
  const [modal, setModal] = useState<"ado" | "repo" | null>(null);
  const reload = () => {
    getConnections().then((r) => setConns(r.connections)).catch(() => {});
    getRepos().then((r) => setRepos(r.repos)).catch(() => {});
  };
  useEffect(() => { reload(); }, []);

  return (
    <>
      <PageHead title="הגדרות" sub="חיבורים, repositories ו-model policy — לכל המערכת." />
      {modal === "ado" && <ConnectAdo onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === "repo" && <LinkRepo onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}

      <div className="settings-grid">
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p className="card-title" style={{ margin: 0 }}>חיבורי Azure DevOps</p>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal("ado")}>+ חיבור</button>
          </div>
          {(conns ?? []).filter((c) => c.kind === "ado").map((c) => (
            <div className="stat-line" key={c.id} style={{ alignItems: "flex-start" }}>
              <span className="l">
                <span onClick={() => nav(`#/client/${c.clientId}`)} style={{ color: "var(--color-accent)", cursor: "pointer" }}>{c.clientName}</span>
                <span style={{ display: "block", direction: "ltr", fontSize: 11, color: "var(--ink-400)" }}>{c.config.orgUrl} · {c.config.project}</span>
              </span>
              {c.lastCheckOk && <Pill tone={c.lastCheckOk.startsWith("FAILED") ? "critical" : "healthy"}>{c.lastCheckOk.startsWith("FAILED") ? "נכשל" : "מחובר"}</Pill>}
            </div>
          ))}
          {conns && conns.filter((c) => c.kind === "ado").length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>אין חיבורים.</p>}
        </div>

        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p className="card-title" style={{ margin: 0 }}>Repositories</p>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal("repo")}>+ חיבור</button>
          </div>
          {(repos ?? []).map((r) => (
            <div className="stat-line" key={r.id}>
              <span className="l">{r.name}{r.clientName ? <span style={{ color: "var(--ink-400)" }}> · {r.clientName}</span> : <span style={{ color: "var(--ink-400)" }}> · רוחבי</span>}</span>
              <span style={{ fontSize: 11, color: "var(--ink-400)" }}>{r.linkedClients} לקוחות</span>
            </div>
          ))}
          {repos && repos.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>אין repositories.</p>}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <p className="card-title">Model policy</p>
        <p className="card-sub">שכבת ה-global — מתוך config/model-policy.json</p>
        <div className="stat-line"><span className="l">זיהוי Gaps</span><span>sonnet → opus כשהעמימות גבוהה</span></div>
        <div className="stat-line"><span className="l">פירוק משימות</span><span>sonnet → opus כש-cross-repo</span></div>
        <div className="stat-line"><span className="l">ביצוע</span><span>sonnet · haiku אם מכני</span></div>
      </div>
    </>
  );
}

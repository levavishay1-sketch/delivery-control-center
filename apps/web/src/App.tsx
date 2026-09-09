import { useEffect, useState } from "react";
import "./theme.css";
import { Icon, ICONS, initials } from "./ui.tsx";
import { getDashboard } from "./api.ts";
import { Dashboard } from "./screens/Dashboard.tsx";
import { AttentionCenter } from "./screens/AttentionCenter.tsx";
import { AuditTrail } from "./screens/AuditTrail.tsx";
import { Record } from "./screens/Record.tsx";
import { Project } from "./screens/Project.tsx";

const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";

function useHash() {
  const [hash, setHash] = useState(() => location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

const NAV: { to: string; label: string; icon: React.ReactNode; badge?: boolean }[] = [
  { to: "#/", label: "Dashboard", icon: ICONS.dashboard },
  { to: "#/attention", label: "Attention Center", icon: ICONS.bell, badge: true },
  { to: "#/audit", label: "Audit Trail", icon: ICONS.list },
  { to: "#/settings", label: "Configuration", icon: ICONS.gear },
];

export function App() {
  const hash = useHash();
  const nav = (h: string) => { location.hash = h; };
  const [attn, setAttn] = useState(0);

  useEffect(() => {
    getDashboard().then((d) => setAttn(d.stats.decisions + d.stats.blockers + d.stats.risks)).catch(() => {});
  }, [hash]);

  const path = hash.replace(/^#/, "");
  let screen: React.ReactNode;
  if (path.startsWith("/wi/")) screen = <Record id={path.slice(4)} nav={nav} />;
  else if (path.startsWith("/project/")) screen = <Project id={path.slice(9)} nav={nav} />;
  else if (path === "/attention") screen = <AttentionCenter nav={nav} />;
  else if (path === "/audit") screen = <AuditTrail nav={nav} />;
  else if (path === "/settings") screen = <Settings />;
  else screen = <Dashboard nav={nav} />;

  const active = (to: string) => (to === "#/" ? path === "/" || path.startsWith("/project") || path.startsWith("/wi") : hash === to);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">DC</div>
          <div className="brand-word">Delivery Control<span>Center</span></div>
        </div>
        <div className="nav">
          {NAV.map((n) => (
            <button key={n.to} className="nav-item" aria-current={active(n.to) ? "page" : undefined} onClick={() => nav(n.to)}>
              <Icon d={n.icon} />
              {n.label}
              {n.badge && attn > 0 && <span className="nav-count">{attn}</span>}
            </button>
          ))}
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-foot">
          <div className="avatar-chip">{initials(DEV_EMAIL)}</div>
          <div className="who">
            <p>{DEV_EMAIL.split("@")[0]}</p>
            <span>{DEV_EMAIL}</span>
          </div>
        </div>
      </nav>
      <div className="canvas">
        <div className="workspace">{screen}</div>
      </div>
    </div>
  );
}

function Settings() {
  return (
    <>
      <p className="crumb">Configuration</p>
      <h1 style={{ fontSize: 25, fontWeight: 650 }}>Configuration</h1>
      <p style={{ color: "var(--ink-500)", marginTop: 5 }}>Connector setup, repository links and model policy live here. Wiring in progress.</p>
      <div className="settings-grid" style={{ marginTop: 26 }}>
        <div className="panel">
          <p className="card-title">Connector</p>
          <p className="card-sub">How work items in a project stay in sync.</p>
          <div className="type-toggle" role="radiogroup">
            <button role="radio" aria-pressed="false">Manual</button>
            <button role="radio" aria-pressed="true">Azure DevOps</button>
            <button role="radio" aria-pressed="false">Jira</button>
            <button role="radio" aria-pressed="false">GitHub</button>
          </div>
          <div className="form-grid">
            <div className="field"><label>Organisation URL</label><input defaultValue="https://dev.azure.com/…" /></div>
            <div className="field"><label>Project</label><input defaultValue="Trading Platform" /></div>
          </div>
          <button className="btn btn-primary">Save connector</button>
        </div>
        <div className="panel">
          <p className="card-title">Model policy</p>
          <p className="card-sub">Global layer — from config/model-policy.json</p>
          <div className="stat-line"><span className="l">gap detection</span><span>sonnet → opus on high ambiguity</span></div>
          <div className="stat-line"><span className="l">decomposition</span><span>sonnet → opus cross-repo</span></div>
          <div className="stat-line"><span className="l">execution</span><span>sonnet · haiku if mechanical</span></div>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import "./theme.css";
import { Icon, ICONS, initials } from "./ui.tsx";
import { getDashboard } from "./api.ts";
import { Dashboard } from "./screens/Dashboard.tsx";
import { AuditTrail } from "./screens/AuditTrail.tsx";
import { Record } from "./screens/Record.tsx";
import { Project } from "./screens/Project.tsx";
import { WorkList } from "./screens/WorkList.tsx";
import { ProjectList } from "./screens/ProjectList.tsx";
import { Alerts } from "./screens/Alerts.tsx";
import { Budgets } from "./screens/Budgets.tsx";
import { Stub } from "./screens/Stub.tsx";

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
  { to: "#/", label: "לוח בקרה", icon: ICONS.dashboard },
  { to: "#/projects", label: "פרויקטים", icon: ICONS.folder },
  { to: "#/work", label: "עבודות", icon: ICONS.list },
  { to: "#/alerts", label: "התראות", icon: ICONS.bell, badge: true },
  { to: "#/budgets", label: "תקציבים", icon: ICONS.slash },
  { to: "#/settings", label: "הגדרות", icon: ICONS.gear },
  { to: "#/users", label: "משתמשים", icon: ICONS.branch },
  { to: "#/audit", label: "יומן פעילויות", icon: ICONS.inbox },
];

export function App() {
  const hash = useHash();
  const nav = (h: string) => { location.hash = h; };
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => { getDashboard().then((d) => setAlertCount(d.alerts.length)).catch(() => {}); }, [hash]);

  const path = hash.replace(/^#/, "").split("?")[0]!;
  let screen: React.ReactNode;
  if (path.startsWith("/wi/")) screen = <Record id={path.slice(4)} nav={nav} />;
  else if (path.startsWith("/project/")) screen = <Project id={path.slice(9)} nav={nav} />;
  else if (path === "/projects") screen = <ProjectList nav={nav} />;
  else if (path === "/work") screen = <WorkList nav={nav} query={hash.split("?")[1] ?? ""} />;
  else if (path === "/alerts") screen = <Alerts nav={nav} />;
  else if (path === "/budgets") screen = <Budgets />;
  else if (path === "/audit") screen = <AuditTrail nav={nav} />;
  else if (path === "/settings") screen = <Stub title="הגדרות" note="הגדרות קונקטור, קישור repositories ו-model policy. בבנייה." />;
  else if (path === "/users") screen = <Stub title="משתמשים" note="ניהול משתמשים והרשאות (Entra ID). בבנייה." />;
  else screen = <Dashboard nav={nav} />;

  const active = (to: string) =>
    to === "#/" ? path === "/" || path.startsWith("/project") || path.startsWith("/wi") : hash.startsWith(to) || (to === "#/audit" && path === "/audit");

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="ניווט">
        <div className="brand">
          <div className="brand-mark">DC</div>
          <div className="brand-word">Delivery Control<span>Center</span></div>
        </div>
        <div className="nav">
          {NAV.map((n) => (
            <button key={n.to} className="nav-item" aria-current={active(n.to) ? "page" : undefined} onClick={() => nav(n.to)}>
              <Icon d={n.icon} />
              {n.label}
              {n.badge && alertCount > 0 && <span className="nav-count">{alertCount}</span>}
            </button>
          ))}
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-foot">
          <div className="avatar-chip">{initials(DEV_EMAIL)}</div>
          <div className="who">
            <p>{DEV_EMAIL.split("@")[0]}</p>
            <span>Admin</span>
          </div>
        </div>
      </nav>
      <div className="canvas">
        <div className="workspace">{screen}</div>
      </div>
    </div>
  );
}

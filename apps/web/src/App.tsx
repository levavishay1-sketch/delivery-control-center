import { useEffect, useState } from "react";
import "./theme.css";
import { Icon, ICONS, initials } from "./ui.tsx";
import { getDashboard } from "./api.ts";
import { Dashboard } from "./screens/Dashboard.tsx";
import { AuditTrail } from "./screens/AuditTrail.tsx";
import { Record } from "./screens/Record.tsx";
import { TaskDetail } from "./screens/TaskDetail.tsx";
import { WorkList } from "./screens/WorkList.tsx";
import { RequirementList } from "./screens/RequirementList.tsx";
import { ClientList } from "./screens/ClientList.tsx";
import { ClientDetail } from "./screens/ClientDetail.tsx";
import { AdoTasks } from "./screens/AdoTasks.tsx";
import { FlowFullPage } from "./screens/FlowFullPage.tsx";
import { Alerts } from "./screens/Alerts.tsx";
import { Budgets } from "./screens/Budgets.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Prompts } from "./screens/Prompts.tsx";
import { AiComponents } from "./screens/AiComponents.tsx";
import { Repositories } from "./screens/Repositories.tsx";
import { RepoOnboardingPanel } from "./screens/RepoOnboardingPanel.tsx";
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
  { to: "#/clients", label: "לקוחות", icon: ICONS.branch },
  { to: "#/requirements", label: "דרישות", icon: ICONS.folder },
  { to: "#/ado", label: "Azure DevOps", icon: ICONS.branch },
  { to: "#/repositories", label: "Repositories", icon: ICONS.repo },
  { to: "#/work", label: "כל הדרישות", icon: ICONS.list },
  { to: "#/alerts", label: "התראות", icon: ICONS.bell, badge: true },
  { to: "#/budgets", label: "תקציבים", icon: ICONS.slash },
  { to: "#/prompts", label: "פרומפטים", icon: ICONS.message },
  { to: "#/ai-components", label: "רכיבי AI", icon: ICONS.layers },
  { to: "#/settings", label: "הגדרות", icon: ICONS.gear },
  { to: "#/users", label: "משתמשים", icon: ICONS.inbox },
  { to: "#/audit", label: "יומן פעילויות", icon: ICONS.list },
];

export function App() {
  const hash = useHash();
  const nav = (h: string) => { location.hash = h; };
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => { getDashboard().then((d) => setAlertCount(d.alerts.length)).catch(() => {}); }, [hash]);

  const path = hash.replace(/^#/, "").split("?")[0]!;
  let screen: React.ReactNode;
  if (path.startsWith("/wi/")) screen = <Record id={path.slice(4)} nav={nav} />;
  else if (path.startsWith("/flow/")) screen = <FlowFullPage id={path.slice(6)} nav={nav} />;
  else if (path.startsWith("/task/")) screen = <TaskDetail id={path.slice(6)} nav={nav} />;
  else if (path.startsWith("/client/")) screen = <ClientDetail id={path.slice(8)} nav={nav} />;
  else if (path.startsWith("/project/")) screen = <Record id={path.slice(9)} nav={nav} />;
  else if (path === "/clients") screen = <ClientList nav={nav} />;
  else if (path === "/requirements" || path === "/projects") screen = <RequirementList nav={nav} />;
  else if (path === "/ado") screen = <AdoTasks nav={nav} />;
  else if (path === "/repositories") screen = <Repositories nav={nav} />;
  else if (path.startsWith("/repo-onboarding/")) screen = <RepoOnboardingPanel id={path.slice(17)} nav={nav} />;
  else if (path.startsWith("/repo/")) screen = <RepoOnboardingPanel id={path.slice(6)} nav={nav} />;
  else if (path === "/work") screen = <WorkList nav={nav} query={hash.split("?")[1] ?? ""} />;
  else if (path === "/alerts") screen = <Alerts nav={nav} />;
  else if (path === "/budgets") screen = <Budgets />;
  else if (path === "/audit") screen = <AuditTrail nav={nav} />;
  else if (path === "/settings") screen = <Settings nav={nav} />;
  else if (path === "/prompts") screen = <Prompts />;
  else if (path === "/ai-components") screen = <AiComponents />;
  else if (path === "/users") screen = <Stub title="משתמשים" note="ניהול משתמשים והרשאות (Entra ID). בבנייה." />;
  else screen = <Dashboard nav={nav} />;

  const active = (to: string) => {
    if (to === "#/") return path === "/";
    if (to === "#/clients") return path === "/clients" || path.startsWith("/client/");
    if (to === "#/requirements") return path === "/requirements" || path === "/projects" || path.startsWith("/project/") || path.startsWith("/wi/") || path.startsWith("/task/");
    if (to === "#/repositories") return path === "/repositories" || path.startsWith("/repo/");
    return hash.split("?")[0] === to;
  };

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

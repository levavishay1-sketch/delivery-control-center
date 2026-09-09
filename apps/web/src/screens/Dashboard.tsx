import { useEffect, useState } from "react";
import { getDashboard, type Dashboard as D } from "../api.ts";
import { ICONS, Icon, PageHead, Pill, StatusPill, TypeChip, initials } from "../ui.tsx";

const ID_CLASS = ["", "id-b", "id-c", "id-d"];
const ago = (iso: string | null) => {
  if (!iso) return "no activity";
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export function Dashboard({ nav }: { nav: (hash: string) => void }) {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getDashboard().then(setD).catch((e) => setErr(String(e))); }, []);

  return (
    <>
      <PageHead
        title="Dashboard"
        sub="Everything that needs a decision, and everything already in motion."
        actions={
          <>
            <div className="search-field">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS.search}</svg>
              Search work items and projects…
              <kbd>Ctrl K</kbd>
            </div>
            <button className="btn btn-primary"><Icon d={ICONS.plus} size={14} /> New Work Item</button>
          </>
        }
      />

      {err && <div className="empty">{err}</div>}
      {!d && !err && <div className="spin">Loading…</div>}

      {d && (
        <>
          <div className="stat-row">
            {([
              ["warning", d.stats.decisions, "Decisions", "#/attention"],
              ["critical", d.stats.blockers, "Blockers", "#/attention"],
              ["critical", d.stats.risks, "Risks", "#/attention"],
              ["warning", d.stats.deadlines, "Deadlines", "#/attention"],
            ] as const).map(([tone, n, label, to]) => (
              <div key={label} className="stat-tile" role="button" tabIndex={0} onClick={() => nav(to)}>
                <span className={`badge-circle tone-${tone}`}>
                  <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    {label === "Blockers" ? ICONS.slash : label === "Risks" ? ICONS.triangle : label === "Deadlines" ? ICONS.calendar : ICONS.alert}
                  </svg>
                </span>
                <span><span className="num">{n}</span><span className="lbl">{label}</span></span>
              </div>
            ))}
          </div>

          <div className="section">
            <p className="section-lbl">Quick access</p>
            <div className="proj-grid">
              {d.quickAccess.map((p, i) => (
                <div key={p.id} className={`proj-card ${ID_CLASS[i % 4]}`} role="button" tabIndex={0} onClick={() => nav(`#/project/${p.id}`)}>
                  <p className="name">{p.name}</p>
                  <p className="client">{p.clientName}</p>
                  <p className="meta">{p.items} work items · updated {ago(p.lastUpdate)}</p>
                </div>
              ))}
              {d.quickAccess.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>No projects yet.</div>}
            </div>
          </div>

          {d.panels.map((panel) => (
            <div className="section" key={panel.clientId}>
              <p className="section-lbl">{panel.clientName}</p>
              <div className="panel">
                <div className="client-head">
                  <h3><b>AI cost: ${panel.aiCostUsd.toFixed(2)}</b></h3>
                  <div className="avatar-stack">
                    {panel.members.slice(0, 3).map((m) => <span key={m.id} className="a">{initials(m.name)}</span>)}
                    {panel.members.length > 3 && <span className="a overflow">+{panel.members.length - 3}</span>}
                  </div>
                </div>
                <div className="meter-row">
                  <span className="meter-label">{panel.budgetPct}% of budget used</span>
                  <span className="meter-track"><span className={`meter-fill ${panel.budgetPct >= 80 ? "hot" : ""}`} style={{ width: `${panel.budgetPct}%` }} /></span>
                  <span className="meter-label">${Math.round(panel.aiCostUsd)} / ${Math.round(panel.budgetUsd)}</span>
                </div>
                <div className="rowlist">
                  {panel.items.map((it) => (
                    <div className="row" key={it.id}>
                      <span className="title">{it.title}</span>
                      <TypeChip kind={it.kind} />
                      <span className="spacer" />
                      {it.status !== "blocked" && <span className="stage">{it.phase.toUpperCase()}</span>}
                      <StatusPill status={it.status} />
                      <a className="link" onClick={() => nav(`#/wi/${it.id}`)}>Quick View</a>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {d.notifications.length > 0 && (
            <div className="section">
              <p className="section-lbl">Recent alerts</p>
              <div className="panel">
                {d.notifications.map((n) => (
                  <div className="stat-line" key={n.id}>
                    <span className="l">
                      <Pill tone={n.severity === "critical" ? "critical" : n.severity === "warn" ? "warning" : "inactive"}>{n.kind}</Pill>{" "}
                      {n.title}
                    </span>
                    {n.workitemId && <a className="link" onClick={() => nav(`#/wi/${n.workitemId}`)}>Open</a>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

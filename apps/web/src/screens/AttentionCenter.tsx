import { useEffect, useState } from "react";
import { getDashboard, type Dashboard } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";

/**
 * Attention Center — everything waiting for a person, in one list.
 * Built from the same dashboard payload (decisions, blockers, notifications).
 */
export function AttentionCenter({ nav }: { nav: (h: string) => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getDashboard().then(setD).catch((e) => setErr(String(e))); }, []);

  return (
    <>
      <PageHead title="Attention Center" sub="Every open decision, blocker and alert — nothing waits silently." />
      {err && <div className="empty">{err}</div>}
      {!d && !err && <div className="spin">Loading…</div>}
      {d && (
        <>
          <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="stat-tile"><span className="badge-circle tone-warning"><b style={{ color: "#fff" }}>{d.stats.decisions}</b></span><span><span className="num">{d.stats.decisions}</span><span className="lbl">Decisions to make</span></span></div>
            <div className="stat-tile"><span className="badge-circle tone-critical"><b style={{ color: "#fff" }}>{d.stats.blockers}</b></span><span><span className="num">{d.stats.blockers}</span><span className="lbl">Open blockers</span></span></div>
            <div className="stat-tile"><span className="badge-circle tone-critical"><b style={{ color: "#fff" }}>{d.stats.risks}</b></span><span><span className="num">{d.stats.risks}</span><span className="lbl">High-risk items</span></span></div>
          </div>

          <p className="section-lbl">Work items needing a look</p>
          <div className="rowlist">
            {d.panels.flatMap((p) => p.items.filter((i) => i.status === "blocked" || i.status === "ai_drafting").map((i) => ({ ...i, client: p.clientName })))
              .map((i) => (
                <div className="row" key={i.id}>
                  <span className="title">{i.title}</span>
                  <span className="stage">{i.client}</span>
                  <span className="spacer" />
                  <Pill tone={i.status === "blocked" ? "critical" : "ai"}>{i.status === "blocked" ? "Blocked" : "AI drafting — verify"}</Pill>
                  <a className="link" onClick={() => nav(`#/wi/${i.id}`)}>Open</a>
                </div>
              ))}
            {d.panels.every((p) => p.items.every((i) => i.status === "in_pipeline" || i.status === "done")) && (
              <div className="empty">Nothing needs your attention right now.</div>
            )}
          </div>

          {d.notifications.length > 0 && (
            <>
              <p className="section-lbl" style={{ marginTop: 26 }}>Alerts</p>
              <div className="rowlist">
                {d.notifications.map((n) => (
                  <div className="row" key={n.id}>
                    <Pill tone={n.severity === "critical" ? "critical" : n.severity === "warn" ? "warning" : "inactive"}>{n.kind}</Pill>
                    <span className="title" style={{ fontWeight: 400 }}>{n.title}</span>
                    <span className="spacer" />
                    {n.workitemId && <a className="link" onClick={() => nav(`#/wi/${n.workitemId}`)}>Open</a>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

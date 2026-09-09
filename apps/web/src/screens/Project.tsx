import { useEffect, useState } from "react";
import { getDashboard, type Dashboard } from "../api.ts";
import { PageHead, StatusPill, TypeChip } from "../ui.tsx";
import { FlowGraph } from "./FlowGraph.tsx";

/** Project screen: its work items + the dependency Flow. */
export function Project({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"items" | "flow">("items");
  useEffect(() => { getDashboard().then(setD).catch(() => {}); }, []);

  const proj = d?.quickAccess.find((p) => p.id === id);
  const panel = d?.panels.find((p) => proj && p.clientName === proj.clientName);

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav("#/")}>← Dashboard</a>}
        title={proj?.name ?? "Project"}
        sub={proj ? `${proj.clientName} · ${proj.items} work items` : undefined}
        actions={<button className="btn btn-primary">+ New Work Item</button>}
      />
      <div className="tabs">
        <button className="tab" aria-selected={tab === "items"} onClick={() => setTab("items")}>Work items</button>
        <button className="tab" aria-selected={tab === "flow"} onClick={() => setTab("flow")}>Flow &amp; dependencies</button>
      </div>

      {tab === "items" && (
        <div className="rowlist">
          {(panel?.items ?? []).map((it) => (
            <div className="row" key={it.id}>
              <span className="title">{it.title}</span>
              <TypeChip kind={it.kind} />
              <span className="spacer" />
              <span className="stage">{it.priority} priority</span>
              <StatusPill status={it.status} />
              <a className="link" onClick={() => nav(`#/wi/${it.id}`)}>Open</a>
            </div>
          ))}
          {!panel && <div className="spin">Loading…</div>}
          {panel && panel.items.length === 0 && <div className="empty">No work items.</div>}
        </div>
      )}

      {tab === "flow" && (
        <div style={{ height: "62vh", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-md)", overflow: "hidden", position: "relative" }}>
          <FlowGraph projectId={id} />
        </div>
      )}
    </>
  );
}

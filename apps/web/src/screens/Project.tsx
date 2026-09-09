import { useEffect, useState } from "react";
import { getProjectList, getWorkList, type WorkListRow } from "../api.ts";
import { PageHead, TypeChip, initials } from "../ui.tsx";
import { FlowGraph } from "./FlowGraph.tsx";

const PRIO: Record<string, string> = { critical: "קריטית", high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const CONN: Record<string, string> = { manual: "ידני", ado: "Azure DevOps", github: "GitHub", jira: "Jira", dcc: "DCC" };

export function Project({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [meta, setMeta] = useState<{ name: string; clientName: string; connectorType: string; items: number } | null>(null);
  const [rows, setRows] = useState<WorkListRow[]>([]);
  const [tab, setTab] = useState<"items" | "flow">("items");

  useEffect(() => {
    getProjectList().then((r) => {
      const p = r.projects.find((x) => x.id === id);
      if (p) setMeta({ name: p.name, clientName: p.clientName, connectorType: p.connectorType, items: p.items });
    }).catch(() => {});
    getWorkList().then((r) => setRows(r.items)).catch(() => {});
  }, [id]);

  const items = rows.filter((w) => meta && w.projectName === meta.name);

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav("#/projects")}>← פרויקטים</a>}
        title={meta?.name ?? "פרויקט"}
        sub={meta ? `${meta.clientName} · אינטגרציה: ${CONN[meta.connectorType] ?? meta.connectorType} · ${meta.items} עבודות` : undefined}
        actions={<button className="btn btn-primary">+ עבודה חדשה</button>}
      />
      <div className="tabs">
        <button className="tab" aria-selected={tab === "items"} onClick={() => setTab("items")}>עבודות</button>
        <button className="tab" aria-selected={tab === "flow"} onClick={() => setTab("flow")}>Flow ותלויות</button>
      </div>

      {tab === "items" && (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <table className="wtable">
            <thead><tr><th>עבודה</th><th>אחראי</th><th>עדיפות</th><th>שלב</th></tr></thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td><span className="w-title" onClick={() => nav(`#/wi/${w.id}`)}>{w.title}</span> <TypeChip kind={w.kind} />{w.openBlockers > 0 && <span className="prio critical" style={{ marginInlineStart: 6 }}>חסום</span>}</td>
                  <td><span className="w-owner"><span className="a">{initials(w.ownerName)}</span>{w.ownerName}</span></td>
                  <td><span className={`prio ${w.priority}`}>{PRIO[w.priority]}</span></td>
                  <td>{w.phase}</td>
                </tr>
              ))}
              {meta && items.length === 0 && <tr><td colSpan={4}><div className="empty">אין עבודות.</div></td></tr>}
            </tbody>
          </table>
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

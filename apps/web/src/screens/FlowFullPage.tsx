import { useEffect, useState } from "react";
import { getDetail, getTaskFlow, ADO_LADDER, type WorkItemDetail, type TaskFlow } from "../api.ts";
import { TaskGraph } from "./TaskGraph.tsx";
import { CardTitle } from "../ui.tsx";

/**
 * The Flow, full-page — reached via "⤢ פתח במסך מלא" on the embedded
 * Flow (inside a requirement's own page), normally in a new tab. Same
 * data, same colors/legend/chips as the embedded view — just the whole
 * screen instead of a small box, with zoom on.
 */
export function FlowFullPage({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<WorkItemDetail | null>(null);
  const [flow, setFlow] = useState<TaskFlow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getDetail(id).then(setD).catch((e) => setErr(String(e)));
    getTaskFlow(id).then(setFlow).catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <div className="empty">{err}</div>;
  if (!d || !flow) return <div className="spin">טוען…</div>;

  const canvasHeight = Math.max(520, (typeof window !== "undefined" ? window.innerHeight : 900) - 220);

  return (
    <div style={{ padding: "20px 24px" }}>
      <a onClick={() => nav(`#/wi/${id}`)} style={{ cursor: "pointer", fontSize: 12.5, color: "var(--color-accent)", fontWeight: 600 }}>
        ← {d.workitem.key ?? "לדרישה"}
      </a>
      <CardTitle as="h1" info="page_flow" style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 16px" }}>{d.workitem.title}</CardTitle>

      <TaskGraph
        flow={flow} height={canvasHeight} nav={nav}
        title="ההיררכיה" subtitle={`עומק ${flow.depth} (${ADO_LADDER.slice(ADO_LADDER.length - flow.depth).join(" › ")})`}
        zoomable
      />
    </div>
  );
}

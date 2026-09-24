import { useEffect, useState } from "react";
import { getDetail, getTaskFlow, type WorkItemDetail, type TaskFlow } from "../api.ts";
import { RequirementMap } from "./RequirementMap.tsx";
import { CardTitle } from "../ui.tsx";

/** The requirement's map on a screen of its own: its tasks beside the specification they come from. */
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

  return (
    <div className="rq-wrap">
      <div className="rq-head">
        <a className="rq-back" onClick={() => nav(`#/wi/${id}`)}>← {d.workitem.key ?? "לדרישה"}</a>
        <CardTitle as="h1" info="page_flow" style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0" }}>{d.workitem.title}</CardTitle>
      </div>
      <RequirementMap id={id} flow={flow} nav={nav} />
    </div>
  );
}

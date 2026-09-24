import { Pill, TaskStatusPill } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import type { TaskFlowNode } from "../api.ts";

/**
 * What a person needs to know to develop this task — and nothing else. Not
 * its history, its checks or its cost: the instruction it was given, how big
 * it is, which files it will touch, what it waits for, and which lines of the
 * specification it carries out. The task's own screen has the rest, one
 * click away.
 *
 * One component, opened in place wherever a task is drawn — under its row in
 * the list, over its card in the cubes — so it reads the same everywhere.
 */

const SIZE_HE: Record<string, string> = { small: "קטנה", standard: "בינונית", large: "גדולה" };
const MAX_FILES = 6;
const MAX_LINES = 4;

export function TaskBrief({ node, waitsFor, implemented, onOpen, onClose }: {
  node: TaskFlowNode;
  /** What it waits for, as the tasks themselves. */
  waitsFor: TaskFlowNode[];
  /** The requirements in the spec it carries out — null when the spec has not been marked yet, so nobody knows. */
  implemented: { anchor: string; title: string }[] | null;
  onOpen: () => void;
  onClose?: () => void;
}) {
  const instruction = (node.prompt ?? "").trim();
  return (
    <div className="tb" onClick={(e) => e.stopPropagation()}>
      <div className="tb-head">
        <b>{node.isGroup ? "מה הקבוצה מספקת" : "מה לפתח"}<Info k="task_brief" /></b>
        <span className="tb-meta">
          {node.adoType ?? "Task"} · {SIZE_HE[node.appetite] ?? node.appetite}
          {node.linkedAdoId && (node.adoUrl
            ? <> · <a href={node.adoUrl} target="_blank" rel="noreferrer">TFS #{node.linkedAdoId} ↗</a></>
            : <> · TFS #{node.linkedAdoId}</>)}
        </span>
        {onClose && <a className="tb-x" title="סגור" onClick={onClose}>✕</a>}
      </div>

      <p className="tb-text">{instruction && instruction !== node.intent.trim() ? instruction : node.intent}</p>
      {node.isGroup && <p className="tb-note">קבוצה: היא לא מפותחת בעצמה — העבודה שלה היא תת-המשימות שבתוכה.</p>}

      <div className="tb-rows">
        <div className="tb-row">
          <span className="tb-k">מצב</span>
          {node.status ? <TaskStatusPill status={node.status} /> : <Pill tone="inactive">{node.state}</Pill>}
        </div>
        {node.affectedPaths.length > 0 && (
          <div className="tb-row">
            <span className="tb-k">קבצים צפויים</span>
            <span className="tb-files">
              {node.affectedPaths.slice(0, MAX_FILES).map((f) => <code key={f} title={f}>{f.split(/[\\/]/).pop()}</code>)}
              {node.affectedPaths.length > MAX_FILES && <i>+{node.affectedPaths.length - MAX_FILES}</i>}
            </span>
          </div>
        )}
        {waitsFor.length > 0 && (
          <div className="tb-row">
            <span className="tb-k">ממתינה ל</span>
            <span className="tb-v">{waitsFor.map((w) => `#${w.seq} ${w.intent}`).join(" · ")}</span>
          </div>
        )}
        {implemented && (
          <div className="tb-row">
            <span className="tb-k">ממשת מהאפיון</span>
            <span className="tb-v">
              {implemented.length === 0
                ? "אף דרישה מהאפיון"
                : <>
                    {implemented.slice(0, MAX_LINES).map((p) => p.title).join(" · ")}
                    {implemented.length > MAX_LINES && ` · ועוד ${implemented.length - MAX_LINES}`}
                  </>}
            </span>
          </div>
        )}
      </div>

      <a className="tb-open" onClick={onOpen}>פתח את מסך המשימה ←</a>
    </div>
  );
}

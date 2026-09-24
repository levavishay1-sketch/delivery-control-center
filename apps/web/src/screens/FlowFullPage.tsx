import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getDetail, getTaskFlow, getSpec, previewSpecMap, mapSpec,
  type WorkItemDetail, type TaskFlow, type SpecView,
} from "../api.ts";
import { TaskGraph } from "./TaskGraph.tsx";
import { TaskTree, type TreeMode } from "./TaskTree.tsx";
import { SpecHead, SpecPane } from "./SpecPane.tsx";
import { CardTitle, PromptPreviewModal } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";

/**
 * A requirement's tasks, beside the specification they come from.
 *
 * Two questions, asked with two switches that do not depend on each other:
 * WHAT it says — the hierarchy (what belongs to what) or the dependencies
 * (what must finish before what) — and HOW it is drawn, as a nested list or
 * as the FLOW's own cards. Either way, clicking a task colours the pieces of
 * the spec it implements, and clicking a piece marks the tasks that implement
 * it, so "is this written down anywhere?" and "why does this task exist?" are
 * the same gesture from either side.
 */

type Layout = "list" | "cards";

export function FlowFullPage({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<WorkItemDetail | null>(null);
  const [flow, setFlow] = useState<TaskFlow | null>(null);
  const [spec, setSpec] = useState<SpecView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [mode, setMode] = useState<TreeMode>("hier");
  const [layout, setLayout] = useState<Layout>("list");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [task, setTask] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);

  // the reading of the spec — the one action here that costs money, behind the usual preview gate
  const [mapOpen, setMapOpen] = useState(false);
  const [mapData, setMapData] = useState<{ prompt: string; promptHe: string } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);

  const loadSpec = useCallback(() => { getSpec(id).then(setSpec).catch(() => setSpec(null)); }, [id]);
  useEffect(() => {
    getDetail(id).then(setD).catch((e) => setErr(String(e)));
    getTaskFlow(id).then(setFlow).catch((e) => setErr(String(e)));
    loadSpec();
  }, [id, loadSpec]);
  // Everything open to begin with — in either view. The list is one line per
  // task precisely so the whole requirement can be read without opening it,
  // and in the dependency view nothing is a group, so opening only groups
  // would leave the chain hidden under its first task.
  useEffect(() => { if (flow) setOpen(new Set(flow.nodes.map((n) => n.id))); }, [flow]);

  const covers = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of spec?.sections ?? []) for (const t of s.tasks) m.set(t.id, (m.get(t.id) ?? 0) + 1);
    // A group's own count is what its sub-tasks implement.
    for (const n of flow?.nodes ?? []) {
      if (!n.isGroup) continue;
      const kids = (flow?.nodes ?? []).filter((k) => k.parentTaskId === n.id);
      m.set(n.id, new Set((spec?.sections ?? []).filter((s) => s.tasks.some((t) => kids.some((k) => k.id === t.id))).map((s) => s.anchor)).size);
    }
    return m;
  }, [spec, flow]);

  const hit = useMemo(() => {
    if (!task || !spec) return new Set<string>();
    const kids = (flow?.nodes ?? []).filter((n) => n.parentTaskId === task).map((n) => n.id);
    const mine = new Set([task, ...kids]);
    return new Set(spec.sections.filter((s) => s.tasks.some((t) => mine.has(t.id))).map((s) => s.anchor));
  }, [task, spec, flow]);

  const related = useMemo(() => {
    if (!anchor || !spec) return new Set<string>();
    const ids = new Set(spec.sections.find((s) => s.anchor === anchor)?.tasks.map((t) => t.id) ?? []);
    for (const n of flow?.nodes ?? []) if (n.isGroup && (flow?.nodes ?? []).some((k) => k.parentTaskId === n.id && ids.has(k.id))) ids.add(n.id);
    return ids;
  }, [anchor, spec, flow]);

  /** The list: clicking the chosen task again lets it go. */
  const pickTask = (tid: string) => { setTask((cur) => (cur === tid ? null : tid)); setAnchor(null); };
  /** The cards: choose that one, or — on the empty canvas — nothing. */
  const selectTask = (tid: string) => { setTask(tid || null); setAnchor(null); };
  const pickAnchor = (a: string) => {
    setAnchor((cur) => (cur === a ? null : a));
    setTask(null);
    const ids = spec?.sections.find((s) => s.anchor === a)?.tasks.map((t) => t.id) ?? [];
    if (ids.length && flow) {
      // open whatever holds them, in whichever view is showing
      setOpen((prev) => {
        const next = new Set(prev);
        const byId = new Map(flow.nodes.map((n) => [n.id, n]));
        for (const tid of ids) {
          const n = byId.get(tid);
          if (n?.parentTaskId) next.add(n.parentTaskId);
          for (let up = n?.dependsOn ?? []; up.length; up = byId.get(up[0]!)?.dependsOn ?? []) next.add(up[0]!);
        }
        return next;
      });
    }
  };

  const openMap = async () => {
    setMapOpen(true); setMapLoading(true); setMapErr(null); setMapData(null);
    try { const p = await previewSpecMap(id); setMapData({ prompt: p.prompt, promptHe: p.promptHe }); }
    catch (e) { setMapErr(String(e)); }
    finally { setMapLoading(false); }
  };
  const runMap = async () => {
    setMapping(true);
    try { await mapSpec(id); setMapOpen(false); loadSpec(); }
    catch (e) { setMapErr(String(e)); }
    finally { setMapping(false); }
  };

  if (err) return <div className="empty">{err}</div>;
  if (!d || !flow) return <div className="spin">טוען…</div>;

  const note = task
    ? `#${flow.nodes.find((n) => n.id === task)?.seq ?? ""} — ${hit.size === 0 ? "לא מופיעה באפיון" : hit.size === 1 ? "חלק אחד באפיון" : `${hit.size} חלקים באפיון`}`
    : anchor
      ? `${related.size === 0 ? "אף משימה לא מממשת" : related.size === 1 ? "משימה אחת מממשת" : `${related.size} משימות מממשות`} את החלק שנבחר`
      : "לחצו על משימה כדי לראות מה היא מממשת, או על שורה באפיון כדי לראות מי מממש אותה";

  const tasksPane = (
    <div className="rq-pane">
      <div className="rq-pane-h">
        <b>המשימות<Info k={mode === "hier" ? "task_hierarchy_view" : "task_dependency_view"} /></b>
        <span className="rq-note">{mode === "hier" ? "מה שייך למה" : "מה צריך להסתיים לפני מה"}</span>
      </div>
      <div className="rq-pane-b">
        {layout === "list"
          ? <TaskTree
              flow={flow} mode={mode} selected={task} related={related} open={open} covers={covers}
              onToggle={(tid) => setOpen((p) => { const n = new Set(p); n.has(tid) ? n.delete(tid) : n.add(tid); return n; })}
              onPick={pickTask} onOpenTask={(tid) => nav(`#/task/${tid}`)}
            />
          : <TaskGraph
              flow={flow} nav={nav} mode={mode} zoomable
              height={Math.max(420, (typeof window !== "undefined" ? window.innerHeight : 900) - 300)}
              selectedId={task} relatedIds={related} onSelect={selectTask}
            />}
      </div>
    </div>
  );

  return (
    <div className="rq-wrap">
      {mapOpen && (
        <PromptPreviewModal
          title="קריאת האפיון לחלקים"
          data={mapData} loading={mapLoading} error={mapErr}
          loadingHint="בונה את מה שיישלח — האפיון, ההחלטות והמשימות…"
          onClose={() => { setMapOpen(false); setMapErr(null); }}
          onConfirm={runMap} confirming={mapping}
          confirmLabel="✦ קרא את האפיון"
        />
      )}
      <div className="rq-head">
        <div>
          <a className="rq-back" onClick={() => nav(`#/wi/${id}`)}>← {d.workitem.key ?? "לדרישה"}</a>
          <CardTitle as="h1" info="page_flow" style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0" }}>{d.workitem.title}</CardTitle>
        </div>
        <div className="rq-switches">
          <div className="rq-sw">
            <span className="rq-cap">תוכן</span>
            <div className="seg" role="group" aria-label="תוכן התצוגה">
              <button type="button" aria-pressed={mode === "hier"} onClick={() => setMode("hier")}>היררכיה</button>
              <button type="button" aria-pressed={mode === "dep"} onClick={() => setMode("dep")}>תלויות</button>
            </div>
          </div>
          <div className="rq-sw">
            <span className="rq-cap">פריסה</span>
            <div className="seg" role="group" aria-label="פריסת התצוגה">
              <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>רשימה</button>
              <button type="button" aria-pressed={layout === "cards"} onClick={() => setLayout("cards")}>קוביות</button>
            </div>
          </div>
        </div>
      </div>

      <div className={`rq-split${spec?.read ? "" : " one"}`}>
        {spec?.read ? (
          <div className="rq-pane">
            <SpecHead spec={spec} note={note} />
            <div className="rq-pane-b"><SpecPane spec={spec} hit={hit} picked={anchor} onPick={pickAnchor} /></div>
          </div>
        ) : (
          <div className="rq-pane rq-unread">
            <div className="rq-pane-b">
              <p className="section-lbl">האפיון עוד לא נקרא לחלקים<Info k="spec_pane" /></p>
              <p style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.65, marginBottom: 12 }}>
                קלוד יקרא את מסמך האפיון ואת ההחלטות שנסגרו, יחתוך אותם לחלקים, ויסמן איזו משימה מממשת כל חלק — וגם מה שאף משימה לא מממשת.
                הוא לא משנה את האפיון. זו הרצה אחת שעולה כסף, ורואים בדיוק מה נשלח לפניה.
              </p>
              <button className="btn btn-primary btn-sm" onClick={openMap}>✦ קרא את האפיון</button>
              <Info k="spec_read" />
            </div>
          </div>
        )}
        {tasksPane}
      </div>
    </div>
  );
}

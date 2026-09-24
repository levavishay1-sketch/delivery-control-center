import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSpec, previewSpecMap, mapSpec, type TaskFlow, type SpecView } from "../api.ts";
import { TaskGraph } from "./TaskGraph.tsx";
import { TaskTree, type TreeMode } from "./TaskTree.tsx";
import { SpecHead, SpecPane } from "./SpecPane.tsx";
import { PromptPreviewModal } from "../ui.tsx";
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
 *
 * One component, two places: the full screen (`FlowFullPage`) and inside the
 * requirement's own steps (`embedded`), so what is seen in one is what is
 * seen in the other.
 */

type Layout = "list" | "cards";

export function RequirementMap({ id, flow, nav, embedded = false }: {
  id: string;
  flow: TaskFlow;
  nav: (h: string) => void;
  /** Inside a requirement's step: a fixed height, and a way out to the full screen. */
  embedded?: boolean;
}) {
  const [spec, setSpec] = useState<SpecView | null>(null);
  const [mode, setMode] = useState<TreeMode>("hier");
  const [layout, setLayout] = useState<Layout>("list");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [task, setTask] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);

  // the marking of the spec — the one action here that costs money, behind the usual preview gate
  const [mapOpen, setMapOpen] = useState(false);
  const [mapData, setMapData] = useState<{ prompt: string; promptHe: string } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapErr, setMapErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);

  const loadSpec = useCallback(() => { getSpec(id).then(setSpec).catch(() => setSpec(null)); }, [id]);
  useEffect(() => { loadSpec(); }, [loadSpec]);
  // Everything open to begin with — in either view. The list is one line per
  // task precisely so the whole requirement can be read without opening it,
  // and in the dependency view nothing is a group, so opening only groups
  // would leave the chain hidden under its first task.
  useEffect(() => { setOpen(new Set(flow.nodes.map((n) => n.id))); }, [flow]);

  const covers = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of spec?.pieces ?? []) for (const t of s.tasks) m.set(t.id, (m.get(t.id) ?? 0) + 1);
    // A group's own count is what its sub-tasks implement.
    for (const n of flow.nodes) {
      if (!n.isGroup) continue;
      const kids = flow.nodes.filter((k) => k.parentTaskId === n.id);
      m.set(n.id, new Set((spec?.pieces ?? []).filter((s) => s.tasks.some((t) => kids.some((k) => k.id === t.id))).map((s) => s.anchor)).size);
    }
    return m;
  }, [spec, flow]);

  /** What a task carries out of the spec — a group carries out what its sub-tasks do. */
  const implementedBy = useCallback((tid: string) => {
    const kids = flow.nodes.filter((k) => k.parentTaskId === tid).map((k) => k.id);
    const mine = new Set([tid, ...kids]);
    return (spec?.pieces ?? []).filter((s) => s.tasks.some((t) => mine.has(t.id))).map((s) => ({ anchor: s.anchor, title: s.title }));
  }, [spec, flow]);

  const hit = useMemo(() => {
    if (!task || !spec) return new Set<string>();
    const kids = flow.nodes.filter((n) => n.parentTaskId === task).map((n) => n.id);
    const mine = new Set([task, ...kids]);
    return new Set(spec.pieces.filter((s) => s.tasks.some((t) => mine.has(t.id))).map((s) => s.anchor));
  }, [task, spec, flow]);

  const related = useMemo(() => {
    if (!anchor || !spec) return new Set<string>();
    const ids = new Set(spec.pieces.find((s) => s.anchor === anchor)?.tasks.map((t) => t.id) ?? []);
    for (const n of flow.nodes) if (n.isGroup && flow.nodes.some((k) => k.parentTaskId === n.id && ids.has(k.id))) ids.add(n.id);
    return ids;
  }, [anchor, spec, flow]);

  /** The list: clicking the chosen task again lets it go. */
  const pickTask = (tid: string) => { setTask((cur) => (cur === tid ? null : tid)); setAnchor(null); };
  /** The cards: choose that one, or — on the empty canvas — nothing. */
  const selectTask = (tid: string) => { setTask(tid || null); setAnchor(null); };
  const pickAnchor = (a: string) => {
    setAnchor((cur) => (cur === a ? null : a));
    setTask(null);
    const ids = spec?.pieces.find((s) => s.anchor === a)?.tasks.map((t) => t.id) ?? [];
    if (ids.length) {
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

  const note = task
    ? `#${flow.nodes.find((n) => n.id === task)?.seq ?? ""} — ${hit.size === 0 ? "לא מופיעה באפיון" : hit.size === 1 ? "דרישה אחת באפיון" : `${hit.size} דרישות באפיון`}`
    : anchor
      ? `${related.size === 0 ? "אף משימה לא מממשת" : related.size === 1 ? "משימה אחת מממשת" : `${related.size} משימות מממשות`} את מה שנבחר`
      : spec?.read
        ? "לחצו על משימה כדי לראות מה היא מממשת, או על שורה באפיון כדי לראות מי מממש אותה"
        : "";

  const tasksPane = (
    <div className="rq-pane">
      <div className="rq-pane-h">
        <b>המשימות<Info k={mode === "hier" ? "task_hierarchy_view" : "task_dependency_view"} /></b>
        <span className="rq-note">{mode === "hier" ? "מה שייך למה" : "מה צריך להסתיים לפני מה"}</span>
      </div>
      <div className="rq-pane-b">
        {layout === "list"
          ? <TaskTree
              flow={flow} mode={mode} selected={task} related={related} open={open} covers={spec?.read ? covers : null}
              onToggle={(tid) => setOpen((p) => { const n = new Set(p); n.has(tid) ? n.delete(tid) : n.add(tid); return n; })}
              onPick={pickTask} onOpenTask={(tid) => nav(`#/task/${tid}`)}
              implementedBy={spec?.read ? implementedBy : null}
            />
          : <TaskGraph
              flow={flow} nav={nav} mode={mode} zoomable
              height={embedded ? 420 : Math.max(420, (typeof window !== "undefined" ? window.innerHeight : 900) - 300)}
              selectedId={task} relatedIds={related} onSelect={selectTask}
              implementedBy={spec?.read ? implementedBy : null}
            />}
      </div>
    </div>
  );

  return (
    <div className={embedded ? "rq-embed" : "rq-body"}>
      {mapOpen && (
        <PromptPreviewModal
          title="סימון הדרישות באפיון"
          data={mapData} loading={mapLoading} error={mapErr}
          loadingHint="בונה את מה שיישלח — האפיון, ההחלטות והמשימות…"
          onClose={() => { setMapOpen(false); setMapErr(null); }}
          onConfirm={runMap} confirming={mapping}
          confirmLabel="✦ סמן את הדרישות"
        />
      )}
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
        {embedded && <a className="btn btn-secondary btn-sm rq-full" href={`#/flow/${id}`} target="_blank" rel="noreferrer">⤢ פתח במסך מלא</a>}
      </div>

      <div className={`rq-split${spec?.doc ? "" : " one"}`}>
        {spec?.doc ? (
          // The document shows as it arrived from the first look; marking its requirements is the one step that costs.
          <div className="rq-pane">
            <SpecHead spec={spec} note={note} />
            {!spec.read && (
              <div className="rq-unmarked">
                <span>עוד לא סומן מה במסמך הוא דרישה ואיזו משימה מממשת אותה.</span>
                <button className="btn btn-primary btn-sm" onClick={openMap}>✦ סמן את הדרישות</button>
                <Info k="spec_read" />
              </div>
            )}
            <div className="rq-pane-b"><SpecPane spec={spec} hit={hit} picked={anchor} onPick={pickAnchor} /></div>
          </div>
        ) : (
          <div className="rq-pane rq-unread">
            <div className="rq-pane-b">
              <p className="section-lbl">אין לדרישה מסמך אפיון<Info k="spec_pane" /></p>
              <p style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.65 }}>
                האפיון מוצג כאן כמו שהגיע, מהקובץ שצורף לדרישה. צרפו את מסמך האפיון במסך הדרישה, והוא יופיע כאן.
              </p>
            </div>
          </div>
        )}
        {tasksPane}
      </div>
    </div>
  );
}

/**
 * Where the requirement's own steps draw its tasks: the map beside the
 * specification, or the classic graph — one choice for both steps, kept in
 * this browser, the map by default. The classic graph stays because its
 * cards are where a task is approved or set aside from the step itself.
 */
const VIEW_KEY = "dcc.taskView";
export function TaskViewChoice({ id, flow, nav, classic }: { id: string; flow: TaskFlow; nav: (h: string) => void; classic: ReactNode }) {
  const [view, setView] = useState<"map" | "classic">(() => {
    try { return localStorage.getItem(VIEW_KEY) === "classic" ? "classic" : "map"; } catch { return "map"; }
  });
  const choose = (v: "map" | "classic") => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* a private window keeps the choice for this visit only */ }
  };
  return (
    <div>
      <div className="rq-choice">
        <span className="rq-cap">תצוגה</span>
        <div className="seg" role="group" aria-label="איך להציג את המשימות">
          <button type="button" aria-pressed={view === "map"} onClick={() => choose("map")}>מפה עם האפיון</button>
          <button type="button" aria-pressed={view === "classic"} onClick={() => choose("classic")}>גרף קלאסי</button>
        </div>
        <Info k="page_flow" />
      </div>
      {view === "map" ? <RequirementMap id={id} flow={flow} nav={nav} embedded /> : classic}
    </div>
  );
}

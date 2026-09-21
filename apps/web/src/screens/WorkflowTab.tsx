import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  approveTask, assignRequirement, finishResearchWork, getFlowRun, getTaskFlow, getUsers, materializeTasks,
  rejectTask, startAssess, startBreakdown, startBuilding, startResearchWork, getPrompts, previewAssess, previewBreakdown, stopFlowRun, sendRunMessage,
  setTaskActive,
  ADO_LADDER, type FlowRun, type MaterializeResult, type PromptTemplate, type StartBuildResult, type TaskFlow, type WorkItemDetail,
} from "../api.ts";
import { CardTitle, Pill, PromptPreviewModal, CopyBtn } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { TaskGraph } from "./TaskGraph.tsx";
import { AddNote } from "../forms.tsx";

/**
 * The gated wizard for one requirement, embedded in its Overview tab.
 *
 * A requirement is a DCC-ONLY pre-stage; it is never pushed to TFS. Its
 * TASKS are the tracked work items, and the depth of the approved task
 * tree picks their types off the Agile ladder (Epic > Feature > User
 * Story > Task) when step 4 materialises them.
 *
 * Steps unlock in order — you cannot break down while blocking gaps are
 * open, and you cannot start work before the tasks exist in TFS.
 */

const STEPS_DEV = [
  { key: "assess", label: "בחינת בשלות הדרישה" },
  { key: "gaps", label: "פערים" },
  { key: "breakdown", label: "פירוק למשימות" },
  { key: "approve", label: "אישור יצירת משימות ב-TFS" },
  { key: "start", label: "התחלת עבודה" },
] as const;

/** research/testing requirements skip breakdown/approve/materialize
 *  entirely — decided 2026-09-12 (`requirement-types` 0.2/0.3, delegated
 *  to this session's judgment): one auto-created, auto-materialized TFS
 *  task represents the tracked work itself, and the actual work happens
 *  as notes directly on the requirement, not a multi-task breakdown. */
const STEPS_RESEARCH = [
  { key: "assess", label: "בחינת בשלות הדרישה" },
  { key: "gaps", label: "פערים" },
  { key: "work", label: "עבודה" },
] as const;

const Transcript = ({ lines }: { lines: string[] }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight); }, [lines.length]);
  return (
    <div ref={boxRef} style={{ maxHeight: "42vh", overflowY: "auto", background: "#F5F4FA", border: "1px solid #EAE8F5", borderRadius: 9, padding: "10px 12px", fontSize: 12, lineHeight: 1.6 }}>
      {lines.length === 0
        ? <span style={{ color: "var(--ov-label)" }}>מתחיל…</span>
        : lines.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("💭") ? "#6b6d8c" : "#1B1741", whiteSpace: "pre-wrap", marginBottom: 3 }}>{l}</div>
          ))}
    </div>
  );
};

/** The floating "select which ones to create in TFS" screen — a faster
 *  path than approving pending nodes one by one, without losing the
 *  ability to review/edit each one first (that stays in the inline list
 *  below it). */
function ApproveTasksModal({ nodes, onApprove, onClose }: {
  nodes: TaskFlow["nodes"]; onApprove: (id: string) => Promise<void>; onClose: () => void;
}) {
  const pending = nodes.filter((n) => !n.approved && n.active);
  const [selected, setSelected] = useState<Set<string>>(new Set(pending.map((n) => n.id)));
  const [busy, setBusy] = useState(false);
  const allSelected = pending.length > 0 && pending.every((n) => selected.has(n.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pending.map((n) => n.id)));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const confirm = async () => {
    setBusy(true);
    for (const id of selected) await onApprove(id);
    setBusy(false);
    onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(640px, 92vw)", maxHeight: "82vh", overflowY: "auto", background: "var(--surface)",
        border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl", textAlign: "start",
        boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <CardTitle as="h3" info="materialize" style={{ fontSize: 15, fontWeight: 700 }}>אישור יצירת משימות ב-TFS</CardTitle>
          <a onClick={onClose} style={{
            fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex",
            alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)",
          }}>✕</a>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>
          כל מה שמסומן ותאשר יאושר ויוקם ב-TFS (בדיקות מתועדות ב-Discussion של המשימה שלהן, לא כפריט נפרד).
        </p>
        {pending.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-500)" }}>אין משימות שממתינות לאישור.</p>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 8, fontWeight: 600 }}>
              <input type="checkbox" style={{ minWidth: 0 }} checked={allSelected} onChange={toggleAll} />
              סמן הכל ({pending.length})
            </label>
            <div className="rowlist" style={{ marginBottom: 16 }}>
              {pending.map((n) => (
                <label key={n.id} className="row" style={{ cursor: "pointer" }}>
                  <input type="checkbox" style={{ minWidth: 0 }} checked={selected.has(n.id)} onChange={() => toggleOne(n.id)} />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ov-label)", marginInlineStart: 8 }}>#{n.seq}</span>
                  {n.kind === "check" ? <Pill tone="neutral">✓ בדיקה</Pill> : <Pill tone={n.adoType === "Task" ? "inactive" : "ai"}>{n.adoType ?? "Task"}</Pill>}
                  <span style={{ fontSize: 12.5, marginInlineStart: 8 }}>{n.intent}</span>
                </label>
              ))}
            </div>
          </>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={selected.size === 0 || busy} onClick={confirm}>
            {busy ? "מאשר…" : `✓ אשר ${selected.size} ליצירה ב-TFS`}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

export function WorkflowTab({ d, reload, nav, gapsPanel }: {
  d: WorkItemDetail; reload: () => void; nav: (h: string) => void; gapsPanel: React.ReactNode;
}) {
  const wi = d.workitem;
  const clientId = wi.clientId;
  const isResearch = wi.requirementType !== "development";
  const STEPS = isResearch ? STEPS_RESEARCH : STEPS_DEV;
  const [researchConclusion, setResearchConclusion] = useState("");
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchErr, setResearchErr] = useState<string | null>(null);
  const [researchNoteOpen, setResearchNoteOpen] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [taskFlow, setTaskFlow] = useState<TaskFlow | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [users, setUsers] = useState<{ id: string; email: string; displayName: string }[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [edited, setEdited] = useState<Record<string, { intent: string; appetite: string; prompt: string }>>({});
  const [build, setBuild] = useState<StartBuildResult | null>(null);
  const [copied, setCopied] = useState("");
  const [materializing, setMaterializing] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);
  const [materialized, setMaterialized] = useState<MaterializeResult | null>(null);
  const [assessPrompts, setAssessPrompts] = useState<PromptTemplate[]>([]);
  const [assessPromptKey, setAssessPromptKey] = useState("assess.readiness.standard");
  const [assessCustomEmphasis, setAssessCustomEmphasis] = useState("");
  const [assessCustomModel, setAssessCustomModel] = useState("");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ prompt: string; promptHe: string | null; model: string | null; templateTitle: string } | null>(null);
  const [previewLang, setPreviewLang] = useState<"he" | "en">("he");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showRerunOptions, setShowRerunOptions] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [steerText, setSteerText] = useState("");
  const [steerBusy, setSteerBusy] = useState(false);
  // the mandatory gate: nothing reaches Claude except from this modal's
  // confirm button — `pendingKick` is what actually starts once confirmed.
  const [pendingKick, setPendingKick] = useState<"assess" | "breakdown" | null>(null);
  const [sendData, setSendData] = useState<{ prompt: string; promptHe: string } | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [rebreakdownReason, setRebreakdownReason] = useState("");

  /* ── state of the world ─────────────────────────────────────────── */
  const isOpenGap = (g: { state: string }) => g.state === "proposed" || g.state === "verified";
  const openGaps = d.gaps.filter(isOpenGap).length;
  const openBlockingGaps = d.gaps.filter((g) => g.blocking && isOpenGap(g)).length;
  const clientGaps = d.gaps.filter((g) => isOpenGap(g) && g.whoAnswers === "client").length;
  const assessNote = [...d.events].reverse().find(
    (e) => e.type === "note.added" && typeof e.payload.body === "string" && (e.payload.body as string).startsWith("סיכום Claude"),
  );
  const nodes = taskFlow?.nodes ?? [];
  const pending = nodes.filter((n) => !n.approved && n.active);
  const unsynced = nodes.filter((n) => n.approved && !n.linkedAdoId && n.active);
  const taskNodes = nodes.filter((n) => n.kind !== "check");
  const checkNodes = nodes.filter((n) => n.kind === "check");
  const unsyncedTasks = unsynced.filter((n) => n.kind !== "check").length;
  const unsyncedChecks = unsynced.filter((n) => n.kind === "check").length;
  const running = run?.state === "running";

  const done = isResearch
    ? [
        !!assessNote,
        !!assessNote && openGaps === 0,
        wi.phase === "done", // the one open-ended "work" step — checked only once actually closed
      ]
    : [
        !!assessNote,
        // EVERY gap must be closed before breakdown — not just the blocking
        // ones. An open question is an open question: deciding it later means
        // re-doing the task tree that was built on the wrong assumption.
        !!assessNote && openGaps === 0,
        nodes.length > 0,
        nodes.length > 0 && pending.length === 0 && unsynced.length === 0,
        wi.phase === "building" || wi.phase === "review" || wi.phase === "done",
      ];
  const unlocked = done.map((_, i) => i === 0 || done[i - 1] === true);
  const current = done.findIndex((x) => !x);
  const active = view ?? (current === -1 ? STEPS.length - 1 : current);

  /* ── data ───────────────────────────────────────────────────────── */
  const refreshRun = useCallback(async () => {
    try {
      const r = await getFlowRun(wi.id);
      setRun((prev) => {
        if (prev?.state === "running" && r.state !== "running" && r.state !== "idle") {
          reload();
          // `taskFlow` is fetched from its own endpoint, separate from `d`
          // — reload() alone leaves it stale after a breakdown run (a
          // fresh "פרק מחדש" replaces the task tree but the Flow/hierarchy
          // view kept showing the old one until a manual refresh).
          refreshTasks();
          // a finished run moves the flow on: drop any manually-pinned step
          // so the rail lands on what actually needs attention now — the
          // gaps if the check found any, the breakdown if it didn't.
          setView(null);
        }
        return r;
      });
    } catch { /* ignore */ }
  }, [wi.id, reload]);
  const refreshTasks = useCallback(async () => {
    try { setTaskFlow(await getTaskFlow(wi.id)); } catch { /* ignore */ }
  }, [wi.id]);

  useEffect(() => { refreshRun(); refreshTasks(); }, [refreshRun, refreshTasks]);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(refreshRun, 1500);
    return () => clearInterval(iv);
  }, [running, refreshRun]);
  useEffect(() => { if (assignOpen && users.length === 0) getUsers().then((r) => setUsers(r.users)).catch(() => {}); }, [assignOpen, users.length]);
  useEffect(() => { if (active === 4 && !build) startBuilding(wi.id).then(setBuild).catch((e) => setErr(String(e))); }, [active, build, wi.id]);
  useEffect(() => { getPrompts().then((r) => setAssessPrompts(r.items.filter((p) => p.key.startsWith("assess.readiness.")).sort((a, b) => a.sortOrder - b.sortOrder))).catch(() => {}); }, []);

  const copy = (t: string, k: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  const isCustom = assessPromptKey === "assess.readiness.custom";
  // Step 1 of the mandatory gate: fetch the exact prompt and open the
  // preview. Nothing has been sent to Claude yet.
  const kick = async (what: "assess" | "breakdown") => {
    setErr(null); setSendErr(null); setSendData(null); setPendingKick(what); setSendLoading(true);
    try {
      const r = what === "assess"
        ? await previewAssess(wi.id, assessPromptKey, isCustom ? assessCustomEmphasis : undefined)
        : await previewBreakdown(wi.id);
      setSendData({ prompt: r.prompt, promptHe: r.promptHe ?? "" });
    } catch (e) { setSendErr(String(e)); }
    finally { setSendLoading(false); }
  };
  // Step 2: only reachable from the modal's confirm button.
  const confirmKick = async () => {
    if (!pendingKick || sending) return;
    setSending(true); setErr(null);
    try {
      await (pendingKick === "assess"
        ? startAssess(wi.id, {
            promptKey: assessPromptKey,
            ...(isCustom ? { customEmphasis: assessCustomEmphasis, model: assessCustomModel } : {}),
          })
        : startBreakdown(wi.id, nodes.length > 0 ? rebreakdownReason : undefined));
      setPendingKick(null); setShowRerunOptions(false); setShowLog(true); setRebreakdownReason(""); await refreshRun();
    } catch (e) { setErr(String(e)); }
    finally { setSending(false); }
  };

  const doStop = async () => {
    if (stopping) return;
    setStopping(true);
    try { await stopFlowRun(wi.id); await refreshRun(); }
    catch (e) { setErr(String(e)); }
    finally { setStopping(false); }
  };
  const doSteer = async () => {
    const text = steerText.trim();
    if (!text || steerBusy) return;
    setSteerBusy(true);
    try { await sendRunMessage(wi.id, text); setSteerText(""); await refreshRun(); }
    catch (e) { setErr(String(e)); }
    finally { setSteerBusy(false); }
  };

  const openPreview = async (key: string) => {
    setPreviewKey(key); setPreviewData(null); setPreviewLoading(true); setPreviewLang("he");
    try { setPreviewData(await previewAssess(wi.id, key, isCustom && key === assessPromptKey ? assessCustomEmphasis : undefined)); }
    catch (e) { setErr(String(e)); }
    finally { setPreviewLoading(false); }
  };
  const doAssign = async () => {
    setErr(null);
    try {
      await assignRequirement(wi.id, assignTo ? { ownerId: assignTo } : { email: assignEmail.trim() });
      setAssignOpen(false); reload();
    } catch (e) { setErr(String(e)); }
  };
  const approve = async (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const e = edited[id] ?? { intent: n?.intent ?? "", appetite: n?.appetite ?? "standard", prompt: n?.prompt ?? "" };
    // Approval now cascades to the task's checks and tries to materialize
    // to TFS immediately — surface it if that second part didn't happen,
    // rather than silently leaving the task approved-but-not-really-ready.
    setApprovingId(id);
    try {
      const r = await approveTask(id, {
        clientId, intent: e.intent, appetite: e.appetite as "small" | "standard" | "large",
        ...(e.prompt !== undefined ? { prompt: e.prompt } : {}),
      });
      if (r.materializeError) setErr(r.materializeError);
      await refreshTasks(); reload();
    } finally { setApprovingId(null); }
  };
  // Deactivate/reactivate directly from the Flow popup — greys the card,
  // drops it from edges/dependency computation everywhere, cascades to
  // children, and (best-effort) mirrors "Removed" to a linked TFS item.
  const toggleActive = async (id: string, active: boolean) => {
    setTogglingActiveId(id); setErr(null);
    try { await setTaskActive(id, active, clientId); await refreshTasks(); reload(); }
    catch (e) { setErr(String(e)); }
    finally { setTogglingActiveId(null); }
  };
  const doMaterialize = async () => {
    setErr(null); setMaterializing(true);
    try { setMaterialized(await materializeTasks(wi.id)); await refreshTasks(); reload(); }
    catch (e) { setErr(String(e)); }
    setMaterializing(false);
  };

  const Err = () => (err ? <p style={{ color: "var(--status-critical)", fontSize: 12.5, marginTop: 10, whiteSpace: "pre-wrap" }}>{err}</p> : null);

  const lastRunLink = run && (run.state === "done" || run.state === "error" || run.state === "stopped") && run.lines.length > 0 && (
    <a style={{ fontSize: 12, color: "#584EF3", fontWeight: 700, cursor: "pointer" }} onClick={() => setShowLog((v) => !v)}>
      {showLog ? "▲ הסתר" : "▾ הצג"} מה עשה Claude בהרצה האחרונה ({run.kind === "breakdown" ? "פירוק" : run.kind === "implement" ? "פיתוח" : "הערכה"}{run.state === "error" ? " — נכשלה" : run.state === "stopped" ? " — נעצר" : ""})
    </a>
  );

  // shared between "first run" and "re-run with different settings" — same
  // tier/model picker either way, so changing depth or model before a
  // re-run (e.g. after editing the requirement) doesn't need its own UI.
  const tierPicker = (
    <div style={{ background: "var(--surface-muted)", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 650, color: "var(--ov-label)", display: "block", marginBottom: 6 }}>מה אתה מצפה מהבדיקה?<Info k="assessment_depth" /></label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {assessPrompts.map((p) => (
          <div key={p.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: 1 }}>
                <input type="radio" style={{ minWidth: 0 }} checked={assessPromptKey === p.key} onChange={() => setAssessPromptKey(p.key)} />
                <span>{p.title.replace(/^בחינת בשלות — /, "")} <span style={{ color: "var(--ink-400)" }}>({p.defaultModel ? p.defaultModel[0]!.toUpperCase() + p.defaultModel.slice(1) : "בחירה"})</span></span>
              </label>
              <a style={{ fontSize: 11, color: "var(--color-accent)", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => openPreview(p.key)}>👁 תצוגה מקדימה</a>
            </div>
            {p.description && <p style={{ fontSize: 11, color: "var(--ink-400)", margin: "1px 0 0 24px" }}>{p.description}</p>}
          </div>
        ))}
      </div>
      {isCustom && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-hairline)" }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>דגש מיוחד לבדיקה הזו<Info k="prompt_emphasis" /></label>
            <textarea value={assessCustomEmphasis} onChange={(e) => setAssessCustomEmphasis(e.target.value)} rows={2} placeholder="למשל: תשים לב במיוחד להשפעה על מודול X" />
          </div>
          <div className="field">
            <label>מודל (חובה לבחור)<Info k="model_effort" /></label>
            <select value={assessCustomModel} onChange={(e) => setAssessCustomModel(e.target.value)}>
              <option value="">— בחר —</option>
              <option value="sonnet">Sonnet — מאוזן</option>
              <option value="opus">Opus — יסודי יותר, איטי ויקר יותר</option>
              <option value="haiku">Haiku — מהיר וזול, לבדיקות פשוטות</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="ov-card" style={{ overflow: "hidden" }}>
      {pendingKick && (
        <PromptPreviewModal
          title={pendingKick === "assess" ? "הרצת בחינת בשלות" : "הרצת פירוק למשימות"}
          data={sendData} loading={sendLoading} error={sendErr}
          onClose={() => { setPendingKick(null); setSendData(null); setSendErr(null); setRebreakdownReason(""); }}
          onConfirm={confirmKick} confirming={sending}
          confirmLabel={pendingKick === "assess" ? "✦ שלח ל-Claude, הרץ בחינה" : "✦ שלח ל-Claude, פרק למשימות"}
          reasonField={pendingKick === "breakdown" && nodes.length > 0
            ? { label: "למה מפרקים מחדש? (יישמר בהיסטוריית הדרישה)", value: rebreakdownReason, onChange: setRebreakdownReason }
            : undefined}
        />
      )}
      {previewKey && (
        <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setPreviewKey(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(760px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)",
            border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl", textAlign: "start",
            boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <CardTitle as="h3" info="prompt_preview" style={{ fontSize: 15, fontWeight: 700 }}>{previewData?.templateTitle ?? "תצוגה מקדימה"}</CardTitle>
              <a onClick={() => setPreviewKey(null)} style={{
                fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex",
                alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)",
              }}>✕</a>
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>
              זה בדיוק מה שיישלח ל-Claude (הפרומפט האמיתי תמיד רץ באנגלית — התצוגה בעברית היא תרגום לנוחות הקריאה בלבד).
            </p>
            {previewLoading ? (
              <div className="spin">טוען…</div>
            ) : previewData ? (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                  <button className={`btn btn-sm ${previewLang === "he" ? "btn-primary" : "btn-secondary"}`} onClick={() => setPreviewLang("he")}>עברית</button>
                  {previewData.promptHe && <CopyBtn text={previewData.promptHe} />}
                  <button className={`btn btn-sm ${previewLang === "en" ? "btn-primary" : "btn-secondary"}`} onClick={() => setPreviewLang("en")}>English</button>
                  <CopyBtn text={previewData.prompt} />
                  {previewData.model && <Pill tone="neutral">מודל: {previewData.model}</Pill>}
                </div>
                <pre style={{
                  whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.7, fontFamily: previewLang === "en" ? "var(--mono)" : "inherit",
                  direction: previewLang === "en" ? "ltr" : "rtl", textAlign: previewLang === "en" ? "left" : "start",
                  background: "var(--surface-muted)", borderRadius: 10, padding: 14, margin: 0,
                }}>
                  {(previewLang === "he" ? previewData.promptHe : previewData.prompt) ?? "(אין תרגום לעברית לפרומפט הזה)"}
                </pre>
              </>
            ) : null}
          </div>
        </div>
      )}
      <StepRail steps={STEPS} done={done} unlocked={unlocked} active={running ? (run?.kind === "breakdown" ? 2 : 0) : active} onPick={(i) => { if (unlocked[i] && !running) { setView(i); setErr(null); } }} busy={running} />
      {/* the last-run link/transcript belongs to the step that produced it
          — an assess run's log has no business showing while looking at
          gaps or breakdown, and vice versa. */}
      {(() => {
        const runStep = run?.kind === "breakdown" ? 2 : 0;
        if (!run || active !== runStep) return null;
        return (
          <>
            {lastRunLink && <div style={{ padding: "10px 16px 0" }}>{lastRunLink}</div>}
            {showLog && !running && <div style={{ padding: "8px 16px 0" }}><Transcript lines={run.lines} />{run.state === "error" && run.error && <p style={{ fontSize: 12, color: "var(--status-critical)", marginTop: 6 }}>{run.error}</p>}</div>}
          </>
        );
      })()}
      <div className="ov-divider" />
      <div className="ov-panel">
        {running ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div className="spinner" style={{ width: 16, height: 16 }} />
              <p style={{ fontSize: 13, color: "var(--ov-body)", margin: 0, fontWeight: 600, flex: 1 }}>
                {run?.kind === "breakdown" ? "Claude מפרק את הדרישה למשימות…" : run?.kind === "implement" ? "Claude מפתח את המשימה…" : "Claude קורא את הדרישה ואת ה-repo, מסכם ומעריך…"}
              </p>
              <button className="btn btn-secondary btn-sm" disabled={stopping} style={{ color: "var(--status-critical)" }} onClick={doStop}>
                {stopping ? "עוצר…" : "⏹ עצור"}
              </button>
            </div>
            <Transcript lines={run?.lines ?? []} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={steerText} onChange={(e) => setSteerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSteer(); } }}
                placeholder="הוסף מלל ל-Claude על מה שהוא עושה כרגע — הוא ימשיך במשימה אבל יתייחס גם לזה…"
                disabled={steerBusy}
                style={{ flex: 1, fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }}
              />
              <button className="btn btn-secondary btn-sm" disabled={!steerText.trim() || steerBusy} onClick={doSteer}>{steerBusy ? "שולח…" : "➤ הוסף"}</button>
            </div>
            <p style={{ marginTop: 8, fontSize: 11, color: "var(--ov-label)" }}>
              רץ ברקע עם הרישוי שלך. אפשר לצאת מהמסך — כשתחזור זה יהיה כאן, כולל כל מה ש-Claude עשה.
            </p>
          </div>
        ) : (
          <>
            {/* ── 1. assess ─────────────────────────────────────── */}
            {active === 0 && (
              assessNote ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <CardTitle as="h3" info="assess_result" style={{ fontSize: 14.5, fontWeight: 700, color: "#1B1741" }}>מה Claude הבין ומה הוא חושב</CardTitle>
                    <div style={{ display: "flex", gap: 12 }}>
                      <a style={{ fontSize: 11.5, color: "#584EF3", fontWeight: 600, cursor: "pointer" }} onClick={() => kick("assess")}>🔁 הרץ שוב, אותן הגדרות</a>
                      <a style={{ fontSize: 11.5, color: "var(--color-accent)", cursor: "pointer" }} onClick={() => setShowRerunOptions((v) => !v)}>{showRerunOptions ? "✕ סגור" : "⚙ עומק / מודל אחר"}</a>
                    </div>
                  </div>
                  {showRerunOptions && (
                    <div style={{ marginBottom: 14 }}>
                      <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginBottom: 8 }}>
                        אם ערכת את הדרישה בינתיים, ההרצה החדשה תקרא את הנוסח המעודכן — אין צורך לעשות עוד משהו.
                      </p>
                      {tierPicker}
                      <button className="btn btn-primary btn-sm" disabled={isCustom && !assessCustomModel} onClick={() => { setShowRerunOptions(false); kick("assess"); }}>הרץ הערכה</button>
                      <Info k="assess" />
                    </div>
                  )}
                  {/* rendered line-by-line, not as one pre-wrap blob: bullets
                      become a real list and headings get their own weight, so a
                      busy reader can scan it instead of parsing a paragraph. */}
                  <div style={{ fontSize: 13, color: "var(--ov-body)", lineHeight: 1.75 }}>
                    {(assessNote.payload.body as string)
                      .replace(/^סיכום Claude:\s*/, "")
                      .split("\n")
                      .map((ln, i) => {
                        const t = ln.trim();
                        if (!t) return <div key={i} style={{ height: 8 }} />;
                        if (t.startsWith("•")) return (
                          <div key={i} style={{ display: "flex", gap: 7, marginBottom: 3 }}>
                            <span style={{ color: "var(--color-accent)", flexShrink: 0 }}>•</span>
                            <span>{t.replace(/^•\s*/, "")}</span>
                          </div>
                        );
                        if (t.endsWith(":") || t.startsWith("הערכה:")) return (
                          <div key={i} style={{ fontWeight: 700, color: "#1B1741", marginTop: i ? 6 : 0, marginBottom: 3 }}>{t}</div>
                        );
                        return <div key={i} style={{ marginBottom: 3 }}>{t}</div>;
                      })}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {/* ground truth is the actual open-gap count, never the
                        model's own freeform claim — the two must never say
                        different things to the reader. */}
                    {done[1]
                      ? <Pill tone="healthy">אפויה — מוכנה לפירוק</Pill>
                      : <Pill tone="warning">{openGaps > 0 ? `${openGaps} שאלות פתוחות — צריך להכריע לפני פירוק` : "לא אפויה — צריך הכרעה בפערים"}</Pill>}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    {done[1]
                      ? <button className="btn btn-primary btn-sm" onClick={() => setView(2)}>לפירוק למשימות ←</button>
                      : <button className="btn btn-primary btn-sm" onClick={() => setView(1)}>לשלב הפערים ←</button>}
                  </div>
                  <Err />
                </div>
              ) : (
                <div>
                  <CardTitle as="h3" info="how_to_continue" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: "#1B1741" }}>איך ממשיכים?</CardTitle>
                  <p style={{ fontSize: 12.5, color: "#6b6d8c", marginBottom: 14 }}>
                    הדרישה קיימת רק כאן ב-DCC. Claude יקרא אותה ואת ה-repo ויגיד אם היא אפויה מספיק לפירוק.
                  </p>

                  {tierPicker}

                  <div style={{ display: "grid", gap: 10 }}>
                    <button className="btn btn-primary" disabled={isCustom && !assessCustomModel} style={{ padding: 14, textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 3 }} onClick={() => kick("assess")}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>✦ המשך עם AI</span>
                      <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>מסכם בעברית, בודק אפייה ומזהה פערים. רץ ברקע.</span>
                    </button>
                    <button className="btn btn-secondary" style={{ padding: 14, textAlign: "start", flexDirection: "column", alignItems: "flex-start", height: "auto", gap: 3 }} onClick={() => setAssignOpen((v) => !v)}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>👤 העבר למשתמש אחר</span>
                      <span style={{ fontSize: 12, color: "#6b6d8c", fontWeight: 400 }}>מישהו אחר ייקח את הדרישה מכאן</span>
                    </button>
                  </div>
                  {assignOpen && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #EAE8F5" }}>
                      <div className="field" style={{ marginBottom: 10 }}>
                        {/* no-info: pick a person already in the system */}<label>משתמש קיים</label>
                        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                          <option value="">— בחר —</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ marginBottom: 10 }}>
                        {/* no-info: the alternative to the field above it */}<label>או אימייל חדש</label>
                        <input value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="name@altshuler.co.il" dir="ltr" style={{ width: "100%" }} />
                      </div>
                      <button className="btn btn-primary btn-sm" disabled={!assignTo && !assignEmail.trim()} onClick={doAssign}>העבר</button>
                    </div>
                  )}
                  <Err />
                </div>
              )
            )}

            {/* ── 2. gaps ───────────────────────────────────────── */}
            {active === 1 && (
              <div>
                {openGaps > 0 ? (
                  <p style={{ fontSize: 13, marginBottom: 14, color: "#1B1741", fontWeight: 500 }}>
                    <b>{openGaps} שאלות פתוחות</b>{openBlockingGaps > 0 ? ` (${openBlockingGaps} מהן דחופות)` : ""} — צריך לסגור את כולן לפני פירוק למשימות.
                    {clientGaps > 0 && <> מתוכן <b>{clientGaps}</b> דורשות תשובה ממבקש הדרישה — אפשר לנסח לו אותן בכפתור למטה.</>}
                  </p>
                ) : (
                  <p style={{ fontSize: 13, marginBottom: 14, color: "#1B1741", fontWeight: 500 }}>כל השאלות נסגרו — אפשר להתקדם.</p>
                )}
                {done[1] && <div style={{ marginBottom: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setView(2)}>{isResearch ? "לעבודה ←" : "לפירוק למשימות ←"}</button></div>}
                {gapsPanel}
              </div>
            )}

            {/* ── 3. research/testing work (no breakdown at all) ── */}
            {isResearch && active === 2 && (
              <div>
                <CardTitle as="h3" info="research_work" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: "#1B1741" }}>
                  {wi.requirementType === "testing" ? "עבודת בדיקות" : "עבודת תחקור"}
                </CardTitle>
                <p style={{ fontSize: 12.5, color: "#6b6d8c", marginBottom: 12 }}>
                  {wi.requirementType === "testing"
                    ? "אין פירוק למשימות פיתוח — התוצאה היא תוצאת האימות עצמה. משימת מעקב אחת ב-TFS עוקבת אחרי העבודה."
                    : "אין פירוק למשימות פיתוח — התוצאה היא ממצאים/מסקנות, לא קוד. משימת מעקב אחת ב-TFS עוקבת אחרי העבודה."}
                </p>
                {researchErr && <p style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{researchErr}</p>}

                {nodes.length === 0 ? (
                  <button className="btn btn-primary btn-sm" disabled={researchBusy} onClick={async () => {
                    setResearchBusy(true); setResearchErr(null);
                    try { await startResearchWork(wi.id); await refreshTasks(); reload(); }
                    catch (e) { setResearchErr(String(e)); }
                    finally { setResearchBusy(false); }
                  }}>{researchBusy ? "פותח…" : "פתח משימת מעקב ב-TFS"}</button>
                ) : (
                  <>
                    {taskFlow && (
                      <TaskGraph flow={taskFlow} height={220} nav={nav} title="משימת המעקב" workitemId={wi.id} />
                    )}
                    <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setResearchNoteOpen(true)}>+ הוסף ממצא</button>
                    </div>
                    {researchNoteOpen && <AddNote workitemId={wi.id} onClose={() => setResearchNoteOpen(false)} onDone={() => { setResearchNoteOpen(false); reload(); }} />}

                    {wi.phase !== "done" ? (
                      <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #EAE8F5" }}>
                        <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 6 }}>
                          {wi.requirementType === "testing" ? "תוצאת בדיקה" : "מסקנות תחקור"} — נדרש לפני סיום<Info k="research_work" />
                        </label>
                        <textarea value={researchConclusion} onChange={(e) => setResearchConclusion(e.target.value)} rows={3}
                                  placeholder={wi.requirementType === "testing" ? "מה נבדק, ומה התוצאה" : "מה נמצא, ומה המשמעות"}
                                  style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8, marginBottom: 8 }} />
                        <button className="btn btn-primary btn-sm" disabled={researchBusy || !researchConclusion.trim()} onClick={async () => {
                          setResearchBusy(true); setResearchErr(null);
                          try { await finishResearchWork(wi.id, researchConclusion.trim()); setResearchConclusion(""); reload(); }
                          catch (e) { setResearchErr(String(e)); }
                          finally { setResearchBusy(false); }
                        }}>{researchBusy ? "מסיים…" : (wi.requirementType === "testing" ? "✓ סיום בדיקות" : "✓ סיום תחקור")}</button>
                      </div>
                    ) : (
                      <p style={{ fontSize: 13, color: "var(--status-healthy)", fontWeight: 600, marginTop: 14 }}>✓ הדרישה הושלמה.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── 3. breakdown ──────────────────────────────────── */}
            {!isResearch && active === 2 && (
              <div>
                <CardTitle as="h3" info="breakdown" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: "#1B1741" }}>פירוק למשימות</CardTitle>
                <p style={{ fontSize: 12.5, color: "#6b6d8c", marginBottom: 12 }}>
                  Claude יפרק את הדרישה להיררכיה של משימות עם תלויות. <b>עומק ההיררכיה קובע את הטיפוסים ב-TFS</b> ({ADO_LADDER.join(" › ")}).
                </p>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => kick("breakdown")}>{nodes.length > 0 ? "פרק מחדש" : "פרק למשימות"}</button>
                  <Info k="breakdown" />
                  {nodes.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setView(3)}>לאישור המשימות ←</button>}
                </div>
                <Err />
                {taskFlow && nodes.length > 0 && (
                  <TaskGraph
                    flow={taskFlow} nav={nav}
                    title="ההיררכיה שהוצעה"
                    subtitle={`עומק ${taskFlow.depth} (${ADO_LADDER.slice(ADO_LADDER.length - taskFlow.depth).join(" › ")})`}
                    onApprove={approve} approvingId={approvingId}
                    onToggleActive={toggleActive} togglingActiveId={togglingActiveId}
                    workitemId={wi.id}
                  />
                )}
              </div>
            )}

            {/* ── 4. approve + materialize ──────────────────────── */}
            {active === 3 && taskFlow && (
              <div>
                {approveModalOpen && (
                  <ApproveTasksModal
                    nodes={nodes}
                    onApprove={approve}
                    onClose={() => setApproveModalOpen(false)}
                  />
                )}
                <CardTitle as="h3" info="materialize" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: "#1B1741" }}>אישור יצירת משימות ב-TFS</CardTitle>
                <p style={{ fontSize: 12.5, color: "#6b6d8c", marginBottom: 4 }}>
                  {pending.length > 0
                    ? `${pending.length} מתוך ${nodes.length} ממתינות לאישור שלך. אחרי שהכל מאושר — ההקמה ב-TFS.`
                    : unsynced.length > 0
                      ? `כל ${nodes.length} מאושרות. אפשר להקים אותן.`
                      : `הכל מוקם.`}
                </p>
                {checkNodes.length > 0 && (
                  <p style={{ fontSize: 11.5, color: "var(--ov-label)", marginBottom: 10 }}>
                    {taskNodes.length} מתוכן הן משימות אמיתיות שיהפכו ל-work item ב-TFS. {checkNodes.length} הן בדיקות/וידוא — לא הופכות ל-work item בפני עצמן, אלא מתועדות כרשימת בדיקה בתוך ה-Discussion של המשימה שהן שייכות לה.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  {pending.length > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => setApproveModalOpen(true)}>
                      ✓ אישור משימות ליצירה ב-TFS
                    </button>
                  )}
                  {pending.length === 0 && unsynced.length > 0 && (
                    <button className="btn btn-primary btn-sm" disabled={materializing} onClick={doMaterialize}>
                      {materializing ? "מקים ב-TFS…" : (
                        unsyncedTasks && unsyncedChecks
                          ? `הקם ${unsyncedTasks} משימות + תעד ${unsyncedChecks} בדיקות`
                          : unsyncedTasks
                            ? `הקם ${unsyncedTasks} משימות ב-TFS`
                            : `תעד ${unsyncedChecks} בדיקות ב-Discussion`
                      )}
                    </button>
                  )}
                  {unsynced.length === 0 && nodes.length > 0 && (
                    <button className="btn btn-primary btn-sm" onClick={() => setView(4)}>להתחלת עבודה ←</button>
                  )}
                </div>
                {materialized && <p style={{ fontSize: 12, color: "var(--status-healthy)", marginTop: -8, marginBottom: 12 }}>{materialized.detail}</p>}
                <Err />

                <TaskGraph
                  flow={taskFlow} height={340} nav={nav}
                  title="ההיררכיה"
                  subtitle={`עומק ${taskFlow.depth} (${ADO_LADDER.slice(ADO_LADDER.length - taskFlow.depth).join(" › ")})`}
                  onApprove={approve} approvingId={approvingId}
                  onToggleActive={toggleActive} togglingActiveId={togglingActiveId}
                  workitemId={wi.id}
                />

                <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                  {[...nodes].sort((a, b) => a.level - b.level || a.seq - b.seq).map((n) => {
                    const e = edited[n.id] ?? { intent: n.intent, appetite: n.appetite, prompt: n.prompt ?? "" };
                    return (
                      <div key={n.id} style={{
                        border: `1px solid ${n.approved ? "#EAE8F5" : "#e6b450"}`,
                        borderRadius: 10, padding: "10px 12px", background: "#fff",
                        marginInlineStart: n.level * 22, opacity: n.active ? 1 : 0.55,
                      }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ov-label)" }}>#{n.seq}</span>
                          {n.kind === "check"
                            ? <Pill tone="neutral">✓ בדיקה</Pill>
                            : <Pill tone={n.adoType === "Task" ? "inactive" : "ai"}>{n.adoType ?? "Task"}</Pill>}
                          {!n.active && <Pill tone="inactive">⚪ לא פעיל</Pill>}
                          {n.linkedAdoId
                            ? (n.kind === "check"
                                ? <a href={n.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--status-healthy)" }}>תועד ב-Discussion ↗</a>
                                : <a href={n.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--status-healthy)" }}>TFS #{n.linkedAdoId} ↗</a>)
                            : n.approved ? <Pill tone="healthy">מאושר</Pill> : <Pill tone="warning">ממתין לאישור הקמה</Pill>}
                          <span className="spacer" />
                          <button className="btn btn-secondary btn-sm" disabled={togglingActiveId === n.id} onClick={() => toggleActive(n.id, !n.active)}>
                            {togglingActiveId === n.id ? "מעדכן…" : n.active ? "◻ השבת" : "☐ הפעל מחדש"}
                          </button>
                        </div>
                        {n.linkedAdoId ? (
                          <>
                            <div style={{ fontSize: 12.5, marginBottom: 6 }}>{n.intent}</div>
                            {n.kind !== "check" && (
                              <a style={{ fontSize: 11.5, color: "#584EF3", fontWeight: 600, cursor: "pointer" }} onClick={() => nav(`#/task/${n.id}`)}>פתח את המשימה ותן ל-Claude לפתח ←</a>
                            )}
                          </>
                        ) : (
                          <>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                              <input value={e.intent} onChange={(ev) => setEdited({ ...edited, [n.id]: { ...e, intent: ev.target.value } })} style={{ flex: 1, fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--border-hairline)", borderRadius: 6 }} />
                              <select value={e.appetite} onChange={(ev) => setEdited({ ...edited, [n.id]: { ...e, appetite: ev.target.value } })} style={{ fontSize: 12 }}>
                                <option value="small">small</option><option value="standard">standard</option><option value="large">large</option>
                              </select>
                            </div>
                            <div className="field" style={{ marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <label style={{ margin: 0 }}>{n.kind === "check" ? "מה בדיוק צריך לוודא/לבדוק" : "הפרומט ש-Claude יריץ למשימה הזו"}</label>
                                {e.prompt && <CopyBtn text={e.prompt} />}
                              </div>
                              <textarea
                                value={e.prompt} rows={n.kind === "check" ? 3 : 5}
                                onChange={(ev) => setEdited({ ...edited, [n.id]: { ...e, prompt: ev.target.value } })}
                                placeholder={n.kind === "check" ? "מה לבדוק/לוודא/לתעד לפני שהמשימה ההורה נחשבת גמורה" : "ההוראה המדויקת שתימסר ל-Claude כשתלחץ &quot;תן ל-Claude לפתח&quot; על המשימה"}
                                style={{ width: "100%", fontSize: 12, lineHeight: 1.6, padding: "8px 10px", border: "1px solid var(--border-hairline)", borderRadius: 7, resize: "vertical" }}
                              />
                              <span className="hint" style={{ fontSize: 10.5, color: "var(--ink-400)" }}>
                                {n.kind === "check" ? "יתועד כשורה ברשימת הבדיקה על המשימה ההורה ב-TFS." : "נשמר עם האישור. זה מה שירוץ — כדאי לקרוא אותו."}
                              </span>
                            </div>
                            {n.affectedPaths.length > 0 && (
                              <div style={{ fontSize: 11, color: "var(--ov-label)", marginBottom: n.compiledComponents.length ? 2 : 8 }} dir="ltr">{n.affectedPaths.join(", ")}</div>
                            )}
                            {n.compiledComponents.length > 0 && (
                              <div style={{ fontSize: 10.5, color: "var(--ink-400)", marginBottom: 8 }} dir="ltr">מתקמפל ב: {n.compiledComponents.join(", ")}</div>
                            )}
                            <div style={{ display: "flex", gap: 8 }}>
                              {!n.approved && <button className="btn btn-primary btn-sm" disabled={approvingId === n.id} onClick={() => approve(n.id)}>{approvingId === n.id ? "מאשר…" : n.kind === "check" ? "✓ אישור הקמת בדיקה" : "✓ אישור הקמת משימה ב-TFS"}</button>}
                              {n.approved && <button className="btn btn-secondary btn-sm" disabled={approvingId === n.id} onClick={() => approve(n.id)}>שמור שינוי</button>}
                              <button className="btn btn-secondary btn-sm" onClick={async () => { await rejectTask(n.id, clientId); await refreshTasks(); reload(); }}>דחה</button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

              </div>
            )}

            {/* ── 5. start ──────────────────────────────────────── */}
            {active === 4 && (
              <div>
                <CardTitle as="h3" info="start" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6, color: "#1B1741" }}>מתחילים לעבוד</CardTitle>
                {!build ? <div className="spin">מכין…</div> : (
                  <>
                    <p style={{ fontSize: 12.5, color: "#6b6d8c", marginBottom: 14 }}>פותחים branch לפי המוסכמה ומריצים Claude Code בתוך ה-repo.</p>
                    {build.startedWithOpenBlocker && <div className="callout crit" style={{ marginBottom: 12 }}><div className="body"><p className="r">יש {build.openBlockingGaps} פערים דחופים / {build.openBlockers} חוסמים (Blocker) פתוחים.</p></div></div>}
                    {(["key", "branch"] as const).map((k) => (
                      <div key={k} style={{ marginBottom: 10 }}>
                        <label style={{ display: "block", fontSize: 11, color: "var(--ov-label)", marginBottom: 4 }}>{k === "key" ? "מפתח" : "branch"}</label>
                        <div className="ov-field">
                          <span className="v">{build[k]}</span>
                          <a className="copy" onClick={() => copy(build[k], k)}>{copied === k ? "✓" : "העתק"}</a>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: "block", fontSize: 11, color: "var(--ov-label)", marginBottom: 4 }}>repository<Info k="repository" /></label>
                      {build.repos.length === 0
                        ? <p style={{ fontSize: 12, color: "var(--status-critical)" }}>אין repository מקושר.</p>
                        : build.repos.map((r) => <div key={r.name} style={{ fontSize: 12.5, direction: "ltr", textAlign: "left" }}>{r.name}{r.adoRepoRef ? ` — ${r.adoRepoRef}` : ""}</div>)}
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--ov-label)", marginBottom: 4 }}>הפקודה<Info k="start_command" /></label>
                      <div className="ov-code">{`git checkout -b ${build.branch}\nclaude`}</div>
                      <span style={{ display: "block", fontSize: 11, color: "var(--ov-label)", marginTop: 6 }}>ה-SessionStart hook יטען את ה-Context Brief אוטומטית.</span>
                    </div>
                    <Err />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── the step rail ─────────────────────────────────────────────────── */

export function StepRail({ steps, done, unlocked, active, onPick, busy, liveIndex }: {
  steps: readonly { key: string; label: string; description?: string }[];
  done: boolean[]; unlocked: boolean[]; active: number;
  onPick: (i: number) => void; busy?: boolean;
  /** Index of the step that's genuinely executing/waiting right now —
   *  distinct from `active` (whichever step the person is currently
   *  LOOKING at, which they can freely change by clicking around). When
   *  they differ, a small dot marks the live one so it's never lost while
   *  browsing other steps. */
  liveIndex?: number;
}) {
  return (
    <div className="ov-steps">
      <span className="ov-steps-info"><Info k="workflow_steps" /></span>
      {steps.map((s, i) => {
        const isDone = done[i] === true;
        const open = unlocked[i] === true;
        const isActive = i === active;
        const isLive = liveIndex !== undefined && i === liveIndex;
        return (
          <Fragment key={s.key}>
            {i > 0 && <span className="ov-arrow">←</span>}
            <button
              className={`ov-step${isActive ? " active" : ""}`}
              onClick={() => onPick(i)}
              disabled={!open || busy}
              title={!open ? "נעול עד שהשלב הקודם יסתיים" : s.description}
            >
              <div className="n">
                {isDone && <span className="ok">✓</span>}
                {isLive && !isActive && <span title="השלב הפעיל כרגע" style={{ color: "var(--color-accent)" }}>●</span>}
                <span>שלב {i + 1}</span>
              </div>
              <div className="lbl">{s.label}</div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

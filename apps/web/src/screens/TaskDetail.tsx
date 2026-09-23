import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  getTask, getTaskRun, getTaskBuiltOn, implementTask, previewImplement, addE2ECheck, progressTask, editTask, rollbackTask, pushTask, getTaskCodeMap, type CodeMap,
  precheckTaskDelete, deleteTask, DeleteBlocked, approveTask, ChecksNotPassed, setTaskActive, checkAdoRecheck,
  type FlowRun, type ImplementResult, type TaskBuiltOn, type TaskDetail as TD, type TaskDeletePrecheck, type TaskFlowStep,
} from "../api.ts";
import { CardTitle, PageHead, Pill, PromptPreviewModal, PromptText, TaskStatusPill, DependencyTagPill, CHECK_KIND_HE } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { CodeMapPanel } from "../components/CodeMap.tsx";
import { useClaudeContext } from "../claude/context.ts";

/**
 * One task — the unit that actually reaches TFS and gets built. Its status in
 * the head's corner, with the dependency tag under it; its FLOW (task-flow-steps.ts):
 * development with the build, checks, review — and a dependency step wherever
 * a dependency's work came in after the task started. "תן ל-Claude לפתח" runs
 * the local CLI with write tools on an ISOLATED clone, on a task branch, and
 * commits locally; it never pushes on its own — "⬆ Push ל-GitHub" is the
 * deliberate action in the review step.
 */

const STATE_HE: Record<string, string> = {
  pending: "ממתין", in_progress: "בעבודה", blocked: "חסום", failed_checks: "נפל בבדיקות", done: "הושלם", dropped: "נדחה",
};

const Transcript = ({ lines }: { lines: string[] }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [lines.length]);
  return (
    <div ref={box} style={{ maxHeight: "44vh", overflowY: "auto", background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.6 }}>
      {lines.length === 0
        ? <span style={{ color: "var(--ink-400)" }}>מתחיל…</span>
        : lines.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("💭") ? "var(--ink-500)" : "var(--ink-800)", whiteSpace: "pre-wrap", marginBottom: 3 }}>{l}</div>
          ))}
    </div>
  );
};

const depName = (x: { seq: number; intent: string }) => `#${x.seq} — ${x.intent.slice(0, 70)}`;
const refs = (xs: number[] = []) => xs.map((s) => `#${s}`).join(", ");
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : "");

/**
 * What the task's branch is built on, when it depends on work that is not in
 * the main branch yet. Before the first run: what it will be built on and what
 * it will be developed without. After: what it was built on, and when it is
 * worth developing again — the one way to take that in is Rollback and run again.
 */
function BuiltOnCard({ b, nav }: { b: TaskBuiltOn; nav: (h: string) => void }) {
  const link = (x: { id: string; seq: number; intent: string }) => <span key={x.id} className="w-title" onClick={() => nav(`#/task/${x.id}`)}>{depName(x)}</span>;
  const planned = b.state === "planned";
  return (
    <div style={{ borderTop: "1px solid var(--border-hairline)", marginTop: 10, paddingTop: 10 }}>
      <CardTitle info="task_built_on" style={{ fontSize: 12.5, marginBottom: 6 }}>{planned ? "על מה המשימה תיבנה" : "על מה המשימה נבנתה"}</CardTitle>
      {b.on && (
        <p style={{ fontSize: 12.5, marginBottom: 6 }}>
          {planned ? "כשתפתחו אותה, היא תיבנה על גבי הענף של " : "נבנתה על גבי הענף של "}{link(b.on)}
          {planned ? `. העבודה של #${b.on.seq} עוד לא בענף הראשי — קלוד יראה אותה ויבנה עליה.` : "."}
        </p>
      )}
      {b.onMoved && b.on && (
        <p style={{ fontSize: 12.5, color: "var(--status-warning)", marginBottom: 6 }}>
          ⚠ ל-#{b.on.seq} נוספו שינויים אחרי שהמשימה הזו נבנתה, והם לא בענף שלה. כדי לכלול אותם: שלב "תלות" למטה.
        </p>
      )}
      {b.missing.length > 0 && (
        <>
          <p style={{ fontSize: 12.5, marginBottom: 4 }}>{planned ? "תפותח בלי העבודה של:" : "פותחה בלי העבודה של:"}</p>
          <ul style={{ margin: "0 0 6px", paddingInlineStart: 18, fontSize: 12.5 }}>
            {b.missing.map((m) => (
              <li key={m.id} style={{ marginBottom: 3 }}>
                {link(m)}
                <span style={{ color: "var(--ink-400)" }}> — {m.why === "parallel" ? "פותחה בנפרד מהענף שהמשימה נבנית עליו; אי אפשר לבנות על שתיהן בלי למזג אותן קודם" : m.why === "not_developed" ? "עוד לא פותחה" : "לא הייתה בענף כשהמשימה נבנתה"}</span>
              </li>
            ))}
          </ul>
          {planned && (
            <p style={{ fontSize: 11.5, color: "var(--ink-500)" }}>
              אפשר לפתח בכל זאת: קלוד יכתוב מול הצורה שהעבודה החסרה כנראה תקבל ויפרט את ההנחות שלו. בדיקה שצריכה אותה תסומן "מחכה לתלות", לא "נכשלה". כשהתלות תפותח, ייכנס שלב "תלות" שבונה את המשימה עליה.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const Card = ({ children, tone }: { children: React.ReactNode; tone?: "crit" | "ok" }) => (
  <div style={{
    border: `1px solid ${tone === "crit" ? "var(--status-critical)" : tone === "ok" ? "var(--status-healthy)" : "var(--border-hairline)"}`,
    borderRadius: 12, padding: "14px 16px", marginBottom: 14, background: "var(--surface)",
  }}>{children}</div>
);

/** A folded part of a step: its title always there, its content one click away. */
function Fold({ title, info, children, open: startOpen = false }: { title: string; info: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}>
        <button type="button" className="fold-btn" style={{ marginTop: 0, flex: 1 }} onClick={() => setOpen((v) => !v)}>
          <span>{open ? "▾" : "▸"}</span>{title}
        </button>
        <Info k={info} />
      </div>
      {open && <div style={{ padding: "10px 4px 2px" }}>{children}</div>}
    </>
  );
}

const STEP_NUM: Record<TaskFlowStep["kind"], string> = { develop: "שלב 1", dependency: "תלות", checks: "שלב 2", review: "שלב 3" };
function stepLabel(steps: TaskFlowStep[], i: number): string {
  const s = steps[i]!;
  const again = steps.slice(0, i).some((p) => p.kind === s.kind);
  if (s.kind === "develop") return "פיתוח (כולל Build)";
  if (s.kind === "dependency") return s.state === "current" ? `${refs(s.deps)} פותחה` : `נבנתה על ${refs(s.deps)}`;
  if (s.kind === "checks") return again ? "בדיקות שוב" : "בדיקות";
  return again ? "סקירה שוב" : "סקירה והחלטה";
}

/** The task's FLOW — the real StepRail look (.ov-steps), with steps that repeat after a dependency came in. */
function TaskFlowRail({ steps, active, onPick }: { steps: TaskFlowStep[]; active: number; onPick: (i: number) => void }) {
  return (
    <div className="ov-steps" style={{ paddingBottom: 2 }}>
      <span className="ov-steps-info"><Info k="task_flow_steps" /></span>
      {steps.map((s, i) => {
        const mark = s.state === "done" ? <span className="ok">✓</span>
          : s.state === "failed" ? <span className="bad">✕</span>
          : s.state === "waiting" ? <span className="wait">⏸</span>
          : s.state === "current" ? <span className="now">●</span> : null;
        return (
          <Fragment key={`${s.kind}-${s.round}-${i}`}>
            {i > 0 && <span className="ov-arrow">←</span>}
            <button
              className={`ov-step${s.kind === "dependency" ? " dep" : ""}${s.past ? " past" : ""}${i === active ? " active" : ""}`}
              disabled={s.state === "todo"} onClick={() => onPick(i)}
              title={s.state === "todo" ? "נפתח כשהשלב שלפניו יסתיים" : s.note}
            >
              <div className="n">{mark}<span>{STEP_NUM[s.kind]}</span></div>
              <div className="lbl">{stepLabel(steps, i)}</div>
              {s.past && s.at && <div className="sub">סבב {s.round} · {fmtDay(s.at)}</div>}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

export function TaskDetail({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<TD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [copied, setCopied] = useState("");
  const [editing, setEditing] = useState(false);
  const [editIntent, setEditIntent] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editAppetite, setEditAppetite] = useState<"small" | "standard" | "large">("standard");
  const [editScope, setEditScope] = useState<"text" | "scope">("text");
  const [saving, setSaving] = useState(false);
  // the task's instruction, edited in place inside the development step
  const [instrEditing, setInstrEditing] = useState(false);
  const [instrDraft, setInstrDraft] = useState("");
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ pushed: boolean; reason?: string; branchUrl?: string; compareUrl?: string; base?: string; note?: string } | null>(null);
  const [builtOn, setBuiltOn] = useState<TaskBuiltOn | null>(null);
  const [addingE2E, setAddingE2E] = useState(false);
  // The same picture the onboarding stages draw, for this task's branch.
  const [codeMap, setCodeMap] = useState<{ codeMap: CodeMap | null; branch: string | null; reason?: string } | null>(null);
  const [delReport, setDelReport] = useState<TaskDeletePrecheck | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [delAckSubtree, setDelAckSubtree] = useState(false);
  const [delAckAdo, setDelAckAdo] = useState(false);
  const [delAckCoTouch, setDelAckCoTouch] = useState(false);
  const [delCodeChoice, setDelCodeChoice] = useState<"rollback" | "orphan">("rollback");
  const [delErr, setDelErr] = useState<string | null>(null);
  const [manualStep, setManualStep] = useState<number | null>(null);
  // mandatory gate — nothing reaches Claude except from the modal's confirm.
  const [sendOpen, setSendOpen] = useState(false);
  const [sendData, setSendData] = useState<{ prompt: string; promptHe: string } | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // when set, the modal's confirm targets this check's own id (e.g. "run the Build again"),
  // not the task's — reuses the same preview+confirm gate instead of a second copy of it.
  const [sendTarget, setSendTarget] = useState<{ id: string; label: string } | null>(null);
  const [checkBusy, setCheckBusy] = useState<string | null>(null);
  // the full prompt, one fold away inside the development step
  const [promptPreview, setPromptPreview] = useState<{ prompt: string; promptHe: string; approved: boolean } | null>(null);
  const [approving, setApproving] = useState(false);
  const [tfsErr, setTfsErr] = useState<string | null>(null);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [doneErr, setDoneErr] = useState<string | null>(null);
  const [overrideReasonOpen, setOverrideReasonOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [togglingCheck, setTogglingCheck] = useState<string | null>(null);
  const [approvingCheck, setApprovingCheck] = useState<string | null>(null);
  const [togglingSelf, setTogglingSelf] = useState(false);
  const [adoRechecking, setAdoRechecking] = useState(false);
  const [adoRecheckMsg, setAdoRecheckMsg] = useState<string | null>(null);
  const adoCheckedOnLoad = useRef(false);

  const load = useCallback(() => {
    getTask(id).then(setD).catch((e) => setErr(String(e)));
    getTaskBuiltOn(id).then(setBuiltOn).catch(() => setBuiltOn(null));
  }, [id]);
  const loadPrompt = useCallback(() => { previewImplement(id).then(setPromptPreview).catch(() => setPromptPreview(null)); }, [id]);
  const loadCodeMap = useCallback(() => { getTaskCodeMap(id).then(setCodeMap).catch(() => setCodeMap(null)); }, [id]);
  const refreshRun = useCallback(async () => {
    try {
      const r = await getTaskRun(id);
      setRun((prev) => { if (prev?.state === "running" && r.state !== "running") load(); return r; });
    } catch { /* ignore */ }
  }, [id, load]);

  useEffect(() => { load(); refreshRun(); loadPrompt(); loadCodeMap(); }, [load, refreshRun, loadPrompt, loadCodeMap]);
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    // While it runs, the steps follow it too (development → build → checks).
    const iv = setInterval(() => { refreshRun(); getTask(id).then(setD).catch(() => {}); }, 1500);
    return () => clearInterval(iv);
  }, [running, refreshRun, id]);
  // A step that came in or went away moves every index after it — go back to following the task.
  const stepCount = d?.flow.length ?? 0;
  useEffect(() => { setManualStep(null); }, [stepCount]);

  // On-demand TFS → DCC pull: is the real work item now "Removed"? DCC
  // has no poller/webhook — this is the only way it finds out, short of
  // someone deactivating it here directly. Fires once, silently, the
  // first time a TFS-linked active task loads.
  const dTaskId = d?.task.id; const dClientId = d?.task.clientId;
  const dLinkedAdoId = d?.task.linkedAdoId; const dKind = d?.task.kind; const dActive = d?.task.active;
  const doAdoRecheck = useCallback(async () => {
    if (!dTaskId || !dClientId || !dLinkedAdoId) return;
    setAdoRechecking(true); setAdoRecheckMsg(null);
    try {
      const r = await checkAdoRecheck(dTaskId, dClientId);
      if (r.changed) { setAdoRecheckMsg(`עודכן: TFS מראה ${r.adoState} — הושבתה בהתאם.`); load(); }
    } catch { /* best-effort, silent */ }
    finally { setAdoRechecking(false); }
  }, [dTaskId, dClientId, dLinkedAdoId, load]);
  useEffect(() => {
    if (dKind === "task" && dLinkedAdoId && dActive && !adoCheckedOnLoad.current) {
      adoCheckedOnLoad.current = true;
      doAdoRecheck();
    }
  }, [dKind, dLinkedAdoId, dActive, doAdoRecheck]);

  // What the one chat knows about this screen (a hook — above the early returns).
  useClaudeContext(d ? {
    screen: "task",
    topic: { kind: "task", id: d.task.id, title: `משימה #${d.task.seq}: ${d.task.intent.slice(0, 60)}` },
    facts: {
      "המשימה": d.task.intent, "מספר": d.task.seq, "סוג": d.task.kind === "check" ? "בדיקה" : "משימה", "סטטוס": d.status.label, "גודל": d.task.appetite,
      "אושרה": d.task.approvedAt ? "כן" : "עדיין לא", "ב-TFS": d.task.linkedAdoId ? `#${d.task.linkedAdoId}` : "עוד לא הוקמה", "הדרישה": d.requirement.title,
      "משימת אב": d.parent ? `#${d.parent.seq}: ${d.parent.intent}` : "(אין)",
      "תלויה ב": d.blockedBy.map((t) => `#${t.seq}: ${t.intent} (${t.state === "done" ? "הושלמה" : "לא הושלמה"})`), "מאגרים": d.repos.map((r) => r.name),
      ...(d.status.dependency ? { "תג התלות": `${d.status.dependency.label} — ${d.status.dependency.reason}` } : {}),
      ...(builtOn && (builtOn.on || builtOn.missing.length) ? {
        [builtOn.state === "built" ? "נבנתה על גבי" : "תיבנה על גבי"]: builtOn.on ? `הענף של #${builtOn.on.seq}: ${builtOn.on.intent}` : "הענף הראשי",
        [builtOn.state === "built" ? "פותחה בלי" : "תפותח בלי"]: builtOn.missing.map((m) => `#${m.seq}: ${m.intent}`),
      } : {}),
      "השלבים": d.flow.map((s) => `${s.kind}${s.deps?.length ? ` ${refs(s.deps)}` : ""}: ${s.state}${s.past ? " (סבב קודם)" : ""}`),
      "הרצה אחרונה": run ? `${run.kind} — ${run.state}` : "(אין)",
      nextStep: !d.task.approvedAt ? "לאשר את המשימה" : !d.task.linkedAdoId && d.task.kind === "task" ? "להקים את המשימה ב-TFS" : d.task.state === "done" ? "המשימה הושלמה" : d.status.reason ?? d.status.label,
    },
    suggestions: ["מה זה שלב תלות?", "מה יקרה אם אלחץ על פיתוח?", "מה השלב הבא?"],
    actions: ["implement", "approve_task"],
  } : null);

  if (err && !d) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;
  const t = d.task;
  const inTfs = t.linkedAdoId != null;
  const impl = run?.state === "done" && run.kind === "implement" ? (run.result as unknown as ImplementResult | null) : null;
  const hasCode = run?.state === "done" && run.kind === "implement";
  const attempted = run !== null && run.kind === "implement" && run.state !== "running" && run.state !== "idle";
  // While a run is going on the status follows it step by step; the rest of the time it is the server's.
  const status = running && run?.kind === "implement" && t.kind === "task"
    ? { ...d.status, label: `בעבודה · ${run.phase === "build" ? "מקמפלת" : run.phase === "test" ? "בבדיקות" : "בפיתוח"}`, tone: "active" as const, reason: undefined }
    : d.status;

  const steps = d.flow;
  const liveIdx = (() => {
    const i = steps.findIndex((s) => !s.past && (s.state === "current" || s.state === "failed" || s.state === "waiting"));
    if (i >= 0) return i;
    const last = steps.map((s) => s.state !== "todo").lastIndexOf(true);
    return last >= 0 ? last : 0;
  })();
  const activeIdx = manualStep != null && manualStep < steps.length ? manualStep : liveIdx;
  const sel = steps[activeIdx];

  const copy = (s: string, k: string) => { navigator.clipboard?.writeText(s); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  // Step 1 of the gate: fetch the exact prompt and open the preview. Targets the
  // task itself by default; a specific check (e.g. "run the Build again") when given.
  const openSend = async (target?: { id: string; label: string }) => {
    setErr(null); setSendErr(null); setSendData(null); setSendTarget(target ?? null); setSendOpen(true); setSendLoading(true);
    try { setSendData(await previewImplement(target?.id ?? id)); }
    catch (e) { setSendErr(String(e)); }
    finally { setSendLoading(false); }
  };
  // Step 2: only reachable from the modal's confirm button.
  const confirmSend = async () => {
    if (sending) return;
    setSending(true); setErr(null);
    const target = sendTarget;
    try {
      await implementTask(target?.id ?? id);
      setSendOpen(false);
      if (!target) { setShowLog(true); setManualStep(null); await refreshRun(); load(); return; }
      // A single check's own run — poll it on its own id, then just refresh the task.
      setCheckBusy(target.id);
      for (;;) {
        const r = await getTaskRun(target.id);
        if (r.state !== "running") break;
        await new Promise((res) => setTimeout(res, 1500));
      }
      setCheckBusy(null);
      load();
    } catch (e) { setErr(String(e)); setSendOpen(false); setCheckBusy(null); }
    finally { setSending(false); }
  };

  // Approving is the one gate before anything reaches TFS; it tries to create
  // the TFS item at once. A failed attempt (e.g. no ADO connection yet) keeps
  // the approval, and says why here — the same button tries again.
  const doApprove = async () => {
    setApproving(true); setErr(null); setTfsErr(null);
    try {
      const r = await approveTask(id, { clientId: t.clientId });
      if (r.materializeError) setTfsErr(r.materializeError);
      load(); loadPrompt();
    } catch (e) { setTfsErr(String(e)); }
    finally { setApproving(false); }
  };

  const toggleCheck = async (checkId: string, active: boolean) => {
    setTogglingCheck(checkId); setErr(null);
    try { await setTaskActive(checkId, active, t.clientId); load(); loadPrompt(); }
    catch (e) { setErr(String(e)); }
    finally { setTogglingCheck(null); }
  };

  const toggleSelf = async () => {
    setTogglingSelf(true); setErr(null);
    try { await setTaskActive(t.id, !t.active, t.clientId); load(); }
    catch (e) { setErr(String(e)); }
    finally { setTogglingSelf(false); }
  };

  const approveCheckRow = async (checkId: string) => {
    setApprovingCheck(checkId); setErr(null);
    try { await approveTask(checkId, { clientId: t.clientId }); load(); }
    catch (e) { setErr(String(e)); }
    finally { setApprovingCheck(null); }
  };

  const addE2E = async () => {
    setAddingE2E(true);
    try { await addE2ECheck(t.id); load(); } catch (e) { setErr(String(e)); } finally { setAddingE2E(false); }
  };

  const markDone = async (override: boolean) => {
    if (override && !overrideReason.trim()) { setOverrideReasonOpen(true); return; }
    setCompleting(true); setDoneErr(null);
    try {
      await progressTask(t.id, { to: "done", clientId: t.clientId, ...(override ? { overrideChecks: true, overrideReason } : {}) });
      setOverrideReasonOpen(false); setOverrideReason("");
      load();
    } catch (e) {
      setDoneErr(e instanceof ChecksNotPassed ? e.message : String(e));
    }
    finally { setCompleting(false); }
  };

  const openEdit = () => {
    setEditIntent(t.intent);
    setEditPrompt(t.prompt ?? "");
    setEditAppetite(t.appetite as "small" | "standard" | "large");
    setEditScope("text");
    setEditing(true);
  };
  const saveEdit = async () => {
    setSaving(true); setErr(null);
    try {
      await editTask(id, {
        clientId: t.clientId, intent: editIntent, appetite: editAppetite, prompt: editPrompt,
        scopeChanged: editScope === "scope",
      });
      setEditing(false);
      load(); loadPrompt();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };
  const saveInstruction = async () => {
    setSaving(true); setErr(null);
    try {
      await editTask(id, { clientId: t.clientId, intent: t.intent, appetite: t.appetite as "small" | "standard" | "large", prompt: instrDraft, scopeChanged: false });
      setInstrEditing(false);
      load(); loadPrompt();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const rollback = async () => {
    if (!confirm("זה יבטל את כל שינויי הקוד שנעשו במשימה הזו (branch מבודד, לא בקוד שלך) ויחזיר אותה ל-\"ממתין\". לא ניתן לשחזר מה-DCC. להמשיך?")) return;
    setRollingBack(true); setErr(null); setRollbackMsg(null);
    try {
      const r = await rollbackTask(id);
      loadCodeMap();
      setRollbackMsg(r.rolledBack ? "✓ שינויי הקוד בוטלו — ה-branch אופס לבסיס. עכשיו אפשר להריץ שוב." : (r.reason ?? "אין מה לבטל."));
      load();
      await refreshRun();
    } catch (e) { setErr(String(e)); }
    finally { setRollingBack(false); }
  };

  const push = async () => {
    if (!confirm("זה ידחוף את ה-branch של המשימה הזו ל-GitHub (origin האמיתי של ה-repo). להמשיך?")) return;
    setPushing(true); setErr(null); setPushResult(null);
    try {
      const r = await pushTask(id);
      loadCodeMap();
      setPushResult(r);
    } catch (e) { setErr(String(e)); }
    finally { setPushing(false); }
  };

  const openDelete = async () => {
    setDelErr(null); setDelLoading(true);
    setDelAckSubtree(false); setDelAckAdo(false); setDelAckCoTouch(false); setDelCodeChoice("rollback");
    try { setDelReport(await precheckTaskDelete(id)); }
    catch (e) { setErr(String(e)); }
    finally { setDelLoading(false); }
  };
  const confirmDelete = async () => {
    if (!delReport) return;
    setDelLoading(true); setDelErr(null);
    try {
      await deleteTask(id, {
        clientId: t.clientId,
        confirmSubtree: delAckSubtree,
        confirmAdoLinked: delAckAdo,
        confirmCoTouch: delAckCoTouch,
        rollbackImplemented: delReport.hasImplementedCode && delCodeChoice === "rollback",
        confirmOrphanCode: delReport.hasImplementedCode && delCodeChoice === "orphan",
      });
      nav(`#/wi/${d.requirement.id}`);
    } catch (e) {
      if (e instanceof DeleteBlocked) { setDelReport(e.precheck); setDelErr(e.message); }
      else setDelErr(String(e));
    } finally { setDelLoading(false); }
  };
  const readyToDelete = !!delReport && (
    (!delReport.hasChildren || delAckSubtree) &&
    (!delReport.hasAdoLinks || delAckAdo) &&
    (!delReport.hasCoTouch || delAckCoTouch)
  );

  const checks = d.children.filter((c) => c.kind === "check");
  const subtasks = d.children.filter((c) => c.kind !== "check");
  const buildCheck = checks.find((c) => c.checkKind === "build");
  const canRun = !!t.approvedAt && (inTfs || t.kind === "check") && t.active;
  const outcomeOf = (seq: number) => impl?.checks?.find((c) => c.seq === seq);

  /* ── the panes, one per kind of step ─────────────────────────────── */

  const runControls = (label: string) => (
    <>
      {running ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div className="spinner" style={{ width: 16, height: 16 }} />
            <p style={{ fontSize: 13, color: "var(--ink-600)", margin: 0 }}>{t.kind === "check" ? "Claude מריץ את הבדיקה — בלי הרשאה לשנות קבצים…" : run?.phase === "build" ? "Build: בונה את מה שהשינוי מתקמפל אליו…" : run?.phase === "test" ? "בדיקות: מריץ את הבדיקות, בלי הרשאה לשנות קבצים…" : "פיתוח: Claude קורא, כותב את הקוד ואת הבדיקות שלו…"}</p>
          </div>
          <Transcript lines={run?.lines ?? []} />
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--ink-400)" }}>רץ ברקע על קלון מבודד, על branch נפרד. אפשר לצאת מהמסך. לא נדחף כלום.</p>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={!canRun} onClick={() => openSend()}>{label}</button>
          <Info k="implement" />
          {!inTfs && t.kind === "task" && t.approvedAt && <span style={{ fontSize: 12, color: "var(--status-warning)" }}>🔒 נפתח אחרי שהמשימה תוקם ב-TFS</span>}
          {!t.active && <span style={{ fontSize: 12, color: "var(--ink-500)" }}>המשימה מושבתת</span>}
        </div>
      )}
      {!running && run?.state === "error" && (
        <div className="ob-note crit" style={{ marginTop: 12 }}>
          <b>ההרצה האחרונה לא הסתיימה.</b>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{run.error}</div>
        </div>
      )}
      {run && run.lines.length > 0 && !running && (
        <div style={{ marginTop: 12 }}>
          <a className="link" style={{ fontSize: 12 }} onClick={() => setShowLog((v) => !v)}>{showLog ? "▲ הסתר" : "▼ הצג"} את התמלול המלא של ההרצה</a>
          {showLog && <div style={{ marginTop: 8 }}><Transcript lines={run.lines} /></div>}
        </div>
      )}
    </>
  );

  const instructionBlock = (
    <div className="field" style={{ marginTop: 14 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        ההוראה למשימה<Info k="task_instruction" />
        {!instrEditing && !running && <a className="link" style={{ fontSize: 11.5, fontWeight: 600 }} onClick={() => { setInstrDraft(t.prompt ?? t.intent); setInstrEditing(true); }}>✎ ערוך</a>}
      </label>
      {instrEditing ? (
        <>
          <textarea value={instrDraft} onChange={(e) => setInstrDraft(e.target.value)} rows={5} style={{ width: "100%", marginTop: 4 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={saving || !instrDraft.trim()} onClick={saveInstruction}>{saving ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setInstrEditing(false)}>ביטול</button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", marginTop: 4 }}>{t.prompt || t.intent}</div>
      )}
    </div>
  );

  const promptFold = (
    <Fold title="הפרומפט המלא שיישלח לקלוד" info="stage_prompt">
      {promptPreview ? <PromptText prompt={promptPreview.prompt} promptHe={promptPreview.promptHe} maxHeight="36vh" /> : <p className="ob-sub">טוען…</p>}
      <a className="link" style={{ fontSize: 12 }} onClick={() => nav("#/prompts")}>לעריכת התבנית עצמה — מסך פרומפטים ←</a>
    </Fold>
  );

  const scopeFold = (t.affectedPaths.length > 0 || t.compiledComponents.length > 0) && (
    <Fold title={`קבצים צפויים ורכיבים (${t.affectedPaths.length + t.compiledComponents.length})`} info="expected_files">
      {t.affectedPaths.length > 0 && (
        <div className="field" style={{ marginBottom: 8 }}>
          <label>קבצים צפויים<Info k="expected_files" /></label>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{t.affectedPaths.join(", ")}</div>
        </div>
      )}
      {t.compiledComponents.length > 0 && (
        <div className="field">
          <label>רכיבים מתקמפלים<Info k="compiled_components" /></label>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{t.compiledComponents.join(", ")}</div>
        </div>
      )}
    </Fold>
  );

  const buildResult = buildCheck && d.checkStatuses[buildCheck.id] && (buildCheck.checkResult || running) && (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5, flexWrap: "wrap" }}>
      <span style={{ color: "var(--ink-500)" }}>Build:</span>
      <TaskStatusPill status={d.checkStatuses[buildCheck.id]!} />
      {hasCode && !running && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2, marginInlineStart: 6 }}>
          <button className="btn btn-secondary btn-sm" disabled={checkBusy === buildCheck.id}
            onClick={() => openSend({ id: buildCheck.id, label: "Build" })}>
            {checkBusy === buildCheck.id ? "מריץ Build…" : "🔁 הרץ Build שוב"}
          </button>
          <Info k="task_rebuild_check" />
        </span>
      )}
    </div>
  );

  const developPane = (s: TaskFlowStep) => (
    <>
      <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12, lineHeight: 1.6 }}>
        קלוד כותב את הקוד ואת הבדיקות שלו בעותק מבודד של המאגר, על ענף משלה, ובסוף בונה (Build) את מה שהשינוי מתקמפל אליו. שום דבר לא נדחף ולא מתמזג לבד.
      </p>
      {runControls(attempted ? "✦ הרץ שוב" : "✦ תן ל-Claude לפתח")}
      {s.state === "failed" && buildCheck?.checkResult === "failed" && (() => {
        const o = outcomeOf(buildCheck.seq);
        const isEnv = o?.likelyCause === "environment";
        return (
          <div className="ob-note crit" style={{ marginTop: 10 }}>
            <b>{isEnv ? "⚙ ה-Build נכשל מסיבת סביבה — לא באג בקוד" : "ה-Build נכשל — הבדיקות לא רצו"}</b>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
              {o?.detail || (isEnv ? "חסר כלי או SDK כאן — לפרטים, פתחו את הבדיקה למטה." : "אפשר לתקן את ההוראה ולהריץ שוב.")}
            </div>
            {isEnv && <div style={{ marginTop: 6, fontSize: 11.5 }}>אחרי שמתקינים את מה שחסר: 🔁 הרץ Build שוב, למטה.</div>}
          </div>
        );
      })()}
      {buildResult}
      {instructionBlock}
      {promptFold}
      {scopeFold}
    </>
  );

  const dependencyPane = (s: TaskFlowStep) => (
    <>
      <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12, lineHeight: 1.6 }}>
        {refs(s.deps)} פותחה מאז שהמשימה נבנתה, והעבודה שלה לא בענף של המשימה. כדי שהמשימה תיבנה עליה והבדיקות ירוצו על הגרסה המלאה — שני צעדים, בסדר הזה:
      </p>
      <ol style={{ margin: "0 0 12px", paddingInlineStart: 20, fontSize: 12.5, lineHeight: 1.8 }}>
        <li><b>↩ Rollback</b> — מוחק את מה שנבנה בלי {refs(s.deps)}. {hasCode ? "" : <span style={{ color: "var(--status-healthy)" }}>✓ בוצע</span>}</li>
        <li><b>✦ הרץ שוב</b> — בונה את המשימה על {refs(s.deps)}, ומריץ שוב את ה-Build ואת הבדיקות.</li>
      </ol>
      {!running && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <button className="btn btn-secondary" disabled={!hasCode || rollingBack} onClick={rollback} style={{ color: "var(--status-critical)" }}>{rollingBack ? "מבטל…" : "↩ Rollback"}</button>
          <Info k="rollback" />
        </div>
      )}
      {rollbackMsg && <p style={{ fontSize: 12, color: "var(--ink-500)", margin: "6px 0" }}>{rollbackMsg}</p>}
      <div style={{ marginTop: 8, ...(hasCode && !running ? { opacity: 0.55, pointerEvents: "none" as const } : {}) }}>{runControls("✦ הרץ שוב")}</div>
      {instructionBlock}
      {promptFold}
    </>
  );

  const checksPane = (s: TaskFlowStep) => (
    <>
      <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 10, lineHeight: 1.6 }}>
        אחרי שה-Build עובר רצות בדיקות הפיתוח והרגרסיה — בלי הרשאה לשנות קבצים. בדיקה שצריכה עבודה של תלות שעוד לא קיימת מסומנת "מחכה לתלות", לא "נכשלה".
      </p>
      {running && run?.phase === "test" && <div style={{ marginBottom: 10 }}>{runControls("")}</div>}
      {s.note && <p style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>תוצאות: {s.note}<Info k="check_results" /></p>}
      {impl?.skipped && impl.skipped.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 8 }}>
          {impl.skipped.length} בדיקות לא רצו — ה-Build לא עבר, ובדיקות של קוד שלא נבנה לא אומרות כלום.
        </p>
      )}
      <div className="rowlist">
        {checks.map((c) => {
          const isOpen = expandedCheck === c.id;
          const isActive = c.active !== false;
          const o = outcomeOf(c.seq);
          return (
            <div key={c.id}>
              <div className="row" style={{ cursor: "pointer", opacity: isActive ? 1 : 0.55 }}>
                <a
                  title={isActive ? "השבת בדיקה — תוצא מההרצות ומשער הסגירה, ההיסטוריה נשארת" : "הפעל בדיקה מחדש — תרוץ בהרצה הבאה"}
                  onClick={(e) => { e.stopPropagation(); toggleCheck(c.id, !isActive); }}
                  style={{ marginInlineEnd: 8, cursor: "pointer", color: "var(--ink-500)" }}
                >
                  {togglingCheck === c.id ? "…" : isActive ? (c.state === "done" ? "☑" : "☐") : "◻"}
                </a>
                <span onClick={() => setExpandedCheck(isOpen ? null : c.id)} className="title">{isOpen ? "▾" : "▸"} #{c.seq} {c.intent.slice(0, 90)}</span>
                {c.checkKind && <Pill tone="neutral">{CHECK_KIND_HE[c.checkKind] ?? c.checkKind}</Pill>}
                <span className="spacer" />
                {d.checkStatuses[c.id] ? <TaskStatusPill status={d.checkStatuses[c.id]!} /> : <Pill tone="inactive">{STATE_HE[c.state] ?? c.state}</Pill>}
                {!c.approvedAt && (
                  <button className="btn btn-secondary btn-sm" disabled={approvingCheck === c.id} onClick={(e) => { e.stopPropagation(); approveCheckRow(c.id); }} style={{ marginInlineStart: 8 }}>
                    {approvingCheck === c.id ? "מאשר…" : "✓ אישור"}
                  </button>
                )}
              </div>
              {isOpen && (
                <div style={{ background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", margin: "4px 0 8px", fontSize: 12.5, lineHeight: 1.6 }}>
                  <p style={{ fontSize: 11, color: "var(--ink-500)", marginBottom: 2 }}>מה הבדיקה מוודאת (ההוראה שלה):</p>
                  <p style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{c.intent}</p>
                  {o && (
                    <>
                      <p style={{ fontSize: 11, color: "var(--ink-500)", marginBottom: 2 }}>מה יצא בהרצה האחרונה:</p>
                      <p style={{ whiteSpace: "pre-wrap", marginBottom: 4 }}>{o.detail}</p>
                      {!o.passed && o.likelyCause && (
                        <p style={{ fontSize: 11.5, color: "var(--status-warning)", marginBottom: 4 }}>
                          {o.likelyCause === "requirement_ambiguity"
                            ? `⚠ יתכן שהסיבה היא עמימות בדרישה, לא תקלה במימוש${d.blockedBy.some((b) => b.state !== "done") ? ` — אולי כי ${d.blockedBy.filter((b) => b.state !== "done").map((b) => `#${b.seq}`).join(", ")} עוד לא הושלמה` : ""}. כדאי לבדוק את הדרישה לפני שמנסים שוב.`
                            : o.likelyCause === "dependency_missing"
                              ? "אי אפשר היה לבדוק: הבדיקה צריכה עבודה של משימה שהמשימה הזו תלויה בה, ושעוד לא בענף. זו לא תקלה — כשהתלות תפותח ייכנס שלב \"תלות\"."
                              : o.likelyCause === "environment"
                                ? "⚠ הבדיקה לא יכלה לרוץ במחשב של DCC — חסר כלי, SDK או שירות. זו לא תקלה בקוד, אבל גם לא אישור שהוא עובד."
                                : "⚠ כנראה תקלת מימוש — כדאי לבדוק את הקוד שנכתב."}
                        </p>
                      )}
                    </>
                  )}
                  {c.checkResolvedBy && <p style={{ color: "var(--status-warning)", marginBottom: 4 }}>✓ אושרה ידנית ע"י אדם — לא (רק) תוצאת הבדיקה של Claude.</p>}
                  <a onClick={() => nav(`#/task/${c.id}`)} style={{ fontSize: 11.5, color: "var(--color-accent)", fontWeight: 600, cursor: "pointer" }}>לעריכת ההוראה של הבדיקה ולפרטים המלאים ←</a>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {t.kind === "task" && !checks.some((c) => c.checkKind === "e2e") && checks.some((c) => c.checkKind) && (
        <p style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
          <button className="btn btn-secondary btn-sm" disabled={addingE2E} onClick={addE2E}>{addingE2E ? "מוסיף…" : "+ הוסף בדיקות E2E"}</button>
          <Info k="add_e2e_check" />
        </p>
      )}
    </>
  );

  const reviewPane = (
    <>
      {impl ? (
        <>
          <CardTitle as="h3" info="task_result" style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>מה Claude עשה</CardTitle>
          <p style={{ fontSize: 12.5, color: "var(--ink-700)", whiteSpace: "pre-wrap", lineHeight: 1.65, marginBottom: 12 }}>{impl.summary}</p>

          {impl.filesChanged.length > 0 && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label>קבצים שהשתנו ({impl.filesChanged.length})<Info k="files_changed" /></label>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left" }}>
                {impl.filesChanged.map((f) => <div key={f}>{f}</div>)}
              </div>
            </div>
          )}
          {impl.affectedConsumers?.length > 0 && (
            <div className="field" style={{ marginBottom: 10 }}>
              {/* no-info: the sentence under it is the explanation */}
              <label>מי עוד נוגע בקבצים האלה ({impl.affectedConsumers.length})</label>
              <p style={{ fontSize: 11, color: "var(--ink-500)", marginTop: -2, marginBottom: 6 }}>קוד אחר שמפנה/משתמש בקבצים ששונו — יש לשקול לאסוף ולעדכן אותם יחד לפריסת טסט.</p>
              <div className="rowlist">
                {impl.affectedConsumers.map((c, i) => (
                  <div className="row" key={i} style={{ alignItems: "flex-start", flexDirection: "column", gap: 3, paddingBlock: 8 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{c.path}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-700)" }}>{c.reason}</span>
                    {c.usedBy.length > 0 && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>← {c.usedBy.join(", ")}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {impl.followUps.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p className="section-lbl" style={{ marginBottom: 6 }}>המשך שנשאר<Info k="remaining_work" /></p>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.7 }}>{impl.followUps.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <Fold title="איפה זה יושב ואיך לבדוק מקומית" info="where_it_sits">
            <div className="field" style={{ marginBottom: 10 }}>
              <label>איפה זה יושב<Info k="where_it_sits" /></label>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", whiteSpace: "pre-wrap" }}>
                {`${impl.dir}\n${impl.branch}${impl.commit ? `  (commit ${impl.commit})` : "  — ללא שינויים"}`}
              </div>
            </div>
            <div className="field">
              <label>לבדיקה מקומית<Info k="local_check" /></label>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ whiteSpace: "pre-wrap" }}>{`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`}</span>
                <a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`, "cmd")}>{copied === "cmd" ? "✓" : "העתק"}</a>
              </div>
            </div>
          </Fold>
          {codeMap?.codeMap
            ? <div style={{ marginTop: 14 }}><CodeMapPanel map={codeMap.codeMap} title={`מצב הקוד · ${codeMap.branch ?? ""}`} /></div>
            : codeMap?.reason ? <p className="ob-sub" style={{ marginTop: 14, fontSize: 12, color: "var(--ink-500)" }}>{codeMap.reason}</p> : null}

          {t.state !== "done" && (
            <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 14, marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn btn-primary" disabled={pushing || rollingBack} onClick={push}>{pushing ? "דוחף…" : "⬆ Push ל-GitHub"}</button>
              <Info k="push" />
              <button className="btn btn-secondary" disabled={pushing || rollingBack} onClick={rollback}>{rollingBack ? "מבטל…" : "↩ Rollback"}</button>
              <Info k="rollback" />
            </div>
          )}
          {pushResult && (
            <div className="callout" style={{ marginTop: 12 }}>
              <div className="body">
                {pushResult.pushed ? (
                  <>
                    <p className="r">✓ נדחף ל-GitHub.</p>
                    <p style={{ display: "flex", gap: 14, marginTop: 4 }}>
                      {pushResult.branchUrl && <a href={pushResult.branchUrl} target="_blank" rel="noreferrer">צפה ב-branch ↗</a>}
                      {pushResult.compareUrl && <a href={pushResult.compareUrl} target="_blank" rel="noreferrer">פתח Pull Request{pushResult.base ? ` מול ${pushResult.base}` : ""} ↗</a>}
                    </p>
                    {pushResult.note && <p className="r" style={{ color: "var(--status-warning)", marginTop: 6 }}>⚠ {pushResult.note}</p>}
                  </>
                ) : <p className="r" style={{ color: "var(--status-critical)" }}>{pushResult.reason ?? "ה-push נכשל."}</p>}
              </div>
            </div>
          )}
          {rollbackMsg && <div className="callout" style={{ marginTop: 12 }}><div className="body"><p className="r">{rollbackMsg}</p></div></div>}
        </>
      ) : run?.state === "rolled_back" ? (
        <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 12 }}>↩ הקוד של ההרצה הקודמת בוטל — אין כרגע מה לסקור. אפשר להריץ שוב משלב הפיתוח.</p>
      ) : (
        <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 12 }}>אין עדיין הרצה שהסתיימה — אין מה לסקור.</p>
      )}

      <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 14, marginTop: 16 }}>
        {t.state === "done" ? (
          <>
            <p style={{ fontSize: 13.5, color: "var(--status-healthy)", marginBottom: reopenOpen ? 10 : 0 }}>✓ המשימה סומנה כהושלמה.</p>
            {!reopenOpen ? (
              <a onClick={() => setReopenOpen(true)} style={{ fontSize: 12, color: "var(--ink-500)", cursor: "pointer" }}>↩ פתח מחדש</a>
            ) : (
              <div className="field">
                {/* no-info: the label says what is being asked and where the answer is kept */}
                <label>למה לפתוח מחדש? (יישמר בהיסטוריית הדרישה)</label>
                <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2} placeholder="למשל: נמצא באג, נדרש שינוי נוסף, וכו׳"
                  style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btn-secondary" disabled={reopening || !reopenReason.trim()}
                    onClick={async () => {
                      setReopening(true);
                      try { await progressTask(t.id, { to: "in_progress", clientId: t.clientId, reopenReason }); setReopenOpen(false); setReopenReason(""); load(); }
                      catch (e) { setErr(String(e)); }
                      finally { setReopening(false); }
                    }}>
                    {reopening ? "פותח…" : "↩ פתח מחדש עם הסיבה הזו"}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setReopenOpen(false); setReopenReason(""); }}>ביטול</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 10 }}>
              לסמן שהעבודה של DCC על המשימה הזו נגמרה. אפשר גם בלי push — לא כל משימה מסתיימת בקוד. משימה תלויה נסגרת רק אחרי שהתלות שלה הושלמה.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={completing} onClick={() => markDone(false)}>{completing ? "מסמן…" : "סמן כהושלם"}</button>
              {doneErr && !overrideReasonOpen && (
                <button className="btn btn-secondary" disabled={completing} onClick={() => setOverrideReasonOpen(true)} style={{ color: "var(--status-critical)" }}>אשר ידנית למרות זאת</button>
              )}
            </div>
            {overrideReasonOpen && (
              <div className="field" style={{ marginTop: 10 }}>
                {/* no-info: the label says what is being asked and where the answer is kept */}
                <label>למה לאשר בכל זאת? (יישמר בהיסטוריית הדרישה)</label>
                <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} placeholder="למשל: הבדיקה החסומה כבר לא רלוונטית, הוחלט לוותר עליה, וכו׳"
                  style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btn-secondary" disabled={completing || !overrideReason.trim()} onClick={() => markDone(true)} style={{ color: "var(--status-critical)" }}>{completing ? "מאשר…" : "✓ אשר עם הסיבה הזו"}</button>
                  <button className="btn btn-secondary" onClick={() => { setOverrideReasonOpen(false); setOverrideReason(""); }}>ביטול</button>
                </div>
              </div>
            )}
            {doneErr && <p style={{ fontSize: 12, color: "var(--status-critical)", marginTop: 8, whiteSpace: "pre-wrap" }}>{doneErr}</p>}
          </>
        )}
      </div>
    </>
  );

  const pastPane = (s: TaskFlowStep) => (
    <>
      <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 8 }}>סבב {s.round}{s.at ? ` · התחיל ב-${fmtDay(s.at)}` : ""} — היסטוריה. מה שקרה כאן נשאר לתיעוד; העבודה עצמה ממשיכה בשלבים שאחריו.</p>
      <p style={{ fontSize: 13, color: "var(--ink-700)" }}>
        {s.kind === "develop" ? `פיתוח${s.note ? ` — ${s.note}` : ""}.`
          : s.kind === "dependency" ? `המשימה נבנתה מחדש על ${refs(s.deps)} (Rollback והרצה חוזרת)${s.note ? ` — ${s.note}` : ""}.`
          : s.kind === "checks" ? `הבדיקות רצו: ${s.note ?? ""}.`
          : "המשימה הגיעה לסקירה (נדחפה או נסגרה)."}
      </p>
    </>
  );

  const paneFor = (s: TaskFlowStep | undefined) => {
    if (!s) return null;
    if (s.past) return pastPane(s);
    if (s.kind === "develop") return developPane(s);
    if (s.kind === "dependency") return dependencyPane(s);
    if (s.kind === "checks") return checksPane(s);
    return reviewPane;
  };

  return (
    <>
      {sendOpen && (
        <PromptPreviewModal
          title={sendTarget ? `הרצה חוזרת — ${sendTarget.label}` : attempted ? "הרצה חוזרת — פיתוח המשימה" : "תן ל-Claude לפתח את המשימה"}
          data={sendData} loading={sendLoading} error={sendErr}
          loadingHint="מביא עותק עבודה של ה-repository, כדי שקלוד יוכל לקרוא את הקוד — בפעם הראשונה, או על רשת איטית, זה יכול לקחת כמה דקות…"
          onClose={() => { setSendOpen(false); setSendData(null); setSendErr(null); setSendTarget(null); }}
          onConfirm={confirmSend} confirming={sending}
          confirmLabel={sendTarget ? `✦ הרץ ${sendTarget.label} שוב` : "✦ שלח ל-Claude, תתחיל לפתח"}
        />
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        {t.kind === "check" && d.parent && <button className="btn btn-secondary btn-sm" onClick={() => nav(`#/task/${d.parent!.id}`)}>⬅ למשימה #{d.parent.seq}</button>}
        <button className="btn btn-secondary btn-sm" onClick={() => nav(`#/wi/${d.requirement.id}`)}>⬅ לדרישה {d.requirement.key ?? ""}</button>
      </div>

      <PageHead info="page_task"
        title={t.intent}
        sub={`${t.kind === "check" ? "בדיקה" : "משימה"} #${t.seq} · ${t.kind === "check" ? "לא ב-TFS בנפרד" : t.adoType ?? "Task"} · ${t.appetite}${t.origin === "ai" ? " · הוצעה ע\"י AI" : ""}`}
        below={t.linkedAdoId ? (
          <p style={{ margin: "5px 0 0" }}>
            <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 650, color: "var(--color-accent)", textDecoration: "underline" }}>
              🔗 {t.kind === "check" ? "תועד ב-Discussion של המשימה ההורה" : `TFS #${t.linkedAdoId}`} ↗
            </a>
          </p>
        ) : null}
        actions={
          <div className="status-corner">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><TaskStatusPill status={status} /><Info k="task_status" /></span>
            {status.dependency && <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><DependencyTagPill tag={status.dependency} /><Info k="task_dependency_tag" /></span>}
            {status.reason && <span style={{ fontSize: 11.5, maxWidth: 280, textAlign: "end", color: status.tone === "critical" ? "var(--status-critical)" : status.tone === "warning" ? "var(--status-warning)" : "var(--ink-500)" }}>{status.reason}</span>}
          </div>
        }
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button className="btn btn-secondary btn-sm" disabled={running} onClick={openEdit}>✎ ערוך משימה</button>
        <button className="btn btn-secondary btn-sm" disabled={running || delLoading} onClick={openDelete} style={{ color: "var(--status-critical)" }}>{delLoading && !delReport ? "בודק…" : "🗑 מחק משימה"}</button>
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          <button className="btn btn-secondary btn-sm" disabled={togglingSelf} onClick={toggleSelf}>{togglingSelf ? "מעדכן…" : t.active ? "◻ השבת משימה" : "☐ הפעל מחדש"}</button>
          <Info k="task_deactivate" />
        </span>
        {t.kind === "task" && t.linkedAdoId && (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <button className="btn btn-secondary btn-sm" disabled={adoRechecking} onClick={doAdoRecheck}>{adoRechecking ? "בודק…" : "🔄 בדוק סטטוס מול TFS"}</button>
            <Info k="task_ado_recheck" />
          </span>
        )}
        {adoRecheckMsg && <span style={{ fontSize: 11.5, color: "var(--ink-500)" }}>{adoRecheckMsg}</span>}
      </div>

      {err && <div className="ob-note crit" style={{ marginBottom: 12 }}>{err}</div>}

      {!t.active && (
        <div className="ob-note" style={{ marginBottom: 12, background: "var(--status-inactive-bg)", color: "var(--ink-500)" }}>
          ⚪ {t.kind === "check" ? "בדיקה" : "משימה"} לא פעילה — לא מופיעה ב-Flow ובתלויות, ולא בשער הסגירה. ההיסטוריה נשארת.
          {t.kind === "task" && t.linkedAdoId ? " עודכן ב-TFS ל-Removed." : ""}
        </div>
      )}

      {/* the first gate: approval (which also creates the TFS item) */}
      {!t.approvedAt && (
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <button className="btn btn-primary" disabled={approving} onClick={doApprove}>
            {approving ? "מאשר…" : t.kind === "check" ? "✓ אישור הקמת בדיקה" : "✓ אישור הקמת משימה ב-TFS"}
          </button>
          <Info k="approve" />
        </div>
      )}
      {/* the second: no work before there is a TFS item to track it on */}
      {t.approvedAt && t.kind === "task" && !inTfs && (
        <div className="ob-note warn" style={{ marginBottom: 14 }}>
          <b>🔒 המשימה אושרה, אבל עוד לא הוקמה ב-TFS</b><Info k="task_tfs_gate" />
          <div style={{ marginTop: 2 }}>אי אפשר להתחיל לפתח לפני שיש לה work item — עליו העבודה נעקבת.</div>
          {tfsErr && <div style={{ marginTop: 6, fontSize: 11.5 }}>הניסיון האחרון נכשל: {tfsErr}</div>}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center" }}>
            <button className="btn btn-secondary btn-sm" disabled={approving} onClick={doApprove}>{approving ? "מנסה…" : "נסה שוב להקים ב-TFS"}</button>
            <Info k="task_retry_tfs" />
          </div>
        </div>
      )}

      {delReport && (
        <Card tone={delReport.safe ? undefined : "crit"}>
          <CardTitle as="h3" info="task_delete" style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>מחיקת משימה #{t.seq}</CardTitle>
          {delReport.safe ? (
            <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>אין תת-פריטים, אין קישור ל-TFS, אין קוד שמומש, ואין משימות אחרות שנגעו באותם קבצים — מחיקה בטוחה.</p>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--ink-600)", marginBottom: 12 }}>נמצאו {delReport.subtree.length} פריטים שיימחקו. יש לאשר כל נקודה רגישה בנפרד לפני שהמחיקה תתבצע.</p>
          )}
          {delReport.hasChildren && (
            <div className="field" style={{ marginBottom: 10 }}>
              {/* no-info: a warning written as a full sentence, with the detail under it */}
              <label style={{ color: "var(--status-critical)" }}>{delReport.subtree.length - 1} תת-פריטים יימחקו יחד עם המשימה</label>
              <div className="rowlist" style={{ marginTop: 4 }}>
                {delReport.subtree.filter((n) => n.id !== t.id).map((n) => (
                  <div className="row" key={n.id} style={{ fontSize: 12 }}>
                    <span>
                      #{n.seq} {n.kind === "check" ? "✓ בדיקה" : "משימה"} · {STATE_HE[n.state] ?? n.state}
                      {n.linkedAdoId ? <> · {n.adoUrl ? <a href={n.adoUrl} target="_blank" rel="noreferrer" style={{ color: "var(--status-healthy)" }}>TFS #{n.linkedAdoId} ↗</a> : `TFS #${n.linkedAdoId}`}</> : ""}
                      {n.commitCount ? ` · ${n.commitCount} commits` : ""}
                    </span>
                    <span className="spacer" />
                    <span style={{ color: "var(--ink-500)" }}>{n.intent.slice(0, 50)}</span>
                  </div>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 8 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckSubtree} onChange={(e) => setDelAckSubtree(e.target.checked)} />
                מבין/ה שכל אלה יימחקו יחד עם המשימה
              </label>
            </div>
          )}
          {delReport.hasAdoLinks && (
            <div className="field" style={{ marginBottom: 10 }}>
              {/* no-info: a warning written as a full sentence, with the detail under it */}
              <label style={{ color: "var(--status-critical)" }}>חלק כבר קיים ב-TFS</label>
              <p style={{ fontSize: 12, color: "var(--ink-600)", marginTop: 2 }}>
                פריטי TFS <b>לא</b> יימחקו — רק יתועד עליהם ב-Discussion שהוסרו מ-DCC:{" "}
                {delReport.subtree.filter((n) => n.linkedAdoId).map((n) => <a key={n.id} href={n.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ marginInlineEnd: 6 }}>#{n.linkedAdoId}</a>)}
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 6 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckAdo} onChange={(e) => setDelAckAdo(e.target.checked)} />
                מבין/ה שהפריטים ב-TFS נשארים שם ולא נמחקים
              </label>
            </div>
          )}
          {delReport.hasImplementedCode && (
            <div className="field" style={{ marginBottom: 10 }}>
              {/* no-info: a warning written as a full sentence, with the detail under it */}
              <label style={{ color: "var(--status-critical)" }}>יש קוד מומש שטרם בוטל</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, marginTop: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" style={{ minWidth: 0 }} checked={delCodeChoice === "rollback"} onChange={() => setDelCodeChoice("rollback")} />
                  בטל את השינויים קודם (rollback) — מומלץ
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" style={{ minWidth: 0 }} checked={delCodeChoice === "orphan"} onChange={() => setDelCodeChoice("orphan")} />
                  השאר את ה-commits כ"יתומים" בקלון המבודד — לא נמחקים בפועל, אבל לא נגישים דרך DCC יותר
                </label>
              </div>
            </div>
          )}
          {delReport.hasCoTouch && (
            <div className="field" style={{ marginBottom: 10 }}>
              {/* no-info: a warning written as a full sentence, with the detail under it */}
              <label style={{ color: "var(--status-critical)" }}>{delReport.coTouchedBy.length} משימות אחרות כבר נגעו באותם קבצים</label>
              <div className="rowlist" style={{ marginTop: 4 }}>
                {delReport.coTouchedBy.map((c) => (
                  <div className="row" key={c.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: 3, paddingBlock: 6 }}>
                    <span className="w-title" style={{ fontSize: 12.5 }} onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent.slice(0, 60)}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>{c.files.join(", ")}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 6 }}>מחיקת המשימה לא תשנה את ה-branch של המשימות האלה — אבל ייתכן שהן תלויות בשינוי הזה או כופלות אותו.</p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 6 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckCoTouch} onChange={(e) => setDelAckCoTouch(e.target.checked)} />
                בדקתי את המשימות האלה ורוצה להמשיך במחיקה
              </label>
            </div>
          )}
          {delErr && <p style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 8 }}>{delErr}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={!readyToDelete || delLoading} onClick={confirmDelete} style={{ background: "var(--status-critical)", borderColor: "var(--status-critical)" }}>{delLoading ? "מוחק…" : "אשר מחיקה"}</button>
            <button className="btn btn-secondary" onClick={() => setDelReport(null)}>ביטול</button>
          </div>
        </Card>
      )}

      {editing && (
        <Card>
          {/* a form that shows its own fields; nothing to explain beyond them */}
          <CardTitle as="h3" info={null} style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 10 }}>עריכת משימה</CardTitle>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>כותרת / intent<Info k="task_intent" /></label>
            <textarea value={editIntent} onChange={(e) => setEditIntent(e.target.value)} rows={2} />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>ההוראה למשימה<Info k="task_instruction" /></label>
            <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={5} placeholder="ריק = ישתמש ב-intent" />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>גודל<Info k="task_size" /></label>
            <select value={editAppetite} onChange={(e) => setEditAppetite(e.target.value as "small" | "standard" | "large")}>
              <option value="small">small</option>
              <option value="standard">standard</option>
              <option value="large">large</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            {/* no-info: a question whose options explain themselves */}<label>מה מאפיין את השינוי?</label>
            <div style={{ display: "flex", gap: 14, fontSize: 12.5, marginTop: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" style={{ minWidth: 0 }} checked={editScope === "text"} onChange={() => setEditScope("text")} />
                רק ניסוח / הבהרה — ההיקף לא השתנה
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="radio" style={{ minWidth: 0 }} checked={editScope === "scope"} onChange={() => setEditScope("scope")} />
                היקף העבודה השתנה — צריך לבדוק תלויות/בדיקות מחדש
              </label>
            </div>
            {editScope === "scope" && <p style={{ fontSize: 11.5, color: "var(--status-warning)", marginTop: 6 }}>יתועד כך גם ב-DCC וגם ב-Discussion של TFS (אם קיים). מומלץ לעבור על הפירוק/הבדיקות של המשימה מול השינוי.</p>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>{saving ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>ביטול</button>
          </div>
        </Card>
      )}

      {t.kind === "task" && d.blockedBy.length > 0 && (
        <Card tone={d.blockedBy.some((b) => b.state !== "done") ? "crit" : undefined}>
          <CardTitle as="h3" info="task_dependencies" style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>תלויות ({d.blockedBy.length})</CardTitle>
          {d.blockedBy.map((b) => (
            <div key={b.id} className={`dep-row ${b.state === "done" ? "closed" : "open"}`}>
              <span className="dot" />
              <span className="w-title" onClick={() => nav(`#/task/${b.id}`)}>#{b.seq} — {b.intent.slice(0, 90)}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: b.state === "done" ? "var(--status-active)" : "var(--status-critical)", whiteSpace: "nowrap" }}>{b.state === "done" ? "הושלמה" : STATE_HE[b.state] ?? b.state}</span>
            </div>
          ))}
          {d.blockedBy.some((b) => b.state !== "done") && (
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 8 }}>אפשר לפתח בכל זאת — המשימה נסגרת רק אחרי שכל התלויות הושלמו.</p>
          )}
          {builtOn && (builtOn.on || builtOn.missing.length > 0) && <BuiltOnCard b={builtOn} nav={nav} />}
        </Card>
      )}

      {t.approvedAt && t.kind === "task" && steps.length > 0 && (
        <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
          <TaskFlowRail steps={steps} active={activeIdx} onPick={setManualStep} />
          <div style={{ padding: 16 }}>
            {sel && (
              <p className="section-lbl" style={{ marginBottom: 8 }}>
                {sel.kind === "dependency" ? "תלות" : STEP_NUM[sel.kind]} — {stepLabel(steps, activeIdx)}<Info k="task_flow_steps" />
              </p>
            )}
            {paneFor(sel)}
          </div>
        </div>
      )}

      {t.approvedAt && t.kind === "check" && (
        <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <p className="section-lbl" style={{ marginBottom: 8 }}>הרצת הבדיקה<Info k="check" /></p>
          <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>קלוד מריץ את הבדיקה על הענף של המשימה שהיא שייכת לה, בלי הרשאה לשנות קבצים.</p>
          {runControls(attempted ? "✦ הרץ את הבדיקה שוב" : "✦ הרץ את הבדיקה")}
          {impl && <p style={{ fontSize: 12.5, color: "var(--ink-700)", whiteSpace: "pre-wrap", marginTop: 12 }}>{impl.summary}</p>}
          {instructionBlock}
        </div>
      )}

      {(subtasks.length > 0 || d.blocks.length > 0) && (
        <Card>
          {subtasks.length > 0 && (
            <>
              <p className="section-lbl" style={{ marginBottom: 6 }}>תת-משימות ({subtasks.length})<Info k="subtasks" /></p>
              <div className="rowlist">
                {subtasks.map((c) => (
                  <div className="row" key={c.id}>
                    <span className="title w-title" onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent}</span>
                    <span className="spacer" />
                    <Pill tone={c.state === "done" ? "healthy" : "inactive"}>{STATE_HE[c.state] ?? c.state}</Pill>
                  </div>
                ))}
              </div>
            </>
          )}
          {d.blocks.length > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 10 }}>{d.blocks.length} משימות מחכות לזו: {d.blocks.map((b) => `#${b.seq}`).join(", ")}</p>
          )}
        </Card>
      )}
    </>
  );
}

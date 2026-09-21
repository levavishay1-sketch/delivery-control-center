import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTask, getTaskRun, implementTask, previewImplement, progressTask, editTask, rollbackTask, pushTask, getTaskCodeMap, type CodeMap,
  precheckTaskDelete, deleteTask, DeleteBlocked, approveTask, ChecksNotPassed, setTaskActive, checkAdoRecheck,
  type FlowRun, type ImplementResult, type TaskDetail as TD, type TaskDeletePrecheck,
} from "../api.ts";
import { CardTitle, PageHead, Pill, PromptPreviewModal, CopyBtn } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { CodeMapPanel } from "../components/CodeMap.tsx";
import { useClaudeContext } from "../claude/context.ts";
import { StepRail } from "./WorkflowTab.tsx";

/**
 * One task — the unit that actually reaches TFS and gets built. Its own
 * gated FLOW, same pattern as the requirement's: פיתוח → סקירה והחלטה →
 * הושלם. "תן ל-Claude לפתח" runs the local CLI with write tools on an
 * ISOLATED clone (never the user's own checkout), on a task branch, and
 * commits locally. It never pushes on its own — "⬆ Push ל-GitHub" is the
 * deliberate, explicit action inside the review step, once the user has
 * decided to keep what changed.
 */

const STATE_HE: Record<string, string> = {
  pending: "ממתין", in_progress: "בעבודה", blocked: "חסום", failed_checks: "נפל בבדיקות", done: "הושלם", dropped: "נדחה",
};

const TASK_STEPS = [
  { key: "implement", label: "פיתוח" },
  { key: "review", label: "סקירה והחלטה" },
  { key: "done", label: "הושלם" },
] as const;

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

const Card = ({ children, tone }: { children: React.ReactNode; tone?: "crit" | "ok" }) => (
  <div style={{
    border: `1px solid ${tone === "crit" ? "var(--status-critical)" : tone === "ok" ? "var(--status-healthy)" : "var(--border-hairline)"}`,
    borderRadius: 12, padding: "14px 16px", marginBottom: 14, background: "var(--surface)",
  }}>{children}</div>
);

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
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ pushed: boolean; reason?: string; branchUrl?: string; compareUrl?: string } | null>(null);
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
  // the permanent prompt section — always visible on the page, not only
  // inside the pre-send modal. Same content, fetched independently so it
  // doesn't depend on the modal ever having been opened.
  const [promptPreview, setPromptPreview] = useState<{ prompt: string; promptHe: string; approved: boolean } | null>(null);
  const [promptLang, setPromptLang] = useState<"he" | "en">("he");
  const [approving, setApproving] = useState(false);
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

  const load = useCallback(() => { getTask(id).then(setD).catch((e) => setErr(String(e))); }, [id]);
  const loadPrompt = useCallback(() => { previewImplement(id).then(setPromptPreview).catch(() => setPromptPreview(null)); }, [id]);
  const loadCodeMap = useCallback(() => { getTaskCodeMap(id).then(setCodeMap).catch(() => setCodeMap(null)); }, [id]);
  const refreshRun = useCallback(async () => {
    try {
      const r = await getTaskRun(id);
      setRun((prev) => { if (prev?.state === "running" && r.state === "done") load(); return r; });
    } catch { /* ignore */ }
  }, [id, load]);

  useEffect(() => { load(); refreshRun(); loadPrompt(); loadCodeMap(); }, [load, refreshRun, loadPrompt, loadCodeMap]);
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(refreshRun, 1500);
    return () => clearInterval(iv);
  }, [running, refreshRun]);

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
      "המשימה": d.task.intent, "מספר": d.task.seq, "סוג": d.task.kind === "check" ? "בדיקה" : "משימה", "מצב": d.task.state, "גודל": d.task.appetite,
      "אושרה": d.task.approvedAt ? "כן" : "עדיין לא", "הדרישה": d.requirement.title, "משימת אב": d.parent ? `#${d.parent.seq}: ${d.parent.intent}` : "(אין)",
      "חסומה על ידי": d.blockedBy.map((t) => `#${t.seq}: ${t.intent}`), "מאגרים": d.repos.map((r) => r.name),
      "הרצה אחרונה": run ? `${run.kind} — ${run.state}` : "(אין)",
      status: d.task.state, nextStep: !d.task.approvedAt ? "לאשר את המשימה, ואז להריץ את הפיתוח" : d.task.state === "done" ? "המשימה הושלמה" : d.task.state === "failed_checks" ? "בדיקות נכשלו — להחליט אם לתקן או לאשר בכל זאת" : "להריץ את הפיתוח, ואז לדחוף את הענף",
    },
    suggestions: ["מה זה בדיקה?", "מה יקרה אם אלחץ על פיתוח?", "מה השלב הבא?"],
    actions: ["implement", "approve_task"],
  } : null);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;
  const t = d.task;
  const blockedOpen = d.blockedBy.filter((b) => b.state !== "done");
  const impl = run?.state === "done" && run.kind === "implement" ? (run.result as unknown as ImplementResult | null) : null;

  // the task's own FLOW: פיתוח → סקירה והחלטה → הושלם. Step 1 unlocks once
  // an implement run has concluded (something to review); step 2 unlocks
  // the same moment — marking done doesn't require having pushed, since
  // not every task ends in a push (some get reviewed and rolled back on
  // purpose, some are finished by other means).
  const attempted = run !== null && run.kind === "implement" && run.state !== "running" && run.state !== "idle";
  const stepDone = [attempted, t.state === "done", t.state === "done"];
  const stepUnlocked = [true, attempted, attempted];
  const defaultStep = !attempted ? 0 : t.state === "done" ? 2 : 1;
  const activeStep = manualStep ?? defaultStep;
  const goStep = (i: number) => setManualStep(i);

  const copy = (s: string, k: string) => { navigator.clipboard?.writeText(s); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  // Step 1 of the gate: fetch the exact prompt and open the preview.
  const openSend = async () => {
    setErr(null); setSendErr(null); setSendData(null); setSendOpen(true); setSendLoading(true);
    try { setSendData(await previewImplement(id)); }
    catch (e) { setSendErr(String(e)); }
    finally { setSendLoading(false); }
  };
  // Step 2: only reachable from the modal's confirm button.
  const confirmSend = async () => {
    if (sending) return;
    setSending(true); setErr(null);
    try { await implementTask(id); setSendOpen(false); setShowLog(true); await refreshRun(); }
    catch (e) { setErr(String(e)); }
    finally { setSending(false); }
  };

  // "אישור הקמת משימה" — the one gate before anything reaches TFS or
  // Claude gets write access. Cascades to child checks and immediately
  // tries to materialize server-side; a failed materialize (e.g. no ADO
  // connection yet) still leaves the approval itself in place.
  const doApprove = async () => {
    setApproving(true); setErr(null);
    try {
      const r = await approveTask(id, { clientId: t.clientId });
      if (r.materializeError) setErr(r.materializeError);
      load(); loadPrompt();
    } catch (e) { setErr(String(e)); }
    finally { setApproving(false); }
  };

  // Deactivating drops a check from its parent's next prompt/preview and
  // from the completion gate, without losing its history; reactivating
  // clears any stale prior result — it needs fresh verification. Either
  // way the parent's own status is re-evaluated server-side (may flip
  // in/out of "נפל בבדיקות", or restore a "done" that a reopened check
  // had bumped out of it).
  const toggleCheck = async (checkId: string, active: boolean) => {
    setTogglingCheck(checkId); setErr(null);
    try { await setTaskActive(checkId, active, t.clientId); load(); loadPrompt(); }
    catch (e) { setErr(String(e)); }
    finally { setTogglingCheck(null); }
  };

  // Same toggle, on the task page's OWN task/check — deactivating drops
  // it from the Flow graph and dependency computation everywhere, and
  // cascades to every child under it; a linked TFS item gets mirrored to
  // "Removed" (best-effort). Reactivating restores just this row.
  const toggleSelf = async () => {
    setTogglingSelf(true); setErr(null);
    try { await setTaskActive(t.id, !t.active, t.clientId); load(); }
    catch (e) { setErr(String(e)); }
    finally { setTogglingSelf(false); }
  };

  // Approving one check directly from the parent's checklist row — same
  // action as "אישור הקמת משימה" on the check's own page, just without
  // leaving this screen. Approving a task normally cascades to its
  // checks, but a check added after that cascade already ran needs its
  // own approval, and this is the faster of the two places to give it.
  const approveCheckRow = async (checkId: string) => {
    setApprovingCheck(checkId); setErr(null);
    try { await approveTask(checkId, { clientId: t.clientId }); load(); }
    catch (e) { setErr(String(e)); }
    finally { setApprovingCheck(null); }
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
      load();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const rollback = async () => {
    if (!confirm("זה יבטל את כל שינויי הקוד שנעשו במשימה הזו (branch מבודד, לא בקוד שלך) ויחזיר אותה ל-\"ממתין\". לא ניתן לשחזר מה-DCC. להמשיך?")) return;
    setRollingBack(true); setErr(null); setRollbackMsg(null);
    try {
      const r = await rollbackTask(id);
      loadCodeMap();
      setRollbackMsg(r.rolledBack ? "✓ שינויי הקוד בוטלו — ה-branch אופס לבסיס. המשימה נקייה כמו לפני שפותחה." : (r.reason ?? "אין מה לבטל."));
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

  return (
    <>
      {sendOpen && (
        <PromptPreviewModal
          title={attempted ? "הרצה חוזרת — פיתוח המשימה" : "תן ל-Claude לפתח את המשימה"}
          data={sendData} loading={sendLoading} error={sendErr}
          onClose={() => { setSendOpen(false); setSendData(null); setSendErr(null); }}
          onConfirm={confirmSend} confirming={sending}
          confirmLabel="✦ שלח ל-Claude, תתחיל לפתח"
        />
      )}
      {/* נאב עליון — תמיד בצד שמאל-למעלה, לא מעורבב עם שאר הכפתורים */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        {t.kind === "check" && d.parent && (
          <button className="btn btn-secondary btn-sm" onClick={() => nav(`#/task/${d.parent!.id}`)}>⬅ למשימה #{d.parent.seq}</button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => nav(`#/wi/${d.requirement.id}`)}>⬅ לדרישה {d.requirement.key ?? ""}</button>
      </div>

      <PageHead info="page_task"
        title={t.intent}
        sub={`${t.kind === "check" ? "בדיקה" : "משימה"} #${t.seq} · ${t.kind === "check" ? "לא ב-TFS בנפרד" : t.adoType ?? "Task"} · ${t.appetite}`}
        actions={
          <>
            <button className="btn btn-secondary" disabled={running} onClick={openEdit}>✎ ערוך משימה</button>
            <button className="btn btn-secondary" disabled={running || delLoading} onClick={openDelete} style={{ color: "var(--status-critical)" }}>
              {delLoading && !delReport ? "בודק…" : "🗑 מחק משימה"}
            </button>
          </>
        }
      />

      {/* אישור הקמת משימה/בדיקה — הפעולה הכי חשובה בדף, מיד מתחת לכותרת. */}
      <div style={{ marginBottom: 10 }}>
        {!t.approvedAt ? (
          <button className="btn btn-primary" disabled={approving} onClick={doApprove}>
            {approving ? "מאשר…" : t.kind === "check" ? "✓ אישור הקמת בדיקה" : "✓ אישור הקמת משימה ב-TFS"}
          </button>
        ) : t.kind === "check" ? (
          <Pill tone="healthy">✓ מאושרת — אושרה יחד עם המשימה ההורה</Pill>
        ) : !t.linkedAdoId ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Pill tone="warning">מאושר — ממתין להקמה ב-TFS</Pill>
            <button className="btn btn-secondary btn-sm" disabled={approving} onClick={doApprove}>{approving ? "מנסה…" : "נסה להקים שוב"}</button>
          </div>
        ) : (
          <Pill tone="healthy">✓ מאושר ומוקם ב-TFS</Pill>
        )}
      </div>

      {!t.active && (
        <div className="callout" style={{ marginBottom: 10, borderColor: "var(--ink-300)" }}>
          <div className="body">
            <p className="r" style={{ color: "var(--ink-500)" }}>
              ⚪ {t.kind === "check" ? "בדיקה" : "משימה"} לא פעילה — לא מופיעה ב-Flow ובתלויות, ולא בפרומפט/שער ההשלמה. ההיסטוריה נשארת.
              {t.kind === "task" && t.linkedAdoId ? " עודכן ב-TFS ל-Removed." : ""}
            </p>
          </div>
        </div>
      )}
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-secondary btn-sm" disabled={togglingSelf} onClick={toggleSelf}>
          {togglingSelf ? "מעדכן…" : t.active ? "◻ השבת" : "☐ הפעל מחדש"}
        </button>
        {t.kind === "task" && t.linkedAdoId && (
          <button className="btn btn-secondary btn-sm" disabled={adoRechecking} onClick={doAdoRecheck}>
            {adoRechecking ? "בודק…" : "🔄 בדוק סטטוס מול TFS"}
          </button>
        )}
        {adoRecheckMsg && <span style={{ fontSize: 11.5, color: "var(--ink-500)" }}>{adoRecheckMsg}</span>}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <Pill tone={t.state === "done" ? "healthy" : t.state === "in_progress" ? "active" : (t.state === "blocked" || t.state === "failed_checks") ? "critical" : "inactive"}>
          {STATE_HE[t.state] ?? t.state}
        </Pill>
        {t.kind === "check"
          ? <Pill tone="neutral">✓ בדיקה — לא work item בפני עצמה</Pill>
          : <Pill tone={t.adoType && t.adoType !== "Task" ? "ai" : "inactive"}>{t.adoType ?? "Task"}</Pill>}
        {t.linkedAdoId && (t.kind === "check"
          ? <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--status-healthy)" }}>תועד ב-Discussion של המשימה ההורה ↗</a>
          : <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--status-healthy)" }}>TFS #{t.linkedAdoId} ↗</a>)}
        {t.origin === "ai" && <Pill tone="ai">הוצע ע"י AI</Pill>}
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <CardTitle as="h3" info="prompt_preview" style={{ fontSize: 14.5, fontWeight: 650, margin: 0 }}>הפרומט שיישלח ל-Claude</CardTitle>
          {promptPreview && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <a onClick={() => setPromptLang("he")} style={{ fontSize: 11.5, fontWeight: promptLang === "he" ? 700 : 400, cursor: "pointer", color: promptLang === "he" ? "var(--color-accent)" : "var(--ink-500)" }}>עברית</a>
              <CopyBtn text={promptPreview.promptHe} />
              <span style={{ color: "var(--ink-300)" }}>·</span>
              <a onClick={() => setPromptLang("en")} style={{ fontSize: 11.5, fontWeight: promptLang === "en" ? 700 : 400, cursor: "pointer", color: promptLang === "en" ? "var(--color-accent)" : "var(--ink-500)" }}>English</a>
              <CopyBtn text={promptPreview.prompt} />
            </div>
          )}
        </div>
        <div style={{
          fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", background: "var(--surface-muted)", borderRadius: 8,
          padding: "10px 12px", maxHeight: 280, overflowY: "auto",
          direction: promptLang === "en" ? "ltr" : "rtl", textAlign: promptLang === "en" ? "left" : "right",
        }}>
          {promptPreview ? (promptLang === "he" ? promptPreview.promptHe : promptPreview.prompt) : (t.prompt || t.intent)}
        </div>
        {t.affectedPaths.length > 0 && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>קבצים צפויים<Info k="expected_files" /></label>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{t.affectedPaths.join(", ")}</div>
          </div>
        )}
        {t.compiledComponents.length > 0 && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>רכיבים מתקמפלים<Info k="compiled_components" /></label>
            <p style={{ fontSize: 10.5, color: "var(--ink-500)", marginTop: -2, marginBottom: 3 }}>
              הפרוייקטים שצריך לבנות ולפרוס יחד עם השינוי הזה.
            </p>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{t.compiledComponents.join(", ")}</div>
          </div>
        )}
      </Card>

      {delReport && (
        <Card tone={delReport.safe ? undefined : "crit"}>
          <CardTitle as="h3" info="task_delete" style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 4 }}>מחיקת משימה #{t.seq}</CardTitle>
          {delReport.safe ? (
            <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>
              אין תת-פריטים, אין קישור ל-TFS, אין קוד שמומש, ואין משימות אחרות שנגעו באותם קבצים — מחיקה בטוחה.
            </p>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--ink-600)", marginBottom: 12 }}>
              נמצאו {delReport.subtree.length} פריטים שיימחקו. יש לאשר כל נקודה רגישה בנפרד לפני שהמחיקה תתבצע.
            </p>
          )}

          {delReport.hasChildren && (
            <div className="field" style={{ marginBottom: 10 }}>
              {/* no-info: a warning written as a full sentence, with the detail under it */}
              <label style={{ color: "var(--status-critical)" }}>
                {delReport.subtree.length - 1} תת-פריטים יימחקו יחד עם המשימה
              </label>
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
                {delReport.subtree.filter((n) => n.linkedAdoId).map((n) => (
                  <a key={n.id} href={n.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ marginInlineEnd: 6 }}>#{n.linkedAdoId}</a>
                ))}
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
              <label style={{ color: "var(--status-critical)" }}>
                {delReport.coTouchedBy.length} משימות אחרות כבר נגעו באותם קבצים
              </label>
              <div className="rowlist" style={{ marginTop: 4 }}>
                {delReport.coTouchedBy.map((c) => (
                  <div className="row" key={c.id} style={{ flexDirection: "column", alignItems: "flex-start", gap: 3, paddingBlock: 6 }}>
                    <span className="w-title" style={{ fontSize: 12.5 }} onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent.slice(0, 60)}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>{c.files.join(", ")}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 6 }}>
                מחיקת המשימה לא תשנה את ה-branch של המשימות האלה — אבל ייתכן שהן תלויות בשינוי הזה או כופלות אותו.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 6 }}>
                <input type="checkbox" style={{ minWidth: 0 }} checked={delAckCoTouch} onChange={(e) => setDelAckCoTouch(e.target.checked)} />
                בדקתי את המשימות האלה ורוצה להמשיך במחיקה
              </label>
            </div>
          )}

          {delErr && <p style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 8 }}>{delErr}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={!readyToDelete || delLoading} onClick={confirmDelete} style={{ background: "var(--status-critical)", borderColor: "var(--status-critical)" }}>
              {delLoading ? "מוחק…" : "אשר מחיקה"}
            </button>
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
            <label>הפרומט המדוייק שיורץ ל-Claude<Info k="prompt_preview" /></label>
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
            {editScope === "scope" && (
              <p style={{ fontSize: 11.5, color: "var(--status-warning)", marginTop: 6 }}>
                יתועד כך גם ב-DCC וגם ב-Discussion של TFS (אם קיים). מומלץ לעבור על הפירוק/הבדיקות של המשימה מול השינוי.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>{saving ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>ביטול</button>
          </div>
        </Card>
      )}

      {blockedOpen.length > 0 && (
        <Card tone="crit">
          <p style={{ fontSize: 13, marginBottom: 8 }}>המשימה תלויה ב-{blockedOpen.length} משימות שטרם הושלמו:</p>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5 }}>
            {blockedOpen.map((b) => (
              <li key={b.id} style={{ marginBottom: 3 }}>
                <span className="w-title" onClick={() => nav(`#/task/${b.id}`)}>#{b.seq} {b.intent.slice(0, 70)}</span>
                <span style={{ color: "var(--ink-400)" }}> — {STATE_HE[b.state] ?? b.state}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 8 }}>אפשר לפתח בכל זאת, אבל ייתכן שהבסיס עוד לא קיים.</p>
        </Card>
      )}

      {/* the entire dev-steps rail is gated on approval — an unapproved
          task shows only the approve card above, not a disabled-looking
          preview of steps it can't reach yet. */}
      {t.approvedAt && (
      <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
        <StepRail steps={TASK_STEPS} done={stepDone} unlocked={stepUnlocked} active={activeStep} onPick={goStep} busy={running} />
        <div style={{ padding: 16 }}>

          {activeStep === 0 && (
            <>
              {running ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                    <p style={{ fontSize: 13, color: "var(--ink-600)", margin: 0 }}>Claude מפתח את המשימה — קורא, עורך, ומריץ מה שאפשר…</p>
                  </div>
                  <Transcript lines={run?.lines ?? []} />
                  <p style={{ marginTop: 6, fontSize: 11, color: "var(--ink-400)" }}>
                    רץ ברקע על קלון מבודד, על branch נפרד. אפשר לצאת מהמסך. לא נדחף כלום.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>
                    {attempted ? "אפשר להריץ שוב — למשל אחרי עריכת הפרומט, או כדי לנסות גישה אחרת." : "Claude יקרא, יערוך ויריץ מה שאפשר על קלון מבודד — עוד לא נוגע בקוד שלך ולא בשום remote."}
                  </p>
                  <button className="btn btn-primary" onClick={openSend}>
                    {attempted ? "✦ הרץ שוב" : "✦ תן ל-Claude לפתח"}
                  </button>
                  {run?.state === "error" && (
                    <div style={{ marginTop: 14 }}>
                      <p style={{ fontSize: 13, marginBottom: 6, color: "var(--status-critical)" }}>ההרצה האחרונה נכשלה.</p>
                      <p style={{ fontSize: 12, color: "var(--status-critical)", whiteSpace: "pre-wrap" }}>{run.error}</p>
                    </div>
                  )}
                </>
              )}
              {run && run.lines.length > 0 && !running && (
                <div style={{ marginTop: 14 }}>
                  <a className="link" style={{ fontSize: 12 }} onClick={() => setShowLog((v) => !v)}>
                    {showLog ? "▲ הסתר" : "▼ הצג"} את התמלול המלא של ההרצה
                  </a>
                  {showLog && <div style={{ marginTop: 8 }}><Transcript lines={run.lines} /></div>}
                </div>
              )}
            </>
          )}

          {activeStep === 1 && (
            <>
              {impl && (
                <>
                  <CardTitle as="h3" info="task_result" style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>מה Claude עשה</CardTitle>
                  <p style={{ fontSize: 12.5, color: "var(--ink-700)", whiteSpace: "pre-wrap", lineHeight: 1.65, marginBottom: 12 }}>{impl.summary}</p>

                  {impl.checks && impl.checks.length > 0 && (
                    <div className="field" style={{ marginBottom: 12 }}>
                      <label>תוצאות הבדיקות ({impl.checks.filter((c) => c.passed).length}/{impl.checks.length} עברו)<Info k="check_results" /></label>
                      <div className="rowlist" style={{ marginTop: 4 }}>
                        {impl.checks.map((c) => (
                          <div key={c.seq} className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4, paddingBlock: 8 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <Pill tone={c.passed ? "healthy" : "critical"}>{c.passed ? "✓ עברה" : "✕ נכשלה"}</Pill>
                              <span style={{ fontSize: 12, color: "var(--ink-500)" }}>בדיקה #{c.seq}</span>
                            </div>
                            <p style={{ fontSize: 12.5, color: "var(--ink-700)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{c.detail}</p>
                            {!c.passed && c.likelyCause && (
                              <p style={{ fontSize: 11.5, color: "var(--status-warning)" }}>
                                {c.likelyCause === "requirement_ambiguity"
                                  ? "⚠ יתכן שהסיבה היא עמימות בדרישה או בשלבים המקדימים, לא תקלה במימוש — כדאי לבדוק את הדרישה לפני שמנסים שוב."
                                  : "⚠ כנראה תקלת מימוש — כדאי לבדוק את הקוד שנכתב."}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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
                      <p style={{ fontSize: 11, color: "var(--ink-500)", marginTop: -2, marginBottom: 6 }}>
                        קוד אחר שמפנה/משתמש בקבצים ששונו — יש לשקול לאסוף ולעדכן אותם יחד לפריסת טסט.
                      </p>
                      <div className="rowlist">
                        {impl.affectedConsumers.map((c, i) => (
                          <div className="row" key={i} style={{ alignItems: "flex-start", flexDirection: "column", gap: 3, paddingBlock: 8 }}>
                            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{c.path}</span>
                            <span style={{ fontSize: 12, color: "var(--ink-700)" }}>{c.reason}</span>
                            {c.usedBy.length > 0 && (
                              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>
                                ← {c.usedBy.join(", ")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {impl.testsRun && (
                    <div className="field" style={{ marginBottom: 10 }}>
                      <label>בדיקות<Info k="check" /></label>
                      <p style={{ fontSize: 12.5 }}>{impl.testsRun}</p>
                    </div>
                  )}
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>איפה זה יושב<Info k="where_it_sits" /></label>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", whiteSpace: "pre-wrap" }}>
                      {`${impl.dir}\n${impl.branch}${impl.commit ? `  (commit ${impl.commit})` : "  — ללא שינויים"}`}
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 14 }}>
                    <label>לבדיקה מקומית<Info k="local_check" /></label>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ whiteSpace: "pre-wrap" }}>{`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`}</span>
                      <a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`, "cmd")}>{copied === "cmd" ? "✓" : "העתק"}</a>
                    </div>
                  </div>

                  {impl.followUps.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <p className="section-lbl" style={{ marginBottom: 6 }}>המשך שנשאר<Info k="remaining_work" /></p>
                      <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                        {impl.followUps.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}

                  {codeMap?.codeMap
                    ? <div style={{ marginTop: 14 }}><CodeMapPanel map={codeMap.codeMap} title={`מצב הקוד · ${codeMap.branch ?? ""}`} /></div>
                    : codeMap?.reason
                      ? <p className="ob-sub" style={{ marginTop: 14, fontSize: 12, color: "var(--ink-500)" }}>{codeMap.reason}</p>
                      : null}

                  <div style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 14, marginTop: 14, display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" disabled={pushing || rollingBack} onClick={push}>
                      {pushing ? "דוחף…" : "⬆ Push ל-GitHub"}
                    </button>
                    <button className="btn btn-secondary" disabled={pushing || rollingBack} onClick={rollback}>
                      {rollingBack ? "מבטל…" : "↩ Rollback"}
                    </button>
                  </div>

                  {pushResult && (
                    <div className="callout" style={{ marginTop: 12 }}>
                      <div className="body">
                        {pushResult.pushed ? (
                          <>
                            <p className="r">✓ נדחף ל-GitHub.</p>
                            <p style={{ display: "flex", gap: 14, marginTop: 4 }}>
                              {pushResult.branchUrl && <a href={pushResult.branchUrl} target="_blank" rel="noreferrer">צפה ב-branch ↗</a>}
                              {pushResult.compareUrl && <a href={pushResult.compareUrl} target="_blank" rel="noreferrer">פתח Pull Request ↗</a>}
                            </p>
                          </>
                        ) : (
                          <p className="r" style={{ color: "var(--status-critical)" }}>{pushResult.reason ?? "ה-push נכשל."}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {rollbackMsg && (
                    <div className="callout" style={{ marginTop: 12 }}>
                      <div className="body"><p className="r">{rollbackMsg}</p></div>
                    </div>
                  )}
                </>
              )}

              {!impl && run?.state === "rolled_back" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Pill tone="inactive">↩ בוטל</Pill>
                    <CardTitle as="h3" info="task_previous_run" style={{ fontSize: 13.5, fontWeight: 650, margin: 0, color: "var(--ink-600)" }}>הרצה קודמת — הקוד בוטל, המשימה נקייה כרגע</CardTitle>
                  </div>
                  {(() => {
                    const old = run.result as unknown as ImplementResult | null;
                    if (!old) return null;
                    return (
                      <>
                        <p style={{ fontSize: 12.5, color: "var(--ink-500)", whiteSpace: "pre-wrap", lineHeight: 1.6, marginBottom: 8 }}>{old.summary}</p>
                        {old.filesChanged.length > 0 && (
                          <div className="field">
                            {/* no-info: a list of file names from the run that was cancelled */}
                            <label>קבצים שהשתנו אז (כבר לא קיימים ב-branch)</label>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-500)", direction: "ltr", textAlign: "left" }}>
                              {old.filesChanged.join(", ")}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 8 }}>
                    אפשר לחזור לשלב הפיתוח ולהריץ מחדש בכל רגע.
                  </p>
                </>
              )}

              {!impl && run?.state === "error" && (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 6, color: "var(--status-critical)" }}>ההרצה נכשלה — אין מה לסקור.</p>
                  <p style={{ fontSize: 12, color: "var(--status-critical)", whiteSpace: "pre-wrap" }}>{run.error}</p>
                </div>
              )}
            </>
          )}

          {activeStep === 2 && (
            <>
              {t.state === "done" ? (
                <>
                  <p style={{ fontSize: 13.5, color: "var(--status-healthy)", marginBottom: reopenOpen ? 10 : 0 }}>✓ המשימה סומנה כהושלמה.</p>
                  {!reopenOpen ? (
                    <a onClick={() => setReopenOpen(true)} style={{ fontSize: 12, color: "var(--ink-500)", cursor: "pointer" }}>↩ פתח מחדש</a>
                  ) : (
                    <div className="field">
                      {/* no-info: the label says what is being asked and where the answer is kept */}
                      <label>למה לפתוח מחדש? (יישמר בהיסטוריית הדרישה)</label>
                      <textarea
                        value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2}
                        placeholder="למשל: נמצא באג, נדרש שינוי נוסף, וכו׳"
                        style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          className="btn btn-secondary" disabled={reopening || !reopenReason.trim()}
                          onClick={async () => {
                            setReopening(true);
                            try {
                              await progressTask(t.id, { to: "in_progress", clientId: t.clientId, reopenReason });
                              setReopenOpen(false); setReopenReason(""); load();
                            } catch (e) { setErr(String(e)); }
                            finally { setReopening(false); }
                          }}
                        >
                          {reopening ? "פותח…" : "↩ פתח מחדש עם הסיבה הזו"}
                        </button>
                        <button className="btn btn-secondary" onClick={() => { setReopenOpen(false); setReopenReason(""); }}>ביטול</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {t.state === "failed_checks" && (
                    <div className="callout" style={{ borderColor: "var(--status-critical)", marginBottom: 12 }}>
                      <div className="body">
                        <p className="r" style={{ color: "var(--status-critical)" }}>
                          יש בדיקות שלא עברו — אי אפשר לסמן כהושלם בלי לטפל בהן קודם, אלא אם מאשרים ידנית למרות הכישלון.
                        </p>
                        <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 12.5 }}>
                          {d.children.filter((c) => c.kind === "check" && c.checkResult !== "passed").map((c) => (
                            <li key={c.id}>
                              <span className="w-title" onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent.slice(0, 60)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <p style={{ fontSize: 13, color: "var(--ink-700)", marginBottom: 12 }}>
                    לסמן שהעבודה של DCC על המשימה הזו נגמרה. אפשר לעשות זאת גם בלי push — לא כל משימה מסתיימת בקוד.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" disabled={completing} onClick={() => markDone(false)}>
                      {completing ? "מסמן…" : "סמן כהושלם"}
                    </button>
                    {(t.state === "failed_checks" || doneErr) && !overrideReasonOpen && (
                      <button className="btn btn-secondary" disabled={completing} onClick={() => setOverrideReasonOpen(true)} style={{ color: "var(--status-critical)" }}>
                        אשר ידנית למרות הכישלון
                      </button>
                    )}
                  </div>
                  {overrideReasonOpen && (
                    <div className="field" style={{ marginTop: 10 }}>
                      {/* no-info: the label says what is being asked and where the answer is kept */}
                      <label>למה לאשר בכל זאת? (יישמר בהיסטוריית הדרישה)</label>
                      <textarea
                        value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2}
                        placeholder="למשל: הבדיקה החסומה כבר לא רלוונטית, הוחלט לוותר עליה, וכו׳"
                        style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn btn-secondary" disabled={completing || !overrideReason.trim()} onClick={() => markDone(true)} style={{ color: "var(--status-critical)" }}>
                          {completing ? "מאשר…" : "✓ אשר עם הסיבה הזו"}
                        </button>
                        <button className="btn btn-secondary" onClick={() => { setOverrideReasonOpen(false); setOverrideReason(""); }}>ביטול</button>
                      </div>
                    </div>
                  )}
                  {doneErr && <p style={{ fontSize: 12, color: "var(--status-critical)", marginTop: 8, whiteSpace: "pre-wrap" }}>{doneErr}</p>}
                </>
              )}
            </>
          )}

        </div>
      </div>
      )}

      {(d.children.length > 0 || d.blocks.length > 0) && (
      <Card>
        {d.children.filter((c) => c.kind !== "check").length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="section-lbl" style={{ marginBottom: 6 }}>תת-משימות ({d.children.filter((c) => c.kind !== "check").length})<Info k="subtasks" /></p>
            <div className="rowlist">
              {d.children.filter((c) => c.kind !== "check").map((c) => (
                <div className="row" key={c.id}>
                  <span className="title w-title" onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent}</span>
                  <span className="spacer" />
                  <Pill tone={c.state === "done" ? "healthy" : "inactive"}>{STATE_HE[c.state] ?? c.state}</Pill>
                </div>
              ))}
            </div>
          </div>
        )}
        {d.children.filter((c) => c.kind === "check").length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="section-lbl" style={{ marginBottom: 6 }}>
              רשימת בדיקה להשלמת המשימה ({d.children.filter((c) => c.kind === "check").length})<Info k="check" />
            </p>
            <p style={{ fontSize: 11, color: "var(--ov-label)", marginTop: -4, marginBottom: 6 }}>
              לא work items נפרדים ב-TFS — מתועדות ב-Discussion של המשימה הזו כשהיא מוקמת.
            </p>
            <div className="rowlist">
              {d.children.filter((c) => c.kind === "check").map((c) => {
                const isOpen = expandedCheck === c.id;
                const isActive = c.active !== false;
                return (
                  <div key={c.id}>
                    <div className="row" style={{ cursor: "pointer", opacity: isActive ? 1 : 0.55 }}>
                      <a
                        title={isActive ? "השבת בדיקה — תוצא מהפרומט ומשער ההשלמה, ההיסטוריה נשארת" : "הפעל בדיקה מחדש — תיכנס לפרומט הבא, תזדקק לאימות חדש"}
                        onClick={(e) => { e.stopPropagation(); toggleCheck(c.id, !isActive); }}
                        style={{ marginInlineEnd: 8, cursor: "pointer", color: "var(--ink-500)" }}
                      >
                        {togglingCheck === c.id ? "…" : isActive ? (c.state === "done" ? "☑" : "☐") : "◻"}
                      </a>
                      <span onClick={() => setExpandedCheck(isOpen ? null : c.id)} className="title" style={{ textDecoration: c.state === "done" ? "line-through" : "none", color: c.state === "done" ? "var(--ink-400)" : undefined }}>
                        {isOpen ? "▾" : "▸"} #{c.seq} {c.intent}
                      </span>
                      <span className="spacer" />
                      {!isActive
                        ? <Pill tone="inactive">לא פעילה</Pill>
                        : c.checkResult === "passed"
                          ? <Pill tone="healthy">עברה</Pill>
                          : c.checkResult === "failed"
                            ? <Pill tone="critical">נכשלה</Pill>
                            : c.linkedAdoId ? <Pill tone="healthy">תועד ב-Discussion</Pill> : <Pill tone="inactive">{STATE_HE[c.state] ?? c.state}</Pill>}
                      {!c.approvedAt && (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={approvingCheck === c.id}
                          onClick={(e) => { e.stopPropagation(); approveCheckRow(c.id); }}
                          style={{ marginInlineStart: 8 }}
                        >
                          {approvingCheck === c.id ? "מאשר…" : "✓ אישור"}
                        </button>
                      )}
                      <a onClick={(e) => { e.stopPropagation(); nav(`#/task/${c.id}`); }} style={{ fontSize: 11, marginInlineStart: 10, color: "var(--color-accent)", fontWeight: 600 }}>
                        פתח ↗
                      </a>
                    </div>
                    {isOpen && (
                      <div style={{ background: "var(--surface-muted)", borderRadius: 8, padding: "8px 12px", margin: "4px 0 8px", fontSize: 12.5 }}>
                        <p style={{ marginBottom: 4 }}>סטטוס: {STATE_HE[c.state] ?? c.state}{!isActive ? " · לא פעילה" : ""}{!c.approvedAt ? " · ממתין לאישור הקמה" : ""}</p>
                        {c.checkResolvedBy && (
                          <p style={{ color: "var(--status-warning)", marginBottom: 4 }}>✓ אושרה ידנית ע"י אדם — לא (רק) תוצאת הבדיקה של Claude.</p>
                        )}
                        <a onClick={() => nav(`#/task/${c.id}`)} style={{ fontSize: 11.5, color: "var(--color-accent)", fontWeight: 600, cursor: "pointer" }}>לפרטים המלאים והפרומט של הבדיקה ←</a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {d.blocks.length > 0 && (
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 10 }}>
            {d.blocks.length} משימות מחכות לזו: {d.blocks.map((b) => `#${b.seq}`).join(", ")}
          </p>
        )}
      </Card>
      )}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import {
  answerBlocker, composeGapLetter, correctNote, deleteBlocker, deleteGap, deleteRequirement,
  getBrief, getCostDetail, getDetail, getFlowRun, getCostSummary, getGapLetters, getRetro, startRetro, unlinkRepoFromReq, uploadAttachment, verifyGap,
  type Blocker, type ClientLetter, type ClientLetterHistoryItem, type CostDetailRow, type EventRow, type Gap, type RequirementCostSummary, type RetroRun, type WorkItemDetail,
} from "../api.ts";
import { Pill, TypeChip } from "../ui.tsx";
import { FlowGraph } from "./FlowGraph.tsx";
import { AddNote, EditRequirement, LinkRepoToReq } from "../forms.tsx";
import { WorkflowTab } from "./WorkflowTab.tsx";

const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
const post = async (path: string, body: unknown) => {
  const r = await fetch(`/api${path}`, { method: "POST", headers: { "content-type": "application/json", "x-dcc-hook-token": HOOK, "x-dcc-dev-email": DEV_EMAIL }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

// Overview first (rightmost in RTL), then Timeline, then Dependencies.
const TABS = ["Overview", "Timeline", "Dependencies"] as const;
type Tab = (typeof TABS)[number];

const AI_TYPES = new Set(["gap.proposed", "tasks.proposed", "blocker.raised", "model.routed", "review.completed"]);
const isAi = (e: EventRow) => e.actor.kind !== "user" || AI_TYPES.has(e.type);
const fmt = (t: string) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
/** decision.made trigger → Hebrew label, for the Timeline's highlighted
 *  "why" rows (design notes, `decision-history`). */
const DECISION_LABELS: Record<string, string> = {
  rebreakdown: "פירוק מחדש", task_closed_override: "אישור משימה חרף כישלון בדיקות",
  task_reopened: "פתיחת משימה מחדש", requirement_reopened: "פתיחת דרישה מחדש", direction_changed: "שינוי כיוון",
};
/** Turn a bare URL inside freeform text (a gap answer, say "ראה WI-1284")
 *  into a real link — the only structured "link to another item" a
 *  resolution reliably carries, since the answer itself is freeform. */
const linkify = (text: string) => {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) => /^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)" }}>{p}</a>
    : <span key={i}>{p}</span>);
};
const gist = (e: EventRow) => {
  const p = e.payload;
  if (e.type === "decision.made") return String(p.reason ?? "");
  if (e.type === "client_letter.composed") return `✉ ${p.subject ?? ""} (${p.gapCount ?? 0} שאלות)`;
  return (p.summary || p.body || p.answer || p.description || p.question ||
    (p.model ? `${p.capability} → ${p.model} · ${p.rationale ?? ""}` : "") ||
    (p.verdict ? `${p.verdict}${p.blockingCount ? ` — ${p.blockingCount} blocking` : ""} (${p.findingCount ?? 0} findings)` : "") ||
    (p.taskCount ? `${p.taskCount} tasks, ${p.dependencyCount} deps` : "") ||
    (p.to ? `${p.from ?? "?"} → ${p.to}` : "") || (p.outcome ? `→ ${p.outcome}` : "") ||
    [p.kind, p.branch].filter(Boolean).join(" ") || e.type) as string;
};

export function Record({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<WorkItemDetail | null>(null);
  const [brief, setBrief] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [err, setErr] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [correcting, setCorrecting] = useState<EventRow | null>(null);
  const [newGap, setNewGap] = useState({ description: "", blocking: false });
  const [expandedClosed, setExpandedClosed] = useState<Set<string>>(new Set());
  const [answering, setAnswering] = useState<{ id: string; text: string } | null>(null);
  const [gapHelp, setGapHelp] = useState(false);
  const [letterDetail, setLetterDetail] = useState<ClientLetterHistoryItem | null>(null);
  const [letterBusy, setLetterBusy] = useState(false);
  const [letterCopied, setLetterCopied] = useState(false);
  const [letterPicker, setLetterPicker] = useState<Set<string> | null>(null);
  // Every letter ever composed for this requirement (read back, not
  // re-run) — so navigating away from the detail view before copying
  // one never costs another AI call to get the same text back, and past
  // letters are never simply lost.
  const [letterHistory, setLetterHistory] = useState<ClientLetterHistoryItem[]>([]);
  const [lettersListOpen, setLettersListOpen] = useState(false);
  const refreshLetters = useCallback(() => { getGapLetters(id).then((r) => setLetterHistory(r.letters)).catch(() => {}); }, [id]);
  useEffect(() => { refreshLetters(); }, [refreshLetters]);

  // Per-run cost detail — what the requirement's total AI cost is
  // actually made of (model, duration, tokens, cost per run). Re-fetched
  // fresh every time the breakdown is opened — a stale-once-fetched
  // cache here would silently hide any run that happened after the
  // first open (a real bug a user hit live: a second composed letter
  // never appeared because the list had already been cached from
  // before it existed).
  const [costDetailOpen, setCostDetailOpen] = useState(false);
  const [costDetail, setCostDetail] = useState<CostDetailRow[] | null>(null);
  const [costDetailLoading, setCostDetailLoading] = useState(false);
  const openCostDetail = () => {
    setCostDetailOpen(true);
    setCostDetailLoading(true);
    getCostDetail(id).then((r) => setCostDetail(r.rows)).catch(() => {}).finally(() => setCostDetailLoading(false));
  };
  const [newBlk, setNewBlk] = useState({ questionType: "unclear_requirement", question: "" });
  const [uploading, setUploading] = useState(false);
  const [retroOpen, setRetroOpen] = useState(false);

  // go back to wherever the user came from; fall back to the requirements list
  const back = useCallback(() => {
    const cur = location.hash;
    history.back();
    setTimeout(() => { if (location.hash === cur) nav("#/requirements"); }, 160);
  }, [nav]);

  const reload = useCallback(async () => {
    try {
      const [detail, b] = await Promise.all([getDetail(id), getBrief(id)]);
      setD(detail); setBrief(b); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, [id]);
  useEffect(() => { reload(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The requirement's cumulative Claude cost — every claude.session
  // event ever recorded against it. Refetched whenever a run finishes
  // (piggybacks on the same `runningElsewhere` transition below), not
  // polled continuously — it only changes when a run just completed.
  const [cost, setCost] = useState<RequirementCostSummary | null>(null);
  useEffect(() => { getCostSummary(id).then(setCost).catch(() => {}); }, [id]);

  // A Claude run's own "בעבודה…" indicator lives inside WorkflowTab
  // (under the Overview tab) — but switching to Timeline/Dependencies
  // unmounts it, hiding the one visible sign that anything is still
  // running. This independent, lightweight poll keeps a badge on the
  // Overview tab itself visible from any tab, so leaving Overview never
  // reads as "it stopped."
  const [runningElsewhere, setRunningElsewhere] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => {
      getFlowRun(id).then((r) => {
        if (!alive) return;
        const nowRunning = r.state === "running";
        setRunningElsewhere((was) => {
          // a run just finished — its cost record is now written; refresh.
          if (was && !nowRunning) getCostSummary(id).then(setCost).catch(() => {});
          return nowRunning;
        });
      }).catch(() => {});
    };
    check();
    const iv = setInterval(check, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [id]);

  if (err) return (
    <div className="empty" style={{ textAlign: "center" }}>
      <p>{err.includes("404") ? "הדרישה לא נמצאה (אולי נמחקה)." : err}</p>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={back}>← חזרה</button>
    </div>
  );
  if (!d) return <div className="spin">Loading…</div>;
  const wi = d.workitem;
  const openBlocker = d.blockers.find((b) => b.state === "open");
  const isOpenGap = (g: Gap) => g.state === "proposed" || g.state === "verified";
  const openGaps = d.gaps.filter(isOpenGap);
  const liveTasks = d.tasks.filter((t) => t.state !== "dropped");
  const doneTasks = liveTasks.filter((t) => t.state === "done").length;
  const tasksInTfs = liveTasks.filter((t) => t.linkedAdoId).length;
  const progressPct = liveTasks.length ? Math.round((doneTasks / liveTasks.length) * 100) : 0;

  const onGap = async (g: Gap, outcome: "verified" | "resolved" | "dismissed" | "spun_off", answer?: string) => {
    await verifyGap(g.id, {
      outcome, clientId: wi.clientId,
      ...(outcome === "spun_off" ? { spunOffTitle: g.description.slice(0, 80) } : {}),
      ...(answer ? { answer } : {}),
    });
    setAnswering(null);
    reload();
  };
  const onAnswer = async (b: Blocker, answer: string) => { await answerBlocker(b.id, { answer, clientId: wi.clientId }); reload(); };
  const onDelete = async () => {
    const tfsNote = d.tasks.some((t) => t.linkedAdoId)
      ? `\n\nמשימות שכבר הוקמו ב-TFS יישארו שם — הן פריטי העבודה של הצוות.`
      : "";
    if (!confirm(`למחוק את הדרישה "${wi.title}"? האירועים ב-timeline יישמרו (append-only) אבל יינותקו ממנה.${tfsNote}`)) return;
    try { await deleteRequirement(wi.id); back(); }
    catch (e) { alert(String(e)); }
  };
  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      await uploadAttachment(wi.id, file.name, btoa(bin));
      reload();
    } catch (e) { alert(`העלאת הקובץ נכשלה:\n${e}`); }
    setUploading(false);
  };

  // events superseded by a later correction
  const supersededIds = new Set(d.events.map((e) => e.supersedes).filter(Boolean) as string[]);

  // the gaps/blockers management panel — lives inside step 2 of the
  // workflow card now, not a top-level tab (unchanged functionality).
  const gapsPanel = (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p className="section-lbl" style={{ margin: 0 }}>פערים ואי-בהירויות</p>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          {openGaps.length > 0 && (
            <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--color-accent)", fontWeight: 600 }}
               onClick={() => setLetterPicker(new Set(openGaps.filter((g) => g.whoAnswers === "client").map((g) => g.id)))}>
              ✉ נסח פערים ללקוח
            </a>
          )}
          {letterHistory.length > 0 && (
            <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--ink-500)" }} onClick={() => setLettersListOpen(true)}>
              📄 מכתבים אחרונים ({letterHistory.length})
            </a>
          )}
          <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--color-accent)" }} onClick={() => setGapHelp((v) => !v)}>
            {gapHelp ? "הסתר הסבר" : "מה זה ואיך מתקדמים?"}
          </a>
        </div>
      </div>

      {letterPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setLetterPicker(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(560px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)",
            border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl",
            boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>אילו פערים בהודעה?</h3>
              <a onClick={() => setLetterPicker(null)} style={{ fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)" }}>✕</a>
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>
              מסומנות מראש השאלות שרק מבקש הדרישה יכול להכריע בהן. אפשר לשנות בחירה — לא כל פער צריך להגיע אליו.
            </p>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {openGaps.map((g) => {
                const checked = letterPicker.has(g.id);
                const toggle = () => setLetterPicker((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; });
                return (
                  <label key={g.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--border-hairline)", borderRadius: 10, padding: "9px 11px" }}>
                    <input type="checkbox" style={{ marginTop: 2, minWidth: 0 }} checked={checked} onChange={toggle} />
                    <span style={{ flex: 1 }}>
                      {g.description}
                      <span style={{ display: "block", marginTop: 2 }}>
                        {g.whoAnswers === "client" ? <Pill tone="warning">👤 מבקש הדרישה</Pill> : <Pill tone="neutral">🛠 החלטה שלנו</Pill>}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={letterPicker.size === 0 || letterBusy} onClick={async () => {
                setLetterBusy(true); setLetterCopied(false);
                try {
                  const l = await composeGapLetter(wi.id, Array.from(letterPicker));
                  setLetterDetail({ id: "just-now", subject: l.subject, body: l.body, gapCount: l.gapCount, composedAt: new Date().toISOString(), costUsd: l.costUsd, inputTokens: l.inputTokens, outputTokens: l.outputTokens, model: null });
                  setLetterPicker(null);
                  refreshLetters();
                  getCostSummary(id).then(setCost).catch(() => {}); // this was a real AI call — reflect it in the total right away
                } catch (e) { alert(String(e)); }
                finally { setLetterBusy(false); }
              }}>{letterBusy ? "מנסח…" : `נסח מכתב (${letterPicker.size})`}</button>
              <button className="btn btn-secondary" onClick={() => setLetterPicker(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {lettersListOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setLettersListOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(560px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)",
            border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl",
            boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>מכתבים אחרונים</h3>
              <a onClick={() => setLettersListOpen(false)} style={{ fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)" }}>✕</a>
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 14 }}>לפי סדר ההפקה. לחיצה על מכתב פותחת אותו מלא, כולל העלות המפורטת.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {letterHistory.map((l) => (
                <a key={l.id} onClick={() => { setLetterDetail(l); setLettersListOpen(false); }}
                   style={{ display: "block", border: "1px solid var(--border-hairline)", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{l.subject}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{fmt(l.composedAt)} · {l.gapCount} שאלות{l.costUsd != null ? ` · $${l.costUsd.toFixed(4)}` : ""}</div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {letterDetail && (
        <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setLetterDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(680px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)",
            border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl",
            boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>הודעה למבקש הדרישה</h3>
              <a onClick={() => setLetterDetail(null)} style={{ fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)" }}>✕</a>
            </div>
            <p style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 4 }}>
              {letterDetail.gapCount} שאלות פתוחות, מנוסחות בשפה עסקית · {fmt(letterDetail.composedAt)}. DCC לא שולח — העתק ושלח בעצמך.
            </p>
            <p style={{ fontSize: 11, color: "var(--ink-400)", marginBottom: 14 }}>
              {letterDetail.costUsd != null
                ? `עלות ההרצה: $${letterDetail.costUsd.toFixed(4)}${letterDetail.model ? ` · מודל ${letterDetail.model}` : ""}${letterDetail.inputTokens != null ? ` · ${letterDetail.inputTokens} טוקני קלט / ${letterDetail.outputTokens ?? 0} פלט` : ""} — נכלל בעלות ה-AI הכוללת של הדרישה.`
                : "לא ידוע פירוט עלות עבור מכתב זה."}
            </p>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>נושא</label>
              <div style={{ fontSize: 13.5, fontWeight: 600, background: "var(--surface-muted)", borderRadius: 8, padding: "8px 10px" }}>{letterDetail.subject}</div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>גוף ההודעה</label>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8, background: "var(--surface-muted)", borderRadius: 10, padding: 14, margin: 0, fontFamily: "inherit" }}>{letterDetail.body}</pre>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(`${letterDetail.subject}\n\n${letterDetail.body}`); setLetterCopied(true); setTimeout(() => setLetterCopied(false), 1800); }}>
                {letterCopied ? "✓ הועתק" : "העתק הכל"}
              </button>
              <button className="btn btn-secondary" onClick={() => setLetterDetail(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}

      {gapHelp && (
        <div className="callout" style={{ marginTop: 10, marginBottom: 14, fontSize: 12.5, lineHeight: 1.7 }}>
          <div className="body">
            <p><b>פער</b> = שאלה פתוחה על הדרישה עצמה שצריך לענות עליה לפני שמתחילים. <b>אי אפשר להתקדם לפירוק משימות עד שכל הפערים סגורים</b> — זו הנקודה שבה מונעים בנייה של הדבר הלא נכון. כל פער עוצר את הפירוק באותה מידה, בלי קשר לסימון "דחוף" — הסימון הזה רק עוזר לדעת באיזה לטפל קודם כשיש כמה.</p>
            <p style={{ marginTop: 6 }}>לכל פער מסומן <b>מי יכול לענות</b>: החלטה שלנו (טכנית — אפשר להכריע כאן) או החלטה של מבקש הדרישה (עסקית — צריך לשאול אותו).</p>
            <ul style={{ margin: "6px 0", paddingInlineStart: 18 }}>
              <li><b>ענה</b> — כותב את ההכרעה, או לוחץ על אחת התשובות המוצעות. נשמרת כהערה ונכנסת אוטומטית לפרומפט של הפירוק.</li>
              <li><b>לא פער אמיתי</b> — חובה לכתוב למה. הסיבה נשמרת כדי שהשאלה לא תעלה שוב בהרצה הבאה.</li>
              <li><b>פתח דרישה נפרדת</b> — שאלה אמיתית אבל של סקופ אחר; נפתחת דרישה נפרדת והעבודה כאן ממשיכה.</li>
              <li><b>✉ נסח פערים ללקוח</b> — בוחרים אילו מהשאלות הפתוחות (לא חייב את כולן) והופך אותן למייל בשפה עסקית, בלי קוד. DCC לא שולח — אתה מעתיק ושולח.</li>
            </ul>
            <p style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border-hairline)" }}>
              <b>פער לעומת חוסם (Blocker), למטה בעמוד:</b> פער הוא על <b>הדרישה</b> — עמימות שצריך להכריע בה לפני שמתחילים לבנות. חוסם הוא על <b>העבודה עצמה</b> — משהו שעוצר התקדמות שכבר בעיצומה, למשל גישה חסרה למערכת או חריגת תקציב. ברוב המקרים תשתמשו רק בפערים; חוסם רלוונטי בעיקר כש-Claude נתקע באמצע פיתוח בפועל.
            </p>
          </div>
        </div>
      )}

      <div className="filter-bar" style={{ margin: "10px 0 14px" }}>
        <div className="field" style={{ flex: 1 }}><label>הוסף פער שזיהית בעצמך</label>
          <input value={newGap.description} onChange={(e) => setNewGap({ ...newGap, description: e.target.value })} placeholder="למשל: לא מוגדר מה קורה כשלקוח עובר דרגה באמצע חודש" style={{ minWidth: 260 }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} title="כל פער עוצר את הפירוק בין כה וכה — זה רק מסמן שכדאי לטפל בו קודם">
          <input type="checkbox" style={{ minWidth: 0 }} checked={newGap.blocking} onChange={(e) => setNewGap({ ...newGap, blocking: e.target.checked })} /> דחוף
        </label>
        <button className="btn btn-primary btn-sm" onClick={async () => { if (!newGap.description.trim()) return; await post(`/workitems/${wi.id}/gaps`, { description: newGap.description.trim(), blocking: newGap.blocking, confidence: 1, mode: "interactive" }); setNewGap({ description: "", blocking: false }); reload(); }}>הוסף</button>
      </div>

      {d.gaps.length === 0 && (
        <div className="empty" style={{ marginBottom: 18 }}>אין פערים. הרץ "המשך עם AI" בשלב 1 כדי ש-Claude יבדוק את הדרישה.</div>
      )}

      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        {openGaps.map((g) => (
          <div key={g.id} style={{ border: `1px solid ${g.blocking ? "var(--status-critical)" : "var(--border-hairline)"}`, borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 7 }}>
              {g.whoAnswers === "client"
                ? <Pill tone="warning">👤 החלטה של מבקש הדרישה</Pill>
                : <Pill tone="neutral">🛠 החלטה שלנו</Pill>}
              {g.blocking && <Pill tone="critical">🔴 דחוף</Pill>}
              {g.state === "verified" && <Pill tone="warning">✓ נבדק — ממתין להכרעה</Pill>}
              <span className="stage">ביטחון {Math.round(Number(g.confidence) * 100)}%</span>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.55, marginBottom: g.why ? 4 : 10 }}>{g.description}</div>
            {g.why && <div style={{ fontSize: 12.5, color: "var(--ink-600)", lineHeight: 1.6, marginBottom: 8 }}>{g.why}</div>}
            {g.impactIfWrong && (
              <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 10 }}>
                <b style={{ color: "var(--ink-600)" }}>אם ננחש לא נכון:</b> {g.impactIfWrong}
              </div>
            )}

            {answering?.id === g.id ? (
              <div style={{ display: "grid", gap: 8 }}>
                {g.options.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {g.options.map((o, i) => (
                      <button key={i} className="btn btn-secondary btn-sm" onClick={() => setAnswering({ id: g.id, text: o })}>{o}</button>
                    ))}
                  </div>
                )}
                <textarea
                  value={answering.text} autoFocus rows={3}
                  onChange={(e) => setAnswering({ id: g.id, text: e.target.value })}
                  placeholder="כתוב את ההכרעה — מה ההחלטה, מה עושים. תישמר כהערה ב-timeline והפער ייסגר."
                  style={{ width: "100%", fontSize: 12.5, padding: "8px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={!answering.text.trim()} onClick={() => onGap(g, "resolved", answering.text.trim())}>שמור וסגור פער</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAnswering(null)}>ביטול</button>
                </div>
              </div>
            ) : (
              <>
                {g.options.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {g.options.map((o, i) => (
                      <button key={i} className="btn btn-secondary btn-sm" title="בחר תשובה זו וסגור את הפער" onClick={() => onGap(g, "resolved", o)}>✓ {o}</button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setAnswering({ id: g.id, text: "" })}>✎ הכרע / ענה</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    const why = prompt("למה זה לא פער אמיתי? (יישמר כדי שהשאלה לא תעלה שוב)");
                    if (why?.trim()) onGap(g, "dismissed", why.trim());
                  }}>✕ לא פער אמיתי</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => onGap(g, "spun_off")}>↗ פתח דרישה נפרדת</button>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                  {g.state === "proposed" && <a className="link" style={{ fontSize: 11.5 }} onClick={() => onGap(g, "verified")}>סמן שנבדק, אכריע בהמשך</a>}
                  <a style={{ fontSize: 11.5, cursor: "pointer", color: "var(--ink-400)" }} onClick={async () => { if (confirm("למחוק את הפער לגמרי?")) { await deleteGap(g.id, wi.clientId); reload(); } }}>מחק</a>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {d.gaps.filter((g) => !isOpenGap(g)).length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <p className="section-lbl" style={{ marginBottom: 8 }}>טופלו ({d.gaps.filter((g) => !isOpenGap(g)).length})</p>
          <div className="rowlist">
            {d.gaps.filter((g) => !isOpenGap(g)).map((g) => {
              const open = expandedClosed.has(g.id);
              const toggle = () => setExpandedClosed((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; });
              return (
                <div className="row" key={g.id} style={{ alignItems: "flex-start", flexDirection: "column", cursor: "pointer" }} onClick={toggle}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%" }}>
                    <span style={{ fontSize: 10, color: "var(--ink-400)", marginTop: 2, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: "var(--ink-600)" }}>{g.description}</div>
                    </div>
                    {g.state === "resolved" && <Pill tone="healthy">נענה</Pill>}
                    {g.state === "dismissed" && <Pill tone="inactive">לא פער</Pill>}
                    {g.state === "spun_off" && <Pill tone="inactive">דרישה נפרדת</Pill>}
                    <a className="link" style={{ fontSize: 11 }} onClick={(e) => { e.stopPropagation(); onGap(g, "verified"); }}>החזר לפתוח</a>
                    <a style={{ fontSize: 11, cursor: "pointer", color: "var(--ink-400)" }} onClick={async (e) => { e.stopPropagation(); if (confirm("למחוק את הפער לגמרי?")) { await deleteGap(g.id, wi.clientId); reload(); } }}>מחק</a>
                  </div>
                  {open && (
                    <div style={{ marginInlineStart: 18, marginTop: 6, paddingInlineStart: 10, borderInlineStart: "2px solid var(--border-hairline)" }}>
                      {g.why && <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 4 }}>{g.why}</div>}
                      {g.answer ? (
                        <div style={{ fontSize: 12.5, color: "var(--status-healthy)" }}>← {g.answer}</div>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--ink-400)" }}>אין תשובה שמורה (נסגר לפני שהתכונה הזו נוספה, או נפתח כדרישה נפרדת).</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="section-lbl">חוסמים (Blockers)</p>
      <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: -6, marginBottom: 10 }}>שאלה פתוחה שעוצרת את העבודה עד שמישהו עונה — למשל החלטה שצריך מגורם אחר.</p>
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="field"><label>סוג</label>
          <select value={newBlk.questionType} onChange={(e) => setNewBlk({ ...newBlk, questionType: e.target.value })}>
            <option value="unclear_requirement">דרישה לא ברורה</option><option value="missing_access">חסרה גישה</option><option value="budget_exceeded">חריגת תקציב</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>השאלה</label>
          <input value={newBlk.question} onChange={(e) => setNewBlk({ ...newBlk, question: e.target.value })} placeholder="מה חוסם ומה צריך כדי להמשיך" style={{ minWidth: 260 }} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={async () => { if (!newBlk.question.trim()) return; await post(`/workitems/${wi.id}/blockers`, { questionType: newBlk.questionType, question: newBlk.question.trim() }); setNewBlk({ questionType: "unclear_requirement", question: "" }); reload(); }}>הוסף חוסם</button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {d.blockers.map((b) => <BlockerRow key={b.id} b={b} onAnswer={(a) => onAnswer(b, a)} onDelete={async () => { if (confirm("למחוק את החוסם?")) { await deleteBlocker(b.id, wi.clientId); reload(); } }} />)}
        {d.blockers.length === 0 && <div className="empty">אין חוסמים.</div>}
      </div>
    </div>
  );

  return (
    <>
      {noteOpen && <AddNote workitemId={wi.id} onClose={() => setNoteOpen(false)} onDone={() => { setNoteOpen(false); reload(); }} />}
      {editOpen && <EditRequirement wi={wi} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); reload(); }} />}
      {repoOpen && <LinkRepoToReq workitemId={wi.id} onClose={() => setRepoOpen(false)} onDone={() => { setRepoOpen(false); reload(); }} />}
      {correcting && <CorrectNote ev={correcting} workitemId={wi.id} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); reload(); }} />}
      {retroOpen && <RetroModal workitemId={wi.id} onClose={() => setRetroOpen(false)} />}
      {costDetailOpen && <CostDetailModal rows={costDetail} loading={costDetailLoading} summary={cost} onClose={() => setCostDetailOpen(false)} />}
      <p className="crumb"><a onClick={() => nav(wi.parentId ? `#/wi/${wi.parentId}` : `#/client/${wi.clientId}`)}>← {wi.parentId ? "לדרישת האב" : "ללקוח"}</a></p>
      <div className="rec-head" style={{ justifyContent: "space-between" }}>
        <div className="rec-head" style={{ margin: 0 }}>
          <h1>{wi.title}</h1>
          <TypeChip type={wi.type} />
          {wi.key && <span style={{ fontFamily: "var(--mono)", color: "var(--ink-400)", fontSize: 13 }}>{wi.key}</span>}
          {wi.startedWithOpenBlocker && <Pill tone="warning">התחיל עם חוסם פתוח</Pill>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {wi.phase === "done" && (
            <button className="btn btn-secondary btn-sm" onClick={() => setRetroOpen(true)}>✦ המלצות לשיפור</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setNoteOpen(true)}>+ אירוע</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}>עריכה</button>
          <button className="btn btn-secondary btn-sm" style={{ color: "var(--status-critical)" }} onClick={onDelete}>מחיקה</button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
            {t === "Overview" && runningElsewhere && (
              <span title="Claude עדיין עובד" style={{ display: "inline-flex", marginInlineStart: 6, verticalAlign: "middle" }}>
                <span className="spinner" style={{ width: 10, height: 10 }} />
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="req-bg">
          {openBlocker && (
            <div className="callout crit" style={{ marginBottom: 18 }}>
              <span className="ic"><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--status-critical)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" /></svg></span>
              <div className="body">
                <p className="q">Blocked — {openBlocker.questionType.replace(/_/g, " ")}</p>
                <p className="r">{openBlocker.question}</p>
              </div>
            </div>
          )}

          {/* metrics · repositories · attachments — one row, 3 columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 20, marginBottom: 20 }}>
            <div className="ov-card" style={{ padding: "16px 18px" }}>
              <div className="ov-metric-grid" style={{ marginBottom: 14 }}>
                <div className="ov-metric"><div className="lbl">Phase</div><div className="val">{wi.phase}</div></div>
                <div className="ov-metric"><div className="lbl">Priority</div><div className="val">{wi.priority}</div></div>
                <div className="ov-metric"><div className="lbl">Risk</div><div className="val">{wi.risk}</div></div>
                <div className="ov-metric"><div className="lbl">Executor</div><div className="val">{wi.executor}</div></div>
                <div className="ov-metric"><div className="lbl">AI budget</div><div className="val">{wi.budgetUsd ? `$${wi.budgetUsd}` : "default"}</div></div>
                <div className="ov-metric" style={{ cursor: "pointer" }}
                     title={cost ? `${cost.runCount} הרצות · ${cost.totalInputTokens + cost.totalOutputTokens} tokens — לחץ לפירוט` : undefined}
                     onClick={openCostDetail}>
                  <div className="lbl">עלות AI בפועל 🔍</div>
                  <div className="val">{cost ? `$${cost.totalUsd.toFixed(2)}` : "—"}</div>
                </div>
                <div className="ov-metric"><div className="lbl">TFS</div><div className="val">{tasksInTfs} <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ov-label)" }}>משימות</span></div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "var(--ov-label)", flexShrink: 0 }}>{progressPct}%</span>
                <div className="progress-track" style={{ flex: 1, height: 5, background: "#F0EFF7" }}><div className="progress-fill" style={{ width: `${progressPct}%`, background: "#584EF3" }} /></div>
                <span style={{ fontSize: 11, color: "var(--ov-label)", flexShrink: 0 }}>{doneTasks}/{liveTasks.length} tasks</span>
              </div>
            </div>

            <div className="ov-card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ov-label)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Repositories</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setRepoOpen(true)}>+ קשר</button>
              </div>
              {d.repos.map((r, i) => (
                <div key={r.id} style={{ padding: "8px 0", borderTop: i > 0 ? "1px solid #EAE8F5" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <Pill tone={r.linkKind === "auto" ? "ai" : "neutral"}>{r.linkKind === "auto" ? "מהתהליך" : "ידני"}</Pill>
                    <span style={{ fontWeight: 700, fontSize: 12.5 }}>{r.name}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 10.5, color: "var(--ov-label)", direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.adoRepoRef ?? "—"}</span>
                    <a style={{ fontSize: 11, cursor: "pointer", color: "var(--status-critical)", flexShrink: 0 }} onClick={async () => { if (confirm(`לנתק את ${r.name} מהדרישה?`)) { await unlinkRepoFromReq(wi.id, r.id); reload(); } }}>נתק</a>
                  </div>
                </div>
              ))}
              {d.repos.length === 0 && <div style={{ textAlign: "center", color: "var(--ov-label)", fontSize: 12, padding: "20px 0" }}>אין repositories מקושרים</div>}
            </div>

            <div className="ov-card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ov-label)", textTransform: "uppercase", letterSpacing: "0.04em" }}>צרופות</span>
                <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                  {uploading ? "מעלה…" : "העלה"}
                  <input type="file" hidden disabled={uploading} onChange={(e) => onUpload(e.target.files?.[0])} />
                </label>
              </div>
              {(d.attachments ?? []).map((a, i) => (
                <div key={a.id} style={{ padding: "7px 0", borderTop: i > 0 ? "1px solid #EAE8F5" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  {a.adoUrl ? <a href={a.adoUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name} ↗</a> : <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>}
                  <Pill tone={a.source === "ado" ? "ai" : "inactive"}>{a.source === "ado" ? "TFS" : "DCC"}</Pill>
                </div>
              ))}
              {(d.attachments ?? []).length === 0 && <div style={{ textAlign: "center", color: "var(--ov-label)", fontSize: 12, padding: "20px 0" }}>אין צרופות עדיין</div>}
            </div>
          </div>

          {/* the requirement's full text */}
          <div className="ov-card" style={{ padding: "18px 20px", marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--ov-label)", marginBottom: 8 }}>פירוט הדרישה</p>
            <p style={{ fontSize: 13, lineHeight: 1.8, color: "var(--ov-body)", fontWeight: 500 }}>{wi.title}</p>
          </div>

          {/* every closed gap's resolution, permanently visible right here —
              not three clicks away in the gaps tab. This is exactly what
              explains "why this requirement is basically done" when that's
              what a gap's answer said (e.g. already built elsewhere). */}
          {d.gaps.filter((g) => (g.state === "resolved" || g.state === "dismissed") && g.answer).length > 0 && (
            <div className="ov-card" style={{ padding: "18px 20px", marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--ov-label)", marginBottom: 10 }}>תיעוד — החלטות שנסגרו על הדרישה</p>
              <div style={{ display: "grid", gap: 12 }}>
                {d.gaps.filter((g) => (g.state === "resolved" || g.state === "dismissed") && g.answer).map((g) => (
                  <div key={g.id} style={{ borderInlineStart: `3px solid ${g.state === "resolved" ? "var(--status-healthy)" : "var(--ink-300)"}`, paddingInlineStart: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-700)", marginBottom: 2 }}>{g.description}</div>
                    <div style={{ fontSize: 12.5, color: "var(--ov-body)", lineHeight: 1.6 }}>{linkify(g.answer!)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* the guided workflow: stepper + step content, one unit */}
          <div style={{ marginBottom: 20 }}>
            <WorkflowTab d={d} reload={reload} nav={nav} gapsPanel={gapsPanel} />
          </div>

          <div className="section">
            <p className="section-lbl">Context Brief — what the next Claude session loads</p>
            <div className="panel"><pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", fontSize: 11.5, lineHeight: 1.6, color: "var(--ink-700)" }}>{brief || "—"}</pre></div>
          </div>
        </div>
      )}

      {tab === "Timeline" && (
        <>
          <p className="hint" style={{ fontSize: 11.5, color: "var(--ink-400)", marginBottom: 10 }}>
            ה-timeline הוא append-only. "תיקון" של הערה יוצר אירוע חדש שמחליף את הישן — שום דבר לא נמחק.
          </p>
          <div className="rowlist">
            {d.events.map((e) => {
              const superseded = supersededIds.has(e.id);
              const isDecision = e.type === "decision.made";
              return (
                <div className="row" key={e.id} style={{ alignItems: "flex-start", background: isDecision ? "var(--status-warning-bg)" : isAi(e) ? "var(--status-ai-bg)" : undefined, borderInlineStart: isDecision ? "3px solid var(--status-warning)" : undefined, opacity: superseded ? 0.55 : 1 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-400)", minWidth: 96 }}>{fmt(e.occurredAt)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {isDecision
                        ? <Pill tone="warning">למה: {DECISION_LABELS[String(e.payload.trigger)] ?? String(e.payload.trigger)}</Pill>
                        : isAi(e) ? <Pill tone="ai">AI proposal</Pill> : <Pill tone="active">{e.actor.kind === "user" ? "Person" : "System"}</Pill>}
                      {!isDecision && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink-500)" }}>{e.type}</span>}
                      {superseded && <Pill tone="inactive">תוקן</Pill>}
                      {e.supersedes && <Pill tone="healthy">תיקון</Pill>}
                    </div>
                    <div style={{ fontSize: isDecision ? 13 : 12.5, fontWeight: isDecision ? 600 : 400, color: "var(--ink-700)", marginTop: 3, textDecoration: superseded ? "line-through" : "none" }}>{String(gist(e)).slice(0, 220)}</div>
                  </div>
                  {e.type === "note.added" && !superseded && e.actor.kind === "user" && (
                    <a style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setCorrecting(e)}>תקן</a>
                  )}
                </div>
              );
            })}
            {d.events.length === 0 && <div className="empty">No events yet.</div>}
          </div>
        </>
      )}

      {tab === "Dependencies" && (
        <div style={{ height: "60vh", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-md)", overflow: "hidden", position: "relative" }}>
          <FlowGraph requirementId={wi.id} />
        </div>
      )}
    </>
  );
}

const RETRO_CATEGORIES: { key: "tokenSavings" | "timeSavings" | "unnecessaryActions" | "reworkCausingDecisions" | "breakdownFeedback" | "emphasize"; label: string; tone: "warning" | "healthy" }[] = [
  { key: "reworkCausingDecisions", label: "החלטות שגרמו לעבודה חוזרת", tone: "warning" },
  { key: "unnecessaryActions", label: "פעולות שלא היה צריך", tone: "warning" },
  { key: "tokenSavings", label: "חיסכון בטוקנים", tone: "warning" },
  { key: "timeSavings", label: "חיסכון בזמן", tone: "warning" },
  { key: "breakdownFeedback", label: "משוב על אופן הפירוק", tone: "warning" },
  { key: "emphasize", label: "מה כדאי להמשיך לעשות", tone: "healthy" },
];

/** End-of-requirement retro — its own kick-off + poll, deliberately
 *  against the dedicated `/retro` routes rather than the generic
 *  flow-run ones (design notes, `requirement-retro-recommendations`). */
function RetroModal({ workitemId, onClose }: { workitemId: string; onClose: () => void }) {
  const [run, setRun] = useState<RetroRun | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => getRetro(workitemId).then((r) => { if (alive) setRun(r); }).catch(() => {});
    check();
    const iv = setInterval(() => { if (run?.state === "running" || run === null) check(); }, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [workitemId, run?.state]);
  const start = async () => {
    setStarting(true);
    try { await startRetro(workitemId); const r = await getRetro(workitemId); setRun(r); }
    catch (e) { alert(String(e)); }
    setStarting(false);
  };
  const result = run?.result;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(640px, 100%)", maxHeight: "88vh", overflowY: "auto", padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 650 }}>✦ המלצות לשיפור</h2>
          <a onClick={onClose} style={{ cursor: "pointer", fontSize: 15, color: "var(--ink-500)" }}>✕</a>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 14 }}>ניתוח מבוסס על ה-timeline, ההיסטוריה והעלות בפועל של הדרישה הזו — לא עצות כלליות.</p>

        {(!run || run.state === "idle") && (
          <button className="btn btn-primary" disabled={starting} onClick={start}>{starting ? "מתחיל…" : "הרץ ניתוח"}</button>
        )}

        {run?.state === "running" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0" }}>
            <span className="spinner" style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13, color: "var(--ink-500)" }}>Claude מנתח את הדרישה…</span>
          </div>
        )}

        {run?.state === "error" && (
          <div className="callout crit" style={{ marginTop: 6 }}>
            <div className="body"><p className="r">{run.error}</p></div>
          </div>
        )}
        {run?.state === "error" && <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={start}>נסה שוב</button>}

        {result && (run?.state === "done" || run?.state === "stopped") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
            {result.summary && <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-700)" }}>{result.summary}</p>}
            {RETRO_CATEGORIES.map(({ key, label, tone }) => {
              const items = result[key];
              if (!items || items.length === 0) return null;
              return (
                <div key={key}>
                  <div style={{ marginBottom: 6 }}><Pill tone={tone}>{label}</Pill></div>
                  <ul style={{ margin: 0, paddingInlineStart: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                    {items.map((it, i) => <li key={i} style={{ fontSize: 12.5, color: "var(--ink-700)" }}>{it}</li>)}
                  </ul>
                </div>
              );
            })}
            <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={start} disabled={starting}>{starting ? "מריץ מחדש…" : "↻ הרץ ניתוח מחדש"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

const COST_KIND_LABELS: Record<string, string> = {
  assess: "בחינת בשלות", breakdown: "פירוק למשימות", implement: "פיתוח משימה",
  check: "בדיקה", gap_letter: "ניסוח מכתב ללקוח", retro: "המלצות לשיפור", other: "אחר",
};
const fmtDuration = (ms: number | null) => {
  if (ms == null) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

/** What a requirement's "עלות AI בפועל" total is actually made of — one
 *  row per AI run, newest first (design notes, cost-visibility: a user
 *  could see the total but nothing behind it). */
function CostDetailModal({ rows, loading, summary, onClose }: {
  rows: CostDetailRow[] | null; loading: boolean; summary: RequirementCostSummary | null; onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(760px, 100%)", maxHeight: "88vh", overflowY: "auto", padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ fontSize: 17, fontWeight: 650 }}>פירוט עלות AI</h2>
          <a onClick={onClose} style={{ cursor: "pointer", fontSize: 15, color: "var(--ink-500)" }}>✕</a>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 14 }}>כל הרצת AI שהשתתפה בעלות הכוללת של הדרישה הזו, לפי הפרמטרים בפועל שקבעו את החישוב.</p>

        {summary && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16, padding: "10px 14px", background: "var(--surface-muted)", borderRadius: 10 }}>
            <div><div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>סה"כ</div><div style={{ fontSize: 15, fontWeight: 700 }}>${summary.totalUsd.toFixed(4)}</div></div>
            <div><div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>הרצות</div><div style={{ fontSize: 15, fontWeight: 700 }}>{summary.runCount}</div></div>
            <div><div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>טוקני קלט</div><div style={{ fontSize: 15, fontWeight: 700 }}>{summary.totalInputTokens.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>טוקני פלט</div><div style={{ fontSize: 15, fontWeight: 700 }}>{summary.totalOutputTokens.toLocaleString()}</div></div>
            {Object.entries(summary.byKind).map(([kind, b]) => (
              <div key={kind}><div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>{COST_KIND_LABELS[kind] ?? kind}</div><div style={{ fontSize: 13, fontWeight: 600 }}>${b.usd.toFixed(4)} <span style={{ fontWeight: 400, color: "var(--ink-400)" }}>({b.count})</span></div></div>
            ))}
          </div>
        )}

        {loading && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0" }}><span className="spinner" style={{ width: 16, height: 16 }} /><span style={{ fontSize: 13, color: "var(--ink-500)" }}>טוען…</span></div>}

        {rows && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-hairline)", textAlign: "right" }}>
                  {["מתי", "מה", "מודל", "משך", "צעדים", "טוקני קלט", "טוקני פלט", "עלות"].map((h) => (
                    <th key={h} style={{ padding: "6px 8px", fontWeight: 600, color: "var(--ink-500)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-hairline)" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: "var(--ink-400)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{fmt(r.occurredAt)}</td>
                    <td style={{ padding: "6px 8px" }}>{r.label || (COST_KIND_LABELS[r.kind] ?? r.kind)}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.model ?? "—"}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmtDuration(r.durationMs)}</td>
                    <td style={{ padding: "6px 8px" }}>{r.numTurns ?? "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{r.inputTokens.toLocaleString()}</td>
                    <td style={{ padding: "6px 8px" }}>{r.outputTokens.toLocaleString()}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>${r.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length === 0 && !loading && <div className="empty">עדיין לא נרשמה אף הרצת AI על הדרישה הזו.</div>}
      </div>
    </div>
  );
}

function CorrectNote({ ev, workitemId, onClose, onDone }: { ev: EventRow; workitemId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(String(ev.payload.body ?? ""));
  const [busy, setBusy] = useState(false);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(520px, 100%)", padding: "22px 24px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 650, marginBottom: 12 }}>תיקון הערה</h2>
        <p style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 10 }}>ההערה המקורית תישאר ב-timeline מסומנת "תוקן". זו רשומה חדשה שמחליפה אותה.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", minHeight: 110 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await correctNote(workitemId, ev.id, text.trim()); onDone(); } catch (e) { alert(String(e)); setBusy(false); } }}>{busy ? "שומר…" : "שמור תיקון"}</button>
          <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
        </div>
      </div>
    </div>
  );
}

const BLK_TYPE_HE: Record<string, string> = {
  unclear_requirement: "דרישה לא ברורה", missing_access: "חסרה גישה", budget_exceeded: "חריגת תקציב",
};

function BlockerRow({ b, onAnswer, onDelete }: { b: Blocker; onAnswer: (a: string) => void; onDelete: () => void }) {
  const [text, setText] = useState("");
  const open = b.state === "open";
  return (
    <div style={{ border: `1px solid ${open ? "var(--status-critical)" : "var(--border-hairline)"}`, borderRadius: 12, padding: "12px 14px", background: "var(--surface)" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 7, alignItems: "center", flexWrap: "wrap" }}>
        <Pill tone={open ? "critical" : "healthy"}>{open ? "🔴 חוסם פתוח" : "נענה"}</Pill>
        <span className="stage">{BLK_TYPE_HE[b.questionType] ?? b.questionType}</span>
        <span style={{ flex: 1 }} />
        <a style={{ fontSize: 11, cursor: "pointer", color: "var(--ink-400)" }} onClick={onDelete}>מחק</a>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65 }}>{b.question}</div>
      {b.answer && <div style={{ color: "var(--status-healthy)", fontSize: 12.5, marginTop: 6 }}>← {b.answer}</div>}
      {open && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="התשובה שמאפשרת להמשיך…" style={{ flex: 1, font: "inherit", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }} />
          <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => text.trim() && onAnswer(text.trim())}>שלח תשובה</button>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { cancelCodeQuestion, cancelProposal, getProposalPreview, runCodeQuestion, runProposal, type ChatMessage, type DeclaredCostPayload, type ProposalPayload } from "../api.ts";
import { PromptPreviewModal } from "../ui.tsx";
import { CostLine } from "./CostLine.tsx";
import { errText } from "../screens/onboarding/labels.ts";
import { capabilityLabel, effortLabel, fmtUsd, modelLabel } from "./labels.ts";

/**
 * The cards inside an answer (claude-in-dcc §5, §6.6): a proposal the
 * person approves, a declared cost the person accepts, a refusal that says
 * why. Claude proposes; nothing runs without the click here — and "הצג את
 * מה שיישלח" opens the same preview gate every button uses.
 */
export function ProposalCard({ message, onUpdate }: { message: ChatMessage; onUpdate: (m: ChatMessage, extra?: ChatMessage) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ prompt: string; promptHe: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const act = async (fn: () => Promise<{ message: ChatMessage; answer?: ChatMessage }>) => {
    setBusy(true); setErr(null);
    try { const r = await fn(); onUpdate(r.message, r.answer); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  if (message.kind === "refusal") {
    const p = message.payload as { reason?: string; key?: string };
    return (
      <div className="cc-card no">
        <div className="cap">לא אפשרי מכאן</div>
        <div className="h">{p.reason ?? "הפעולה לא זמינה"}</div>
      </div>
    );
  }

  if (message.kind === "declared_cost") {
    const p = message.payload as unknown as DeclaredCostPayload;
    const done = p.status === "done", cancelled = p.status === "cancelled", failed = p.status === "failed";
    return (
      <div className={`cc-card ${done ? "done" : cancelled || failed ? "no" : "cost"}`}>
        <div className="cap">{done ? "הורץ" : cancelled ? "בוטל" : failed ? "נכשל" : "שאלה שדורשת קריאה בקוד"}</div>
        <div className="h">{p.reason}</div>
        <div className="kv">
          <b>מודל</b><span>{modelLabel(p.estimate.model)} · מאמץ {effortLabel(p.estimate.effort)}</span>
          <b>עלות משוערת</b><span>{fmtUsd(p.estimate.usdMin)} – {fmtUsd(p.estimate.usdMax)}, לפי כמות הקבצים</span>
          <b>גישה</b><span>{p.reads ?? "קריאה בלבד, בעותק המקומי של המאגר"}</span>
        </div>
        {p.error && <div className="ob-note crit" style={{ marginTop: 8 }}>{p.error}</div>}
        {err && <div className="ob-note crit" style={{ marginTop: 8 }}>{err}</div>}
        <div className="acts">
          {p.status === "proposed" && <>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void act(() => runCodeQuestion(message.id))}>{busy ? "קורא בקוד…" : "הרץ"}</button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void act(() => cancelCodeQuestion(message.id))}>לא עכשיו</button>
          </>}
          {p.status === "running" && <span className="ob-sub"><span className="spinner" style={{ width: 12, height: 12, marginInlineEnd: 6, verticalAlign: "middle" }} />קורא בקוד…</span>}
          {done && <span className="ob-sub">✓ התשובה למטה · העלות נרשמה תחת השאלה הזו</span>}
          {cancelled && <span className="ob-sub">לא הורץ. שום דבר לא נרשם מלבד השאלה.</span>}
        </div>
      </div>
    );
  }

  const p = message.payload as unknown as ProposalPayload;
  const done = p.status === "done", cancelled = p.status === "cancelled", failed = p.status === "failed";
  // A run that Claude performs (readiness check, breakdown, development) only starts here and continues on the screen; a plain action (approve) is finished at once.
  const r = (p.result ?? null) as { runId?: string; alreadyRunning?: boolean } | null;
  const started = done && !!r?.runId;
  return (
    <>
      <div className={`cc-card ${done ? "done" : cancelled ? "no" : failed ? "no" : ""}`}>
        <div className="cap">{started ? (r?.alreadyRunning ? "כבר רץ" : "התחיל") : done ? "בוצע" : cancelled ? "בוטל" : failed ? "נכשל" : "מה עומד לקרות"}</div>
        <div className="h">{p.title}</div>
        <div className="d">{p.describe}</div>
        <div className="kv">
          {p.estimate && <><b>מודל</b><span>{modelLabel(p.estimate.model)} · מאמץ {effortLabel(p.estimate.effort)} (לפי המדיניות)</span></>}
          {p.estimate && <><b>עלות משוערת</b><span>{p.estimate.usd != null ? `כ-${fmtUsd(p.estimate.usd)}` : "לפי אורך ההרצה"} · נרשמת כ{capabilityLabel(p.estimate.capability)}</span></>}
          {!p.estimate && <><b>עלות</b><span><CostLine costUsd={0} source="system" note="פעולה בלי מודל" /></span></>}
          <b>נרשם</b><span>{p.recorded ?? "ביומן, בשם מי שאישר"}</span>
        </div>
        {p.error && <div className="ob-note crit" style={{ marginTop: 8 }}>{p.error}</div>}
        {err && <div className="ob-note crit" style={{ marginTop: 8 }}>{err}</div>}
        <div className="acts">
          {p.status === "proposed" && <>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => void act(() => runProposal(message.id))}>{busy ? "מריץ…" : "אשר והרץ"}</button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={busy || previewLoading} onClick={() => {
              setPreviewOpen(true);
              if (!preview) { setPreviewLoading(true); getProposalPreview(message.id).then(setPreview).catch((e) => setErr(errText(e))).finally(() => setPreviewLoading(false)); }
            }}>הצג את מה שיישלח</button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void act(() => cancelProposal(message.id))}>בטל</button>
          </>}
          {p.status === "running" && <span className="ob-sub"><span className="spinner" style={{ width: 12, height: 12, marginInlineEnd: 6, verticalAlign: "middle" }} />רץ…</span>}
          {done && <span className="ob-sub">{started ? (r?.alreadyRunning ? "הרצה כזו כבר רצה — לא התחילה שנייה" : "✓ ההרצה התחילה ונרשמה בשמכם · ההתקדמות והתוצאה במסך עצמו") : "✓ בוצע ונרשם"}{p.ranAt ? ` · ${new Date(p.ranAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>}
          {cancelled && <span className="ob-sub">לא בוצע. שום דבר לא נרשם מלבד השאלה.</span>}
        </div>
      </div>
      {previewOpen && (
        <PromptPreviewModal
          title={p.title}
          data={preview}
          loading={previewLoading}
          error={err}
          onClose={() => setPreviewOpen(false)}
          onConfirm={() => { setPreviewOpen(false); void act(() => runProposal(message.id)); }}
          confirming={busy}
          confirmLabel="✦ אשר והרץ"
        />
      )}
    </>
  );
}

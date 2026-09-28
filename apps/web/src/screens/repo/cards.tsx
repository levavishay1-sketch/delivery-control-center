import { useState } from "react";
import type { ClarifyingQuestion, ComponentGroup, OnboardingComponent } from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { COMPONENT_STATUS_HE, DELTA_HE, FAMILY_HE, GROUP_HE, KIND_HE, RISK_HE, SOURCE_HE, TRUST_HE, fmtDate, fmtInt, validationLabel } from "./labels.ts";

/**
 * The component cards of the plan: "שמתי X כי ראיתי Y", in three groups.
 * A card is what the person approves — never a file. The decisions go to
 * the server through `onDecide`; the card only holds the answers being typed
 * and whether a decline reason is being asked for.
 */

export type Decision = "approve" | "decline" | "defer" | "undo";
export type Decide = (key: string, decision: Decision, extra: { reason?: string; answers?: Record<string, string> }) => void;

const GROUP_SUB: Record<ComponentGroup, string> = {
  auto: "הפיך, זול, לא נוגע בייצור — נבנה ומדווח כאן",
  approval: "משמעותי, או נוגע במערכת חיצונית — מחכה להחלטה שלכם",
  not_recommended: "נשקל ונדחה על ידי הכללים, עם הסיבה",
};

const GROUP_INFO: Record<ComponentGroup, string> = { auto: "group_auto", approval: "group_approval", not_recommended: "group_not_recommended" };

/** The scan of the /init draft declines a card of ours with a reason that opens "הסריקה:" — the card shows the rest. */
const scanReason = (reason: string | null) => (reason ?? "").replace(/^(הסריקה|הסוקר):\s*/, "");

/** A component's measured verdict, "with" against "without" on the tasks that exercise it — the card and the build step say it the same way. */
export function DeltaLine({ d }: { d: NonNullable<OnboardingComponent["delta"]> }) {
  const v = DELTA_HE[d.verdict];
  return <><span className={`rd-chip ${v.cls}`}>{v.label}</span>{d.total > 0 && <span className="ob-sub"> עם {d.after}/{d.total} · בלי {d.before}/{d.total} משימות</span>}</>;
}

export function ComponentCard({ c, open, busy, who, onDecide, onAsk }: {
  c: OnboardingComponent; open: boolean; busy: boolean; who: string | null; onDecide: Decide; onAsk: (c: OnboardingComponent) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(c.questions.map((q) => [q.key, q.answer ?? q.default])));
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const st = COMPONENT_STATUS_HE[c.status];
  const risk = RISK_HE[c.risk];
  const trust = typeof c.params.trust === "string" ? TRUST_HE[c.params.trust] : undefined;
  const decidable = open && c.group === "approval" && c.kind !== "report";
  const v = c.validation ? validationLabel(c.validation.passed) : null;
  // Declined by the scan of the /init draft, not by a person: the reason, and "בכל זאת" to take it back.
  const byScan = c.status === "declined" && (c.params.declinedBy === "scan" || c.params.declinedBy === "reviewer");
  const byReviewer = byScan && c.params.declinedBy === "reviewer";
  return (
    <div className={`rd-card ${c.status}`}>
      <div className="head">
        <b>{c.title_he}</b>
        <span className={`rd-chip ${st.cls}`}>{byReviewer ? "הסוקר דחה" : byScan ? "נדחה בסריקה" : st.label}</span>
        {c.status === "configured" && <Info k="status_configured" />}
      </div>
      <div className="meta">
        <span><span className="rd-chip det">{KIND_HE[c.kind]}</span><Info k="component_kind" /></span>
        <span><span className="rd-chip">{FAMILY_HE[c.family]}</span><Info k="component_family" /></span>
        <span><span className={`rd-chip ${risk.cls}`}>{risk.label}</span><Info k="component_risk" /></span>
        <span><span className="rd-chip">{SOURCE_HE[c.source]}{c.sourceRef && c.source === "rule" ? ` ${c.sourceRef}` : ""}</span><Info k="component_source" /></span>
        {trust && <span><span className={`rd-chip ${trust.cls}`}>{trust.label}</span><Info k="source_trust" /></span>}
        {(c.contextTokens ?? 0) > 0 && <span><span className="rd-chip">{fmtInt(c.contextTokens!)} טוקנים בכל סשן</span><Info k="context_cost" /></span>}
      </div>
      <div className="why"><b>כי ראיתי<Info k="component_why" /></b>{c.why_he}</div>
      <div className="why"><b>מה</b>{c.what_he}</div>
      {c.source === "init" && typeof c.params.text === "string" && <CardText c={c} />}
      <div className="why"><b>איך נבדוק<Info k="verify_how" /></b>{c.verifyHow_he}</div>
      {c.questions.length > 0 && (
        <div className="qs">
          <span className="ob-sub">שאלות הבהרה<Info k="card_questions" /></span>
          {c.questions.map((q) => (
            <div className="q" key={q.key}>
              <span>{q.question_he}</span>
              {decidable && c.status === "proposed"
                ? <input value={answers[q.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} placeholder={q.default} />
                : <span className="ob-sub">{q.answer ?? q.default}{q.answer ? "" : " (ברירת מחדל)"}</span>}
            </div>
          ))}
        </div>
      )}
      {c.validation && v && <div className="why"><b>אימות<Info k="validation_result" /></b><span className={`rd-chip ${v.cls}`}>{v.label}</span> {c.validation.how}{c.validation.detail ? ` — ${c.validation.detail}` : ""}</div>}
      {c.delta && <div className="why"><b>מה המדידה אמרה<Info k="component_delta" /></b><DeltaLine d={c.delta} /></div>}
      {c.files.length > 0 && <div className="why"><b>קבצים</b><span className="ob-code">{c.files.join("  ")}</span></div>}
      {byScan && (
        <div className="why">
          <b>{byReviewer ? "הסוקר דחה" : "נדחה בסריקה"}<Info k={byReviewer ? "reviewer_declined" : "scan_declined"} /></b>{scanReason(c.declineReason) || (byReviewer ? "הסוקר מצא שהוא מיותר." : "הסריקה מצאה שהוא מיותר.")}
          {open && (
            <div className="acts" style={{ marginTop: 6 }}>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onDecide(c.key, "undo", {})}>בכל זאת</button><Info k="scan_declined_undo" />
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAsk(c)}>שאל</button>
            </div>
          )}
        </div>
      )}
      {c.status === "declined" && c.declineReason && !byScan && <div className="why"><b>{c.group === "not_recommended" ? "למה לא" : "סיבת הדחייה"}</b>{c.declineReason}</div>}
      {decidable && c.status === "proposed" && !declining && (
        <div className="acts">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecide(c.key, "approve", { answers })}>אשר</button><Info k="card_approve" />
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAsk(c)}>שאל</button><Info k="card_ask" />
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setDeclining(true)}>דחה</button><Info k="card_decline" />
        </div>
      )}
      {decidable && declining && (
        <div className="acts">
          <input className="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למה? שורה אחת — נרשמת ביומן ובדו״ח ה-PR" autoFocus />
          <button className="btn btn-destructive btn-sm" disabled={busy} onClick={() => { onDecide(c.key, "decline", { reason: reason.trim() }); setDeclining(false); }}>דחה</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setDeclining(false)}>ביטול</button>
        </div>
      )}
      {decidable && c.status !== "proposed" && !byScan && (
        <div className="decided">
          <span>{st.label}{who ? ` · ${who}` : ""}{c.decidedAt ? ` · ${fmtDate(c.decidedAt)}` : ""}</span>
          <a style={{ cursor: "pointer" }} onClick={() => !busy && onDecide(c.key, "undo", {})}>בטל</a>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAsk(c)}>שאל</button>
        </div>
      )}
      {open && !decidable && !byScan && c.group !== "not_recommended" && <div className="acts"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onAsk(c)}>שאל</button></div>}
    </div>
  );
}

/** A card taken from the /init draft carries the exact text it writes — what the person approves, word for word. */
function CardText({ c }: { c: OnboardingComponent }) {
  const text = String(c.params.text);
  const short = !text.includes("\n") && text.length <= 300;
  const [open, setOpen] = useState(short);
  const where = typeof c.params.file === "string" ? c.params.file : typeof c.params.heading === "string" ? `AGENTS.md › ${c.params.heading}` : "AGENTS.md";
  return (
    <div className="why">
      <b>הנוסח<Info k="card_text" /></b>
      <span className="ob-sub">{where} · </span>
      {!short && <a style={{ cursor: "pointer" }} onClick={() => setOpen((x) => !x)}>{open ? "הסתר" : `הצג (${text.split("\n").length} שורות)`}</a>}
      {open && <pre className="ob-code" style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflowY: "auto", margin: "6px 0 0", padding: 8, background: "var(--surface-2, rgba(0,0,0,.04))", borderRadius: 8 }}>{text}</pre>}
    </div>
  );
}

/** Above the approval group while the plan is open: approve as a set, and ask for a component in your own words. */
export function ApprovalTools({ proposed, busy, onApproveAll, onRequest }: {
  proposed: number; busy: boolean; onApproveAll: () => void; onRequest: (text: string) => Promise<{ title: string; kind: string; questions: ClarifyingQuestion[] } | undefined>;
}) {
  const [requesting, setRequesting] = useState(false);
  const [text, setText] = useState("");
  const [created, setCreated] = useState<{ title: string; kind: string; questions: ClarifyingQuestion[] } | null>(null);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="rd-inline">
        <button className="btn btn-primary btn-sm" disabled={busy || proposed === 0} onClick={onApproveAll}>אשר את כל מה שמחכה ({proposed})</button><Info k="approve_set" />
        <button className="btn btn-secondary btn-sm" onClick={() => setRequesting((v) => !v)}>בקש רכיב…</button><Info k="request_component" />
      </div>
      {requesting && (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea className="rd-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder='במילים שלכם, למשל: "תכין skill לתהליך שחרור גרסה" או "סוכן שבודק שלא נגעו בקוד המג׳ונרט"' />
          <div className="ob-actions">
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => { void onRequest(text.trim()).then((r) => { if (r) { setCreated(r); setText(""); } }); }}>{busy ? "קלוד מנסח כרטיס…" : "שלח בקשה"}</button>
            <span className="ob-sub">קריאה קצרה למודל (סנטים). הכרטיס נכנס ל"מחכה לאישורך" ונבנה ומאומת כמו כל רכיב.</span>
          </div>
          {created && <div className="ob-note info">נוצר כרטיס: <b>{created.title}</b> ({KIND_HE[created.kind as keyof typeof KIND_HE] ?? created.kind}){created.questions.length ? ` · ${created.questions.length} שאלות הבהרה, על הכרטיס עצמו` : ""}</div>}
        </div>
      )}
    </div>
  );
}

export function CardGroup({ group, cards, open, busy, users, tools, onDecide, onAsk }: {
  group: ComponentGroup; cards: OnboardingComponent[]; open: boolean; busy: boolean; users: Record<string, string>;
  tools?: React.ReactNode; onDecide: Decide; onAsk: (c: OnboardingComponent) => void;
}) {
  return (
    <div className="rd-group">
      <div className="rd-group-head">
        <CardTitle info={GROUP_INFO[group]}>{GROUP_HE[group]} ({cards.length})</CardTitle>
        <span className="ob-sub">{GROUP_SUB[group]}</span>
      </div>
      {tools}
      {cards.length === 0
        ? <p className="ob-sub" style={{ margin: 0 }}>אין כרטיסים בקבוצה הזו.</p>
        : cards.map((c) => <ComponentCard key={c.key} c={c} open={open} busy={busy} who={c.decidedBy ? (users[c.decidedBy] ?? c.decidedBy) : null} onDecide={onDecide} onAsk={onAsk} />)}
    </div>
  );
}

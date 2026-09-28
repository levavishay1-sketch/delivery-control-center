import { useState } from "react";
import { Info } from "../claude/Info.tsx";
import { CUSTOMISATION_TEMPLATE, type ImplementResult } from "../api.ts";

/**
 * A task developed by a person, not by Claude — the pieces of the task screen
 * that are only there when the task is marked that way.
 *
 * Not every task is developed with Claude, and not every task compiles, so a
 * person can say the task is theirs, report what they did, and set each check
 * by hand. Everything else about the task — its status, its steps, closing it —
 * is the ordinary one: this is who did the work, not a second lifecycle.
 */

/** Who develops the task: Claude, or the person themselves. Locked, with the reason, while either kind of work stands. */
export function ManualSwitch({ manual, locked, busy, onChange }: {
  manual: boolean;
  /** Why the choice cannot be changed right now, or null. */
  locked: string | null;
  busy: boolean;
  onChange: (manual: boolean) => void;
}) {
  return (
    <div className="mw-switch">
      <span className="mw-cap">מי מפתח<Info k="task_manual" /></span>
      <div className="seg" role="group" aria-label="מי מפתח את המשימה">
        <button type="button" aria-pressed={!manual} disabled={busy || (manual && !!locked)} onClick={() => manual && onChange(false)}>Claude</button>
        <button type="button" aria-pressed={manual} disabled={busy || (!manual && !!locked)} onClick={() => !manual && onChange(true)}>אדם, ידנית</button>
      </div>
      {locked && <span className="mw-locked">{locked}</span>}
    </div>
  );
}

/** What the person tells DCC about the work: what was done, the customisations, the components. */
export function ManualReportForm({ initial, busy, err, onSubmit, onCancel }: {
  initial?: { summary: string; customisation: string; components: string; reference: string };
  busy: boolean;
  err: string | null;
  onSubmit: (v: { summary: string; customisation: string; components: string; reference: string }) => void;
  onCancel?: () => void;
}) {
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [customisation, setCustomisation] = useState(initial?.customisation ?? CUSTOMISATION_TEMPLATE);
  const [components, setComponents] = useState(initial?.components ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  return (
    <div className="mw-form">
      <div className="field">
        <label>מה נעשה במשימה<Info k="manual_report" /></label>
        <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="למשל: הוקם השדה וחובר לטופס, נבדק ידנית בסביבת הפיתוח" />
      </div>
      <div className="field">
        <label>קסטומיזציה<Info k="customisation" /></label>
        <textarea
          rows={4} value={customisation} onChange={(e) => setCustomisation(e.target.value)}
          style={{ fontFamily: "var(--mono)", direction: "ltr", textAlign: "left" }} spellCheck={false}
        />
        <p className="mw-hint">כתבו מתחת לכותרת איזה קסטומיזציה נגעה במשימה, אחת בכל שורה. אפשר להשאיר ריק אם אין.</p>
      </div>
      <div className="field">
        <label>רכיבים שנגעו בהם<Info k="manual_components" /></label>
        <textarea rows={2} value={components} onChange={(e) => setComponents(e.target.value)} style={{ direction: "ltr", textAlign: "left" }} placeholder="אחד בכל שורה — רק אם המשימה נוגעת ברכיב שמקמפלים" />
      </div>
      <div className="field">
        <label>איפה העבודה יושבת (לא חובה)<Info k="manual_reference" /></label>
        <input value={reference} onChange={(e) => setReference(e.target.value)} style={{ direction: "ltr", textAlign: "left" }} placeholder="ענף, commit, Pull Request או כרטיס" />
      </div>
      {err && <p className="mw-err">{err}</p>}
      <div className="mw-actions">
        <button className="btn btn-primary" disabled={busy || summary.trim().length < 3} onClick={() => onSubmit({ summary, customisation, components, reference })}>
          {busy ? "שומר…" : "דווח שהמשימה פותחה"}
        </button>
        {onCancel && <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>ביטול</button>}
      </div>
    </div>
  );
}

/** The report as it stands — with a way to correct it or take it back. */
export function ManualReportCard({ impl, busy, onEdit, onCancel }: {
  impl: ImplementResult;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const m = impl.manual!;
  return (
    <div className="mw-card">
      <p className="mw-title">✍ דווח ידנית — פותח בלי Claude<Info k="manual_report" /></p>
      <p className="mw-summary">{impl.summary}</p>
      <div className="mw-facts">
        <div><span className="mw-k">CUSTOMISATION:</span>{m.customisations.length ? <span className="mw-v">{m.customisations.join(" · ")}</span> : <span className="mw-none">לא צוינה</span>}</div>
        {m.components.length > 0 && <div><span className="mw-k">רכיבים</span><span className="mw-v" style={{ direction: "ltr" }}>{m.components.join(", ")}</span></div>}
        {m.reference && <div><span className="mw-k">מקור</span><span className="mw-v" style={{ direction: "ltr" }}>{m.reference}</span></div>}
      </div>
      <div className="mw-actions">
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onEdit}>✎ ערוך את הדיווח</button>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onCancel} style={{ color: "var(--status-critical)" }}>↩ בטל את הדיווח</button>
      </div>
    </div>
  );
}

/** One check, set by hand: it passed, it failed (and why), or it has not run. */
export function ManualCheckEditor({ current, busy, err, onSet }: {
  current: "passed" | "failed" | "waiting" | null;
  busy: boolean;
  err: string | null;
  onSet: (result: "passed" | "failed" | "not_run", note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"passed" | "failed" | null>(null);
  const done = (result: "passed" | "failed" | "not_run") => { onSet(result, note); setAsking(null); setNote(""); };
  return (
    <div className="mw-check">
      <p className="mw-k">סימון ידני<Info k="manual_check" /></p>
      <div className="mw-actions">
        <button className="btn btn-secondary btn-sm" disabled={busy || current === "passed"} onClick={() => setAsking(asking === "passed" ? null : "passed")}>✓ עברה</button>
        <button className="btn btn-secondary btn-sm" disabled={busy || current === "failed"} onClick={() => setAsking(asking === "failed" ? null : "failed")}>✕ נכשלה</button>
        <button className="btn btn-secondary btn-sm" disabled={busy || current == null} onClick={() => done("not_run")}>· לא רצה</button>
      </div>
      {asking && (
        <div className="mw-ask">
          <textarea
            rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={asking === "failed" ? "מה נכשל? (חובה — כדי שמי שימשיך יבין)" : "הערה (לא חובה) — למשל: אין קימפול במשימה הזו"}
          />
          <div className="mw-actions">
            <button className="btn btn-primary btn-sm" disabled={busy || (asking === "failed" && !note.trim())} onClick={() => done(asking)}>{busy ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setAsking(null); setNote(""); }}>ביטול</button>
          </div>
        </div>
      )}
      {err && <p className="mw-err">{err}</p>}
    </div>
  );
}

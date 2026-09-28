import { useState, type FormEvent } from "react";
import { PageHead } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { AuthError, changePassword, logout } from "../auth/session.ts";

const MIN_LENGTH = 12;

const MESSAGES: Record<string, string> = {
  wrong_password: "הסיסמה הנוכחית אינה נכונה.",
  weak_password: `סיסמה צריכה לפחות ${MIN_LENGTH} תווים.`,
  same_password: "בחרו סיסמה שונה מהנוכחית.",
};

/** Shown instead of the app while the user must choose their own password. */
export function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = repeat.length > 0 && next !== repeat;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(err instanceof AuthError ? MESSAGES[err.code] ?? err.message : "השרת לא עונה. נסו שוב בעוד רגע.");
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <PageHead title="החלפת סיסמה" info="page_change_password" />
        <div className="field">
          <label>הסיסמה הנוכחית
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus dir="ltr" />
          </label>
        </div>
        <div className="field">
          <label>סיסמה חדשה <Info k="new_password" />
            <input type="password" autoComplete="new-password" minLength={MIN_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} required dir="ltr" />
          </label>
        </div>
        <div className="field">
          <label>הסיסמה החדשה שוב
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required dir="ltr" />
          </label>
        </div>
        {mismatch && <p className="auth-error">שתי הסיסמאות החדשות אינן זהות.</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !current || next.length < MIN_LENGTH || next !== repeat}>
          {busy ? "שומרים…" : "שמירת הסיסמה"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => void logout()}>יציאה</button>
      </form>
    </div>
  );
}

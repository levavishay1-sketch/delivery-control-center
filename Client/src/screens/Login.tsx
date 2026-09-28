import { useState, type FormEvent } from "react";
import { PageHead } from "../ui.tsx";
import { AuthError, login } from "../auth/session.ts";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "האימייל או הסיסמה אינם נכונים.",
  account_locked: "יותר מדי ניסיונות שגויים. נסו שוב בעוד רבע שעה.",
  account_disabled: "החשבון הזה מושבת או שפג תוקפו. פנו למנהל המערכת.",
};

/** Email + password. Entra sign-in joins here once the application is registered. */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof AuthError ? MESSAGES[err.code] ?? err.message : "השרת לא עונה. נסו שוב בעוד רגע.");
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark">DC</div>
          <div className="brand-word">Delivery Control<span>Center</span></div>
        </div>
        <PageHead title="כניסה" info="page_login" />
        <div className="field">
          <label>אימייל
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus dir="ltr" />
          </label>
        </div>
        <div className="field">
          <label>סיסמה
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required dir="ltr" />
          </label>
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>{busy ? "נכנסים…" : "כניסה"}</button>
      </form>
    </div>
  );
}

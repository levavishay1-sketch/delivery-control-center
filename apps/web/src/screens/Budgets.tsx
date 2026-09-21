import { useEffect, useState } from "react";
import { getBudgets } from "../api.ts";
import { CardTitle, PageHead } from "../ui.tsx";
import { useClaudeContext } from "../claude/context.ts";

export function Budgets() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getBudgets>>["budgets"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getBudgets().then((r) => setRows(r.budgets)).catch((e) => setErr(String(e))); }, []);
  useClaudeContext({
    screen: "budgets", topic: { kind: "app" },
    facts: rows ? { "תקציבים לפי לקוח": rows.map((b) => `${b.clientName}: $${b.spentUsd.toFixed(2)} מתוך $${b.monthlyUsd} (${b.pct}%)`), aiCostUsd: rows.reduce((a, b) => a + b.spentUsd, 0) } : {},
    suggestions: ["מאיפה מגיע המספר הזה?", "מה קורה כשעוברים את התקציב?"],
  });

  const total = (rows ?? []).reduce((a, b) => a + b.spentUsd, 0);
  const cap = (rows ?? []).reduce((a, b) => a + b.monthlyUsd, 0);

  return (
    <>
      <PageHead info="page_budgets" title="תקציבים" sub="עלות ה-AI החודשית לכל לקוח, מול התקציב שהוגדר." />
      {err && <div className="empty">{err}</div>}
      {rows && (
        <div className="stat-row" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <div className="stat-tile"><div className="stat-top"><div><div className="lbl">סה"כ עלות AI החודש</div><div className="num">${total.toFixed(2)}</div></div></div></div>
          <div className="stat-tile"><div className="stat-top"><div><div className="lbl">סה"כ תקציב</div><div className="num">${cap.toLocaleString("en-US")}</div></div></div></div>
        </div>
      )}
      <div className="section">
        {(rows ?? []).map((b) => (
          <div className="panel" key={b.clientId} style={{ marginBottom: 12 }}>
            <div className="client-head"><CardTitle as="h3" info="client_budget"><b>{b.clientName}</b></CardTitle><span className="meter-label">${b.spentUsd.toFixed(0)} / ${b.monthlyUsd.toFixed(0)}</span></div>
            <div className="meter-row">
              <span className="meter-label">{b.pct}% מנוצל</span>
              <span className="meter-track"><span className={`meter-fill ${b.pct >= 80 ? "hot" : ""}`} style={{ width: `${Math.min(100, b.pct)}%` }} /></span>
            </div>
          </div>
        ))}
        {rows && rows.length === 0 && <div className="empty">אין תקציבים מוגדרים.</div>}
      </div>
    </>
  );
}

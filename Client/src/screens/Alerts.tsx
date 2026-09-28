import { useEffect, useState } from "react";
import { getAlerts } from "../api.ts";
import { PageHead } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";

const KIND: Record<string, string> = { blocker: "חסימה", budget: "תקציב", decision: "החלטה", deadline: "דדליין", review: "בדיקה", gap: "פער" };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (m < 60) return `לפני ${m} דק'`; if (m < 1440) return `לפני ${Math.round(m / 60)} שעות`; return `לפני ${Math.round(m / 1440)} ימים`;
};

export function Alerts({ nav }: { nav: (h: string) => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getAlerts>>["alerts"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getAlerts().then((r) => setRows(r.alerts)).catch((e) => setErr(String(e))); }, []);

  return (
    <>
      <PageHead info="page_alerts" title="התראות" sub={rows ? `${rows.length} התראות` : undefined} />
      {err && <div className="empty">{err}</div>}
      <div className="rowlist">
        {(rows ?? []).map((a) => (
          <div className="row" key={a.id} style={{ alignItems: "flex-start" }}>
            <span className={`adot ${a.severity === "critical" ? "critical" : a.severity === "warn" ? "warn" : "info"}`} style={{ marginTop: 6, width: 8, height: 8, borderRadius: 999, background: a.severity === "critical" ? "var(--status-critical)" : a.severity === "warn" ? "var(--status-warning)" : "var(--status-healthy)", flex: "none" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              {a.body && <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{a.body}</div>}
              <div style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 3 }}>{KIND[a.kind] ?? a.kind}<Info k="alert_kind" /> · {ago(a.createdAt)}</div>
            </div>
            {a.workitemId && <a className="link" onClick={() => nav(`#/wi/${a.workitemId}`)}>פתיחה</a>}
          </div>
        ))}
        {rows && rows.length === 0 && <div className="empty">אין התראות.</div>}
      </div>
    </>
  );
}

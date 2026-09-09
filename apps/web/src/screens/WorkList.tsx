import { useEffect, useMemo, useState } from "react";
import { getWorkList, type WorkListRow } from "../api.ts";
import { PageHead, TypeChip, initials } from "../ui.tsx";
import { NewRequirement } from "../forms.tsx";

const PRIO: Record<string, string> = { critical: "קריטית", high: "גבוהה", medium: "בינונית", low: "נמוכה" };
const PHASE: Record<string, string> = { intake: "קליטה", shaping: "גיבוש", building: "בפיתוח", review: "בבדיקה", done: "הושלם", archived: "ארכיון" };
const ago = (iso: string) => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  if (h < 1) return "עכשיו"; if (h < 24) return `לפני ${h} שעות`; return `לפני ${Math.round(h / 24)} ימים`;
};

export function WorkList({ nav, query }: { nav: (h: string) => void; query: string }) {
  const [rows, setRows] = useState<WorkListRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ q: "", priority: "", phase: "", blocked: new URLSearchParams(query).get("filter") === "blocked" });
  const [modal, setModal] = useState(false);
  const reload = () => getWorkList().then((r) => setRows(r.items)).catch((e) => setErr(String(e)));

  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (!f.q || r.title.includes(f.q) || (r.key ?? "").includes(f.q)) &&
    (!f.priority || r.priority === f.priority) &&
    (!f.phase || r.phase === f.phase) &&
    (!f.blocked || r.openBlockers > 0),
  ), [rows, f]);

  return (
    <>
      <PageHead title="עבודות" sub={rows ? `${rows.length} דרישות בכל הלקוחות` : undefined} actions={<button className="btn btn-primary" onClick={() => setModal(true)}>+ דרישה חדשה</button>} />
      {modal && <NewRequirement onClose={() => setModal(false)} onDone={(id) => { setModal(false); if (id) nav(`#/wi/${id}`); else reload(); }} />}
      <div className="filter-bar">
        <div className="field"><label>חיפוש</label><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="כותרת או מפתח…" /></div>
        <div className="field"><label>עדיפות</label>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="">הכל</option>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label>שלב</label>
          <select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>
            <option value="">הכל</option>{Object.entries(PHASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label>&nbsp;</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" style={{ minWidth: 0 }} checked={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.checked })} /> חסומות בלבד
          </label>
        </div>
      </div>

      {err && <div className="empty">{err}</div>}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table className="wtable">
          <thead><tr><th>דרישה</th><th>תחת</th><th>לקוח</th><th>אחראי</th><th>עדיפות</th><th>שלב</th><th>עודכן</th></tr></thead>
          <tbody>
            {filtered.map((w) => (
              <tr key={w.id}>
                <td>
                  <span className="w-title" onClick={() => nav(`#/wi/${w.id}`)}>{w.title}</span>{" "}
                  <TypeChip type={w.type} />
                  {w.openBlockers > 0 && <span className="prio critical" style={{ marginInlineStart: 6 }}>חסום</span>}
                </td>
                <td style={{ color: "var(--ink-500)" }}>{w.parentId ? (w.parentTitle ?? "—") : "—"}</td>
                <td style={{ color: "var(--ink-500)" }}>{w.clientName}</td>
                <td><span className="w-owner"><span className="a">{initials(w.ownerName)}</span>{w.ownerName}</span></td>
                <td><span className={`prio ${w.priority}`}>{PRIO[w.priority]}</span></td>
                <td>{PHASE[w.phase] ?? w.phase}</td>
                <td style={{ color: "var(--ink-400)" }}>{ago(w.updatedAt)}</td>
              </tr>
            ))}
            {rows && filtered.length === 0 && <tr><td colSpan={7}><div className="empty">אין עבודות שתואמות לסינון.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

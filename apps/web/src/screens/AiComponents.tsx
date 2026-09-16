import { useEffect, useState } from "react";
import { getAiComponentRepos, getAiComponents, updateAiComponent, type AiComponentRow } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";

const TYPE_HE: Record<string, string> = {
  skill: "Skills", agent: "Agents", mcp: "MCP", hook: "Hooks", command: "Commands",
  methodology: "מתודולוגיות", tool: "כלים", template: "תבניות", base_configuration: "תצורת בסיס", plugin: "Plugins", other: "אחר",
};
const fmt = (t: string) => new Date(t).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function AiComponents() {
  const [rows, setRows] = useState<AiComponentRow[] | null>(null);
  const [open, setOpen] = useState<AiComponentRow | null>(null);
  const [repos, setRepos] = useState<{ repoId: string; repoName: string; clientName: string | null; detectedPath: string; active: boolean; firstSeenAt: string; lastSeenAt: string; removedAt: string | null }[] | null>(null);
  const [editing, setEditing] = useState<{ title: string; description: string } | null>(null);

  const reload = () => getAiComponents().then((r) => setRows(r.components));
  useEffect(() => { reload(); }, []);

  const openComponent = (c: AiComponentRow) => {
    setOpen(c); setRepos(null); setEditing({ title: c.title, description: c.description ?? "" });
    getAiComponentRepos(c.id).then((r) => setRepos(r.repos));
  };

  if (!rows) return <div className="spin">טוען…</div>;

  const byType = new Map<string, AiComponentRow[]>();
  for (const r of rows) { if (!byType.has(r.type)) byType.set(r.type, []); byType.get(r.type)!.push(r); }

  return (
    <>
      <PageHead title="רכיבי AI" sub={`${rows.length} רכיבים בקטלוג הארגוני — קיימים מהרגע שנמצאו ולו ב-repository אחד`} />
      {rows.length === 0 && <div className="empty">עדיין לא זוהו רכיבי AI באף repository. סנכרן מלאי מתוך "ניהול AI" בעמוד לקוח.</div>}
      {Array.from(byType.entries()).map(([type, items]) => (
        <div key={type} style={{ marginBottom: 22 }}>
          <p className="section-lbl">{TYPE_HE[type] ?? type}</p>
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <table className="wtable">
              <thead><tr><th>שם</th><th>תיאור</th><th>repos פעילים</th><th>נראה לראשונה</th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td><span className="w-title" onClick={() => openComponent(c)}>{c.title}</span></td>
                    <td style={{ fontSize: 12, color: "var(--ink-400)" }}>{c.description ?? "—"}</td>
                    <td>{c.activeRepoCount > 0 ? <Pill tone="healthy">{c.activeRepoCount}</Pill> : <Pill tone="inactive">0</Pill>}</td>
                    <td style={{ fontSize: 11.5 }}>{fmt(c.firstSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {open && editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgb(27 23 65 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(600px, 92vw)", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)",
            border: "1.5px solid var(--border-hairline)", borderRadius: 16, padding: "24px 28px", direction: "rtl",
            boxShadow: "0 8px 24px rgb(27 23 65 / 0.15), 0 24px 64px rgb(27 23 65 / 0.25)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>{TYPE_HE[open.type] ?? open.type}</h3>
              <a onClick={() => setOpen(null)} style={{ fontSize: 15, color: "var(--ink-500)", cursor: "pointer", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 99, background: "var(--surface-muted)" }}>✕</a>
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>שם</label>
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} style={{ width: "100%" }} />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>תיאור</label>
              <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} style={{ width: "100%", minHeight: 60 }} />
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginBottom: 18 }}
              onClick={async () => { await updateAiComponent(open.id, { title: editing.title, description: editing.description || null }); reload(); setOpen(null); }}>
              שמור שינויים
            </button>
            <p className="section-lbl">Repositories</p>
            {!repos ? <div className="spin">טוען…</div> : repos.length === 0 ? <p style={{ fontSize: 12, color: "var(--ink-400)" }}>אין repositories.</p> : (
              <div style={{ display: "grid", gap: 8 }}>
                {repos.map((r, i) => (
                  <div key={i} className="stat-line" style={{ alignItems: "flex-start", opacity: r.active ? 1 : 0.55 }}>
                    <span className="l">{r.repoName}{r.clientName ? ` (${r.clientName})` : ""}
                      <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-300)", direction: "ltr", textAlign: "right" }}>{r.detectedPath}</span>
                    </span>
                    <span>{r.active ? <Pill tone="healthy">פעיל</Pill> : <Pill tone="inactive">הוסר</Pill>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

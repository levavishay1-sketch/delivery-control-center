import { useEffect, useState, type ReactNode } from "react";
import { getProjectList } from "./api.ts";

const DEV_EMAIL = import.meta.env.VITE_DCC_DEV_EMAIL ?? "you@dcc.local";
const HOOK = import.meta.env.VITE_DCC_HOOK_TOKEN ?? "dev-secret";
const H = { "content-type": "application/json", "x-dcc-hook-token": HOOK, "x-dcc-dev-email": DEV_EMAIL };
const api = async (path: string, body: unknown) => {
  const r = await fetch(`/api${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgb(16 18 43 / 0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-panel)", width: "min(520px, 100%)", padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 650 }}>{title}</h2>
          <button className="kebab" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Err({ e }: { e: string | null }) {
  return e ? <p style={{ color: "var(--status-critical)", fontSize: 12, margin: "8px 0 0" }}>{e}</p> : null;
}

export function NewProject({ onClose, onDone }: { onClose: () => void; onDone: (id?: string) => void }) {
  const [f, setF] = useState({ clientName: "", projectName: "", repoName: "", repoUrl: "", connector: "manual" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!f.clientName || !f.projectName) return setErr("שם לקוח ושם פרויקט הם שדות חובה");
    setBusy(true); setErr(null);
    try {
      const r = await api("/admin/setup-client", {
        clientName: f.clientName, projectName: f.projectName,
        repo: { name: f.repoName || f.projectName, gitUrl: f.repoUrl || undefined },
      });
      onDone(r.projectId);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="פרויקט חדש" onClose={onClose}>
      <div className="form-grid" style={{ marginBottom: 0 }}>
        <div className="field"><label>שם הלקוח</label><input value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} placeholder="למשל: Altshuler Trade" /></div>
        <div className="field"><label>שם הפרויקט</label><input value={f.projectName} onChange={(e) => setF({ ...f, projectName: e.target.value })} placeholder="למשל: Trading Platform" /></div>
        <div className="field"><label>שם ה-repository</label><input value={f.repoName} onChange={(e) => setF({ ...f, repoName: e.target.value })} placeholder="ALTSHULER_TRADE" /></div>
        <div className="field"><label>כתובת Git</label><input value={f.repoUrl} onChange={(e) => setF({ ...f, repoUrl: e.target.value })} placeholder="https://github.com/…" /></div>
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "יוצר…" : "צור פרויקט"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

export function NewWorkItem({ onClose, onDone, defaultProjectId }: { onClose: () => void; onDone: (id?: string) => void; defaultProjectId?: string }) {
  const [projects, setProjects] = useState<{ id: string; name: string; clientName: string }[]>([]);
  const [f, setF] = useState({ projectId: defaultProjectId ?? "", title: "", kind: "task", priority: "medium", rawRequirement: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getProjectList().then((r) => { setProjects(r.projects); if (!f.projectId && r.projects[0]) setF((s) => ({ ...s, projectId: r.projects[0]!.id })); }).catch(() => {}); }, []);

  const submit = async () => {
    if (!f.projectId || !f.title) return setErr("פרויקט וכותרת הם שדות חובה");
    setBusy(true); setErr(null);
    try {
      const wi = await api("/workitems", { projectId: f.projectId, title: f.title, kind: f.kind, priority: f.priority });
      if (f.rawRequirement.trim()) {
        await api("/events", { workitemId: wi.id, kind: "note", note: { body: f.rawRequirement.trim(), source: "manual" } });
      }
      onDone(wi.id);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };

  return (
    <Modal title="עבודה חדשה" onClose={onClose}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>פרויקט</label>
        <select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.clientName}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>כותרת</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="תיאור קצר של העבודה" style={{ width: "100%" }} />
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>סוג</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="task">משימה</option><option value="bug">באג</option><option value="change">שינוי</option>
          </select>
        </div>
        <div className="field"><label>עדיפות</label>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option><option value="critical">קריטית</option>
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label>הדרישה הגולמית (כפי שהתקבלה — מייל / סלאק / שיחה)</label>
        <textarea value={f.rawRequirement} onChange={(e) => setF({ ...f, rawRequirement: e.target.value })} placeholder="הדבק כאן את הדרישה כמו שהיא, גם אם לא אפויה. זה יהיה האירוע הראשון ב-timeline." style={{ width: "100%", minHeight: 90 }} />
        <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>אופציונלי — אפשר להוסיף אחר כך</span>
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "יוצר…" : "צור עבודה"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

export function AddNote({ workitemId, onClose, onDone }: { workitemId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ body: "", source: "manual" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!f.body.trim()) return setErr("הטקסט ריק");
    setBusy(true); setErr(null);
    try {
      await api("/events", { workitemId, kind: "note", note: { body: f.body.trim(), source: f.source } });
      onDone();
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="הוספת אירוע ל-timeline" onClose={onClose}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>מקור</label>
        <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="manual">ידני</option><option value="email">מייל</option><option value="slack">סלאק</option><option value="phone">שיחת טלפון</option><option value="meeting">פגישה</option>
        </select>
      </div>
      <div className="field">
        <label>תוכן</label>
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="מה נאמר / התקבל" style={{ width: "100%", minHeight: 110 }} />
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "מוסיף…" : "הוסף ל-timeline"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

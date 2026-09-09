import { useEffect, useState, type ReactNode } from "react";
import { getAdoProjects, getClients, getConnections, getProjectList, getRepos } from "./api.ts";

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

export function NewProject({ onClose, onDone, fixedClientName }: { onClose: () => void; onDone: (id?: string) => void; fixedClientName?: string }) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ clientChoice: fixedClientName ?? "", newClientName: "", projectName: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (fixedClientName) return;
    getClients().then((r) => {
      setClients(r.clients);
      setF((s) => ({ ...s, clientChoice: r.clients[0]?.name ?? "__new" }));
    }).catch(() => setF((s) => ({ ...s, clientChoice: "__new" })));
  }, []);

  const clientName = fixedClientName ?? (f.clientChoice === "__new" ? f.newClientName : f.clientChoice);

  const submit = async () => {
    if (!clientName || !f.projectName) return setErr("לקוח ושם פרויקט הם שדות חובה");
    setBusy(true); setErr(null);
    try {
      const r = await api("/admin/setup-client", { clientName, projectName: f.projectName });
      onDone(r.projectId);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="פרויקט חדש" onClose={onClose}>
      {!fixedClientName && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>לקוח</label>
          <select value={f.clientChoice} onChange={(e) => setF({ ...f, clientChoice: e.target.value })}>
            {clients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            <option value="__new">+ לקוח חדש…</option>
          </select>
        </div>
      )}
      {!fixedClientName && f.clientChoice === "__new" && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>שם הלקוח החדש</label>
          <input value={f.newClientName} onChange={(e) => setF({ ...f, newClientName: e.target.value })} placeholder="למשל: Altshuler Trade" style={{ width: "100%" }} />
        </div>
      )}
      <div className="field">
        <label>שם הפרויקט</label>
        <input value={f.projectName} onChange={(e) => setF({ ...f, projectName: e.target.value })} placeholder="למשל: Trading Platform" style={{ width: "100%" }} />
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

function ClientPicker({ value, clients, onChange }: { value: string; clients: { id: string; name: string }[]; onChange: (id: string) => void }) {
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label>לקוח</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— בחר לקוח —</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

export function LinkRepo({ clientId, onClose, onDone }: { clientId?: string; onClose: () => void; onDone: () => void }) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [repos, setRepos] = useState<{ id: string; name: string; adoRepoRef: string | null; clientName: string | null }[]>([]);
  const [f, setF] = useState({ clientId: clientId ?? "", choice: "__new", repoId: "", name: "", gitUrl: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) getClients().then((r) => setClients(r.clients)).catch(() => {});
    getRepos().then((r) => setRepos(r.repos)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!f.clientId) return setErr("בחר לקוח");
    const body = f.choice === "__new" ? { name: f.name.trim(), gitUrl: f.gitUrl.trim() || undefined } : { repoId: f.choice };
    if (f.choice === "__new" && !f.name.trim()) return setErr("שם ה-repository הוא שדה חובה");
    setBusy(true); setErr(null);
    try { await api(`/clients/${f.clientId}/repos`, body); onDone(); }
    catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="חיבור repository ללקוח" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>Repository מקושר <b>ללקוח</b> (לא לפרויקט). הקישור ידני ומפורש.</p>
      {!clientId && <ClientPicker value={f.clientId} clients={clients} onChange={(id) => setF({ ...f, clientId: id })} />}
      <div className="field" style={{ marginBottom: 12 }}>
        <label>repository</label>
        <select value={f.choice} onChange={(e) => setF({ ...f, choice: e.target.value })}>
          <option value="__new">+ repository חדש…</option>
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}{r.clientName ? ` (${r.clientName})` : " (רוחבי)"}</option>)}
        </select>
      </div>
      {f.choice === "__new" && (
        <>
          <div className="field" style={{ marginBottom: 12 }}><label>שם</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ALTSHULER_TRADE" style={{ width: "100%" }} /></div>
          <div className="field"><label>כתובת Git (אופציונלי)</label><input value={f.gitUrl} onChange={(e) => setF({ ...f, gitUrl: e.target.value })} placeholder="https://github.com/…" style={{ width: "100%" }} dir="ltr" /></div>
        </>
      )}
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "מחבר…" : "חבר"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

export function ConnectAdo({ clientId, onClose, onDone }: { clientId?: string; onClose: () => void; onDone: () => void }) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [existing, setExisting] = useState<{ id: string; config: Record<string, string>; clientName: string }[]>([]);
  const [f, setF] = useState({ clientId: clientId ?? "", orgUrl: "", project: "", pat: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [adoProjects, setAdoProjects] = useState<string[] | null>(null);
  const [projMode, setProjMode] = useState<"none" | "pick" | "type">("type");
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    if (!clientId) getClients().then((r) => setClients(r.clients)).catch(() => {});
    getConnections().then((r) => setExisting(r.connections.filter((c) => c.kind === "ado"))).catch(() => {});
  }, []);

  const prefill = (id: string) => {
    const c = existing.find((x) => x.id === id);
    if (c) setF((s) => ({ ...s, orgUrl: c.config.orgUrl ?? "", project: c.config.project ?? "" }));
  };

  const discover = async () => {
    if (!f.orgUrl || !f.pat) return setErr("מלא Organization URL ו-PAT כדי לטעון פרויקטים");
    setDiscovering(true); setErr(null); setResult(null);
    try {
      const r = await getAdoProjects({ orgUrl: f.orgUrl, pat: f.pat });
      if (!r.ok) { setErr(`טעינת הפרויקטים נכשלה: ${r.detail}`); setDiscovering(false); return; }
      setAdoProjects(r.projects);
      setProjMode(r.projects.length ? "pick" : "none");
      setF((s) => ({ ...s, orgUrl: r.orgUrl, project: r.projects.includes(s.project) ? s.project : "" }));
      setResult(`✓ ${r.detail}`);
    } catch (e) { setErr(String(e)); }
    setDiscovering(false);
  };

  const submit = async () => {
    if (!f.clientId) return setErr("בחר לקוח");
    if (!f.orgUrl || !f.pat) return setErr("Organization URL ו-PAT הם שדות חובה");
    setBusy(true); setErr(null); setResult(null);
    try {
      const body: Record<string, string> = { orgUrl: f.orgUrl, pat: f.pat };
      if (projMode !== "none" && f.project.trim()) body.project = f.project.trim();
      const r = await api(`/clients/${f.clientId}/connections/ado`, body);
      setResult(r.check.ok ? `✓ החיבור תקין — ${r.check.detail}` : `✗ ${r.check.detail}`);
      if (r.check.ok) setTimeout(onDone, 1200);
      else setBusy(false);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="חיבור Azure DevOps" onClose={onClose}>
      {!clientId && <ClientPicker value={f.clientId} clients={clients} onChange={(id) => setF({ ...f, clientId: id })} />}

      {existing.length > 0 && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>מלא מחיבור קיים (אופציונלי)</label>
          <select defaultValue="" onChange={(e) => prefill(e.target.value)}>
            <option value="">— חדש —</option>
            {existing.map((c) => <option key={c.id} value={c.id}>{c.config.orgUrl}{c.config.project ? ` · ${c.config.project}` : ""} ({c.clientName})</option>)}
          </select>
        </div>
      )}

      <div style={{ fontSize: 12.5, color: "var(--ink-700)", background: "var(--surface-muted)", borderRadius: 10, padding: "12px 14px", marginBottom: 16, lineHeight: 1.6 }}>
        <b>מה צריך:</b>
        <ol style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
          <li><b>Organization URL</b> — ה-org / collection בלבד:<br />
            ענן <code>https://dev.azure.com/&lt;org&gt;</code> · on-prem <code>http://&lt;server&gt;/&lt;collection&gt;</code></li>
          <li><b>Personal Access Token</b> — ב-<code>&lt;server&gt;/_usersSettings/tokens</code> · scopes: <b>Work Items (Read, write &amp; manage)</b> + <b>Code (Read)</b></li>
          <li>לחץ <b>טען פרויקטים</b> ובחר מהרשימה — או השאר ללא פרויקט (חיבור ברמת ה-collection).</li>
        </ol>
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>Organization URL</label><input value={f.orgUrl} onChange={(e) => { setF({ ...f, orgUrl: e.target.value }); setAdoProjects(null); }} placeholder="http://aman-dit-avishil/DefaultCollection" style={{ width: "100%" }} dir="ltr" /></div>
      <div className="field" style={{ marginBottom: 12 }}><label>Personal Access Token</label><input type="password" value={f.pat} onChange={(e) => { setF({ ...f, pat: e.target.value }); setAdoProjects(null); }} placeholder="••••••••••••••••" style={{ width: "100%" }} dir="ltr" /></div>

      <button className="btn btn-secondary btn-sm" disabled={discovering} onClick={discover} style={{ marginBottom: 12 }}>
        {discovering ? "טוען…" : adoProjects ? "רענן פרויקטים" : "טען פרויקטים"}
      </button>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>Project</label>
        {adoProjects && adoProjects.length > 0 ? (
          <select
            value={projMode === "none" ? "__none" : projMode === "type" ? "__type" : f.project}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__none") { setProjMode("none"); setF({ ...f, project: "" }); }
              else if (v === "__type") { setProjMode("type"); setF({ ...f, project: "" }); }
              else { setProjMode("pick"); setF({ ...f, project: v }); }
            }}
          >
            <option value="">— בחר פרויקט —</option>
            {adoProjects.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="__none">— ללא פרויקט (רמת ה-collection) —</option>
            <option value="__type">— הקלד ידנית —</option>
          </select>
        ) : (
          <select value={projMode} onChange={(e) => { setProjMode(e.target.value as "none" | "type"); if (e.target.value === "none") setF({ ...f, project: "" }); }}>
            <option value="type">הקלד שם פרויקט</option>
            <option value="none">ללא פרויקט (רמת ה-collection)</option>
          </select>
        )}
      </div>
      {projMode === "type" && (
        <div className="field" style={{ marginBottom: 12 }}>
          <input value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} placeholder="Altshuler Trade" style={{ width: "100%" }} dir="ltr" />
        </div>
      )}

      <Err e={err} />
      {result && <p style={{ fontSize: 12.5, margin: "10px 0 0", color: result.startsWith("✓") ? "var(--status-healthy)" : "var(--status-critical)" }}>{result}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "בודק חיבור…" : "חבר ובדוק"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

export function AddRequirement({ clientId, projects, onClose, onDone }: {
  clientId: string; projects: { id: string; name: string }[]; onClose: () => void; onDone: (wiId?: string) => void;
}) {
  const [f, setF] = useState({ projectId: projects[0]?.id ?? "", title: "", kind: "task", priority: "medium", body: "" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  void clientId;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    if (/^(text\/|application\/json)/.test(file.type) || /\.(txt|md|csv|json|log)$/i.test(file.name)) {
      const text = await file.text();
      setF((s) => ({ ...s, body: `${s.body}${s.body ? "\n\n" : ""}— מצורף (${file.name}) —\n${text.slice(0, 8000)}` }));
    } else {
      setF((s) => ({ ...s, body: `${s.body}${s.body ? "\n" : ""}[צורף קובץ: ${file.name}]` }));
    }
  };

  const submit = async () => {
    if (!f.projectId || !f.title.trim()) return setErr("פרויקט וכותרת הם שדות חובה");
    setBusy(true); setErr(null);
    try {
      const wi = await api("/workitems", { projectId: f.projectId, title: f.title.trim(), kind: f.kind, priority: f.priority });
      if (f.body.trim()) await api("/events", { workitemId: wi.id, kind: "note", note: { body: f.body.trim(), source: "manual" } });
      onDone(wi.id);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };

  return (
    <Modal title="הוספת דרישה" onClose={onClose}>
      <div className="field" style={{ marginBottom: 12 }}><label>פרויקט</label>
        <select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>כותרת הדרישה</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="תיאור קצר" style={{ width: "100%" }} />
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>סוג</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="task">משימה</option><option value="bug">באג</option><option value="change">שינוי</option></select>
        </div>
        <div className="field"><label>עדיפות</label>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option><option value="critical">קריטית</option></select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label>הדרישה הגולמית — כפי שהתקבלה</label>
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="הדבק את הדרישה כמו שהיא, גם אם לא אפויה. זה יהיה האירוע הראשון ב-timeline." style={{ width: "100%", minHeight: 120 }} />
      </div>
      <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
        {fileName ? `📎 ${fileName}` : "📎 צירוף קובץ"}
        <input type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "יוצר…" : "צור דרישה"}</button>
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

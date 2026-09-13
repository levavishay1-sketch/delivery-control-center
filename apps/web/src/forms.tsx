import { useEffect, useState, type ReactNode } from "react";
import {
  getAdoProjects, getBugLinks, getClients, getConnections, getRepos, importAdoCsv, linkBugTask, linkRepoToReq,
  searchClientTasks, unlinkBugTask, updateClient, updateRepo, updateRequirement,
  type ImportResult, type LinkedTaskRow, type ReqType, type RequirementType, type WorkItem,
} from "./api.ts";

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

export function NewClient({ onClose, onDone }: { onClose: () => void; onDone: (id?: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) return setErr("שם הלקוח הוא שדה חובה");
    setBusy(true); setErr(null);
    try {
      const r = await api("/admin/setup-client", { clientName: name.trim() });
      onDone(r.clientId);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="לקוח חדש" onClose={onClose}>
      <div className="field">
        <label>שם הלקוח</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: Altshuler Trade" style={{ width: "100%" }} autoFocus />
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "יוצר…" : "צור לקוח"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

const TYPE_OPTS: { v: import("./api.ts").ReqType; he: string }[] = [
  { v: "epic", he: "אפיק (Epic)" }, { v: "feature", he: "פיצ'ר (Feature)" },
  { v: "story", he: "סיפור (Story)" }, { v: "bug", he: "באג (Bug)" },
  { v: "task", he: "משימה (Task)" }, { v: "spike", he: "בירור (Spike)" },
];

/**
 * Add a requirement — under a client (top-level) or under a parent
 * requirement. `type` is a hint; shaping refines it. Optional raw text
 * becomes the first timeline event.
 */
export function NewRequirement({ onClose, onDone, fixedClientId, fixedParentId, parentTitle }: {
  onClose: () => void; onDone: (id?: string) => void;
  fixedClientId?: string; fixedParentId?: string; parentTitle?: string;
}) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ clientId: fixedClientId ?? "", title: "", type: "story", requirementType: "development" as RequirementType, priority: "medium", body: "" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (fixedClientId || fixedParentId) return;
    getClients().then((r) => { setClients(r.clients); if (r.clients[0]) setF((s) => ({ ...s, clientId: r.clients[0]!.id })); }).catch(() => {});
  }, []);

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
    if (!fixedParentId && !f.clientId) return setErr("בחר לקוח");
    if (!f.title.trim()) return setErr("כותרת היא שדה חובה");
    setBusy(true); setErr(null);
    try {
      const body: Record<string, string> = { title: f.title.trim(), type: f.type, requirementType: f.requirementType, priority: f.priority };
      if (fixedParentId) body.parentId = fixedParentId;
      else body.clientId = f.clientId;
      const wi = await api("/workitems", body);
      if (f.body.trim()) await api("/events", { workitemId: wi.id, kind: "note", note: { body: f.body.trim(), source: "manual" } });
      if (wi.ado && wi.ado.synced === false && wi.ado.error) {
        setErr(`הדרישה נוצרה, אבל הסנכרון ל-Azure DevOps נכשל: ${wi.ado.error}. אפשר לנסות שוב מעמוד הדרישה.`);
        setBusy(false);
        setTimeout(() => onDone(wi.id), 2500);
        return;
      }
      onDone(wi.id);
    } catch (e) { setErr(String(e)); setBusy(false); }
  };

  return (
    <Modal title={fixedParentId ? `תת-דרישה תחת "${parentTitle ?? ""}"` : "דרישה חדשה"} onClose={onClose}>
      {!fixedClientId && !fixedParentId && (
        <div className="field" style={{ marginBottom: 12 }}>
          <label>לקוח</label>
          <select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
            <option value="">— בחר לקוח —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div className="field" style={{ marginBottom: 12 }}>
        <label>כותרת הדרישה</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="תיאור קצר" style={{ width: "100%" }} autoFocus />
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>סוג</label>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPE_OPTS.map((t) => <option key={t.v} value={t.v}>{t.he}</option>)}
          </select>
        </div>
        <div className="field"><label>עדיפות</label>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option><option value="critical">קריטית</option>
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>אופי הדרישה</label>
        <select value={f.requirementType} onChange={(e) => setF({ ...f, requirementType: e.target.value as RequirementType })}>
          <option value="development">פיתוח</option><option value="research">תחקור</option><option value="testing">בדיקות</option>
        </select>
        <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 4 }}>נקבע בהקמה, ניתן לשינוי בהמשך מעריכת הדרישה.</p>
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label>הדרישה הגולמית (כפי שהתקבלה — מייל / סלאק / שיחה)</label>
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="הדבק כאן את הדרישה כמו שהיא, גם אם לא אפויה. זה יהיה האירוע הראשון ב-timeline." style={{ width: "100%", minHeight: 90 }} />
        <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>אופציונלי — אפשר להוסיף אחר כך</span>
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

const TYPES: { v: ReqType; he: string }[] = [
  { v: "epic", he: "אפיק (Epic)" }, { v: "feature", he: "פיצ'ר (Feature)" },
  { v: "story", he: "סיפור (Story)" }, { v: "bug", he: "באג (Bug)" },
  { v: "task", he: "משימה (Task)" }, { v: "spike", he: "בירור (Spike)" },
];
const PHASES = [
  ["intake", "קליטה"], ["shaping", "עיצוב"], ["building", "בבנייה"],
  ["review", "בבדיקה"], ["done", "הושלם"], ["archived", "אורכב"],
] as const;

export function EditClient({ client, onClose, onDone }: {
  client: { id: string; name: string; connectorType: string; adoProjectRef: string | null }; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({ name: client.name, connectorType: client.connectorType, adoProjectRef: client.adoProjectRef ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!f.name.trim()) return setErr("שם הוא שדה חובה");
    setBusy(true); setErr(null);
    try {
      await updateClient(client.id, { name: f.name.trim(), connectorType: f.connectorType, adoProjectRef: f.adoProjectRef.trim() || null });
      onDone();
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="עריכת לקוח" onClose={onClose}>
      <div className="field" style={{ marginBottom: 12 }}><label>שם</label>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ width: "100%" }} />
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>סוג סנכרון</label>
        <select value={f.connectorType} onChange={(e) => setF({ ...f, connectorType: e.target.value })}>
          <option value="manual">ידני</option><option value="ado">Azure DevOps</option><option value="github">GitHub</option><option value="jira">Jira</option><option value="dcc">DCC בלבד</option>
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>ADO Project (לסנכרון)</label>
        <input value={f.adoProjectRef} onChange={(e) => setF({ ...f, adoProjectRef: e.target.value })} placeholder="Altshuler Trade" style={{ width: "100%" }} dir="ltr" />
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "שומר…" : "שמור"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

export function EditRepo({ repo, onClose, onDone }: {
  repo: { id: string; name: string; adoRepoRef: string | null }; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({ name: repo.name, adoRepoRef: repo.adoRepoRef ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!f.name.trim()) return setErr("שם הוא שדה חובה");
    setBusy(true); setErr(null);
    try { await updateRepo(repo.id, { name: f.name.trim(), adoRepoRef: f.adoRepoRef.trim() || null }); onDone(); }
    catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="עריכת repository" onClose={onClose}>
      <div className="field" style={{ marginBottom: 12 }}><label>שם</label>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ width: "100%" }} />
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>כתובת Git / ADO</label>
        <input value={f.adoRepoRef} onChange={(e) => setF({ ...f, adoRepoRef: e.target.value })} placeholder="https://github.com/…" style={{ width: "100%" }} dir="ltr" />
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "שומר…" : "שמור"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

/** Edit an existing requirement's fields. */
/** A Bug's link to the task(s) it's actually about — its structure, or
 *  standalone with none at all (decided 2026-09-12,
 *  `bug-change-request-lifecycle`). Linking here is what its own
 *  breakdown later inherits existing checks from. Takes effect
 *  immediately (its own endpoints, not part of the field patch this
 *  modal otherwise batches into one "שמור"). */
function BugLinksSection({ bugId, clientId }: { bugId: string; clientId: string }) {
  const [linked, setLinked] = useState<LinkedTaskRow[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LinkedTaskRow[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => getBugLinks(bugId).then((r) => setLinked(r.tasks)).catch(() => {});
  useEffect(() => { load(); }, [bugId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => { searchClientTasks(clientId, q.trim()).then((r) => setResults(r.tasks)).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [q, clientId]);
  const link = async (taskId: string) => {
    setBusy(true);
    try { await linkBugTask(bugId, taskId); setQ(""); setResults([]); load(); } finally { setBusy(false); }
  };
  const unlink = async (taskId: string) => {
    setBusy(true);
    try { await unlinkBugTask(bugId, taskId); load(); } finally { setBusy(false); }
  };
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label>המשימה שהבאג הוא עליה (אופציונלי)</label>
      <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: -2, marginBottom: 6 }}>
        אפשר לקשר לכמה משימות, או להשאיר לא מקושר (באג עצמאי). משימות מקושרות — הבדיקות הקיימות שלהן יורשות לפירוק של הבאג הזה.
      </p>
      {linked.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          {linked.map((t) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, border: "1px solid var(--border-hairline)", borderRadius: 8, padding: "6px 10px" }}>
              <span>{t.intent} <span style={{ color: "var(--ink-400)", fontSize: 11 }}>({t.requirementTitle})</span></span>
              <a style={{ cursor: "pointer", color: "var(--status-critical)", fontSize: 11 }} onClick={() => unlink(t.id)}>הסר</a>
            </div>
          ))}
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חפש משימה לפי שם…" style={{ width: "100%" }} disabled={busy} />
      {results.length > 0 && (
        <div style={{ marginTop: 4, border: "1px solid var(--border-hairline)", borderRadius: 8, overflow: "hidden" }}>
          {results.filter((r) => !linked.some((l) => l.id === r.id)).map((t) => (
            <a key={t.id} onClick={() => link(t.id)} style={{ display: "block", padding: "7px 10px", fontSize: 12.5, cursor: "pointer", borderBottom: "1px solid var(--border-hairline)" }}>
              {t.intent} <span style={{ color: "var(--ink-400)", fontSize: 11 }}>({t.requirementTitle})</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function EditRequirement({ wi, onClose, onDone }: { wi: WorkItem; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    title: wi.title, type: wi.type as string, requirementType: wi.requirementType as string, priority: wi.priority as string, risk: wi.risk as string,
    executor: wi.executor as string, phase: wi.phase, budgetUsd: wi.budgetUsd ?? "",
    dueDate: wi.dueDate ? wi.dueDate.slice(0, 10) : "", adoAreaPath: wi.adoAreaPath ?? "", key: wi.key ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const wasClosed = wi.phase === "done" || wi.phase === "archived";
  const reopening = wasClosed && f.phase !== "done" && f.phase !== "archived";
  const submit = async () => {
    if (!f.title.trim()) return setErr("כותרת היא שדה חובה");
    if (reopening && !reopenReason.trim()) return setErr("צריך לציין למה פותחים מחדש");
    setBusy(true); setErr(null);
    try {
      await updateRequirement(wi.id, {
        title: f.title.trim(), type: f.type as ReqType, requirementType: f.requirementType as RequirementType, priority: f.priority, risk: f.risk, executor: f.executor,
        phase: f.phase, budgetUsd: f.budgetUsd === "" ? null : f.budgetUsd,
        dueDate: f.dueDate || null, adoAreaPath: f.adoAreaPath.trim() || null, key: f.key.trim() || null,
        ...(reopening ? { reopenReason: reopenReason.trim() } : {}),
      });
      onDone();
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="עריכת דרישה" onClose={onClose}>
      <div className="field" style={{ marginBottom: 12 }}><label>כותרת</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ width: "100%" }} />
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>סוג</label>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.he}</option>)}</select>
        </div>
        <div className="field"><label>שלב</label>
          <select value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>{PHASES.map(([v, he]) => <option key={v} value={v}>{he}</option>)}</select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>אופי הדרישה</label>
        <select value={f.requirementType} onChange={(e) => setF({ ...f, requirementType: e.target.value })}>
          <option value="development">פיתוח</option><option value="research">תחקור</option><option value="testing">בדיקות</option>
        </select>
        <p style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 4 }}>תחקור/בדיקות עדיין עוברים באותו תהליך פירוק כמו פיתוח — הבחנה חזותית ותהליך ייעודי בפלואו הם המשך מתוכנן, לא בנוי עדיין.</p>
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>עדיפות</label>
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option><option value="critical">קריטית</option>
          </select>
        </div>
        <div className="field"><label>סיכון</label>
          <select value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })}>
            <option value="low">נמוך</option><option value="medium">בינוני</option><option value="high">גבוה</option>
          </select>
        </div>
      </div>
      {wi.type === "bug" && <BugLinksSection bugId={wi.id} clientId={wi.clientId} />}
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>מבצע</label>
          <select value={f.executor} onChange={(e) => setF({ ...f, executor: e.target.value })}>
            <option value="human">אדם</option><option value="ai">AI</option><option value="mixed">משולב</option>
          </select>
        </div>
        <div className="field"><label>תקציב AI ($)</label>
          <input type="number" value={f.budgetUsd} onChange={(e) => setF({ ...f, budgetUsd: e.target.value })} placeholder="—" style={{ width: "100%" }} dir="ltr" />
        </div>
      </div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field"><label>תאריך יעד</label>
          <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} style={{ width: "100%" }} dir="ltr" />
        </div>
        <div className="field"><label>מפתח (WI-…)</label>
          <input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="WI-3001" style={{ width: "100%" }} dir="ltr" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}><label>ADO area path</label>
        <input value={f.adoAreaPath} onChange={(e) => setF({ ...f, adoAreaPath: e.target.value })} placeholder="Altshuler Trade\Trading Platform" style={{ width: "100%" }} dir="ltr" />
      </div>
      {reopening && (
        <div className="field" style={{ marginBottom: 12 }}><label>למה פותחים מחדש? (יישמר בהיסטוריית הדרישה)</label>
          <textarea
            value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2}
            placeholder="מה השתנה? למה הדרישה חוזרת לפעילות?"
            style={{ width: "100%", fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }}
          />
        </div>
      )}
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy || (reopening && !reopenReason.trim())} onClick={submit}>{busy ? "שומר…" : "שמור"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

/** Link a repository to a requirement — pick an existing one or create a new one. */
export function LinkRepoToReq({ workitemId, onClose, onDone }: { workitemId: string; onClose: () => void; onDone: () => void }) {
  const [repos, setRepos] = useState<{ id: string; name: string; clientName: string | null }[]>([]);
  const [f, setF] = useState({ choice: "", name: "", gitUrl: "", linkKind: "declared" as "declared" | "auto" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getRepos().then((r) => setRepos(r.repos)).catch(() => {}); }, []);
  const submit = async () => {
    const body = f.choice === "__new"
      ? { name: f.name.trim(), gitUrl: f.gitUrl.trim() || undefined, linkKind: f.linkKind }
      : { repoId: f.choice, linkKind: f.linkKind };
    if (f.choice === "" ) return setErr("בחר repository");
    if (f.choice === "__new" && !f.name.trim()) return setErr("שם ה-repository הוא שדה חובה");
    setBusy(true); setErr(null);
    try { await linkRepoToReq(workitemId, body); onDone(); }
    catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="קישור repository לדרישה" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: "var(--ink-500)", marginBottom: 14 }}>קישור ידני. הצינור (branches / אזורים מושפעים) יוסיף קישורים אוטומטית בסימון "auto".</p>
      <div className="field" style={{ marginBottom: 12 }}><label>repository</label>
        <select value={f.choice} onChange={(e) => setF({ ...f, choice: e.target.value })}>
          <option value="">— בחר —</option>
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}{r.clientName ? ` (${r.clientName})` : " (רוחבי)"}</option>)}
          <option value="__new">+ repository חדש…</option>
        </select>
      </div>
      {f.choice === "__new" && (
        <>
          <div className="field" style={{ marginBottom: 12 }}><label>שם</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ALTSHULER_TRADE" style={{ width: "100%" }} /></div>
          <div className="field" style={{ marginBottom: 12 }}><label>כתובת Git (אופציונלי)</label><input value={f.gitUrl} onChange={(e) => setF({ ...f, gitUrl: e.target.value })} placeholder="https://github.com/…" style={{ width: "100%" }} dir="ltr" /></div>
        </>
      )}
      <div className="field" style={{ marginBottom: 12 }}><label>מקור הקישור</label>
        <select value={f.linkKind} onChange={(e) => setF({ ...f, linkKind: e.target.value as "declared" | "auto" })}>
          <option value="declared">ידני (declared)</option><option value="auto">חלק מהתהליך (auto)</option>
        </select>
      </div>
      <Err e={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "מקשר…" : "קשר"}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}

/** Import work items from an Azure DevOps / TFS "Export to CSV" file. */
export function ImportCsv({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };
  const submit = async () => {
    if (csv.trim().length < 10) return setErr("הדבק CSV או בחר קובץ");
    setBusy(true); setErr(null); setResult(null);
    try { setResult(await importAdoCsv(clientId, csv)); }
    catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  return (
    <Modal title="ייבוא מ-Azure DevOps (CSV)" onClose={onClose}>
      {!result ? (
        <>
          <div style={{ fontSize: 12.5, color: "var(--ink-700)", background: "var(--surface-muted)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, lineHeight: 1.6 }}>
            ב-Azure DevOps: <b>Boards → Queries</b> → הרץ query → <b>⋯ → Export to CSV</b>. הדבק כאן או בחר את הקובץ.
            <br />העמודות הנדרשות: <code>ID</code>, <code>Title</code> · אופציונלי: <code>Work Item Type</code>, <code>State</code>, <code>Area Path</code>, <code>Tags</code>, <code>Description</code>.
            <br />פריטים שכבר יובאו (לפי ה-ID) יידלגו.
          </div>
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer", marginBottom: 10, display: "inline-block" }}>
            📎 בחר קובץ CSV
            <input type="file" hidden accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder='Work Item Type,ID,Title,State,Area Path,Tags,Description&#10;"Bug","46544","…"' style={{ width: "100%", minHeight: 140, fontFamily: "var(--mono)", fontSize: 11, direction: "ltr" }} />
          <Err e={err} />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "מייבא…" : "ייבא"}</button>
            <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, marginBottom: 10 }}>
            נוצרו <b>{result.created}</b> דרישות · דילגתי על <b>{result.skipped}</b> (מתוך {result.total}).
          </p>
          <div style={{ maxHeight: 260, overflowY: "auto", fontSize: 12, border: "1px solid var(--border-hairline)", borderRadius: 8 }}>
            {result.items.map((it, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "5px 10px", borderTop: i ? "1px solid var(--border-hairline)" : "none" }}>
                <span style={{ color: "var(--ink-400)", fontFamily: "var(--mono)", minWidth: 54 }}>#{it.adoId}</span>
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
                <span style={{ color: it.status === "created" ? "var(--status-healthy)" : "var(--ink-400)" }}>
                  {it.status === "created" ? "נוצר" : it.status === "skipped-exists" ? "קיים" : "דילוג"}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={onDone}>סגור</button>
          </div>
        </>
      )}
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

import { useEffect, useState } from "react";
import { getPrompts, updatePromptTemplate, type PromptTemplate } from "../api.ts";
import { PageHead } from "../ui.tsx";

/**
 * The system's own prompt library — every DCC-driven Claude call should
 * be built from a named template here instead of a string buried in
 * code, so what Claude is actually told is visible and editable without
 * a deploy. Starts with the one used by the "בחינת בשלות הדרישה" step;
 * more steps will get their own template here over time.
 */

const MODEL_OPTIONS = [
  { value: "", label: "ברירת מחדל של המערכת" },
  { value: "sonnet", label: "Sonnet — מאוזן (מומלץ לרוב המקרים)" },
  { value: "opus", label: "Opus — הכי יסודי, איטי ויקר יותר" },
  { value: "haiku", label: "Haiku — הכי מהיר וזול, לבדיקות פשוטות" },
];

function PromptCard({ p, onSaved }: { p: PromptTemplate; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [description, setDescription] = useState(p.description ?? "");
  const [body, setBody] = useState(p.body);
  const [bodyHe, setBodyHe] = useState(p.bodyHe ?? "");
  const [model, setModel] = useState(p.defaultModel ?? "");
  const [saving, setSaving] = useState(false);

  const open = () => { setTitle(p.title); setDescription(p.description ?? ""); setBody(p.body); setBodyHe(p.bodyHe ?? ""); setModel(p.defaultModel ?? ""); setEditing(true); };
  const save = async () => {
    setSaving(true);
    try {
      await updatePromptTemplate(p.id, { title, description: description || null, body, bodyHe: bodyHe || null, defaultModel: model || null });
      setEditing(false);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <p className="card-title" style={{ margin: 0 }}>{p.title}</p>
          <p style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-400)", direction: "ltr", textAlign: "left", marginTop: 2 }}>{p.key}</p>
        </div>
        {!editing && <button className="btn btn-secondary btn-sm" onClick={open}>ערוך</button>}
      </div>
      {p.description && !editing && <p style={{ fontSize: 12.5, color: "var(--ink-600)", marginBottom: 10 }}>{p.description}</p>}

      {editing ? (
        <>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>שם</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>תיאור קצר (מוצג כאן, לא נשלח ל-Claude)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="מתי ואיך הפרומפט הזה רץ" />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>מודל ברירת מחדל</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>אפשר לדרוס בזמן ההרצה עצמה.</span>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>גוף הפרומפט</label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)} rows={22}
              style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6, direction: "ltr", textAlign: "left" }}
            />
            <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>
              {"{{PLACEHOLDER}}"} מוחלף אוטומטית בזמן ריצה — אל תמחק את השמות בלי לוודא שהקוד עדיין ממלא אותם. זה מה שבאמת נשלח ל-Claude.
            </span>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>תרגום לעברית (לתצוגה מקדימה בלבד — לא נשלח ל-Claude)</label>
            <textarea
              value={bodyHe} onChange={(e) => setBodyHe(e.target.value)} rows={22}
              style={{ fontSize: 12, lineHeight: 1.6 }}
              placeholder="ריק = התצוגה המקדימה תציג רק את הגרסה באנגלית"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>ביטול</button>
          </div>
        </>
      ) : (
        <>
          <div className="stat-line">
            <span className="l">מודל ברירת מחדל</span>
            <span>{MODEL_OPTIONS.find((o) => o.value === (p.defaultModel ?? ""))?.label ?? p.defaultModel}</span>
          </div>
          <div className="stat-line">
            <span className="l">עודכן</span>
            <span>{new Date(p.updatedAt).toLocaleString("he-IL")}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Prompts() {
  const [items, setItems] = useState<PromptTemplate[] | null>(null);
  const reload = () => { getPrompts().then((r) => setItems(r.items)).catch(() => setItems([])); };
  useEffect(() => { reload(); }, []);

  return (
    <>
      <PageHead title="פרומפטים" sub="ספריית הפרומפטים של המערכת — כל קריאה ל-Claude מ-DCC בנויה מתבנית כאן, לא ממחרוזת קבועה בקוד." />
      {items === null && <div className="spin">טוען…</div>}
      {items && items.length === 0 && <div className="empty">אין עדיין פרומפטים בספרייה.</div>}
      {items?.map((p) => <PromptCard key={p.id} p={p} onSaved={reload} />)}
    </>
  );
}

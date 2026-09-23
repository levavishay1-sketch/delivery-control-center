import { useEffect, useState } from "react";
import { getPrompts, updatePromptTemplate, type PromptTemplate } from "../api.ts";
import { CardTitle, PageHead, PromptText } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { effortLabel, modelLabel } from "../claude/labels.ts";
import { errText } from "./onboarding/labels.ts";

/**
 * The system's own prompt library — every instruction DCC sends to Claude is
 * a row here, read at the moment of the call, so what Claude is told is
 * visible and editable without a deploy. Each card says where the prompt
 * runs, which model runs it, and what in it the code depends on; a save that
 * removes one of those is refused by the server, in words.
 */

const MODEL_OPTIONS = [
  { value: "", label: "ברירת מחדל של המערכת" },
  { value: "sonnet", label: "Sonnet — מאוזן (מומלץ לרוב המקרים)" },
  { value: "opus", label: "Opus — הכי יסודי, איטי ויקר יותר" },
  { value: "haiku", label: "Haiku — הכי מהיר וזול, לבדיקות פשוטות" },
];

/** Category by key prefix (before the first "."), in the order work moves
 *  through DCC. A prefix not listed falls back to "אחר" — never dropped,
 *  just uncategorized until this table is updated. */
const CATEGORIES: [prefix: string, title: string][] = [
  ["assess", "בחינת בשלות דרישה (Assess)"],
  ["gaps", "פערים (Gaps)"],
  ["breakdown", "פירוק לעבודה (Breakdown)"],
  ["implement", "מימוש (Implement)"],
  ["chat", "הצ'אט — שאל את קלוד"],
  ["onboarding", "קליטת מאגר (Onboarding)"],
  ["insights", "ניתוח שאלות (Insights)"],
];
const OTHER = "אחר";
const categoryFor = (key: string) => CATEGORIES.find(([p]) => p === key.split(".")[0])?.[1] ?? OTHER;

const APPENDED_TO_HE: Record<string, string> = { "assess.readiness": "נוסף בסוף כל אחת מחמש רמות בחינת הבשלות — שינוי כאן משנה את כולן." };

/** What the code depends on in this prompt — the values it fills in and the text it reads back. */
function Contract({ use }: { use: NonNullable<PromptTemplate["use"]> }) {
  const code = (s: string) => <code key={s} style={{ direction: "ltr", unicodeBidi: "isolate", fontSize: 11.5, background: "var(--surface-muted)", borderRadius: 6, padding: "1px 6px", marginInlineEnd: 6, display: "inline-block", marginBottom: 4 }}>{s}</code>;
  if (!use.vars.length && !use.optional.length && !use.keeps.length) return null;
  return (
    <div className="stat-line" style={{ alignItems: "flex-start", gap: 12 }}>
      <span className="l" style={{ flexShrink: 0 }}>מה חייב להישאר<Info k="prompt_contract" /></span>
      <div style={{ textAlign: "start" }}>
        {use.vars.length > 0 && <div>הקוד ממלא: {use.vars.map((v) => code(`{{${v}}}`))}</div>}
        {use.optional.length > 0 && <div style={{ color: "var(--ink-500)" }}>אפשר להשתמש (לא חובה): {use.optional.map((v) => code(`{{${v}}}`))}</div>}
        {use.keeps.length > 0 && <div>הקוד קורא מהתשובה: {use.keeps.map(code)}</div>}
      </div>
    </div>
  );
}

function PromptCard({ p, onSaved }: { p: PromptTemplate; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [description, setDescription] = useState(p.description ?? "");
  const [body, setBody] = useState(p.body);
  const [bodyHe, setBodyHe] = useState(p.bodyHe ?? "");
  const [model, setModel] = useState(p.defaultModel ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const modelPerRun = !p.use || p.use.modelPerRun;

  const open = () => { setTitle(p.title); setDescription(p.description ?? ""); setBody(p.body); setBodyHe(p.bodyHe ?? ""); setModel(p.defaultModel ?? ""); setErr(null); setEditing(true); };
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await updatePromptTemplate(p.id, { title, description: description || null, body, bodyHe: bodyHe || null, ...(modelPerRun ? { defaultModel: model || null } : {}) });
      setEditing(false);
      onSaved();
    } catch (e) { setErr(errText(e)); } finally { setSaving(false); }
  };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
        <div>
          <p className="card-title" style={{ margin: 0 }}>{p.title}<Info k="prompt_template" /></p>
          <p style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-400)", direction: "ltr", textAlign: "left", marginTop: 2 }}>{p.key}</p>
        </div>
        {!editing && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setReading((r) => !r)}>{reading ? "הסתר" : "הצג את הפרומפט"}</button>
            <Info k="prompt_read" />
            <button className="btn btn-secondary btn-sm" onClick={open}>ערוך</button>
          </div>
        )}
      </div>
      {p.description && !editing && <p style={{ fontSize: 12.5, color: "var(--ink-600)", marginBottom: 10 }}>{p.description}</p>}
      {p.problems.length > 0 && !editing && (
        <div className="ob-note crit" style={{ marginBottom: 10 }}>
          {/* no-info: the lines themselves say what is wrong and what it breaks */}
          <b>הפרומפט הזה שבור — הקריאה שמשתמשת בו לא תעבוד כמו שצריך:</b>
          {p.problems.map((x) => <div key={x}>• {x}</div>)}
        </div>
      )}

      {editing ? (
        <>
          <div className="field" style={{ marginBottom: 10 }}>
            {/* no-info: the prompt's own name */}<label>שם</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            {/* no-info: the label already says what it is and where it goes */}<label>תיאור קצר (מוצג כאן, לא נשלח ל-Claude)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="מתי ואיך הפרומפט הזה רץ" />
          </div>
          {modelPerRun && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label>מודל ברירת מחדל<Info k="prompt_default_model" /></label>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>אפשר לדרוס בזמן ההרצה עצמה.</span>
            </div>
          )}
          {p.use && <Contract use={p.use} />}
          <div className="field" style={{ marginBottom: 12, marginTop: 10 }}>
            <label>גוף הפרומפט<Info k="prompt_body" /></label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)} rows={22}
              style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.6, direction: "ltr", textAlign: "left" }}
            />
            <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>
              זה מה שבאמת נשלח ל-Claude. {"{{NAME}}"} מוחלף בערך בזמן הריצה; {"{{#NAME}}…{{/NAME}}"} נשלח רק כשהערך קיים, ו-{"{{^NAME}}…{{/NAME}}"} רק כשאינו קיים.
            </span>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            {/* no-info: the label already says what it is and where it goes */}<label>תרגום לעברית (לקריאה ולתצוגה המקדימה בלבד — לא נשלח ל-Claude)</label>
            <textarea
              value={bodyHe} onChange={(e) => setBodyHe(e.target.value)} rows={22}
              style={{ fontSize: 12, lineHeight: 1.6 }}
              placeholder="ריק = התצוגה המקדימה תציג רק את הגרסה באנגלית"
            />
          </div>
          {err && <div className="ob-note crit" style={{ marginBottom: 10, whiteSpace: "pre-line" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "שומר…" : "שמור"}</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>ביטול</button>
          </div>
        </>
      ) : (
        <>
          {!p.use ? (
            <div className="stat-line">
              <span className="l">בשימוש<Info k="prompt_unused" /></span>
              <span className="pill warning">שום קריאה לא משתמשת בו</span>
            </div>
          ) : p.use.modelPerRun ? (
            <div className="stat-line">
              <span className="l">מודל ברירת מחדל<Info k="prompt_default_model" /></span>
              <span>{MODEL_OPTIONS.find((o) => o.value === (p.defaultModel ?? ""))?.label ?? p.defaultModel}</span>
            </div>
          ) : (
            <div className="stat-line">
              <span className="l">מי מריץ אותו<Info k="prompt_policy_model" /></span>
              <span>{modelLabel(p.use.policy.model)} · מאמץ {effortLabel(p.use.policy.effort)} <span style={{ color: "var(--ink-400)" }}>(לפי מדיניות המודלים)</span></span>
            </div>
          )}
          {p.use?.appendedTo && (
            <div className="stat-line">
              <span className="l">נשלח יחד עם<Info k="prompt_appended" /></span>
              <span>{APPENDED_TO_HE[p.use.appendedTo] ?? p.use.appendedTo}</span>
            </div>
          )}
          {p.use && <Contract use={p.use} />}
          <div className="stat-line">
            {/* no-info: when this prompt was last edited */}<span className="l">עודכן</span>
            <span>{new Date(p.updatedAt).toLocaleString("he-IL")}</span>
          </div>
          {reading && <div style={{ marginTop: 12 }}><PromptText prompt={p.body} promptHe={p.bodyHe} maxHeight="60vh" /></div>}
        </>
      )}
    </div>
  );
}

export function Prompts() {
  const [items, setItems] = useState<PromptTemplate[] | null>(null);
  const reload = () => { getPrompts().then((r) => setItems(r.items)).catch(() => setItems([])); };
  useEffect(() => { reload(); }, []);

  const loading = items === null;
  const order = [...CATEGORIES.map(([, t]) => t), OTHER];
  const categories = new Map<string, PromptTemplate[]>();
  for (const p of items ?? []) {
    const c = categoryFor(p.key);
    categories.set(c, [...(categories.get(c) ?? []), p]);
  }
  const sorted = [...categories.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const empty = !loading && categories.size === 0;

  return (
    <>
      <PageHead info="page_prompts" title="פרומפטים" sub="כל ההוראות ש-DCC שולח ל-Claude, לפי השלב שבו הן רצות. כל קריאה נבנית מהטקסט שכאן ברגע שהיא רצה — עריכה כאן משנה את הקריאה הבאה." />
      {loading && <div className="spin">טוען…</div>}
      {empty && <div className="empty">אין עדיין פרומפטים בספרייה.</div>}

      {sorted.map(([cat, list]) => (
        <section key={cat} style={{ marginBottom: 24 }}>
          <CardTitle as="h3" info="prompt_category" style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{cat}</CardTitle>
          {list.map((p) => <PromptCard key={p.id} p={p} onSaved={reload} />)}
        </section>
      ))}
    </>
  );
}

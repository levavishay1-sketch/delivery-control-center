import { useEffect, useState, type ReactNode } from "react";
import {
  getOnboardingExecution, updateOnboardingPrompt,
  type AutomationPolicy, type AutomationPreset, type LifecyclePhase, type ModelChoice, type ModelPolicy, type OnboardingEvent, type OnboardingExecution, type OnboardingStatus, type StageDefinition, type StageKind, type StagePolicy,
} from "../../api.ts";
import { Pill } from "../../ui.tsx";

/* ── labels ─────────────────────────────────────────────────────────── */

export type PillTone = "warning" | "critical" | "active" | "healthy" | "ai" | "inactive" | "neutral";

export const STATUS_HE: Record<OnboardingStatus, string> = {
  Pending: "טרם הגיע", Running: "רץ עכשיו", WaitingForUser: "ממתין להחלטה שלך", AwaitingExternal: "ממתין למיזוג ה-PR",
  Completed: "הושלם", CompletedWithWarnings: "הושלם עם אזהרות", Failed: "נכשל", Skipped: "דולג", Cancelled: "בוטל",
};
export const STATUS_TONE: Record<OnboardingStatus, PillTone> = {
  Pending: "inactive", Running: "ai", WaitingForUser: "warning", AwaitingExternal: "active",
  Completed: "healthy", CompletedWithWarnings: "healthy", Failed: "critical", Skipped: "inactive", Cancelled: "inactive",
};
export const KIND_HE: Record<StageKind, string> = { deterministic: "דטרמיניסטי (ללא AI)", ai: "קריאת AI", human: "החלטה אנושית", mixed: "DCC + קריאת AI" };
export const PHASE_HE: Record<LifecyclePhase, string> = {
  requirement: "דרישה", understanding: "הבנה", planning: "תכנון", implementation: "מימוש", testing: "בדיקות", review: "סקירה", deployment: "מסירה", future_sessions: "sessions עתידיים",
};
export const REVERSIBLE_HE: Record<StageDefinition["reversible"], string> = { yes: "הפיך לחלוטין", partial: "גלוי לאחרים, ניתן לביטול", external: "פעולה של אנשים בלבד" };
export const LOADING_HE: Record<string, string> = { always: "נטען בכל session", on_demand: "נטען לפי דרישה", never: "ללא עלות הקשר" };
export const ACTION_HE: Record<string, string> = { create: "יצירה", update: "עדכון", skip: "לא ייווצר", remove: "הסרה" };
export const WRITER_HE: Record<string, string> = { ai: "ניסוח AI · כתיבה DCC", dcc: "DCC (דטרמיניסטי)" };
export const ARTIFACT_KIND_HE: Record<string, string> = {
  claude_md: "CLAUDE.md", nested_claude_md: "CLAUDE.md מקונן", rule: "Rule לפי נתיבים", knowledge_skill: "Skill ידע", workflow_skill: "Skill תהליך",
  agent: "Subagent", settings: "settings.json", guardrail_hook: "Guardrail hook", dcc_hooks: "hooks של DCC",
  legacy_artifact: "תיעוד AI קיים",
};
export const PRESET_HE: Record<AutomationPreset, { title: string; desc: string }> = {
  step_by_step: { title: "צעד אחר צעד", desc: "שום שלב לא מתחיל לבד. אתם מריצים כל שלב, קוראים את התוצאה, ומחליטים בכל שער." },
  guided: { title: "מודרך (מומלץ)", desc: "השלבים רצים לבד; ההרצה עוצרת בארבעת השערים האנושיים — גבולות, אימות, תוכנית, סקירה — ומחכה להחלטה שלכם." },
  automatic: { title: "אוטומטי מלא", desc: "השערים מאושרים לפי ההצעות, בהסכמה מפורשת מראש. שום דבר לא מתמזג לבד: ה-PR נשאר לסקירה אנושית ב-Git." },
  custom: { title: "מותאם אישית", desc: "לכל שלב בנפרד: האם הוא מתחיל לבד, והאם השער שלו ממתין לאדם." },
};
export const RISK_HE: Record<string, string> = { LOW: "סיכון נמוך", MEDIUM: "סיכון בינוני", HIGH: "סיכון גבוה" };
export const RISK_TONE: Record<string, PillTone> = { LOW: "inactive", MEDIUM: "warning", HIGH: "critical" };

/* ── small helpers ──────────────────────────────────────────────────── */

export function errText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const m = s.match(/^\d{3}\s+([\s\S]*)$/);
  if (!m) return s;
  try {
    const j = JSON.parse(m[1]!) as { error?: unknown };
    if (typeof j.error === "string") return j.error;
    if (Array.isArray(j.error)) return (j.error as { message?: string; path?: unknown[] }[]).map((i) => `${Array.isArray(i.path) ? i.path.join(".") + ": " : ""}${i.message ?? ""}`).join("; ");
  } catch { /* not JSON */ }
  return m[1]!;
}
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—");
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDuration = (ms: number | null | undefined) => (ms == null ? "—" : ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} שנ'` : `${Math.floor(ms / 60_000)} דק' ${Math.round((ms % 60_000) / 1000)} שנ'`);
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
export const fmtUsd = (n: number | string | null | undefined) => (n == null || n === "" ? "—" : `$${Number(n).toFixed(Number(n) < 1 ? 3 : 2)}`);
export const shortSha = (s: string | null | undefined) => (s ? s.slice(0, 10) : "—");
export const elapsedSince = (iso: string | null | undefined) => (iso ? fmtDuration(Date.now() - new Date(iso).getTime()) : "—");

export function Code({ children }: { children: ReactNode }) { return <code className="ob-code">{children}</code>; }

export function Section({ title, aside, children, style }: { title: ReactNode; aside?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginTop: 16, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <p className="section-lbl" style={{ marginBottom: 0 }}>{title}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Note({ tone, children }: { tone: "info" | "warn" | "crit" | "ok" | "ai"; children: ReactNode }) {
  const bg = tone === "warn" ? "var(--status-warning-bg)" : tone === "crit" ? "var(--status-critical-bg)" : tone === "ok" ? "var(--status-healthy-bg)" : tone === "ai" ? "var(--status-ai-bg)" : "var(--surface-muted)";
  return <div style={{ background: bg, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.6 }}>{children}</div>;
}

export function KV({ items }: { items: { l: string; v: ReactNode }[] }) {
  return (
    <div className="ob-kv">
      {items.map((it) => <div key={it.l}><div className="l">{it.l}</div><div className="v">{it.v}</div></div>)}
    </div>
  );
}

export function Chips({ items, tone }: { items: string[] | undefined; tone?: string }) {
  if (!items?.length) return <span style={{ color: "var(--ink-400)", fontSize: 12 }}>—</span>;
  return <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>{items.map((x, i) => <span key={`${x}-${i}`} className={`ob-chip${tone ? ` ${tone}` : ""}`}>{x}</span>)}</span>;
}

/* ── stage explanation (shown BEFORE the stage runs) ────────────────── */

export function StageMetaChips({ def }: { def: StageDefinition }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 5 }}>
      <span className={`ob-chip ${def.kind === "ai" || def.kind === "mixed" ? "ai" : def.kind === "human" ? "human" : "det"}`}>{KIND_HE[def.kind]}</span>
      {def.gate && <span className="ob-chip human">שער אנושי{def.autoApprovable ? " · ניתן לאישור אוטומטי" : ""}</span>}
      <span className="ob-chip">{def.writesRepo ? "כותב ל-worktree המבודד" : "לא כותב קבצים"}</span>
      <span className="ob-chip">{REVERSIBLE_HE[def.reversible]}</span>
    </span>
  );
}

export function StageExplainer({ def }: { def: StageDefinition }) {
  return (
    <div className="ob-explain">
      <div><b>למה</b><span>{def.why_he}</span></div>
      <div><b>מה קורה</b><span>{def.what_he}</span></div>
      <div><b>הערך</b><span>{def.value_he}</span></div>
      <div><b>תומך ב</b><span><Chips items={def.supports.map((p) => PHASE_HE[p])} /></span></div>
      <div><b>הפלט</b><span>{def.output_he}</span></div>
      <div><b>ההשפעה</b><span>{def.impact_he}</span></div>
    </div>
  );
}

/* ── automation policy (client mirror of types.ts presetPolicy) ─────── */

export function presetPolicy(stages: readonly StageDefinition[], preset: Exclude<AutomationPreset, "custom">): AutomationPolicy {
  const out: Record<string, StagePolicy> = {};
  for (const s of stages) {
    if (preset === "step_by_step") out[s.key] = s.gate ? { run: "manual", gate: "approve" } : { run: "manual" };
    else if (preset === "guided") out[s.key] = s.gate ? { run: "auto", gate: "approve" } : { run: "auto" };
    else out[s.key] = s.gate ? { run: "auto", gate: s.autoApprovable ? "auto" : "approve" } : { run: "auto" };
  }
  return { preset, stages: out };
}
export const policyNeedsConsent = (p: AutomationPolicy) => p.preset === "automatic" || Object.values(p.stages).some((s) => s?.gate === "auto");
export function describePolicy(p: AutomationPolicy, stages: readonly StageDefinition[]): string {
  const manual = stages.filter((s) => p.stages[s.key]?.run === "manual").length;
  const autoGates = stages.filter((s) => s.gate && p.stages[s.key]?.gate === "auto").length;
  const gates = stages.filter((s) => s.gate).length;
  return `${PRESET_HE[p.preset].title} · ${manual === 0 ? "כל השלבים מתחילים לבד" : manual === stages.length ? "כל שלב מתחיל ידנית" : `${manual} שלבים ידניים`} · ${autoGates === 0 ? `${gates} שערים ממתינים לאדם` : `${autoGates}/${gates} שערים אוטומטיים`}`;
}

export function AutomationEditor({ stages, value, onChange, consent, onConsent }: {
  stages: readonly StageDefinition[]; value: AutomationPolicy; onChange: (p: AutomationPolicy) => void;
  consent: boolean; onConsent: (b: boolean) => void;
}) {
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const setStage = (key: string, patch: Partial<StagePolicy>) => {
    const cur = value.stages[key] ?? { run: "auto" as const };
    onChange({ preset: "custom", stages: { ...value.stages, [key]: { ...cur, ...patch } } });
    setShowCustom(true);
  };
  const needsConsent = policyNeedsConsent(value);
  return (
    <div>
      <div className="ob-preset">
        {(["step_by_step", "guided", "automatic"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={value.preset === p} onClick={() => { onChange(presetPolicy(stages, p)); setShowCustom(false); }}>
            <div className="t">{PRESET_HE[p].title}</div>
            <div className="d">{PRESET_HE[p].desc}</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="ob-toggle" onClick={() => setShowCustom((v) => !v)}>{showCustom ? "הסתר הגדרה לכל שלב" : "הגדרה לכל שלב בנפרד…"}</button>
        {value.preset === "custom" && <span className="ob-chip">מותאם אישית</span>}
      </div>
      {showCustom && (
        <div className="ob-pol" style={{ marginTop: 10 }}>
          <span className="h">שלב</span><span className="h">מתחיל</span><span className="h">השער</span>
          {stages.map((s) => {
            const sp = value.stages[s.key] ?? { run: "auto" as const };
            return (
              <div key={s.key} style={{ display: "contents" }}>
                <span>{s.order + 1}. {s.title_he}{s.gate ? "" : <span className="ob-sub"> · ללא שער</span>}</span>
                <span className="ob-seg">
                  <button type="button" aria-pressed={sp.run === "auto"} onClick={() => setStage(s.key, { run: "auto" })}>לבד</button>
                  <button type="button" aria-pressed={sp.run === "manual"} onClick={() => setStage(s.key, { run: "manual" })}>ידני</button>
                </span>
                {s.gate ? (
                  <span className="ob-seg">
                    <button type="button" aria-pressed={sp.gate !== "auto"} onClick={() => setStage(s.key, { gate: "approve" })}>ממתין לאדם</button>
                    <button type="button" aria-pressed={sp.gate === "auto"} disabled={!s.autoApprovable} onClick={() => setStage(s.key, { gate: "auto" })}>אוטומטי</button>
                  </span>
                ) : <span className="ob-sub">—</span>}
              </div>
            );
          })}
        </div>
      )}
      {needsConsent && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 12.5, cursor: "pointer", background: "var(--status-warning-bg)", borderRadius: 10, padding: "10px 12px" }}>
          <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <b>הסכמה מפורשת לאישור שערים אוטומטי.</b> DCC יאשר בשמי את ההצעות בשערים שסומנו "אוטומטי" (גבולות קריאה, שאלות שיישארו UNKNOWN, תוכנית ה-artifacts, ואישור ה-diff). כל החלטה כזו נרשמת ביומן.
            המיזוג ל-default branch לעולם אינו אוטומטי — ה-PR נשאר לסקירה ב-Git.
          </span>
        </label>
      )}
    </div>
  );
}

/* ── per-stage model/effort choice ──────────────────────────────────── */

/** Mirrors `config/model-policy.json`'s three tiers — a display list only;
 *  the actual routing/recommendation always comes from the server. */
export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — מהיר וזול" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-5", label: "Opus 5 — חזק ויקר" },
];
export const EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "נמוך" },
  { value: "medium", label: "בינוני" },
  { value: "high", label: "גבוה" },
  { value: "xhigh", label: "גבוה מאוד" },
  { value: "max", label: "מקסימלי" },
];

/** Per-AI-stage model + effort — a recommendation from the policy that a
 *  person may override; a field left as "מומלץ" simply isn't stored, so a
 *  later policy change (a new default) takes effect automatically. */
export function ModelChoiceEditor({ stages, value, onChange }: {
  stages: readonly StageDefinition[]; value: ModelPolicy; onChange: (p: ModelPolicy) => void;
}) {
  const aiStages = stages.filter((s) => s.capability && s.recommended);
  const setChoice = (key: string, patch: Partial<ModelChoice>) => {
    const next: ModelChoice = { ...(value[key] ?? {}), ...patch };
    const cleaned: ModelChoice = {};
    if (next.model) cleaned.model = next.model;
    if (next.effort) cleaned.effort = next.effort;
    const out = { ...value };
    if (cleaned.model || cleaned.effort) out[key] = cleaned; else delete out[key];
    onChange(out);
  };
  if (!aiStages.length) return null;
  return (
    <div className="ob-pol" style={{ marginTop: 10 }}>
      <span className="h">שלב</span><span className="h">מודל</span><span className="h">מאמץ (effort)</span>
      {aiStages.map((s) => {
        const rec = s.recommended!;
        const choice = value[s.key] ?? {};
        const effectiveModel = choice.model ?? rec.model;
        const effectiveEffort = choice.effort ?? rec.effort;
        return (
          <div key={s.key} style={{ display: "contents" }}>
            <span>{s.title_he}</span>
            <select className="ob-select" value={effectiveModel} onChange={(e) => setChoice(s.key, { model: e.target.value === rec.model ? undefined : e.target.value })}>
              {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}{m.value === rec.model ? " · מומלץ" : ""}</option>)}
            </select>
            <select className="ob-select" value={effectiveEffort} onChange={(e) => setChoice(s.key, { effort: e.target.value === rec.effort ? undefined : e.target.value })}>
              {EFFORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}{o.value === rec.effort ? " · מומלץ" : ""}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

/** Compact read-only line for a single stage's effective model/effort —
 *  used next to the stage explainer before it runs. */
export function ModelChoiceHint({ def, choice }: { def: StageDefinition; choice?: ModelChoice }) {
  if (!def.recommended) return null;
  const model = choice?.model ?? def.recommended.model;
  const effort = choice?.effort ?? def.recommended.effort;
  const modelLabel = MODEL_OPTIONS.find((m) => m.value === model)?.label ?? model;
  const overridden = !!(choice?.model || choice?.effort);
  return (
    <span className="ob-sub" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      מודל: {modelLabel} · effort: {effort}{overridden ? " (נבחר ידנית)" : " (מומלץ)"}
    </span>
  );
}

/* ── the Claude call behind a stage ─────────────────────────────────── */

export function ClaudeCallPanel({ repoId, executionId }: { repoId: string; executionId: string }) {
  const [exec, setExec] = useState<OnboardingExecution | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setExec(null); setEditing(false); setSaveState("idle"); setFailed(false);
    getOnboardingExecution(repoId, executionId).then((e) => { setExec(e); setDraft(e.promptBody); }).catch(() => setFailed(true));
  }, [repoId, executionId]);

  if (failed) return <p className="ob-sub">פרטי הקריאה ל-Claude אינם זמינים.</p>;
  if (!exec) return <p className="ob-sub">טוען את פרטי הקריאה ל-Claude…</p>;
  const rj = (exec.resultJson ?? null) as { permissionDenials?: unknown[]; toolCalls?: Record<string, number> } | null;
  const denials = Array.isArray(rj?.permissionDenials) ? rj!.permissionDenials! : [];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <KV items={[
        { l: "מודל", v: exec.model ?? "—" },
        { l: "מאמץ (effort)", v: exec.effort ?? "—" },
        { l: "הרשאות", v: exec.permissionProfile === "restricted_read" ? "קריאה בלבד, מוגבל" : exec.permissionProfile },
        { l: "עלות", v: fmtUsd(exec.costUsd) },
        { l: "טוקנים (קלט / פלט)", v: `${fmtInt(exec.inputTokens)} / ${fmtInt(exec.outputTokens)}` },
        { l: "משך · סבבים", v: `${fmtDuration(exec.durationMs)} · ${exec.numTurns ?? "—"}` },
        { l: "סטטוס", v: exec.status },
      ]} />
      {exec.errorMessage && <Note tone="crit">{exec.errorMessage}</Note>}
      {denials.length > 0 && <Note tone="warn">{denials.length} פעולות נחסמו על ידי מדיניות ההרשאות במהלך הקריאה — ה-AI לא קיבל גישה אליהן.</Note>}
      {exec.denyRulesSnapshot.length > 0 && (
        <div style={{ fontSize: 11.5 }}><b>כללי חסימה שנאכפו:</b> <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>{exec.denyRulesSnapshot.map((r) => <Code key={r}>{r}</Code>)}</span></div>
      )}
      <div>
        <p className="section-lbl">הפרומפט · {exec.promptKey} גרסה {exec.promptVersion}</p>
        {!editing ? (
          <>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--surface-muted)", padding: 10, borderRadius: 8, maxHeight: 260, overflow: "auto", fontFamily: "var(--mono)", direction: "ltr", textAlign: "left", margin: 0 }}>{exec.promptBody}</pre>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>ערוך פרומפט לריצות הבאות</button>
          </>
        ) : (
          <>
            <textarea style={{ width: "100%", minHeight: 220, fontSize: 11.5, fontFamily: "var(--mono)", direction: "ltr" }} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <p className="ob-sub" style={{ margin: "4px 0" }}>השמירה יוצרת גרסה חדשה (בלתי ניתנת לשינוי) — היא חלה רק על ההרצה הבאה של השלב הזה, לא על קריאות שכבר בוצעו.</p>
            <div className="ob-actions">
              <button className="btn btn-primary btn-sm" disabled={saveState === "saving"} onClick={async () => {
                setSaveState("saving");
                try { await updateOnboardingPrompt(exec.promptKey, draft); setSaveState("saved"); setEditing(false); } catch { setSaveState("error"); }
              }}>{saveState === "saving" ? "שומר…" : "שמור גרסה חדשה"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setDraft(exec.promptBody); }}>ביטול</button>
            </div>
            {saveState === "error" && <p style={{ fontSize: 11, color: "var(--status-critical)", marginTop: 4 }}>שמירת הפרומפט נכשלה.</p>}
          </>
        )}
        {saveState === "saved" && <p style={{ fontSize: 11, color: "var(--status-healthy)", marginTop: 6 }}>נשמרה גרסה חדשה של הפרומפט.</p>}
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>הפלט הגולמי שהתקבל</summary>
        {exec.resultText
          ? <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, background: "var(--surface-muted)", padding: 10, borderRadius: 8, maxHeight: 320, overflow: "auto", direction: "ltr", textAlign: "left", marginTop: 6 }}>{exec.resultText}</pre>
          : <p className="ob-sub" style={{ marginTop: 6 }}>אין פלט טקסטואלי.</p>}
      </details>
    </div>
  );
}

/* ── raw result fallback ────────────────────────────────────────────── */

const humanizeKey = (k: string) => k.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
export function ResultView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === "") return <span style={{ color: "var(--ink-400)" }}>—</span>;
  if (typeof value !== "object") return <span style={{ fontSize: 12 }}>{String(value)}</span>;
  if (depth > 6) return <span style={{ color: "var(--ink-400)" }}>…</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: "var(--ink-400)" }}>(ריק)</span>;
    return <ul className="ob-list">{value.map((v, i) => <li key={i}>{typeof v === "object" && v !== null ? <ResultView value={v} depth={depth + 1} /> : String(v)}</li>)}</ul>;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span style={{ color: "var(--ink-400)" }}>(ריק)</span>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <b style={{ color: "var(--ink-700)", fontSize: 11.5 }}>{humanizeKey(k)}: </b>
          {typeof v === "object" && v !== null ? <div style={{ marginTop: 2, marginInlineStart: 12 }}><ResultView value={v} depth={depth + 1} /></div> : <ResultView value={v} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}
export function RawResult({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--ink-500)" }}>כל הנתונים של השלב (גולמי)</summary>
      <div style={{ marginTop: 8, fontSize: 12 }}><ResultView value={value} /></div>
    </details>
  );
}

/* ── decision log ───────────────────────────────────────────────────── */

export function eventLabel(e: OnboardingEvent, title: (k: string) => string): { text: string; tone: PillTone } {
  const p = e.payload ?? {};
  const k = typeof p.stageKey === "string" ? p.stageKey : "";
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  switch (e.type) {
    case "onboarding.run.started": return { text: `ההרצה התחילה (${p.mode === "refresh" ? "רענון" : "onboarding ראשוני"}, ${PRESET_HE[str(p.automation) as AutomationPreset]?.title ?? str(p.automation)})`, tone: "active" };
    case "onboarding.stage.completed": return { text: `${title(k)}: ${p.status === "Skipped" ? "דולג" : "הושלם"}${Array.isArray(p.warnings) && p.warnings.length ? ` (${p.warnings.length} אזהרות)` : ""}`, tone: "healthy" };
    case "onboarding.stage.waiting_for_user": return { text: `${title(k)}: ממתין להחלטה`, tone: "warning" };
    case "onboarding.stage.awaiting_external": return { text: `${title(k)}: ממתין למיזוג ה-PR`, tone: "active" };
    case "onboarding.stage.failed": return { text: `${title(k)}: נכשל${Array.isArray(p.errors) && p.errors[0] ? ` — ${String(p.errors[0]).slice(0, 140)}` : ""}`, tone: "critical" };
    case "onboarding.run.completed": return { text: `ההרצה הושלמה${p.status === "CompletedWithWarnings" ? " עם אזהרות" : ""} — ה-Repository מוכן ל-AI`, tone: "healthy" };
    case "onboarding.run.reset": return { text: `חזרה ל-${title(str(p.to))} (${p.from === "person" ? "החלטת אדם" : `מתוך ${title(str(p.from))}`})${str(p.note) ? `: ${str(p.note).slice(0, 160)}` : ""}`, tone: "warning" };
    case "onboarding.gate.auto_resolved": return { text: `${title(k)}: השער אושר אוטומטית לפי המדיניות (${PRESET_HE[str(p.preset) as AutomationPreset]?.title ?? str(p.preset)})`, tone: "ai" };
    case "onboarding.stage.input_submitted": {
      const i = (p.input ?? {}) as Record<string, unknown>;
      const who = p.source === "automation" ? "אוטומציה" : "אדם";
      let detail = "";
      if (k === "boundaries") detail = `פרופיל ${str(i.profileId)}, ${typeof i.rules === "number" ? i.rules : 0} כללי חסימה`;
      else if (k === "confirm") detail = `${typeof i.answered === "number" ? i.answered : 0}/${typeof i.total === "number" ? i.total : 0} שאלות נענו`;
      else if (k === "plan") detail = `${Array.isArray(i.approvedKeys) ? i.approvedKeys.length : 0} artifacts אושרו`;
      else if (k === "review") detail = i.decision === "approve" ? `אישור${Array.isArray(i.dropPaths) && i.dropPaths.length ? ` (הוסרו ${i.dropPaths.length} קבצים)` : ""}` : `בקשת שינויים: ${str(i.note).slice(0, 120)}`;
      return { text: `${title(k)}: החלטה נרשמה (${who})${detail ? ` — ${detail}` : ""}`, tone: p.source === "automation" ? "ai" : "neutral" };
    }
    case "onboarding.automation.changed": return { text: `מדיניות האוטומציה שונתה: ${PRESET_HE[str(p.preset) as AutomationPreset]?.title ?? str(p.preset)}`, tone: "neutral" };
    case "onboarding.execution.stopped": return { text: p.stopped ? "קריאת ה-AI נעצרה על ידי אדם" : "בקשת עצירה — לא הייתה קריאת AI פעילה", tone: "warning" };
    case "onboarding.run.cancelled": return { text: "ההרצה בוטלה", tone: "inactive" };
    case "onboarding.driver.failed": return { text: `המנוע האוטומטי נכשל: ${str(p.error).slice(0, 160)}`, tone: "critical" };
    case "onboarding.refresh_checked": return { text: `בדיקת עדכניות: ${p.updateRequired ? "נדרש עדכון" : "אין צורך בעדכון"}`, tone: p.updateRequired ? "warning" : "healthy" };
    default: return { text: e.type, tone: "inactive" };
  }
}

export function StatusPill({ status }: { status: OnboardingStatus }) {
  return <Pill tone={STATUS_TONE[status] ?? "inactive"}>{STATUS_HE[status] ?? status}</Pill>;
}

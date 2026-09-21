import { useEffect, useState, type ReactNode } from "react";
import type { AutomationPolicy, AutomationPreset, Effort, ModelPolicy, OnboardingCost, OnboardingEvent, OnboardingRunSummary, OnboardingStageDefinition, OnboardingStageKey } from "../../api.ts";
import { CardTitle, Pill } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { CostLine } from "../../claude/CostLine.tsx";
import {
  EFFORTS, EFFORT_HE, MODEL_OPTIONS, PRESET_HE, RUN_STATUS_HE, describePolicy, effortLabel, eventLabel, fmtDate, fmtDuration, fmtInt, fmtTime, fmtUsd,
  modelLabel, policyNeedsConsent, presetPolicy,
} from "./labels.ts";

/* ── automation ───────────────────────────────────────────────────── */

export function AutomationEditor({ defs, value, onChange, consent, onConsent }: {
  defs: readonly OnboardingStageDefinition[]; value: AutomationPolicy; onChange: (p: AutomationPolicy) => void; consent: boolean; onConsent: (v: boolean) => void;
}) {
  const presets: AutomationPreset[] = ["step_by_step", "guided", "automatic", "custom"];
  const setStage = (key: OnboardingStageKey, patch: Partial<AutomationPolicy["stages"][OnboardingStageKey]>) =>
    onChange({ preset: "custom", stages: { ...value.stages, [key]: { ...value.stages[key], ...patch } } });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="ob-preset">
        {presets.map((p) => (
          <button key={p} type="button" aria-pressed={value.preset === p} onClick={() => onChange(p === "custom" ? { ...value, preset: "custom" } : presetPolicy(p, defs))}>
            <div className="t">{PRESET_HE[p].title}</div>
            <div className="d">{PRESET_HE[p].desc}</div>
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="ob-pol">
          <span className="h">שלב</span><span className="h">התחלה</span><span className="h">שער</span>
          {defs.map((d) => (
            <FragmentRow key={d.key}>
              <span>{d.title_he}</span>
              <span className="ob-seg">
                <button type="button" aria-pressed={value.stages[d.key]?.run === "auto"} onClick={() => setStage(d.key, { run: "auto" })}>לבד</button>
                <button type="button" aria-pressed={value.stages[d.key]?.run !== "auto"} onClick={() => setStage(d.key, { run: "manual" })}>ידני</button>
              </span>
              {d.gate ? (
                <span className="ob-seg">
                  <button type="button" aria-pressed={value.stages[d.key]?.gate !== "auto"} onClick={() => setStage(d.key, { gate: "human" })}>אדם</button>
                  <button type="button" aria-pressed={value.stages[d.key]?.gate === "auto"} onClick={() => setStage(d.key, { gate: "auto" })}>אוטומטי</button>
                </span>
              ) : <span className="ob-sub">—</span>}
            </FragmentRow>
          ))}
        </div>
      )}
      {policyNeedsConsent(value, defs) && (
        <label style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span>אני מסכים/ה שהסקירה תאושר בלי אדם. השינויים עדיין נכנסים ל-PR, ושום דבר לא מתמזג לבד.</span>
        </label>
      )}
    </div>
  );
}

const FragmentRow = ({ children }: { children: ReactNode }) => <>{children}</>;

export function AutomationPanel({ policy, defs, busy, disabled, onSave }: {
  policy: AutomationPolicy; defs: readonly OnboardingStageDefinition[]; busy: boolean; disabled: boolean; onSave: (p: AutomationPolicy, consent: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(policy);
  const [consent, setConsent] = useState(false);
  useEffect(() => { if (!editing) setDraft(policy); }, [policy, editing]);
  return (
    <div className="panel">
      <CardTitle info="automation">אוטומציה</CardTitle>
      <p style={{ fontSize: 12.5, marginBottom: 8 }}>{describePolicy(policy, defs)}</p>
      {!editing
        ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => { setDraft(policy); setConsent(false); setEditing(true); }}>שנה מדיניות</button>
        : (
          <div style={{ display: "grid", gap: 10 }}>
            <AutomationEditor defs={defs} value={draft} onChange={setDraft} consent={consent} onConsent={setConsent} />
            <p className="ob-sub">השינוי חל מיד: שלב שמוגדר "לבד" מתחיל כשהשלב שלפניו מסתיים.</p>
            <div className="ob-actions">
              <button className="btn btn-primary btn-sm" disabled={busy || (policyNeedsConsent(draft, defs) && !consent)} onClick={() => { onSave(draft, consent); setEditing(false); }}>{busy ? "שומר…" : "שמור"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>ביטול</button>
            </div>
          </div>
        )}
    </div>
  );
}

/* ── model and effort ─────────────────────────────────────────────── */

export function ModelEditor({ defs, value, recommended, onChange }: {
  defs: readonly OnboardingStageDefinition[]; value: ModelPolicy; recommended: { init: { model: string; effort: Effort } }; onChange: (p: ModelPolicy) => void;
}) {
  const ai = defs.filter((d) => d.kind === "ai");
  const sel = { fontSize: 12, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--border-hairline)" } as const;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {ai.map((d) => {
        const rec = recommended[d.key as "init"];
        const v = value[d.key] ?? {};
        const set = (patch: { model?: string; effort?: Effort }) => {
          const next = { ...v, ...patch };
          if (!next.model) delete next.model;
          if (!next.effort) delete next.effort;
          onChange({ ...value, [d.key]: next });
        };
        return (
          <div key={d.key} style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{d.title_he}</span>
            <select style={sel} value={v.model ?? ""} onChange={(e) => set({ model: e.target.value || undefined })}>
              <option value="">לפי ההמלצה ({modelLabel(rec?.model)})</option>
              {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select style={sel} value={v.effort ?? ""} onChange={(e) => set({ effort: (e.target.value || undefined) as Effort | undefined })}>
              <option value="">מאמץ לפי ההמלצה ({effortLabel(rec?.effort)})</option>
              {EFFORTS.map((x) => <option key={x} value={x}>{EFFORT_HE[x]}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

export function ModelPanel({ choices, defs, recommended, busy, disabled, onSave }: {
  choices: ModelPolicy; defs: readonly OnboardingStageDefinition[]; recommended: { init: { model: string; effort: Effort } };
  busy: boolean; disabled: boolean; onSave: (p: ModelPolicy) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(choices);
  useEffect(() => { if (!editing) setDraft(choices); }, [choices, editing]);
  const overridden = Object.keys(choices).length;
  const init = choices.init;
  return (
    <div className="panel">
      <CardTitle info="model_effort">מודל ומאמץ</CardTitle>
      <p style={{ fontSize: 12.5, marginBottom: 4 }}>{overridden ? "בחירה ידנית" : "לפי ההמלצה"}</p>
      <p className="ob-sub" style={{ marginBottom: 8 }}>{modelLabel(init?.model ?? recommended.init.model)} · מאמץ {effortLabel(init?.effort ?? recommended.init.effort)}</p>
      {!editing
        ? <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => { setDraft(choices); setEditing(true); }}>שנה מודל/מאמץ</button>
        : (
          <div style={{ display: "grid", gap: 10 }}>
            <ModelEditor defs={defs} value={draft} recommended={recommended} onChange={setDraft} />
            <p className="ob-sub">חל על הפעלת הסשן הבאה. בסשן פעיל אפשר להקליד <span className="ob-code">/model</span> או <span className="ob-code">/effort</span> בטרמינל.</p>
            <div className="ob-actions">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { onSave(draft); setEditing(false); }}>{busy ? "שומר…" : "שמור"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>ביטול</button>
            </div>
          </div>
        )}
    </div>
  );
}

/* ── cost — every number here is a ledger row, or the live delta the ledger does not have yet ── */

export function CostPanel({ cost, title, nav }: { cost: OnboardingCost; title: (key: string) => string; nav: (h: string) => void }) {
  return (
    <div className="panel">
      <CardTitle info="run_cost">עלות ההרצה</CardTitle>
      <div className="ob-kv">
        <div><div className="l">עלות AI<Info k="ai_cost" /></div><div className="v">{fmtUsd(cost.totalCostUsd)}</div></div>
        <div><div className="l">קריאות למודל<Info k="ledger" /></div><div className="v">{fmtInt(cost.apiCalls)}</div></div>
        <div><div className="l">טוקנים (קלט / פלט)<Info k="tokens" /></div><div className="v" style={{ fontSize: 12 }}>{fmtInt(cost.inputTokens)} / {fmtInt(cost.outputTokens)}</div></div>
        <div><div className="l">זמן AI מצטבר</div><div className="v">{fmtDuration(cost.apiDurationMs)}</div></div>
      </div>
      {cost.byStage.length > 0 && (
        <div className="rowlist" style={{ marginTop: 10 }}>
          {cost.byStage.map((s) => (
            <div className="row" key={s.stageKey} style={{ padding: "7px 10px", fontSize: 12 }}>
              <span className="title">{title(s.stageKey)}</span>
              <span className="spacer" />
              <CostLine model={s.model} effort={s.effort} costUsd={s.costUsd} />
            </div>
          ))}
          {cost.chat && cost.chat.calls > 0 && (
            <div className="row" style={{ padding: "7px 10px", fontSize: 12 }}>
              <span className="title">הצ'אט · {fmtInt(cost.chat.calls)} שאלות</span>
              <span className="spacer" />
              <CostLine inputTokens={cost.chat.inputTokens} outputTokens={cost.chat.outputTokens} costUsd={cost.chat.costUsd} />
            </div>
          )}
        </div>
      )}
      <p className="ob-sub" style={{ marginTop: 8 }}>
        {cost.liveUsd > 0
          ? <>מתוך זה {fmtUsd(cost.liveUsd)} הוצא בסשן הפעיל ועדיין לא נרשם — הוא נרשם כשהשלב מסתיים או כשהסשן נסגר.</>
          : <>מתוך יומן הקריאות של קלוד, כמו כל עלות במערכת.</>}
        {" "}<a onClick={() => nav("#/claude/calls")}>כל הקריאות ←</a>
      </p>
    </div>
  );
}

/* ── decision and event log ───────────────────────────────────────── */

export function EventLogPanel({ events, title, users }: { events: OnboardingEvent[]; title: (key: string) => string; users: Record<string, string> }) {
  const list = [...events].reverse();
  return (
    <div className="panel">
      <CardTitle info="decision_log">יומן החלטות ואירועים</CardTitle>
      {list.length === 0 ? <p className="ob-sub">עדיין אין אירועים.</p> : (
        <div className="ob-timeline">
          {list.slice(0, 60).map((e) => {
            const l = eventLabel(e, title);
            const color = l.tone === "critical" ? "var(--status-critical)" : l.tone === "warning" ? "var(--status-warning)" : l.tone === "ai" ? "var(--status-ai)" : l.tone === "healthy" ? "var(--status-healthy)" : "var(--ink-700)";
            const who = e.actorUserId ? users[e.actorUserId] : null;
            return (
              <div key={e.id}>
                <span className="tm">{fmtTime(e.occurredAt)}</span>
                <span style={{ color }}>{l.text}{who ? <span className="ob-sub"> · {who}</span> : null}</span>
              </div>
            );
          })}
          {list.length > 60 && <p className="ob-sub">ועוד {list.length - 60} אירועים ישנים יותר.</p>}
        </div>
      )}
    </div>
  );
}

/* ── previous runs ────────────────────────────────────────────────── */

export function RunsPanel({ runs, current, onPick }: { runs: OnboardingRunSummary[]; current: string; onPick: (id: string) => void }) {
  if (runs.length < 2) return null;
  return (
    <div className="panel">
      <CardTitle info="previous_runs">הרצות קודמות</CardTitle>
      <div style={{ display: "grid", gap: 6 }}>
        {runs.map((r) => {
          const st = RUN_STATUS_HE[r.status];
          return (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <a style={{ cursor: "pointer", fontWeight: r.id === current ? 700 : 500 }} onClick={() => onPick(r.id)}>{fmtDate(r.startedAt)}</a>
              <span style={{ flex: 1 }} />
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

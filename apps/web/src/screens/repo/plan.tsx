import { useState } from "react";
import {
  decideComponent, decideComponentSet, requestOnboardingComponent, startDraftSession, startOnboardingBuild,
  type ComponentGroup, type OnboardingComponent, type PlanResult, type Readiness,
} from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { chatCommand } from "../../claude/context.ts";
import { RunTerminal } from "./Terminal.tsx";
import { ApprovalTools, CardGroup } from "./cards.tsx";
import { NotYet, Tile, Working, isOver, type StepProps } from "./shared.tsx";
import { effortLabel, fmtUsd, modelLabel } from "./labels.ts";

/**
 * Step 4, the heart of the dossier: the component plan. Every card with its
 * evidence, in three groups; the readiness gate and the honesty card; the
 * /init draft session as a window inside the step; and the one button that
 * closes the plan and starts the build.
 */

const GROUPS: ComponentGroup[] = ["auto", "approval", "not_recommended"];

export function PlanBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "Running") return <Working text="כללי ההחלטה רצים על הפרופיל, קלוד מחפש רכיבים מוכנים לסטאק, והסוקר בודק מה חסר ומה מיותר… שתיים-שלוש קריאות למודל." />;
  if (step.status !== "WaitingForUser" && step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const open = step.status === "WaitingForUser" && !isOver(view);
  const { repoId, id: runId } = view.run;
  const cards = view.components;
  const approved = cards.filter((c) => c.status === "approved").length;
  const proposed = cards.filter((c) => c.status === "proposed").length;
  const decide = (key: string, decision: "approve" | "decline" | "defer" | "undo", extra: { reason?: string; answers?: Record<string, string> }) =>
    void p.act(`card:${key}`, () => decideComponent(repoId, runId, key, { decision, reason: extra.reason ?? null, answers: extra.answers }));
  // "שאל" opens the one chat on this run with the question already in the box; the chat answers from the card itself, with no model call.
  const ask = (c: OnboardingComponent) => chatCommand({ type: "openTopic", topic: { kind: "run", id: runId }, draft: `מה זה ${c.title_he} ולמה הוא מוצע?` });
  const busy = !!p.busy;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {view.plan && <PlanSummary plan={view.plan} />}
      {step.status === "Completed" && <ClosedSummary result={step.result} />}
      {GROUPS.map((g) => (
        <CardGroup
          key={g} group={g} cards={cards.filter((c) => c.group === g)} open={open} busy={busy} users={p.users} onDecide={decide} onAsk={ask}
          tools={g === "approval" && open ? (
            <ApprovalTools
              proposed={proposed} busy={busy}
              onApproveAll={() => void p.act("approve-set", () => decideComponentSet(repoId, runId, { decision: "approve" }))}
              onRequest={(text) => p.act("request", () => requestOnboardingComponent(repoId, runId, text))}
            />
          ) : undefined}
        />
      ))}
      {view.readiness && <ReadinessCard r={view.readiness} />}
      {view.readiness && view.readiness.honesty.length > 0 && (
        <div className="panel">
          <CardTitle info="honesty_card">כרטיס כנות — מה אי אפשר לאמת כאן</CardTitle>
          <ul className="rd-list">{view.readiness.honesty.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </div>
      )}
      {open && <DraftCard {...p} />}
      {open && (
        <div className="ob-actions">
          <button className="btn btn-primary" disabled={busy || approved === 0} onClick={() => void p.act("build", () => startOnboardingBuild(repoId, runId))}>{p.busy === "build" ? "מתחיל בנייה…" : `בנה את מה שאושר (${approved})`}</button>
          <Info k="start_build" />
          <span className="ob-sub">{proposed > 0 ? `${proposed} כרטיסים עוד לא הוכרעו — הם נשארים בחוץ ולא נכתבים.` : "כל הכרטיסים הוכרעו."} סשן הטיוטה, אם פתוח, נסגר.</span>
        </div>
      )}
    </div>
  );
}

/** The top of the plan: which rules fired, what the open search found, and what the reviewer said. */
function PlanSummary({ plan }: { plan: PlanResult }) {
  const [more, setMore] = useState(false);
  const m = plan.marketplace;
  const market = !m.searched ? (m.remembered ? `${m.remembered} מהזיכרון · ${m.skipped ?? "לא חיפש ברשת"}` : (m.skipped ?? "לא רץ")) : `נמצאו ${m.found}${m.remembered ? ` · ${m.remembered} מהזיכרון` : ""}`;
  const suppressed = plan.suppressed ?? plan.rulesSuppressed;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="rd-tiles">
        <Tile n={plan.rulesFired.length} label="כללים שהופעלו" info="rules_fired" />
        <Tile n={plan.components} label="כרטיסים" info="component_card" />
        <Tile n={market} label="חיפוש רכיבים מוכנים" info="marketplace_search" />
        <Tile n={plan.reviewer ? `${plan.reviewer.missing} חסרים · ${plan.reviewer.redundant} מיותרים` : "לא רץ"} label="הסוקר" info="reviewer_pass" />
        <Tile n={fmtUsd(plan.costUsd)} label="עלות הצעד" info="step_cost" />
      </div>
      {(plan.firings?.length || suppressed.length) ? (
        <div>
          <button type="button" className="ob-toggle" onClick={() => setMore((v) => !v)}>{more ? "הסתר את הכללים" : "אילו כללים הופעלו, ולמה"}</button>
          {more && (
            <ul className="rd-list" style={{ marginTop: 6 }}>
              {(plan.firings ?? []).map((f) => <li key={f.rule}><b>{f.rule}</b> — {f.reason_he}{f.components.length ? <span className="ob-sub"> → {f.components.map((c) => c.title_he).join(", ")}</span> : null}</li>)}
              {suppressed.map((s) => <li key={`s:${s.rule}`} className="ob-sub"><b>{s.rule}</b> לא הופעל — "{s.fact}" סומן כלא נכון{"note" in s && s.note ? ` (${s.note})` : ""}</li>)}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** After the plan closed: what was decided, in numbers. */
function ClosedSummary({ result }: { result: unknown }) {
  const r = (result ?? {}) as Partial<PlanResult> & { decided?: number };
  return (
    <div className="rd-tiles">
      <Tile n={r.decided ?? 0} label="הוכרעו" info="step_plan" />
      <Tile n={r.approved ?? 0} label="אושרו" info="card_approve" tone="ok" />
      <Tile n={r.declined ?? 0} label="נדחו" info="card_decline" />
      <Tile n={r.deferred ?? 0} label="נדחו להמשך" />
      <Tile n={r.undecided ?? 0} label="לא הוכרעו — נשארו בחוץ" tone={r.undecided ? "warn" : undefined} />
    </div>
  );
}

function ReadinessCard({ r }: { r: Readiness }) {
  return (
    <div className="panel">
      <CardTitle info="readiness_gate">שער המוכנות {r.ready ? <span className="rd-chip ok">עשינו הכול</span> : <span className="rd-chip human">עוד לא</span>}</CardTitle>
      <div className="rd-ready">
        {r.items.map((it) => (
          <div key={it.key}>
            <span className={`g ${it.ok ? "ok" : "no"}`}>{it.ok ? "✓" : "✕"}</span>
            <span>{it.title_he}<div className="d">{it.detail_he}</div></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The /init draft session: a window inside the plan, opened from here, closed when the build starts. */
function DraftCard(p: StepProps) {
  const s = p.view.run.session;
  const rec = p.view.recommended.draft;
  const { repoId, id: runId } = p.view.run;
  const state = s.state === "live" ? "פעיל" : s.state === "ended" ? "הסשן נסגר" : s.state === "disconnected" ? "הסשן נותק" : "עוד לא נפתח";
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <CardTitle info="draft_init">טיוטת /init</CardTitle>
      <p className="rd-lead" style={{ margin: 0 }}>Claude Code האמיתי רץ בטרמינל שלמטה, בעותק המבודד, עם /init — כמחולל טיוטה ל-AGENTS.md בלבד. מה שהוא כותב הוא טיוטה: הבנייה בודקת כל טענה מול הפרופיל לפני שהיא נכנסת, ורק רכיב מאושר מכניס אותה ל-PR.</p>
      <div className="ob-actions">
        {s.state !== "live" && <button className="btn btn-secondary" disabled={!!p.busy} onClick={() => void p.act("draft", () => startDraftSession(repoId, runId, { resume: s.state !== "none" }))}>{p.busy === "draft" ? "פותח…" : s.state === "none" ? "פתח סשן טיוטה" : "↻ חדש את הסשן"}</button>}
        <Info k="draft_start" />
        <span className="ob-sub">{modelLabel(rec.model)} · מאמץ {effortLabel(rec.effort)} · {state}{s.status ? ` · ${fmtUsd(s.status.costUsd)} בסשן הזה` : ""}</span>
      </div>
      {s.state !== "none" && <RunTerminal repoId={repoId} runId={runId} screenRef={p.screenRef} />}
    </div>
  );
}

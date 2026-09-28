import { useState } from "react";
import {
  decideComponent, decideComponentSet, requestOnboardingComponent, scanInitDraft, skipDraft, startDraftSession, startOnboardingBuild,
  type ComponentGroup, type InitScanState, type OnboardingComponent, type PlanResult, type Readiness,
} from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { chatCommand } from "../../claude/context.ts";
import { RunTerminal } from "./Terminal.tsx";
import { ApprovalTools, CardGroup } from "./cards.tsx";
import { NotYet, Tile, Working, isOver, type StepProps } from "./shared.tsx";
import { PLAN_PHASE_HE, effortLabel, fmtUsd, modelLabel } from "./labels.ts";

/**
 * Step 4, the heart of the dossier: the component plan. The cards are drawn
 * first but decided only after the /init draft — so the plan moves through
 * its phases on the screen: the draft (or "without a draft"), the draft set
 * aside, the draft scanned, and only then every card with its evidence, in
 * three groups; the readiness gate and the honesty card; and the one button
 * that closes the plan and starts the build.
 */

const GROUPS: ComponentGroup[] = ["auto", "approval", "not_recommended"];

export function PlanBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "Running") return <Working text="כללי ההחלטה רצים על הפרופיל, קלוד מחפש רכיבים מוכנים לסטאק, והסוקר בודק מה חסר ומה מיותר… שתיים-שלוש קריאות למודל." />;
  if (step.status !== "WaitingForUser" && step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const open = step.status === "WaitingForUser" && !isOver(view);
  // A run made before the draft came first has no phase: its cards are open, with the draft card as it was.
  const phase = view.plan?.phase;
  if (open && phase === "draft") return <DraftPhase {...p} />;
  if (open && (phase === "aside" || phase === "scan")) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        {view.plan && <PlanSummary plan={view.plan} />}
        <div className="rd-inline"><Working text={phase === "aside" ? "הטיוטה מוזזת הצידה… הקבצים שלה נשמרים בצד, והעותק חוזר לנקודת ההתחלה." : "הטיוטה נסרקת מול הכרטיסים ומול הקוד… כמה דקות. הכרטיסים ייפתחו להחלטה מיד אחר כך."} /><Info k="plan_phase" /></div>
      </div>
    );
  }
  const { repoId, id: runId } = view.run;
  const cards = view.components;
  const approved = cards.filter((c) => c.status === "approved").length;
  const proposed = cards.filter((c) => c.status === "proposed").length;
  // A question only you decide (the draft scan's "ask") is never approved as part of the set.
  const settable = cards.filter((c) => c.status === "proposed" && c.params.decision !== "ask").length;
  const unscanned = !phase && view.run.session.state !== "none" && view.plan?.initScan?.state !== "done";
  const estimate = view.plan?.buildEstimateUsd;
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
              proposed={settable} busy={busy}
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
      {open && (phase ? view.plan?.initScan && <DraftOutcome scan={view.plan.initScan} /> : <DraftCard {...p} />)}
      {open && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="ob-actions">
            <button className="btn btn-primary" disabled={busy || approved === 0} onClick={() => void p.act("build", () => startOnboardingBuild(repoId, runId))}>{p.busy === "build" ? "מתחיל בנייה…" : `בנה את מה שאושר (${approved})`}</button>
            <Info k="start_build" />
            {estimate != null && <span style={{ fontSize: 12.5 }}>הבנייה והמדידה יעלו בערך <b>{fmtUsd(estimate)}</b><Info k="build_estimate" /></span>}
          </div>
          <span className="ob-sub">{proposed > 0 ? `${proposed} כרטיסים עוד לא הוכרעו — הם נשארים בחוץ ולא נכתבים.` : "כל הכרטיסים הוכרעו."}{phase ? "" : " סשן הטיוטה, אם פתוח, נסגר."}{unscanned ? " טיוטת /init לא נסרקה — היא תוזז הצידה ושום דבר ממנה לא ייכנס; לסרוק קודם?" : ""}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The plan's first phase: the cards are drawn but not yet open. The /init draft session comes first — or is
 * skipped — so that its scan reaches the cards before anyone decides on them.
 */
function DraftPhase(p: StepProps) {
  const { view } = p;
  const s = view.run.session;
  const rec = view.recommended.draft;
  const { repoId, id: runId } = view.run;
  const a = view.automation;
  const state = s.state === "live" ? "פעיל" : s.state === "ended" ? "הסשן נסגר" : s.state === "disconnected" ? "הסשן נותק" : "עוד לא נפתח";
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {view.plan && <PlanSummary plan={view.plan} />}
      <div className="rd-inline" style={{ fontSize: 12.5 }}>
        <span className="rd-chip human">{PLAN_PHASE_HE.draft}</span><Info k="plan_phase" />
        <span className="ob-sub">{view.components.length} כרטיסים מוכנים. הם ייפתחו להחלטה אחרי הטיוטה, או מיד אם בוחרים "בלי טיוטה".</span>
      </div>
      <div className="panel" style={{ display: "grid", gap: 10 }}>
        <CardTitle info="draft_init">טיוטת /init — לפני ההחלטות</CardTitle>
        <p className="rd-lead" style={{ margin: 0 }}>Claude Code האמיתי רץ בטרמינל שלמטה, בעותק המבודד, עם /init — כמחולל טיוטה. כשסוגרים אותו, או כשהוא מגיע לתקרה, הטיוטה מוזזת הצידה ונסרקת מול הכרטיסים שלנו: מה שכדאי לקחת ממנה הופך לכרטיס, ומה שלנו מיותר נדחה עם סיבה. רק אחר כך הכרטיסים נפתחים להחלטה.</p>
        <div className="rd-inline" style={{ fontSize: 12.5 }}>
          <span>תקרת הסשן<Info k="session_cap" />:</span><b>{fmtUsd(a.draftCapUsd)} · {a.draftCapMinutes} דקות</b>
          <span className="ob-sub">— משנים בפאנל "מדרגת האוטומציה".</span>
        </div>
        <div className="ob-actions">
          {s.state !== "live" && <button className="btn btn-primary" disabled={!!p.busy} onClick={() => void p.act("draft", () => startDraftSession(repoId, runId, { resume: s.state !== "none" }))}>{p.busy === "draft" ? "פותח…" : s.state === "none" ? "פתח סשן טיוטה" : "↻ חדש את הסשן"}</button>}
          {s.state !== "live" && <Info k="draft_start" />}
          {s.state !== "live" && <button className="btn btn-secondary" disabled={!!p.busy} onClick={() => void p.act("skip", () => skipDraft(repoId, runId))}>{p.busy === "skip" ? "פותח את הכרטיסים…" : "בלי טיוטה"}</button>}
          {s.state !== "live" && <Info k="draft_skip" />}
          <span className="ob-sub">{modelLabel(rec.model)} · מאמץ {effortLabel(rec.effort)} · {state}{s.status ? ` · ${fmtUsd(s.status.costUsd)} בסשן הזה` : ""}</span>
        </div>
        {s.state === "live" && <div className="ob-note info">כשמסיימים — כותבים /exit בטרמינל. הטיוטה תוזז הצידה ותיסרק לבד, והכרטיסים ייפתחו להחלטה.</div>}
        {s.state !== "none" && <RunTerminal repoId={repoId} runId={runId} screenRef={p.screenRef} />}
      </div>
    </div>
  );
}

/** After the draft was set aside and scanned: what the scan decided, read-only — its cards are already among the cards below. */
function DraftOutcome({ scan }: { scan: InitScanState }) {
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <CardTitle info="draft_init">טיוטת /init</CardTitle>
      <ScanResult scan={scan} />
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
  const scan = p.view.plan?.initScan;
  const state = s.state === "live" ? "פעיל" : s.state === "ended" ? "הסשן נסגר" : s.state === "disconnected" ? "הסשן נותק" : "עוד לא נפתח";
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <CardTitle info="draft_init">טיוטת /init</CardTitle>
      <p className="rd-lead" style={{ margin: 0 }}>Claude Code האמיתי רץ בטרמינל שלמטה, בעותק המבודד, עם /init — כמחולל טיוטה. מה שהוא כותב לא נכנס לבד: "סרוק" משווה אותו מול מה שהכרטיסים שלנו כותבים, ומה שכדאי לקחת הופך לכרטיסים לאישורך. לפני הבנייה הטיוטה מוזזת הצידה ונשמרת, ורק כרטיס מאושר מכניס ממנה משהו ל-PR.</p>
      <div className="ob-actions">
        {s.state !== "live" && <button className="btn btn-secondary" disabled={!!p.busy} onClick={() => void p.act("draft", () => startDraftSession(repoId, runId, { resume: s.state !== "none" }))}>{p.busy === "draft" ? "פותח…" : s.state === "none" ? "פתח סשן טיוטה" : "↻ חדש את הסשן"}</button>}
        <Info k="draft_start" />
        {s.state !== "none" && <button className="btn btn-primary" disabled={!!p.busy || scan?.state === "running"} onClick={() => void p.act("scan", () => scanInitDraft(repoId, runId))}>{p.busy === "scan" || scan?.state === "running" ? "סורק…" : scan?.state === "done" ? "↻ סרוק שוב" : "סרוק מה ש-/init עשה"}</button>}
        {s.state !== "none" && <Info k="draft_scan" />}
        <span className="ob-sub">{modelLabel(rec.model)} · מאמץ {effortLabel(rec.effort)} · {state}{s.status ? ` · ${fmtUsd(s.status.costUsd)} בסשן הזה` : ""}</span>
      </div>
      {scan && <ScanResult scan={scan} />}
      {s.state !== "none" && <RunTerminal repoId={repoId} runId={runId} screenRef={p.screenRef} />}
    </div>
  );
}

const VERDICT_HE: Record<NonNullable<InitScanState["verdict"]>, { label: string; cls: string }> = {
  adopt: { label: "הטיוטה טובה יותר — לוקחים את רובה", cls: "ai" }, merge: { label: "משלבים את שתיהן", cls: "ai" },
  partial: { label: "שלנו הבסיס, תוספות מהטיוטה", cls: "det" }, keep_ours: { label: "נשארים עם שלנו", cls: "" },
};
const BETTER_HE: Record<string, string> = { ours: "שלנו", theirs: "הטיוטה", both: "שתיהן — לשלב", neither: "אף אחת" };
const DECISION_HE: Record<string, string> = { take: "לקחת", check: "לבדוק", ask: "החלטה שלך" };

/** What the scan of the draft decided: the verdict, topic by topic, the cards it made, what of ours it would drop, what it left out. */
function ScanResult({ scan }: { scan: InitScanState }) {
  const [more, setMore] = useState(false);
  if (scan.state === "running") return <Working text={`העורך קורא את הטיוטה (${scan.files.length} קבצים) ובודק כל טענה מול הקוד… כמה דקות.`} />;
  const failed = scan.state === "failed" ? <div className="ob-note crit">הסריקה נכשלה: {scan.error}{scan.verdict ? " — למטה התוצאה של הסריקה הקודמת." : ""}</div> : null;
  if (failed && !scan.verdict) return failed;
  const v = scan.verdict ? VERDICT_HE[scan.verdict] : null;
  const asks = (scan.cards ?? []).filter((c) => c.decision === "ask").length;
  return (
    <div className="rd-card" style={{ display: "grid", gap: 8 }}>
      {failed}
      <CardTitle info="draft_scan_result">תוצאת הסריקה</CardTitle>
      {v && <div><span className={`rd-chip ${v.cls}`}>{v.label}</span><Info k="draft_scan_verdict" /></div>}
      {scan.summary && <p className="rd-lead" style={{ margin: 0 }}>{scan.summary}</p>}
      <div className="rd-tiles">
        <Tile n={scan.cards?.length ?? 0} label="כרטיסים מהטיוטה, לאישורך" info="component_card" />
        <Tile n={asks} label="החלטות שרק אתה מקבל" info="draft_scan_ask" tone={asks ? "warn" : undefined} />
        <Tile n={scan.dropOurs?.length ?? 0} label="משלנו — נדחו כמיותרים" info="scan_declined" />
        <Tile n={(scan.reject?.length ?? 0) + (scan.refused?.length ?? 0)} label="מהטיוטה — לא נלקחו" info="draft_scan_result" />
        <Tile n={fmtUsd(scan.costUsd ?? 0)} label="עלות הסריקה" info="draft_scan" />
      </div>
      <button type="button" className="ob-toggle" onClick={() => setMore((x) => !x)}>{more ? "הסתר את הפירוט" : "נושא אחר נושא, ומה לא נלקח ולמה"}</button>
      {more && (
        <div style={{ display: "grid", gap: 8 }}>
          {(scan.compare?.length ?? 0) > 0 && (
            <div>
              <span className="ob-sub">השוואה<Info k="draft_scan_compare" /></span>
              <ul className="rd-list">{scan.compare!.map((c, i) => <li key={i}><b>{c.topic}</b> — עדיף: {BETTER_HE[c.better] ?? c.better}. {c.why}<div className="ob-sub">שלנו: {c.ours || "—"} · הטיוטה: {c.theirs || "—"}</div></li>)}</ul>
            </div>
          )}
          {(scan.cards?.length ?? 0) > 0 && <ul className="rd-list">{scan.cards!.map((c) => <li key={c.key}>{DECISION_HE[c.decision] ?? c.decision}: <b>{c.title}</b>{c.notRecommended ? <span className="ob-sub"> — נבדק מול הקוד ונמצאו נתיבים שלא קיימים; בקבוצת "לא מומלץ"</span> : null}</li>)}</ul>}
          {(scan.dropOurs?.length ?? 0) > 0 && <ul className="rd-list">{scan.dropOurs!.map((d) => <li key={d.key}>משלנו, מיותר: <b>{d.title}</b> — {d.why}</li>)}</ul>}
          {((scan.reject?.length ?? 0) + (scan.refused?.length ?? 0)) > 0 && <ul className="rd-list">{[...(scan.reject ?? []).map((r) => ({ t: r.what, w: r.why })), ...(scan.refused ?? []).map((r) => ({ t: r.title, w: r.why }))].map((r, i) => <li key={i} className="ob-sub">לא נלקח: <b>{r.t}</b> — {r.w}</li>)}</ul>}
          <span className="ob-sub">נסרקו: {scan.files.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  advanceOnboardingRun, cancelOnboardingRun, getLatestOnboardingRun, getOnboardingRun, getOnboardingRunCostSummary, startOnboardingRun, submitOnboardingStageInput,
  type OnboardingRunCostSummary, type OnboardingRunView, type OnboardingStage,
} from "../api.ts";
import { PageHead } from "../ui.tsx";
import { StepRail } from "./WorkflowTab.tsx";

/**
 * Repository AI Enablement — the 16-stage onboarding pipeline
 * (`repository-ai-enablement`). The sole "AI management" screen for a
 * repo — mounted at both `#/repo/<id>` and `#/repo-onboarding/<id>`;
 * the old 3-step flow's screen (`RepoAiPanel.tsx`) was fully deleted
 * (2026-09-16), not just unlinked. Deliberately minimal per the earlier
 * design discussion: a real approval block only for the `WaitingForUser`
 * stages that genuinely need a human to decide something — most other
 * stages show a step rail plus a single "advance" button.
 */
// Title/Description text is the spec's own "User UI" text for each
// stage, near-verbatim (spec §8–§23) — found live: the generic status
// block only ever showed the bare stage key + raw status, with none of
// this explanation, for every non-`WaitingForUser` stage (most of the
// pipeline). The spec is explicit that every stage gets this, not just
// the interactive ones.
const STAGE_LABELS: Record<string, string> = {
  workspace_setup: "חיבור הריפוזיטורי",
  repository_scan: "סריקת הריפוזיטורי",
  classification: "הבנת סוג המערכת",
  security_permissions: "אבטחה והרשאות",
  knowledge_coverage: "בדיקת הידע הקיים",
  targeted_discovery: "חקירת הריפוזיטורי",
  human_enrichment: "השלמת מידע",
  knowledge_generation: "יצירת מפת הידע",
  claude_md_generation: "הכנת Claude לעבודה",
  scoped_rules: "כללים ייעודיים",
  guardrails: "מנגנוני הגנה",
  ai_doctor: "בדיקת תקינות",
  user_review: "אישור",
  github_pull_request: "Pull Request",
  ai_ready: "הריפוזיטורי מוכן",
  skills_evaluation: "יכולות חוזרות",
};
const STAGE_DESCRIPTIONS: Record<string, string> = {
  workspace_setup: "מכינים סביבת עבודה בטוחה עבור תהליך ההטמעה.",
  repository_scan: "מזהים את מבנה הפרויקט, הטכנולוגיות והכלים שכבר קיימים בו.",
  classification: "קובעים אילו חלקים בפרויקט באמת דורשים חקירה מעמיקה.",
  security_permissions: "מגדירים אילו פעולות Claude יכול לבצע אוטומטית ואילו דורשות אישור.",
  knowledge_coverage: "בודקים מה כבר מתועד כדי להשתמש במידע קיים ולא ליצור כפילויות.",
  targeted_discovery: "Claude לומד את המבנה והחיבורים המרכזיים הדרושים לעבודה עתידית.",
  human_enrichment: "במידת הצורך נשלים מידע חשוב שלא ניתן להבין מהקוד בלבד.",
  knowledge_generation: "שומרים מידע שימושי שיעזור ל-Claude להבין את הפרויקט גם בעבודות עתידיות.",
  claude_md_generation: "יוצרים את ההנחיות הקבועות והמצומצמות ש-Claude צריך בכל עבודה על הפרויקט.",
  scoped_rules: "מוסיפים רק כללים מיוחדים שנדרשים באזורים מסוימים בפרויקט.",
  guardrails: "מפעילים הגנות אוטומטיות עבור פעולות שאסור לבצע בטעות.",
  ai_doctor: "מוודאים שההגדרות, הידע והבדיקות שנוצרו באמת עובדים.",
  user_review: "בודקים ומאשרים את מה שנוצר לפני שהשינויים נשלחים ל-GitHub.",
  github_pull_request: "השינויים נשלחים ל-GitHub לבדיקה ומיזוג.",
  ai_ready: "הפרויקט מוכן לעבודה שוטפת עם Claude.",
  skills_evaluation: "במידת הצורך נשמור תהליכים שחוזרים על עצמם כדי לחסוך חקירה מחדש.",
};
const STATUS_HE: Record<string, string> = {
  Pending: "ממתין", Running: "רץ", WaitingForUser: "ממתין לאדם", Completed: "הושלם",
  CompletedWithWarnings: "הושלם עם אזהרות", Failed: "נכשל", Skipped: "דולג", Cancelled: "בוטל",
};

type SuggestedRules = {
  suggestedRules: string[]; suggestedProfileId: string;
  profiles: { id: string; label: string; description: string }[];
};
type Questions = { questions: { id: string; question_he: string; why_it_matters_he: string; risk_if_unknown: string }[] };
type GuardrailCandidates = { candidates: { id: string; label: string; description: string; suggested: boolean }[] };
type UserReview = {
  readiness?: { status?: string };
  groups: { group_he: string; items: { label: string }[] }[];
};
type PrOrReadyResult = { prUrl?: string; compareUrl?: string; mergedCommitSha?: string; readinessDate?: string };

const runIdKey = (repoId: string) => `dcc.onboarding.runId.${repoId}`;

export function RepoOnboardingPanel({ id: repoId, nav }: { id: string; nav: (h: string) => void }) {
  const [runId, setRunId] = useState<string | null>(() => localStorage.getItem(runIdKey(repoId)));
  // `localStorage` only knows about a run started in THIS browser — a repo
  // list, another device, or a cleared browser would otherwise see "no
  // active run" and offer to start a duplicate one even while a real run
  // is genuinely in progress. Fall back to asking the backend for the
  // repo's actual latest run before concluding there isn't one.
  const [checkedBackend, setCheckedBackend] = useState(false);
  const [d, setD] = useState<OnboardingRunView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editableRules, setEditableRules] = useState<string[] | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedGuardrailIds, setSelectedGuardrailIds] = useState<string[] | null>(null);
  const [cost, setCost] = useState<OnboardingRunCostSummary | null>(null);

  const reload = (rid: string) => getOnboardingRun(repoId, rid).then(setD).catch((e) => setErr(String(e)));
  useEffect(() => { if (runId) reload(runId); }, [runId]);
  useEffect(() => { if (runId) getOnboardingRunCostSummary(repoId, runId).then(setCost).catch(() => {}); }, [runId, d?.run.status]);
  useEffect(() => {
    if (runId) return;
    getLatestOnboardingRun(repoId).then((latest) => {
      if (latest) { localStorage.setItem(runIdKey(repoId), latest.runId); setRunId(latest.runId); }
    }).finally(() => setCheckedBackend(true));
  }, [repoId, runId]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); if (runId) reload(runId); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  if (!runId && !checkedBackend) return <div className="spin">טוען…</div>;

  if (!runId) {
    return (
      <>
        <PageHead crumb={<a onClick={() => nav("#/repositories")}>← Repositories</a>} title="הטמעת AI — תהליך חדש" />
        <div className="panel" style={{ textAlign: "center", padding: "32px 24px" }}>
          <p style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 16 }}>לא נמצא תהליך onboarding פעיל לריפו הזה.</p>
          <button className="btn btn-primary" disabled={busy === "start"} onClick={() => run("start", async () => {
            const { runId: newId } = await startOnboardingRun(repoId);
            localStorage.setItem(runIdKey(repoId), newId);
            setRunId(newId);
          })}>
            {busy === "start" ? "מתחיל…" : "התחל תהליך"}
          </button>
        </div>
        {err && <div className="callout" style={{ marginTop: 14, fontSize: 12, color: "var(--status-critical)" }}>{err}</div>}
      </>
    );
  }

  if (!d) return <div className="spin">טוען…</div>;

  const { run: r, stages } = d;
  const steps = stages.map((s) => ({ key: s.stageKey, label: STAGE_LABELS[s.stageKey] ?? s.stageKey, description: STAGE_DESCRIPTIONS[s.stageKey] }));
  const done = stages.map((s) => ["Completed", "CompletedWithWarnings", "Skipped"].includes(s.status));
  const unlocked = done.map((_, i) => i === 0 || done[i - 1]);
  const activeIdx = r.currentStageKey ? stages.findIndex((s) => s.stageKey === r.currentStageKey) : stages.length - 1;
  const currentStage: OnboardingStage | undefined = stages.find((s) => s.stageKey === r.currentStageKey);
  const waiting = r.status === "WaitingForUser" && currentStage;

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav("#/repositories")}>← Repositories</a>}
        title="הטמעת AI — Repository Onboarding"
        sub={`run ${r.id.slice(0, 8)} · ${STATUS_HE[r.status] ?? r.status}` + (cost && cost.executionCount > 0 ? ` · עלות AI: $${cost.totalCostUsd.toFixed(2)} · ${(cost.totalInputTokens + cost.totalOutputTokens).toLocaleString()} טוקנים` : "")}
        actions={!["Completed", "CompletedWithWarnings", "Cancelled"].includes(r.status) ? (
          <button className="btn btn-secondary btn-sm" disabled={busy === "cancel"} onClick={() => run("cancel", async () => { await cancelOnboardingRun(repoId, r.id); localStorage.removeItem(runIdKey(repoId)); setRunId(null); })}>
            בטל תהליך
          </button>
        ) : undefined}
      />

      {err && <div className="callout" style={{ marginBottom: 14, fontSize: 12, color: "var(--status-critical)" }}>{err}</div>}

      <div style={{ marginBottom: 20 }}>
        <StepRail steps={steps} done={done} unlocked={unlocked} active={activeIdx < 0 ? 0 : activeIdx} onPick={() => {}} />
      </div>

      {currentStage && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{STAGE_LABELS[currentStage.stageKey] ?? currentStage.stageKey}</h3>
          {STAGE_DESCRIPTIONS[currentStage.stageKey] && (
            <p style={{ fontSize: 12.5, color: "var(--ink-600)", marginBottom: 8 }}>{STAGE_DESCRIPTIONS[currentStage.stageKey]}</p>
          )}
          <p style={{ fontSize: 12, color: "var(--ink-500)" }}>סטטוס: {STATUS_HE[currentStage.status] ?? currentStage.status}</p>
          {currentStage.warnings.length > 0 && <p style={{ fontSize: 11.5, color: "var(--status-warning)", marginTop: 6 }}>{currentStage.warnings.join(" · ")}</p>}
          {currentStage.errors.length > 0 && <p style={{ fontSize: 11.5, color: "var(--status-critical)", marginTop: 6 }}>{currentStage.errors.join(" · ")}</p>}
          {["github_pull_request", "ai_ready"].includes(currentStage.stageKey) && (() => {
            const pr = currentStage.result as PrOrReadyResult | null;
            if (!pr) return null;
            return (
              <p style={{ fontSize: 12, marginTop: 6 }}>
                {pr.prUrl && <a href={pr.prUrl} target="_blank" rel="noreferrer">Pull Request ↗</a>}
                {!pr.prUrl && pr.compareUrl && <a href={pr.compareUrl} target="_blank" rel="noreferrer">פתח Pull Request ידנית ↗</a>}
                {pr.readinessDate && <span style={{ color: "var(--ink-500)" }}> · מוכן מאז {new Date(pr.readinessDate).toLocaleDateString("he-IL")}</span>}
              </p>
            );
          })()}
        </div>
      )}

      {waiting && currentStage!.stageKey === "security_permissions" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">פרופיל אבטחה</p>
          {(() => {
            const result = currentStage!.result as SuggestedRules;
            const profileId = selectedProfileId ?? result.suggestedProfileId;
            const rules = editableRules ?? result.suggestedRules;
            return (
              <>
                <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 10 }}>
                  מגדירים אילו פעולות Claude יכול לבצע אוטומטית ואילו דורשות אישור. המוצע: <b>{result.profiles.find((p) => p.id === result.suggestedProfileId)?.label ?? result.suggestedProfileId}</b>.
                </p>
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {result.profiles.map((p) => (
                    <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, cursor: "pointer" }}>
                      <input type="radio" name="security-profile" checked={profileId === p.id} onChange={() => setSelectedProfileId(p.id)} style={{ marginTop: 3 }} />
                      <span>
                        <b>{p.label}</b>{p.id === result.suggestedProfileId && <span style={{ color: "var(--ink-400)" }}> (מוצע)</span>}
                        <br /><span style={{ color: "var(--ink-500)" }}>{p.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="section-lbl">כללי חסימת קריאה מוצעים</p>
                <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                  {rules.map((rule, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <code style={{ direction: "ltr", flex: 1 }}>{rule}</code>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditableRules(rules.filter((_, j) => j !== i))}>✕ הסר</button>
                    </div>
                  ))}
                  {rules.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-400)" }}>אין כללי חסימה — בחירה תקפה.</p>}
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === "approve"} onClick={() => run("approve", async () => {
                  await submitOnboardingStageInput(repoId, r.id, "security_permissions", { approvedRules: rules, approvedProfileId: profileId });
                  setEditableRules(null); setSelectedProfileId(null);
                })}>
                  {busy === "approve" ? "שומר…" : "✓ אשר הרשאות"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {waiting && currentStage!.stageKey === "human_enrichment" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">שאלות להשלמת ידע</p>
          {(() => {
            const result = currentStage!.result as Questions;
            return (
              <>
                <div style={{ display: "grid", gap: 16, marginBottom: 12 }}>
                  {result.questions.map((q) => (
                    <div key={q.id}>
                      <p style={{ fontSize: 13, fontWeight: 600 }}>{q.question_he}</p>
                      <p style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>{q.why_it_matters_he}</p>
                      <textarea
                        style={{ width: "100%", minHeight: 50, marginTop: 6 }}
                        placeholder="תשובה (אפשר להשאיר ריק)"
                        value={answers[q.id] ?? ""}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === "answer"} onClick={() => run("answer", async () => {
                  const payload = result.questions.map((q) => ({ id: q.id, answer_he: answers[q.id] ?? "" }));
                  await submitOnboardingStageInput(repoId, r.id, "human_enrichment", { answers: payload });
                  setAnswers({});
                })}>
                  {busy === "answer" ? "שולח…" : "✓ שלח תשובות"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {waiting && currentStage!.stageKey === "guardrails" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">מנגנוני הגנה</p>
          {(() => {
            const result = currentStage!.result as GuardrailCandidates;
            const selected = selectedGuardrailIds ?? result.candidates.filter((c) => c.suggested).map((c) => c.id);
            const toggle = (id: string) => setSelectedGuardrailIds(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
            return (
              <>
                <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginBottom: 10 }}>מפעילים הגנות אוטומטיות (דטרמיניסטיות, ללא AI) עבור פעולות שאסור לבצע בטעות.</p>
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {result.candidates.map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} style={{ marginTop: 3 }} />
                      <span>
                        <b>{c.label}</b>{c.suggested && <span style={{ color: "var(--ink-400)" }}> (מוצע)</span>}
                        <br /><span style={{ color: "var(--ink-500)" }}>{c.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy === "guardrails"} onClick={() => run("guardrails", async () => {
                  await submitOnboardingStageInput(repoId, r.id, "guardrails", { approvedGuardrailIds: selected });
                  setSelectedGuardrailIds(null);
                })}>
                  {busy === "guardrails" ? "שומר…" : "✓ אשר מנגנוני הגנה"}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {waiting && currentStage!.stageKey === "user_review" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <p className="section-lbl">סקירת המשתמש לפני Pull Request</p>
          {(() => {
            const result = currentStage!.result as UserReview;
            return (
              <>
                <p style={{ fontSize: 12, marginBottom: 12 }}>
                  תוצאת בדיקת תקינות: <b>{result.readiness?.status ?? "—"}</b>
                </p>
                <div style={{ display: "grid", gap: 14, marginBottom: 14 }}>
                  {result.groups.filter((g) => g.items.length > 0).map((g) => (
                    <div key={g.group_he}>
                      <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{g.group_he}</p>
                      {g.items.map((it, i) => (
                        <p key={i} style={{ fontSize: 12, color: "var(--ink-500)" }}>✓ {it.label}</p>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run("approve-review", () =>
                    submitOnboardingStageInput(repoId, r.id, "user_review", { decision: "approve" }))}>
                    {busy === "approve-review" ? "שומר…" : "אשר ופתח Pull Request"}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => {
                    const note = window.prompt("מה נדרש לשנות?") ?? "";
                    run("request-changes", () => submitOnboardingStageInput(repoId, r.id, "user_review", { decision: "request_changes", note }));
                  }}>
                    {busy === "request-changes" ? "שומר…" : "בקש שינויים"}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {!waiting && !["Completed", "CompletedWithWarnings", "Failed", "Cancelled"].includes(r.status) && (
        <button className="btn btn-primary btn-sm" disabled={busy === "advance"} onClick={() => run("advance", () => advanceOnboardingRun(repoId, r.id))}>
          {busy === "advance" ? "מריץ…" : "המשך לשלב הבא"}
        </button>
      )}
      {r.status === "Failed" && (
        <button className="btn btn-primary btn-sm" disabled={busy === "advance"} onClick={() => run("advance", () => advanceOnboardingRun(repoId, r.id))}>
          {busy === "advance" ? "מנסה שוב…" : "נסה שוב"}
        </button>
      )}
    </>
  );
}

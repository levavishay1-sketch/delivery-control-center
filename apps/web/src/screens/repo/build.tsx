import { useState } from "react";
import { deliverOnboardingRun, getOnboardingFile, removeBuiltComponent, type BuildResult, type DeliverResult, type EvalComponentSummary, type EvalSummary, type EvalTaskKind, type OnboardingComponent } from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { CodeMapPanel } from "../../components/CodeMap.tsx";
import { FileCompare } from "../../components/FileCompare.tsx";
import { DeliveryTree } from "./FileTree.tsx";
import { TrialRuns } from "./steps.tsx";
import { DeltaLine } from "./cards.tsx";
import { Kv, NotYet, Tile, Working, isOver, shortPath, type StepProps } from "./shared.tsx";
import { COMPONENT_STATUS_HE, KIND_HE, TASK_KIND_HE, TASK_VERDICT_HE, fmtInt, fmtUsd, passedOf, shortSha, signedPct, validationLabel } from "./labels.ts";

/**
 * Steps 5 and 6: the build with its validation per component, and the
 * measurement "with" — the same tasks on a copy holding exactly what would be
 * delivered, against "without"; per task, and per component with a proposal
 * to remove what did not earn its place. Then the delivery — only what was
 * verified or configured, in the person's identity, with the report the pull
 * request carries.
 */

const BUILT: OnboardingComponent["status"][] = ["installed", "verified", "configured", "failed", "removed"];
const DELIVERABLE: OnboardingComponent["status"][] = ["verified", "configured"];

export function BuildBody(p: StepProps) {
  const { step, view } = p;
  const kinds: Record<string, EvalTaskKind> = Object.fromEntries((view.trials.eval?.tasks ?? []).map((t) => [t.key, t.kind]));
  if (step.status === "Running") {
    const built = view.events.filter((e) => e.type === "onboarding.build.component").length;
    const planned = view.components.filter((c) => c.status === "approved" || BUILT.includes(c.status)).length;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <Working text={`בונה ומאמת רכיב אחרי רכיב, בסדר תלות… ${built} מתוך ${planned}. אחר כך המדידה "עם", על עותק שמכיל בדיוק את מה שיימסר.`} />
        {view.trials.after.length > 0 && (
          <>
            <span className="ob-sub">המדידה עם הסט<Info k="eval_arms" /> — {view.trials.after.length} הרצות הסתיימו</span>
            <TrialRuns rows={view.trials.after} kinds={kinds} />
          </>
        )}
      </div>
    );
  }
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const r = step.result as BuildResult;
  const ev = r.eval ?? null;
  const byKey = new Map((ev?.components ?? []).map((c) => [c.key, c]));
  const rows = view.components.filter((c) => c.validation || (BUILT.includes(c.status) && (c.status !== "removed" || c.files.length > 0)));
  const configured = view.components.filter((c) => c.status === "configured").length;
  // Removing a built card is possible only between the build and the delivery.
  const canRemove = view.steps.find((s) => s.stepKey === "deliver")?.status === "WaitingForUser" && !isOver(view);
  const remove = (c: OnboardingComponent, why: string) => {
    if (!confirm(`להסיר את "${c.title_he}" לפני המסירה? הקבצים שלו יימחקו מהעותק המבודד, והכרטיס יסומן "הוסר". להחזיר אותו אפשר רק בהרצה חדשה.`)) return;
    void p.act(`remove:${c.key}`, () => removeBuiltComponent(view.run.repoId, view.run.id, c.key, `המדידה הציעה להסיר: ${why}`));
  };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="rd-tiles">
        <Tile n={r.verified} label="אומתו" info="validation_result" tone="ok" />
        <Tile n={configured} label="הוגדרו · יחוברו אצל הלקוח" info="status_configured" />
        <Tile n={r.failed} label="נכשלו באימות" info="validation_result" tone={r.failed ? "bad" : undefined} />
        <Tile n={r.skipped} label="דולגו (דיווח, נדחה להמשך)" />
        <Tile n={fmtUsd(r.costUsd)} label="עלות הצעד" info="step_cost" />
      </div>
      {(r.removedFiles?.length ?? 0) > 0 && (
        <div className="ob-note warn">קבצים של רכיבים שנכשלו נמחקו<Info k="removed_files" />: <span className="ob-code">{r.removedFiles!.map(shortPath).join(", ")}</span></div>
      )}
      {ev ? <EvalBlock ev={ev} after={view.trials.after} kinds={kinds} />
        : r.delta ? <p className="ob-sub" style={{ margin: 0 }}>עם / בלי<Info k="trial_before_after" />: בלי {r.delta.before.passed}/{r.delta.before.total} → עם {r.delta.after.passed}/{r.delta.after.total} · עלות למשימה {signedPct(r.delta.costPerTaskChange)}</p>
          : <p className="ob-sub" style={{ margin: 0 }}>עם / בלי<Info k="trial_before_after" />: אין — המדידה לא רצה (הרצת מאמן, או שלא הייתה מדידה "בלי").</p>}
      <div>
        <CardTitle info="build_table">מה נבנה ואיך אומת</CardTitle>
        {rows.length ? (
          <table className="rd-table">
            {/* no-info: the component and the detail say what they are; the kind, the files, the check, the result and the measurement open theirs */}
            <thead><tr><th>רכיב</th><th>סוג<Info k="component_kind" /></th><th>קבצים<Info k="files_written" /></th><th>איך נבדק<Info k="verify_how" /></th><th>תוצאה<Info k="validation_result" /></th><th>פירוט</th><th>מה המדידה אמרה<Info k="component_delta" /></th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const cs = byKey.get(c.key);
                return (
                  <tr key={c.key}>
                    <td><b>{c.title_he}</b></td>
                    <td>{KIND_HE[c.kind]}</td>
                    <td className="dim"><span className="ob-code">{c.files.map(shortPath).join(", ") || "—"}</span></td>
                    <td className="dim">{c.validation?.how ?? "—"}</td>
                    <td><ResultChip c={c} /></td>
                    <td className="dim">{c.validation?.detail ?? ""}</td>
                    <td><Measured c={c} cs={cs} busy={p.busy} onRemove={canRemove && DELIVERABLE.includes(c.status) ? remove : null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="ob-sub">שום רכיב לא נבנה.</p>}
      </div>
      <div className="panel" style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
        <CardTitle info="joint_check">בדיקה משותפת</CardTitle>
        <div>כפילויות (שני רכיבים כותבים אותו קובץ): {r.jointCheck.duplicates.length ? r.jointCheck.duplicates.join(" · ") : "אין"}</div>
        <div>סתירות (איסור קריאה שמסתיר קובץ שרכיב אחר צריך): {r.jointCheck.contradictions.length ? r.jointCheck.contradictions.join(" · ") : "אין"}</div>
        <div>הקשר שנטען בכל סשן<Info k="always_loaded_tokens" />: ~{fmtInt(r.jointCheck.alwaysLoadedTokens)} טוקנים</div>
      </div>
      <FilesWritten files={r.files} repoId={view.run.repoId} runId={view.run.id} />
    </div>
  );
}

/** The build's own result per component: a configured connection and a removed card say so, not "not checked here". */
function ResultChip({ c }: { c: OnboardingComponent }) {
  if (c.status === "configured" || c.status === "removed") { const st = COMPONENT_STATUS_HE[c.status]; return <span className={`rd-chip ${st.cls}`}>{st.label}</span>; }
  if (c.status === "failed") return <span className="rd-chip bad">נכשל</span>;
  const v = validationLabel(c.validation?.passed);
  return <span className={`rd-chip ${v.cls}`}>{v.label}</span>;
}

/** What the measurement said about one component, why, and — when it did not earn its place — the way to take it out before delivery. */
function Measured({ c, cs, busy, onRemove }: { c: OnboardingComponent; cs: EvalComponentSummary | undefined; busy: string | null; onRemove: ((c: OnboardingComponent, why: string) => void) | null }) {
  const d = c.delta ?? cs?.delta ?? null;
  if (!d) return <span className="ob-sub">—</span>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div><DeltaLine d={d} /></div>
      {cs?.why_he && <div className="dim">{cs.why_he}</div>}
      {cs?.removalProposed && c.status !== "removed" && (
        <div className="rd-inline" style={{ gap: 4 }}>
          <span className="rd-chip human">מוצע להסרה</span><Info k="remove_suggested" />
          {onRemove && (
            <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
              <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => onRemove(c, cs.why_he)}>{busy === `remove:${c.key}` ? "מסיר…" : "הסר לפני המסירה"}</button>
              <Info k="remove_before_deliver" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const usd = (x: number | null) => (x === null ? "—" : fmtUsd(x));
const turns = (x: number | null) => (x === null ? "—" : x.toFixed(0));

/** The measurement "with" against "without": the summary line, a row per task, and the runs of the "with" arm on demand. */
function EvalBlock({ ev, after, kinds }: { ev: EvalSummary; after: StepProps["view"]["trials"]["after"]; kinds: Record<string, EvalTaskKind> }) {
  const [runs, setRuns] = useState(false);
  const t = ev.totals;
  const better = t.with.passK > t.without.passK;
  const worse = t.worse > 0 || t.with.passK < t.without.passK;
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <CardTitle info="eval_summary">המדידה עם ובלי</CardTitle>
      <div className="rd-inline" style={{ fontSize: 13 }}>
        <b style={{ color: better ? "var(--status-healthy)" : worse ? "var(--status-critical)" : undefined }}>עם {t.with.passK}/{t.measured}</b>
        <span>·</span><b>בלי {t.without.passK}/{t.measured}</b><Info k="eval_arms" />
        <span>·</span><span>השתפרו {t.improved} · הורעו {t.worse} · אותו דבר {t.same}{t.unmeasured ? ` · לא נמדדו ${t.unmeasured}` : ""}</span><Info k="task_verdict" />
        <span>·</span><span>עלות להרצה <span dir="ltr">{signedPct(t.costChange)}</span></span><Info k="eval_cost_change" />
      </div>
      <p className="ob-sub" style={{ margin: 0 }}>המספרים הם משימות שעברו בכל הרצה<Info k="pass_k" />, מתוך {t.measured} שנמדדו בשתי הזרועות. המדידה עלתה {fmtUsd(t.spentUsd)}.</p>
      {ev.tasks.length > 0 && (
        <table className="rd-table">
          {/* no-info: the task says what it is; every other column opens its own */}
          <thead><tr><th>משימה</th><th>סוג<Info k="eval_task_kind" /></th><th>עם<Info k="eval_arm_result" /></th><th>בלי<Info k="eval_arm_result" /></th><th>פסק דין<Info k="task_verdict" /></th><th>עלות ממוצעת<Info k="eval_mean_cost" /></th><th>תורות בממוצע<Info k="eval_turns" /></th></tr></thead>
          <tbody>
            {ev.tasks.map((x) => {
              const v = TASK_VERDICT_HE[x.verdict];
              return (
                <tr key={x.key}>
                  <td><b>{x.title_he}</b></td>
                  <td><span className="rd-chip">{TASK_KIND_HE[x.kind] ?? x.kind}</span></td>
                  <td className="num">{passedOf(x.with)}</td>
                  <td className="num">{passedOf(x.without)}</td>
                  <td><span className={`rd-chip ${v.cls}`}>{v.label}</span></td>
                  <td className="num">עם {usd(x.with.meanCostUsd)} · בלי {usd(x.without.meanCostUsd)}</td>
                  <td className="num">עם {turns(x.with.meanTurns)} · בלי {turns(x.without.meanTurns)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {after.length > 0 && (
        <div>
          <button type="button" className="ob-toggle" onClick={() => setRuns((v) => !v)}>{runs ? "הסתר את ההרצות" : `ההרצות עם הסט, אחת-אחת (${after.length})`}</button>
          {runs && <div style={{ marginTop: 8 }}><TrialRuns rows={after} kinds={kinds} /></div>}
        </div>
      )}
    </div>
  );
}

/** The files the build wrote in the isolated copy, each opening its before/after. */
function FilesWritten({ files, repoId, runId }: { files: string[]; repoId: string; runId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  return (
    <div>
      <div className="rd-inline">
        <CardTitle info="files_written">קבצים שנכתבו ({files.length})</CardTitle>
        {files.length > 0 && <button type="button" className="ob-toggle" onClick={() => setShown((v) => !v)}>{shown ? "הסתר" : "הצג"}</button>}
      </div>
      {shown && (
        <div className="rd-files">
          {files.map((f) => (
            <div key={f}>
              <button type="button" aria-pressed={open === f} onClick={() => setOpen(open === f ? null : f)}><span className="f">{f}</span><span className="ob-sub">{open === f ? "סגור" : "השווה"}</span></button>
              {open === f && <FileCompare key={f} load={() => getOnboardingFile(repoId, runId, f)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 6. deliver ───────────────────────────────────────────────────── */

export function DeliverBody(p: StepProps) {
  const { step, view } = p;
  const { run } = view;
  if (step.status === "Running") return <Working text="עושה commit על שמך, push לענף ופותח PR…" />;
  if (step.status === "WaitingForUser") {
    const files = ((step.result ?? {}) as { files?: string[] }).files ?? [];
    const delivered = view.components.filter((c) => DELIVERABLE.includes(c.status)).length;
    const left = view.components.filter((c) => c.status === "failed" || c.status === "removed").length;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div className="rd-inline" style={{ fontSize: 12.5 }}>
          <span style={{ fontWeight: 650 }}>מה ייכנס למסירה<Info k="deliver_files" /> — רק מה שאומת או הוגדר:</span>
          <b>{delivered} רכיבים · {files.length} קבצים</b>
          {left > 0 && <span className="ob-sub">({left} שנכשלו או הוסרו נשארים בחוץ)</span>}
        </div>
        {files.length
          ? <DeliveryTree files={files} repoName={view.repo.name} repoId={run.repoId} runId={run.id} />
          : <div className="ob-note warn">אין קבצים למסירה — שום רכיב לא אומת או הוגדר. אפשר לבטל את ההרצה ולהתחיל חדשה.</div>}
        <div className="rd-inline" style={{ fontSize: 12.5 }}><span>מי אחראי<Info k="run_identity" />:</span><span>{p.users[run.triggeredBy] ?? "—"} — ה-commit וה-PR ייחתמו בשמו</span></div>
        <CodeMapPanel map={view.codeMap} />
        <div className="ob-actions">
          <button className="btn btn-primary" disabled={!!p.busy || !files.length} onClick={() => void p.act("deliver", () => deliverOnboardingRun(run.repoId, run.id))}>{p.busy === "deliver" ? "מוסר…" : "מסור: commit, push ו-PR"}</button>
          <Info k="deliver_button" />
          <span className="ob-sub">push לענף {run.branchName ?? ""} ו-PR אל {run.defaultBranch ?? "הענף הראשי"}. הענף הראשי לא משתנה עד שתמזגו.</span>
        </div>
      </div>
    );
  }
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} text="המסירה ממתינה ללחיצה — שום דבר לא יוצא מהמחשב לפני כן." />;
  const r = (view.deliver ?? step.result) as DeliverResult;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="ob-kv">
        <Kv label="commit" info="run_baseline" code>{shortSha(r.commitSha)}</Kv>
        <Kv label="ענף" info="run_branch" code>{r.branch}</Kv>
        <Kv label="אל הענף" info="run_base_branch" code>{r.base}</Kv>
        <Kv label="קבצים" info="deliver_files">{fmtInt(r.filesCommitted)}</Kv>
        <Kv label="Pull Request" info="run_pr">
          {r.prUrl ? <a href={r.prUrl} target="_blank" rel="noreferrer">#{r.prNumber ?? "PR"} ↗</a> : r.compareUrl ? <a href={r.compareUrl} target="_blank" rel="noreferrer">פתיחה ידנית ↗</a> : "—"}
        </Kv>
      </div>
      <p className="ob-sub" style={{ margin: 0 }}>{r.note ?? (r.localOnly ? `אין remote לריפו: הענף נשאר מקומי. מזגו אותו ל-${r.base} ידנית.` : `ה-PR ממתין למיזוג ידני ל-${r.base}. המאמן ממשיך מכאן, מהעבודה האמיתית.`)}</p>
      <CodeMapPanel map={view.codeMap} />
      <div>
        <CardTitle info="pr_report">הדו"ח שב-PR</CardTitle>
        <pre className="rd-report">{r.report}</pre>
      </div>
    </div>
  );
}

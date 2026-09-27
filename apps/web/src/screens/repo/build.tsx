import { useState } from "react";
import { deliverOnboardingRun, getOnboardingFile, type BuildResult, type DeliverResult, type OnboardingComponent, type TrialDelta } from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { CodeMapPanel } from "../../components/CodeMap.tsx";
import { FileCompare } from "../../components/FileCompare.tsx";
import { TrialTable } from "./steps.tsx";
import { Kv, NotYet, Tile, Working, shortPath, type StepProps } from "./shared.tsx";
import { KIND_HE, fmtInt, fmtUsd, shortSha, signedPct, validationLabel } from "./labels.ts";

/**
 * Steps 5 and 6: the build with its validation per component and the trial
 * again (before against after), and the delivery — only what was approved,
 * in the person's identity, with the report the pull request carries.
 */

const BUILT: OnboardingComponent["status"][] = ["installed", "verified", "failed"];

export function BuildBody(p: StepProps) {
  const { step, view } = p;
  if (step.status === "Running") {
    const built = view.events.filter((e) => e.type === "onboarding.build.component").length;
    const planned = view.components.filter((c) => c.status === "approved" || BUILT.includes(c.status)).length;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <Working text={`בונה ומאמת רכיב אחרי רכיב, לפי משפחה בסדר תלות… ${built} מתוך ${planned}. אחר כך ריצת הניסיון שוב.`} />
        {view.trials.after.length > 0 && (
          <>
            <span className="ob-sub">ריצת הניסיון החוזרת<Info k="trial_before_after" /> — {view.trials.after.length} מתוך {view.trials.baseline.length}</span>
            <TrialTable rows={view.trials.after} />
          </>
        )}
      </div>
    );
  }
  if (step.status !== "Completed") return <NotYet runnable={p.runnable} />;
  const r = step.result as BuildResult;
  const delta = r.delta ?? view.trials.delta;
  const rows = view.components.filter((c) => c.validation || BUILT.includes(c.status));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="rd-tiles">
        <Tile n={r.installed} label="הותקנו" info="build_table" />
        <Tile n={r.verified} label="אומתו" info="validation_result" tone="ok" />
        <Tile n={r.failed} label="נכשלו באימות" info="validation_result" tone={r.failed ? "bad" : undefined} />
        <Tile n={r.skipped} label="דולגו (דיווח, נדחה להמשך)" />
        <Tile n={fmtUsd(r.costUsd)} label="עלות הצעד" info="step_cost" />
      </div>
      {delta ? <BeforeAfter d={delta} /> : <p className="ob-sub" style={{ margin: 0 }}>לפני / אחרי<Info k="trial_before_after" />: אין — ריצת הניסיון לא רצה שוב (הרצת מאמן, או שלא הייתה נקודת התחלה).</p>}
      <div>
        <CardTitle info="build_table">מה נבנה ואיך אומת</CardTitle>
        {rows.length ? (
          <table className="rd-table">
            {/* no-info: the component and the detail say what they are; the kind, the files, the check and the result open theirs */}
            <thead><tr><th>רכיב</th><th>סוג<Info k="component_kind" /></th><th>קבצים<Info k="files_written" /></th><th>איך נבדק<Info k="verify_how" /></th><th>תוצאה<Info k="validation_result" /></th><th>פירוט</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const v = validationLabel(c.validation?.passed);
                return (
                  <tr key={c.key}>
                    <td><b>{c.title_he}</b></td>
                    <td>{KIND_HE[c.kind]}</td>
                    <td className="dim"><span className="ob-code">{c.files.map(shortPath).join(", ") || "—"}</span></td>
                    <td className="dim">{c.validation?.how ?? "—"}</td>
                    <td><span className={`rd-chip ${c.status === "failed" ? "bad" : v.cls}`}>{c.status === "failed" && !c.validation ? "נכשל" : v.label}</span></td>
                    <td className="dim">{c.validation?.detail ?? ""}</td>
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
      {view.trials.after.length > 0 && (
        <div>
          <CardTitle info="trial_before_after">ריצת הניסיון החוזרת</CardTitle>
          <TrialTable rows={view.trials.after} />
        </div>
      )}
    </div>
  );
}

function BeforeAfter({ d }: { d: TrialDelta }) {
  const better = d.after.passed > d.before.passed;
  const worse = d.after.passed < d.before.passed;
  return (
    <div className="rd-tiles">
      <Tile n={`${d.before.passed}/${d.before.total} → ${d.after.passed}/${d.after.total}`} label="משימות שעברו: לפני → אחרי" info="trial_before_after" tone={better ? "ok" : worse ? "bad" : undefined} />
      <Tile n={signedPct(d.costPerTaskChange)} label="עלות למשימה" info="cost_per_task" tone={d.costPerTaskChange != null && d.costPerTaskChange < 0 ? "ok" : d.costPerTaskChange != null && d.costPerTaskChange > 0 ? "warn" : undefined} />
      <Tile n={`${fmtUsd(d.before.costUsd)} → ${fmtUsd(d.after.costUsd)}`} label="עלות הניסיון: לפני → אחרי" info="ai_cost" />
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
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>מה ייכנס למסירה<Info k="deliver_files" /> ({files.length} קבצים)</span>
        {files.length
          ? <ul className="rd-list plain" style={{ display: "grid", gap: 2 }}>{files.map((f) => <li key={f} className="ob-code">{f}</li>)}</ul>
          : <div className="ob-note warn">אין קבצים למסירה — שום רכיב לא הותקן ואומת. אפשר לבטל את ההרצה ולהתחיל חדשה.</div>}
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

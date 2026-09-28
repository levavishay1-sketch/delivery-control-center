import { useEffect, useState } from "react";
import { decideCoachProposal, getCoach, startOnboardingRun, type CoachProposal, type CoachView, type HealthScore } from "../../api.ts";
import { CardTitle } from "../../ui.tsx";
import { Info } from "../../claude/Info.tsx";
import { PROPOSAL_KIND_HE, errText, fmtDate, fmtInt, fmtUsd, pct } from "./labels.ts";

/**
 * The coach: what real work on the repository says about its setup, the
 * proposals it drew from that, and the numbers across repositories. Lives in
 * the dossier's rail once a run delivered; approving a proposal starts a
 * coach run (the same steps, only the plan and the build) that the screen
 * then shows like any run.
 */

const TREND_HE: Record<NonNullable<HealthScore["trend"]>, string> = { up: "↑ משתפר", down: "↓ נחלש", flat: "→ יציב" };
const PROPOSAL_STATUS_HE: Record<string, { label: string; cls: string }> = {
  open: { label: "מחכה להחלטה", cls: "human" }, approved: { label: "אושר", cls: "ok" }, declined: { label: "נדחה", cls: "bad" }, applied: { label: "יושם", cls: "ok" }, superseded: { label: "הוחלף", cls: "" },
};

export function CoachPanel({ repoId, busy, onRunStarted, onError }: { repoId: string; busy: boolean; onRunStarted: (runId: string) => void; onError: (text: string) => void }) {
  const [view, setView] = useState<CoachView | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [more, setMore] = useState(false);
  const load = () => getCoach(repoId).then(setView).catch((e) => onError(errText(e)));
  useEffect(() => { void getCoach(repoId).then(setView).catch(() => {}); }, [repoId]);
  if (!view) return null;
  const decide = async (p: CoachProposal, decision: "approve" | "decline") => {
    setWorking(p.id);
    try {
      const r = await decideCoachProposal(repoId, p.id, { decision, reason: decision === "decline" ? reason.trim() || null : null });
      setDeclining(null); setReason("");
      await load();
      if (r.runId) onRunStarted(r.runId);
    } catch (e) { onError(errText(e)); } finally { setWorking(null); }
  };
  const open = view.proposals.filter((p) => p.status === "open");
  const past = view.proposals.filter((p) => p.status !== "open");
  const h = view.health;
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <CardTitle info="coach_panel">המאמן</CardTitle>
      <Health h={h} />
      {view.lastRun && <p className="ob-sub" style={{ margin: 0 }}>הרצה אחרונה: {view.lastRun.kind === "coach" ? "הרצת מאמן" : "הטמעה"}{view.lastRun.completedAt ? ` · נמסרה ${fmtDate(view.lastRun.completedAt)}` : " · עוד לא נמסרה"}</p>}
      <div>
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>הצעות<Info k="coach_proposals" /> ({open.length})</span>
        {open.length === 0
          ? <p className="ob-sub" style={{ margin: "4px 0 0" }}>{h.tasks === 0 ? "המאמן מחכה לעבודה אמיתית במאגר — משימות, PR-ים, סשנים — ומציע רק ממה שראה." : "אין הצעות פתוחות. המאמן בודק שוב אחרי כל משימה ומדי שבוע."}</p>
          : (
            <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
              {open.map((p) => (
                <div className="rd-prop" key={p.id}>
                  <div className="t"><span className="rd-chip det">{PROPOSAL_KIND_HE[p.kind]}</span> {p.title}</div>
                  <div className="w">{p.why}</div>
                  {declining === p.id
                    ? (
                      <div className="ob-actions">
                        <input className="rd-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למה? (לא חובה)" autoFocus />
                        <button className="btn btn-destructive btn-sm" disabled={busy || working === p.id} onClick={() => void decide(p, "decline")}>דחה</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setDeclining(null)}>ביטול</button>
                      </div>
                    ) : (
                      <div className="ob-actions">
                        <button className="btn btn-primary btn-sm" disabled={busy || working === p.id} onClick={() => void decide(p, "approve")}>{working === p.id ? "מתחיל…" : "אשר — פתח הרצת מאמן"}</button><Info k="proposal_approve" />
                        <button className="btn btn-secondary btn-sm" disabled={busy || working === p.id} onClick={() => { setDeclining(p.id); setReason(""); }}>דחה</button>
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
      </div>
      {view.newInWorld.length > 0 && (
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 650 }}>חדש בעולם<Info k="new_in_world" /></span>
          <ul className="rd-list" style={{ marginTop: 4 }}>{view.newInWorld.map((n) => <li key={n.url}><a href={n.url} target="_blank" rel="noreferrer">{n.name}</a> ({n.kind}) · השתנה {fmtDate(n.changedAt)}</li>)}</ul>
        </div>
      )}
      {view.installed.length > 0 && (
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 650 }}>רכיבים מותקנים<Info k="installed_components" /> ({view.installed.length})</span>
          <ul className="rd-list plain" style={{ marginTop: 4, display: "grid", gap: 2, fontSize: 12 }}>
            {view.installed.map((c) => <li key={c.key} className="rd-inline"><span>{c.title}</span><span className="ob-sub">{c.kind}{c.contextTokens ? ` · ${fmtInt(c.contextTokens)} טוקנים` : ""}</span></li>)}
          </ul>
        </div>
      )}
      {view.acrossRepos.length > 0 && (
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 650 }}>במאגרים אחרים<Info k="across_repos" /></span>
          <ul className="rd-list" style={{ marginTop: 4, fontSize: 12 }}>{view.acrossRepos.map((a) => <li key={a.key}>{a.title}: ב-{a.repos} מאגרים, שיפר ב-{a.improved}</li>)}</ul>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <button type="button" className="ob-toggle" onClick={() => setMore((v) => !v)}>{more ? "הסתר הצעות שהוכרעו" : `הצעות שהוכרעו (${past.length})`}</button>
          {more && (
            <ul className="rd-list plain" style={{ marginTop: 4, display: "grid", gap: 2, fontSize: 12 }}>
              {past.map((p) => { const st = PROPOSAL_STATUS_HE[p.status] ?? { label: p.status, cls: "" }; return <li key={p.id} className="rd-inline"><span className={`rd-chip ${st.cls}`}>{st.label}</span><span>{p.title}</span>{p.decidedAt && <span className="ob-sub">{fmtDate(p.decidedAt)}</span>}</li>; })}
            </ul>
          )}
        </div>
      )}
      <p className="ob-sub" style={{ margin: 0 }}>
        הצעה חדשה מהמאמן אפשר לבקש גם בלי אות — <a style={{ cursor: "pointer" }} onClick={() => { if (busy) return; void startOnboardingRun(repoId, { kind: "coach" }).then((r) => onRunStarted(r.runId)).catch((e) => onError(errText(e))); }}>פתח הרצת מאמן</a>: היא רצה על הפרופיל הנוכחי, בלי ראיון ובלי מדידה.
      </p>
    </div>
  );
}

function Health({ h }: { h: HealthScore }) {
  return (
    <div>
      <div className="rd-inline" style={{ fontSize: 12.5 }}>
        <span>ציון בריאות<Info k="health_score" />:</span>
        <b>{h.score == null ? "אין עדיין" : Math.round(h.score)}</b>
        {h.trend && <span className="ob-sub">{TREND_HE[h.trend]}</span>}
        <span className="ob-sub">· {h.tasks} משימות ב-{h.windowDays} ימים</span>
      </div>
      <div className="rd-health" style={{ marginTop: 6 }}>
        <div className="rd-tile"><div className="n">{pct(h.firstPassRate)}</div><div className="l">עוברות בפעם הראשונה<Info k="first_pass_rate" /></div></div>
        <div className="rd-tile"><div className="n">{h.rerunsPerTask == null ? "—" : h.rerunsPerTask.toFixed(1)}</div><div className="l">ריצות חוזרות למשימה<Info k="reruns_per_task" /></div></div>
        <div className="rd-tile"><div className="n">{h.costPerTaskUsd == null ? "—" : fmtUsd(h.costPerTaskUsd)}</div><div className="l">עלות למשימה<Info k="cost_per_task" /></div></div>
        <div className="rd-tile"><div className="n">{pct(h.mergedWithoutRewriteRate)}</div><div className="l">מוזגו בלי כתיבה מחדש<Info k="health_score" /></div></div>
      </div>
    </div>
  );
}

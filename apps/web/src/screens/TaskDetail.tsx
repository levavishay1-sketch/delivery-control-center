import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTask, getTaskRun, implementTask, progressTask,
  type FlowRun, type ImplementResult, type TaskDetail as TD,
} from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";

/**
 * One task — the unit that actually reaches TFS and gets built.
 * "תן ל-Claude לפתח" runs the local CLI with write tools on an ISOLATED
 * clone (never the user's own checkout), on a task branch, and commits
 * locally. It never pushes: the user reviews and decides.
 */

const STATE_HE: Record<string, string> = {
  pending: "ממתין", in_progress: "בעבודה", blocked: "חסום", done: "הושלם", dropped: "נדחה",
};

const Transcript = ({ lines }: { lines: string[] }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [lines.length]);
  return (
    <div ref={box} style={{ maxHeight: "44vh", overflowY: "auto", background: "var(--surface-muted)", borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.6 }}>
      {lines.length === 0
        ? <span style={{ color: "var(--ink-400)" }}>מתחיל…</span>
        : lines.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("💭") ? "var(--ink-500)" : "var(--ink-800)", whiteSpace: "pre-wrap", marginBottom: 3 }}>{l}</div>
          ))}
    </div>
  );
};

const Card = ({ children, tone }: { children: React.ReactNode; tone?: "crit" | "ok" }) => (
  <div style={{
    border: `1px solid ${tone === "crit" ? "var(--status-critical)" : tone === "ok" ? "var(--status-healthy)" : "var(--border-hairline)"}`,
    borderRadius: 12, padding: "14px 16px", marginBottom: 14, background: "var(--surface)",
  }}>{children}</div>
);

export function TaskDetail({ id, nav }: { id: string; nav: (h: string) => void }) {
  const [d, setD] = useState<TD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => { getTask(id).then(setD).catch((e) => setErr(String(e))); }, [id]);
  const refreshRun = useCallback(async () => {
    try {
      const r = await getTaskRun(id);
      setRun((prev) => { if (prev?.state === "running" && r.state === "done") load(); return r; });
    } catch { /* ignore */ }
  }, [id, load]);

  useEffect(() => { load(); refreshRun(); }, [load, refreshRun]);
  const running = run?.state === "running";
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(refreshRun, 1500);
    return () => clearInterval(iv);
  }, [running, refreshRun]);

  if (err) return <div className="empty">{err}</div>;
  if (!d) return <div className="spin">טוען…</div>;
  const t = d.task;
  const blockedOpen = d.blockedBy.filter((b) => b.state !== "done");
  const impl = run?.state === "done" && run.kind === "implement" ? (run.result as unknown as ImplementResult | null) : null;

  const copy = (s: string, k: string) => { navigator.clipboard?.writeText(s); setCopied(k); setTimeout(() => setCopied(""), 1500); };

  const start = async () => {
    setErr(null);
    try { await implementTask(id); setShowLog(true); await refreshRun(); }
    catch (e) { setErr(String(e)); }
  };

  return (
    <>
      <PageHead
        crumb={<a onClick={() => nav(`#/wi/${d.requirement.id}`)}>← {d.requirement.key ?? "לדרישה"}: {d.requirement.title.slice(0, 50)}</a>}
        title={t.intent}
        sub={`משימה #${t.seq} · ${t.adoType ?? "Task"} · ${t.appetite}`}
        actions={
          <>
            {t.state !== "done" && (
              <button className="btn btn-secondary" onClick={async () => { await progressTask(t.id, { to: "done", clientId: t.clientId }); load(); }}>סמן כהושלם</button>
            )}
            <button className="btn btn-primary" disabled={running} onClick={start}>
              {running ? "Claude עובד…" : impl ? "✦ הרץ שוב" : "✦ תן ל-Claude לפתח"}
            </button>
          </>
        }
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        <Pill tone={t.state === "done" ? "healthy" : t.state === "in_progress" ? "active" : t.state === "blocked" ? "critical" : "inactive"}>
          {STATE_HE[t.state] ?? t.state}
        </Pill>
        <Pill tone={t.adoType && t.adoType !== "Task" ? "ai" : "inactive"}>{t.adoType ?? "Task"}</Pill>
        {t.linkedAdoId
          ? <a href={t.adoUrl ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--status-healthy)" }}>TFS #{t.linkedAdoId} ↗</a>
          : <Pill tone="warning">{t.approvedAt ? "מאושר, טרם הוקם ב-TFS" : "ממתין לאישור"}</Pill>}
        {t.origin === "ai" && <Pill tone="ai">הוצע ע"י AI</Pill>}
      </div>

      {blockedOpen.length > 0 && (
        <Card tone="crit">
          <p style={{ fontSize: 13, marginBottom: 8 }}>המשימה תלויה ב-{blockedOpen.length} משימות שטרם הושלמו:</p>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5 }}>
            {blockedOpen.map((b) => (
              <li key={b.id} style={{ marginBottom: 3 }}>
                <span className="w-title" onClick={() => nav(`#/task/${b.id}`)}>#{b.seq} {b.intent.slice(0, 70)}</span>
                <span style={{ color: "var(--ink-400)" }}> — {STATE_HE[b.state] ?? b.state}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 8 }}>אפשר לפתח בכל זאת, אבל ייתכן שהבסיס עוד לא קיים.</p>
        </Card>
      )}

      {running && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div className="spin" style={{ display: "inline-block", width: 16, height: 16 }} />
            <p style={{ fontSize: 13, color: "var(--ink-600)", margin: 0 }}>Claude מפתח את המשימה — קורא, עורך, ומריץ מה שאפשר…</p>
          </div>
          <Transcript lines={run?.lines ?? []} />
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--ink-400)" }}>
            רץ ברקע על קלון מבודד, על branch נפרד. אפשר לצאת מהמסך. לא נדחף כלום.
          </p>
        </Card>
      )}

      {impl && !running && (
        <Card tone="ok">
          <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>מה Claude עשה</h3>
          <p style={{ fontSize: 12.5, color: "var(--ink-700)", whiteSpace: "pre-wrap", lineHeight: 1.65, marginBottom: 12 }}>{impl.summary}</p>

          {impl.filesChanged.length > 0 && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label>קבצים שהשתנו ({impl.filesChanged.length})</label>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left" }}>
                {impl.filesChanged.map((f) => <div key={f}>{f}</div>)}
              </div>
            </div>
          )}
          {impl.testsRun && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label>בדיקות</label>
              <p style={{ fontSize: 12.5 }}>{impl.testsRun}</p>
            </div>
          )}
          <div className="field" style={{ marginBottom: 10 }}>
            <label>איפה זה יושב</label>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", whiteSpace: "pre-wrap" }}>
              {`${impl.dir}\n${impl.branch}${impl.commit ? `  (commit ${impl.commit})` : "  — ללא שינויים"}`}
            </div>
          </div>
          <div className="field">
            <label>לבדיקה מקומית</label>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, background: "var(--surface-muted)", padding: "8px 10px", borderRadius: 7, direction: "ltr", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ whiteSpace: "pre-wrap" }}>{`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`}</span>
              <a style={{ cursor: "pointer", color: "var(--color-accent)" }} onClick={() => copy(`cd ${impl.dir}\ngit show ${impl.commit ?? "HEAD"}`, "cmd")}>{copied === "cmd" ? "✓" : "העתק"}</a>
            </div>
            <span className="hint" style={{ fontSize: 11, color: "var(--ink-400)" }}>לא נדחף לשום מקום — אתה מחליט אם ל-cherry-pick / push.</span>
          </div>

          {impl.followUps.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="section-lbl" style={{ marginBottom: 6 }}>המשך שנשאר</p>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                {impl.followUps.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
        </Card>
      )}

      {run?.state === "error" && !running && (
        <Card tone="crit">
          <p style={{ fontSize: 13, marginBottom: 6 }}>ההרצה נכשלה.</p>
          <p style={{ fontSize: 12, color: "var(--status-critical)", whiteSpace: "pre-wrap" }}>{run.error}</p>
        </Card>
      )}

      {run && run.lines.length > 0 && !running && (
        <div style={{ marginBottom: 14 }}>
          <a className="link" style={{ fontSize: 12 }} onClick={() => setShowLog((v) => !v)}>
            {showLog ? "▲ הסתר" : "▼ הצג"} את התמלול המלא של ההרצה
          </a>
          {showLog && <div style={{ marginTop: 8 }}><Transcript lines={run.lines} /></div>}
        </div>
      )}

      <Card>
        <h3 style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 10 }}>הקשר</h3>
        <dl className="detail-grid">
          <div><dt>דרישה</dt><dd><span className="w-title" onClick={() => nav(`#/wi/${d.requirement.id}`)}>{d.requirement.key ?? d.requirement.title.slice(0, 40)}</span></dd></div>
          {d.parent && <div><dt>הורה</dt><dd><span className="w-title" onClick={() => nav(`#/task/${d.parent!.id}`)}>#{d.parent.seq} {d.parent.intent.slice(0, 40)}</span></dd></div>}
          <div><dt>repository</dt><dd style={{ direction: "ltr" }}>{d.repos.map((r) => r.name).join(", ") || "—"}</dd></div>
          <div><dt>גודל</dt><dd>{t.appetite}</dd></div>
        </dl>
        {t.affectedPaths.length > 0 && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>קבצים צפויים</label>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, direction: "ltr", textAlign: "left" }}>{t.affectedPaths.join(", ")}</div>
          </div>
        )}
        {d.children.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="section-lbl" style={{ marginBottom: 6 }}>תת-משימות ({d.children.length})</p>
            <div className="rowlist">
              {d.children.map((c) => (
                <div className="row" key={c.id}>
                  <span className="title w-title" onClick={() => nav(`#/task/${c.id}`)}>#{c.seq} {c.intent}</span>
                  <span className="spacer" />
                  <Pill tone={c.state === "done" ? "healthy" : "inactive"}>{STATE_HE[c.state] ?? c.state}</Pill>
                </div>
              ))}
            </div>
          </div>
        )}
        {d.blocks.length > 0 && (
          <p style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 10 }}>
            {d.blocks.length} משימות מחכות לזו: {d.blocks.map((b) => `#${b.seq}`).join(", ")}
          </p>
        )}
      </Card>
    </>
  );
}

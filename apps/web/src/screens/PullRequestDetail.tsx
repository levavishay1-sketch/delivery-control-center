import { useCallback, useEffect, useState } from "react";
import { cachedPullRequest, getPullRequest, getPullRequestFile, getPullRequestQuick, getRepoBranches, type BranchHealth, type RepoBranches, type PullRequestQuick, type PrBlocker, type FileGroup, type PullRequestDetail as Detail, type TimelineItem } from "../api.ts";
import { CodeMapPanel } from "../components/CodeMap.tsx";
import { FileCompare } from "../components/FileCompare.tsx";
import { TopicRows } from "../components/Topics.tsx";

/**
 * One pull request, on a screen of its own (screens 2 to 5 of
 * `openspec/changes/pull-request-center`): what blocks the merge, what to do
 * next, the code map, the files, the timeline and the repository's branches.
 *
 * It answers, in this order: is it safe to merge, what should I do, and only
 * then the detail — the order a person actually asks in.
 */

export type Tab = "overview" | "files" | "timeline" | "branches";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "סקירה" },
  { key: "files", label: "קבצים" },
  { key: "timeline", label: "יומן" },
  { key: "branches", label: "ענפים" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
function waited(hours: number): string {
  if (hours < 1) return "עודכן ממש עכשיו";
  if (hours < 24) return `ממתין ${Math.round(hours)} שעות`;
  const d = Math.round(hours / 24);
  return d === 1 ? "ממתין יום" : `ממתין ${d} ימים`;
}

function BlockerRow({ b }: { b: PrBlocker }) {
  const tone = b.ok === true ? "yes" : b.ok === false ? "no" : "na";
  return (
    <div className="pr-chk">
      <span className={`ic ${tone}`}>{b.ok === true ? "✓" : b.ok === false ? "✕" : "–"}</span>
      <div><div className="tt">{b.title}</div><div className="dd">{b.detail}</div></div>
    </div>
  );
}

function Files({ groups, count, url, repoId, number }: { groups: FileGroup[]; count: number; url: string; repoId: string; number: number }) {
  const [only, setOnly] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const shown = only ? groups.filter((g) => g.key === only) : groups;
  const add = groups.reduce((n, g) => n + g.additions, 0);
  const del = groups.reduce((n, g) => n + g.deletions, 0);
  return (
    <>
      <div className="pr-fhead">
        <div><b>{count} קבצים</b> <span className="l">· <span className="plus">+{add}</span> <span className="minus">−{del}</span></span></div>
        <div className="pr-chips">
          <button type="button" className={`chip${only === null ? " on" : ""}`} onClick={() => setOnly(null)}>הכל</button>
          {groups.map((g) => (
            <button key={g.key} type="button" className={`chip${only === g.key ? " on" : ""}`} onClick={() => setOnly(g.key)}>{g.title} {g.files.length}</button>
          ))}
        </div>
      </div>
      {shown.map((g) => (
        <div className="panel pr-grp" key={g.key}>
          <div className="gh">
            <b>{g.title}</b>
            <span className="l">{g.files.length} קבצים{g.note ? ` · ${g.note}` : ""}</span>
            <span className="l" style={{ marginInlineStart: "auto" }}><span className="plus">+{g.additions}</span> <span className="minus">−{g.deletions}</span></span>
          </div>
          {g.files.slice(0, 30).map((f) => (
            <div key={f.path}>
              <div className={`pr-file-row click${open === f.path ? " open" : ""}`} role="button" tabIndex={0} aria-expanded={open === f.path}
                onClick={() => setOpen(open === f.path ? null : f.path)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === f.path ? null : f.path); } }}>
                <span className={`st ${f.status === "A" ? "a" : f.status === "D" ? "d" : "m"}`}>{f.status}</span>
                <span className="path">{f.path}</span>
                {f.note && <span className="pill warning">{f.note}</span>}
                <span className="plus">+{f.additions}</span>
                <span className="minus">−{f.deletions}</span>
              </div>
              {open === f.path && <div className="pr-file-open"><FileCompare load={() => getPullRequestFile(repoId, number, f.path)} /></div>}
            </div>
          ))}
          {g.files.length > 30 && <div className="pr-file-row"><span className="l">ועוד {g.files.length - 30} קבצים בקבוצה הזו</span></div>}
        </div>
      ))}
      <p className="ob-sub">לחצו על קובץ כדי לראות אותו לפני ואחרי. הסקירה עצמה, ההערות והאישור נעשים בגיט־האוסט. <a href={`${url}/files`} target="_blank" rel="noreferrer">פתח את השינויים ב-GitHub ↗</a></p>
    </>
  );
}

const BRANCH_STATUS: Record<BranchHealth["status"], { label: string; pill: string }> = {
  default: { label: "ראשי", pill: "neutral" },
  open_pr: { label: "בקשה פתוחה", pill: "active" },
  work: { label: "בעבודה", pill: "neutral" },
  stale: { label: "נסגרה בלי מיזוג", pill: "warning" },
  merged: { label: "כבר מוזג", pill: "healthy" },
};

function Branches({ repoId }: { repoId: string }) {
  const [data, setData] = useState<RepoBranches | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setData(await getRepoBranches(repoId, refresh)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [repoId]);
  useEffect(() => { void load(); }, [load]);

  const count = (s: BranchHealth["status"]) => data?.rows.filter((r) => r.status === s).length ?? 0;
  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h4>מה זה ענף, ולמה יש כאלה</h4>
        <p className="ob-sub">
          ענף הוא עותק עבודה מקביל של הריפו. כל מי שמתחיל עבודה — אדם, סשן של Claude Code או הרצה של DCC — פותח לעצמו ענף, כדי לא לשבור את
          {data ? ` ${data.defaultBranch}` : " הענף הראשי"}. כשהעבודה מוכנה, בקשת מיזוג מכניסה אותה לענף הראשי, ואז הענף כבר לא נחוץ.
          ענפים לא נמחקים לבד, ולכן הם מצטברים. כאן רואים איפה כל אחד עומד.
        </p>
      </div>
      {err && <div className="ob-note crit" style={{ marginBottom: 10 }}>{err}</div>}
      {!data && !err && <div className="panel"><p className="ob-sub"><span className="spinner" style={{ width: 13, height: 13, marginInlineEnd: 8, verticalAlign: "middle" }} />טוען את הענפים מהגיט־האוסט…</p></div>}
      {data && (
        <>
          <div className="pr-tiles">
            <div><div className="l">בקשה פתוחה</div><div className="v">{count("open_pr")}</div></div>
            <div><div className="l">בעבודה</div><div className="v">{count("work")}</div></div>
            <div><div className="l">נסגרו בלי מיזוג</div><div className="v" style={{ color: count("stale") ? "var(--status-warning)" : undefined }}>{count("stale")}</div></div>
            <div><div className="l">אפשר למחוק</div><div className="v" style={{ color: count("merged") ? "var(--status-healthy)" : undefined }}>{count("merged")}</div></div>
          </div>
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="pr-group">
              <b>{data.rows.length} ענפים</b>
              <button className="btn btn-secondary btn-sm" style={{ marginInlineStart: "auto" }} disabled={busy} onClick={() => void load(true)}>{busy ? "מסנכרן…" : "↻ סנכרן"}</button>
            </div>
            {data.rows.map((b) => (
              <div className="pr-br" key={b.name}>
                <div className="top">
                  <span className="ob-code" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{b.name}</span>
                  <span className={`pill ${BRANCH_STATUS[b.status].pill}`}>{BRANCH_STATUS[b.status].label}</span>
                  {b.pr && <span className="l">בקשה #{b.pr.number}{b.pr.state === "MERGED" ? " (מוזגה)" : b.pr.state === "CLOSED" ? " (נסגרה)" : ""}</span>}
                  {b.url && <a className="l" style={{ marginInlineStart: "auto" }} href={b.url} target="_blank" rel="noreferrer">פתח ב-GitHub ↗</a>}
                </div>
                {b.status !== "default" && (
                  <div className="l">
                    {b.unique === 0 ? `אין בו שום דבר שלא נמצא ב-${data.defaultBranch}` : `${b.unique} commits שאינם ב-${data.defaultBranch}`}
                    {b.behind > 0 ? ` · ${data.defaultBranch} התקדם ב-${b.behind} מאז שנפתח` : ""}
                    {b.lastAt ? ` · פעילות אחרונה ${fmtDate(b.lastAt)}${b.lastBy ? ` (${b.lastBy})` : ""}` : ""}
                  </div>
                )}
                {b.lastMessage && b.status !== "default" && <div className="l">"{b.lastMessage}"</div>}
                <div className="l">איך הגיע לכאן: {b.origin}</div>
                <div className={`adv ${b.advice.tone}`}><b>{b.advice.title}.</b> {b.advice.detail}</div>
              </div>
            ))}
          </div>
          <p className="ob-sub" style={{ marginTop: 8 }}>מחיקה נעשית בגיט־האוסט, ורק אחרי שרואים שמה שבענף כבר לא נחוץ. ההיסטוריה של מה שמוזג נשארת גם אחרי המחיקה.</p>
        </>
      )}
    </>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="ob-sub">אין עדיין אירועים.</p>;
  return (
    <div className="panel">
      {items.map((t, i) => (
        <div className="pr-ev" key={i}>
          <div className="tm">{fmtDate(t.at)}</div>
          <div className={`ic ${t.tone ?? ""}`} />
          <div className="tx">
            {t.text}
            {t.tag && <span className="pill warning" style={{ marginInlineStart: 6 }}>{t.tag}</span>}
            {t.detail && <div className="l" style={{ marginTop: 2 }}>{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PullRequestDetailScreen({ repoId, number, tab, nav }: { repoId: string; number: number; tab: Tab; nav: (h: string) => void }) {
  // Something already fetched for this request paints immediately; the refresh happens behind it.
  const [d, setD] = useState<Detail | null>(() => cachedPullRequest(repoId, number));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The header, the blockers and the next step arrive first; the heavy parts fill in behind them.
  const [q, setQ] = useState<PullRequestQuick | null>(null);
  useEffect(() => { let live = true; getPullRequestQuick(repoId, number).then((r) => { if (live) setQ(r); }).catch(() => {}); return () => { live = false; }; }, [repoId, number]);

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setD(await getPullRequest(repoId, number, refresh)); setErr(null); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }, [repoId, number]);
  useEffect(() => { void load(); }, [load]);

  const go = (t: Tab) => nav(`#/pull-requests/${repoId}/${number}${t === "overview" ? "" : `/${t}`}`);

  if (err) return <><button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button><div className="ob-note crit" style={{ marginTop: 12 }}>{err}</div></>;
  const head = d ?? q;
  if (!head) return <><button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button><p className="ob-sub" style={{ marginTop: 12 }}>טוען את הבקשה…</p></>;

  const { pr, nextStep, blockers } = head;
  const canMerge = pr.state === "open" && blockers.every((b) => b.ok !== false);
  const loading = (what: string) => <p className="ob-sub"><span className="spinner" style={{ width: 13, height: 13, marginInlineEnd: 8, verticalAlign: "middle" }} />טוען {what} מהגיט־האוסט…</p>;

  return (
    <div className="pr-screen">
      <div className="pr-bc">
        <button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button>
        <span>בקשות מיזוג</span>›<span>{pr.client.name ?? "ללא לקוח"}</span>›<span>{pr.repo.name}</span>›<b>#{pr.number}</b>
        <button className="btn btn-secondary btn-sm" style={{ marginInlineStart: "auto" }} disabled={busy} onClick={() => void load(true)}>{busy ? "מסנכרן…" : "↻ סנכרן"}</button>
      </div>

      <div className="panel pr-head">
        <div className="top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h1 br">{pr.headBranch}</div>
            <div className="l" dir="ltr" style={{ textAlign: "start" }}>#{pr.number} · {pr.title}</div>
            <div className="l">פתח {pr.author} · {waited(pr.waitingHours)} · אל <span className="ob-code">{pr.baseBranch}</span></div>
          </div>
          <div className="flags">
            {pr.state === "merged" && <span className="pill healthy">מוזגה</span>}
            {pr.state === "closed" && <span className="pill inactive">נסגרה בלי מיזוג</span>}
            {pr.draft && pr.state === "open" && <span className="pill inactive">טיוטה</span>}
            {pr.state === "open" && pr.conflicts && <span className="pill critical">התנגשות</span>}
            {pr.state === "open" && !pr.conflicts && pr.mergeable && <span className="pill healthy">אין התנגשות</span>}
          </div>
        </div>
        <div className="ob-actions">
          <a className="btn btn-primary btn-sm" href={pr.url} target="_blank" rel="noreferrer">פתח ב-GitHub ↗</a>
          <button className="btn btn-secondary btn-sm" disabled title="בשלב הבא">עדכן את הענף</button>
          <button className="btn btn-secondary btn-sm" disabled title="בשלב הבא">בקש סקירה</button>
          <button className="btn btn-secondary btn-sm" disabled={!canMerge} title={canMerge ? "" : "יש חסימות פתוחות"}>מזג</button>
        </div>
      </div>

      <div className="pr-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`pr-tab${tab === t.key ? " on" : ""}`} onClick={() => go(t.key)}>
            {t.label}{t.key === "files" && d?.fileCount ? ` · ${d.fileCount}` : pr.changedFiles && t.key === "files" ? ` · ${pr.changedFiles}` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className={`pr-next ${nextStep.action === "merge" ? "ok" : ""}`}>
            <div className="t">הצעד הבא</div>
            <div className="s">{nextStep.title}</div>
            <div className="d">{nextStep.detail}</div>
          </div>
          <div className="dash">
            <div style={{ minWidth: 0 }}>
              {blockers.length > 0 && <div className="panel" style={{ marginBottom: 12 }}>
                <h4>מה חוסם מיזוג</h4>
                <p className="ob-sub" style={{ marginBottom: 4 }}>המיזוג נפתח רק כשאין שורה אדומה.</p>
                {blockers.map((b) => <BlockerRow key={b.key} b={b} />)}
              </div>}
              {!d
                ? <div className="panel">{loading("את מפת הקוד")}</div>
                : (
                  <div className="pr-maprow">
                    <div className="map">
                      {d.codeMap ? <CodeMapPanel map={d.codeMap} /> : <div className="ob-note warn">{d.codeMapProblem ?? "אין מידע על מיקום הענף."}</div>}
                    </div>
                    {d.topics.length > 0 && (
                      <div className="panel pr-topics">
                        <h4>על מה הענף</h4>
                        <TopicRows topics={d.topics} />
                      </div>
                    )}
                  </div>
                )}
            </div>
            <div className="rail">
              <div className="panel">
                <h4>עובדות</h4>
                <div className="ob-kv">
                  <div><div className="l">commits</div><div className="v">{d?.freshness?.ahead ?? "—"}</div></div>
                  <div><div className="l">קבצים</div><div className="v">{d?.fileCount ?? pr.changedFiles}</div></div>
                  <div><div className="l">היעד התקדם</div><div className="v">{d?.freshness ? `${d.freshness.behind}` : "—"}</div></div>
                  <div><div className="l">מתוכם באותם קבצים</div><div className="v" style={{ color: d?.freshness?.behindTouching ? "var(--status-warning)" : undefined }}>{d?.freshness?.behindTouching ?? "—"}</div></div>
                </div>
              </div>
              <div className="panel">
                <h4>אנשים</h4>
                <div className="pr-rl"><span className="l">פתח</span><span>{pr.author}</span></div>
                <div className="pr-rl"><span className="l">סקירה</span><span>{pr.review === "approved" ? "אושר" : pr.review === "changes_requested" ? "התבקשו שינויים" : "אין אישור"}</span></div>
                <div className="pr-rl"><span className="l">עודכן</span><span>{fmtDate(pr.updatedAt)}</span></div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "files" && (d ? <Files groups={d.groups} count={d.fileCount} url={pr.url} repoId={repoId} number={number} /> : <div className="panel">{loading("את רשימת הקבצים")}</div>)}
      {tab === "timeline" && (d ? <Timeline items={d.timeline} /> : <div className="panel">{loading("את היומן")}</div>)}
      {tab === "branches" && <Branches repoId={repoId} />}
    </div>
  );
}

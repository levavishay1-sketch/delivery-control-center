import { useCallback, useEffect, useState } from "react";
import { getPullRequest, type PrBlocker, type FileGroup, type PullRequestDetail as Detail, type TimelineItem } from "../api.ts";
import { CodeMapPanel } from "../components/CodeMap.tsx";

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

function Files({ groups, count, url }: { groups: FileGroup[]; count: number; url: string }) {
  const [only, setOnly] = useState<string | null>(null);
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
            <div className="pr-file-row" key={f.path}>
              <span className={`st ${f.status === "A" ? "a" : f.status === "D" ? "d" : "m"}`}>{f.status}</span>
              <span className="path">{f.path}</span>
              {f.note && <span className="pill warning">{f.note}</span>}
              <span className="plus">+{f.additions}</span>
              <span className="minus">−{f.deletions}</span>
            </div>
          ))}
          {g.files.length > 30 && <div className="pr-file-row"><span className="l">ועוד {g.files.length - 30} קבצים בקבוצה הזו</span></div>}
        </div>
      ))}
      <p className="ob-sub">הסקירה עצמה, ההערות והאישור נעשים בגיט־האוסט. כאן רואים מה נכנס. <a href={`${url}/files`} target="_blank" rel="noreferrer">פתח את השינויים ב-GitHub ↗</a></p>
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
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setD(await getPullRequest(repoId, number, refresh)); setErr(null); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }, [repoId, number]);
  useEffect(() => { void load(); }, [load]);

  const go = (t: Tab) => nav(`#/pull-requests/${repoId}/${number}${t === "overview" ? "" : `/${t}`}`);

  if (err) return <><button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button><div className="ob-note crit" style={{ marginTop: 12 }}>{err}</div></>;
  if (!d) return <p className="ob-sub">טוען…</p>;

  const { pr, nextStep } = d;
  const canMerge = d.blockers.every((b) => b.ok !== false);

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
            <div className="h1">{pr.title}</div>
            <div className="l">
              פתח {pr.author} · {waited(pr.waitingHours)} · <span className="ob-code">{pr.headBranch} → {pr.baseBranch}</span>
            </div>
          </div>
          <div className="flags">
            {pr.draft && <span className="pill inactive">טיוטה</span>}
            {pr.conflicts && <span className="pill critical">התנגשות</span>}
            {!pr.conflicts && pr.mergeable && <span className="pill healthy">אין התנגשות</span>}
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
            {t.label}{t.key === "files" && d.fileCount ? ` · ${d.fileCount}` : ""}
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
              <div className="panel" style={{ marginBottom: 12 }}>
                <h4>מה חוסם מיזוג</h4>
                <p className="ob-sub" style={{ marginBottom: 4 }}>המיזוג נפתח רק כשאין שורה אדומה.</p>
                {d.blockers.map((b) => <BlockerRow key={b.key} b={b} />)}
              </div>
              {d.codeMap
                ? <CodeMapPanel map={d.codeMap} />
                : <div className="ob-note warn">{d.codeMapProblem ?? "אין מידע על מיקום הענף."}</div>}
            </div>
            <div className="rail">
              <div className="panel">
                <h4>עובדות</h4>
                <div className="ob-kv">
                  <div><div className="l">commits</div><div className="v">{d.freshness?.ahead ?? "—"}</div></div>
                  <div><div className="l">קבצים</div><div className="v">{d.fileCount}</div></div>
                  <div><div className="l">היעד התקדם</div><div className="v">{d.freshness ? `${d.freshness.behind}` : "—"}</div></div>
                  <div><div className="l">מתוכם באותם קבצים</div><div className="v" style={{ color: d.freshness?.behindTouching ? "var(--status-warning)" : undefined }}>{d.freshness?.behindTouching ?? "—"}</div></div>
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

      {tab === "files" && <Files groups={d.groups} count={d.fileCount} url={pr.url} />}
      {tab === "timeline" && <Timeline items={d.timeline} />}
      {tab === "branches" && (
        <div className="panel">
          <h4>ענפים פתוחים בריפו</h4>
          {d.branches.map((b) => (
            <div className="pr-rl" key={b.name}>
              <span className="ob-code" style={{ flex: 1, minWidth: 0 }}>{b.name}</span>
              {b.current && <span className="pill neutral">אתם כאן</span>}
              {b.behind !== null && b.behind > 0 && <span className="pill warning">{b.behind} מאחור</span>}
              {b.prNumber && <span className="l">#{b.prNumber}</span>}
              <span className="l">{b.author}</span>
            </div>
          ))}
          <p className="ob-sub" style={{ marginTop: 8 }}>מוצגים ענפים שיש להם בקשת מיזוג פתוחה. מפת הענפים המלאה של הריפו תתווסף בשלב הבא.</p>
        </div>
      )}
    </div>
  );
}

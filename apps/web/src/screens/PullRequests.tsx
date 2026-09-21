import { useCallback, useEffect, useState } from "react";
import { getPullRequest, listPullRequests, type PullRequestDetail, type PullRequestList, type PullRequestRow } from "../api.ts";
import { TopicRows } from "../components/Topics.tsx";
import { PageHead, Pill, PrNumber } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";

/**
 * בקשות מיזוג — every open pull request DCC can see, from every client and
 * every repository, in one list (`openspec/changes/pull-request-center`).
 *
 * The host stays where things happen: this screen says what is waiting and
 * why, and hands over to the host for the merge itself.
 */

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

function waited(hours: number): string {
  if (hours < 1) return "עודכן ממש עכשיו";
  if (hours < 24) return `ממתין ${Math.round(hours)} שעות`;
  const d = Math.round(hours / 24);
  return d === 1 ? "ממתין יום" : `ממתין ${d} ימים`;
}

const TONE: Record<string, string> = { critical: "critical", warning: "warning", healthy: "healthy", neutral: "inactive" };

function Row({ pr, depth, onOpen }: { pr: PullRequestRow; depth: number; onOpen: () => void }) {
  // "What is it about" opens under the row; pressing the row itself still opens the request's own screen.
  const [more, setMore] = useState(false);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toggle = () => {
    const next = !more;
    setMore(next);
    if (next && !detail) getPullRequest(pr.repo.id, pr.number).then((d) => { setDetail(d); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };
  return (
    <div className="pr-item">
      <div className="pr-line">
        <button type="button" className="pr-row" style={{ paddingInlineStart: 12 + depth * 26 }} onClick={onOpen}
          // Pointing at a row is a good sign it will be opened: start fetching now, so the click finds it ready.
          onMouseEnter={() => { void getPullRequest(pr.repo.id, pr.number).catch(() => {}); }}
          onFocus={() => { void getPullRequest(pr.repo.id, pr.number).catch(() => {}); }}>
          <span className="pr-main">
            <span className="pr-title br">{pr.headBranch}<PrNumber n={pr.number} /></span>
            <span className="pr-meta">{pr.author} · {pr.state === "open" ? waited(pr.waitingHours) : `${pr.state === "merged" ? "מוזגה" : "נסגרה"} ${fmtDay(pr.closedAt ?? pr.updatedAt)}`} · {pr.changedFiles} קבצים · אל <span className="ob-code">{pr.baseBranch}</span></span>
            <span className="pr-flags">
              {pr.state === "merged" && <Pill tone="healthy">מוזגה</Pill>}
              {pr.state === "closed" && <Pill tone="inactive">נסגרה בלי מיזוג</Pill>}
              {pr.flags.map((f) => <Pill key={f.key} tone={(TONE[f.tone] ?? "inactive") as "critical"}>{f.text}</Pill>)}
            </span>
          </span>
          <span className="pr-chev" aria-hidden="true">‹</span>
        </button>
        <button type="button" className={`pr-exp${more ? " on" : ""}`} aria-expanded={more} onClick={toggle}
          title="על מה הענף הזה, בלי לפתוח את המסך שלו">
          על מה הענף <span aria-hidden="true">{more ? "▴" : "▾"}</span>
        </button>
      </div>
      {more && (
        <div className="pr-inline pr-topics-inline">
          {err ? <p className="ob-note crit">{err}</p>
            : !detail ? <p className="ob-sub"><span className="spinner" style={{ width: 13, height: 13, marginInlineEnd: 8, verticalAlign: "middle" }} />טוען מהגיט־האוסט…</p>
            : detail.topics.length ? <TopicRows topics={detail.topics} /> : <p className="ob-sub">אין מידע על הנושאים של הענף הזה.</p>}
        </div>
      )}
    </div>
  );
}

export function PullRequests({ nav }: { nav: (h: string) => void }) {
  const [data, setData] = useState<PullRequestList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Open ones are what waits for a person; the ones already dealt with are one press away.
  const [show, setShow] = useState<"open" | "merged" | "closed">("open");

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setData(await listPullRequests(refresh)); setErr(null); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openRows = data?.rows ?? [];
  const merged = (data?.history ?? []).filter((r) => r.state === "merged");
  const closed = (data?.history ?? []).filter((r) => r.state === "closed");
  const rows = show === "open" ? openRows : show === "merged" ? merged : closed;
  const attention = openRows.filter((r) => r.flags.some((f) => f.tone === "critical" || f.tone === "warning")).length;
  const ready = openRows.filter((r) => !r.draft && !r.conflicts && r.review === "approved").length;

  // Grouped by client, then repository; a request whose base is another request hangs under it.
  // Within a group the requests follow their numbers — the order they were opened in — so a request keeps its place
  // from one visit to the next; what needs attention is said by its flags and the tile above, not by moving it up.
  const groups = new Map<string, { client: string; repo: string; repoId: string; rows: PullRequestRow[] }>();
  for (const r of rows) {
    const key = `${r.client.id ?? "-"}|${r.repo.id}`;
    if (!groups.has(key)) groups.set(key, { client: r.client.name ?? "ללא לקוח", repo: r.repo.name, repoId: r.repo.id, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const ordered = (unsorted: PullRequestRow[]) => {
    const list = [...unsorted].sort((a, b) => a.number - b.number);
    const out: { pr: PullRequestRow; depth: number }[] = [];
    const children = (id: string | null, depth: number) => {
      for (const r of list.filter((x) => x.parentId === id)) { out.push({ pr: r, depth }); children(r.id, depth + 1); }
    };
    children(null, 0);
    for (const r of list) if (!out.some((o) => o.pr.id === r.id)) out.push({ pr: r, depth: 0 });
    return out;
  };

  return (
    <>
      <PageHead info="page_pull_requests"
        title="בקשות מיזוג"
        sub="כל מה שממתין לאישור, מכל הלקוחות. המיזוג עצמו נעשה בגיט־האוסט."
        actions={<button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void load(true)}>{busy ? "מסנכרן…" : "↻ סנכרן"}</button>}
      />
      {err && <div className="ob-note crit" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="pr-tiles">
        <div><div className="l">פתוחות<Info k="prs_open" /></div><div className="v">{openRows.length}</div></div>
        <div><div className="l">דורש תשומת לב<Info k="prs_attention" /></div><div className="v" style={{ color: attention ? "var(--status-warning)" : undefined }}>{attention}</div></div>
        <div><div className="l">מוכן למיזוג<Info k="prs_ready" /></div><div className="v" style={{ color: ready ? "var(--status-healthy)" : undefined }}>{ready}</div></div>
        <div><div className="l">סונכרן<Info k="prs_synced" /></div><div className="v" style={{ fontSize: 13 }}>{data ? fmtTime(data.syncedAt) : "—"}</div></div>
      </div>

      {data?.problems.map((p) => <div key={p.repo} className="ob-note warn" style={{ marginBottom: 10 }}>{p.repo}: {p.reason}</div>)}

      <div className="pr-chips" style={{ marginBottom: 12, marginInlineStart: 0 }}>
        <button type="button" className={`chip${show === "open" ? " on" : ""}`} onClick={() => setShow("open")}>פתוחות {openRows.length}</button>
        <button type="button" className={`chip${show === "merged" ? " on" : ""}`} onClick={() => setShow("merged")}>מוזגו לאחרונה {merged.length}</button>
        <button type="button" className={`chip${show === "closed" ? " on" : ""}`} onClick={() => setShow("closed")}>נסגרו בלי מיזוג {closed.length}</button>
      </div>

      {data && rows.length === 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <p className="ob-sub">{show === "open" ? "אין כרגע בקשות מיזוג פתוחות בריפואים המקושרים." : show === "merged" ? "אין בקשות שמוזגו לאחרונה." : "אין בקשות שנסגרו בלי מיזוג."}</p>
        </div>
      )}

      {[...groups.values()].map((g) => (
        <div className="panel" key={`${g.client}|${g.repoId}`} style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div className="pr-group">
            <b>{g.client}</b><span className="ob-sub">{g.repo}</span>
            <span className="ob-sub" style={{ marginInlineStart: "auto" }}>{g.rows.length} {show === "open" ? "פתוחות" : show === "merged" ? "מוזגו" : "נסגרו"}</span>
          </div>
          {ordered(g.rows).map(({ pr, depth }) => (
            <Row key={pr.id} pr={pr} depth={depth} onOpen={() => nav(`#/pull-requests/${pr.repo.id}/${pr.number}`)} />
          ))}
        </div>
      ))}

      {!!data?.repos.filter((r) => r.reason).length && (
        <div className="panel">
          <div className="l" style={{ marginBottom: 6 }}>ריפואים שלא נסרקו</div>
          {data.repos.filter((r) => r.reason).map((r) => (
            <div key={r.id} className="pr-file"><span className="f">{r.name}</span><span className="ob-sub">{r.reason}</span></div>
          ))}
        </div>
      )}
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { listPullRequests, type PullRequestList, type PullRequestRow } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";

/**
 * בקשות מיזוג — every open pull request DCC can see, from every client and
 * every repository, in one list (`openspec/changes/pull-request-center`).
 *
 * The host stays where things happen: this screen says what is waiting and
 * why, and hands over to the host for the merge itself.
 */

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

function waited(hours: number): string {
  if (hours < 1) return "עודכן ממש עכשיו";
  if (hours < 24) return `ממתין ${Math.round(hours)} שעות`;
  const d = Math.round(hours / 24);
  return d === 1 ? "ממתין יום" : `ממתין ${d} ימים`;
}

const TONE: Record<string, string> = { critical: "critical", warning: "warning", healthy: "healthy", neutral: "inactive" };

function Row({ pr, depth, onOpen }: { pr: PullRequestRow; depth: number; onOpen: () => void }) {
  return (
    <button type="button" className="pr-row" style={{ paddingInlineStart: 12 + depth * 26 }} onClick={onOpen}>
      <span className="pr-num">#{pr.number}</span>
      <span className="pr-main">
        <span className="pr-title">{pr.title}</span>
        <span className="pr-meta">
          {pr.author} · {waited(pr.waitingHours)} · {pr.changedFiles} קבצים
          <span className="ob-code" style={{ marginInlineStart: 6 }}>{pr.headBranch} → {pr.baseBranch}</span>
        </span>
        <span className="pr-flags">
          {pr.flags.map((f) => <Pill key={f.key} tone={(TONE[f.tone] ?? "inactive") as "critical"}>{f.text}</Pill>)}
        </span>
      </span>
      <span className="pr-chev" aria-hidden="true">‹</span>
    </button>
  );
}

export function PullRequests({ nav }: { nav: (h: string) => void }) {
  const [data, setData] = useState<PullRequestList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setData(await listPullRequests(refresh)); setErr(null); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const attention = rows.filter((r) => r.flags.some((f) => f.tone === "critical" || f.tone === "warning")).length;
  const ready = rows.filter((r) => !r.draft && !r.conflicts && r.review === "approved").length;

  // Grouped by client, then repository; a request whose base is another request hangs under it.
  const groups = new Map<string, { client: string; repo: string; repoId: string; rows: PullRequestRow[] }>();
  for (const r of rows) {
    const key = `${r.client.id ?? "-"}|${r.repo.id}`;
    if (!groups.has(key)) groups.set(key, { client: r.client.name ?? "ללא לקוח", repo: r.repo.name, repoId: r.repo.id, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const ordered = (list: PullRequestRow[]) => {
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
      <PageHead
        title="בקשות מיזוג"
        sub="כל מה שממתין לאישור, מכל הלקוחות. המיזוג עצמו נעשה בגיט־האוסט."
        actions={<button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void load(true)}>{busy ? "מסנכרן…" : "↻ סנכרן"}</button>}
      />
      {err && <div className="ob-note crit" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="pr-tiles">
        <div><div className="l">פתוחות</div><div className="v">{rows.length}</div></div>
        <div><div className="l">דורש תשומת לב</div><div className="v" style={{ color: attention ? "var(--status-warning)" : undefined }}>{attention}</div></div>
        <div><div className="l">מוכן למיזוג</div><div className="v" style={{ color: ready ? "var(--status-healthy)" : undefined }}>{ready}</div></div>
        <div><div className="l">סונכרן</div><div className="v" style={{ fontSize: 13 }}>{data ? fmtTime(data.syncedAt) : "—"}</div></div>
      </div>

      {data?.problems.map((p) => <div key={p.repo} className="ob-note warn" style={{ marginBottom: 10 }}>{p.repo}: {p.reason}</div>)}

      {data && rows.length === 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <p className="ob-sub">אין כרגע בקשות מיזוג פתוחות בריפואים המקושרים.</p>
        </div>
      )}

      {[...groups.values()].map((g) => (
        <div className="panel" key={`${g.client}|${g.repoId}`} style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div className="pr-group">
            <b>{g.client}</b><span className="ob-sub">{g.repo}</span>
            <span className="ob-sub" style={{ marginInlineStart: "auto" }}>{g.rows.length} פתוחות</span>
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

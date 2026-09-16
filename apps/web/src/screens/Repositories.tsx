import { useEffect, useState } from "react";
import { getRepos, getLatestOnboardingRun, type OnboardingStatus } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { NewRepo } from "../forms.tsx";

const STATUS_HE: Record<OnboardingStatus, { label: string; tone: "inactive" | "warning" | "healthy" | "critical" }> = {
  Pending: { label: "טרם התחיל", tone: "inactive" },
  Running: { label: "מתבצע", tone: "warning" },
  WaitingForUser: { label: "ממתין לאדם", tone: "warning" },
  Completed: { label: "הושלם", tone: "healthy" },
  CompletedWithWarnings: { label: "הושלם עם אזהרות", tone: "warning" },
  Failed: { label: "נכשל", tone: "critical" },
  Skipped: { label: "דולג", tone: "inactive" },
  Cancelled: { label: "בוטל", tone: "inactive" },
};

type RepoRow = { id: string; name: string; adoRepoRef: string | null; clientId: string | null; clientName: string | null; linkedClients: number };

/**
 * Top-level Repositories screen — every repo across every client, one
 * place to reach AI management from, instead of only via each Client's
 * own detail page (which still also links here — this doesn't replace
 * that, it's the discoverable front door the nav item promised).
 */
export function Repositories({ nav }: { nav: (h: string) => void }) {
  const [rows, setRows] = useState<RepoRow[] | null>(null);
  const [states, setStates] = useState<Record<string, OnboardingStatus | "NONE">>({});
  const [modal, setModal] = useState(false);

  const reload = () => {
    getRepos().then((r) => {
      setRows(r.repos);
      // best-effort status fetch per repo, for the list's status column —
      // org-shared repos (clientId null) are skipped, they can't be managed.
      for (const repo of r.repos) {
        if (!repo.clientId) continue;
        getLatestOnboardingRun(repo.id).then((v) => setStates((s) => ({ ...s, [repo.id]: v?.status ?? "NONE" }))).catch(() => {});
      }
    });
  };
  useEffect(() => { reload(); }, []);

  if (!rows) return <div className="spin">טוען…</div>;

  return (
    <>
      <PageHead
        title="Repositories"
        sub={`${rows.length} repositories בכל הלקוחות`}
        actions={<button className="btn btn-primary" onClick={() => setModal(true)}>+ הוסף Repository</button>}
      />
      {modal && <NewRepo onClose={() => setModal(false)} onDone={() => { setModal(false); reload(); }} />}
      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table className="wtable">
          <thead><tr><th>Repository</th><th>לקוח</th><th>הטמעת AI</th><th>Git</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = r.clientId ? states[r.id] : undefined;
              const stInfo = st && st !== "NONE" ? STATUS_HE[st] : null;
              return (
                <tr key={r.id}>
                  <td>
                    {r.clientId
                      ? <span className="w-title" onClick={() => nav(`#/repo/${r.id}`)}>{r.name}</span>
                      : <span title="הטמעת AI זמינה רק ל-repository ששייך ללקוח יחיד — זה משותף" style={{ color: "var(--ink-500)" }}>{r.name}</span>}
                  </td>
                  <td>
                    {r.clientName
                      ? <a style={{ cursor: "pointer" }} onClick={() => nav(`#/client/${r.clientId}`)}>{r.clientName}</a>
                      : <span style={{ color: "var(--ink-400)", fontSize: 12 }}>משותף ({r.linkedClients} לקוחות)</span>}
                  </td>
                  <td>
                    {!r.clientId
                      ? <span style={{ fontSize: 11, color: "var(--ink-400)" }}>לא זמין ל-repo משותף</span>
                      : stInfo ? <Pill tone={stInfo.tone}>{stInfo.label}</Pill>
                      : st === "NONE" ? <span style={{ fontSize: 11, color: "var(--ink-400)" }}>לא התחיל</span>
                      : <span style={{ fontSize: 11, color: "var(--ink-400)" }}>טוען…</span>}
                  </td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-400)", direction: "ltr", textAlign: "right" }}>{r.adoRepoRef ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={4}><div className="empty">אין repositories עדיין.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { getRepos, getLatestOnboardingRun, type OnboardingStatus } from "../api.ts";
import { PageHead, Pill } from "../ui.tsx";
import { NewRepo } from "../forms.tsx";

const STATUS_HE: Record<OnboardingStatus, { label: string; tone: "inactive" | "warning" | "healthy" | "critical" | "active" | "ai" }> = {
  Pending: { label: "טרם התחיל", tone: "inactive" },
  Running: { label: "בתהליך", tone: "ai" },
  WaitingForUser: { label: "ממתין להחלטה", tone: "warning" },
  Completed: { label: "נמסר", tone: "healthy" },
  Failed: { label: "נכשל", tone: "critical" },
  Cancelled: { label: "בוטל", tone: "inactive" },
};

type RepoRow = { id: string; name: string; adoRepoRef: string | null; clientId: string | null; clientName: string | null; linkedClients: number };
type Latest = { status: OnboardingStatus } | "NONE";

/**
 * Top-level Repositories screen — every repo across every client, one
 * place to reach AI enablement from (each Client's detail page links
 * here too).
 */
export function Repositories({ nav }: { nav: (h: string) => void }) {
  const [rows, setRows] = useState<RepoRow[] | null>(null);
  const [states, setStates] = useState<Record<string, Latest>>({});
  const [modal, setModal] = useState(false);

  const reload = () => {
    getRepos().then((r) => {
      setRows(r.repos);
      for (const repo of r.repos) {
        if (!repo.clientId) continue;
        getLatestOnboardingRun(repo.id).then((v) => setStates((s) => ({ ...s, [repo.id]: v ? { status: v.status } : "NONE" }))).catch(() => {});
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
              const info = st && st !== "NONE" ? STATUS_HE[st.status] : null;
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
                      : info
                        ? <Pill tone={info.tone}>{info.label}</Pill>
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

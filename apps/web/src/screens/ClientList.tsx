import { useEffect, useState } from "react";
import { getClients, type ClientRow } from "../api.ts";
import { PageHead } from "../ui.tsx";
import { NewProject } from "../forms.tsx";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function ClientList({ nav }: { nav: (h: string) => void }) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const reload = () => getClients().then((r) => setRows(r.clients)).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); }, []);

  return (
    <>
      <PageHead title="לקוחות" sub={rows ? `${rows.length} לקוחות` : undefined} actions={<button className="btn btn-primary" onClick={() => setModal(true)}>+ לקוח חדש</button>} />
      {modal && <NewProject onClose={() => setModal(false)} onDone={() => { setModal(false); reload(); }} />}
      {err && <div className="empty">{err}</div>}
      <div className="proj-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {(rows ?? []).map((c, i) => (
          <div className="pcard" key={c.id} onClick={() => nav(`#/client/${c.id}`)} style={{ borderInlineStartColor: `var(--id-${["a", "b", "c", "d"][i % 4]})` }}>
            <div className="pc-name" style={{ fontSize: 15 }}>{c.name}</div>
            <dl>
              <div><dt>פרויקטים</dt><dd>{c.projects}</dd></div>
              <div><dt>עבודות</dt><dd>{c.workitems}</dd></div>
              <div><dt>עלות AI</dt><dd>{money(c.spent)} / {money(c.budget)}</dd></div>
            </dl>
          </div>
        ))}
        {rows && rows.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}>אין לקוחות. לחץ "+ לקוח חדש".</div>}
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { getConcepts, type Concept } from "../api.ts";

/**
 * The whole registry, fetched once per page load: a screen with thirty hints
 * makes one request, and no hint waits on a round trip of its own. A failed
 * fetch is forgotten so the next press tries again.
 */
let registry: Promise<Map<string, Concept>> | null = null;
function concepts() {
  if (!registry) {
    registry = getConcepts()
      .then((r) => new Map(r.concepts.map((c) => [c.key, c])))
      .catch((e) => { registry = null; throw e; });
  }
  return registry;
}

/**
 * The "i" next to a card, a title, a figure or a field (openspec/changes/info-hints):
 * one or two plain sentences from the concept registry — the same wording the
 * chat answers with, never a second copy. `k` is the concept's key; the shared
 * components (`PageHead`, `CardTitle`, `StatTile`) take it as their `info` prop.
 */
export function Info({ k }: { k: string }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<Concept | null | undefined>(undefined); // undefined = still loading, null = no such concept
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || c) return;
    let live = true;
    concepts().then((m) => live && setC(m.get(k) ?? null)).catch(() => live && setC(null));
    return () => { live = false; };
  }, [open, c, k]);

  useEffect(() => {
    if (!open) return;
    const outside = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    addEventListener("mousedown", outside);
    addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", outside); removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <span ref={ref} className="info-wrap" onClick={(ev) => ev.stopPropagation()}>
      <button type="button" className="info-i" aria-label="מה זה?" aria-expanded={open} onClick={() => setOpen((o) => !o)}>i</button>
      {open && (
        <span className="info-hint" role="tooltip">
          {c === undefined ? <span className="ob-sub">טוען…</span>
            : c === null ? <span className="ob-sub">אין עדיין הסבר לרכיב הזה.</span>
            : (
              <>
                <b>{c.title}</b>
                {c.explain}
                {c.press && <span className="info-press"><span>מה יקרה אם תלחצו:</span> {c.press}</span>}
                <span className="info-foot">אותו הסבר שהצ'אט עונה, בלי מודל</span>
              </>
            )}
        </span>
      )}
    </span>
  );
}

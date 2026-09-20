import { useEffect, useRef, useState } from "react";
import { getGlossary, type GlossaryEntry } from "../api.ts";

const cache = new Map<string, Promise<Record<string, GlossaryEntry>>>();
function entriesFor(screen: string) {
  let p = cache.get(screen);
  if (!p) {
    p = getGlossary(screen).then((g) => Object.fromEntries(g.entries.map((e) => [e.key, e]))).catch(() => ({}));
    cache.set(screen, p);
  }
  return p;
}

/**
 * The `?` next to a control (claude-in-dcc §4.6): the same sentence the
 * chat answers with, from the screen's glossary — one wording, never two.
 */
export function GlossaryHint({ screen, entry }: { screen: string; entry: string }) {
  const [open, setOpen] = useState(false);
  const [e, setE] = useState<GlossaryEntry | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (open && !e) entriesFor(screen).then((m) => setE(m[entry] ?? null)); }, [open, e, screen, entry]);
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span ref={ref} className="gl-wrap" onClick={(ev) => ev.stopPropagation()}>
      <button type="button" className="gl-q" aria-label="מה זה?" aria-expanded={open} onClick={() => setOpen((o) => !o)}>?</button>
      {open && (
        <span className="gl-hint" role="tooltip">
          {e ? (
            <>
              <b>{e.title}</b>
              {e.explain}
              {e.press && <span className="gl-press"><span>מה יקרה אם תלחצו:</span> {e.press}</span>}
              <span className="gl-foot">אותו הסבר שהצ'אט עונה · מהמילון של המסך, בלי מודל</span>
            </>
          ) : <span className="ob-sub">טוען…</span>}
        </span>
      )}
    </span>
  );
}

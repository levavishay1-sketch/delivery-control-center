import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getConcepts, type Concept } from "../api.ts";
import { BidiText } from "./BidiText.tsx";

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

const WIDTH = 300;      // the bubble's width
const EDGE = 8;         // the least gap kept between the bubble and the window's edge
const GAP = 6;          // between the "i" and the bubble

/**
 * The "i" next to a card, a title, a figure or a field (openspec/changes/info-hints):
 * one or two plain sentences from the concept registry — the same wording the
 * chat answers with, never a second copy. `k` is the concept's key; the shared
 * components (`PageHead`, `CardTitle`, `StatTile`) take it as their `info` prop.
 *
 * The bubble is drawn in a portal on `document.body` with fixed coordinates, not
 * inside the card that holds the "i": inside the card it sits in that card's stacking
 * context, so the next card paints over it, and any `overflow` clips it. It is placed
 * under the "i" (above it when there is no room), kept inside the window, and follows
 * the "i" while the page scrolls.
 */
export function Info({ k }: { k: string }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<Concept | null | undefined>(undefined); // undefined = still loading, null = no such concept
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || c) return;
    let live = true;
    concepts().then((m) => live && setC(m.get(k) ?? null)).catch(() => live && setC(null));
    return () => { live = false; };
  }, [open, c, k]);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(WIDTH, innerWidth - 2 * EDGE);
    const height = bubble.current?.offsetHeight ?? 0;
    const left = Math.max(EDGE, Math.min(b.left + b.width / 2 - width / 2, innerWidth - width - EDGE));
    const below = b.bottom + GAP;
    const top = below + height <= innerHeight - EDGE ? below : Math.max(EDGE, b.top - GAP - height);
    setAt({ top, left, width });
  }, []);

  // Measure once the bubble is in the DOM, before it is painted; again when its content (and so its height) changes.
  useLayoutEffect(() => { if (open) place(); else setAt(null); }, [open, c, place]);

  useEffect(() => {
    if (!open) return;
    const outside = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!btn.current?.contains(t) && !bubble.current?.contains(t)) setOpen(false);
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    addEventListener("mousedown", outside);
    addEventListener("keydown", esc);
    addEventListener("resize", place);
    addEventListener("scroll", place, true); // capture: any scrolling container, not only the window
    return () => {
      removeEventListener("mousedown", outside);
      removeEventListener("keydown", esc);
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return (
    <span className="info-wrap" onClick={(ev) => ev.stopPropagation()}>
      <button ref={btn} type="button" className="info-i" aria-label="מה זה?" aria-expanded={open} onClick={() => setOpen((o) => !o)}>i</button>
      {open && createPortal(
        <span
          ref={bubble}
          className="info-hint"
          role="tooltip"
          dir="rtl"
          style={at ? { top: at.top, left: at.left, width: at.width } : { top: 0, left: 0, width: WIDTH, visibility: "hidden" }}
          // A portal still bubbles through the React tree: a click here must not reach the card that holds the "i".
          onClick={(ev) => ev.stopPropagation()}
        >
          {c === undefined ? <span className="ob-sub">טוען…</span>
            : c === null ? <span className="ob-sub">אין עדיין הסבר לרכיב הזה.</span>
            : (
              <>
                <b><BidiText text={c.title} /></b>
                <BidiText text={c.explain} />
                {c.press && <span className="info-press"><span>מה יקרה אם תלחצו:</span> <BidiText text={c.press} /></span>}
                <span className="info-foot">אותו הסבר שהצ'אט עונה, בלי מודל</span>
              </>
            )}
        </span>,
        document.body,
      )}
    </span>
  );
}

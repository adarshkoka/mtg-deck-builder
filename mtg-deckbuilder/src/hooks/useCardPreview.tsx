import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

// Must match the `.card-pop` transition in index.css (the small zoom on hover).
export const POP_MS = 150;
// The large preview appears this long after the pop has finished, so moving the mouse
// across cards doesn't flash big images; only a deliberate pause opens one.
const PREVIEW_DELAY_MS = POP_MS + 100;

const PREVIEW_WIDTH = 300; // px; a card image is 5:7, so about 420px tall
const PREVIEW_HEIGHT = 420;
const GAP = 16; // distance from the cursor

interface Hovered {
  url: string;
  x: number;
  y: number;
}

// Shows a large, readable copy of a card image after the mouse rests on a small one.
//
// Usage:
//   const { bind, preview } = useCardPreview();
//   <img className="card-pop" src={small} {...bind(largeUrl)} />   // on any element
//   {preview}                                                      // render once
//
// The preview follows the cursor and flips to the other side near the screen edge, so it
// never covers the card you're pointing at or falls off screen.
export function useCardPreview() {
  const [shown, setShown] = useState<Hovered | null>(null);
  const pending = useRef<Hovered | null>(null); // where the mouse is while we wait
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    setShown(null);
  };

  // No timer may fire after the component is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const bind = (url: string | null | undefined) => {
    if (!url) return {};
    return {
      onMouseEnter: (e: MouseEvent) => {
        cancel();
        pending.current = { url, x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => setShown(pending.current), PREVIEW_DELAY_MS);
      },
      onMouseMove: (e: MouseEvent) => {
        const at = { url, x: e.clientX, y: e.clientY };
        pending.current = at;
        setShown((current) => (current ? at : current)); // once visible, follow the cursor
      },
      onMouseLeave: cancel,
    };
  };

  let preview = null;
  if (shown) {
    const fitsRight = shown.x + GAP + PREVIEW_WIDTH < window.innerWidth;
    const left = fitsRight ? shown.x + GAP : shown.x - GAP - PREVIEW_WIDTH;
    const top = Math.min(Math.max(8, shown.y - PREVIEW_HEIGHT / 2), window.innerHeight - PREVIEW_HEIGHT - 8);
    preview = (
      <img
        src={shown.url}
        alt=""
        className="card-img pointer-events-none fixed z-[70] shadow-2xl shadow-mahogany-900/60"
        style={{ left, top, width: PREVIEW_WIDTH }}
      />
    );
  }

  return { bind, preview };
}

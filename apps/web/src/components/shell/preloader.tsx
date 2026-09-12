"use client";

import { useEffect, useState } from "react";
import { Logo } from "./icons";

const TOTAL_MS = 1800;
const SEEN_KEY = "cw-preloaded";

/**
 * Decided once, at module scope, and cached.
 *
 * Two components need the same answer -- the overlay, and the content
 * underneath that fades in as the halves leave -- and deriving it twice
 * from sessionStorage would make the result depend on which effect ran
 * first. A cached decision cannot disagree with itself.
 */
let decision: boolean | null = null;

export function shouldPlayPreloader(): boolean {
  if (decision !== null) return decision;
  if (typeof window === "undefined") return false;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Storage throws outright in private windows and some embedded
    // previews. Playing is the safe fallback: worse than skipping,
    // far better than a blank screen.
  }

  decision = !reduced && !seen;

  if (decision) {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* it will simply play again next time */
    }
  }
  return decision;
}

/**
 * The first thing anyone sees: the mark draws itself, slides left, the
 * wordmark writes in beside it, then the panel splits and the halves
 * leave in opposite directions.
 *
 * Three things keep it from becoming an obstacle:
 *
 *  - It runs once per session. A preloader on every navigation is a toll
 *    booth, and the second time through nobody is learning the brand.
 *  - It is skipped entirely under `prefers-reduced-motion` -- a
 *    full-screen split is exactly the motion that setting exists to refuse.
 *  - The page beneath is real and interactive throughout; this is an
 *    overlay with `pointer-events: none`, not a gate. If the animation
 *    never finished, nothing would be trapped behind it.
 *
 * The lockup is rendered twice, clipped into each half, so the seam cuts
 * *through* the logo rather than sliding a whole logo out of frame.
 */
export function Preloader() {
  // Never rendered on the server: the decision needs matchMedia and
  // sessionStorage, and a panel that flashed before hydration decided to
  // skip it would be worse than no panel.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!shouldPlayPreloader()) return;
    setPlaying(true);
    const timer = window.setTimeout(() => setPlaying(false), TOTAL_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!playing) return null;

  return (
    <div className="cw-preloader" aria-hidden="true">
      <div className="cw-preloader-half" data-half="top">
        <Lockup />
        <span className="cw-preloader-seam" />
      </div>
      <div className="cw-preloader-half" data-half="bottom">
        <Lockup />
        <span className="cw-preloader-seam" />
      </div>
    </div>
  );
}

function Lockup() {
  return (
    <div className="cw-preloader-lockup">
      <span className="cw-preloader-mark">
        <Logo size={54} />
      </span>
      <span className="cw-preloader-word">Clockwork</span>
    </div>
  );
}

/** Whether the content underneath should fade in behind the split.
 *  Same cached decision, so the two can never disagree. */
export function usePreloadReveal(): boolean {
  const [reveal, setReveal] = useState(false);
  useEffect(() => setReveal(shouldPlayPreloader()), []);
  return reveal;
}

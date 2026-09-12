"use client";

import { useEffect } from "react";
import { Logo } from "./icons";

/** Matches the CSS: 1180ms of delay plus a 620ms split. */
const TOTAL_MS = 1800;

/**
 * The first thing anyone sees: the mark draws itself, slides left, the
 * wordmark writes in beside it, then the panel splits and the halves
 * leave in opposite directions, carrying the same warm/cool wash the app
 * itself sits on.
 *
 * **The markup is always rendered.** Whether it is visible is decided by
 * `data-preload` on <html>, which the inline head script sets before the
 * browser paints (see NO_FLASH_SCRIPT). The previous version switched
 * itself on from a React effect, which runs after the first paint -- so
 * the onboarding form was visible for a frame before the panel dropped
 * over it. An intro you can see the app behind is worse than none.
 *
 * React's only job here is to take the attribute away once the animation
 * has finished, so the panel stops covering a page nobody can click.
 */
export function Preloader() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.preload !== "on") return;

    const timer = window.setTimeout(() => {
      delete root.dataset.preload;
    }, TOTAL_MS);

    return () => {
      window.clearTimeout(timer);
      // If this unmounts mid-animation the panel must not be left
      // covering the app.
      delete root.dataset.preload;
    };
  }, []);

  return (
    <div className="cw-preloader" aria-hidden="true">
      <div className="cw-preloader-half" data-half="top">
        <span className="cw-preloader-wash" />
        <span className="cw-preloader-grain" />
        <Lockup />
        <span className="cw-preloader-seam" />
      </div>
      <div className="cw-preloader-half" data-half="bottom">
        <span className="cw-preloader-wash" />
        <span className="cw-preloader-grain" />
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

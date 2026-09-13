"use client";

import { useEffect } from "react";
import { Logo } from "./icons";

/**
 * When the intro is over, counted from the start of the page load, not
 * from when this component happens to mount.
 *
 * A hard backstop, enforced here rather than left to the CSS. The
 * animations are free to not run at all -- browsers suspend them in
 * background tabs and under power-saving throttles -- and the intro used
 * to rely on them, which is how a visitor ended up staring at the logo
 * with the form hidden beneath it.
 *
 * Normally the intro ends earlier, the moment the slide-out animation
 * reports finishing (about 5s after first paint). This only fires when
 * that never happens. It sits a little past 5s rather than on it because
 * animations start at first paint, which on a real network lands a few
 * hundred milliseconds after the page's clock starts -- cutting at 5.0s
 * would chop the end off a slide that was running perfectly well.
 *
 * Keep in step with the preloader timeline in globals.css.
 */
const INTRO_ENDS_AT_MS = 6500;

/**
 * The first thing anyone sees: the mark travels in from the left, the
 * wordmark travels in from the right to meet it, the finished lockup
 * holds, and then the whole panel lifts away as one piece.
 *
 * **It does not split.** It used to tear down the middle, and two halves
 * sliding apart always leave an edge where they meet -- an edge in the
 * middle of a brand moment reads as damage no matter how it is drawn.
 *
 * **The markup is always rendered.** Whether it is visible is decided by
 * `data-preload` on <html>, set by the inline head script before the
 * browser paints (see NO_FLASH_SCRIPT). An earlier version switched
 * itself on from a React effect, which runs after the first paint -- so
 * the form was visible for a frame before the panel dropped over it.
 *
 * **The deadline is JavaScript's, the motion is CSS's.** See
 * INTRO_ENDS_AT_MS for why the exit no longer waits on an animation.
 */
export function Preloader() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.preload !== "on") return;

    const finish = () => {
      delete root.dataset.preload;
    };

    // The normal ending. `animationend` bubbles, so this also hears the
    // mark and wordmark finishing; match the exit by name. Listening on
    // the document rather than the panel means a panel node swapped out
    // by a re-render still gets heard.
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName === "cw-preloader-out") finish();
    };
    document.addEventListener("animationend", onEnd);

    // The backstop. Measured against the page's own clock, so a slow
    // script download does not push it back.
    const remaining = Math.max(0, INTRO_ENDS_AT_MS - performance.now());
    window.setTimeout(finish, remaining);

    // Hidden mid-intro: the animation stops advancing, so coming back to
    // the tab would show the logo frozen where it was left. End it now,
    // and the app is simply there on return.
    const onHide = () => {
      if (document.visibilityState === "hidden") finish();
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      document.removeEventListener("animationend", onEnd);
      document.removeEventListener("visibilitychange", onHide);
      // Neither the attribute nor the timer is cleared here. React
      // StrictMode runs effects mount -> cleanup -> mount in development,
      // so clearing the attribute wiped it before the intro ever played;
      // and a timer cancelled on cleanup is a deadline that disappears on
      // any remount. `finish` only deletes an attribute, so a stale timer
      // running later is harmless.
    };
  }, []);

  return (
    <div className="cw-preloader" aria-hidden="true">
      <span className="cw-preloader-wash" />
      <span className="cw-preloader-grain" />
      <div className="cw-preloader-lockup">
        <span className="cw-preloader-mark">
          <Logo size={54} />
        </span>
        <span className="cw-preloader-word">Clockwork</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { Logo } from "./icons";

/**
 * Only a safety net. The panel normally goes when its own exit animation
 * ends, so the CSS owns the timing on its own. This exists purely so a
 * browser that never fires `animationend` -- a backgrounded tab, a
 * cancelled animation -- cannot leave a full-screen panel sitting over
 * the app forever.
 */
const FALLBACK_MS = 9000;

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
 * **The CSS owns the timing.** This waits for the exit animation to end
 * rather than counting the same milliseconds a second time in
 * JavaScript. Two hardcoded timings in two files is a bug waiting to
 * happen, and it duly happened: retiming the animation left a
 * `setTimeout` behind that tore the panel away while it was still
 * opening.
 */
export function Preloader() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.preload !== "on") return;

    const finish = () => {
      delete root.dataset.preload;
    };

    // `animationend` BUBBLES, so a listener on the panel also hears the
    // mark and the wordmark finishing inside it -- and a plain
    // `{ once: true }` handler fired on the first of those, tearing the
    // panel away a beat after the logo appeared. Match the exit by name.
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName === "cw-preloader-out") finish();
    };

    const panel = document.querySelector<HTMLElement>(".cw-preloader");
    panel?.addEventListener("animationend", onEnd);
    const fallback = window.setTimeout(finish, FALLBACK_MS);

    return () => {
      panel?.removeEventListener("animationend", onEnd);
      window.clearTimeout(fallback);
      // Deliberately NOT clearing the attribute here. React StrictMode
      // runs effects mount -> cleanup -> mount in development, so doing
      // so wiped `data-preload` milliseconds after the first mount and
      // the intro never played at all. Nothing needs it anyway: the
      // panel is this component's own markup, so unmounting removes it
      // from the page, and the fallback above guarantees the attribute
      // goes even if the animation never reports finishing.
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

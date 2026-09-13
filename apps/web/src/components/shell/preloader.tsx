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

    // `animationend` BUBBLES, so a listener also hears the mark and the
    // wordmark finishing -- and a plain `{ once: true }` handler fired on
    // the first of those, tearing the panel away a beat after the logo
    // appeared. Match the exit by name.
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName === "cw-preloader-out") finish();
    };

    // On the document, not on the panel node. A navigation followed by
    // `router.refresh()` can swap that node out mid-animation: the old
    // one's animation is cancelled and never reports ending, and a
    // listener bound to it waits forever on an element no longer on the
    // page. The document outlives every node, and bubbling brings the
    // replacement's event to it.
    document.addEventListener("animationend", onEnd);
    window.setTimeout(finish, FALLBACK_MS);

    return () => {
      document.removeEventListener("animationend", onEnd);
      // Neither the attribute NOR the fallback timer is cleared here.
      //
      // The attribute: React StrictMode runs effects mount -> cleanup ->
      // mount in development, so clearing it wiped `data-preload`
      // milliseconds after the first mount and the intro never played.
      //
      // The timer: it used to be cancelled here, which made it a safety
      // net that disappeared at exactly the moment it was needed. Any
      // remount mid-intro cancelled it, and if the animation was also
      // cancelled, nothing was left to lift a full-screen panel off the
      // page -- which is how onboarding froze behind the logo. `finish`
      // only deletes an attribute, so letting a stale timer run is
      // harmless, and now the panel is gone within nine seconds no matter
      // what happened to the component in between.
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

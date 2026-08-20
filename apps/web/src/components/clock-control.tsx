"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

/** The demo unlock, in the UI: advance the virtual clock and watch
 * whatever's due (a follow-up nudge, eventually an overdue invoice
 * chase) fire for real -- no curl required. See apps/agent's clock.py
 * and scheduler.py for the mechanism this is driving. */
export function ClockControl() {
  const [now, setNow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastFired, setLastFired] = useState<number | null>(null);

  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }, []);

  const refresh = useCallback(() => {
    getToken()
      .then((token) => api.clock(token))
      .then((res) => setNow(res.now))
      .catch(() => {});
  }, [getToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function advance(days: number) {
    setBusy(true);
    try {
      const token = await getToken();
      const res = await api.advanceClock(token, days);
      setNow(res.now);
      setLastFired(res.fired.length);
    } catch {
      /* surfaced implicitly -- `now` just won't move */
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const token = await getToken();
      const res = await api.resetClock(token);
      setNow(res.now);
      setLastFired(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
      <span className="text-zinc-500 dark:text-zinc-400">
        {now ? formatDateTime(now) : "…"}
      </span>
      <button
        disabled={busy}
        onClick={() => advance(3)}
        title="Advance the virtual clock 3 days and run anything that becomes due"
        className="rounded border border-zinc-300 px-1.5 py-0.5 font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        +3d
      </button>
      <button
        disabled={busy}
        onClick={() => advance(7)}
        title="Advance the virtual clock 7 days and run anything that becomes due"
        className="rounded border border-zinc-300 px-1.5 py-0.5 font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        +7d
      </button>
      <button
        disabled={busy}
        onClick={reset}
        title="Reset the virtual clock back to real time"
        className="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        reset
      </button>
      {lastFired !== null && (
        <span className="text-emerald-600 dark:text-emerald-400">
          {lastFired === 0 ? "nothing due" : `${lastFired} task${lastFired === 1 ? "" : "s"} fired`}
        </span>
      )}
    </div>
  );
}

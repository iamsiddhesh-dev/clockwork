"use client";

import { useCallback, useMemo, useState } from "react";
import { api, type Opportunity, type Source } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

function fitStyle(score: number | null) {
  if (score === null) return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  if (score >= 70) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (score >= 40) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
}

const SOURCE_LABEL: Record<string, string> = {
  hacker_news: "Hacker News",
  remotive: "Remotive",
  remoteok: "RemoteOK",
};

export function OpportunityList({
  initial,
  sources,
  hasProfile,
}: {
  initial: Opportunity[];
  sources: Source[];
  hasProfile: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<null | "sync" | "score">(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }, [supabase]);

  const sourceKind = useCallback(
    (id: string | null) => sources.find((s) => s.id === id)?.kind ?? "",
    [sources],
  );

  const refresh = useCallback(async () => {
    const token = await getToken();
    setItems(await api.listOpportunities(token));
  }, [getToken]);

  async function handleSync() {
    setBusy("sync");
    setError(null);
    setNote(null);
    try {
      const token = await getToken();
      const report = await api.syncOpportunities(token);
      // Report per-source rather than a bare total: a feed that errored
      // otherwise looks identical to a feed with nothing new.
      const parts = report.sources.map((s) =>
        s.ok ? `${SOURCE_LABEL[s.kind] ?? s.kind}: ${s.fetched}` : `${SOURCE_LABEL[s.kind] ?? s.kind}: failed`,
      );
      setNote(`Fetched ${report.total} — ${parts.join(" · ")}`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleScore() {
    setBusy("score");
    setError(null);
    setNote(null);
    try {
      const token = await getToken();
      const res = await api.scoreOpportunities(token, 10);
      setNote(
        res.failed > 0
          ? `Scored ${res.scored}, ${res.failed} failed (usually a rate limit — try again).`
          : `Scored ${res.scored}.`,
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss(id: string) {
    setItems((prev) => prev.filter((o) => o.id !== id));
    try {
      const token = await getToken();
      await api.dismissOpportunity(token, id);
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    }
  }

  const visible = items.filter((o) => o.status !== "dismissed");
  const unscored = visible.filter((o) => o.fit_score === null).length;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSync}
          disabled={busy !== null}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy === "sync" ? "Fetching..." : "Fetch leads"}
        </button>
        <button
          onClick={handleScore}
          disabled={busy !== null || !hasProfile || unscored === 0}
          title={
            !hasProfile
              ? "Fill in your profile first — scoring compares postings against it"
              : unscored === 0
                ? "Nothing left to score"
                : undefined
          }
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-40 dark:border-zinc-700"
        >
          {busy === "score" ? "Scoring..." : `Score fit${unscored ? ` (${unscored} left)` : ""}`}
        </button>
        {note && <span className="text-xs text-zinc-500 dark:text-zinc-400">{note}</span>}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>

      {!hasProfile && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          You haven&rsquo;t filled in your <a href="/profile" className="underline">profile</a> yet.
          Fetching leads works, but fit scoring can&rsquo;t run &mdash; there&rsquo;s nothing to
          measure a posting against.
        </p>
      )}

      {visible.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No opportunities yet. Hit <strong>Fetch leads</strong> to pull from Hacker News,
          Remotive and RemoteOK.
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {visible.map((o) => {
            const evidence = o.fit_evidence?.evidence ?? [];
            const concerns = o.fit_evidence?.concerns ?? [];
            return (
              <li
                key={o.id}
                className="rounded-lg border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{o.title ?? "Untitled"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {SOURCE_LABEL[sourceKind(o.source_id)] ?? "Unknown source"}
                      {o.author && <> · {o.author}</>}
                      {o.posted_at && <> · {formatDate(o.posted_at)}</>}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${fitStyle(o.fit_score)}`}
                  >
                    {o.fit_score === null ? "unscored" : `fit ${o.fit_score}`}
                  </span>
                </div>

                {o.fit_rationale && (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{o.fit_rationale}</p>
                )}

                {(evidence.length > 0 || concerns.length > 0) && (
                  <div className="mt-2 flex flex-col gap-1 text-xs">
                    {evidence.map((e, i) => (
                      <p key={`e${i}`} className="text-emerald-700 dark:text-emerald-400">
                        + {e}
                      </p>
                    ))}
                    {concerns.map((c, i) => (
                      <p key={`c${i}`} className="text-zinc-500 dark:text-zinc-500">
                        − {c}
                      </p>
                    ))}
                  </div>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                    Show posting
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-950">
                    {o.body}
                  </pre>
                </details>

                <div className="mt-3 flex items-center gap-3 text-xs">
                  {o.url && (
                    // RemoteOK's licence requires attribution wherever its
                    // results are shown -- this link is that, not decoration.
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-zinc-600 dark:text-zinc-400"
                    >
                      View original
                    </a>
                  )}
                  <button
                    onClick={() => handleDismiss(o.id)}
                    className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

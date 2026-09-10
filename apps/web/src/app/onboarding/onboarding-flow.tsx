"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type KickoffResult, type Profile } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { ProfileForm } from "@/app/profile/profile-form";

type Stage = "profile" | "working" | "done" | "error";

const SOURCE_LABEL: Record<string, string> = {
  hacker_news: "Hacker News",
  remotive: "Remotive",
  remoteok: "RemoteOK",
};

/**
 * First run: tell it who you are, and it goes to work.
 *
 * Deliberately one continuous flow rather than "save your profile" then
 * "now go find the Opportunities tab and press two buttons". The product
 * claim is an agent that does the work; a first run that ends in real
 * outreach waiting for approval demonstrates that, a settings page does
 * not.
 */
export function OnboardingFlow({ initial }: { initial: Profile | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("profile");
  const [result, setResult] = useState<KickoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }, [supabase]);

  const handleSaved = useCallback(async () => {
    setStage("working");
    setError(null);
    try {
      const token = await getToken();
      setResult(await api.kickoff(token, 10, 1));
      setStage("done");
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    }
  }, [getToken]);

  if (stage === "profile") {
    return (
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Step 1 of 2
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tell Clockwork who you are</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          This is the only setup there is. Everything after it &mdash; which leads are worth your
          time, what the outreach says, whose voice it&rsquo;s in &mdash; is grounded in what you
          put here. The portfolio matters most: pitches quote it by name.
        </p>
        <ProfileForm
          initial={initial}
          submitLabel="Save and find me work"
          onSaved={handleSaved}
        />
      </div>
    );
  }

  if (stage === "working") {
    return (
      <div className="py-16 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Step 2 of 2
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Going to work…</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          Pulling live postings from Hacker News, Remotive and RemoteOK, scoring each one against
          your profile, and drafting outreach for anything genuinely worth your time. Takes about a
          minute.
        </p>
        <div className="mx-auto mt-6 h-1 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-zinc-900 dark:bg-zinc-100" />
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile saved</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-red-600 dark:text-red-400">
          But sourcing didn&rsquo;t finish: {error}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          Nothing is lost &mdash; you can run it again from the Opportunities screen.
        </p>
        <button
          onClick={() => router.push("/opportunities")}
          className="mt-6 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Go to Opportunities
        </button>
      </div>
    );
  }

  // done
  const sourced = result?.sourced.total ?? 0;
  const scored = result?.scored.scored ?? 0;
  const pitched = result?.pitched.length ?? 0;
  const perSource = (result?.sourced.sources ?? [])
    .filter((s) => s.ok)
    .map((s) => `${SOURCE_LABEL[s.kind] ?? s.kind} ${s.fetched}`)
    .join(" · ");

  return (
    <div className="py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Done. Here&rsquo;s what happened.</h1>

      <ul className="mt-6 flex flex-col gap-3">
        <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="font-medium">Sourced {sourced} live postings</p>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{perSource}</p>
        </li>
        <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="font-medium">Scored {scored} against your profile</p>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Each one ranked 0&ndash;100 with a reason and the evidence from your own portfolio.
          </p>
        </li>
        <li
          className={`rounded-lg border p-4 ${
            pitched > 0
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          {pitched > 0 ? (
            <>
              <p className="font-medium">
                Drafted {pitched} pitch{pitched === 1 ? "" : "es"} &mdash; waiting for your approval
              </p>
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                Nothing was sent. Read it, edit it, then approve or reject.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">No pitch drafted yet</p>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                Nothing in this batch scored high enough to be worth your time. That&rsquo;s
                deliberate &mdash; writing outreach for a weak match is the spam this replaces.
                Score more from the Opportunities screen.
              </p>
            </>
          )}
        </li>
      </ul>

      <div className="mt-6 flex gap-3">
        {pitched > 0 && (
          <button
            onClick={() => router.push("/approvals")}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Review the pitch
          </button>
        )}
        <button
          onClick={() => router.push("/opportunities")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            pitched > 0
              ? "border border-zinc-300 dark:border-zinc-700"
              : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          }`}
        >
          See all {sourced} leads
        </button>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { api, type PortfolioItem, type Profile } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const EMPTY: Omit<Profile, "id" | "user_id"> = {
  name: "",
  skills: [],
  rates: { hourly: undefined, currency: "USD" },
  positioning: null,
  voice_samples: [],
  portfolio: [],
  payment_terms: null,
};

const label = "block text-sm font-medium";
const hint = "mt-1 text-xs text-zinc-500 dark:text-zinc-400";
const field =
  "mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function ProfileForm({
  initial,
  submitLabel = "Save profile",
  onSaved,
}: {
  initial: Profile | null;
  /** Onboarding reuses this form but continues into sourcing, so the
   * button says what happens next rather than "Save". */
  submitLabel?: string;
  /** When given, the caller owns what happens after a successful save
   * (onboarding kicks off sourcing); the inline "Saved." confirmation is
   * suppressed so the two don't contradict each other. */
  onSaved?: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<Omit<Profile, "id" | "user_id">>(() =>
    initial ? { ...EMPTY, ...initial } : EMPTY,
  );
  const [skillsText, setSkillsText] = useState((initial?.skills ?? []).join(", "));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }, [supabase]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus("idle");
  }

  function updatePortfolio(i: number, patch: Partial<PortfolioItem>) {
    setForm((f) => ({
      ...f,
      portfolio: f.portfolio.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    }));
    setStatus("idle");
  }

  function updateVoiceSample(i: number, value: string) {
    setForm((f) => ({
      ...f,
      voice_samples: f.voice_samples.map((v, idx) => (idx === i ? value : v)),
    }));
    setStatus("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const token = await getToken();
      // Skills are edited as one comma-separated line -- friendlier than a
      // tag widget for the handful of entries this realistically holds.
      const skills = skillsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Drop blank rows rather than persisting empty portfolio/voice
      // entries the agent would then try to ground itself in.
      const portfolio = form.portfolio.filter((p) => p.title.trim() || p.summary.trim());
      const voice_samples = form.voice_samples.filter((v) => v.trim());

      const saved = await api.saveProfile(token, { ...form, skills, portfolio, voice_samples });
      setForm({ ...EMPTY, ...saved });
      setSkillsText((saved.skills ?? []).join(", "));
      if (onSaved) {
        onSaved(saved);
        return; // caller drives the next step and its own status display
      }
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
      <div>
        <label className={label} htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          required
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder="Jordan Rivera"
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="skills">
          Skills
        </label>
        <p className={hint}>Comma separated. Fit scoring matches sourced work against these.</p>
        <input
          id="skills"
          value={skillsText}
          onChange={(e) => {
            setSkillsText(e.target.value);
            setStatus("idle");
          }}
          placeholder="React, Node.js, Stripe, Postgres, TypeScript"
          className={field}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="hourly">
            Hourly rate
          </label>
          <input
            id="hourly"
            type="number"
            min={0}
            value={form.rates.hourly ?? ""}
            onChange={(e) =>
              setField("rates", {
                ...form.rates,
                hourly: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            placeholder="95"
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="currency">
            Currency
          </label>
          <input
            id="currency"
            value={(form.rates.currency as string) ?? ""}
            onChange={(e) => setField("rates", { ...form.rates, currency: e.target.value })}
            placeholder="USD"
            className={field}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="positioning">
          Positioning
        </label>
        <p className={hint}>One or two sentences on what you do and who for.</p>
        <textarea
          id="positioning"
          rows={3}
          value={form.positioning ?? ""}
          onChange={(e) => setField("positioning", e.target.value || null)}
          placeholder="Freelance full-stack engineer specializing in payments and subscription billing for SaaS products."
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="terms">
          Payment terms
        </label>
        <input
          id="terms"
          value={form.payment_terms ?? ""}
          onChange={(e) => setField("payment_terms", e.target.value || null)}
          placeholder="50% upfront, 50% on delivery. Net 14 on invoices."
          className={field}
        />
      </div>

      {/* Portfolio -- what pitches cite as evidence. */}
      <div>
        <div className="flex items-center justify-between">
          <span className={label}>Portfolio</span>
          <button
            type="button"
            onClick={() =>
              setField("portfolio", [...form.portfolio, { title: "", summary: "", tags: [] }])
            }
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Add case study
          </button>
        </div>
        <p className={hint}>
          Pitches cite these as evidence. Concrete results (&ldquo;cut churn 40%&rdquo;) work far
          better than adjectives.
        </p>

        {form.portfolio.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No case studies yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {form.portfolio.map((item, i) => (
              <div
                key={i}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex gap-2">
                  <input
                    value={item.title}
                    onChange={(e) => updatePortfolio(i, { title: e.target.value })}
                    placeholder="Stripe subscription migration for a B2B SaaS"
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setField(
                        "portfolio",
                        form.portfolio.filter((_, idx) => idx !== i),
                      )
                    }
                    className="shrink-0 rounded-md border border-zinc-300 px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={item.summary}
                  onChange={(e) => updatePortfolio(i, { summary: e.target.value })}
                  placeholder="Migrated a legacy invoicing flow to Stripe Billing with usage-based tiers, cutting failed-payment churn by 40%."
                  className={field}
                />
                <input
                  value={(item.tags ?? []).join(", ")}
                  onChange={(e) =>
                    updatePortfolio(i, {
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Tags: Stripe, subscriptions, SaaS"
                  className={field}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Voice samples -- how drafted messages learn to sound like you. */}
      <div>
        <div className="flex items-center justify-between">
          <span className={label}>Voice samples</span>
          <button
            type="button"
            onClick={() => setField("voice_samples", [...form.voice_samples, ""])}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Add sample
          </button>
        </div>
        <p className={hint}>
          Paste a couple of messages you&rsquo;ve actually sent clients. Every draft is written to
          match this tone.
        </p>

        {form.voice_samples.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No samples yet &mdash; drafts will use a neutral professional tone.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {form.voice_samples.map((sample, i) => (
              <div key={i} className="flex gap-2">
                <textarea
                  rows={2}
                  value={sample}
                  onChange={(e) => updateVoiceSample(i, e.target.value)}
                  placeholder="Thanks for reaching out! Happy to take a look -- could you share a bit more about your current billing setup and timeline?"
                  className="mt-0 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={() =>
                    setField(
                      "voice_samples",
                      form.voice_samples.filter((_, idx) => idx !== i),
                    )
                  }
                  className="shrink-0 rounded-md border border-zinc-300 px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {status === "saving" ? "Saving..." : submitLabel}
        </button>
        {status === "saved" && !onSaved && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    </form>
  );
}

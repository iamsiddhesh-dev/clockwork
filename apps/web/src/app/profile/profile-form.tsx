"use client";

import { useMemo, useState } from "react";
import { api, type PortfolioItem, type Profile } from "@/lib/api";
import { ensureAccount } from "@/lib/account";

export type ProfileDraft = Omit<Profile, "id" | "user_id">;

const EMPTY: ProfileDraft = {
  name: "",
  email: null,
  skills: [],
  rates: { hourly: undefined, currency: "USD" },
  positioning: null,
  voice_samples: [],
  portfolio: [],
  payment_terms: "Net 14",
};

/**
 * The three things onboarding asks for, in the order they make sense to
 * a person: who you are, what you charge, and what you have already
 * done.
 *
 * Every field here is load-bearing, which is why the form refuses to
 * continue without them rather than saving a half-profile that produces
 * confident nonsense downstream:
 *   - rate      -> draft_quote prices off it. No rate means invented numbers.
 *   - portfolio -> draft_pitch quotes a result verbatim. No portfolio
 *                  means generic filler, which is the spam this replaces.
 *   - skills    -> score_fit ranks postings against them.
 * Email is contact data, not a credential -- nothing signs in with it.
 */
export const STEPS = [
  { key: "you", label: "You", blurb: "Who the work comes from." },
  { key: "work", label: "Work", blurb: "What you do and what it costs." },
  { key: "proof", label: "Proof", blurb: "The results your pitches will cite." },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
        {label}
        {required ? <span style={{ color: "var(--orange-ink)" }}> *</span> : null}
      </span>
      {hint ? (
        <span
          style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--quiet)", lineHeight: 1.5 }}
        >
          {hint}
        </span>
      ) : null}
      <span style={{ display: "block", marginTop: 8 }}>{children}</span>
    </label>
  );
}

export function stepErrors(form: ProfileDraft, skillsText: string): Record<StepKey, string | null> {
  const skills = skillsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hourly = Number(form.rates?.hourly);
  const usable = form.portfolio.filter((p) => p.title.trim() && p.summary.trim());

  return {
    you: !form.name.trim()
      ? "Your name is what outbound work is signed with."
      : !form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())
        ? "A real email address -- it is where a reply would land."
        : null,
    work: skills.length === 0
      ? "At least one skill, or there is nothing to score postings against."
      : !hourly || hourly <= 0
        ? "A rate above zero. Quotes are priced off this, in code."
        : null,
    proof: usable.length === 0
      ? "At least one result, with a title and a sentence describing it."
      : null,
  };
}

export function ProfileFields({
  form,
  setForm,
  skillsText,
  setSkillsText,
  only,
}: {
  form: ProfileDraft;
  setForm: (next: ProfileDraft) => void;
  skillsText: string;
  setSkillsText: (next: string) => void;
  /** Render one step's fields (onboarding) or all of them (settings). */
  only?: StepKey;
}) {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setForm({ ...form, [key]: value });

  const show = (step: StepKey) => !only || only === step;

  const updatePortfolio = (index: number, patch: Partial<PortfolioItem>) =>
    set(
      "portfolio",
      form.portfolio.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {show("you") && (
        <>
          <Field label="Name" required hint="Signed at the bottom of every pitch, quote and reminder.">
            <input
              className="cw-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Maya Okonkwo"
              autoComplete="name"
            />
          </Field>

          <Field
            label="Email"
            required
            hint="Contact data, not a login. It is the address a client would reply to."
          >
            <input
              className="cw-input"
              type="email"
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
              placeholder="maya@example.com"
              autoComplete="email"
            />
          </Field>

          <Field
            label="Positioning"
            hint="One line on what you are for. Sharpens which postings score well."
          >
            <input
              className="cw-input"
              value={form.positioning ?? ""}
              onChange={(e) => set("positioning", e.target.value)}
              placeholder="Payments and billing infrastructure for B2B SaaS"
            />
          </Field>
        </>
      )}

      {show("work") && (
        <>
          <Field label="Skills" required hint="Comma separated. Postings are ranked against these.">
            <input
              className="cw-input"
              value={skillsText}
              onChange={(e) => {
                setSkillsText(e.target.value);
                setForm({
                  ...form,
                  skills: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
              placeholder="TypeScript, Stripe Billing, Postgres, React"
            />
          </Field>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <div style={{ flex: "1 1 180px" }}>
              <Field label="Hourly rate" required hint="Quote totals are computed from this.">
                <input
                  className="cw-input"
                  type="number"
                  min={0}
                  value={form.rates?.hourly ?? ""}
                  onChange={(e) =>
                    set("rates", {
                      ...form.rates,
                      hourly: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="95"
                />
              </Field>
            </div>
            <div style={{ flex: "0 1 120px" }}>
              <Field label="Currency">
                <input
                  className="cw-input"
                  value={String(form.rates?.currency ?? "USD")}
                  onChange={(e) => set("rates", { ...form.rates, currency: e.target.value })}
                  placeholder="USD"
                />
              </Field>
            </div>
          </div>

          <Field
            label="Payment terms"
            hint="Sets the invoice due date. Left alone, it is net 14."
          >
            <input
              className="cw-input"
              value={form.payment_terms ?? ""}
              onChange={(e) => set("payment_terms", e.target.value)}
              placeholder="Net 14"
            />
          </Field>
        </>
      )}

      {show("proof") && (
        <>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              Past results<span style={{ color: "var(--orange-ink)" }}> *</span>
            </div>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--quiet)", lineHeight: 1.5 }}>
              Pitches quote these by name. Include the number if there is one &mdash;{" "}
              <em>&ldquo;cut failed-payment churn by 40%&rdquo;</em> is what makes outreach land;
              &ldquo;built a billing system&rdquo; is not.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              {form.portfolio.map((item, index) => (
                <div key={index} className="cw-card-sm" style={{ padding: 14 }}>
                  <input
                    className="cw-input"
                    value={item.title}
                    onChange={(e) => updatePortfolio(index, { title: e.target.value })}
                    placeholder="Stripe Billing migration for a B2B SaaS"
                  />
                  <textarea
                    className="cw-input"
                    style={{ marginTop: 8, minHeight: 72, resize: "vertical" }}
                    value={item.summary}
                    onChange={(e) => updatePortfolio(index, { summary: e.target.value })}
                    placeholder="Migrated a legacy invoicing flow to Stripe Billing, cutting failed-payment churn by 40%."
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      className="cw-input"
                      value={(item.tags ?? []).join(", ")}
                      onChange={(e) =>
                        updatePortfolio(index, {
                          tags: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="tags: stripe, billing, saas"
                    />
                    <button
                      type="button"
                      className="cw-btn cw-btn-sm"
                      style={{ flex: "none" }}
                      onClick={() =>
                        set(
                          "portfolio",
                          form.portfolio.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="cw-btn cw-btn-sm"
              style={{ marginTop: 12 }}
              onClick={() =>
                set("portfolio", [...form.portfolio, { title: "", summary: "", tags: [] }])
              }
            >
              Add a result
            </button>
          </div>

          <Field
            label="How you write"
            hint="Paste one message you have actually sent. Outreach copies the tone, never the content. Optional, but it is the difference between your voice and a template."
          >
            <textarea
              className="cw-input"
              style={{ minHeight: 96, resize: "vertical" }}
              value={(form.voice_samples ?? [])[0] ?? ""}
              onChange={(e) => set("voice_samples", e.target.value ? [e.target.value] : [])}
              placeholder="Hi Sam — had a look at the repo. The retry logic is the bit I'd start with…"
            />
          </Field>
        </>
      )}
    </div>
  );
}

/** The single-form version, used by Settings. Onboarding drives
 *  `ProfileFields` itself so it can step through them. */
export function ProfileForm({
  initial,
  submitLabel = "Save profile",
  onSaved,
}: {
  initial: Profile | null;
  submitLabel?: string;
  onSaved?: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<ProfileDraft>(() =>
    initial ? { ...EMPTY, ...initial } : EMPTY,
  );
  const [skillsText, setSkillsText] = useState((initial?.skills ?? []).join(", "));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo(() => stepErrors(form, skillsText), [form, skillsText]);
  const firstError = STEPS.map((s) => errors[s.key]).find(Boolean) ?? null;

  async function save() {
    if (firstError) {
      setError(firstError);
      setStatus("error");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const account = await ensureAccount();
      const saved = await api.saveProfile(account, {
        ...form,
        portfolio: form.portfolio.filter((p) => p.title.trim() && p.summary.trim()),
      });
      setStatus("saved");
      onSaved?.(saved);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <ProfileFields
        form={form}
        setForm={setForm}
        skillsText={skillsText}
        setSkillsText={setSkillsText}
      />

      <div className="cw-row">
        <button
          className="cw-btn cw-btn-primary"
          onClick={save}
          disabled={status === "saving"}
        >
          {status === "saving" ? "Saving…" : submitLabel}
        </button>
        {status === "saved" && !onSaved && (
          <span style={{ fontSize: 13, color: "var(--ok)" }}>Saved.</span>
        )}
        {error && <span style={{ fontSize: 13, color: "var(--bad)" }}>{error}</span>}
      </div>
    </div>
  );
}

export { EMPTY as EMPTY_PROFILE };

"use client";

import { useMemo, useState } from "react";
import { api, type PortfolioItem, type Profile } from "@/lib/api";
import { ensureAccount } from "@/lib/account";

export type ProfileDraft = Omit<Profile, "id" | "user_id">;

const EMPTY: ProfileDraft = {
  name: "",
  title: null,
  email: null,
  skills: [],
  years_experience: null,
  rates: { hourly: undefined, currency: "USD" },
  min_project_budget: null,
  availability_hours: null,
  positioning: null,
  voice_samples: [],
  portfolio: [],
  payment_terms: "Net 14",
};

/**
 * What onboarding asks for, and why each answer is required or not.
 *
 * The shape follows Upwork and Freelancer.com -- name, headline, skills,
 * overview with a real minimum length, rate, availability -- because
 * those platforms have spent a decade learning which questions a
 * freelancer will actually answer and in what order. One rule is applied
 * on top of theirs: **a field is only mandatory when a tool genuinely
 * cannot work without it.**
 *
 * That rule is what keeps this form short. Upwork also collects
 * education, employment history, languages, certifications and a photo.
 * All real, all useful to a human browsing a marketplace, and not one of
 * them changes a decision Clockwork makes -- so they are not here.
 *
 * Mandatory, with the tool that breaks otherwise:
 *   name      -> every draft is signed with it
 *   email     -> the reply-to on outbound work
 *   skills    -> score_fit has nothing to rank postings against
 *   overview  -> score_fit and draft_pitch both reason from it
 *   rate      -> draft_quote computes totals from it, in code
 *   portfolio -> draft_pitch quotes a result verbatim; without one,
 *                outreach becomes the generic filler this replaces
 *
 * Everything else sharpens the work without being load-bearing, and is
 * marked as such rather than being quietly required.
 */
export const STEPS = [
  { key: "you", label: "You", blurb: "Who the work comes from." },
  { key: "expertise", label: "Expertise", blurb: "What you do, and how well." },
  { key: "terms", label: "Terms", blurb: "What you charge and what you will take." },
  { key: "proof", label: "Proof", blurb: "The results your pitches will cite." },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

/** Upwork enforces a 100-character minimum on the overview. The reason
 *  is the same here: a two-line bio produces two-line reasoning in every
 *  score and every pitch downstream. */
const MIN_OVERVIEW = 100;

function Field({
  label,
  hint,
  children,
  required,
  optional,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
        {label}
        {required ? <span style={{ color: "var(--orange-ink)" }}> *</span> : null}
        {optional ? (
          <span className="cw-mono" style={{ marginLeft: 8, fontSize: 10.5, color: "var(--quiet)" }}>
            OPTIONAL
          </span>
        ) : null}
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

export function splitSkills(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function usableportfolio(form: ProfileDraft): PortfolioItem[] {
  return form.portfolio.filter((p) => p.title.trim() && p.summary.trim());
}

export function stepErrors(form: ProfileDraft, skillsText: string): Record<StepKey, string | null> {
  const skills = splitSkills(skillsText);
  const hourly = Number(form.rates?.hourly);
  const overview = (form.positioning ?? "").trim();

  return {
    you: !form.name.trim()
      ? "Your name — every pitch, quote and reminder is signed with it."
      : !form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())
        ? "A real email address. It is the reply-to on outbound work, not a login."
        : null,

    expertise:
      skills.length === 0
        ? "At least one skill, or there is nothing to rank postings against."
        : overview.length < MIN_OVERVIEW
          ? `${MIN_OVERVIEW - overview.length} more characters of overview. Scoring and pitches both reason from it, so a one-liner produces one-line reasoning.`
          : null,

    terms:
      !hourly || hourly <= 0
        ? "A rate above zero. Quote totals are computed from it, in code."
        : null,

    proof:
      usableportfolio(form).length === 0
        ? "At least one result, with a title and a sentence describing it."
        : null,
  };
}

/** How complete the profile is, and what would improve it. Upwork shows
 *  this because it works: people fill in optional fields when they can
 *  see what the gap costs them. */
export function completeness(form: ProfileDraft, skillsText: string) {
  const skills = splitSkills(skillsText);
  const checks: { done: boolean; gain: string }[] = [
    { done: Boolean(form.title?.trim()), gain: "a headline sharpens every pitch opening" },
    { done: skills.length >= 3, gain: "three or more skills rank postings far better than one" },
    { done: Boolean(form.years_experience), gain: "years of experience catches seniority mismatches" },
    { done: Boolean(form.availability_hours), gain: "availability filters out full-time roles" },
    { done: Boolean(form.min_project_budget), gain: "a budget floor rejects underpaid work for you" },
    { done: usableportfolio(form).length >= 2, gain: "a second result gives pitches more to cite" },
    { done: (form.voice_samples ?? []).some((v) => v.trim()), gain: "a writing sample makes drafts sound like you" },
  ];
  const done = checks.filter((c) => c.done).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.gain),
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
  const currency = String(form.rates?.currency ?? "USD");
  const overviewLength = (form.positioning ?? "").trim().length;

  const updatePortfolio = (index: number, patch: Partial<PortfolioItem>) =>
    set(
      "portfolio",
      form.portfolio.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  const numberOrNull = (value: string) => (value === "" ? null : Number(value));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {show("you") && (
        <>
          <Field label="Full name" required hint="Signed at the bottom of every pitch, quote and reminder.">
            <input
              className="cw-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Maya Okonkwo"
              autoComplete="name"
            />
          </Field>

          <Field
            label="Professional title"
            optional
            hint="The headline under your name. Pitches open from it, and it is what a client reads first."
          >
            <input
              className="cw-input"
              value={form.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Backend engineer · payments and billing"
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
            label="Time zone"
            optional
            hint="Used when outreach mentions overlap with a client's working day."
          >
            <input
              className="cw-input"
              value={form.timezone ?? ""}
              onChange={(e) => set("timezone", e.target.value)}
              placeholder="Europe/Lisbon"
            />
          </Field>
        </>
      )}

      {show("expertise") && (
        <>
          <Field
            label="Skills"
            required
            hint="Comma separated. Every sourced posting is ranked against these — three to eight works far better than one."
          >
            <input
              className="cw-input"
              value={skillsText}
              onChange={(e) => {
                setSkillsText(e.target.value);
                setForm({ ...form, skills: splitSkills(e.target.value) });
              }}
              placeholder="TypeScript, Stripe Billing, Postgres, React"
            />
          </Field>

          <Field
            label="Years of experience"
            optional
            hint="Catches seniority mismatches in both directions — a lead role you would waste time on, a junior one that wastes your rate."
          >
            <input
              className="cw-input"
              type="number"
              min={0}
              max={60}
              style={{ maxWidth: 160 }}
              value={form.years_experience ?? ""}
              onChange={(e) => set("years_experience", numberOrNull(e.target.value))}
              placeholder="8"
            />
          </Field>

          <Field
            label="Overview"
            required
            hint={
              <>
                What you are for, in a short paragraph. Both scoring and pitch drafting reason from
                this, so it earns its length.{" "}
                <span
                  className="cw-mono"
                  style={{ color: overviewLength >= MIN_OVERVIEW ? "var(--ok)" : "var(--quiet)" }}
                >
                  {overviewLength}/{MIN_OVERVIEW}
                </span>
              </>
            }
          >
            <textarea
              className="cw-input"
              style={{ minHeight: 108, resize: "vertical" }}
              value={form.positioning ?? ""}
              onChange={(e) => set("positioning", e.target.value)}
              placeholder="I rebuild billing and subscription systems for B2B SaaS teams — migrations off legacy processors, dunning and retry logic, proration edge cases. Usually brought in when invoicing has grown organically and started losing money."
            />
          </Field>
        </>
      )}

      {show("terms") && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <div style={{ flex: "1 1 170px" }}>
              <Field label="Hourly rate" required hint="Quote totals are computed from this, in code.">
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
                  value={currency}
                  onChange={(e) => set("rates", { ...form.rates, currency: e.target.value })}
                  placeholder="USD"
                />
              </Field>
            </div>
          </div>

          <Field
            label="Smallest project worth taking"
            optional
            hint={`A floor, not a preference. A posting whose budget is clearly under this gets marked down — which is the one filter no job board gives you. In ${currency}.`}
          >
            <input
              className="cw-input"
              type="number"
              min={0}
              style={{ maxWidth: 200 }}
              value={form.min_project_budget ?? ""}
              onChange={(e) => set("min_project_budget", numberOrNull(e.target.value))}
              placeholder="3000"
            />
          </Field>

          <Field
            label="Hours a week available"
            optional
            hint="Catches full-time roles wearing a contract label, and keeps quoted timelines reachable at the hours you actually have."
          >
            <input
              className="cw-input"
              type="number"
              min={1}
              max={168}
              style={{ maxWidth: 160 }}
              value={form.availability_hours ?? ""}
              onChange={(e) => set("availability_hours", numberOrNull(e.target.value))}
              placeholder="25"
            />
          </Field>

          <Field label="Payment terms" optional hint="Sets the invoice due date. Left alone, it is net 14.">
            <input
              className="cw-input"
              style={{ maxWidth: 260 }}
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
                      onChange={(e) => updatePortfolio(index, { tags: splitSkills(e.target.value) })}
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
            optional
            hint="Paste one message you have actually sent. Outreach copies the tone, never the content. It is the difference between your voice and a template."
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

/** A quiet nudge listing what is still missing, without blocking on it. */
export function CompletenessBar({
  form,
  skillsText,
}: {
  form: ProfileDraft;
  skillsText: string;
}) {
  const { percent, missing } = completeness(form, skillsText);
  if (percent === 100) return null;
  return (
    <div className="cw-card-sm" style={{ padding: 16 }}>
      <div className="cw-row" style={{ gap: 10 }}>
        <span className="cw-label">Profile strength</span>
        <span className="cw-mono" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 500 }}>
          {percent}%
        </span>
      </div>
      <div
        style={{ marginTop: 10, height: 3, borderRadius: 3, background: "var(--rim)", overflow: "hidden" }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "var(--orange)",
            transition: "width var(--t)",
          }}
        />
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--quiet)" }}>
        Optional, but each one measurably improves the work: {missing.slice(0, 3).join("; ")}.
      </p>
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
        portfolio: usableportfolio(form),
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
      <CompletenessBar form={form} skillsText={skillsText} />

      <ProfileFields
        form={form}
        setForm={setForm}
        skillsText={skillsText}
        setSkillsText={setSkillsText}
      />

      <div className="cw-row">
        <button className="cw-btn cw-btn-primary" onClick={save} disabled={status === "saving"}>
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

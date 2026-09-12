"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type PortfolioItem, type Profile } from "@/lib/api";
import { ensureAccount } from "@/lib/account";
import { Combobox, Field, NumberField, TagInput, TextField, useFieldId } from "@/components/fields";
import {
  SKILL_SUGGESTIONS,
  TITLE_OPTIONS,
  currencyOptions,
  currencySymbol,
  guessTimeZone,
  timeZoneOptions,
} from "@/lib/reference";

export type ProfileDraft = Omit<Profile, "id" | "user_id">;

export const EMPTY_PROFILE: ProfileDraft = {
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
  payment_terms: "Payment due 14 days after invoice",
  timezone: null,
  links: {},
};

/** One line, enforced. The old field asked for a 100-character minimum
 *  paragraph and then accepted 523 characters against a counter that
 *  said 500 — a field that displays a limit it does not enforce is
 *  simply lying to the person filling it in. */
export const HEADLINE_MAX = 160;

export const STEPS = [
  { key: "you", label: "You" },
  { key: "work", label: "Work" },
  { key: "proof", label: "Your work" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export function stepErrors(form: ProfileDraft): Record<StepKey, string | null> {
  const headline = (form.positioning ?? "").trim();
  const links = form.links ?? {};
  const hasSource =
    Boolean(links.website?.trim() || links.github?.trim() || links.resume_text?.trim()) ||
    form.portfolio.some((p) => p.summary.trim());

  return {
    you: !form.name.trim()
      ? "Add your name."
      : !form.title?.trim()
        ? "Pick or type a title."
        : !form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())
          ? "That email doesn't look right."
          : !form.timezone?.trim()
            ? "Pick your time zone."
            : null,

    work:
      form.skills.length === 0
        ? "Add at least one skill."
        : !headline
          ? "One line on what you do."
          : headline.length > HEADLINE_MAX
            ? `${headline.length - HEADLINE_MAX} characters over.`
            : !form.rates?.hourly || Number(form.rates.hourly) <= 0
              ? "Add your rate."
              : null,

    proof: !hasSource
      ? "Add a link, paste your CV, or write one past result."
      : null,
  };
}

export function usablePortfolio(form: ProfileDraft): PortfolioItem[] {
  return form.portfolio.filter((p) => p.summary.trim());
}

/** Shown on the profile screen, not during onboarding. Nobody setting up
 *  an account wants a score; someone maintaining a profile does. */
export function completeness(form: ProfileDraft) {
  const links = form.links ?? {};
  const checks: { done: boolean; gain: string }[] = [
    { done: Boolean(form.years_experience), gain: "years of experience catches seniority mismatches" },
    { done: Boolean(form.availability_hours), gain: "hours a week filters out full-time roles" },
    { done: Boolean(form.min_project_budget), gain: "a minimum rejects underpaid work for you" },
    { done: form.skills.length >= 3, gain: "three or more skills rank leads far better than one" },
    { done: usablePortfolio(form).length >= 2, gain: "a second past result gives pitches more to cite" },
    { done: Boolean(links.github?.trim() || links.website?.trim()), gain: "a link keeps your profile current" },
  ];
  const done = checks.filter((c) => c.done).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.gain),
  };
}

// ── the fields ────────────────────────────────────────────────────────

export function ProfileFields({
  form,
  setForm,
  only,
  showErrors,
}: {
  form: ProfileDraft;
  setForm: (next: ProfileDraft) => void;
  only?: StepKey;
  showErrors?: boolean;
}) {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setForm({ ...form, [key]: value });

  const show = (step: StepKey) => !only || only === step;
  const currency = String(form.rates?.currency ?? "USD");
  const symbol = currencySymbol(currency);
  const zones = useMemo(() => timeZoneOptions(), []);
  const currencies = useMemo(() => currencyOptions(), []);

  const nameId = useFieldId("name");
  const titleId = useFieldId("title");
  const emailId = useFieldId("email");
  const zoneId = useFieldId("zone");
  const skillsId = useFieldId("skills");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {show("you") && (
        <>
          <Field label="Full name" required htmlFor={nameId}>
            <input
              id={nameId}
              className="cw-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Maya Okonkwo"
              autoComplete="name"
            />
          </Field>

          <Field label="Professional title" required htmlFor={titleId}>
            <Combobox
              id={titleId}
              value={form.title ?? ""}
              onChange={(v) => set("title", v)}
              options={TITLE_OPTIONS}
              placeholder="Backend developer"
            />
          </Field>

          <Field label="Email" required htmlFor={emailId}>
            <input
              id={emailId}
              className="cw-input"
              type="email"
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
              placeholder="maya@example.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Time zone" required htmlFor={zoneId}>
            <Combobox
              id={zoneId}
              strict
              value={form.timezone ?? ""}
              onChange={(v) => set("timezone", v)}
              options={zones}
              placeholder="Search time zones"
            />
          </Field>
        </>
      )}

      {show("work") && (
        <>
          <Field label="Skills" required hint="Leads are ranked against these." htmlFor={skillsId}>
            <TagInput
              id={skillsId}
              values={form.skills}
              onChange={(v) => set("skills", v)}
              suggestions={SKILL_SUGGESTIONS}
              placeholder="Type a skill, press Enter"
            />
          </Field>

          <Field label="What you do, in one line" required>
            <TextField
              value={form.positioning ?? ""}
              onChange={(v) => set("positioning", v)}
              maxLength={HEADLINE_MAX}
              placeholder="I rebuild billing systems for B2B SaaS teams."
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <Field label="Hourly rate" required>
              <NumberField
                value={form.rates?.hourly ?? null}
                onChange={(v) => set("rates", { ...form.rates, hourly: v ?? undefined })}
                prefix={symbol}
                suffix="/hr"
                min={0}
                placeholder="95"
              />
            </Field>

            <Field label="Currency">
              <Combobox
                strict
                value={currency}
                onChange={(v) => set("rates", { ...form.rates, currency: v })}
                options={currencies}
              />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <Field label="Years of experience">
              <NumberField
                value={form.years_experience}
                onChange={(v) => set("years_experience", v)}
                min={0}
                max={60}
                suffix="years"
                placeholder="8"
              />
            </Field>

            <Field label="Hours a week you're free">
              <NumberField
                value={form.availability_hours}
                onChange={(v) => set("availability_hours", v)}
                min={1}
                max={168}
                suffix="hrs"
                placeholder="25"
              />
            </Field>
          </div>

          <Field label="Ignore projects smaller than" hint="Leave blank to see everything.">
            <NumberField
              value={form.min_project_budget}
              onChange={(v) => set("min_project_budget", v)}
              prefix={symbol}
              min={0}
              placeholder="3000"
            />
          </Field>
        </>
      )}

      {show("proof") && <ProofFields form={form} setForm={setForm} showErrors={showErrors} />}
    </div>
  );
}

// ── step 3: read it from their own material ───────────────────────────

function ProofFields({
  form,
  setForm,
  showErrors,
}: {
  form: ProfileDraft;
  setForm: (next: ProfileDraft) => void;
  showErrors?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ read: string[]; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastingCv, setPastingCv] = useState(false);

  const links = form.links ?? {};
  const setLink = (key: string, value: string) =>
    setForm({ ...form, links: { ...links, [key]: value } });

  async function runImport() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const account = await ensureAccount();
      const result = await api.importProfile(account, {
        github: links.github ?? null,
        website: links.website ?? null,
        linkedin: links.linkedin ?? null,
        resume_text: links.resume_text ?? null,
      });
      setReport({ read: result.read, skipped: result.skipped });

      if (result.profile) {
        const p = result.profile;
        setForm({
          ...form,
          // Only fill what is still blank -- what the person typed
          // themselves always wins over what a model guessed.
          title: form.title?.trim() ? form.title : (p.title ?? form.title),
          positioning: form.positioning?.trim()
            ? form.positioning
            : (p.headline ?? form.positioning),
          skills: form.skills.length
            ? form.skills
            : p.skills.slice(0, 12),
          portfolio: [...form.portfolio, ...p.highlights.filter((h) => h.summary.trim())],
          links: { ...links },
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canImport =
    Boolean(links.github?.trim() || links.website?.trim() || links.resume_text?.trim()) && !busy;

  return (
    <>
      <Field label="Portfolio or website">
        <input
          className="cw-input"
          value={links.website ?? ""}
          onChange={(e) => setLink("website", e.target.value)}
          placeholder="maya.dev"
        />
      </Field>

      <Field label="GitHub">
        <input
          className="cw-input"
          value={links.github ?? ""}
          onChange={(e) => setLink("github", e.target.value)}
          placeholder="github.com/maya"
        />
      </Field>

      <Field label="LinkedIn" hint="Stored, not scanned.">
        <input
          className="cw-input"
          value={links.linkedin ?? ""}
          onChange={(e) => setLink("linkedin", e.target.value)}
          placeholder="linkedin.com/in/maya"
        />
      </Field>

      {pastingCv || links.resume_text ? (
        <Field label="Your CV">
          <textarea
            className="cw-input"
            style={{ minHeight: 140, resize: "vertical" }}
            value={links.resume_text ?? ""}
            onChange={(e) => setLink("resume_text", e.target.value)}
            placeholder="Paste the text of your CV."
          />
        </Field>
      ) : (
        <button type="button" className="cw-btn cw-btn-sm" onClick={() => setPastingCv(true)}>
          Paste a CV instead
        </button>
      )}

      <div className="cw-row">
        <button type="button" className="cw-btn cw-btn-primary" disabled={!canImport} onClick={runImport}>
          {busy ? "Reading…" : "Read my work"}
        </button>
        {!canImport && !busy && (
          <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>
            Add a link or paste a CV first.
          </span>
        )}
        {error && <span style={{ fontSize: 12.5, color: "var(--bad)" }}>{error}</span>}
      </div>

      {report && (
        <div className="cw-card-sm" style={{ padding: 14 }}>
          {report.read.length > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}>
              Read {report.read.join(", ")}.
            </p>
          )}
          {report.skipped.map((line) => (
            <p key={line} style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--quiet)" }}>
              {line}
            </p>
          ))}
        </div>
      )}

      <PortfolioEditor form={form} setForm={setForm} showErrors={showErrors} />
    </>
  );
}

function PortfolioEditor({
  form,
  setForm,
  showErrors,
}: {
  form: ProfileDraft;
  setForm: (next: ProfileDraft) => void;
  showErrors?: boolean;
}) {
  const update = (index: number, patch: Partial<PortfolioItem>) =>
    setForm({
      ...form,
      portfolio: form.portfolio.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });

  return (
    <div>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Past results</div>
      <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--quiet)" }}>
        Pitches quote these. Keep the numbers.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {form.portfolio.map((item, index) => (
          <div key={index} className="cw-card-sm" style={{ padding: 12 }}>
            <input
              className="cw-input"
              value={item.title}
              onChange={(e) => update(index, { title: e.target.value })}
              placeholder="Stripe Billing migration"
            />
            <textarea
              className="cw-input"
              style={{ marginTop: 8, minHeight: 62, resize: "vertical" }}
              value={item.summary}
              onChange={(e) => update(index, { summary: e.target.value })}
              placeholder="Cut failed-payment churn by 40%."
            />
            <button
              type="button"
              className="cw-btn cw-btn-sm cw-btn-quiet"
              style={{ marginTop: 6 }}
              onClick={() =>
                setForm({ ...form, portfolio: form.portfolio.filter((_, i) => i !== index) })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="cw-btn cw-btn-sm"
        style={{ marginTop: 12 }}
        onClick={() =>
          setForm({ ...form, portfolio: [...form.portfolio, { title: "", summary: "", tags: [] }] })
        }
      >
        Add one manually
      </button>

      {showErrors && form.portfolio.length === 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--quiet)" }}>
          Nothing yet. A link above is the quickest way to fill this in.
        </p>
      )}
    </div>
  );
}

// ── the single-page version, for Settings ─────────────────────────────

export function CompletenessBar({ form }: { form: ProfileDraft }) {
  const { percent, missing } = completeness(form);
  if (percent === 100) return null;
  return (
    <div className="cw-card-sm" style={{ padding: 16 }}>
      <div className="cw-row" style={{ gap: 10 }}>
        <span className="cw-label">Profile strength</span>
        <span className="cw-mono" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 500 }}>
          {percent}%
        </span>
      </div>
      <div style={{ marginTop: 10, height: 3, borderRadius: 3, background: "var(--rim)", overflow: "hidden" }}>
        <div
          style={{ height: "100%", width: `${percent}%`, background: "var(--orange)", transition: "width var(--t)" }}
        />
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--quiet)" }}>
        Each of these measurably improves the work: {missing.slice(0, 3).join("; ")}.
      </p>
    </div>
  );
}

export function ProfileForm({
  initial,
  submitLabel = "Save",
  onSaved,
}: {
  initial: Profile | null;
  submitLabel?: string;
  onSaved?: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<ProfileDraft>(() => ({
    ...EMPTY_PROFILE,
    ...(initial ?? {}),
  }));

  // After mount, not during render -- see the note in onboarding-flow.
  // The browser's zone is only knowable in the browser. Seeding it in
  // the initial state made the server render "UTC" into an input the
  // client then rendered as "Asia/Calcutta", which is the hydration
  // mismatch this effect exists to fix. The rule below is right about
  // the general case and wrong about this one: one extra render at
  // mount is the price of the markup agreeing with itself.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => (f.timezone ? f : { ...f, timezone: guessTimeZone() }));
  }, []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo(() => stepErrors(form), [form]);
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
      const saved = await api.saveProfile(account, { ...form, portfolio: usablePortfolio(form) });
      setStatus("saved");
      onSaved?.(saved);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CompletenessBar form={form} />
      <ProfileFields form={form} setForm={setForm} showErrors />

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

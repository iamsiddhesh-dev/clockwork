"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type ImportedProfileResult, type PortfolioItem, type Profile } from "@/lib/api";
import { ensureAccount } from "@/lib/account";
import { Combobox, Field, NumberField, TagInput, useFieldId } from "@/components/fields";
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

/** Most skills anyone should list. Past this, scoring stops getting any
 *  sharper and the profile starts reading like keyword stuffing. */
const MAX_SKILLS = 20;

export const STEPS = [
  { key: "you", label: "You" },
  { key: "work", label: "Work" },
  { key: "proof", label: "Your work" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

/** A GitHub handle, or any github.com link -- the importer takes the
 *  first path segment either way. */
const GITHUB = /^(@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?|(https?:\/\/)?(www\.)?github\.com\/\S+)$/i;
/** Something with a dot and no spaces. Deliberately loose: portfolios
 *  live on every kind of domain, and the importer reports what it
 *  actually managed to read. */
const WEBSITE = /^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i;

export function stepErrors(form: ProfileDraft): Record<StepKey, string | null> {
  const github = form.links?.github?.trim() ?? "";
  const website = form.links?.website?.trim() ?? "";

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
        : !form.rates?.hourly || Number(form.rates.hourly) <= 0
          ? "Add your rate."
          : null,

    // At least one, because this is where every pitch gets its evidence:
    // the agent quotes the results it reads here, and with nothing to read
    // it can only say generic things -- the spam this product replaces.
    proof: !github && !website
      ? "Add your GitHub or your portfolio link."
      : github && !GITHUB.test(github)
        ? "That GitHub link doesn't look right."
        : website && !WEBSITE.test(website)
          ? "That portfolio link doesn't look right."
          : null,
  };
}

export function usablePortfolio(form: ProfileDraft): PortfolioItem[] {
  return form.portfolio.filter((p) => p.summary.trim());
}

/**
 * Fold what the importer read into the profile.
 *
 * What the person chose themselves wins: their title stays, and their
 * skills come first. The one-line summary and past results have no
 * field of their own any more -- they are read from GitHub and the
 * portfolio, not typed -- so a fresh read replaces them rather than
 * piling duplicates onto the last one.
 */
export function mergeImported(
  form: ProfileDraft,
  imported: ImportedProfileResult["profile"],
): ProfileDraft {
  if (!imported) return form;

  const seen = new Set(form.skills.map((s) => s.toLowerCase()));
  const extraSkills = imported.skills.filter((s) => {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const highlights = imported.highlights.filter((h) => h.summary.trim());

  return {
    ...form,
    title: form.title?.trim() ? form.title : (imported.title ?? form.title),
    positioning: imported.headline?.trim() || form.positioning,
    skills: [...form.skills, ...extraSkills].slice(0, MAX_SKILLS),
    portfolio: highlights.length ? highlights : form.portfolio,
  };
}

/** Read the person's GitHub and portfolio. Never throws: a board that
 *  can't be read or a model that's rate-limited should not stop anyone
 *  finishing their profile, so a failure comes back as a note instead. */
export async function readLinks(
  account: string,
  form: ProfileDraft,
): Promise<{ form: ProfileDraft; note: string | null }> {
  const github = form.links?.github?.trim() || null;
  const website = form.links?.website?.trim() || null;
  if (!github && !website) return { form, note: null };

  try {
    const result = await api.importProfile(account, { github, website });
    const merged = mergeImported(form, result.profile);
    const found = merged.portfolio.length;
    const note = result.read.length
      ? `Read ${result.read.join(" and ")}${found ? ` · ${found} result${found === 1 ? "" : "s"} found` : ""}.`
      : result.skipped[0] ?? "Couldn't read those links.";
    return { form: merged, note };
  } catch (err) {
    return { form, note: `Couldn't read your links: ${(err as Error).message}` };
  }
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
    {
      done: Boolean(links.github?.trim() && links.website?.trim()),
      gain: "both GitHub and a portfolio give pitches more real work to cite",
    },
    {
      done: usablePortfolio(form).length > 0,
      gain: "reading your links finds the results pitches quote",
    },
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
  variant = "settings",
}: {
  form: ProfileDraft;
  setForm: (next: ProfileDraft) => void;
  only?: StepKey;
  /** Onboarding asks for what the agent cannot work without. Everything
   *  that only sharpens the results lives in Settings, marked optional. */
  variant?: "onboarding" | "settings";
}) {
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setForm({ ...form, [key]: value });

  const show = (step: StepKey) => !only || only === step;
  const inSettings = variant === "settings";
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
              max={MAX_SKILLS}
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

            <Field label="Currency" required>
              <Combobox
                strict
                value={currency}
                onChange={(v) => set("rates", { ...form.rates, currency: v })}
                options={currencies}
              />
            </Field>
          </div>

          {inSettings && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                <Field label="Years of experience" optional>
                  <NumberField
                    value={form.years_experience}
                    onChange={(v) => set("years_experience", v)}
                    min={0}
                    max={60}
                    suffix="years"
                    placeholder="8"
                  />
                </Field>

                <Field label="Hours a week you're free" optional>
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

              <Field label="Ignore projects smaller than" optional hint="Leave blank to see everything.">
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
        </>
      )}

      {show("proof") && (
        <ProofFields form={form} setForm={setForm} canRead={inSettings} />
      )}
    </div>
  );
}

// ── step 3: where their work lives ────────────────────────────────────

/**
 * No inline error here on purpose: onboarding and Settings both already
 * show the step's error beside their own button, and the same sentence
 * twice on one screen reads as two separate problems.
 */
function ProofFields({
  form,
  setForm,
  canRead,
}: {
  form: ProfileDraft;
  setForm: (next: ProfileDraft) => void;
  /** Settings offers a "read again" button. Onboarding doesn't need one:
   *  it reads the links itself when the person presses Find me work. */
  canRead: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const links = form.links ?? {};
  const setLink = (key: "github" | "website", value: string) =>
    setForm({ ...form, links: { ...links, [key]: value } });

  const githubId = useFieldId("github");
  const websiteId = useFieldId("website");

  async function readAgain() {
    setBusy(true);
    setNote(null);
    const account = await ensureAccount();
    const { form: next, note: message } = await readLinks(account, form);
    setForm(next);
    setNote(message);
    setBusy(false);
  }

  return (
    <>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--quiet)" }}>
        Add at least one<span style={{ color: "var(--orange-ink)" }}> *</span>
      </p>

      <Field label="GitHub" htmlFor={githubId}>
        <input
          id={githubId}
          className="cw-input"
          value={links.github ?? ""}
          onChange={(e) => setLink("github", e.target.value)}
          placeholder="github.com/maya"
          autoComplete="url"
        />
      </Field>

      <Field label="Portfolio" htmlFor={websiteId}>
        <input
          id={websiteId}
          className="cw-input"
          value={links.website ?? ""}
          onChange={(e) => setLink("website", e.target.value)}
          placeholder="maya.dev"
          autoComplete="url"
        />
      </Field>

      {canRead && (
        <div className="cw-row">
          <button
            type="button"
            className="cw-btn"
            disabled={busy || Boolean(stepErrors(form).proof)}
            onClick={readAgain}
          >
            {busy ? "Reading…" : "Read my work again"}
          </button>
          {note && <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{note}</span>}
        </div>
      )}
    </>
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
      <ProfileFields form={form} setForm={setForm} />

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

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type KickoffResult, type Profile } from "@/lib/api";
import { ensureAccount } from "@/lib/account";
import { Logo } from "@/components/shell/icons";
import {
  EMPTY_PROFILE,
  ProfileFields,
  STEPS,
  stepErrors,
  type ProfileDraft,
  type StepKey,
} from "@/app/profile/profile-form";

type Stage = "form" | "working" | "done" | "error";

const SOURCE_LABEL: Record<string, string> = {
  hacker_news: "Hacker News",
  remotive: "Remotive",
  remoteok: "RemoteOK",
};

/**
 * The front door.
 *
 * There is no sign-in: filling this in creates the workspace, and the
 * workspace id goes in a cookie. That is a deliberate trade -- see
 * apps/agent/src/clockwork/auth.py, which is explicit that it identifies
 * rather than authenticates.
 *
 * It runs straight into real work rather than ending on "profile saved".
 * The product claim is an agent that does the business half; a first run
 * that ends with actual outreach waiting for approval demonstrates that,
 * and a settings page does not.
 */
export function OnboardingFlow({ initial }: { initial: Profile | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("form");
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<ProfileDraft>(() =>
    initial ? { ...EMPTY_PROFILE, ...initial } : EMPTY_PROFILE,
  );
  const [skillsText, setSkillsText] = useState((initial?.skills ?? []).join(", "));
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<KickoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which half failed. "Your profile saved, sourcing didn't" is a very
  // different message from "nothing saved at all", and showing the
  // reassuring one when nothing was written would be a lie.
  const [profileSaved, setProfileSaved] = useState(false);

  const errors = useMemo(() => stepErrors(form, skillsText), [form, skillsText]);
  const step = STEPS[stepIndex];
  const stepError = errors[step.key as StepKey];
  const isLast = stepIndex === STEPS.length - 1;

  async function next() {
    if (stepError) {
      setTouched(true);
      return;
    }
    setTouched(false);
    if (!isLast) {
      setStepIndex((i) => i + 1);
      return;
    }

    setStage("working");
    setError(null);
    try {
      const account = await ensureAccount();
      await api.saveProfile(account, {
        ...form,
        portfolio: form.portfolio.filter((p) => p.title.trim() && p.summary.trim()),
      });
      setProfileSaved(true);
      setResult(await api.kickoff(account, 10, 1));
      setStage("done");
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    }
  }

  // ── the form ──────────────────────────────────────────────────────
  if (stage === "form") {
    return (
      <Frame>
        <div className="cw-row" style={{ gap: 6, marginBottom: 22 }}>
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              title={s.label}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 3,
                background: i <= stepIndex ? "var(--orange)" : "var(--rim)",
                transition: "background var(--t)",
              }}
            />
          ))}
        </div>

        <div className="cw-label">
          Step {stepIndex + 1} of {STEPS.length} · {step.label}
        </div>
        <h1 className="cw-h1" style={{ marginTop: 12 }}>
          {stepIndex === 0
            ? "Tell Clockwork who you are."
            : stepIndex === 1
              ? "What you do, and what it costs."
              : "What you have already done."}
        </h1>
        <p
          style={{
            margin: "12px 0 26px",
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "var(--dim)",
            maxWidth: "54ch",
          }}
        >
          {stepIndex === 0
            ? "This is the only setup there is. Everything after it — which leads are worth your time, what the outreach says, whose voice it is in — is grounded in what you put here."
            : stepIndex === 1
              ? "Quote totals are computed from your rate in code, never guessed by a model. Skills are what every sourced posting gets ranked against."
              : "This is the part that decides whether outreach lands. The agent cites these results by name and never invents one."}
        </p>

        <ProfileFields
          form={form}
          setForm={setForm}
          skillsText={skillsText}
          setSkillsText={setSkillsText}
          only={step.key as StepKey}
        />

        <div className="cw-row" style={{ marginTop: 28 }}>
          {stepIndex > 0 && (
            <button
              className="cw-btn"
              onClick={() => {
                setTouched(false);
                setStepIndex((i) => i - 1);
              }}
            >
              Back
            </button>
          )}
          <button className="cw-btn cw-btn-primary" onClick={next}>
            {isLast ? "Save and find me work" : "Continue"}
          </button>
          {touched && stepError && (
            <span style={{ fontSize: 13, color: "var(--bad)", flex: "1 1 100%" }}>{stepError}</span>
          )}
        </div>
      </Frame>
    );
  }

  // ── working ───────────────────────────────────────────────────────
  if (stage === "working") {
    return (
      <Frame>
        <div className="cw-label">Going to work</div>
        <h1 className="cw-h1" style={{ marginTop: 12 }}>
          Reading the boards now.
        </h1>
        <p
          style={{
            margin: "14px 0 0",
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "var(--dim)",
            maxWidth: "52ch",
          }}
        >
          Pulling live postings from Hacker News, Remotive and RemoteOK, scoring each one against
          what you just wrote, and drafting outreach for anything genuinely worth your time. About a
          minute.
        </p>
        <div
          style={{
            marginTop: 28,
            height: 3,
            width: "100%",
            maxWidth: 280,
            borderRadius: 3,
            background: "var(--rim)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "38%",
              borderRadius: 3,
              background: "var(--orange)",
              animation: "cw-pulse 1.6s ease-in-out infinite",
            }}
          />
        </div>
      </Frame>
    );
  }

  // ── error ─────────────────────────────────────────────────────────
  if (stage === "error") {
    return (
      <Frame>
        <div className="cw-label">{profileSaved ? "Partly done" : "Didn’t save"}</div>
        <h1 className="cw-h1" style={{ marginTop: 12 }}>
          {profileSaved ? "Your profile saved." : "That didn’t go through."}
        </h1>
        <p style={{ margin: "14px 0 0", fontSize: 14.5, color: "var(--bad)", maxWidth: "52ch" }}>
          {profileSaved ? "Sourcing didn’t finish: " : ""}
          {error}
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--dim)", maxWidth: "52ch" }}>
          {profileSaved
            ? "Nothing is lost — you can run it again from the Opportunities screen."
            : "Nothing was written. Check the agent API is running, then try again — what you typed is still here."}
        </p>
        <div className="cw-row" style={{ marginTop: 26 }}>
          {profileSaved ? (
            <button className="cw-btn cw-btn-primary" onClick={() => router.push("/opportunities")}>
              Go to Opportunities
            </button>
          ) : (
            <button className="cw-btn cw-btn-primary" onClick={() => setStage("form")}>
              Back to the form
            </button>
          )}
        </div>
      </Frame>
    );
  }

  // ── done ──────────────────────────────────────────────────────────
  const sourced = result?.sourced.total ?? 0;
  const scored = result?.scored.scored ?? 0;
  const pitched = result?.pitched.length ?? 0;
  const perSource = (result?.sourced.sources ?? [])
    .filter((s) => s.ok)
    .map((s) => `${SOURCE_LABEL[s.kind] ?? s.kind} ${s.fetched}`)
    .join(" · ");

  return (
    <Frame>
      <div className="cw-label">First run complete</div>
      <h1 className="cw-h1" style={{ marginTop: 12 }}>
        Here&rsquo;s what it did.
      </h1>

      <ul style={{ listStyle: "none", margin: "26px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <Outcome title={`Sourced ${sourced} live postings`} note={perSource || "three public feeds"} />
        <Outcome
          title={`Scored ${scored} against your profile`}
          note="Each ranked 0–100 with a reason and the evidence from your own portfolio."
        />
        <Outcome
          highlight={pitched > 0}
          title={
            pitched > 0
              ? `Drafted ${pitched} pitch${pitched === 1 ? "" : "es"} — waiting for you`
              : "No pitch drafted yet"
          }
          note={
            pitched > 0
              ? "Nothing was sent. Read it, edit it, then approve or reject."
              : "Nothing in this batch cleared the bar. That is deliberate — writing outreach for a weak match is the spam this replaces."
          }
        />
      </ul>

      <div className="cw-row" style={{ marginTop: 26 }}>
        {pitched > 0 && (
          <button className="cw-btn cw-btn-primary" onClick={() => router.push("/approvals")}>
            Review the pitch
          </button>
        )}
        <button
          className={`cw-btn ${pitched > 0 ? "" : "cw-btn-primary"}`}
          onClick={() => router.push("/overview")}
        >
          Go to the dashboard
        </button>
      </div>
    </Frame>
  );
}

function Outcome({
  title,
  note,
  highlight,
}: {
  title: string;
  note: string;
  highlight?: boolean;
}) {
  return (
    <li
      className="cw-card-sm"
      style={{
        padding: 16,
        borderColor: highlight ? "var(--orange-bd)" : "var(--rim)",
        background: highlight ? "var(--orange-bg)" : "var(--glass)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</p>
      <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--dim)" }}>{note}</p>
    </li>
  );
}

/** Onboarding renders outside the app shell, so it brings its own. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "40px 0" }}>
      <div className="cw-row" style={{ gap: 10, marginBottom: 28 }}>
        <Logo size={24} />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Clockwork</span>
      </div>
      <div className="cw-card cw-enter" style={{ padding: "clamp(22px, 4vw, 36px)" }}>
        {children}
      </div>
    </div>
  );
}

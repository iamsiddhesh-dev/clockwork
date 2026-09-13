"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type KickoffResult, type Profile } from "@/lib/api";
import { ensureAccount } from "@/lib/account";
import { Logo } from "@/components/shell/icons";
import { Preloader } from "@/components/shell/preloader";
import {
  EMPTY_PROFILE,
  ProfileFields,
  STEPS,
  readLinks,
  stepErrors,
  usablePortfolio,
  type ProfileDraft,
  type StepKey,
} from "@/app/profile/profile-form";
import { guessTimeZone } from "@/lib/reference";

type Stage = "form" | "working" | "done" | "error";

const SOURCE_LABEL: Record<string, string> = {
  hacker_news: "Hacker News",
  remotive: "Remotive",
  remoteok: "RemoteOK",
};

/** One heading per step. No paragraph underneath unless it says
 *  something the heading doesn't — most don't. */
const HEADINGS: Record<StepKey, { title: string; note?: string }> = {
  you: { title: "Who are you?" },
  work: {
    title: "What do you do?",
    note: "This is what leads get scored against.",
  },
  proof: {
    title: "Where's your work?",
    note: "Clockwork reads these to find the results your pitches cite.",
  },
};

export function OnboardingFlow({ initial }: { initial: Profile | null }) {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("form");
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<ProfileDraft>(() => ({
    ...EMPTY_PROFILE,
    ...(initial ?? {}),
  }));

  // Filled in after mount, never during render. `guessTimeZone` reads
  // the *browser's* zone, and on the server it reads the server's -- so
  // doing this in the initial state made React hydrate an input holding
  // "UTC" over markup holding "Asia/Calcutta", which is exactly the
  // hydration mismatch warning.
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
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<KickoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const errors = useMemo(() => stepErrors(form), [form]);
  const step = STEPS[stepIndex];
  const stepError = errors[step.key];
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
      // Read their GitHub and portfolio first, so the one-line summary and
      // past results the agent scores and pitches with come from their
      // real work rather than an empty profile. `readLinks` never throws:
      // an unreadable link must not stop someone finishing onboarding.
      const { form: enriched } = await readLinks(account, form);
      setForm(enriched);
      await api.saveProfile(account, { ...enriched, portfolio: usablePortfolio(enriched) });
      setProfileSaved(true);
      setResult(await api.kickoff(account, 10, 1));
      setStage("done");
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    }
  }

  if (stage === "form") {
    return (
      <Frame intro>
        <Progress index={stepIndex} />

        <div className="cw-label" style={{ marginTop: 22 }}>
          Step {stepIndex + 1} of {STEPS.length}
        </div>
        <h1 className="cw-h1" style={{ marginTop: 10 }}>
          {HEADINGS[step.key].title}
        </h1>
        {HEADINGS[step.key].note && (
          <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--dim)" }}>
            {HEADINGS[step.key].note}
          </p>
        )}

        <div style={{ marginTop: 26 }}>
          <ProfileFields
            form={form}
            setForm={setForm}
            only={step.key}
            variant="onboarding"
          />
        </div>

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
            {isLast ? "Find me work" : "Continue"}
          </button>
          {touched && stepError && (
            <span style={{ fontSize: 13, color: "var(--bad)", flex: "1 1 100%" }}>{stepError}</span>
          )}
        </div>

        {stepIndex === 0 && (
          <p style={{ margin: "22px 0 0", fontSize: 13, color: "var(--quiet)" }}>
            Been here before?{" "}
            <Link href="/signin" style={{ color: "var(--orange-ink)", fontWeight: 600 }}>
              Open your workspace
            </Link>
            .
          </p>
        )}
      </Frame>
    );
  }

  if (stage === "working") {
    return (
      <Frame>
        <div className="cw-label">Working</div>
        <h1 className="cw-h1" style={{ marginTop: 10 }}>
          Reading your work, then the boards.
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--dim)" }}>
          Finding leads, checking each is still open, and scoring them against you. About a minute.
        </p>
        <div
          style={{
            marginTop: 26,
            height: 3,
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

  if (stage === "error") {
    return (
      <Frame>
        <div className="cw-label">{profileSaved ? "Partly done" : "Didn’t save"}</div>
        <h1 className="cw-h1" style={{ marginTop: 10 }}>
          {profileSaved ? "Profile saved." : "That didn’t go through."}
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--bad)" }}>
          {profileSaved ? "Sourcing didn’t finish: " : ""}
          {error}
        </p>
        <div className="cw-row" style={{ marginTop: 24 }}>
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

  const sourced = result?.sourced.total ?? 0;
  const scored = result?.scored.scored ?? 0;
  const pitched = result?.pitched.length ?? 0;
  const links = result?.links;
  const perSource = (result?.sourced.sources ?? [])
    .filter((s) => s.ok)
    .map((s) => `${SOURCE_LABEL[s.kind] ?? s.kind} ${s.fetched}`)
    .join(" · ");

  return (
    <Frame>
      <div className="cw-label">Done</div>
      <h1 className="cw-h1" style={{ marginTop: 10 }}>
        Here&rsquo;s what it did.
      </h1>

      <ul style={{ listStyle: "none", margin: "24px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <Outcome title={`Sourced ${sourced} postings`} note={perSource} />
        {links && links.checked > 0 && (
          <Outcome
            title={`Checked ${links.checked} links`}
            note={
              links.gone + links.closed > 0
                ? `${links.gone + links.closed} already closed — those can't be pitched`
                : "all still open"
            }
          />
        )}
        <Outcome
          title={
            result?.errors?.scoring ? "Scoring didn't finish" : `Scored ${scored} against your profile`
          }
          // A stage that failed says so, instead of reporting "Scored 0" as
          // though every lead had been read and found wanting.
          note={
            result?.errors?.scoring
              ? "Run it again from Opportunities — the leads are saved."
              : "0–100, with the evidence"
          }
        />
        <Outcome
          highlight={pitched > 0}
          title={pitched > 0 ? `Drafted ${pitched} pitch` : "No pitch yet"}
          note={
            pitched > 0
              ? "Nothing sent. Read it, then approve or reject."
              : "Nothing cleared the bar. Writing to a weak match is the spam this replaces."
          }
        />
      </ul>

      <div className="cw-row" style={{ marginTop: 24 }}>
        {pitched > 0 && (
          <button className="cw-btn cw-btn-primary" onClick={() => router.push("/approvals")}>
            Review it
          </button>
        )}
        <button
          className={`cw-btn ${pitched > 0 ? "" : "cw-btn-primary"}`}
          onClick={() => router.push("/overview")}
        >
          Dashboard
        </button>
        {result?.run_id && (
          <button className="cw-btn cw-btn-quiet" onClick={() => router.push(`/runs/${result.run_id}`)}>
            See every step
          </button>
        )}
      </div>
    </Frame>
  );
}

function Progress({ index }: { index: number }) {
  return (
    <div className="cw-row" style={{ gap: 6 }}>
      {STEPS.map((s, i) => (
        <span
          key={s.key}
          title={s.label}
          style={{
            height: 3,
            flex: 1,
            borderRadius: 3,
            background: i <= index ? "var(--orange)" : "var(--rim)",
            transition: "background var(--t)",
          }}
        />
      ))}
    </div>
  );
}

function Outcome({ title, note, highlight }: { title: string; note?: string; highlight?: boolean }) {
  return (
    <li
      className="cw-card-sm"
      style={{
        padding: 14,
        borderColor: highlight ? "var(--orange-bd)" : "var(--rim)",
        background: highlight ? "var(--orange-bg)" : "var(--glass)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</p>
      {note && (
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--dim)" }}>{note}</p>
      )}
    </li>
  );
}

/**
 * Onboarding renders outside the app shell, so it brings its own — and
 * the brand sits at full size here rather than the 24px mark used in the
 * sidebar. This is the only screen where nobody knows what the product
 * is called yet, which is exactly where a wordmark earns its space.
 */
function Frame({ children, intro }: { children: React.ReactNode; intro?: boolean }) {
  return (
    <>
      {intro && <Preloader />}
      <div
        // Hidden by CSS until the panel splits -- see globals.css. Only
        // the first screen needs it; the rest are reached by clicking,
        // long after the intro is gone.
        className={intro ? "cw-reveal-target" : undefined}
        style={{ width: "100%", maxWidth: 640, margin: "0 auto", padding: "48px 0" }}
      >
        <div className="cw-row" style={{ gap: 14, marginBottom: 34, justifyContent: "center" }}>
          <Logo size={40} />
          <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.04em" }}>Clockwork</span>
        </div>
        <div className="cw-card" style={{ padding: "clamp(24px, 4vw, 38px)" }}>{children}</div>
      </div>
    </>
  );
}

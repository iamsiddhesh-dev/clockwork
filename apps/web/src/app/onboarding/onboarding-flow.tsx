"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Profile } from "@/lib/api";
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
import { saveWelcome, type WelcomeSummary } from "@/lib/welcome";

type Stage = "form" | "working" | "error";

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
    note: "Clockwork reads these to judge which leads fit you.",
  },
};

/**
 * Setting up, as the steps it really is.
 *
 * This used to be one long request behind a bar frozen at a third, with no
 * way to tell whether anything was happening -- the part of onboarding
 * where people close the tab. Each phase is now its own call, the bar
 * moves as each one really finishes, and `until` is how far along the bar
 * sits once that phase is done.
 */
const PHASES = [
  { key: "save", label: "Saving your profile", until: 5, expectMs: 2_000 },
  { key: "read", label: "Reading your GitHub and portfolio", until: 20, expectMs: 12_000 },
  { key: "find", label: "Finding leads on three job boards", until: 34, expectMs: 10_000 },
  { key: "check", label: "Checking each posting is still open", until: 50, expectMs: 14_000 },
  { key: "score", label: "Scoring leads against your work", until: 100, expectMs: 55_000 },
] as const;

/** Leads scored during setup. Each score is a model call on a shared
 *  per-minute token budget, so setup scores a first batch and the Score
 *  fit button does the rest -- ten here meant a minute of waiting at the
 *  end and, before the budget fix, most of them failing. */
const SETUP_SCORE_BATCH = 6;

type PhaseKey = (typeof PHASES)[number]["key"];

/** Scores at or above this count as a strong match. Same bar the agent
 *  has always used for "worth pitching". */
const STRONG_FIT = 60;

export function OnboardingFlow({ initial }: { initial: Profile | null }) {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("form");
  const [stepIndex, setStepIndex] = useState(0);
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
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PhaseKey>("save");
  const [progress, setProgress] = useState(0);

  const errors = useMemo(() => stepErrors(form), [form]);
  const step = STEPS[stepIndex];
  const stepError = errors[step.key];
  const isLast = stepIndex === STEPS.length - 1;

  // While a phase runs, the bar eases toward (but never reaches) where
  // that phase ends, so it is visibly moving without claiming progress
  // that hasn't happened. Finishing the phase is what takes it the rest
  // of the way.
  //
  // Paced by how long the phase usually takes. A fixed rate reached each
  // phase's ceiling in a few seconds and then sat there, so a slow phase --
  // scoring takes most of a minute -- showed a bar frozen at 98%, which is
  // exactly what reads as "stuck". Easing over the expected duration keeps
  // it visibly creeping for as long as the work really runs.
  const target = useRef({ until: 0, expectMs: 1 });
  useEffect(() => {
    if (stage !== "working") return;
    const TICK_MS = 120;
    const id = window.setInterval(() => {
      setProgress((p) => {
        const ceiling = target.current.until - 1;
        if (p >= ceiling) return p;
        const rate = TICK_MS / (target.current.expectMs * 0.6);
        return p + Math.max(0.01, (ceiling - p) * rate);
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [stage]);

  const begin = (key: PhaseKey) => {
    setPhase(key);
    const next = PHASES.find((p) => p.key === key)!;
    target.current = { until: next.until, expectMs: next.expectMs };
  };
  const finish = (key: PhaseKey) => {
    const until = PHASES.find((p) => p.key === key)!.until;
    setProgress((p) => Math.max(p, until));
  };

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
    setProgress(0);

    const problems: string[] = [];
    const summary: WelcomeSummary = {
      found: 0,
      sources: [],
      checked: 0,
      closed: 0,
      scored: 0,
      strong: 0,
      problems,
    };

    // 1. The profile, first and on its own. Everything after this can fail
    //    without losing what the person just typed.
    let account: string;
    try {
      begin("save");
      account = await ensureAccount();
      await api.saveProfile(account, { ...form, portfolio: usablePortfolio(form) });
      finish("save");
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
      return;
    }

    // 2. Their work. readLinks never throws -- an unreadable link must not
    //    stop anyone finishing -- so a failure here only means less to score with.
    begin("read");
    const { form: enriched } = await readLinks(account, form);
    setForm(enriched);
    try {
      await api.saveProfile(account, { ...enriched, portfolio: usablePortfolio(enriched) });
    } catch {
      problems.push("Couldn't save what was read from your links.");
    }
    finish("read");

    // 3–5. Leads. Each stage is best-effort: a board that's down or a
    //      rate-limited scorer leaves the rest of the setup intact, and
    //      the summary says which part didn't finish.
    try {
      begin("find");
      const sync = await api.syncOpportunities(account);
      summary.found = sync.total;
      summary.sources = sync.sources.map((s) => ({
        label: SOURCE_LABEL[s.kind] ?? s.kind,
        fetched: s.fetched ?? 0,
        ok: s.ok,
      }));
    } catch {
      problems.push("The job boards didn't answer. Try Fetch leads on Opportunities.");
    }
    finish("find");

    try {
      begin("check");
      const links = await api.verifyLinks(account, 30);
      summary.checked = links.checked;
      summary.closed = links.gone + links.closed;
    } catch {
      problems.push("Link checking didn't finish.");
    }
    finish("check");

    try {
      begin("score");
      const scoring = await api.scoreOpportunities(account, SETUP_SCORE_BATCH);
      summary.scored = scoring.scored;
      summary.strong = (scoring.results ?? []).filter((r) => r.fit_score >= STRONG_FIT).length;
      if (scoring.failed > 0) {
        problems.push(`${scoring.failed} lead${scoring.failed === 1 ? "" : "s"} couldn't be scored yet — try Score fit on Opportunities.`);
      }
    } catch {
      problems.push("Scoring didn't finish. Try Score fit on Opportunities.");
    }
    finish("score");

    // Let 100% actually be seen before moving on.
    await new Promise((resolve) => setTimeout(resolve, 450));
    saveWelcome(summary);
    router.push("/overview");
    router.refresh();
  }

  if (stage === "form") {
    return (
      <Frame intro>
        <StepBar index={stepIndex} />

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
    const current = PHASES.findIndex((p) => p.key === phase);
    const percent = Math.min(100, Math.round(progress));
    return (
      <Frame>
        <div className="cw-row" style={{ gap: 12 }}>
          <span className="cw-label">Setting up</span>
          <span className="cw-mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--dim)" }}>
            {percent}%
          </span>
        </div>
        <h1 className="cw-h1" style={{ marginTop: 10 }} aria-live="polite">
          {percent >= 100 ? "All set." : `${PHASES[current].label}…`}
        </h1>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ marginTop: 22, height: 6, borderRadius: 6, background: "var(--rim)", overflow: "hidden" }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              borderRadius: 6,
              background: "var(--orange)",
              transition: "width 240ms ease-out",
            }}
          />
        </div>

        <ol style={{ listStyle: "none", margin: "24px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 11 }}>
          {PHASES.map((p, i) => {
            const done = i < current || percent >= 100;
            const active = i === current && percent < 100;
            return (
              <li key={p.key} className="cw-row" style={{ gap: 12, fontSize: 14 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    flex: "none",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    border: `1px solid ${done ? "var(--ok)" : active ? "var(--orange)" : "var(--rim2)"}`,
                    color: done ? "var(--ok)" : "var(--orange)",
                    background: done ? "rgba(78, 208, 138, 0.12)" : "transparent",
                  }}
                >
                  {done ? "✓" : active ? <span className="cw-dot cw-dot-live" style={{ background: "var(--orange)" }} /> : ""}
                </span>
                <span style={{ color: done || active ? "var(--ink)" : "var(--quiet)", fontWeight: active ? 600 : 400 }}>
                  {p.label}
                </span>
              </li>
            );
          })}
        </ol>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="cw-label">Didn&rsquo;t save</div>
      <h1 className="cw-h1" style={{ marginTop: 10 }}>
        That didn&rsquo;t go through.
      </h1>
      <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--bad)" }}>{error}</p>
      <div className="cw-row" style={{ marginTop: 24 }}>
        <button className="cw-btn cw-btn-primary" onClick={() => setStage("form")}>
          Back to the form
        </button>
      </div>
    </Frame>
  );
}

function StepBar({ index }: { index: number }) {
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
        // Hidden by CSS until the intro lifts -- see globals.css. Only the
        // first screen needs it; the rest are reached by clicking, long
        // after the intro is gone.
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

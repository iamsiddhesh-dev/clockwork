"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { clearWelcome, readWelcomeRaw, type WelcomeSummary } from "@/lib/welcome";

const subscribeNever = () => () => {};
const noSummaryOnServer = () => null;

/**
 * What onboarding did, shown once, over the dashboard it just filled.
 *
 * It used to be a screen of its own between the form and the app -- one
 * more page to click through before seeing anything. Landing on the real
 * dashboard with a short summary on top gets the same facts across and
 * leaves the person somewhere useful the moment they close it.
 *
 * Read through useSyncExternalStore rather than an effect: the server has
 * no sessionStorage, so it renders nothing, and the client shows the
 * dialog straight after hydration without the two disagreeing.
 */
export function WelcomeDialog() {
  const raw = useSyncExternalStore(subscribeNever, readWelcomeRaw, noSummaryOnServer);
  const [dismissed, setDismissed] = useState(false);
  const primary = useRef<HTMLAnchorElement>(null);

  let summary: WelcomeSummary | null = null;
  try {
    summary = raw ? (JSON.parse(raw) as WelcomeSummary) : null;
  } catch {
    summary = null;
  }
  const open = Boolean(summary) && !dismissed;

  const close = () => {
    clearWelcome();
    setDismissed(true);
  };

  useEffect(() => {
    if (!open) return;
    primary.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !summary) return null;

  const boards = summary.sources.filter((s) => s.ok).map((s) => `${s.label} ${s.fetched}`).join(" · ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div
        className="cw-card"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          padding: "clamp(22px, 4vw, 32px)",
          background: "var(--menu)",
          backdropFilter: "blur(40px) saturate(160%)",
          WebkitBackdropFilter: "blur(40px) saturate(160%)",
          boxShadow: "var(--hi), 0 40px 100px -30px rgba(0,0,0,.9)",
        }}
      >
        <div className="cw-label" style={{ color: "var(--ok)" }}>
          Setup complete
        </div>
        <h2 id="welcome-title" className="cw-h1" style={{ marginTop: 10, fontSize: 26 }}>
          Your agent is working.
        </h2>

        <ul style={{ listStyle: "none", margin: "20px 0 0", padding: 0, display: "flex", flexDirection: "column" }}>
          <Line title={`Found ${summary.found} postings`} note={boards || undefined} />
          <Line
            title={`Checked ${summary.checked} links`}
            note={summary.closed ? `${summary.closed} already closed, set aside` : "All still open"}
          />
          <Line
            title={`Scored ${summary.scored} against your work`}
            note={
              summary.strong
                ? `${summary.strong} strong match${summary.strong === 1 ? "" : "es"} (60+)`
                : "No strong matches yet"
            }
            highlight={summary.strong > 0}
          />
        </ul>

        {summary.problems.length > 0 && (
          <ul style={{ margin: "14px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: "var(--warn)" }}>
            {summary.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <p style={{ margin: "16px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--dim)" }}>
          Nothing has been sent. Pick a lead, draft a pitch, and approve it when you&rsquo;re happy.
        </p>

        <div className="cw-row" style={{ marginTop: 22, gap: 10 }}>
          <Link ref={primary} href="/opportunities" className="cw-btn cw-btn-primary" onClick={close}>
            See your leads
          </Link>
          <button className="cw-btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Line({ title, note, highlight }: { title: string; note?: string; highlight?: boolean }) {
  return (
    <li style={{ padding: "11px 0", borderTop: "1px solid var(--rim)" }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      {note && (
        <div style={{ marginTop: 3, fontSize: 12.5, color: highlight ? "var(--ok)" : "var(--quiet)" }}>{note}</div>
      )}
    </li>
  );
}

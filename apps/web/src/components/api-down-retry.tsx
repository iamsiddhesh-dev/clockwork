"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** How long to wait before trying again on its own. Long enough for a cold
 *  API instance to finish booting, short enough that nobody gives up. */
const AUTO_RETRY_MS = 4000;
const MAX_AUTO_RETRIES = 3;

/**
 * The part of "couldn't load" that acts: retry on its own a few times,
 * then offer a button.
 *
 * The API is serverless and can be cold after a quiet spell, so the most
 * likely reason a page failed is that it arrived first. Re-rendering the
 * page a few seconds later usually just works -- asking a visitor to do
 * that themselves, or worse to start a server, was the failure.
 */
export function ApiDownRetry() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const auto = attempts < MAX_AUTO_RETRIES;

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, AUTO_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [attempts, auto, router]);

  return (
    <div className="cw-row" style={{ marginTop: 18, gap: 12 }}>
      <button
        className="cw-btn cw-btn-primary"
        onClick={() => {
          setAttempts(0);
          router.refresh();
        }}
      >
        Try again
      </button>
      {auto && (
        <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>Retrying automatically…</span>
      )}
    </div>
  );
}

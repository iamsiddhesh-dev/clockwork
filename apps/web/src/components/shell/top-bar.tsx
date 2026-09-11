"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Icon, Logo } from "./icons";
import { activeItem, ALL_NAV } from "./nav-items";
import { useShell } from "./shell-context";

/**
 * The demo unlock, in the chrome: advance the virtual clock and watch
 * whatever becomes due fire for real -- a follow-up nudge, an overdue
 * invoice chase. Every time read in the backend goes through the same
 * clock (apps/agent's clock.py), so this is not a display trick.
 */
function ClockControl() {
  const { summary, refreshSummary, account } = useShell();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [fired, setFired] = useState<number | null>(null);

  async function run(fn: (token: string) => Promise<{ fired?: unknown[] }>) {
    setBusy(true);
    setFired(null);
    try {
      if (!account) return;
      const result = await fn(account);
      setFired(result.fired?.length ?? null);
      refreshSummary();
      // Whatever fired changed rows the current screen is showing.
      router.refresh();
    } catch {
      /* the clock label simply won't move */
    } finally {
      setBusy(false);
    }
  }

  const label = summary
    ? new Date(summary.now).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "…";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        border: "1px solid var(--rim)",
        background: "var(--glass)",
        borderRadius: 999,
        padding: "5px 6px 5px 13px",
        boxShadow: "var(--hi)",
      }}
    >
      <span
        className="cw-mono"
        style={{ fontSize: 11.5, lineHeight: 1, color: "var(--dim)", paddingRight: 3 }}
        title="The virtual clock the scheduler fires against"
      >
        {label}
      </span>
      {[3, 7].map((days) => (
        <button
          key={days}
          disabled={busy}
          onClick={() => run((token) => api.advanceClock(token, days))}
          title={`Advance ${days} days and run anything that becomes due`}
          className="cw-mono"
          style={{
            border: 0,
            background: "var(--glass2)",
            color: "var(--sub)",
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          +{days}d
        </button>
      ))}
      <button
        disabled={busy}
        onClick={() => run(async (token) => ({ ...(await api.resetClock(token)), fired: [] }))}
        title="Back to real time"
        className="cw-mono"
        style={{
          border: 0,
          background: "none",
          color: "var(--quiet)",
          borderRadius: 999,
          padding: "5px 7px",
          fontSize: 11,
          lineHeight: 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        reset
      </button>
      {fired !== null && (
        <span
          className="cw-mono"
          style={{
            fontSize: 11,
            lineHeight: 1,
            paddingRight: 6,
            color: fired ? "var(--ok)" : "var(--quiet)",
          }}
        >
          {fired === 0 ? "nothing due" : `${fired} fired`}
        </span>
      )}
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { theme, toggleTheme, summary } = useShell();
  const active = activeItem(pathname);

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 20px",
          borderBottom: "1px solid var(--rim)",
          background: "var(--sheet)",
          backdropFilter: "blur(24px)",
        }}
      >
        <Link
          href="/overview"
          className="cw-only-narrow"
          style={{ alignItems: "center", gap: 9, flex: "none" }}
        >
          <Logo size={22} />
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Clockwork</span>
        </Link>

        <span
          className="cw-only-wide"
          style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.025em", flex: "none" }}
        >
          {active?.title ?? "Clockwork"}
        </span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginLeft: "auto",
            flex: "none",
          }}
        >
          <div className="cw-hide-sm">
            <ClockControl />
          </div>
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={{
              border: "1px solid var(--rim)",
              background: "var(--glass)",
              color: "var(--dim)",
              borderRadius: 999,
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              boxShadow: "var(--hi)",
              flex: "none",
            }}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={15} strokeWidth={1.6} />
          </button>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Workspace settings"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              flex: "none",
              border: "1px solid var(--rim)",
              background: "var(--glass)",
              display: "grid",
              placeItems: "center",
              color: "var(--dim)",
              boxShadow: "var(--hi)",
            }}
          >
            <Icon name="settings" size={15} strokeWidth={1.6} />
          </Link>
        </div>
      </header>

      <div
        className="cw-scroll-x cw-only-narrow"
        style={{
          gap: 5,
          padding: "12px 16px",
          borderBottom: "1px solid var(--rim)",
        }}
      >
        {ALL_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="cw-chip"
            data-on={active?.href === item.href}
          >
            {item.label}
            {item.href === "/approvals" && summary?.pending_approvals
              ? ` ${summary.pending_approvals}`
              : ""}
          </Link>
        ))}
      </div>
    </>
  );
}

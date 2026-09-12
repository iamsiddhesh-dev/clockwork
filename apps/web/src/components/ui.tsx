import type { CSSProperties, ReactNode } from "react";

/** Money is rendered from stored numbers, never re-derived in the UI --
 *  the backend computes every total in code precisely so the two can't
 *  disagree. This only formats. */
export function money(amount: number, currency = "USD"): string {
  return `${currency} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function compactMoney(amount: number, currency = "USD"): string {
  return `${currency === "USD" ? "$" : `${currency} `}${amount.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

export function Card({
  children,
  pad = 22,
  className = "",
  style,
}: {
  children: ReactNode;
  pad?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`cw-card ${className}`} style={{ padding: pad, ...style }}>
      {children}
    </div>
  );
}

export function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <h2 className="cw-h2">{title}</h2>
      {action ? <div style={{ marginLeft: "auto" }}>{action}</div> : null}
    </div>
  );
}

export function PageHead({
  kicker,
  title,
  aside,
  kickerColor,
}: {
  kicker: string;
  title: string;
  aside?: ReactNode;
  kickerColor?: string;
}) {
  return (
    <header className="cw-page-head">
      <div style={{ flex: "1 1 300px", minWidth: 0 }}>
        <div className="cw-kicker" style={kickerColor ? { color: kickerColor } : undefined}>
          {kicker}
        </div>
        <h1 className="cw-h1">{title}</h1>
      </div>
      {aside}
    </header>
  );
}

export function Metric({
  label,
  value,
  note,
  color,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  color?: string;
}) {
  return (
    <div className="cw-card" style={{ padding: 20 }}>
      <div className="cw-label">{label}</div>
      <div
        className="cw-num"
        style={{ marginTop: 16, fontSize: 27, color: color ?? "var(--ink)" }}
      >
        {value}
      </div>
      {note ? (
        <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--quiet)" }}>{note}</div>
      ) : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cw-empty">
      <div
        className="cw-mono"
        style={{
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--quiet)",
        }}
      >
        {title}
      </div>
      {children ? (
        <p
          style={{
            margin: "18px auto 0",
            maxWidth: "44ch",
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "var(--dim)",
          }}
        >
          {children}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Shown when a page could not reach the agent API.
 *
 * This exists because the alternative was actively misleading: catching
 * a failed fetch into an empty array renders "Nothing sourced yet" over
 * a workspace holding 84 postings, and the reader has no way to tell the
 * difference. An empty state is a claim about the data; it should only
 * be made when the data was actually read.
 */
export function ApiDown({ what }: { what: string }) {
  return (
    <div className="cw-card" style={{ padding: 40, borderColor: "var(--bad)" }}>
      <div className="cw-label" style={{ color: "var(--bad)" }}>
        Can&rsquo;t reach the agent
      </div>
      <h2 style={{ margin: "14px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.028em" }}>
        {what} could not be loaded
      </h2>
      <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--dim)" }}>
        A connection problem, not an empty workspace. Check the API is running.
      </p>
    </div>
  );
}

/** A status word in the design's uppercase mono, coloured by meaning. */
export function Status({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className="cw-status" style={{ color: TONES[tone] }}>
      {children}
    </span>
  );
}

export const TONES = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  info: "var(--blue)",
  active: "var(--orange-ink)",
  quiet: "var(--quiet)",
  dim: "var(--dim)",
  ink: "var(--ink)",
} as const;

export function Dot({ tone, live }: { tone: keyof typeof TONES; live?: boolean }) {
  return (
    <span
      className={`cw-dot ${live ? "cw-dot-live" : ""}`}
      style={{ background: TONES[tone] }}
    />
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShell } from "./shell-context";
import { Icon, Logo } from "./icons";
import { activeItem, PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-items";

function NavButton({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        borderRadius: "var(--r-ctl)",
        padding: "10px 11px",
        fontSize: 13.5,
        fontWeight: active ? 600 : 400,
        background: active ? "var(--glass2)" : "transparent",
        color: active ? "var(--ink)" : "var(--dim)",
        boxShadow: active ? "var(--hi), 0 2px 10px -5px rgba(0,0,0,.7)" : "none",
        transition: "background var(--t), color var(--t)",
      }}
    >
      <Icon name={item.icon} />
      {item.label}
      {badge ? (
        <span
          className="cw-mono"
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1,
            border: "1px solid var(--rim)",
            borderRadius: 7,
            padding: "4px 7px",
            color: "var(--ink)",
          }}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** "in 2h", "in 3d", "now" -- relative to the *virtual* clock, which is
 *  what the scheduler actually fires against. */
function untilLabel(nowIso: string, dueIso: string): string {
  const ms = new Date(dueIso).getTime() - new Date(nowIso).getTime();
  if (ms <= 0) return "due now";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function Sidebar() {
  const pathname = usePathname();
  const { summary } = useShell();
  const active = activeItem(pathname);

  return (
    <aside
      className="cw-aside"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "22px 14px",
        borderRight: "1px solid var(--rim)",
        background: "var(--glass)",
        position: "sticky",
        top: 0,
        maxHeight: "100vh",
        overflowY: "auto",
      }}
    >
      <Link href="/overview" style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 8px 0" }}>
        <Logo />
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Clockwork</span>
      </Link>

      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }} aria-label="Primary">
        {PRIMARY_NAV.map((item) => (
          <NavButton
            key={item.href}
            item={item}
            active={active?.href === item.href}
            badge={item.href === "/approvals" ? summary?.pending_approvals : undefined}
          />
        ))}
      </nav>

      <hr className="cw-hr" style={{ margin: "0 11px" }} />

      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }} aria-label="Secondary">
        {SECONDARY_NAV.map((item) => (
          <NavButton key={item.href} item={item} active={active?.href === item.href} />
        ))}
      </nav>

      <div className="cw-card-sm" style={{ marginTop: "auto", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className={`cw-dot ${summary?.running ? "cw-dot-live" : ""}`}
            style={{ background: summary ? "var(--ok)" : "var(--quiet)" }}
          />
          <span
            className="cw-mono"
            style={{
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--dim)",
            }}
          >
            {summary?.running ? "Running" : summary ? "Operational" : "Connecting"}
          </span>
        </div>
        <p
          className="cw-mono"
          style={{ margin: "10px 0 0", fontSize: 11.5, lineHeight: 1.6, color: "var(--quiet)" }}
        >
          {summary ? (
            <>
              {summary.next_task
                ? `Next wake ${untilLabel(summary.now, summary.next_task.due_at)}`
                : "Nothing scheduled"}
              <br />
              Spend ${summary.spent_today_usd.toFixed(2)} / ${summary.daily_cap_usd.toFixed(2)}
            </>
          ) : (
            "—"
          )}
        </p>
      </div>
    </aside>
  );
}

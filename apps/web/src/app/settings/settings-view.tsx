"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Profile } from "@/lib/api";
import { clearAccount, readAccount } from "@/lib/account";
import { ProfileForm } from "@/app/profile/profile-form";
import { Card, SectionHead } from "@/components/ui";
import { useShell } from "@/components/shell/shell-context";

function Row({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: "18px 0",
        borderTop: "1px solid var(--rim)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--dim)" }}>
          {blurb}
        </p>
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  locked,
  label,
}: {
  on: boolean;
  onClick?: () => void;
  locked?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={locked ? undefined : onClick}
      disabled={locked}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={locked ? "Enforced in code — not switchable" : undefined}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: `1px solid ${on ? "var(--orange-bd)" : "var(--rim2)"}`,
        background: on ? "var(--orange-bg)" : "transparent",
        cursor: locked ? "default" : "pointer",
        padding: "0 2px",
        display: "flex",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        transition: "background var(--t)",
        opacity: locked ? 0.75 : 1,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: on ? "var(--orange)" : "var(--quiet)",
          display: "block",
        }}
      />
    </button>
  );
}

export function SettingsView({
  profile,
  dailyCapUsd,
}: {
  profile: Profile | null;
  dailyCapUsd: number;
}) {
  const router = useRouter();
  const { ambient, toggleAmbient, theme, toggleTheme } = useShell();
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <>
      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Profile" />
        <p
          style={{
            margin: "8px 0 22px",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--dim)",
            maxWidth: "62ch",
          }}
        >
          Everything the agent grounds itself in. Change the rate and the next quote is priced
          differently; change the portfolio and the next pitch cites something else.
        </p>
        <ProfileForm initial={profile} submitLabel="Save changes" />
      </Card>

      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Operation" />
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column" }}>
          <Row
            title="Approve before sending"
            blurb="Every client-facing action waits for you. This is enforced in code, not by settings — an approval-gated tool has no path that sends — so there is nothing here to switch off."
          >
            <Toggle on locked label="Approve before sending (enforced in code)" />
          </Row>

          <Row
            title="Daily spend cap"
            blurb="When the day's model spend crosses this, the orchestrator degrades to the smaller model rather than silently skipping work."
          >
            <span className="cw-mono" style={{ fontSize: 14, fontWeight: 500 }}>
              ${dailyCapUsd.toFixed(2)}
            </span>
          </Row>

          <Row
            title="Wake schedule"
            blurb="How often the scheduler drains due tasks and fires the agent with no human present."
          >
            <span className="cw-mono" style={{ fontSize: 14, fontWeight: 500 }}>
              every 30s
            </span>
          </Row>

          <Row
            title="Ambient lighting"
            blurb="The colour fields drifting behind the interface. Turn it off for a flatter, quieter surface."
          >
            <Toggle on={ambient} onClick={toggleAmbient} label="Ambient lighting" />
          </Row>

          <Row title="Theme" blurb="Dark is the design's native state. Light is a full repaint, not a filter.">
            <Toggle on={theme === "light"} onClick={toggleTheme} label="Light theme" />
          </Row>
        </div>
      </Card>

      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Workspace" />
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--dim)",
            maxWidth: "62ch",
          }}
        >
          There is no sign-in. This workspace is identified by an id held in a cookie in this
          browser, and anyone holding that id can read it. Fine for a demo you filled in a minute
          ago — not something to put real client correspondence behind.
        </p>
        <p
          className="cw-mono"
          style={{
            margin: "14px 0 0",
            fontSize: 11.5,
            color: "var(--quiet)",
            wordBreak: "break-all",
          }}
        >
          {readAccount() ?? "—"}
        </p>

        <div className="cw-row" style={{ marginTop: 20 }}>
          {confirmingReset ? (
            <>
              <button
                className="cw-btn"
                style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
                onClick={() => {
                  clearAccount();
                  router.push("/onboarding");
                  router.refresh();
                }}
              >
                Yes, start over
              </button>
              <button className="cw-btn" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
              <span style={{ fontSize: 12.5, color: "var(--quiet)", flex: "1 1 100%" }}>
                This forgets the id in this browser and sends you back to onboarding. The data
                itself stays in the database, but with the id gone there is no way back to it.
              </span>
            </>
          ) : (
            <button className="cw-btn" onClick={() => setConfirmingReset(true)}>
              Start a fresh workspace
            </button>
          )}
        </div>
      </Card>
    </>
  );
}

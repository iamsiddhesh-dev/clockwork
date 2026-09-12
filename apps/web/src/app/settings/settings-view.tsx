"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [copied, setCopied] = useState(false);

  // Built on the client so it carries whatever origin the app is
  // actually being served from -- a hard-coded localhost would be wrong
  // the moment this is deployed, and wrong in exactly the way nobody
  // notices until a client clicks it.
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null);
  useEffect(() => {
    const account = readAccount();
    setIntakeUrl(account ? `${window.location.origin}/intake/${account}` : null);
  }, []);

  return (
    <>
      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Profile" />
        <p style={{ margin: "8px 0 22px", fontSize: 13.5, color: "var(--dim)" }}>
          What every score, pitch and quote is built from.
        </p>
        <ProfileForm initial={profile} submitLabel="Save changes" />
      </Card>

      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Operation" />
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column" }}>
          <Row
            title="Approve before sending"
            blurb="Enforced in code, not settings. There is nothing here to switch off."
          >
            <Toggle on locked label="Approve before sending (enforced in code)" />
          </Row>

          <Row
            title="Daily spend cap"
            blurb="Past this, it drops to the cheaper model rather than stopping."
          >
            <span className="cw-mono" style={{ fontSize: 14, fontWeight: 500 }}>
              ${dailyCapUsd.toFixed(2)}
            </span>
          </Row>

          <Row
            title="Wake schedule"
            blurb="How often it wakes up on its own."
          >
            <span className="cw-mono" style={{ fontSize: 14, fontWeight: 500 }}>
              every 30s
            </span>
          </Row>

          <Row
            title="Ambient lighting"
            blurb="The colour drifting behind the interface."
          >
            <Toggle on={ambient} onClick={toggleAmbient} label="Ambient lighting" />
          </Row>

          <Row title="Theme" blurb="Dark or light.">
            <Toggle on={theme === "light"} onClick={toggleTheme} label="Light theme" />
          </Row>
        </div>
      </Card>

      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Your intake link" />
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--dim)",
            maxWidth: "62ch",
          }}
        >
          Anyone who posts here wakes the agent: it qualifies the lead and drafts a reply.
        </p>
        <div className="cw-row" style={{ marginTop: 16, gap: 10 }}>
          <code
            className="cw-mono cw-scroll-x"
            style={{
              flex: "1 1 340px",
              minWidth: 0,
              border: "1px solid var(--rim)",
              borderRadius: "var(--r-ctl)",
              padding: "10px 13px",
              fontSize: 12,
              whiteSpace: "nowrap",
              color: "var(--sub)",
            }}
          >
            {intakeUrl ?? "—"}
          </code>
          <button
            className="cw-btn"
            disabled={!intakeUrl}
            onClick={() => {
              if (!intakeUrl) return;
              navigator.clipboard?.writeText(intakeUrl).then(
                () => setCopied(true),
                // Clipboard access is refused in some contexts; the URL
                // is on screen and selectable either way.
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {intakeUrl && (
            <a className="cw-btn" href={intakeUrl} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          )}
        </div>
        {!profile?.name && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--warn)" }}>
            Needs a name on your profile first.
          </p>
        )}
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
          No sign-in. Anyone with this id can read the workspace — fine for a demo, not for real
          client data.
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
                Forgets this id. The data stays, but there is no way back to it.
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

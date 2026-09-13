"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api, type AccountRecord, type Profile } from "@/lib/api";
import { clearAccount, readAccount } from "@/lib/account";
import { ProfileForm } from "@/app/profile/profile-form";
import { Card, SectionHead } from "@/components/ui";
import { useShell } from "@/components/shell/shell-context";

/** Neither the page origin nor the workspace cookie changes without a
 *  navigation, so there is genuinely nothing to subscribe to. */
const subscribeNever = () => () => {};
const readOrigin = () => window.location.origin;
const readNothing = () => "";

function Row({
  title,
  blurb,
  children,
}: {
  title: string;
  /** Only when it says something the title doesn't. */
  blurb?: string;
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
        {blurb && (
          <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--dim)" }}>
            {blurb}
          </p>
        )}
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
  account,
  dailyCapUsd,
}: {
  profile: Profile | null;
  /** Null when the API could not be reached -- not the same as having no
   *  account, so the card says so rather than showing blanks. */
  account: AccountRecord | null;
  dailyCapUsd: number;
}) {
  const { ambient, toggleAmbient, theme, toggleTheme } = useShell();
  const [copied, setCopied] = useState(false);

  // Built on the client so it carries whatever origin the app is
  // actually being served from -- a hard-coded localhost would be wrong
  // the moment this is deployed, and wrong in exactly the way nobody
  // notices until a client clicks it. The server has no origin to offer,
  // so it says so with an empty snapshot rather than rendering a link
  // that is wrong for one frame.
  //
  // The workspace id comes from the account the page already fetched,
  // not from re-reading the cookie: if those two ever disagreed, this
  // would hand a client a link into the wrong workspace.
  const origin = useSyncExternalStore(subscribeNever, readOrigin, readNothing);
  const intakeUrl = origin && account?.id ? `${origin}/intake/${account.id}` : null;

  return (
    <>
      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Profile" />
        <div style={{ height: 18 }} />
        <ProfileForm initial={profile} submitLabel="Save changes" />
      </Card>

      <Card pad={26} style={{ maxWidth: 760 }}>
        <SectionHead title="Operation" />
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column" }}>
          <Row
            title="Approve before sending"
            blurb="Always on — nothing is sent without you."
          >
            <Toggle on locked label="Approve before sending (enforced in code)" />
          </Row>

          <Row
            title="Daily spend cap"
            blurb="Past this, it switches to a cheaper model."
          >
            <span className="cw-mono" style={{ fontSize: 14, fontWeight: 500 }}>
              ${dailyCapUsd.toFixed(2)}
            </span>
          </Row>

          <Row
            title="Wake schedule"
          >
            <span className="cw-mono" style={{ fontSize: 14, fontWeight: 500 }}>
              every 5 min
            </span>
          </Row>

          <Row
            title="Ambient lighting"
          >
            <Toggle on={ambient} onClick={toggleAmbient} label="Ambient lighting" />
          </Row>

          <Row title="Light theme">
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
          Share it with clients. Every enquiry gets a drafted reply for you to approve.
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

      <AccountCard account={account} />
    </>
  );
}

/**
 * Who this workspace belongs to, and the two ways out of it.
 *
 * Logging out and deleting used to be the same button -- "start a fresh
 * workspace", which forgot the id and left every row stranded in the
 * database with no way back. They are opposites and now read as
 * opposites: one is reversible with an email, the other is reversible by
 * nobody.
 */
function AccountCard({ account }: { account: AccountRecord | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function logOut() {
    clearAccount();
    router.push("/signin");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const id = readAccount();
      if (id) await api.deleteAccount(id);
      // Only after the server confirms. Clearing the cookie first and
      // then failing would leave the workspace alive and unreachable --
      // the precise failure this whole screen exists to undo.
      clearAccount();
      router.push("/onboarding");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card pad={26} style={{ maxWidth: 760 }}>
      <SectionHead title="Your account" />

      {account ? (
        <>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--dim)" }}>
            {account.email ? (
              <>
                Signed in as <strong style={{ color: "var(--ink)" }}>{account.email}</strong>
              </>
            ) : (
              <>
                Add an email to your profile to be able to sign back in.
              </>
            )}
          </p>
          <p
            className="cw-mono"
            style={{ margin: "12px 0 0", fontSize: 11, color: "var(--quiet)", wordBreak: "break-all" }}
          >
            {account.id}
          </p>
        </>
      ) : (
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--warn)" }}>
          Couldn&rsquo;t read your account — the agent API didn&rsquo;t answer.
        </p>
      )}

      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--quiet)" }}>
        No password — anyone with this email can open this workspace.
      </p>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column" }}>
        <Row
          title="Log out"
          blurb="Sign back in anytime with your email."
        >
          <button className="cw-btn" onClick={logOut}>
            Log out
          </button>
        </Row>

        <Row
          title="Delete this account"
          blurb="Permanently removes your profile and everything in it."
        >
          {confirming ? null : (
            <button
              className="cw-btn"
              style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          )}
        </Row>

        {confirming && (
          <div
            className="cw-card-sm"
            style={{ padding: 16, borderColor: "var(--bad)", marginBottom: 4 }}
          >
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--sub)" }}>
              This cannot be undone. Type <strong>delete</strong> to confirm.
            </p>
            <div className="cw-row" style={{ marginTop: 12, gap: 10 }}>
              <input
                className="cw-input"
                style={{ flex: "0 1 180px" }}
                value={typed}
                autoFocus
                aria-label="Type delete to confirm"
                onChange={(event) => setTyped(event.target.value)}
              />
              <button
                className="cw-btn"
                style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
                disabled={typed.trim().toLowerCase() !== "delete" || busy}
                onClick={remove}
              >
                {busy ? "Deleting…" : "Delete everything"}
              </button>
              <button
                className="cw-btn"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
            {error && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--bad)" }}>{error}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { maybeAccount } from "@/lib/account-server";
import { SignInForm } from "./signin-form";

export const dynamic = "force-dynamic";

/**
 * The way back to a workspace whose cookie is gone.
 *
 * Someone already holding a cookie should not be looking at this at all,
 * so send them where they were going -- but only if the workspace behind
 * that cookie still exists and has a profile. A cookie pointing at a
 * deleted workspace is exactly the case this screen is here to fix, so
 * bouncing on its mere presence would make it unreachable.
 */
export default async function SignInPage() {
  const account = await maybeAccount();
  if (account) {
    const profile = await api.getProfile(account).catch(() => null);
    if (profile?.name) redirect("/overview");
  }

  return (
    <div style={{ width: "100%", maxWidth: 440, margin: "0 auto", padding: "48px 0" }}>
      <div className="cw-card" style={{ padding: "clamp(24px, 4vw, 38px)" }}>
        <h1 className="cw-h1">Welcome back</h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--dim)" }}>
          The email you set up with.
        </p>

        <SignInForm />

        <hr className="cw-hr" style={{ margin: "26px 0 20px" }} />

        <p style={{ margin: 0, fontSize: 13.5, color: "var(--dim)" }}>
          First time?{" "}
          <Link href="/onboarding" style={{ color: "var(--orange-ink)", fontWeight: 600 }}>
            Set up your profile
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";

export const dynamic = "force-dynamic";

/**
 * Where a signed-in user actually lands.
 *
 * A brand-new account has no profile, so sending it straight to the
 * dashboard shows empty tiles with no explanation of what the product
 * does or what to do next -- the exact dead end hit when signing in for
 * the first time. Route on whether there's a profile instead: no profile
 * means they've never onboarded.
 */
export default async function Home() {
  const account = await requireAccount();

  // "No profile" and "couldn't ask" are different answers and must not
  // collapse into one. A backend blip returning null would otherwise dump
  // a long-standing user into onboarding staring at an empty form,
  // looking like their profile was wiped. On error, assume they're an
  // existing user and send them to the dashboard -- the worst case there
  // is a screen that says it can't reach the agent, not apparent data
  // loss.
  let hasProfile: boolean;
  try {
    const profile = await api.getProfile(account);
    hasProfile = Boolean(profile?.name);
  } catch {
    hasProfile = true;
  }

  redirect(hasProfile ? "/overview" : "/onboarding");
}

import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { requireAccessToken } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Where a signed-in user actually lands.
 *
 * A brand-new account has no profile, so sending it to the Approval
 * Inbox shows an empty screen with no explanation of what the product
 * does or what to do next -- the exact dead end hit when signing in for
 * the first time. Route on whether there's a profile instead: no profile
 * means they've never onboarded.
 */
export default async function Home() {
  const accessToken = await requireAccessToken();

  // "No profile" and "couldn't ask" are different answers and must not
  // collapse into one. A backend blip returning null would otherwise dump
  // a long-standing user into onboarding staring at an empty form,
  // looking like their profile was wiped. On error, assume they're an
  // existing user and send them to the inbox -- the worst case there is
  // an empty screen, not apparent data loss.
  let hasProfile: boolean;
  try {
    const profile = await api.getProfile(accessToken);
    hasProfile = Boolean(profile?.name);
  } catch {
    hasProfile = true;
  }

  redirect(hasProfile ? "/approvals" : "/onboarding");
}

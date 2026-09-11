import { api } from "@/lib/api";
import { maybeAccount } from "@/lib/account-server";
import { OnboardingFlow } from "./onboarding-flow";

export const dynamic = "force-dynamic";

/**
 * The front door. Unlike every other page this one must work with no
 * workspace at all -- that is the state it exists to resolve -- so it
 * asks for the cookie without requiring it.
 */
export default async function OnboardingPage() {
  const account = await maybeAccount();

  // Pre-fill if they started and came back: onboarding shouldn't punish
  // someone for closing the tab halfway through.
  const profile = account ? await api.getProfile(account).catch(() => null) : null;

  return <OnboardingFlow initial={profile} />;
}

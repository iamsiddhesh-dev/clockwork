import { api } from "@/lib/api";
import { requireAccessToken } from "@/lib/supabase/session";
import { OnboardingFlow } from "./onboarding-flow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const accessToken = await requireAccessToken();
  // Pre-fill if they started and came back -- onboarding shouldn't punish
  // someone for closing the tab halfway through.
  const profile = await api.getProfile(accessToken).catch(() => null);

  return <OnboardingFlow initial={profile} />;
}

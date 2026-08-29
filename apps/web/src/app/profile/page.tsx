import { api } from "@/lib/api";
import { requireAccessToken } from "@/lib/supabase/session";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const accessToken = await requireAccessToken();
  const profile = await api.getProfile(accessToken).catch(() => null);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        This is what Clockwork grounds itself in. Fit scoring ranks sourced work against your
        skills and positioning; drafted messages imitate your voice samples and cite your
        portfolio. An empty profile means the agent is guessing.
      </p>
      <ProfileForm initial={profile} />
    </div>
  );
}

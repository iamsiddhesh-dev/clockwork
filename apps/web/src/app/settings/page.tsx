import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { PageHead } from "@/components/ui";
import { SettingsView } from "./settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const account = await requireAccount();
  const [profile, summary] = await Promise.all([
    api.getProfile(account).catch(() => null),
    api.summary(account).catch(() => null),
  ]);

  return (
    <>
      <PageHead
        kicker="Settings"
        title="What the agent knows, and what it may do"
      />
      <SettingsView profile={profile} dailyCapUsd={summary?.daily_cap_usd ?? 5} />
    </>
  );
}

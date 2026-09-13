import { api, type Profile } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, PageHead } from "@/components/ui";
import { SettingsView } from "./settings-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

/** Marks "the profile couldn't be fetched", which must never be confused
 *  with "there is no profile yet" -- see below. */
const UNREACHABLE = Symbol("unreachable");

export default async function SettingsPage() {
  const account = await requireAccount();
  const [profile, summary, record] = await Promise.all([
    api.getProfile(account).catch((): typeof UNREACHABLE => UNREACHABLE),
    api.summary(account).catch(() => null),
    api.getAccount(account).catch(() => null),
  ]);

  // A failed fetch used to be caught into null, which the form reads as
  // "no profile" -- so a hiccup rendered an empty profile form over a real
  // one, one Save away from overwriting it with blanks. Show the retrying
  // screen instead; the form only appears over data it actually read.
  if (profile === UNREACHABLE) return <ApiDown what="Your settings" />;

  return (
    <>
      <PageHead kicker="Settings" title="What the agent knows, and what it may do" />
      <SettingsView
        profile={profile as Profile | null}
        account={record}
        dailyCapUsd={summary?.daily_cap_usd ?? 5}
      />
    </>
  );
}

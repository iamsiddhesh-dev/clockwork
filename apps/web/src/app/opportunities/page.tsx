import { api } from "@/lib/api";
import { requireAccessToken } from "@/lib/supabase/session";
import { OpportunityList } from "./opportunity-list";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const accessToken = await requireAccessToken();

  const [opportunities, sources, profile] = await Promise.all([
    api.listOpportunities(accessToken).catch(() => []),
    api.listSources(accessToken).catch(() => []),
    api.getProfile(accessToken).catch(() => null),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Opportunities</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        Contract and freelance work pulled from public feeds, scored against your profile. Sources:{" "}
        <a href="https://news.ycombinator.com" className="underline" target="_blank" rel="noopener noreferrer">
          Hacker News
        </a>
        ,{" "}
        <a href="https://remotive.com" className="underline" target="_blank" rel="noopener noreferrer">
          Remotive
        </a>
        , and{" "}
        <a href="https://remoteok.com" className="underline" target="_blank" rel="noopener noreferrer">
          RemoteOK
        </a>
        .
      </p>
      <OpportunityList
        initial={opportunities}
        sources={sources}
        hasProfile={Boolean(profile?.name)}
      />
    </div>
  );
}

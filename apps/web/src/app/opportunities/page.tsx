import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, PageHead } from "@/components/ui";
import { OpportunityList } from "./opportunity-list";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  hacker_news: "hn",
  remotive: "remotive",
  remoteok: "remoteok",
};

export default async function OpportunitiesPage() {
  const account = await requireAccount();

  // Deliberately NOT caught into an empty array: see ApiDown. Sources
  // and profile can fail softly (they only decorate), but the list
  // itself must never render an empty state it did not actually read.
  const opportunities = await api.listOpportunities(account).catch(() => null);
  const [sources, profile] = await Promise.all([
    api.listSources(account).catch(() => []),
    api.getProfile(account).catch(() => null),
  ]);

  if (!opportunities) return <ApiDown what="Opportunities" />;

  const live = opportunities.filter((o) => o.status !== "dismissed");
  const scored = live.filter((o) => o.fit_score !== null).length;
  const perSource = sources
    .map((source) => {
      const count = live.filter((o) => o.source_id === source.id).length;
      return `${SOURCE_LABEL[source.kind] ?? source.kind} ${count}`;
    })
    .join(" · ");

  return (
    <>
      <PageHead
        kicker="Opportunities"
        title="Scored against your portfolio"
        aside={
          <p
            className="cw-mono"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.6,
              color: "var(--quiet)",
              textAlign: "right",
            }}
          >
            {live.length} sourced · {scored} scored
            {perSource ? (
              <>
                <br />
                {perSource}
              </>
            ) : null}
          </p>
        }
      />
      <OpportunityList
        initial={opportunities}
        sources={sources}
        hasProfile={Boolean(profile?.name)}
      />
    </>
  );
}

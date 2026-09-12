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
  // `null` from these two means the call FAILED; an empty list or an
  // empty profile means the answer really is "none". Collapsing those
  // together is what made this screen announce "No profile yet" over a
  // workspace that plainly had one, which is the same class of lie as an
  // empty state rendered from a failed fetch.
  const [sources, profile] = await Promise.all([
    api.listSources(account).catch(() => null),
    api.getProfile(account).catch(() => null),
  ]);

  if (!opportunities) return <ApiDown what="Opportunities" />;

  const live = opportunities.filter((o) => o.status !== "dismissed");
  const scored = live.filter((o) => o.fit_score !== null).length;
  const perSource = (sources ?? [])
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
        sources={sources ?? []}
        // Undefined rather than false when the profile could not be
        // fetched, so the "you have no profile" banner only appears when
        // that is actually known to be true.
        hasProfile={profile === null ? undefined : Boolean(profile.name)}
      />
    </>
  );
}

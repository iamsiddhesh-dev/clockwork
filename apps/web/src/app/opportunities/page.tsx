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

/** Rows per page. Each card is tall -- title, rationale, evidence, the
 *  posting itself -- so ten is already a long scroll, and twenty would be
 *  the kind of page people stop reading a third of the way down. */
const PAGE_SIZE = 10;

export default async function OpportunitiesPage() {
  const account = await requireAccount();

  // Deliberately NOT caught into an empty array: see ApiDown. Sources,
  // stats and profile can fail softly (they only decorate), but the list
  // itself must never render an empty state it did not actually read.
  const first = await api.listOpportunities(account, { limit: PAGE_SIZE }).catch(() => null);
  // `null` from these means the call FAILED; an empty list or an empty
  // profile means the answer really is "none". Collapsing those together
  // is what made this screen announce "No profile yet" over a workspace
  // that plainly had one, which is the same class of lie as an empty
  // state rendered from a failed fetch.
  const [sources, profile, stats] = await Promise.all([
    api.listSources(account).catch(() => null),
    api.getProfile(account).catch(() => null),
    // Counted in the database over every row, not over the ten on
    // screen: a header that reads "10 sourced" on a workspace holding
    // eighty-four is a worse lie than no header.
    api.opportunityStats(account).catch(() => null),
  ]);

  if (!first) return <ApiDown what="Opportunities" />;

  const perSource = (sources ?? [])
    .map((source) => `${SOURCE_LABEL[source.kind] ?? source.kind} ${stats?.by_source[source.id] ?? 0}`)
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
            {stats ? `${stats.total} sourced · ${stats.scored} scored` : "—"}
            {stats && perSource ? (
              <>
                <br />
                {perSource}
              </>
            ) : null}
          </p>
        }
      />
      <OpportunityList
        initial={first.items}
        total={first.total}
        pageSize={PAGE_SIZE}
        sources={sources ?? []}
        // Undefined rather than false when the profile could not be
        // fetched, so the "you have no profile" banner only appears when
        // that is actually known to be true.
        hasProfile={profile === null ? undefined : Boolean(profile.name)}
      />
    </>
  );
}

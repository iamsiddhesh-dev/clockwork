import Link from "next/link";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, compactMoney, Empty, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const STAGE_ORDER = ["new", "qualified", "quoted", "won", "lost"] as const;

const SCORE_TONE: Record<string, string> = {
  hot: "var(--bad)",
  warm: "var(--warn)",
  cold: "var(--blue)",
};

const STAGE_TONE: Record<string, string> = {
  new: "var(--quiet)",
  qualified: "var(--blue)",
  quoted: "var(--orange-ink)",
  won: "var(--ok)",
  lost: "var(--quiet)",
};

export default async function DealsPage() {
  const account = await requireAccount();
  const deals = await api.listDeals(account).catch(() => null);
  if (!deals) return <ApiDown what="Deals" />;

  const pipeline = deals
    .filter((d) => d.stage !== "lost" && d.stage !== "won")
    .reduce((sum, d) => sum + (d.estimated_value ?? 0), 0);

  return (
    <>
      <PageHead
        kicker="Pipeline"
        title="Deals in flight"
        aside={
          <p
            className="cw-mono"
            style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: "var(--quiet)", textAlign: "right" }}
          >
            {deals.length} deal{deals.length === 1 ? "" : "s"}
            <br />
            {compactMoney(pipeline)} open
          </p>
        }
      />

      {deals.length === 0 ? (
        <Empty title="No deals yet">One appears when a lead is qualified.</Empty>
      ) : (
        <div className="cw-card" style={{ overflow: "hidden" }}>
          {deals
            .slice()
            .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
            .map((deal, index, all) => (
              <Link
                key={deal.id}
                href={`/threads/${deal.thread_id}`}
                className="cw-row"
                style={{
                  gap: 12,
                  padding: "16px 20px",
                  borderBottom: index === all.length - 1 ? "none" : "1px solid var(--rim)",
                }}
              >
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{deal.intent ?? "Untitled deal"}</div>
                  {deal.score_rationale && (
                    <div
                      style={{
                        marginTop: 5,
                        fontSize: 12.5,
                        lineHeight: 1.5,
                        color: "var(--quiet)",
                        display: "-webkit-box",
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {deal.score_rationale}
                    </div>
                  )}
                </div>

                <span
                  className="cw-status"
                  style={{ flex: "none", width: 74, color: STAGE_TONE[deal.stage] }}
                >
                  {deal.stage}
                </span>

                <span
                  className="cw-status"
                  style={{
                    flex: "none",
                    width: 52,
                    color: deal.score ? SCORE_TONE[deal.score] : "var(--quiet)",
                  }}
                >
                  {deal.score ?? "—"}
                </span>

                <span
                  className="cw-mono"
                  style={{ flex: "none", width: 88, textAlign: "right", fontSize: 12 }}
                >
                  {deal.estimated_value != null ? compactMoney(deal.estimated_value) : "—"}
                </span>

                <span
                  className="cw-mono"
                  style={{ flex: "none", width: 80, textAlign: "right", fontSize: 11, color: "var(--quiet)" }}
                >
                  {formatDate(deal.updated_at)}
                </span>
              </Link>
            ))}
        </div>
      )}
    </>
  );
}

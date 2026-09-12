import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, Empty, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  running: "var(--warn)",
  completed: "var(--ok)",
  failed: "var(--bad)",
};

export default async function RunsPage() {
  const account = await requireAccount();
  const runs = await api.listRuns(account).catch(() => null);
  if (!runs) return <ApiDown what="Runs" />;

  const spend = runs.reduce((sum, run) => sum + Number(run.total_cost_usd ?? 0), 0);

  return (
    <>
      <PageHead
        kicker="Run trace"
        title="Every tool call, every cent"
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
            {runs.length} run{runs.length === 1 ? "" : "s"}
            <br />${spend.toFixed(4)} total
          </p>
        }
      />

      {runs.length === 0 ? (
        <Empty title="Nothing has run yet">Every step of every run lands here.</Empty>
      ) : (
        <div className="cw-card" style={{ overflow: "hidden" }}>
          {runs.map((run, index) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              style={{
                display: "block",
                padding: "17px 20px",
                borderBottom: index === runs.length - 1 ? "none" : "1px solid var(--rim)",
                transition: "background var(--t)",
              }}
            >
              <div className="cw-row" style={{ gap: 10 }}>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  {run.trigger_type} trigger
                </span>
                <span
                  className="cw-mono"
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: STATUS_TONE[run.status] ?? "var(--quiet)",
                  }}
                >
                  {run.status}
                </span>
              </div>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: run.error ? "var(--bad)" : "var(--dim)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {run.outcome ?? run.error ?? "—"}
              </p>
              <p
                className="cw-mono"
                style={{ margin: "8px 0 0", fontSize: 11, color: "var(--quiet)" }}
              >
                {formatDateTime(run.started_at)} · ${Number(run.total_cost_usd ?? 0).toFixed(4)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

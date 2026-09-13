import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime, triggerLabel } from "@/lib/format";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, Empty, PageHead } from "@/components/ui";
import { Pager } from "@/components/pager";
import { offsetFor, PAGE_SIZE, pageFrom } from "@/lib/paging";

export const dynamic = "force-dynamic";

export const metadata = { title: "Runs" };

const STATUS_TONE: Record<string, string> = {
  running: "var(--warn)",
  completed: "var(--ok)",
  failed: "var(--bad)",
};

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  const account = await requireAccount();
  const page = pageFrom(await searchParams);
  const result = await api
    .listRuns(account, { limit: PAGE_SIZE, offset: offsetFor(page) })
    .catch(() => null);
  if (!result) return <ApiDown what="Runs" />;

  const { items: runs, total } = result;
  // Deliberately scoped to this page and labelled as such. Summing what
  // is in hand and calling it the total would quietly under-report the
  // moment there is a second page -- and cost is the number this project
  // is least entitled to be loose about.
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
            {total} run{total === 1 ? "" : "s"}
            <br />${spend.toFixed(4)} on this page
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
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {triggerLabel(run.trigger_type)}
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

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        noun="run"
        basePath="/runs"
      />
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { triggerLabel } from "@/lib/format";
import { requireAccount } from "@/lib/account-server";
import { Card } from "@/components/ui";
import { RunTrace } from "./run-trace";
import { cleanText, runErrorText } from "@/lib/humanize";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

export const metadata = { title: "Run trace" };

export default async function RunDetailPage(props: PageProps<"/runs/[id]">) {
  const { id } = await props.params;
  const account = await requireAccount();

  const run = await api.getRun(account, id).catch(() => null);
  if (!run) notFound();

  return (
    <>
      <header className="cw-page-head" style={{ display: "block" }}>
        <Link href="/runs" className="cw-mono" style={{ fontSize: 11, color: "var(--quiet)" }}>
          ← All runs
        </Link>
        <h1 className="cw-h1">{triggerLabel(run.trigger_type)}</h1>
        <p className="cw-mono" style={{ margin: "14px 0 0", fontSize: 11, color: "var(--quiet)" }}>
          <LocalTime iso={run.started_at} /> · ${Number(run.total_cost_usd ?? 0).toFixed(4)}
        </p>
      </header>

      {run.outcome && (
        <Card pad={22}>
          <div className="cw-label">Outcome</div>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 13.5,
              lineHeight: 1.65,
              color: "var(--sub)",
              whiteSpace: "pre-wrap",
            }}
          >
            {cleanText(run.outcome)}
          </p>
        </Card>
      )}

      {run.error && (
        <div
          className="cw-card"
          style={{ padding: 22, borderColor: "var(--bad)" }}
        >
          <div className="cw-label" style={{ color: "var(--bad)" }}>
            Failed
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--bad)" }}>
            {runErrorText(run.error)}
          </p>
        </div>
      )}

      <RunTrace runId={run.id} initialStatus={run.status} />
    </>
  );
}

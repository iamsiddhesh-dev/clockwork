import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requireAccessToken } from "@/lib/supabase/session";
import { RunTrace } from "./run-trace";

export const dynamic = "force-dynamic";

export default async function RunDetailPage(props: PageProps<"/runs/[id]">) {
  const { id } = await props.params;
  const accessToken = await requireAccessToken();

  const run = await api.getRun(accessToken, id).catch(() => null);
  if (!run) notFound();

  return (
    <div>
      <Link href="/runs" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All runs
      </Link>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight capitalize">
        {run.trigger_type} trigger
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Started {formatDateTime(run.started_at)} · ${formatNumber(run.total_cost_usd)}
        {run.trigger_ref && <> · ref {run.trigger_ref}</>}
      </p>

      {run.outcome && (
        <p className="mt-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {run.outcome}
        </p>
      )}
      {run.error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {run.error}
        </p>
      )}

      <RunTrace runId={run.id} initialStatus={run.status} />
    </div>
  );
}

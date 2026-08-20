import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requireAccessToken } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default async function RunsPage() {
  const accessToken = await requireAccessToken();
  const runs = await api.listRuns(accessToken).catch(() => []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Run Trace</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Every time Clockwork ran: what triggered it, every tool it called, and what it cost.
      </p>

      {runs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No runs yet.
        </div>
      ) : (
        <ul className="mt-6 flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/runs/${run.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-100/60 dark:hover:bg-zinc-900/60"
              >
                <div className="min-w-0">
                  <p className="font-medium capitalize">{run.trigger_type} trigger</p>
                  <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                    {run.outcome ?? run.error ?? "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-zinc-400">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[run.status] ?? ""}`}
                  >
                    {run.status}
                  </span>
                  <p className="mt-1">
                    ${formatNumber(run.total_cost_usd)} · {formatDateTime(run.started_at)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

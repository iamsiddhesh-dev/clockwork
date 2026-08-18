import Link from "next/link";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const STAGE_ORDER = ["new", "qualified", "quoted", "won", "lost"] as const;

const SCORE_STYLES: Record<string, string> = {
  hot: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  warm: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  cold: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

export default async function DealsPage() {
  const deals = await api.listDeals().catch(() => []);
  const totalPipeline = deals
    .filter((d) => d.stage !== "lost")
    .reduce((sum, d) => sum + (d.estimated_value ?? 0), 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Pipeline: <span className="font-medium text-zinc-900 dark:text-zinc-100">${formatNumber(totalPipeline)}</span>
        </p>
      </div>

      {deals.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No deals yet.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Intent</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Est. value</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {deals
                .slice()
                .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
                .map((deal) => (
                  <tr key={deal.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                    <td className="px-4 py-3">
                      <Link href={`/threads/${deal.thread_id}`} className="hover:underline">
                        {deal.intent ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 capitalize">{deal.stage}</td>
                    <td className="px-4 py-3">
                      {deal.score ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SCORE_STYLES[deal.score]}`}>
                          {deal.score}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {deal.estimated_value != null ? `$${formatNumber(deal.estimated_value)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(deal.updated_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

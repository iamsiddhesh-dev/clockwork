import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const SCORE_STYLES: Record<string, string> = {
  hot: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  warm: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  cold: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

export default async function ThreadDetailPage(props: PageProps<"/threads/[id]">) {
  const { id } = await props.params;

  const data = await api.getThread(id).catch(() => null);
  if (!data) notFound();

  const { thread, messages, deal } = data;

  return (
    <div>
      <Link href="/threads" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All threads
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {thread.contact_name ?? "Unknown contact"}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {thread.contact_email ?? "no email"} · {thread.channel}
          </p>
        </div>
        {deal?.score && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${SCORE_STYLES[deal.score]}`}>
            {deal.score}
          </span>
        )}
      </div>

      {deal && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <p>
            <span className="font-medium">Stage:</span> {deal.stage}
            {deal.estimated_value != null && (
              <>
                {" · "}
                <span className="font-medium">Est. value:</span> ${formatNumber(deal.estimated_value)}
              </>
            )}
          </p>
          {deal.score_rationale && (
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">{deal.score_rationale}</p>
          )}
        </div>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {messages.map((message) => (
          <li
            key={message.id}
            className={`max-w-2xl rounded-lg p-3 text-sm ${
              message.direction === "inbound"
                ? "self-start bg-zinc-100 dark:bg-zinc-800"
                : "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            }`}
          >
            <p className="whitespace-pre-wrap">{message.body}</p>
            <p className="mt-1 text-xs opacity-60">
              {message.direction} · {formatDateTime(message.sent_at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

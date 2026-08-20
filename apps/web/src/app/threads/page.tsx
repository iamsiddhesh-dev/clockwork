import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireAccessToken } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";

export default async function ThreadsPage() {
  const accessToken = await requireAccessToken();
  const threads = await api.listThreads(accessToken).catch(() => []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Threads</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Every conversation Clockwork is tracking.
      </p>

      {threads.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No threads yet.
        </div>
      ) : (
        <ul className="mt-6 flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/threads/${thread.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-100/60 dark:hover:bg-zinc-900/60"
              >
                <div>
                  <p className="font-medium">{thread.contact_name ?? "Unknown contact"}</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {thread.contact_email ?? "no email"} · {thread.channel}
                  </p>
                </div>
                <div className="text-right text-xs text-zinc-400">
                  <p className={thread.status === "open" ? "text-emerald-600 dark:text-emerald-400" : ""}>
                    {thread.status}
                  </p>
                  <p>
                    {thread.last_message_at ? formatDateTime(thread.last_message_at) : "no messages"}
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

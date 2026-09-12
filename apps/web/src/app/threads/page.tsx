import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, Empty, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ThreadsPage() {
  const account = await requireAccount();
  const threads = await api.listThreads(account).catch(() => null);
  if (!threads) return <ApiDown what="Threads" />;

  return (
    <>
      <PageHead
        kicker="Threads"
        title="Conversations"
        aside={
          <p className="cw-mono" style={{ margin: 0, fontSize: 11, color: "var(--quiet)" }}>
            {threads.length} thread{threads.length === 1 ? "" : "s"}
          </p>
        }
      />

      {threads.length === 0 ? (
        <Empty title="No conversations yet">
          One starts when a lead arrives or a pitch goes out.
        </Empty>
      ) : (
        <div className="cw-card" style={{ overflow: "hidden" }}>
          {threads.map((thread, index) => (
            <Link
              key={thread.id}
              href={`/threads/${thread.id}`}
              className="cw-row"
              style={{
                gap: 12,
                padding: "16px 20px",
                borderBottom: index === threads.length - 1 ? "none" : "1px solid var(--rim)",
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {thread.contact_name ?? "Unknown contact"}
                </div>
                <div className="cw-mono" style={{ marginTop: 5, fontSize: 11, color: "var(--quiet)" }}>
                  {thread.contact_email ?? "no email on file"} · {thread.channel}
                </div>
              </div>
              <div style={{ flex: "none", textAlign: "right" }}>
                <span
                  className="cw-status"
                  style={{ color: thread.status === "open" ? "var(--ok)" : "var(--quiet)" }}
                >
                  {thread.status}
                </span>
                <div className="cw-mono" style={{ marginTop: 6, fontSize: 11, color: "var(--quiet)" }}>
                  {thread.last_message_at
                    ? formatDateTime(thread.last_message_at)
                    : "no messages"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

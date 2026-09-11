import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireAccount } from "@/lib/account-server";
import { Card, compactMoney } from "@/components/ui";

export const dynamic = "force-dynamic";

const SCORE_TONE: Record<string, string> = {
  hot: "var(--bad)",
  warm: "var(--warn)",
  cold: "var(--blue)",
};

export default async function ThreadDetailPage(props: PageProps<"/threads/[id]">) {
  const { id } = await props.params;
  const account = await requireAccount();

  const data = await api.getThread(account, id).catch(() => null);
  if (!data) notFound();

  const { thread, messages, deal } = data;

  return (
    <>
      <header className="cw-page-head" style={{ display: "block" }}>
        <Link href="/threads" className="cw-mono" style={{ fontSize: 11, color: "var(--quiet)" }}>
          ← All threads
        </Link>
        <div className="cw-row" style={{ alignItems: "flex-end", gap: 16 }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <h1 className="cw-h1">{thread.contact_name ?? "Unknown contact"}</h1>
            <p className="cw-mono" style={{ margin: "12px 0 0", fontSize: 11, color: "var(--quiet)" }}>
              {thread.contact_email ?? "no email on file"} · {thread.channel}
            </p>
          </div>
          {deal?.score && (
            <span className="cw-status" style={{ color: SCORE_TONE[deal.score], flex: "none" }}>
              {deal.score}
            </span>
          )}
        </div>
      </header>

      {deal && (
        <Card pad={22}>
          <div className="cw-row" style={{ gap: 24 }}>
            <div>
              <div className="cw-label">Stage</div>
              <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>
                {deal.stage}
              </div>
            </div>
            {deal.estimated_value != null && (
              <div>
                <div className="cw-label">Est. value</div>
                <div className="cw-num" style={{ marginTop: 8, fontSize: 14 }}>
                  {compactMoney(deal.estimated_value)}
                </div>
              </div>
            )}
          </div>
          {deal.score_rationale && (
            <p style={{ margin: "16px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--dim)", maxWidth: "62ch" }}>
              {deal.score_rationale}
            </p>
          )}
        </Card>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((message) => {
          const inbound = message.direction === "inbound";
          return (
            <li
              key={message.id}
              style={{
                maxWidth: "min(70ch, 86%)",
                alignSelf: inbound ? "flex-start" : "flex-end",
                border: `1px solid ${inbound ? "var(--rim)" : "var(--orange-bd)"}`,
                background: inbound ? "var(--glass)" : "var(--orange-bg)",
                borderRadius: 16,
                padding: "16px 18px",
                boxShadow: "var(--hi)",
              }}
            >
              <p
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontSize: 13.5,
                  lineHeight: 1.65,
                  color: "var(--sub)",
                }}
              >
                {message.body}
              </p>
              <p
                className="cw-mono"
                style={{ margin: "12px 0 0", fontSize: 11, color: "var(--quiet)" }}
              >
                {message.direction} · {formatDateTime(message.sent_at)}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

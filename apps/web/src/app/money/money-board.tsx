"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { api, type Deal, type Invoice, type Quote } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { requireAccountClient } from "@/lib/account";
import { Card, Empty, money } from "@/components/ui";

const QUOTE_TONE: Record<Quote["status"], string> = {
  draft: "var(--quiet)",
  sent: "var(--blue)",
  accepted: "var(--ok)",
  declined: "var(--quiet)",
  expired: "var(--warn)",
};

const INVOICE_TONE: Record<Invoice["status"], string> = {
  draft: "var(--quiet)",
  sent: "var(--blue)",
  paid: "var(--ok)",
  void: "var(--quiet)",
};

export function MoneyBoard({
  initialQuotes,
  initialInvoices,
  deals,
}: {
  initialQuotes: Quote[];
  initialInvoices: Invoice[];
  deals: Deal[];
}) {
  const [quotes, setQuotes] = useState(initialQuotes);
  const [invoices, setInvoices] = useState(initialInvoices);
  const [tab, setTab] = useState<"quotes" | "invoices">("quotes");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  // A deal is quotable once it exists and does not already have a live
  // quote. Listed here rather than only on the pipeline so the whole
  // money tail sits on one screen.
  const quotable = useMemo(() => {
    const live = new Set(
      quotes.filter((q) => q.status === "draft" || q.status === "sent").map((q) => q.deal_id),
    );
    return deals.filter((d) => !live.has(d.id) && d.stage !== "lost" && d.stage !== "won");
  }, [deals, quotes]);

  const refresh = useCallback(async () => {
    const account = requireAccountClient();
    const [q, i] = await Promise.all([api.listQuotes(account), api.listInvoices(account)]);
    setQuotes(q);
    setInvoices(i);
  }, []);

  const run = useCallback(
    async (key: string, fn: (account: string) => Promise<string | null>) => {
      setBusy(key);
      setError(null);
      setNote(null);
      try {
        const message = await fn(requireAccountClient());
        if (message) setNote(message);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const paid = invoices.filter((i) => i.status === "paid");
  const outstanding = invoices
    .filter((i) => i.status === "sent")
    .reduce((sum, i) => sum + i.amount, 0);
  const collected = paid.reduce((sum, i) => sum + i.amount, 0);
  const overdue = invoices.filter(
    (i) => i.status === "sent" && i.due_at && new Date(i.due_at) < new Date(),
  );
  const currency = invoices[0]?.currency ?? quotes[0]?.currency ?? "USD";

  return (
    <>
      <Card pad={26}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 36 }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div className="cw-kicker">Collected</div>
            <div className="cw-num" style={{ marginTop: 16, fontSize: "clamp(28px, 4vw, 40px)" }}>
              {money(collected, currency)}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--dim)" }}>
              {paid.length} invoice{paid.length === 1 ? "" : "s"} paid
            </p>
          </div>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div className="cw-kicker">Outstanding</div>
            <div
              className="cw-num"
              style={{
                marginTop: 16,
                fontSize: "clamp(28px, 4vw, 40px)",
                color: overdue.length ? "var(--bad)" : "var(--ink)",
              }}
            >
              {money(outstanding, currency)}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--dim)" }}>
              {overdue.length
                ? `${overdue.length} overdue`
                : outstanding > 0
                  ? "none overdue yet"
                  : "nothing owed"}
            </p>
          </div>
        </div>
      </Card>

      {note && <p style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}>{note}</p>}
      {error && <p style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{error}</p>}

      <div className="cw-seg" style={{ alignSelf: "flex-start" }}>
        <button data-on={tab === "quotes"} onClick={() => setTab("quotes")}>
          Quotes
        </button>
        <button data-on={tab === "invoices"} onClick={() => setTab("invoices")}>
          Invoices
        </button>
      </div>

      {tab === "quotes" && (
        <div className="cw-stack">
          {quotable.length > 0 && (
            <div className="cw-dashed" style={{ padding: 22 }}>
              <div className="cw-label">Ready to quote</div>
              <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
                {quotable.map((deal) => (
                  <li
                    key={deal.id}
                    className="cw-row"
                    style={{ padding: "10px 0", borderTop: "1px solid var(--rim)" }}
                  >
                    <Link
                      href={`/threads/${deal.thread_id}`}
                      style={{ flex: "1 1 220px", fontSize: 14, fontWeight: 600, minWidth: 0 }}
                    >
                      {deal.intent ?? "Untitled deal"}
                    </Link>
                    <span className="cw-mono" style={{ fontSize: 11, color: "var(--quiet)" }}>
                      {deal.stage}
                    </span>
                    <button
                      className="cw-btn cw-btn-sm cw-btn-primary"
                      disabled={busy !== null}
                      onClick={() =>
                        run(`quote-${deal.id}`, async (account) => {
                          const result = await api.quoteDeal(account, deal.id);
                          return `Quote drafted for ${money(result.total, result.currency)} — waiting in the Approval Inbox.`;
                        })
                      }
                    >
                      {busy === `quote-${deal.id}` ? "Pricing…" : "Draft quote"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quotes.length === 0 ? (
            <Empty title="No quotes yet">
              A quote is priced off your rate card once a deal is worth pricing. The model proposes
              line items; the totals are computed in code.
            </Empty>
          ) : (
            quotes.map((quote) => {
              const deal = dealById.get(quote.deal_id);
              const invoiced = invoices.some((i) => i.quote_id === quote.id && i.status !== "void");
              return (
                <article key={quote.id} className="cw-card" style={{ padding: 24 }}>
                  <div className="cw-row" style={{ alignItems: "baseline", gap: 14 }}>
                    <span className="cw-num" style={{ fontSize: 26 }}>
                      {money(quote.total, quote.currency)}
                    </span>
                    <span className="cw-status" style={{ color: QUOTE_TONE[quote.status] }}>
                      {quote.status}
                    </span>
                    <span
                      className="cw-mono"
                      style={{ marginLeft: "auto", fontSize: 11, color: "var(--quiet)" }}
                    >
                      {quote.valid_until
                        ? `valid until ${formatDate(quote.valid_until)}`
                        : formatDate(quote.created_at)}
                    </span>
                  </div>

                  {deal?.intent && (
                    <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--dim)" }}>
                      {deal.intent}
                    </p>
                  )}

                  <ul style={{ listStyle: "none", margin: "20px 0 0", padding: 0, fontSize: 13.5 }}>
                    {quote.line_items.map((item, index) => (
                      <li
                        key={index}
                        style={{
                          display: "flex",
                          gap: 16,
                          padding: "11px 0",
                          borderBottom:
                            index === quote.line_items.length - 1 ? "none" : "1px solid var(--rim)",
                        }}
                      >
                        <span style={{ flex: 1, color: "var(--dim)" }}>
                          {item.description}
                          {item.quantity !== 1 || item.unit !== "project" ? (
                            <span className="cw-mono" style={{ color: "var(--quiet)" }}>
                              {" — "}
                              {item.quantity}
                              {item.unit === "hour" ? "h" : ` ${item.unit}`}
                            </span>
                          ) : null}
                        </span>
                        <span className="cw-mono" style={{ flex: "none" }}>
                          {item.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p
                    className="cw-mono"
                    style={{ margin: "16px 0 0", fontSize: 11, color: "var(--quiet)" }}
                  >
                    {quote.timeline ? `${quote.timeline} · ` : ""}totals computed in code
                  </p>

                  <div className="cw-row" style={{ gap: 9, marginTop: 22 }}>
                    {quote.status === "draft" && (
                      <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>
                        Waiting in the Approval Inbox — nothing has been sent.
                      </span>
                    )}
                    {quote.status === "sent" && (
                      <>
                        <button
                          className="cw-btn cw-btn-primary"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`accept-${quote.id}`, async (account) => {
                              await api.acceptQuote(account, quote.id);
                              return "Marked accepted. You can raise the invoice now.";
                            })
                          }
                        >
                          Client accepted
                        </button>
                        <button
                          className="cw-btn"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`decline-${quote.id}`, async (account) => {
                              await api.declineQuote(account, quote.id);
                              return "Marked declined; the deal is closed as lost.";
                            })
                          }
                        >
                          Client declined
                        </button>
                      </>
                    )}
                    {quote.status === "accepted" &&
                      (invoiced ? (
                        <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>Invoiced.</span>
                      ) : (
                        <button
                          className="cw-btn cw-btn-primary"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`invoice-${quote.id}`, async (account) => {
                              const result = await api.invoiceQuote(account, quote.id);
                              return `Invoice ${result.number} drafted — waiting in the Approval Inbox.`;
                            })
                          }
                        >
                          {busy === `invoice-${quote.id}` ? "Raising…" : "Raise invoice"}
                        </button>
                      ))}
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {tab === "invoices" && (
        <div className="cw-stack">
          {invoices.length === 0 ? (
            <Empty title="No invoices yet">
              An invoice can only be raised once a human records that the client accepted the quote.
              The agent has no tool that decides that for you.
            </Empty>
          ) : (
            invoices.map((invoice) => {
              const isOverdue =
                invoice.status === "sent" &&
                invoice.due_at != null &&
                new Date(invoice.due_at) < new Date();
              return (
                <article key={invoice.id} className="cw-card" style={{ padding: 24 }}>
                  <div className="cw-row" style={{ alignItems: "baseline", gap: 14 }}>
                    <span className="cw-mono" style={{ fontSize: 12, color: "var(--quiet)" }}>
                      {invoice.number}
                    </span>
                    <span className="cw-num" style={{ fontSize: 26 }}>
                      {money(invoice.amount, invoice.currency)}
                    </span>
                    <span
                      className="cw-status"
                      style={{ color: isOverdue ? "var(--bad)" : INVOICE_TONE[invoice.status] }}
                    >
                      {isOverdue ? "overdue" : invoice.status}
                    </span>
                    <span
                      className="cw-mono"
                      style={{ marginLeft: "auto", fontSize: 11, color: "var(--quiet)" }}
                    >
                      {invoice.due_at ? `due ${formatDate(invoice.due_at)}` : "no due date"}
                    </span>
                  </div>

                  {invoice.chase_count > 0 && (
                    <p
                      style={{
                        margin: "14px 0 0",
                        fontSize: 13.5,
                        lineHeight: 1.6,
                        color: "var(--sub)",
                        maxWidth: "58ch",
                      }}
                    >
                      {invoice.chase_count} reminder{invoice.chase_count === 1 ? "" : "s"} sent
                      {invoice.last_chased_at
                        ? `, last on ${formatDate(invoice.last_chased_at)}`
                        : ""}
                      .
                      {invoice.chase_count >= 2
                        ? " The next one names the overdue period and asks for a payment date."
                        : ""}
                    </p>
                  )}

                  <div className="cw-row" style={{ gap: 9, marginTop: 22 }}>
                    {invoice.status === "draft" && (
                      <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>
                        Waiting in the Approval Inbox — nothing has been sent.
                      </span>
                    )}
                    {invoice.status === "sent" && (
                      <>
                        <button
                          className="cw-btn cw-btn-primary"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`paid-${invoice.id}`, async (account) => {
                              await api.markInvoicePaid(account, invoice.id);
                              return `${invoice.number} marked paid — the chase is cancelled and the deal is won.`;
                            })
                          }
                        >
                          Mark paid
                        </button>
                        <button
                          className="cw-btn"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`chase-${invoice.id}`, async (account) => {
                              const result = await api.chaseInvoice(account, invoice.id);
                              // "Nothing to chase" is a real, correct answer
                              // -- surface it rather than leaving the button
                              // looking broken.
                              return result.action === "none"
                                ? `Nothing to chase: ${result.reason}.`
                                : `Reminder drafted (${result.days_overdue} days overdue) — waiting in the Approval Inbox.`;
                            })
                          }
                        >
                          {busy === `chase-${invoice.id}` ? "Drafting…" : "Chase now"}
                        </button>
                      </>
                    )}
                    {invoice.status === "paid" && invoice.paid_at && (
                      <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>
                        Paid {formatDate(invoice.paid_at)}.
                      </span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

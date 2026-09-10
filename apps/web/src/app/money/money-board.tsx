"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { api, type Deal, type Invoice, type Quote } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const QUOTE_STATUS: Record<Quote["status"], string> = {
  draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  sent: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  declined: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  expired: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const INVOICE_STATUS: Record<Invoice["status"], string> = {
  draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  sent: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  void: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${className}`}>
      {children}
    </span>
  );
}

function Action({
  onClick,
  disabled,
  children,
  tone = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  tone?: "default" | "primary";
}) {
  const styles =
    tone === "primary"
      ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

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
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }, [supabase]);

  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  // A deal is quotable once it has been qualified and doesn't already
  // have a live quote. Showing them here rather than only on the Deals
  // page keeps the whole money tail on one screen.
  const quotable = useMemo(() => {
    const live = new Set(
      quotes.filter((q) => q.status === "draft" || q.status === "sent").map((q) => q.deal_id),
    );
    return deals.filter((d) => !live.has(d.id) && d.stage !== "lost" && d.stage !== "won");
  }, [deals, quotes]);

  const refresh = useCallback(async () => {
    const token = await getToken();
    const [q, i] = await Promise.all([api.listQuotes(token), api.listInvoices(token)]);
    setQuotes(q);
    setInvoices(i);
  }, [getToken]);

  const run = useCallback(
    async (key: string, fn: (token: string) => Promise<string | null>) => {
      setBusy(key);
      setError(null);
      setNote(null);
      try {
        const token = await getToken();
        const message = await fn(token);
        if (message) setNote(message);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [getToken, refresh],
  );

  const overdueTotal = invoices
    .filter((i) => i.status === "sent" && i.due_at && new Date(i.due_at) < new Date())
    .reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="mt-6 space-y-8">
      {note && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          {note}
        </p>
      )}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {/* ── deals waiting to be priced ───────────────────────────────── */}
      {quotable.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Ready to quote
          </h2>
          <ul className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {quotable.map((deal) => (
              <li key={deal.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/threads/${deal.thread_id}`} className="flex-1 text-sm hover:underline">
                  {deal.intent ?? "Untitled deal"}
                </Link>
                <span className="text-xs capitalize text-zinc-500 dark:text-zinc-400">
                  {deal.stage}
                </span>
                <Action
                  tone="primary"
                  disabled={busy !== null}
                  onClick={() =>
                    run(`quote-${deal.id}`, async (token) => {
                      const result = await api.quoteDeal(token, deal.id);
                      return `Quote drafted for ${money(result.total, result.currency)} — waiting in the Approval Inbox.`;
                    })
                  }
                >
                  {busy === `quote-${deal.id}` ? "Pricing…" : "Draft quote"}
                </Action>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── quotes ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Quotes
        </h2>
        {quotes.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No quotes yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {quotes.map((quote) => {
              const deal = dealById.get(quote.deal_id);
              const invoiced = invoices.some((i) => i.quote_id === quote.id && i.status !== "void");
              return (
                <li
                  key={quote.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-medium">{money(quote.total, quote.currency)}</span>
                    <Badge className={QUOTE_STATUS[quote.status]}>{quote.status}</Badge>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {deal?.intent ?? "—"}
                    </span>
                    <span className="ml-auto text-xs text-zinc-400">
                      {quote.valid_until
                        ? `valid until ${formatDate(quote.valid_until)}`
                        : formatDate(quote.created_at)}
                    </span>
                  </div>

                  <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {quote.line_items.map((item, index) => (
                      <li key={index} className="flex gap-3">
                        <span className="flex-1">{item.description}</span>
                        <span className="tabular-nums">{money(item.amount, quote.currency)}</span>
                      </li>
                    ))}
                  </ul>
                  {quote.timeline && (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Timeline: {quote.timeline}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {quote.status === "draft" && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Waiting in the Approval Inbox — nothing has been sent.
                      </span>
                    )}
                    {quote.status === "sent" && (
                      <>
                        <Action
                          tone="primary"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`accept-${quote.id}`, async (token) => {
                              await api.acceptQuote(token, quote.id);
                              return "Marked accepted. You can raise the invoice now.";
                            })
                          }
                        >
                          Client accepted
                        </Action>
                        <Action
                          disabled={busy !== null}
                          onClick={() =>
                            run(`decline-${quote.id}`, async (token) => {
                              await api.declineQuote(token, quote.id);
                              return "Marked declined; the deal is closed as lost.";
                            })
                          }
                        >
                          Client declined
                        </Action>
                      </>
                    )}
                    {quote.status === "accepted" &&
                      (invoiced ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          Invoiced.
                        </span>
                      ) : (
                        <Action
                          tone="primary"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`invoice-${quote.id}`, async (token) => {
                              const result = await api.invoiceQuote(token, quote.id);
                              return `Invoice ${result.number} drafted — waiting in the Approval Inbox.`;
                            })
                          }
                        >
                          {busy === `invoice-${quote.id}` ? "Raising…" : "Raise invoice"}
                        </Action>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── invoices ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Invoices
          </h2>
          {overdueTotal > 0 && (
            <span className="text-xs text-red-700 dark:text-red-400">
              {money(overdueTotal, invoices[0]?.currency ?? "USD")} overdue
            </span>
          )}
        </div>
        {invoices.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No invoices yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {invoices.map((invoice) => {
              const overdue =
                invoice.status === "sent" &&
                invoice.due_at != null &&
                new Date(invoice.due_at) < new Date();
              return (
                <li
                  key={invoice.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-sm">{invoice.number}</span>
                    <span className="font-medium">{money(invoice.amount, invoice.currency)}</span>
                    <Badge className={INVOICE_STATUS[invoice.status]}>{invoice.status}</Badge>
                    {overdue && (
                      <span className="text-xs font-medium text-red-700 dark:text-red-400">
                        overdue
                      </span>
                    )}
                    <span className="ml-auto text-xs text-zinc-400">
                      {invoice.due_at ? `due ${formatDate(invoice.due_at)}` : "no due date"}
                    </span>
                  </div>

                  {invoice.chase_count > 0 && (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {invoice.chase_count} reminder{invoice.chase_count === 1 ? "" : "s"} sent
                      {invoice.last_chased_at ? `, last on ${formatDate(invoice.last_chased_at)}` : ""}.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {invoice.status === "draft" && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Waiting in the Approval Inbox — nothing has been sent.
                      </span>
                    )}
                    {invoice.status === "sent" && (
                      <>
                        <Action
                          tone="primary"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`paid-${invoice.id}`, async (token) => {
                              await api.markInvoicePaid(token, invoice.id);
                              return `${invoice.number} marked paid — the chase is cancelled and the deal is won.`;
                            })
                          }
                        >
                          Mark paid
                        </Action>
                        <Action
                          disabled={busy !== null}
                          onClick={() =>
                            run(`chase-${invoice.id}`, async (token) => {
                              const result = await api.chaseInvoice(token, invoice.id);
                              // "Nothing to chase" is a real, correct
                              // answer here -- surface it as such rather
                              // than leaving the button looking broken.
                              return result.action === "none"
                                ? `Nothing to chase: ${result.reason}.`
                                : `Reminder drafted (${result.days_overdue} days overdue) — waiting in the Approval Inbox.`;
                            })
                          }
                        >
                          {busy === `chase-${invoice.id}` ? "Drafting…" : "Chase now"}
                        </Action>
                      </>
                    )}
                    {invoice.status === "paid" && invoice.paid_at && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Paid {formatDate(invoice.paid_at)}.
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

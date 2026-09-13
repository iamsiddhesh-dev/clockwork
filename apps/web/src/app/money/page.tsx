import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import Link from "next/link";
import { ApiDown, PageHead } from "@/components/ui";
import { MoneyBoard } from "./money-board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Money" };

export default async function MoneyPage() {
  const account = await requireAccount();

  const [quotes, invoices, deals, summary] = await Promise.all([
    api.listQuotes(account).catch(() => null),
    api.listInvoices(account).catch(() => null),
    // Unpaginated on purpose: the board decides which deals are still
    // quotable by checking every deal against every live quote, so a
    // partial read here would offer to re-quote something already
    // quoted. See the /deals route's own note.
    api.listDeals(account).catch(() => null),
    // What the agent itself has cost, beside what clients owe. Optional:
    // the board still renders if this one read fails.
    api.summary(account).catch(() => null),
  ]);

  if (!quotes || !invoices || !deals) return <ApiDown what="Quotes and invoices" />;

  return (
    <>
      <PageHead
        kicker="Money"
        title="Quote, invoice, chase"
        aside={
          summary && (
            <Link href="/runs" className="cw-mono" style={{ fontSize: 11, color: "var(--quiet)" }}>
              AI cost today ${summary.spent_today_usd.toFixed(4)} · per run in Runs →
            </Link>
          )
        }
      />
      <MoneyBoard initialQuotes={quotes} initialInvoices={invoices} deals={deals.items} />
    </>
  );
}

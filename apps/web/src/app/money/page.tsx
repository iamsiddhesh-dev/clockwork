import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, PageHead } from "@/components/ui";
import { MoneyBoard } from "./money-board";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const account = await requireAccount();

  const [quotes, invoices, deals] = await Promise.all([
    api.listQuotes(account).catch(() => null),
    api.listInvoices(account).catch(() => null),
    api.listDeals(account).catch(() => null),
  ]);

  if (!quotes || !invoices || !deals) return <ApiDown what="Quotes and invoices" />;

  return (
    <>
      <PageHead
        kicker="Money"
        title="Quote, invoice, chase"
        aside={
          <p
            style={{
              margin: 0,
              flex: "1 1 280px",
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--dim)",
              maxWidth: "44ch",
            }}
          >
            The agent writes and schedules all three. You decide what the client actually said
            &mdash; nothing here can mark itself accepted or paid.
          </p>
        }
      />
      <MoneyBoard initialQuotes={quotes} initialInvoices={invoices} deals={deals} />
    </>
  );
}

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
          <p className="cw-mono" style={{ margin: 0, fontSize: 11, color: "var(--quiet)" }}>
            you confirm what the client said
          </p>
        }
      />
      <MoneyBoard initialQuotes={quotes} initialInvoices={invoices} deals={deals} />
    </>
  );
}

import { api } from "@/lib/api";
import { requireAccessToken } from "@/lib/supabase/session";
import { MoneyBoard } from "./money-board";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const accessToken = await requireAccessToken();

  const [quotes, invoices, deals] = await Promise.all([
    api.listQuotes(accessToken).catch(() => []),
    api.listInvoices(accessToken).catch(() => []),
    api.listDeals(accessToken).catch(() => []),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
        Quote, invoice, and chase. The agent writes and schedules all three; you decide what the
        client actually said. Nothing here can mark itself accepted or paid.
      </p>
      <MoneyBoard initialQuotes={quotes} initialInvoices={invoices} deals={deals} />
    </div>
  );
}

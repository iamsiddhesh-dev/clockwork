import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, PageHead } from "@/components/ui";
import { ApprovalInbox } from "./approval-inbox";
import { ApprovalHistory } from "./approval-history";

export const dynamic = "force-dynamic";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const account = await requireAccount();
  const [approvals, decided] = await Promise.all([
    api.listApprovals(account).catch(() => null),
    // Decoration, not the point of the page: if history can't load, the
    // inbox still must.
    api.listApprovals(account, "decided").catch(() => []),
  ]);
  if (!approvals) return <ApiDown what="The approval inbox" />;

  return (
    <>
      <PageHead
        kicker="Requires approval"
        kickerColor="var(--orange-ink)"
        title={
          approvals.length === 0
            ? "Nothing waiting on you"
            : `${approvals.length} client-facing action${approvals.length === 1 ? "" : "s"}`
        }
      />
      <ApprovalInbox initialApprovals={approvals} />
      <ApprovalHistory decided={decided} />
    </>
  );
}

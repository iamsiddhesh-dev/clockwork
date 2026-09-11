import { api } from "@/lib/api";
import { requireAccount } from "@/lib/account-server";
import { ApiDown, PageHead } from "@/components/ui";
import { ApprovalInbox } from "./approval-inbox";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const account = await requireAccount();
  const approvals = await api.listApprovals(account).catch(() => null);
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
        aside={
          <p className="cw-mono" style={{ margin: 0, fontSize: 11, color: "var(--quiet)" }}>
            j / k move · a approve · r reject · e edit
          </p>
        }
      />
      <ApprovalInbox initialApprovals={approvals} />
    </>
  );
}

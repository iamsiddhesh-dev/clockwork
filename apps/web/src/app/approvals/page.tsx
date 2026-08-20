import { api } from "@/lib/api";
import { requireAccessToken } from "@/lib/supabase/session";
import { ApprovalInbox } from "./approval-inbox";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const accessToken = await requireAccessToken();
  const initialApprovals = await api.listApprovals(accessToken, "pending").catch(() => []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Approval Inbox</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Every action Clockwork wants to take on your behalf, waiting on you.
      </p>
      <ApprovalInbox initialApprovals={initialApprovals} />
    </div>
  );
}

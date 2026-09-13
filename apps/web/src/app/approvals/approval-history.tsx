import Link from "next/link";
import type { Approval } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { SectionHead } from "@/components/ui";
import { actionVerb, subjectOf, workflowOf } from "./labels";

/** What happened to a card once someone decided on it. */
const OUTCOME: Record<string, { label: string; color: string }> = {
  executed: { label: "Sent", color: "var(--ok)" },
  approved: { label: "Sending", color: "var(--warn)" },
  rejected: { label: "Rejected", color: "var(--quiet)" },
  failed: { label: "Failed", color: "var(--bad)" },
};

/**
 * Everything already decided, newest first.
 *
 * The inbox only ever showed what is still waiting, so approving a card
 * made it disappear with nothing on screen saying it had been sent -- the
 * one moment a person most wants confirmation. "Sent" here means recorded
 * as sent on its conversation: email delivery is not wired up yet.
 */
export function ApprovalHistory({ decided }: { decided: Approval[] }) {
  if (decided.length === 0) return null;

  return (
    <section className="cw-card" style={{ padding: 22 }}>
      <SectionHead title="Decided" />
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
        {decided.map((approval, index) => {
          const outcome = OUTCOME[approval.status] ?? { label: approval.status, color: "var(--quiet)" };
          const subject = subjectOf(approval);
          return (
            <div
              key={approval.id}
              className="cw-row"
              style={{
                gap: 14,
                padding: "13px 0",
                borderTop: index === 0 ? "none" : "1px solid var(--rim)",
              }}
            >
              <span className="cw-status" style={{ flex: "none", width: 74, color: outcome.color }}>
                {outcome.label}
              </span>

              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {actionVerb(approval.action_type).replace("this ", "")}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 12.5,
                    color: "var(--quiet)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {workflowOf(approval.action_type)}
                  {subject ? ` · ${subject}` : ""}
                </div>
              </div>

              <span className="cw-mono" style={{ flex: "none", fontSize: 11, color: "var(--quiet)" }}>
                {approval.decided_at ? formatDateTime(approval.decided_at) : "—"}
              </span>

              {approval.run_id && (
                <Link href={`/runs/${approval.run_id}`} className="cw-btn cw-btn-sm" style={{ flex: "none" }}>
                  Trace
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

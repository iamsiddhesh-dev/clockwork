import type { Approval } from "@/lib/api";

/**
 * How an approval is described, shared by the pending inbox (a client
 * component) and the decided history (rendered on the server). Kept in a
 * module with no "use client" directive: a server component cannot call a
 * function exported from a client module, only render it as a component.
 */

export function actionVerb(actionType: string) {
  switch (actionType) {
    case "send_email":
      return "Send this reply";
    case "send_pitch":
      return "Send this pitch";
    case "send_quote":
      return "Send this quote";
    case "send_invoice":
      return "Send this invoice";
    case "send_payment_chase":
      return "Send this payment reminder";
    default:
      return `Run ${actionType}`;
  }
}

/** Which stage of the spine queued this, named for the tool that wrote
 *  it rather than for an agent that doesn't exist. */
export function workflowOf(actionType: string) {
  if (actionType === "send_pitch") return "Pitching";
  if (actionType === "send_quote") return "Quoting";
  if (actionType === "send_invoice") return "Invoicing";
  if (actionType === "send_payment_chase") return "Collections";
  return "Conversation";
}

/** The one line naming who this is about, read off whatever the payload
 *  actually carries for that action type. */
export function subjectOf(approval: Approval): string | null {
  const payload = approval.payload as Record<string, unknown>;
  const diff = approval.state_diff as Record<string, unknown>;
  if (typeof payload.opportunity_title === "string") return payload.opportunity_title;
  if (typeof diff.invoice === "string")
    return `Invoice ${diff.invoice}${diff.days_overdue ? ` · ${diff.days_overdue} days overdue` : ""}`;
  if (typeof diff.total === "string") return String(diff.total);
  return null;
}

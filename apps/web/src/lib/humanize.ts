/**
 * Plain language for what the backend stores.
 *
 * Tool names, schema names, database ids, field names and raw exception
 * text are how the agent keeps its books. None of it means anything to the
 * person using the app, so every screen goes through here before showing
 * one of those values.
 */

/** What each tool, manual step or approval action did, as a person would say it. */
const STEP_LABELS: Record<string, string> = {
  recall: "Looked back at past work",
  get_thread: "Read the conversation",
  log_message: "Saved a message",
  extract_requirements: "Picked out the requirements",
  qualify_lead: "Qualified the lead",
  draft_reply: "Drafted a reply",
  schedule_task: "Scheduled a check-in",
  score_fit: "Scored leads",
  draft_pitch: "Drafted a pitch",
  draft_quote: "Drafted a quote",
  draft_invoice: "Drafted an invoice",
  chase_payment: "Checked the payment",
  sync_sources: "Found leads",
  verify_links: "Checked links",
  import_profile: "Read your GitHub and portfolio",
  send_email: "Reply approved",
  send_pitch: "Pitch approved",
  send_quote: "Quote approved",
  send_invoice: "Invoice approved",
  send_payment_chase: "Payment reminder approved",
  // Structured-output model calls are logged under their schema's name.
  FitScore: "Scored a lead",
  LeadScore: "Qualified a lead",
  ExtractedRequirements: "Read the requirements",
  QuoteDraft: "Priced the quote",
  ImportedProfile: "Read your work",
};

export function stepLabel(name: string | null | undefined, fallback = "Step"): string {
  if (!name) return fallback;
  return STEP_LABELS[name] ?? fallback;
}

/** A tool named inside the agent's prose (`chase_payment`), as a noun. */
const STEP_NOUNS: Record<string, string> = {
  recall: "past work",
  get_thread: "the conversation",
  log_message: "the message log",
  extract_requirements: "the requirements check",
  qualify_lead: "the lead check",
  draft_reply: "the reply draft",
  schedule_task: "the check-in",
  score_fit: "the fit score",
  draft_pitch: "the pitch draft",
  draft_quote: "the quote draft",
  draft_invoice: "the invoice draft",
  chase_payment: "the payment check",
};

/** What an id in the agent's prose referred to, so the sentence survives. */
const ID_NOUNS: Record<string, string> = {
  thread: "the conversation",
  deal: "the deal",
  opportunity: "the lead",
  quote: "the quote",
  invoice: "the invoice",
  approval: "the approval",
  run: "the run",
  task: "the check-in",
};

export const TASK_LABELS: Record<string, string> = {
  follow_up: "Follow-up",
  quote_chase: "Quote check-in",
  invoice_chase: "Payment check",
};

export const CHANNEL_LABELS: Record<string, string> = {
  outbound_pitch: "Started from your pitch",
  intake_form: "Came in through your intake form",
  email: "Email",
};

// Hyphens included as the model sometimes writes them: plain, non-breaking
// and figure dashes all show up in its output.
const DASH = "[-\\u2010\\u2011\\u2012\\u2013]";
const UUID_SOURCE = `[0-9a-f]{8}${DASH}[0-9a-f]{4}${DASH}[0-9a-f]{4}${DASH}[0-9a-f]{4}${DASH}[0-9a-f]{12}`;
const UUID = new RegExp(`\\b${UUID_SOURCE}\\b`, "gi");
const ID_IN_PARENS = new RegExp(`\\s*\\((?:[a-z ]+\\s)?${UUID_SOURCE}\\)`, "gi");
const NAMED_ID = new RegExp(
  `(?:\\bthe\\s+)?\\b(thread|deal|opportunity|quote|invoice|approval|run|task)\\s+${UUID_SOURCE}`,
  "gi",
);

/**
 * Agent-written text, cleaned for reading: no ids, no JSON blocks, no tool
 * names in backticks. Used on run outcomes, feed lines and task reasons.
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return (
    text
      // Fenced code (the model sometimes pastes a tool's raw JSON reply).
      .replace(/```[\s\S]*?```/g, "")
      // "The `chase_payment` tool returned" -> "The payment check returned"
      .replace(/(?:\bthe\s+)?`([A-Za-z_]+)`(?:\s+tool)?/gi, (_, name: string) =>
        STEP_NOUNS[name] ?? name.replace(/_/g, " "),
      )
      .replace(/`/g, "")
      // "(deal 1ae9…)" goes; "the opportunity 0970…" becomes "the lead".
      .replace(ID_IN_PARENS, "")
      .replace(NAMED_ID, (_, noun: string) => ID_NOUNS[noun.toLowerCase()] ?? "it")
      .replace(UUID, "")
      // What removal leaves behind.
      .replace(/[ \t ]{2,}/g, " ")
      .replace(/\s+([.,;:])/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      // A sentence that only introduced a removed code block.
      .replace(/:$/, ".")
      .replace(/^[a-z]/, (c) => c.toUpperCase())
  );
}

/** A run's stored error is the raw exception. Say what it means instead. */
export function runErrorText(error: string | null | undefined): string {
  if (!error) return "";
  if (/rate.?limit|429|tokens per minute/i.test(error)) {
    return "The AI provider's per-minute limit was reached. Wait a minute and try again.";
  }
  if (/timed? ?out|timeout/i.test(error)) {
    return "A step took too long and was stopped. Try again.";
  }
  if (/profile/i.test(error) && /missing|not found|no profile/i.test(error)) {
    return "Your profile isn't set up yet.";
  }
  return "Something went wrong during this run.";
}

function formatDay(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** What approving this will do, in sentences, built from the stored diff. */
export function approvalEffects(actionType: string, diff: Record<string, unknown> | null): string[] {
  const d = diff ?? {};
  const invoice = typeof d.invoice === "string" ? ` ${d.invoice}` : "";
  switch (actionType) {
    case "send_pitch":
      return ["A conversation starts with this pitch, recorded as sent."];
    case "send_email":
      return ["This reply is added to the conversation as sent."];
    case "send_quote": {
      const lines = [d.total ? `The quote for ${d.total} is marked as sent.` : "The quote is marked as sent."];
      const valid = formatDay(d.valid_until);
      if (valid) lines.push(`It stays valid until ${valid}.`);
      lines.push("The deal moves to Quoted, and a check-in is scheduled in case the client goes quiet.");
      return lines;
    }
    case "send_invoice": {
      const lines = [`Invoice${invoice}${d.amount ? ` for ${d.amount}` : ""} is marked as sent.`];
      const due = formatDay(d.due_at);
      if (due) lines.push(`Payment is due ${due}.`);
      lines.push("A payment check is scheduled for after the due date.");
      return lines;
    }
    case "send_payment_chase": {
      const lines = [`A payment reminder for invoice${invoice} is marked as sent.`];
      if (typeof d.days_overdue === "number") {
        lines.push(`The invoice is ${d.days_overdue} day${d.days_overdue === 1 ? "" : "s"} overdue.`);
      }
      lines.push("If another reminder is needed, it will be firmer.");
      return lines;
    }
    default:
      return ["The action is recorded."];
  }
}

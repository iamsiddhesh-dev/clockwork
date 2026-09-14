# Clockwork

**A Strands agent that runs the business half of freelancing: finding work, pitching, replying, quoting, invoicing and chasing payment, on its own schedule, with a human approving everything that reaches a client.**

**[Live demo](https://clockwork-live.vercel.app)** · **[Architecture](docs/architecture.svg)** · Built for the Agents for Humans hackathon, Professional Agents track.

---

## The problem

Freelancers are paid for client work, but they also have to run the business around it: finding leads, keeping track of every conversation, remembering to follow up, writing quotes, and chasing unpaid invoices. A freelancer described what they need to me as: "track, add reminders, plan invoices, and chase if overdue."

Most tools for this are a CRM that waits to be asked. Clockwork is an agent that does the work itself, checks back on its own schedule, and asks before anything goes out.

## What it does

```
Source → Score → Pitch → Reply → Quote → Invoice → Chase → Paid
```

1. **Finds work.** It pulls contract and freelance postings from Hacker News "Who is hiring", Remotive and RemoteOK, and checks posting links are still open before scoring.
2. **Scores each lead against your own work.** It reads your GitHub and portfolio site at setup, then scores each lead 0–100. Every reason must cite one of your projects or skills; code drops citations that don't match and caps unsupported scores. Reasons that cite a project link to it.
3. **Drafts a pitch** when you choose a lead.
4. **Handles the reply.** A client writes in through your public intake form, or you paste their reply into the conversation. The agent qualifies the lead and drafts your answer, plus a quote when one is needed.
5. **Quotes, invoices and chases.** Line items come from the model; totals, invoice numbers and due dates are calculated in Python. No invoice until you record that the client accepted. Overdue invoices get a reminder whose tone escalates each time.
6. **Follows up by itself.** Drafting a pitch or reply, or sending a quote or invoice, schedules a check-in. When it's due, the agent runs with no one present and nudges only if the client hasn't answered. A check-in waits while a drafted reply is still unapproved, and a payment check drafts a reminder once an invoice is overdue.
7. **Asks first.** Every client-facing action waits in an Approval Inbox with the text, the reason, what it read, and what will change.
8. **Shows its work.** Every run has a trace of its model calls, tool calls, steps and cost.

## Try it

Use a wide browser window.

1. Open the **[live demo](https://clockwork-live.vercel.app)** and set up a workspace: name, title, email, time zone, skills, rate, and a GitHub or portfolio link. Press **Find me work**. Setup takes about 1–2 minutes and opens the Overview with a summary.
2. Open **Opportunities**. Each reason on a scored lead cites one of your projects and links to it.
3. Press **Draft a pitch** on a lead and approve it in **Approvals**.
4. In **Conversations**, open the new conversation, paste a made-up client reply asking for a quote, and press **Add reply**. The agent qualifies the lead and drafts a reply.
5. On **Money**, press **Draft quote** if the agent didn't already draft one. Approve the quote, press **Client accepted**, then **Raise invoice**, and approve the invoice.
6. Press **+7d** in the top bar and wait until it shows how many check-ins ran, then **+7d** and **+3d** again to pass the due date. A payment reminder appears in **Approvals**.
7. Open **Runs** to see each run's steps, timings and cost.

Models run on Groq's free tier (8,000 tokens per minute per model). If a step reports a rate limit, wait a minute and retry.

## How it works

![Architecture](docs/architecture.svg)

- **Agent loop.** A client message, a pasted reply and scheduled check-ins call `run_agent()`, where a Strands agent reads the situation and chooses tools.
- **Buttons.** Setup, find leads, score, pitch, quote, invoice and chase call the same tool code directly. Both paths are recorded as runs.
- **Time trigger.** Due tasks are picked up every 5 minutes on Vercel (a GitHub Action calls a secret-protected `POST /tasks/tick`) or every 30 seconds locally. Check-ins wake the agent; payment checks call the chase code directly, since there is no decision for a model to make. A virtual clock routes every time read through `clock.now()`, so the demo can move days ahead.
- **Approval gate in code.** Approval-gated tools have no code path that sends. They write a pending `approval` row, and a separate executor acts only after a human approves.

## How it uses Strands Agents

| Feature | Use |
|---|---|
| `Agent` + `@tool` | 12 typed tools: `recall`, `get_thread`, `log_message`, `extract_requirements`, `qualify_lead`, `draft_reply`, `schedule_task`, `score_fit`, `draft_pitch`, `draft_quote`, `draft_invoice`, `chase_payment` |
| `structured_output_model` | Pydantic schemas for fit scores, lead qualification, requirement extraction, quote line items and the profile import |
| Hooks | `BeforeToolCallEvent`, `AfterToolCallEvent`, `AfterInvocationEvent` record each tool call's input, result and latency; model tokens and cost go to a ledger; the Run Trace streams both live |
| `ModelRetryStrategy` | Subclassed to also retry the provider's rate-limit error, retrying only the refused model call rather than the whole run |
| LiteLLM model provider | Models routed by role on Groq (below) |

| Role | Model | Job |
|---|---|---|
| Orchestrator | gpt-oss-120b | runs the agent loop, picks tools |
| Reader | gpt-oss-120b | reads GitHub and portfolio at setup |
| Writer | gpt-oss-20b | pitches, replies, quotes, reminders |
| Extractor | gpt-oss-20b | fit scores, qualifying, requirements |

Costs are logged per run. A daily spend cap switches the orchestrator to the 20b model and records that in the trace. I planned to use Amazon Bedrock, but my AWS account's quota increase wasn't approved during the hackathon, so Clockwork runs on Groq.

## Design choices

- **Arithmetic in code.** Quote totals, invoice numbers and due dates are calculated in Python, never by the model.
- **Only a human records acceptance and payment.** No tool can mark a quote accepted or an invoice paid.
- **Scores need evidence.** Citations are checked against a numbered list of the freelancer's real projects. Skills alone cap a score at 59; no valid evidence caps it at 40.
- **Greetings decided in code.** Job boards give usernames and company names, so pitches greet "Hi there," and whatever greeting the model writes is corrected before the draft reaches the Approval Inbox.
- **Closed postings can't be pitched.** Links are checked first. A board that blocks the check is recorded as "couldn't check", not "closed".
- **Ids are cleaned before lookups.** The model sometimes copies ids back with look-alike dash characters; every tool normalises them, after a live payment check missed an overdue invoice because of it.
- **No backend data on screen.** Approval cards, run traces and errors are shown in plain language, without ids, field names or raw JSON.

## Known limits

- **No email is sent or received.** Approving a message records it as sent; you send it from the job board or your inbox, and paste replies back in. Gmail's send permission needs a security review that didn't fit the hackathon.
- **No password.** A workspace is identified by a cookie, and can be reopened with the email it was set up with. Fine for a demo, not for real client data.
- **No payment processor or tax handling.** Marking an invoice paid is a manual step.
- **Free-tier model limits.** Groq's free tier can rate-limit busy steps; runs retry, but a burst may still need a minute.

## Run it locally

Needs Python 3.14, Node 22, a Supabase project and a Groq API key.

Run `apps/agent/db/*.sql` in the Supabase SQL editor, in order. Then, from the repo root:

```bash
# terminal 1 — agent API (fill in .env first)
cd apps/agent && cp .env.example .env && pip install -r requirements.txt
PYTHONPATH=src uvicorn clockwork.api:app --port 8000

# terminal 2 — web app
cd apps/web && cp .env.example .env.local && npm install && npm run dev
```

Full setup, tests (160, standard library only), Vercel deployment and code layout: **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Licence

MIT — see [LICENSE](LICENSE).

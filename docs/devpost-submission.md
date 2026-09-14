# Clockwork — Devpost submission

Deadline: **Mon 14 Sep 2026, 5:00 PM PDT = Tue 15 Sep, 5:30 AM IST.**

Where: https://agentsforhumans.devpost.com → **Enter a submission** / **Manage project**. Each heading below is one form field.

---

## Project name

Clockwork

## Elevator pitch (196 of 200 characters)

An autonomous Strands agent that runs a freelancer's business: finds leads scored against your GitHub and portfolio, pitches, quotes, invoices and follows up, like clockwork, even while you sleep.

## Built with

strands-agents, python, fastapi, pydantic, litellm, groq, gpt-oss, next.js, react, typescript, supabase, postgresql, vercel, github-actions

## "Try it out" links

- https://clockwork-live.vercel.app
- https://github.com/iamsiddhesh-dev/clockwork

## Image gallery (JPG/PNG/GIF, 3:2, under 5 MB)

1. Overview after setup — *Overview: what the agent has done and what is waiting for you.*
2. Opportunities, a lead's reasons expanded — *Leads scored against your own GitHub and portfolio. Each reason cites a real project and links to it.*
3. Approvals, a card waiting — *Approval Inbox: nothing reaches a client until you approve it. Each card shows the text, the reason and what will change.*
4. A conversation with the pasted reply — *Paste a client's reply and the agent qualifies the lead and drafts your answer.*
5. Money, quote or invoice — *Quotes and invoices. The model proposes line items; every total, invoice number and due date is calculated in code.*
6. Approvals, the payment reminder — *After moving the clock past the due date, a payment reminder was drafted on its own, waiting for approval.*
7. A run started on schedule — *Run trace: every step, its timing and its cost for a run the agent started on its own schedule.*
8. `docs/architecture.png` — *Architecture: triggers into a Strands agent with 12 tools, models chosen by role, an approval gate in code, and the quote-to-paid flow.*

## Video demo link

Your public YouTube or Vimeo link, under 5 minutes.

## Hackathon questions

| Field | Answer |
|---|---|
| Track | Professional Agents |
| AWS Builder ID | the email the Builder ID was created with |
| Code repository | https://github.com/iamsiddhesh-dev/clockwork |
| Architecture diagram | https://github.com/iamsiddhesh-dev/clockwork/blob/main/docs/architecture.svg |
| Live demo | https://clockwork-live.vercel.app |
| URL to optional bonus blog post | leave empty — no builder.aws post was written |
| Testing instructions | the block in "Testing instructions" below |

---

## Testing instructions

```text
Live app: https://clockwork-live.vercel.app — no password, no install. Setup creates your own workspace. Use a wide browser window.

1. Set up: enter a name, title, email (any address not already used), time zone, a few skills, an hourly rate, and a GitHub or portfolio link. Press "Find me work". Setup reads your work, finds leads, checks links and scores a first batch (about 1–2 minutes), then opens the Overview with a summary.
2. Opportunities: open a scored lead. Each reason cites one of your projects and links to it.
3. Press "Draft a pitch" on a lead, then open Approvals and approve it. Nothing is emailed; approving records it as sent.
4. Conversations: open the new conversation and paste a made-up client reply, for example: "Can you build this in 4 weeks? Budget is around $6,000. Please send a quote." Press "Add reply". The agent qualifies the lead and drafts a reply in Approvals.
5. Money: if the agent did not already draft a quote, press "Draft quote". Approve the quote in Approvals. Back on Money, press "Client accepted", then "Raise invoice", and approve the invoice in Approvals.
6. Time: press "+7d" in the top bar, wait until it shows how many check-ins ran (up to a minute), then press "+7d" again and "+3d" to pass the invoice's due date. The agent drafts a payment reminder in Approvals. A reply still waiting for your approval is not drafted again.
7. Runs: open any run to see its steps, the time each took and the cost.

Notes:
- The AI models run on Groq's free tier (8,000 tokens per minute per model). If a step says the limit was reached, wait a minute and try again.
- To return to a workspace later, use "Open your workspace" on the setup screen with the same email.
- Code and local setup: https://github.com/iamsiddhesh-dev/clockwork
```

---

## About the project

```markdown
## Inspiration

Clockwork started with a conversation with a working freelancer. What wore them down wasn't the client work. It was the business around it: finding leads, keeping track of every conversation, remembering to follow up, and the need to "track, add reminders, plan invoices, and chase if overdue."

None of that is hard. It's constant. It is also the work that slips first when a project gets busy, and when it slips a lead goes cold or an invoice goes unpaid.

Most tools for it are a CRM: a place to record what you did, waiting for you to open it. I wanted the opposite: an agent that does the admin work itself, checks back on its own schedule, and only interrupts to ask before something reaches a client.

## What it does

Clockwork covers one line, from a public job posting to a paid invoice:

**Source → Score → Pitch → Reply → Quote → Invoice → Chase → Paid**

**1. Setup reads your real work.** You give a name, title, skills, hourly rate, and a GitHub link, a portfolio link, or both. Clockwork lists up to 30 of your public GitHub repositories (forks skipped, described and starred ones first), reads the READMEs of the top 3 and up to 6,000 characters of your portfolio site, and turns that into a profile of projects and skills. No one types case studies into a form.

**2. It finds work.** It pulls contract and freelance postings from Hacker News "Who is hiring", Remotive and RemoteOK, and checks a posting is still open before scoring it: the host answers, the page isn't a 404 or 410, it hasn't redirected to the homepage, and the page doesn't say the role is closed. A board that blocks the check is recorded as "couldn't check", not "closed". A closed posting can't be pitched.

**3. It scores each lead 0–100 against your work, and every reason is checkable.** The scorer gets a numbered list of up to 8 projects and 12 skills, and every reason must cite one. Code drops reasons that cite nothing real, caps a skills-only score at 59 and an unsupported score at 40. So a strong match needs a real project behind it, and each reason links to that project.

**4. It drafts a pitch when you choose a lead,** using the project that earned the score. Job boards give usernames and company names, not people, so pitches open "Hi there," — decided in code.

**5. It handles the client's answer.** A client writes in through your public intake form, or you paste their reply into the conversation. The agent reads the whole thread, qualifies the lead, estimates its value and drafts your reply, plus a quote when it decides one is needed. You can also draft the quote yourself with one button.

**6. It quotes, invoices and chases.**
- **Quote:** the model proposes line items (task, hours, rate); Python computes every total. Valid for 14 days.
- **Invoice:** raised only after you press **Client accepted**. Code assigns the number and due date.
- **Chase:** once the invoice is overdue, a scheduled payment check drafts a reminder. The tone escalates with each reminder you actually send.
- **Paid:** marking it paid cancels the pending reminder and closes the deal as won.

**7. It follows up on its own.** Drafting a pitch or reply, or sending a quote or invoice, schedules a check-in. When it's due, the agent runs with nobody present: if the client spoke last it does nothing; if we spoke last it drafts a short nudge. A check-in waits while a drafted reply is still unapproved, instead of drafting another.

**8. It asks before anything reaches a client.** Every client-facing action waits in an Approval Inbox showing the exact text, why it was drafted, what it read, and what approving will change, in plain sentences. Approve, edit or reject.

**9. It shows its work.** Every run — started by you, a client message or the schedule — has a trace of its steps, model calls and tool calls, with timings, tokens and cost.

## How I built it

### Two ways into the same tools

- **The agent loop.** A client message, a pasted reply and scheduled check-ins call `run_agent()`, where a Strands `Agent` with 12 tools reads the situation and decides what to do.
- **Code paths.** When there is nothing to decide — you pressed a button, or a payment check is due — the same tool code runs directly. Both are recorded as runs and go through the same approval gate.

### Strands Agents SDK

| Feature | How Clockwork uses it |
|---|---|
| `Agent` + `@tool` | 12 typed tools: `recall`, `get_thread`, `log_message`, `extract_requirements`, `qualify_lead`, `draft_reply`, `schedule_task`, `score_fit`, `draft_pitch`, `draft_quote`, `draft_invoice`, `chase_payment`. Nine change business state; three only read. |
| `structured_output_model` | Pydantic schemas for fit scores, lead qualification, requirement extraction, quote line items and the profile import. |
| Hooks | `BeforeToolCallEvent`, `AfterToolCallEvent` and `AfterInvocationEvent` write each tool call's input, result and latency to `agent_event`. Model tokens and cost go to `token_ledger`. The Run Trace streams both. |
| `ModelRetryStrategy` | Subclassed so the provider's rate-limit error is retryable. Only the refused model call is retried, never a run whose tools already ran. |
| LiteLLM model provider | Every model runs on Groq through Strands' LiteLLM integration. |

### Models by role

| Role | Model | Job |
|---|---|---|
| Orchestrator | openai/gpt-oss-120b | runs the agent loop, picks tools |
| Reader | openai/gpt-oss-120b | reads GitHub and the portfolio at setup |
| Writer | openai/gpt-oss-20b | pitches, replies, quote wording, reminders |
| Extractor | openai/gpt-oss-20b | fit scores, qualifying, requirements, at low reasoning effort |

Every call names a role, so each run's cost is recorded, and past a daily spend cap the orchestrator switches to the 20b model and says so in the trace.

I planned to build on Amazon Bedrock, but my AWS account's quota increase wasn't approved during the hackathon, so Clockwork runs on Groq's free tier.

### Where the model decides, and where it deliberately doesn't

| The model decides | Code decides |
|---|---|
| Which tools to use when a message arrives or a check-in fires | Every quote total, invoice number and due date |
| Turning a GitHub profile and portfolio into projects and skills | Whether a fit reason cites something real, and the score caps |
| A lead's fit score and the reasons for it | Whether a posting is still open |
| Qualifying a lead and estimating its value | Who a message greets |
| Quote line items: tasks, hours and rate | Whether a payment reminder is due, and its tone level |
| The wording of pitches, replies and reminders | Whether a check-in runs at all (skipped while a draft waits, or if the pitch was never approved) |
| | Nothing is sent, accepted or marked paid without a human |

**The approval gate is structural.** An approval-gated tool has no code path that sends. It writes a pending `approval` row; a separate executor acts only after a human approves.

### Running on a schedule without a server

Locally, an in-process timer checks for due tasks every 30 seconds. On Vercel, a GitHub Action calls a secret-protected `POST /tasks/tick` every 5 minutes, handling at most 3 tasks per call to stay inside the 300-second limit. A virtual clock routes every time read through `clock.now()`, and **+3d / +7d** controls move it forward and run whatever becomes due.

### Stack

FastAPI, Supabase Postgres and a Next.js 16 app, deployed as two Vercel projects. 160 unit tests, standard library only, no network or database: quote arithmetic, invoice numbering, payment terms, link classification, evidence checks and score caps, greetings, retry detection, id cleaning and paging.

## Tested end to end on the live site

On 14 Sep I followed the testing instructions on the live site as a new user:

| Step | Result |
|---|---|
| Setup | About 1.5 minutes. 69 postings (Hacker News 27, Remotive 7, RemoteOK 35), 30 links checked, 3 leads scored; 3 more hit Groq's per-minute limit and the summary said so. |
| Scores | Each reason linked to a real GitHub repository. |
| Pitch | Drafted, approved, conversation opened. |
| Client reply | Pasted a 4-week, $6,000 request. In 11 seconds the agent rated the lead and drafted a reply asking scoping questions. It didn't draft a quote, so I pressed **Draft quote**: USD 6,000.00 in 3 seconds. |
| Quote → invoice | Approved the quote, recorded acceptance, raised INV-0001 and approved it. |
| Time | The first **+7d** ran 2 check-ins in about 70 seconds. |

That run failed at the last step, and exposed real bugs, which I fixed the same day and retested live (see Challenges 10–12). On the retest, three check-ins were skipped in about a second each because a reply was still waiting for approval, and the scheduled payment check drafted a reminder for an invoice 10 days overdue in 9 seconds. The whole first test workspace cost $0.0149 in model spend.

## Challenges I ran into

1. **The scorer cited work that didn't exist.** Scoring moved to a numbered evidence list, with citations validated and scores capped in code.
2. **Setup failed on Groq's free tier (8,000 tokens a minute per model).** 8 of 10 scores failed in one onboarding. I measured each stage (import about 4,700 tokens; each score about 2,800, with about 1,100 output tokens), moved the import to its own model limit, ran scoring at low reasoning effort (output fell to about 250 tokens), shortened the evidence list, and set setup to score a batch of 6.
3. **"Hi NOPE,".** A job-board username became a greeting. Greetings are now decided in code, and a job title the model tacks on after "Hi there," is removed.
4. **Hacker News rate-limited link checks** (429 on 19 of 28). Its item API cut failures to 1 and the check from 201s to 41s, and exposes deleted postings.
5. **A cold API looked broken.** Importing the API took 19.5 seconds locally, 12 of them LiteLLM. Loading it only when a model is called brought that to about 5 seconds.
6. **A client-reply run died halfway on a rate limit.** Retrying the whole run could duplicate drafts, so only the refused model call is retried, through Strands' retry hook.
7. **A follow-up reported an approved pitch as unapproved,** because the agent couldn't get from a posting to its conversation. That lookup now happens in code.
8. **A deleted workspace made every page hang,** retrying forever. It now clears the cookie and goes to sign-in.
9. **Backend data leaked onto the screen:** ids, field names like `opportunity_id`, raw JSON in run traces, raw errors. All of it is now shown in plain language.
10. **The scheduled payment check missed an overdue invoice.** The model rewrote the invoice id with look-alike dash characters, so the lookup found nothing. Payment checks now run in code, and every tool cleans ids before using them.
11. **Check-ins piled up duplicate drafts** — five near-identical replies while the first still waited for approval. A check-in now waits, without a model call, until that reply is decided.
12. **One Supabase request timed out (504)** during a scheduled payment check; the same call worked seconds later. Scheduled tasks now retry database and network timeouts.

## Accomplishments that I'm proud of

- The full line works on the live site: posting, verified score, pitch, client reply, quote, invoice, overdue reminder.
- The time trigger is real: with the clock moved forward, check-ins and payment checks ran with nobody present.
- Every fit score can be checked by clicking through to the project it cites.
- The model never does the arithmetic, never records acceptance or payment, and cannot send anything — enforced by code structure, not a prompt.
- Every run's cost is visible, in fractions of a cent.

## What I learned

- Anything a model gets confidently wrong — arithmetic, citations, names, ids, whether a client agreed — belongs in code, with the model proposing and code deciding.
- If there is no decision to make, don't ask a model to make it. The payment check was more reliable the moment it stopped going through the agent.
- On a free tier, token budgets shape the architecture more than prompts do.
- Retrying a model call is safe; retrying a run that already called tools is not.
- Following my own testing instructions on the live site found bugs no unit test did.

## What's next for Clockwork

- Sending and receiving email, so replies don't need pasting. Gmail's send permission requires a security review that didn't fit the hackathon.
- Moving model calls to Amazon Bedrock once my account's quota is approved.
- More lead sources, including ones a freelancer adds.
- Flagging when a client asks for work outside the accepted quote.
- A payment link on invoices, with marking an invoice paid still left to the freelancer.

## What this is not

- **It doesn't send email.** Approving records a message as sent; you send it from the job board or your inbox and paste replies back in.
- **It has no password.** A workspace is identified by a cookie and can be reopened with its email. Fine for a demo, not for real client data.
- **The free tier limits it.** Busy steps can hit Groq's per-minute limit; runs retry, but a burst may need a minute.
- **It hasn't been measured with real freelancers.** The results above come from my own end-to-end runs, not from users.

## Disclosures

Clockwork was created during the submission period; the first commit is dated 17 Aug 2026. It uses open-source frameworks and libraries: Strands Agents SDK, FastAPI, Pydantic, LiteLLM, Next.js, React and the Supabase clients. Job data comes from the public Hacker News, Remotive and RemoteOK feeds.
```

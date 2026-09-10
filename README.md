# Clockwork

**An autonomous agent that runs the business half of freelancing — so freelancers can do the work they're actually paid for.**

Built with the [Strands Agents SDK](https://strandsagents.com) for the Agents for Humans hackathon.

Freelancers don't quit because they can't do the work. They quit because of everything around it: finding leads, chasing replies, writing quotes, remembering to follow up, and asking for money. Clockwork does that half — and it does it **on a clock, while nobody is watching.**

---

## What it actually does

```
Source → Score → Pitch → Reply → Qualify → Draft → Approve → Follow up
```

1. **Sources real work** from three public feeds — Hacker News' monthly hiring thread, Remotive, and RemoteOK — filtered for contract and freelance postings.
2. **Scores each one 0–100 against *your* profile**, with a written rationale and the specific evidence from your own portfolio that justifies it. Bad matches score low and stay low; it will not pitch something it doesn't believe in.
3. **Drafts outreach in your voice**, quoting the case study that earned the score:

   > *"I recently migrated a legacy invoicing flow to Stripe Billing for a B2B SaaS, cutting failed-payment churn by 40%."*

   That sentence is generated, but the 40% comes from the user's own portfolio entry. Nothing is invented.
4. **Waits for you.** Every client-facing action queues in an Approval Inbox showing four things: what it will do, why, what it read, and what changes in the database. Nothing is ever sent without a human pressing approve.
5. **Acts on its own schedule.** When a message goes out, a follow-up is scheduled automatically. Days later the agent wakes up, re-reads the thread, and decides whether to nudge — or correctly does nothing if the client already replied.

### Two triggers, one entry point

Most agents are request→response. Clockwork has two ways to wake up, and both go through a single `run_agent()`:

- **Event** — a lead arrives via the public intake endpoint.
- **Time** — a background scheduler drains due tasks and fires the agent with no human present.

That second one is the whole point, and it's why there's a **virtual clock**: every time read in the codebase goes through `clock.now()`, so you can advance the clock several days from the UI and watch the follow-up ladder fire in seconds instead of waiting a week.

---

## Architecture

![Architecture](docs/architecture.svg)

**Single entry point.** Both HTTP requests and the scheduler call `run_agent(trigger)`. There is no second code path — a scheduled run and an inbound message are the same machinery with different prompts.

**The approval gate is enforced in code, not prompting.** An approval-gated tool physically cannot send: it writes an `approval` row and returns "queued". A separate executor performs the side effect only after a human approves. Asking a model nicely not to send things is not a safety model.

**Everything is auditable.** Strands lifecycle hooks write every tool call, its latency, and its token cost to `agent_event`. The Run Trace screen replays any run live over SSE — every decision, every tool, and what it cost.

---

## Strands features used

| Feature | How |
|---|---|
| `@tool` | 9 typed tools, all of which mutate real business state |
| `structured_output_model=` | Pydantic schemas for every extraction/scoring step — no string parsing anywhere |
| Hooks | `BeforeToolCallEvent` / `AfterToolCallEvent` / `AfterInvocationEvent` → the `agent_event` audit trail |
| Model abstraction | One `Role` enum (orchestrator / writer / extractor) routed to different models per job |

### The tools

`recall` · `get_thread` · `log_message` · `extract_requirements` · `qualify_lead` · `draft_reply`\* · `schedule_task` · `score_fit` · `draft_pitch`\*

\* approval-gated

---

## A note on Bedrock

This was built to run on **Amazon Bedrock** — Claude Sonnet 5 for internal orchestration, Amazon Nova for client-facing text. The model router, region config, and pricing tables for that routing are all in `models.py` and work.

It does not run on Bedrock today. This AWS account has been under an account-level hold for the entire build: `get_foundation_model_availability` reports `NOT_AUTHORIZED` for **every** model including Nova, the same `ValidationException: Operation not allowed` reproduces in the Bedrock console playground, and AWS Support routed the request to their Sales team, where it has sat unresolved for three weeks.

Rather than stall, the model layer was made provider-agnostic behind Strands' `Model` interface. Switching back is one line in `.env`:

```
MODEL_PROVIDER=bedrock   # or groq
```

The demo runs on Groq (`gpt-oss-120b` / `gpt-oss-20b`) via Strands' LiteLLM integration. Every tool, hook, and structured-output call sits above that line and is untouched by the swap — which is the honest argument for the abstraction being real rather than aspirational.

---

## Running it

**Prerequisites:** Python 3.14, Node 22, a Supabase project, and either Bedrock access or a Groq API key.

```bash
# 1. Database — run these in the Supabase SQL editor, in order
apps/agent/db/001_schema.sql
apps/agent/db/002_agent_runtime.sql
apps/agent/db/003_grants.sql
apps/agent/db/004_sourcing.sql

# 2. Backend
cd apps/agent
cp .env.example .env        # fill in Supabase keys + MODEL_PROVIDER + GROQ_API_KEY
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
PYTHONPATH=src uvicorn clockwork.api:app --port 8000

# 3. Frontend
cd apps/web
cp .env.example .env.local  # NEXT_PUBLIC_API_URL + Supabase URL/anon key
npm install && npm run dev
```

Then open `http://localhost:3000`, sign in with a magic link, and fill in your profile — the agent goes to work as soon as you save it.

> Open the magic link **in the same browser you requested it from**. PKCE ties the sign-in to that browser by design.

---

## Layout

```
apps/agent/          FastAPI + the Strands agent
  src/clockwork/
    agent.py         run_agent() — the single entry point
    api.py           HTTP surface (auth on every route bar /intake and /health)
    audit.py         Strands hooks → agent_event
    auth.py          Supabase JWT verification
    clock.py         the virtual clock — every time read goes through here
    executor.py      performs approved side effects
    ledger.py        model routing spend, daily cap, structured-output validation
    models.py        Bedrock ⇄ Groq router, per-role pricing
    scheduler.py     tick() — drains due tasks, fires the agent
    sources/         one adapter per public feed
    tools/           the 9 agent tools
  db/                SQL migrations, applied in order

apps/web/            Next.js 16 (App Router)
  src/app/
    onboarding/      first run: profile → source → score → pitch
    approvals/       the Approval Inbox — keyboard-driven a/r/e
    opportunities/   sourced leads, ranked by fit
    runs/            Run Trace — live SSE replay of any agent run
```

---

## Known limits

Stated plainly, because a demo that hides these is worth less than one that doesn't:

- **Email is not wired.** Approving a message records it as sent and updates the thread; it does not transmit. Gmail's `gmail.send` is a restricted scope requiring a CASA Tier 2 audit, which is not achievable in a hackathon window, so it was deliberately deferred rather than half-built.
- **The money tail (quote → invoice → payment chasing) is not built.** The scheduler chases follow-ups, not invoices.
- **No automated tests.** Every claim here was verified by hand against live feeds and a real database.

## Licence

MIT — see [LICENSE](LICENSE).

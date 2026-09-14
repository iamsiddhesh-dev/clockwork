# Developing Clockwork

Setup, deployment and code layout. The product overview is in the [README](../README.md).

## Running locally

**Prerequisites:** Python 3.14, Node 22, a Supabase project, and a Groq API key.

### 1. Database

Run these in the Supabase SQL editor, in order:

```
apps/agent/db/001_schema.sql
apps/agent/db/002_agent_runtime.sql
apps/agent/db/003_grants.sql
apps/agent/db/004_sourcing.sql
apps/agent/db/005_money.sql
apps/agent/db/006_accounts.sql
apps/agent/db/007_profile_fields.sql
apps/agent/db/008_link_verification.sql
apps/agent/db/009_profile_links.sql
apps/agent/db/010_account_identity.sql
```

### 2. Backend

```bash
cd apps/agent
cp .env.example .env        # Supabase keys + GROQ_API_KEY
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
PYTHONPATH=src uvicorn clockwork.api:app --port 8000
```

### 3. Frontend

```bash
cd apps/web
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install && npm run dev
```

Open `http://localhost:3000`. Onboarding creates a workspace. Locally, an in-process timer checks for due tasks every 30 seconds.

### Accounts

- A workspace is identified by a cookie holding its id.
- **Log out** in Settings forgets this browser.
- `/signin` reopens a workspace by the email it was set up with.
- **Delete this account** removes the workspace and every row belonging to it. All tables cascade from the account row.

### Demo data

```bash
cd apps/agent && python scripts/seed_demo.py
```

Creates a populated workspace without calling the job feeds or a model, and prints the cookie to set. It writes no agent runs, events or approvals.

## Tests

```bash
cd apps/agent && PYTHONPATH=src python -m unittest discover -s tests -t .
```

160 tests, standard library only, no network or database. They cover:
- quote arithmetic, invoice numbering and payment-terms parsing
- link classification, including not marking "applications close on 30 September" as closed
- evidence verification and score caps
- greetings
- rate-limit and transient-error retry detection
- cleaning ids the model copies back with look-alike dashes
- workflow counts and page-window arithmetic

## Deploying to Vercel

Two Vercel projects from this repository. Each needs the other's URL, so order matters.

1. **Agent API.** New Project → import the repo → Root Directory `apps/agent`. Vercel detects FastAPI and loads `app.py`. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `GROQ_API_KEY`, deploy, and copy the URL.
2. **Web app.** New Project → same repo → Root Directory `apps/web`. Set `NEXT_PUBLIC_API_URL` to the API's URL and deploy. The build fails if it is missing or points at localhost.
3. **Connect them.** In the API project, set `ALLOWED_ORIGINS` to the web app's URL and redeploy. Until then, browsers block the site's API calls.
4. **The schedule.** Vercel has no always-on process, so the local timer doesn't run there.
   - Set `CRON_SECRET` (a long random string) on the API project.
   - Add repository secrets `AGENT_API_URL` and `CRON_SECRET` on GitHub.
   - [`agent-tick.yml`](../.github/workflows/agent-tick.yml) then calls `POST /tasks/tick` every 5 minutes. It handles at most 3 tasks per call to stay inside the 300-second function limit.
   - The **+3d / +7d** controls in the app run due tasks immediately either way.

## Implementation notes

**Link checking.** Checks run in this order:
1. the host answers
2. the status isn't 404 or 410
3. the page didn't redirect to the site root
4. the page doesn't say the role is closed

A 403 or 429 is recorded as "couldn't check", not "gone". Hacker News postings are checked through its item API, which exposes `deleted` and `dead` flags. Scraping its web pages got 429 on 19 of 28 checks; the API brought that to 1 and the run from 201s to 41s on an 84-posting workspace.

**Paging.** Opportunities, runs, threads and deals are paged server-side with `?limit=&offset=`. The total is returned in an `X-Total-Count` header, and header counts are counted in the database. Quotes and invoices are not paged, because the Money page compares every deal against every quote.

**Payment reminders.** Tone escalates by `invoice.chase_count`, which only increases when a reminder is approved. Marking an invoice paid cancels the pending reminder task. A scheduled payment check calls `chase_payment_for` directly rather than through the agent, and retries once on a database or network timeout.

**Check-ins.** A scheduled follow-up or quote check-in is pushed back 3 days, without a model call, while a drafted reply on that conversation is still waiting for approval. A pitch follow-up for a pitch that was never approved is skipped.

**Model roles.** `models.py` and `ledger.invoke_model` are the only places a model provider is named. Every other call site passes a `Role`.

## Code layout

```
apps/agent/                FastAPI + the Strands agent
  src/clockwork/
    agent.py               run_agent(): the agent loop for messages and scheduled tasks
    api.py                 HTTP routes
    audit.py               Strands hooks → agent_event
    auth.py                workspace identity (identifies, does not authenticate)
    clock.py               virtual clock; every time read goes through it
    evidence.py            evidence index, citation checks, score caps
    executor.py            performs an approval's action after a human approves
    greeting.py            who a message greets, decided in code
    ids.py                 cleans ids the model copies back with look-alike dashes
    importer.py            reads GitHub and a portfolio site into the profile
    ledger.py              model calls, token costs, daily spend cap
    models.py              model per role, and pricing
    retry.py               rate-limit retries
    runs.py                records button-started work as runs
    scheduler.py           finds due tasks and runs them
    sources/               one adapter per job feed, plus link checking
    tools/                 the 12 agent tools
  db/                      SQL migrations, applied in order
  scripts/seed_demo.py     a populated demo workspace
  tests/                   unit tests

apps/web/                  Next.js 16 (App Router)
  src/app/
    onboarding/            setup: profile, read work, find, check, score
    overview/              dashboard
    opportunities/         leads ranked by fit, with evidence
    approvals/             Approval Inbox and decided history
    threads/               conversations; paste a client's reply
    money/                 quotes and invoices
    runs/                  run list and live Run Trace
    workflows/             counts per stage
    settings/              profile, spend cap, intake link, account
    signin/                reopen a workspace by email
    intake/[account]/      public intake form
```

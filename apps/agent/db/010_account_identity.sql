-- Clockwork — migration 010: an account you can come back to
--
-- Until now a workspace existed only as a cookie. Clear the cookie, use
-- a different browser, or press "start a fresh workspace" and the data
-- was still in this database but there was no way on earth to reach it
-- again. That is what "it didn't store anything" actually looks like
-- from the outside, and it is a real defect rather than a missing
-- feature: the rows were there, the door was gone.
--
-- So the email onboarding already collects becomes the way back in.
--
-- BE CLEAR ABOUT WHAT THIS IS. It is a handle, not a credential. There
-- is no password and no verification, so anyone who knows the email can
-- open the workspace behind it. That is weaker than the cookie it
-- supplements -- a v4 UUID is unguessable and an email address is the
-- opposite of unguessable -- and it is a deliberate trade for a demo
-- whose whole argument is that it is already working thirty seconds in.
-- It is NOT the right trade for real client correspondence. The sign-in
-- screen, auth.py and the README all say so in as many words rather than
-- letting the word "sign in" imply a security boundary that is not here.
--
-- Deleting an account really deletes it: every user_id foreign key added
-- in 006 is ON DELETE CASCADE, so removing this one row removes the
-- profile, threads, messages, deals, runs, events, approvals, tasks,
-- ledger rows, settings, sources, opportunities, quotes and invoices
-- with it. Nothing is left orphaned and nothing is soft-deleted, because
-- "delete my account" meaning "we hid it from you" is a lie.

alter table account add column if not exists email text;

-- Case-insensitive and unique, but only where an email exists: a
-- workspace created before this migration (or by the seed script) has
-- none, and several of those must be allowed to coexist. Uniqueness on
-- lower(email) means Name@Example.com and name@example.com cannot become
-- two workspaces that each look like the other's.
create unique index if not exists account_email_unique
    on account (lower(email))
    where email is not null;

-- Backfill from the profiles that already carry one. Distinct on the
-- lowercased address, oldest account first, so if two workspaces were
-- created with the same email before uniqueness existed, the first one
-- claims it and the other stays cookie-only rather than the insert
-- failing outright and leaving the column unusable.
with claimed as (
    select distinct on (lower(p.email))
        p.user_id,
        p.email
    from profile p
    join account a on a.id = p.user_id
    where p.email is not null
      and p.email <> ''
      and a.email is null
    order by lower(p.email), a.created_at
)
update account a
set email = claimed.email
from claimed
where a.id = claimed.user_id;

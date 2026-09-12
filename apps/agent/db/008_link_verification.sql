-- Clockwork — migration 008: is this posting still real?
--
-- The worst thing an outreach agent can do is pitch a role that was
-- filled three weeks ago. It wastes the freelancer's time, and it is
-- visibly sloppy to the one person they were trying to impress. Job
-- feeds go stale fast: Hacker News hiring threads are monthly, and
-- Remotive and RemoteOK both keep listings up well past the point anyone
-- is still reading them.
--
-- So every sourced posting gets its link checked before it is worth
-- scoring, and the result is stored rather than recomputed -- a check is
-- a network round trip to someone else's server, and re-running it on
-- every page load would be both slow and rude.
--
-- Deliberately NOT a browser. These three sources serve the posting in
-- the HTML response, so an HTTP request answers the question a headless
-- browser would answer, in about a thousandth of the time and without a
-- 400MB dependency. See sources/verify.py.

-- live        -> resolved, 2xx, and the page does not say it is closed
-- closed      -> resolved, but the page says the role is filled or shut
-- gone        -> 404/410, or redirected to a site root (the listing was
--                removed and the server bounced us to the homepage)
-- unreachable -> DNS failure, timeout, TLS error, 5xx
-- unchecked   -> not looked at yet
alter table opportunity add column if not exists link_status text not null default 'unchecked';
alter table opportunity add column if not exists link_checked_at timestamptz;

-- Why it got that status, in one line, so the UI never has to say
-- "gone" without being able to explain itself.
alter table opportunity add column if not exists link_note text;

-- The URL actually landed on after redirects. When this differs from
-- `url`, that difference is usually the whole story.
alter table opportunity add column if not exists link_final_url text;

alter table opportunity
    add constraint opportunity_link_status_known
    check (link_status in ('unchecked', 'live', 'closed', 'gone', 'unreachable'))
    not valid;

-- The query the verifier runs: oldest checks first, unchecked before all.
create index if not exists idx_opportunity_link_checked
    on opportunity (user_id, link_checked_at nulls first);

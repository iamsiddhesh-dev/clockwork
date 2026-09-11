-- Clockwork — migration 007: the fields onboarding actually asks for
--
-- Modelled on how Upwork and Freelancer.com onboard a freelancer, with
-- one hard rule applied on top: **a field exists here only if a tool
-- reads it.** Upwork asks for education, employment history, languages,
-- certifications and a profile photo. All of those are real and useful
-- *to a human browsing a marketplace*. None of them change a single
-- decision Clockwork makes, so asking for them would be a longer form
-- that makes the product worse.
--
-- What Upwork gets right and is kept:
--   - a professional TITLE separate from the name ("Senior Backend
--     Engineer · Payments") -- it is the one line that frames everything
--     else, and pitches read badly without it;
--   - an OVERVIEW with a real minimum length, because a two-word bio
--     produces two-word reasoning downstream;
--   - RATE up front rather than buried in settings;
--   - explicit AVAILABILITY, which is what separates a freelancer from a
--     job applicant.
--
-- Each column below names the tool that consumes it. If a future column
-- cannot name one, it does not belong here.

-- The headline under the name. Read by score_fit (seniority and domain
-- matching) and draft_pitch (frames the opening line).
alter table profile add column if not exists title text;

-- Years in the trade. score_fit uses it to catch seniority mismatches --
-- a posting asking for a lead when the profile says two years, or the
-- reverse, which is the more common and more expensive error.
alter table profile add column if not exists years_experience integer;

-- The floor. score_fit marks a posting down when its stated budget is
-- clearly under this, which is the single most effective filter a
-- freelancer has and the one no job board offers them.
alter table profile add column if not exists min_project_budget numeric;

-- Hours a week actually available. score_fit uses it to down-rank
-- postings that are full-time roles wearing a contract label -- the
-- most common kind of false positive on every one of these feeds.
alter table profile add column if not exists availability_hours integer;

-- Sanity bounds. These are not business rules, they are guards against a
-- fat-fingered form field silently poisoning every score downstream: a
-- rate of 9500 instead of 95 would quietly reject every posting.
alter table profile
    add constraint profile_years_experience_sane
    check (years_experience is null or (years_experience >= 0 and years_experience <= 60))
    not valid;

alter table profile
    add constraint profile_availability_hours_sane
    check (availability_hours is null or (availability_hours > 0 and availability_hours <= 168))
    not valid;

alter table profile
    add constraint profile_min_budget_sane
    check (min_project_budget is null or min_project_budget >= 0)
    not valid;

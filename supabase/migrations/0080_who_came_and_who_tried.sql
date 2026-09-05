-- =============================================================================
-- 0080 — Who came, and who tried to sign up
--
-- The console could see customers. It could see nothing of the people who
-- looked and did not become one, which is most of them — so "why is nobody
-- signing up" had no answer beyond guessing.
--
-- Two things are recorded here, and they are different in kind, which is why
-- they are two tables rather than one.
--
-- **Visits** are anonymous and stay that way. A page, where the visitor came
-- from, and a campaign tag if the link carried one. No IP address is stored,
-- no cookie is set, and the visitor identifier is a random value the browser
-- keeps for itself — so two page views can be recognized as one session
-- without anybody being identified, and the identifier means nothing outside
-- that browser.
--
-- **Signup attempts** carry an email, because somebody typing their address
-- into a signup form is offering it. Only on submit — never a keystroke — and
-- the reason it failed beside it, because "email already registered" and
-- "password too short" are opposite problems and both look like silence from
-- the operator's side.
--
-- What this deliberately does not do is build a profile. There is no linking
-- of a visitor to a person, no cross-site identifier, no third party, and the
-- visitor id is not stored anywhere it could be joined to an account.
-- =============================================================================

create table visit_events (
  id           bigint generated always as identity primary key,
  /*
   * A value the browser generated for itself and keeps in its own storage.
   * Not derived from an address, a fingerprint or anything about the person —
   * so it groups one browser's page views and identifies nobody. Clearing site
   * data makes somebody a new visitor, which is the correct outcome.
   */
  visitor      uuid,
  path         text not null check (length(path) between 1 and 500),
  referrer     text check (referrer is null or length(referrer) <= 500),
  -- Campaign tags, when a link carried them. How somebody arrived is the
  -- question this table exists to answer.
  utm_source   text check (utm_source is null or length(utm_source) <= 100),
  utm_medium   text check (utm_medium is null or length(utm_medium) <= 100),
  utm_campaign text check (utm_campaign is null or length(utm_campaign) <= 100),
  -- Desktop, tablet or phone. Coarse on purpose: a full user agent string is a
  -- fingerprint, and the only thing worth knowing is whether the page has to
  -- work on a phone.
  device       text check (device is null or device in ('desktop', 'tablet', 'phone')),
  occurred_at  timestamptz not null default now()
);

comment on table visit_events is
  'Anonymous page views: where somebody landed, where they came from, and on what kind of device. ENTITY, append-only. No address, no cookie, no fingerprint — the visitor id is a random value the browser keeps for itself, so page views group into a session and identify nobody.';

create index visit_events_when on visit_events (occurred_at desc);
create index visit_events_path on visit_events (path, occurred_at desc);
create index visit_events_visitor on visit_events (visitor, occurred_at);

alter table visit_events enable row level security;
alter table visit_events force row level security;
-- Supabase grants anon everything on new tables in `public` by default, so the
-- grant has to be taken back explicitly. The write path is the definer
-- function below; there is no read path for anybody but an operator.
revoke all on visit_events from anon, authenticated;

-- Append-only, like the other ledgers: a visit that can be edited is not
-- evidence of anything.
create trigger visit_events_append_only
  before update or delete on visit_events
  for each row execute function app.forbid_mutation();

create table signup_attempts (
  id           bigint generated always as identity primary key,
  email        text not null check (position('@' in email) > 1 and length(email) <= 320),
  visitor      uuid,
  outcome      text not null check (outcome in ('started', 'failed', 'completed')),
  -- Why it failed, in the words the person saw. "Already registered" and
  -- "password too short" are opposite problems and both look like nothing
  -- happened from this side.
  failure      text check (failure is null or length(failure) <= 300),
  utm_source   text check (utm_source is null or length(utm_source) <= 100),
  occurred_at  timestamptz not null default now()
);

comment on table signup_attempts is
  'Somebody submitting the signup form, and what happened. ENTITY, append-only. Recorded on submit and never on a keystroke: an address typed and thought better of is not an attempt. The failure reason is kept because "already registered" and "password too short" are opposite problems that look identical from the operator side.';

create index signup_attempts_when on signup_attempts (occurred_at desc);
create index signup_attempts_email on signup_attempts (lower(email), occurred_at desc);

alter table signup_attempts enable row level security;
alter table signup_attempts force row level security;
revoke all on signup_attempts from anon, authenticated;

create trigger signup_attempts_append_only
  before update or delete on signup_attempts
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Writing one
--
-- Anonymous visitors have no session, so these are the second and third
-- functions on the platform that anonymous callers may execute — like
-- `public.submit_lead`, a definer wrapper that accepts a narrow shape and
-- nothing else. There is no anon grant on either table.
-- -----------------------------------------------------------------------------
create or replace function public.record_visit(
  p_path text,
  p_visitor uuid default null,
  p_referrer text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_device text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_path is null or length(trim(p_path)) = 0 then
    return;
  end if;
  /*
   * The console is not a marketing page and its paths are not traffic. Nobody
   * should be able to infer how the operator console is laid out by posting
   * guesses at this function and watching which ones stick, either.
   */
  if p_path like '/admin%' or p_path like '/app%' then
    return;
  end if;

  insert into visit_events
    (visitor, path, referrer, utm_source, utm_medium, utm_campaign, device)
  values (
    p_visitor,
    left(trim(p_path), 500),
    left(nullif(trim(coalesce(p_referrer, '')), ''), 500),
    left(nullif(trim(coalesce(p_utm_source, '')), ''), 100),
    left(nullif(trim(coalesce(p_utm_medium, '')), ''), 100),
    left(nullif(trim(coalesce(p_utm_campaign, '')), ''), 100),
    case when p_device in ('desktop', 'tablet', 'phone') then p_device end);
exception
  -- A page view is never worth breaking a page for. If this cannot be written,
  -- the visitor should not find out.
  when others then return;
end;
$$;

create or replace function public.record_signup_attempt(
  p_email text,
  p_outcome text,
  p_failure text default null,
  p_visitor uuid default null,
  p_utm_source text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_email is null or position('@' in p_email) < 2 then
    return;
  end if;
  if p_outcome not in ('started', 'failed', 'completed') then
    return;
  end if;

  insert into signup_attempts (email, visitor, outcome, failure, utm_source)
  values (lower(left(trim(p_email), 320)), p_visitor, p_outcome,
          left(nullif(trim(coalesce(p_failure, '')), ''), 300),
          left(nullif(trim(coalesce(p_utm_source, '')), ''), 100));
exception when others then return;
end;
$$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.record_visit(text, uuid, text, text, text, text, text)',
    'public.record_signup_attempt(text, text, text, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('grant execute on function %s to anon, authenticated', v_sig);
  end loop;
end $$;

comment on function public.record_visit(text, uuid, text, text, text, text, text) is
  'Records one anonymous page view. Executable by anonymous callers, like submit_lead, because the people this exists to count have no session. Swallows its own failures: a page view is never worth breaking a page for.';

comment on function public.record_signup_attempt(text, text, text, uuid, text) is
  'Records that somebody submitted the signup form and what happened to it. Executable by anonymous callers for the same reason: the attempts worth knowing about are the ones that did not produce an account.';

-- -----------------------------------------------------------------------------
-- Reading it
-- -----------------------------------------------------------------------------
create or replace view admin_traffic as
select
  date_trunc('day', v.occurred_at)          as day,
  count(*)                                  as views,
  count(distinct v.visitor)                 as visitors,
  count(*) filter (where v.path = '/')      as landing_views,
  count(*) filter (where v.path like '/pricing%') as pricing_views,
  count(*) filter (where v.path like '/signup%')  as signup_views,
  count(*) filter (where v.device = 'phone')      as phone_views
from visit_events v
where v.occurred_at > now() - interval '90 days'
  and app.operator_can('companies.read')
group by 1
order by 1 desc;

comment on view admin_traffic is
  'Ninety days of traffic by day: views, distinct browsers, and how many reached the pages that matter. Distinct browsers rather than people — somebody on a laptop and a phone is two, and clearing site data makes them another.';

grant select on admin_traffic to authenticated;
revoke all on admin_traffic from anon;

/**
 * The site a referrer came from, without the path.
 *
 * "google.com" is a source; "google.com/search?q=..." is a hundred sources
 * that are all the same one, and the query string is somebody's search terms,
 * which is not something to keep.
 */
create or replace function app.referrer_host(p_referrer text)
returns text
language sql immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(coalesce(p_referrer, ''), '^https?://(www\.)?', ''),
      '[/?#].*$', ''),
    '');
$$;

/** Where people come from. The answer to "is any of this marketing working". */
create or replace view admin_traffic_sources as
select
  coalesce(v.utm_source, app.referrer_host(v.referrer), 'direct') as source,
  v.utm_campaign                            as campaign,
  count(*)                                  as views,
  count(distinct v.visitor)                 as visitors,
  count(*) filter (where v.path like '/pricing%') as reached_pricing,
  count(*) filter (where v.path like '/signup%')  as reached_signup,
  max(v.occurred_at)                        as last_seen
from visit_events v
where v.occurred_at > now() - interval '90 days'
  and app.operator_can('companies.read')
group by 1, 2
order by 3 desc;

comment on view admin_traffic_sources is
  'Where visitors came from over ninety days, and how far they got. A campaign tag if the link carried one, otherwise the referring site, otherwise direct.';

grant select on admin_traffic_sources to authenticated;
revoke all on admin_traffic_sources from anon;

/**
 * The funnel, end to end.
 *
 * Every stage counted from what actually happened rather than from a stored
 * counter, so the numbers cannot drift apart and a stage can never exceed the
 * one above it by accident.
 */
create or replace view admin_signup_funnel as
select
  d.day,
  coalesce(v.visitors, 0)     as visitors,
  coalesce(v.reached_signup, 0) as reached_the_form,
  coalesce(a.attempted, 0)    as attempted,
  coalesce(a.failed, 0)       as failed,
  coalesce(u.accounts, 0)     as accounts_created,
  coalesce(c.companies, 0)    as companies_created,
  coalesce(s.subscribed, 0)   as subscribed
from (
  select generate_series(date_trunc('day', now()) - interval '29 days',
                         date_trunc('day', now()), interval '1 day') as day
) d
left join lateral (
  select count(distinct visitor) as visitors,
         count(distinct visitor) filter (where path like '/signup%') as reached_signup
  from visit_events e where date_trunc('day', e.occurred_at) = d.day
) v on true
left join lateral (
  select count(distinct lower(email)) as attempted,
         count(distinct lower(email)) filter (where outcome = 'failed') as failed
  from signup_attempts x where date_trunc('day', x.occurred_at) = d.day
) a on true
left join lateral (
  select count(*) as accounts from user_profiles p
  where date_trunc('day', p.created_at) = d.day
) u on true
left join lateral (
  select count(*) as companies from companies co
  where date_trunc('day', co.created_at) = d.day
) c on true
left join lateral (
  select count(*) as subscribed from subscriptions sb
  where date_trunc('day', sb.created_at) = d.day and sb.status in ('trialing', 'active')
) s on true
where app.operator_can('companies.read')
order by d.day desc;

comment on view admin_signup_funnel is
  'Thirty days from a visitor to a paying customer: who arrived, who reached the form, who submitted it, who failed, who got an account, who got a company, who subscribed. Every stage counted rather than tracked, so no two of them can disagree.';

grant select on admin_signup_funnel to authenticated;
revoke all on admin_signup_funnel from anon;

/** The attempts that did not become accounts. The most actionable list here. */
create or replace view admin_failed_signups as
select
  a.email,
  a.outcome,
  a.failure,
  a.utm_source,
  a.occurred_at,
  -- Whether they eventually made it, which turns a list of failures into a
  -- list of people still stuck.
  exists (select 1 from user_profiles p where lower(p.email) = a.email) as has_an_account_now
from signup_attempts a
where a.outcome = 'failed'
  and a.occurred_at > now() - interval '60 days'
  and app.operator_can('companies.read')
order by a.occurred_at desc
limit 200;

comment on view admin_failed_signups is
  'People who tried to sign up and did not, with the reason they saw and whether they ever came back. A repeated "already registered" is somebody who forgot they had an account, which is a mail worth sending rather than a lost customer.';

grant select on admin_failed_signups to authenticated;
revoke all on admin_failed_signups from anon;

select app.assert_security_gates();

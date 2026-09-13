-- =============================================================================
-- 0165 — The certificate that lapses while somebody is still on the job
--
-- Migration 0035 built the credential control and it works: `credential_gaps`
-- answers what a person is missing for a kind of work, and
-- `resource_assignments_credentialed` refuses to assign them to it. Both fire
-- at the moment of assignment.
--
-- That is exactly one moment. A CDL that expires three weeks into a six week
-- assignment passes the check on the day it is made and lapses in the middle of
-- the work, with nothing to notice. So does a credential revoked after the
-- fact. The control answers "may I assign this person today" and nobody ever
-- asked it "is everyone I have already assigned still qualified tomorrow".
--
-- Recruitment was considered for this and deliberately rejected on 13 September
-- 2026: a candidate database connects to nothing else in the platform, while
-- the question a contractor actually has — "who is short of what, and when" —
-- is answerable from the schedule and the credentials that are already here.
--
-- One thing this had to be taught: migration 0043 dropped `credentials.status`
-- because it was a date restated as a column — 'valid' kept saying valid the
-- day after a license lapsed, and the gate failed open on exactly the case it
-- existed to catch. Standing is derived from the expiry every time it is asked
-- for, through `app.credential_standing`, and this reads it the same way.
--
-- Two facts and one supply figure. No demand model: `resource_assignments` is
-- one row per person, so the platform knows who is committed and cannot know
-- how many a job needs without somebody saying so. Inventing that number would
-- be worse than not having it.
-- =============================================================================

/**
 * Assignments that are not covered for their whole length.
 *
 * Reported per assignment, per credential, with the date it goes — because
 * "Dana is short a CDL" and "Dana's CDL lapses on the 12th, four weeks into a
 * six week assignment" are different sentences and only the second one says
 * what to do about it.
 *
 * `already_lapsed` separates the two kinds. A credential that expired or was
 * revoked after the assignment was made is a person on site unqualified today;
 * one that expires later is a date to book a renewal against.
 */
create or replace function app.staffing_gaps(
  p_from date default current_date,
  p_to   date default (current_date + 90))
returns table (
  assignment_id     uuid,
  project_id        uuid,
  project_number    text,
  employee_id       uuid,
  employee_name     text,
  work_type         text,
  starts_on         date,
  ends_on           date,
  credential_name   text,
  is_mandatory      boolean,
  credential_status text,
  expires_on        date,
  -- The day cover runs out inside the assignment, or null where it never had any.
  uncovered_from    date,
  already_lapsed    boolean,
  reason            text
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    a.id,
    a.project_id,
    p.number,
    a.employee_id,
    e.full_name,
    a.work_type,
    a.starts_on,
    a.ends_on,
    r.credential_name,
    r.is_mandatory,
    coalesce(c.standing, 'not held'),
    c.expires_on,
    case
      when c.id is null then a.starts_on
      when c.standing in ('revoked', 'expired') then a.starts_on
      when c.standing = 'pending' then a.starts_on
      when c.expires_on is not null and c.expires_on < a.ends_on
        then (c.expires_on + 1)
    end,
    (c.id is null or c.standing in ('revoked', 'expired', 'pending')),
    case
      when c.id is null then 'not held'
      when c.standing = 'revoked' then 'revoked'
      when c.standing = 'expired' then 'expired ' || coalesce(c.expires_on::text, '')
      when c.standing = 'pending' then 'not yet issued'
      else 'expires ' || c.expires_on::text || ', '
           || (a.ends_on - c.expires_on)::text || ' days before the work ends'
    end
  from resource_assignments a
  join projects  p on p.id = a.project_id
  join employees e on e.id = a.employee_id
  join work_credential_requirements r
    on r.company_id = a.company_id and r.work_type = a.work_type
  left join lateral (
    select c.*, app.credential_standing(c.lifecycle, c.expires_on) as standing
      from credentials c
     where c.employee_id = a.employee_id
       and lower(c.name) = lower(r.credential_name)
     order by case app.credential_standing(c.lifecycle, c.expires_on)
                when 'valid' then 0 when 'expiring' then 1 else 2 end,
              c.expires_on desc nulls last
     limit 1
  ) c on true
  where a.resource_kind = 'employee'
    and a.employee_id is not null
    and a.work_type is not null
    -- Assignments that touch the window at all.
    and a.starts_on <= p_to
    and a.ends_on   >= p_from
    and (
      -- No cover at all, or cover that has already failed.
      c.id is null
      or c.standing in ('revoked', 'expired', 'pending')
      -- Or cover that runs out before the work does.
      or (c.expires_on is not null and c.expires_on < a.ends_on)
    );
$$;

comment on function app.staffing_gaps(date, date) is
  'Assignments whose mandatory credentials do not cover the whole of the work, with the day cover runs out. The assignment trigger answers "may I assign this person today"; this answers "is everybody I already assigned still qualified tomorrow". ENGINE.';

/**
 * Who could take the work, and who is already spoken for.
 *
 * The supply side only. `resource_assignments` is one row per person, so the
 * platform knows exactly who is committed and cannot know how many a job needs
 * without being told — and a required headcount nobody entered would be a
 * number invented to fill a column.
 */
create or replace function app.qualified_and_available(
  p_work_type text,
  p_from date default current_date,
  p_to   date default (current_date + 90))
returns table (
  employee_id     uuid,
  employee_name   text,
  classification  text,
  fully_qualified boolean,
  missing         text[],
  committed_days  int,
  window_days     int
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with mine as (
    select e.* from employees e
     where e.status = 'active'
       and e.company_id in (select app.current_company_ids())
  ),
  required as (
    select r.credential_name
      from work_credential_requirements r
     where r.work_type = p_work_type
       and r.is_mandatory
       and r.company_id in (select app.current_company_ids())
  ),
  shortfall as (
    select m.id as employee_id,
           array_remove(array_agg(g.credential_name), null) as missing
      from mine m
      left join lateral (
        select req.credential_name
          from required req
         where not exists (
           select 1 from credentials c
            where c.employee_id = m.id
              and lower(c.name) = lower(req.credential_name)
              and app.credential_standing(c.lifecycle, c.expires_on) in ('valid', 'expiring')
              -- Valid for the whole window, not merely valid today.
              and (c.expires_on is null or c.expires_on >= p_to)
         )
      ) g on true
     group by m.id
  ),
  committed as (
    select a.employee_id,
           sum(
             greatest(0,
               (least(a.ends_on, p_to) - greatest(a.starts_on, p_from)) + 1)
           )::int as days
      from resource_assignments a
     where a.resource_kind = 'employee'
       and a.employee_id is not null
       and a.starts_on <= p_to
       and a.ends_on   >= p_from
     group by a.employee_id
  )
  select m.id,
         m.full_name,
         m.classification,
         coalesce(cardinality(s.missing), 0) = 0,
         coalesce(s.missing, '{}'::text[]),
         coalesce(cm.days, 0),
         ((p_to - p_from) + 1)::int
    from mine m
    left join shortfall s on s.employee_id = m.id
    left join committed cm on cm.employee_id = m.id
   order by (coalesce(cardinality(s.missing), 0) = 0) desc,
            coalesce(cm.days, 0) asc,
            m.full_name;
$$;

comment on function app.qualified_and_available(text, date, date) is
  'Who holds every mandatory credential for a kind of work across the whole window, and how much of the window each is already committed for. Supply only — a required headcount nobody entered is a number nobody chose. ENGINE.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------
create or replace view my_staffing_gaps as
select * from app.staffing_gaps();

revoke all on my_staffing_gaps from public, anon;
grant select on my_staffing_gaps to authenticated;
alter view my_staffing_gaps set (security_invoker = on);

comment on view my_staffing_gaps is
  'The next ninety days of assignments whose credentials do not cover the work.';

create or replace function public.qualified_and_available(
  p_work_type text, p_from date default current_date, p_to date default (current_date + 90))
returns table (
  employee_id uuid, employee_name text, classification text,
  fully_qualified boolean, missing text[], committed_days int, window_days int)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.qualified_and_available(p_work_type, p_from, p_to); $$;

revoke all on function app.staffing_gaps(date, date) from public, anon;
grant execute on function app.staffing_gaps(date, date) to authenticated;
revoke all on function app.qualified_and_available(text, date, date) from public, anon;
grant execute on function app.qualified_and_available(text, date, date) to authenticated;
revoke all on function public.qualified_and_available(text, date, date) from public, anon;
grant execute on function public.qualified_and_available(text, date, date) to authenticated;

select app.assert_security_gates();

-- =============================================================================
-- 0043 — The safety gate that failed open, because it trusted a stored date
--
-- P14 built a control that refuses to assign somebody to work whose mandatory
-- credentials they do not hold, and its own test file opens by saying an
-- employee "whose CDL expired last month could be assigned to drive, with the
-- expiry and the assignment recorded side by side and never connected."
--
-- That control did not work. `credentials.status` is a stored column holding a
-- state derived from a date — 'valid', 'expiring', 'expired' — maintained by a
-- trigger that fires `before insert or update of expires_on, status`. **Nothing
-- fires with the passage of time.** A CDL written while it was still valid
-- keeps saying 'valid' the day after it lapses, and `app.credential_gaps()`
-- read that column and nothing else.
--
-- Reproduced before this was written: a license that expired two hundred days
-- ago produced no gap, and the assignment was accepted. The gate failed open on
-- precisely the case it exists to catch — the worst way for a safety control to
-- be wrong, because it reports success.
--
-- This is the "derive, don't store" rule the platform already applies to a
-- library rate's `valid_to`, a schedule's current baseline, a plan's current
-- version and a metric's current definition. It was not applied here, and here
-- is where it mattered most.
--
-- What can be derived is now derived. What cannot be — whether a credential was
-- revoked, or has been applied for but not yet issued — is what the stored
-- column now holds, and only that.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The part a human decides, separated from the part a date decides
-- -----------------------------------------------------------------------------
alter table credentials
  add column lifecycle text not null default 'active'
    check (lifecycle in ('pending', 'active', 'revoked'));

comment on column credentials.lifecycle is
  'The administrative state, and only that: applied for, held, or withdrawn. Whether a held credential has lapsed is derived from expires_on by app.credential_standing() and is deliberately not stored, because a stored expiry goes stale the moment the date passes and nothing writes the row.';

-- 'revoked' and 'pending' are administrative facts and survive. 'valid',
-- 'expiring' and 'expired' were a date restated as a column; the date is kept
-- and the restatement is dropped.
update credentials set lifecycle = case
  when status = 'revoked' then 'revoked'
  when status = 'pending' then 'pending'
  else 'active' end;

drop trigger if exists refresh_credential_status on credentials;
drop trigger if exists credentials_notify_expiry on credentials;
drop function if exists app.refresh_credential_status();

-- Dropping the column takes the partial index built over it; it is rebuilt
-- below against the column that replaced it.
alter table credentials drop column status;

create index credentials_expiry_idx on credentials(company_id, expires_on)
  where expires_on is not null and lifecycle <> 'revoked';

/**
 * Where a credential stands right now.
 *
 * `stable` rather than `immutable`, because it reads the clock — which is
 * exactly why this cannot be a generated column and exactly why the old design
 * was wrong. Every caller gets the answer as of the moment it asks.
 */
create or replace function app.credential_standing(p_lifecycle text, p_expires date)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select case
    when p_lifecycle = 'revoked' then 'revoked'
    when p_lifecycle = 'pending' then 'pending'
    -- A credential with no expiry date does not expire. Recording one that
    -- never lapses is not the same as recording nothing.
    when p_expires is null then 'valid'
    when p_expires < current_date then 'expired'
    when p_expires < current_date + 30 then 'expiring'
    else 'valid'
  end;
$$;

grant execute on function app.credential_standing(text, date) to authenticated, service_role;

comment on function app.credential_standing(text, date) is
  'Where a credential stands as of now: revoked and pending are administrative and stored; expired, expiring and valid are derived from the expiry date every time they are asked for, never written down.';

-- -----------------------------------------------------------------------------
-- The gate, reading the date instead of a column that remembers one
-- -----------------------------------------------------------------------------
create or replace function app.credential_gaps(p_employee uuid, p_work_type text)
returns table (credential_name text, is_mandatory boolean, reason text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select r.credential_name,
         r.is_mandatory,
         case
           when c.id is null        then 'not held'
           when c.standing = 'revoked' then 'revoked'
           when c.standing = 'expired' then 'expired ' || coalesce(c.expires_on::text, '')
           when c.standing = 'pending' then 'not yet issued'
           else 'held'
         end as reason
  from work_credential_requirements r
  join employees e on e.id = p_employee and e.company_id = r.company_id
  -- The best credential the person holds for this requirement: a valid one
  -- beats one about to lapse, which beats one that has already gone.
  left join lateral (
    select c.*, app.credential_standing(c.lifecycle, c.expires_on) as standing
    from credentials c
    where c.employee_id = p_employee
      and lower(c.name) = lower(r.credential_name)
    order by case app.credential_standing(c.lifecycle, c.expires_on)
               when 'valid' then 0 when 'expiring' then 1 else 2 end,
             c.expires_on desc nulls last
    limit 1
  ) c on true
  where r.work_type = p_work_type
    and (c.id is null or c.standing in ('revoked', 'expired', 'pending'));
$$;

comment on function app.credential_gaps(uuid, text) is
  'What an employee is missing for a kind of work, as of now. Expiry is derived from the date rather than read from a stored state, because a stored state is only as current as the last time somebody happened to write the row.';

-- -----------------------------------------------------------------------------
-- What is lapsing, for somebody to act on
-- -----------------------------------------------------------------------------
/**
 * Credentials that have lapsed or are about to, and the work each one gates.
 *
 * A notification cannot announce this. The transition into 'expired' now happens
 * with no write at all — that is the whole point of deriving it — so no trigger
 * can fire on it, and the platform has no scheduler to sweep for it. Rather than
 * leave a producer that only fires when somebody happens to edit a row, the fact
 * is published where a screen or a future job can read it, and the absence of
 * the sweep is recorded in the verdict rather than papered over.
 */
create or replace view reporting_credential_expiry
with (security_invoker = true) as
select
  c.company_id,
  c.employee_id,
  e.full_name                                            as employee_name,
  e.status                                               as employment_status,
  c.id                                                   as credential_id,
  c.name                                                 as credential_name,
  c.credential_type,
  c.expires_on,
  c.lifecycle,
  app.credential_standing(c.lifecycle, c.expires_on)     as standing,
  c.expires_on - current_date                            as days_remaining,
  -- The work this credential is a prerequisite for, so the consequence of the
  -- lapse is visible beside it rather than looked up afterwards.
  coalesce((
    select array_agg(distinct r.work_type order by r.work_type)
    from work_credential_requirements r
    where r.company_id = c.company_id
      and lower(r.credential_name) = lower(c.name)
      and r.is_mandatory
  ), '{}')                                               as blocks_work_types
from credentials c
join employees e on e.id = c.employee_id
where app.credential_standing(c.lifecycle, c.expires_on) in ('expired', 'expiring', 'revoked');

comment on view reporting_credential_expiry is
  'Credentials that have lapsed, are about to, or were withdrawn — with the work each one blocks. Derived on read, so it is correct on the day it is read rather than on the day somebody last edited the record.';

grant select on reporting_credential_expiry to authenticated;
revoke all on reporting_credential_expiry from anon;

/**
 * Notify when a credential is written in a state somebody should act on.
 *
 * Narrower than what it replaces, and honestly so. The old producer claimed to
 * announce expiry and could only fire when somebody wrote the row — which, for
 * a date passing on its own, is never. What remains is every case with a real
 * write and a real actor behind it: a credential withdrawn, or one recorded or
 * amended to a date that has already gone or is about to.
 *
 * The sweep this cannot do — noticing a date pass with nobody watching — is
 * `reporting_credential_expiry` above, and the absence of a scheduler to read
 * it is recorded rather than papered over.
 */
create or replace function app.notify_credential_lapse()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_name     text;
  v_gates    text[];
  v_standing text := app.credential_standing(new.lifecycle, new.expires_on);
begin
  if v_standing not in ('revoked', 'expired', 'expiring') then
    return new;
  end if;
  -- Only on the transition, not on every later touch of an already-lapsed row.
  if tg_op = 'UPDATE'
     and app.credential_standing(old.lifecycle, old.expires_on) = v_standing then
    return new;
  end if;

  select first_name || ' ' || last_name into v_name from employees where id = new.employee_id;

  -- What the lapse actually costs, named beside it. Both sources: the work
  -- rules the company configured, and the credential's own declaration.
  select array_agg(distinct w order by w) into v_gates from (
    select r.work_type as w from work_credential_requirements r
     where r.company_id = new.company_id
       and lower(r.credential_name) = lower(new.name)
    union
    select unnest(new.required_for)
  ) x;

  insert into notifications (company_id, category, severity, title, body,
                             action_path, action_label, entity_table, entity_id)
  values (
    new.company_id, 'safety',
    case when v_standing = 'expiring' then 'warning' else 'critical' end,
    coalesce(v_name, 'An employee') || ': ' || new.name || ' ' || v_standing,
    new.name || ' ' ||
      case when v_standing = 'revoked' then 'was withdrawn'
           when v_standing = 'expired' then 'expired on ' || coalesce(new.expires_on::text, 'an unrecorded date')
           else 'expires on ' || coalesce(new.expires_on::text, 'an unrecorded date') end ||
      case when v_gates is null or cardinality(v_gates) = 0 then '.'
           else '. Required for: ' || array_to_string(v_gates, ', ') || '.' end,
    '/app/workforce', 'Open the record', 'public.credentials', new.id::text);

  return new;
end;
$$;

create trigger notify_credential_lapse
  after insert or update of lifecycle, expires_on on credentials
  for each row execute function app.notify_credential_lapse();

drop function if exists app.notify_credential_expiry();

select app.assert_security_gates();

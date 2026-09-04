-- =============================================================================
-- 0034 — Financial periods
--
-- The platform records job cost with a `cost_date` and bills with a period
-- start and end, and nothing could close a period. A cost dated last March
-- could be posted today, silently changing a job cost figure somebody reported
-- to an owner, a bank or a bonding company months ago.
--
-- This is the same family as everything else this build has found: a number
-- that moved after somebody acted on it. Here it moves retroactively, which is
-- worse — the report was right when it was produced and is wrong now, and
-- nothing says which.
--
-- What this is not: a general ledger. There is no chart of accounts, no journal
-- entry, no trial balance and no posting to one, and this migration does not
-- pretend otherwise. It closes the cutoff question for the operational finance
-- the platform actually has — job cost and payables — which is the part people
-- report from.
-- =============================================================================

create table financial_periods (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,

  period_start        date not null,
  period_end          date not null,
  -- A label a person recognizes: "March 2026", "FY26 Q1".
  name                text not null check (length(trim(name)) > 0),

  status              text not null default 'open' check (status in ('open', 'closed')),
  closed_by           uuid references auth.users(id) on delete set null,
  closed_at           timestamptz,
  -- Why it was reopened, if it was. A reopened period is an accounting event.
  reopened_by         uuid references auth.users(id) on delete set null,
  reopened_at         timestamptz,
  reopen_reason       text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint financial_periods_range check (period_end >= period_start),
  -- A closed period has to say who closed it and when, or "closed" is a word
  -- rather than a decision.
  constraint financial_periods_closed
    check (status <> 'closed' or (closed_by is not null and closed_at is not null)),
  -- Reopening is allowed and recorded. Reopening without a reason is not.
  constraint financial_periods_reopened
    check (reopened_at is null or (reopened_by is not null
           and reopen_reason is not null and length(trim(reopen_reason)) >= 12)),
  unique (company_id, period_start)
);

-- Two periods covering the same day would make "is this date closed" depend on
-- which row was read first.
alter table financial_periods
  add constraint financial_periods_no_overlap
  exclude using gist (
    company_id with =,
    daterange(period_start, period_end, '[]') with &&
  );

create index financial_periods_lookup_idx
  on financial_periods(company_id, period_start desc);

comment on table financial_periods is
  'Accounting periods and whether they are closed. ENTITY. Not a general ledger — there is none — but the cutoff control for the operational finance the platform does have.';

comment on constraint financial_periods_no_overlap on financial_periods is
  'Periods cannot overlap. Two rows covering one day would make the closed/open answer depend on which was read first.';

/**
 * Is this date inside a closed period for this company?
 *
 * Returns 'closed', 'open', or 'none' when no period covers the date. 'none'
 * is permissive: a company that has never defined a period is not running a
 * close, and the platform must not invent one.
 */
create or replace function app.period_status(p_company uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select p.status from financial_periods p
      where p.company_id = p_company
        and p_date between p.period_start and p.period_end
      limit 1),
    'none');
$$;

grant execute on function app.period_status(uuid, date) to authenticated, service_role;

/**
 * Refuse a financial record dated inside a closed period.
 *
 * TG_ARGV: [0] the date column, [1] what is being posted.
 *
 * The check runs on update as well as insert, because moving an existing cost
 * into a closed period is the same act as posting one there. Moving a cost
 * *out* of a closed period is refused for the same reason: the period's total
 * would change after it was reported.
 */
create or replace function app.enforce_open_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_new_date date;
  v_old_date date;
begin
  execute format('select ($1).%I::date', tg_argv[0]) into v_new_date using new;

  if app.period_status(new.company_id, v_new_date) = 'closed' then
    raise exception
      'The period containing % is closed; % cannot be posted into it. Reopen the period, with a reason, or date the entry in an open one.',
      v_new_date, tg_argv[1]
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'UPDATE' then
    execute format('select ($1).%I::date', tg_argv[0]) into v_old_date using old;
    if v_old_date is distinct from v_new_date
       and app.period_status(new.company_id, v_old_date) = 'closed' then
      raise exception
        'Moving % out of the closed period containing % would change a period total after it was reported.',
        tg_argv[1], v_old_date
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger project_costs_open_period
  before insert or update on project_costs
  for each row execute function app.enforce_open_period('cost_date', 'a job cost');

create trigger ap_invoices_open_period
  before insert or update on ap_invoices
  for each row execute function app.enforce_open_period('invoice_date', 'a payable');

comment on function app.enforce_open_period() is
  'Refuses a posting into a closed period, and refuses moving one out of a closed period. A company with no periods defined is unaffected: it is not running a close, and the platform does not invent one.';

/**
 * Close a period, refusing to close over work that is not finished.
 *
 * A close that silently leaves a draft pay application inside it produces a
 * period total that is going to change, which is the thing closing is for.
 */
create or replace function app.close_financial_period(p_period uuid, p_note text default null)
returns financial_periods
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_period financial_periods%rowtype;
  v_drafts int;
begin
  select * into v_period from financial_periods where id = p_period;
  if not found then
    raise exception 'No such period.' using errcode = 'no_data_found';
  end if;
  if v_period.status = 'closed' then
    raise exception 'Period % is already closed.', v_period.name
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_drafts
  from pay_applications a
  where a.company_id = v_period.company_id
    and a.status in ('draft', 'submitted')
    and a.period_end between v_period.period_start and v_period.period_end;

  if v_drafts > 0 then
    raise exception
      'Period % has % pay application(s) still open. Closing over them would fix a total that is still going to move.',
      v_period.name, v_drafts
      using errcode = 'restrict_violation';
  end if;

  update financial_periods
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         reopen_reason = coalesce(p_note, reopen_reason)
   where id = p_period
   returning * into v_period;

  return v_period;
end;
$$;

grant execute on function app.close_financial_period(uuid, text) to authenticated;

comment on function app.close_financial_period(uuid, text) is
  'Closes a period after checking nothing inside it is still open. SECURITY INVOKER, so the caller''s permissions still decide whether they may write the row.';

-- -----------------------------------------------------------------------------
-- RLS, audit and grants
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('financial_periods', 'finance.read', 'finance.write');
select app.attach_standard_triggers('public.financial_periods'::regclass);

select app.assert_security_gates();

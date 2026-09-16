-- =============================================================================
-- 0197 — A notice you gave in time
--
-- `contracts` and `claims` have existed since migration 0023, fully governed,
-- with four constraints and a trigger between them — and no writer of any kind.
-- A company could read the claims it was running and could not open one.
--
-- What that cost, specifically:
--
--   * **`app.derive_claim_deadlines` had never fired.** It reads the contract's
--     own notice and claim clauses and dates the deadlines off the event. It is
--     the reason `notice_days` and `claim_days` are stored as numbers rather
--     than as prose, and nothing could ever put a row through it.
--
--   * **The supporting arrays had never been written.** `supporting_daily_reports`,
--     `supporting_rfis` and `supporting_documents` are what a claim actually
--     rests on — contemporaneous records, made at the time, by people who did
--     not yet know there would be a claim. A claim argued from memory is one the
--     other side's lawyer takes apart.
--
-- The judgment this migration makes, and the reason it is written down: **a late
-- notice is recorded, not refused.** Most construction claims are lost on the
-- notice clause rather than on their merits, and the temptation is to refuse a
-- notice given after the deadline so the record stays clean. That would hide the
-- single most expensive fact a company can know about its own claim. The notice
-- is accepted, the lateness is computed, and the screen says it in the plainest
-- words available — because somebody has to decide what to do about it, and
-- they cannot decide about a fact they were not shown.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The contract the claim will be argued under
-- -----------------------------------------------------------------------------

/** The next unused contract number for one company. Unique on (company, number). */
create or replace function app.next_company_contract_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'CT-' || to_char(current_date, 'YYYY') || '-' ||
         lpad((coalesce(max(substring(c.number from '^CT-\d{4}-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from contracts c
  where c.company_id = p_company
    and c.number ~ ('^CT-' || to_char(current_date, 'YYYY') || '-\d+$');
$$;

comment on function app.next_company_contract_number(uuid) is
  'The next unused CT-YYYY-0000 for one company. WORKFLOW support: contracts is unique on (company_id, number), so a screen must not pick one.';

/**
 * Record the contract.
 *
 * The clauses are asked for as days rather than as prose, because a deadline
 * that cannot be computed is a deadline nobody is warned about. They are
 * optional — plenty of contracts are signed before anybody reads the notice
 * provision — and a claim under a contract with no clause simply carries no
 * derived deadline rather than an invented one.
 */
create or replace function app.create_contract(
  p_project uuid,
  p_title text,
  p_contract_type text default 'lump_sum',
  p_original_value numeric default 0,
  p_customer uuid default null,
  p_executed_on date default null,
  p_notice_days int default null,
  p_claim_days int default null,
  p_liquidated_damages_per_day numeric default null,
  p_retainage_percent numeric default null,
  p_number text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'estimates.approve');
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
  v_number  text := nullif(trim(coalesce(p_number, '')), '');
  v_id      uuid;
begin
  if v_title is null then
    raise exception 'A contract needs a title' using errcode = 'check_violation';
  end if;
  if p_contract_type not in ('lump_sum', 'unit_price', 'cost_plus', 'gmp', 'time_and_materials') then
    raise exception 'Unknown contract type %', p_contract_type using errcode = 'check_violation';
  end if;
  if coalesce(p_original_value, 0) < 0 then
    raise exception 'A contract value cannot be negative' using errcode = 'check_violation';
  end if;
  if p_retainage_percent is not null
     and (p_retainage_percent < 0 or p_retainage_percent >= 1) then
    raise exception 'Retainage is a fraction below 1' using errcode = 'check_violation';
  end if;

  v_number := coalesce(v_number, app.next_company_contract_number(v_company));
  if exists (select 1 from contracts where company_id = v_company and number = v_number) then
    raise exception 'Contract % already exists', v_number using errcode = 'unique_violation';
  end if;

  insert into contracts (
    company_id, project_id, customer_id, number, title, contract_type,
    original_value, executed_on, notice_days, claim_days,
    liquidated_damages_per_day, retainage_percent,
    status)
  values (v_company, p_project, p_customer, v_number, v_title, p_contract_type,
          coalesce(p_original_value, 0), p_executed_on, p_notice_days, p_claim_days,
          p_liquidated_damages_per_day, coalesce(p_retainage_percent, 0.05),
          case when p_executed_on is null then 'draft' else 'executed' end)
  returning id into v_id;
  return v_id;
end;
$$;

/** Correct a contract, including the clauses a claim will be argued under. */
create or replace function app.update_contract(
  p_contract uuid,
  p_title text default null,
  p_contract_type text default null,
  p_original_value numeric default null,
  p_executed_on date default null,
  p_substantial_completion_on date default null,
  p_final_completion_on date default null,
  p_notice_days int default null,
  p_claim_days int default null,
  p_liquidated_damages_per_day numeric default null,
  p_retainage_percent numeric default null,
  p_status text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c contracts%rowtype;
begin
  select * into v_c from contracts where id = p_contract;
  if v_c.id is null then
    raise exception 'No such contract' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');

  if p_status is not null
     and p_status not in ('draft', 'executed', 'active', 'closed', 'terminated') then
    raise exception 'Unknown contract status %', p_status using errcode = 'check_violation';
  end if;
  if coalesce(p_status, v_c.status) <> 'draft'
     and coalesce(p_executed_on, v_c.executed_on) is null then
    raise exception 'A contract past draft records the date it was executed'
      using errcode = 'check_violation',
            hint = 'Every deadline in it is dated from somewhere, and this is the date the clauses start running.';
  end if;

  update contracts
     set title            = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
         contract_type    = coalesce(p_contract_type, contract_type),
         original_value   = coalesce(p_original_value, original_value),
         executed_on      = coalesce(p_executed_on, executed_on),
         substantial_completion_on = coalesce(p_substantial_completion_on, substantial_completion_on),
         final_completion_on       = coalesce(p_final_completion_on, final_completion_on),
         notice_days      = coalesce(p_notice_days, notice_days),
         claim_days       = coalesce(p_claim_days, claim_days),
         liquidated_damages_per_day = coalesce(p_liquidated_damages_per_day, liquidated_damages_per_day),
         retainage_percent = coalesce(p_retainage_percent, retainage_percent),
         status           = coalesce(p_status, status),
         updated_at       = now()
   where id = p_contract;
end;
$$;

-- -----------------------------------------------------------------------------
-- The claim
-- -----------------------------------------------------------------------------

/** The next unused claim number for one company. Unique on (company, number). */
create or replace function app.next_company_claim_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'CL-' || to_char(current_date, 'YYYY') || '-' ||
         lpad((coalesce(max(substring(c.number from '^CL-\d{4}-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from claims c
  where c.company_id = p_company
    and c.number ~ ('^CL-' || to_char(current_date, 'YYYY') || '-\d+$');
$$;

/**
 * Open a claim, as a potential one.
 *
 * It starts at `potential` and it cannot start anywhere else: `claims_notice`
 * requires a notice date past that point, and a claim created already noticed
 * would be a claim whose notice nobody had actually given.
 *
 * The deadlines are not asked for. `app.derive_claim_deadlines` reads them off
 * the contract's own clauses — which is the entire reason those clauses are
 * stored as numbers of days rather than as quoted prose — and a deadline typed
 * in by hand is a deadline that stops agreeing with the contract the moment
 * either is corrected.
 */
create or replace function app.create_claim(
  p_project uuid,
  p_title text,
  p_claim_type text,
  p_description text,
  p_event_date date,
  p_contract uuid default null,
  p_cost_claimed numeric default 0,
  p_time_claimed_days numeric default 0,
  p_number text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'estimates.approve');
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
  v_desc    text := nullif(trim(coalesce(p_description, '')), '');
  v_number  text := nullif(trim(coalesce(p_number, '')), '');
  v_id      uuid;
begin
  if v_title is null then
    raise exception 'A claim needs a title' using errcode = 'check_violation';
  end if;
  if v_desc is null then
    raise exception 'A claim needs to say what happened'
      using errcode = 'check_violation',
            hint = 'Written now, while anybody still remembers. This is the contemporaneous record.';
  end if;
  if p_claim_type not in ('differing_site_condition', 'delay', 'acceleration', 'disruption',
                          'changed_scope', 'suspension', 'defective_documents', 'payment', 'other') then
    raise exception 'Unknown claim type %', p_claim_type using errcode = 'check_violation';
  end if;
  if p_event_date is null then
    raise exception 'A claim is dated from the event it is about'
      using errcode = 'check_violation',
            hint = 'Every deadline in the contract runs from this date.';
  end if;
  if p_event_date > current_date then
    raise exception 'That event has not happened yet' using errcode = 'check_violation';
  end if;
  if p_contract is not null
     and not exists (select 1 from contracts c
                      where c.id = p_contract and c.project_id = p_project) then
    raise exception 'That contract is not on this project' using errcode = 'no_data_found';
  end if;

  v_number := coalesce(v_number, app.next_company_claim_number(v_company));
  if exists (select 1 from claims where company_id = v_company and number = v_number) then
    raise exception 'Claim % already exists', v_number using errcode = 'unique_violation';
  end if;

  insert into claims (
    company_id, project_id, contract_id, number, title, claim_type, description,
    event_date, cost_claimed, time_claimed_days, status, created_by)
  values (v_company, p_project, p_contract, v_number, v_title, p_claim_type, v_desc,
          p_event_date, coalesce(p_cost_claimed, 0), coalesce(p_time_claimed_days, 0),
          'potential', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Record that notice was given, on the day it was given.
 *
 * **A late notice is recorded, not refused.** Most construction claims are lost
 * on the notice clause rather than on their merits, so the temptation is to
 * refuse a notice after the deadline and keep the record clean. That would hide
 * the single most expensive fact a company can know about its own claim.
 *
 * What is refused is a notice dated before the event it is about — `claims_notice_order`
 * already refuses it, and so does this, in words about the claim rather than
 * about a constraint.
 */
create or replace function app.give_claim_notice(
  p_claim uuid,
  p_given_on date default current_date)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c claims%rowtype;
begin
  select * into v_c from claims where id = p_claim;
  if v_c.id is null then
    raise exception 'No such claim' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');
  if v_c.notice_given_on is not null then
    raise exception 'Notice on claim % was already given on %', v_c.number, v_c.notice_given_on
      using errcode = 'restrict_violation',
            hint = 'The date notice was given is evidence. Correcting it is a different act from giving it.';
  end if;
  if p_given_on < v_c.event_date then
    raise exception 'Notice cannot be dated before the event it is about (%)', v_c.event_date
      using errcode = 'check_violation';
  end if;
  if p_given_on > current_date then
    raise exception 'That notice has not been given yet' using errcode = 'check_violation';
  end if;

  update claims
     set notice_given_on = p_given_on,
         status          = case when status = 'potential' then 'notice_given' else status end,
         updated_at      = now()
   where id = p_claim;
end;
$$;

/** Submit the claim itself, which is a separate act from noticing it. */
create or replace function app.submit_claim(
  p_claim uuid,
  p_submitted_on date default current_date,
  p_cost_claimed numeric default null,
  p_time_claimed_days numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c claims%rowtype;
begin
  select * into v_c from claims where id = p_claim;
  if v_c.id is null then
    raise exception 'No such claim' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');
  if v_c.notice_given_on is null then
    raise exception 'Claim % has no notice on record, and a claim without notice is usually worth nothing', v_c.number
      using errcode = 'check_violation',
            hint = 'Record the date notice was given first — even a late one. What the record says is what can be argued.';
  end if;
  if v_c.status in ('settled', 'denied', 'withdrawn') then
    raise exception 'Claim % is %', v_c.number, v_c.status using errcode = 'restrict_violation';
  end if;

  update claims
     set claim_submitted_on = p_submitted_on,
         cost_claimed       = coalesce(p_cost_claimed, cost_claimed),
         time_claimed_days  = coalesce(p_time_claimed_days, time_claimed_days),
         status             = 'submitted',
         updated_at         = now()
   where id = p_claim;
end;
$$;

/** Move a live claim along: negotiating, litigation, or withdrawn. */
create or replace function app.set_claim_status(p_claim uuid, p_status text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c claims%rowtype;
begin
  select * into v_c from claims where id = p_claim;
  if v_c.id is null then
    raise exception 'No such claim' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');
  if p_status not in ('negotiating', 'litigation', 'withdrawn') then
    raise exception 'Noticing, submitting and resolving a claim are each their own act'
      using errcode = 'check_violation',
            hint = 'Each one records something different, and a dropdown that did all four would record none of them.';
  end if;
  if v_c.status in ('settled', 'denied') then
    raise exception 'Claim % is %, and its resolution is the record of what was decided',
      v_c.number, v_c.status using errcode = 'restrict_violation';
  end if;
  if v_c.notice_given_on is null then
    raise exception 'Claim % has no notice on record', v_c.number
      using errcode = 'check_violation';
  end if;

  update claims set status = p_status, updated_at = now() where id = p_claim;
end;
$$;

/**
 * Settle or deny it, with what was awarded and why.
 *
 * `claims_resolved` requires the date and the resolution together, and it is
 * right to: "denied" with no reason recorded is not a resolution, it is an
 * outcome nobody can learn from — and the next claim of the same type is argued
 * by somebody who cannot read why the last one failed.
 */
create or replace function app.resolve_claim(
  p_claim uuid,
  p_status text,
  p_resolution text,
  p_resolved_on date default current_date,
  p_cost_awarded numeric default null,
  p_time_awarded_days numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_c claims%rowtype;
  v_r text := nullif(trim(coalesce(p_resolution, '')), '');
begin
  select * into v_c from claims where id = p_claim;
  if v_c.id is null then
    raise exception 'No such claim' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');
  if p_status not in ('settled', 'denied') then
    raise exception 'A claim resolves as settled or denied' using errcode = 'check_violation';
  end if;
  if v_c.status in ('settled', 'denied') then
    raise exception 'Claim % is already %', v_c.number, v_c.status
      using errcode = 'restrict_violation';
  end if;
  if v_r is null or length(v_r) < 10 then
    raise exception 'A resolution says what was decided and why'
      using errcode = 'check_violation',
            hint = 'The next claim of this type is argued by somebody who can only read what is written here.';
  end if;
  if p_status = 'settled' and coalesce(p_cost_awarded, v_c.cost_awarded) is null
     and coalesce(p_time_awarded_days, v_c.time_awarded_days) is null then
    raise exception 'A settlement records what was awarded, in money or in time'
      using errcode = 'check_violation',
            hint = 'A settlement of nothing is a denial, and the two are argued differently next time.';
  end if;

  update claims
     set status            = p_status,
         resolution        = v_r,
         resolved_on       = coalesce(p_resolved_on, current_date),
         cost_awarded      = case when p_status = 'denied' then coalesce(p_cost_awarded, 0)
                                  else coalesce(p_cost_awarded, cost_awarded) end,
         time_awarded_days = case when p_status = 'denied' then coalesce(p_time_awarded_days, 0)
                                  else coalesce(p_time_awarded_days, time_awarded_days) end,
         updated_at        = now()
   where id = p_claim;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the claim is argued from
-- -----------------------------------------------------------------------------

/**
 * Attach a contemporaneous record to a claim.
 *
 * `supporting_daily_reports`, `supporting_rfis` and `supporting_documents` have
 * been on this table since 0023 and had never been written. They are what a
 * claim actually rests on: records made at the time, by people who did not yet
 * know there would be a claim. A claim argued from memory is one the other
 * side's counsel takes apart.
 *
 * The record has to belong to the same project. A daily report from another job
 * proves nothing about this one, and attaching one is the kind of mistake that
 * is found by the other side rather than by the person who made it.
 */
create or replace function app.attach_claim_support(
  p_claim uuid,
  p_kind text,
  p_record uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_c   claims%rowtype;
  v_ok  boolean;
begin
  select * into v_c from claims where id = p_claim;
  if v_c.id is null then
    raise exception 'No such claim' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');
  if p_kind not in ('daily_report', 'rfi', 'document') then
    raise exception 'A claim is argued from daily reports, RFIs and documents'
      using errcode = 'check_violation';
  end if;

  v_ok := case p_kind
    when 'daily_report' then exists (select 1 from daily_reports d
                                      where d.id = p_record and d.project_id = v_c.project_id)
    when 'rfi'          then exists (select 1 from rfis r
                                      where r.id = p_record and r.project_id = v_c.project_id)
    else                     exists (select 1 from documents x
                                      where x.id = p_record and x.company_id = v_c.company_id)
  end;
  if not v_ok then
    raise exception 'That record is not on this project'
      using errcode = 'no_data_found',
            hint = 'Evidence from another job proves nothing about this one, and the other side will say so.';
  end if;

  update claims
     set supporting_daily_reports = case when p_kind = 'daily_report'
           then (select array_agg(distinct e) from unnest(supporting_daily_reports || p_record) e)
           else supporting_daily_reports end,
         supporting_rfis = case when p_kind = 'rfi'
           then (select array_agg(distinct e) from unnest(supporting_rfis || p_record) e)
           else supporting_rfis end,
         supporting_documents = case when p_kind = 'document'
           then (select array_agg(distinct e) from unnest(supporting_documents || p_record) e)
           else supporting_documents end,
         updated_at = now()
   where id = p_claim;
end;
$$;

/** Take a record back off a claim. */
create or replace function app.detach_claim_support(
  p_claim uuid,
  p_kind text,
  p_record uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c claims%rowtype;
begin
  select * into v_c from claims where id = p_claim;
  if v_c.id is null then
    raise exception 'No such claim' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_c.project_id, 'estimates.approve');
  if p_kind not in ('daily_report', 'rfi', 'document') then
    raise exception 'A claim is argued from daily reports, RFIs and documents'
      using errcode = 'check_violation';
  end if;

  update claims
     set supporting_daily_reports = case when p_kind = 'daily_report'
           then coalesce((select array_agg(e) from unnest(supporting_daily_reports) e
                           where e <> p_record), '{}')
           else supporting_daily_reports end,
         supporting_rfis = case when p_kind = 'rfi'
           then coalesce((select array_agg(e) from unnest(supporting_rfis) e
                           where e <> p_record), '{}')
           else supporting_rfis end,
         supporting_documents = case when p_kind = 'document'
           then coalesce((select array_agg(e) from unnest(supporting_documents) e
                           where e <> p_record), '{}')
           else supporting_documents end,
         updated_at = now()
   where id = p_claim;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

create or replace view my_contracts
with (security_invoker = true) as
select c.id, c.company_id, c.project_id, c.customer_id, c.number, c.title,
       c.contract_type, c.original_value, c.executed_on,
       c.substantial_completion_on, c.final_completion_on,
       c.notice_days, c.claim_days, c.liquidated_damages_per_day,
       c.retainage_percent, c.status,
       p.number                                   as project_number,
       p.name                                     as project_name,
       cu.name                                    as customer_name,
       -- Whether a claim under this contract will get a computed deadline at
       -- all. A contract with no clause on file is not a contract with no
       -- clause, and the difference is worth saying out loud.
       (c.notice_days is not null)                as notice_clause_on_file,
       (select count(*) from claims cl where cl.contract_id = c.id) as claim_count
  from contracts c
  join projects p on p.id = c.project_id
  left join customers cu on cu.id = c.customer_id;

revoke all on my_contracts from public, anon;
grant select on my_contracts to authenticated, service_role;

create or replace view my_claims
with (security_invoker = true) as
select c.id, c.company_id, c.project_id, c.contract_id, c.number, c.title,
       c.claim_type, c.description, c.status,
       c.event_date, c.notice_given_on, c.notice_due_on,
       c.claim_submitted_on, c.claim_due_on,
       c.cost_claimed, c.time_claimed_days, c.cost_awarded, c.time_awarded_days,
       c.resolution, c.resolved_on,
       p.number                                   as project_number,
       p.name                                     as project_name,
       ct.number                                  as contract_number,
       coalesce(array_length(c.supporting_daily_reports, 1), 0) as supporting_reports,
       coalesce(array_length(c.supporting_rfis, 1), 0)          as supporting_rfis,
       coalesce(array_length(c.supporting_documents, 1), 0)     as supporting_documents,
       /*
        * The two facts that decide most construction claims before their merits
        * do, computed once here rather than worked out again on every screen
        * that shows a claim.
        */
       case when c.notice_due_on is null then null
            else (c.notice_due_on - current_date) end           as days_to_notice,
       (c.notice_given_on is null
        and c.notice_due_on is not null
        and c.status = 'potential')                             as notice_outstanding,
       (c.notice_given_on is not null
        and c.notice_due_on is not null
        and c.notice_given_on > c.notice_due_on)                as notice_was_late,
       case when c.notice_given_on is not null and c.notice_due_on is not null
            then (c.notice_given_on - c.notice_due_on) end      as notice_days_late
  from claims c
  join projects p on p.id = c.project_id
  left join contracts ct on ct.id = c.contract_id;

revoke all on my_claims from public, anon;
grant select on my_claims to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.create_contract(
  p_project uuid, p_title text, p_contract_type text default 'lump_sum',
  p_original_value numeric default 0, p_customer uuid default null,
  p_executed_on date default null, p_notice_days int default null,
  p_claim_days int default null, p_liquidated_damages_per_day numeric default null,
  p_retainage_percent numeric default null, p_number text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_contract(p_project, p_title, p_contract_type, p_original_value,
       p_customer, p_executed_on, p_notice_days, p_claim_days,
       p_liquidated_damages_per_day, p_retainage_percent, p_number); $$;

create or replace function public.update_contract(
  p_contract uuid, p_title text default null, p_contract_type text default null,
  p_original_value numeric default null, p_executed_on date default null,
  p_substantial_completion_on date default null, p_final_completion_on date default null,
  p_notice_days int default null, p_claim_days int default null,
  p_liquidated_damages_per_day numeric default null,
  p_retainage_percent numeric default null, p_status text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_contract(p_contract, p_title, p_contract_type, p_original_value,
       p_executed_on, p_substantial_completion_on, p_final_completion_on,
       p_notice_days, p_claim_days, p_liquidated_damages_per_day,
       p_retainage_percent, p_status); $$;

create or replace function public.create_claim(
  p_project uuid, p_title text, p_claim_type text, p_description text,
  p_event_date date, p_contract uuid default null, p_cost_claimed numeric default 0,
  p_time_claimed_days numeric default 0, p_number text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_claim(p_project, p_title, p_claim_type, p_description,
       p_event_date, p_contract, p_cost_claimed, p_time_claimed_days, p_number); $$;

create or replace function public.give_claim_notice(
  p_claim uuid, p_given_on date default current_date)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.give_claim_notice(p_claim, p_given_on); $$;

create or replace function public.submit_claim(
  p_claim uuid, p_submitted_on date default current_date,
  p_cost_claimed numeric default null, p_time_claimed_days numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.submit_claim(p_claim, p_submitted_on, p_cost_claimed, p_time_claimed_days); $$;

create or replace function public.set_claim_status(p_claim uuid, p_status text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_claim_status(p_claim, p_status); $$;

create or replace function public.resolve_claim(
  p_claim uuid, p_status text, p_resolution text,
  p_resolved_on date default current_date, p_cost_awarded numeric default null,
  p_time_awarded_days numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.resolve_claim(p_claim, p_status, p_resolution, p_resolved_on,
       p_cost_awarded, p_time_awarded_days); $$;

create or replace function public.attach_claim_support(
  p_claim uuid, p_kind text, p_record uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.attach_claim_support(p_claim, p_kind, p_record); $$;

create or replace function public.detach_claim_support(
  p_claim uuid, p_kind text, p_record uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.detach_claim_support(p_claim, p_kind, p_record); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_contract(uuid, text, text, numeric, uuid, date, int, int, numeric, numeric, text)',
    'public.update_contract(uuid, text, text, numeric, date, date, date, int, int, numeric, numeric, text)',
    'public.create_claim(uuid, text, text, text, date, uuid, numeric, numeric, text)',
    'public.give_claim_notice(uuid, date)',
    'public.submit_claim(uuid, date, numeric, numeric)',
    'public.set_claim_status(uuid, text)',
    'public.resolve_claim(uuid, text, text, date, numeric, numeric)',
    'public.attach_claim_support(uuid, text, uuid)',
    'public.detach_claim_support(uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();

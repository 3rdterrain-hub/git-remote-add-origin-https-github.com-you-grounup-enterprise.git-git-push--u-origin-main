-- =============================================================================
-- 0202 — A raise you enter once
--
-- 0201 gave wage sheets their shape. This gives them their doors, their row
-- level security, and the one function the whole union half exists for.
--
-- **`app.schedule_wage_increase`.** A union agreement carries its raises years
-- ahead: plus a dollar twenty-five on the first of May, again the May after
-- that, written into the contract everybody signed. Everyone knows they are
-- coming and everyone bids at today's rate anyway, because remembering is
-- nobody's job. This copies a sheet forward with the increase applied and dates
-- it — so a bid for work that happens after the step prices at the stepped rate
-- without a person thinking about it, and a raise three years out can be
-- entered this afternoon.
--
-- It is the cheapest thing in this whole area to build and the one that saves
-- money on every bid, which is why it is first.
--
-- WORKFLOW.
-- =============================================================================

select app.apply_tenant_rls('wage_schedules', null, 'libraries.write');

-- -----------------------------------------------------------------------------
-- The sheet
-- -----------------------------------------------------------------------------

/**
 * Record a wage sheet.
 *
 * It arrives as a draft. Approving is what lets it price, for the reason every
 * library row in this schema arrives unapproved: a wage nobody has looked at
 * should not reach a bid.
 */
create or replace function app.create_wage_schedule(
  p_company uuid,
  p_name text,
  p_basis text,
  p_effective_date date default current_date,
  p_union_name text default null,
  p_local_number text default null,
  p_district text default null,
  p_determination_number text default null,
  p_county text default null,
  p_state_code text default null,
  p_construction_type text default null,
  p_source_document_path text default null,
  p_notes text default null,
  p_code text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_code    text := nullif(trim(coalesce(p_code, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A wage sheet needs a name' using errcode = 'check_violation';
  end if;
  if p_basis not in ('open_shop', 'union', 'prevailing_wage') then
    raise exception 'A wage sheet is open shop, union or prevailing wage'
      using errcode = 'check_violation';
  end if;
  if p_basis = 'union'
     and (nullif(trim(coalesce(p_union_name, '')), '') is null
          or nullif(trim(coalesce(p_local_number, '')), '') is null) then
    raise exception 'A union sheet says which union and which local'
      using errcode = 'check_violation',
            hint = 'Local 18 does not pay the same across Ohio, and 324 is a different agreement entirely. Without the local nobody can check the sheet against the contract it came from.';
  end if;
  if p_basis = 'prevailing_wage'
     and (nullif(trim(coalesce(p_determination_number, '')), '') is null
          or nullif(trim(coalesce(p_county, '')), '') is null
          or nullif(trim(coalesce(p_state_code, '')), '') is null
          or p_construction_type is null) then
    raise exception 'A determination says which decision, which county and which construction type'
      using errcode = 'check_violation',
            hint = 'Heavy, highway, building and residential pay differently for the same trade in the same county. Bidding site work off the building decision is the mistake this refuses.';
  end if;

  v_code := coalesce(v_code,
    upper(regexp_replace(left(v_name, 18), '[^a-zA-Z0-9]+', '-', 'g'))
      || '-' || to_char(p_effective_date, 'YYYYMMDD'));

  if exists (select 1 from wage_schedules where company_id = v_company and code = v_code) then
    raise exception 'A wage sheet with the code % is already on file', v_code
      using errcode = 'unique_violation';
  end if;

  insert into wage_schedules (
    company_id, code, name, basis, union_name, local_number, district,
    determination_number, county, state_code, construction_type,
    effective_date, source_document_path, notes, status, created_by)
  values (v_company, v_code, v_name, p_basis,
          nullif(trim(coalesce(p_union_name, '')), ''),
          nullif(trim(coalesce(p_local_number, '')), ''),
          nullif(trim(coalesce(p_district, '')), ''),
          nullif(trim(coalesce(p_determination_number, '')), ''),
          nullif(trim(coalesce(p_county, '')), ''),
          nullif(trim(coalesce(p_state_code, '')), ''),
          p_construction_type,
          p_effective_date,
          nullif(trim(coalesce(p_source_document_path, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''),
          'draft', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/** Approve a sheet so it can price. */
create or replace function app.approve_wage_schedule(p_schedule uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_s wage_schedules%rowtype;
begin
  select * into v_s from wage_schedules where id = p_schedule;
  if v_s.id is null then
    raise exception 'No such wage sheet' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_s.company_id, 'libraries.approve') then
    raise exception 'Approving a wage sheet needs the libraries.approve permission'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from labor_rates where wage_schedule_id = p_schedule) then
    raise exception 'That sheet has no rates on it yet'
      using errcode = 'check_violation',
            hint = 'An approved sheet with nothing on it refuses every crew that points at it.';
  end if;
  update wage_schedules
     set status = 'active', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_schedule;
end;
$$;

-- -----------------------------------------------------------------------------
-- The rates on it
-- -----------------------------------------------------------------------------

/**
 * Put a class on a sheet.
 *
 * `trade` and `class_label` are both required, because they are the pair that
 * survives translation: your "Operator II", the agreement's "Class 2" and a
 * determination's "Class II" are three different strings for one person, and
 * the pair is the only thing that connects them.
 */
create or replace function app.add_wage_rate(
  p_schedule uuid,
  p_trade text,
  p_class_label text,
  p_base_wage numeric,
  p_fringe_per_hour numeric default 0,
  p_burden_percent numeric default 0,
  p_fringe_is_taxable boolean default false,
  p_classification text default null,
  p_overtime_multiplier numeric default 1.5,
  p_doubletime_multiplier numeric default 2.0)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s     wage_schedules%rowtype;
  v_trade text := nullif(trim(coalesce(p_trade, '')), '');
  v_class text := nullif(trim(coalesce(p_class_label, '')), '');
  v_id    uuid;
begin
  select * into v_s from wage_schedules where id = p_schedule;
  if v_s.id is null then
    raise exception 'No such wage sheet' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_s.company_id, 'libraries.write');
  if v_trade is null or v_class is null then
    raise exception 'A rate on a sheet needs its trade and its class'
      using errcode = 'check_violation',
            hint = 'Operating Engineer / Class 2. The pair is what lets the same crew be found on a shop scale, an agreement and a determination.';
  end if;
  if coalesce(p_base_wage, 0) < 0 or coalesce(p_fringe_per_hour, 0) < 0 then
    raise exception 'A wage and a fringe cannot be negative' using errcode = 'check_violation';
  end if;
  if exists (select 1 from labor_rates
              where wage_schedule_id = p_schedule and trade = v_trade and class_label = v_class) then
    raise exception '% (%) is already on that sheet', v_trade, v_class
      using errcode = 'unique_violation';
  end if;

  insert into labor_rates (
    company_id, wage_schedule_id, code, classification, labor_group, trade, class_label,
    base_wage_per_hour, fringe_per_hour, fringe_is_taxable, burden_percent,
    overtime_multiplier, doubletime_multiplier, region, is_union,
    effective_date, expires_on, status, approval_state, source, origin,
    approved_by, approved_at)
  values (v_s.company_id, p_schedule,
          v_s.code || '-' || upper(regexp_replace(v_trade || '-' || v_class, '[^a-zA-Z0-9]+', '', 'g')),
          coalesce(nullif(trim(coalesce(p_classification, '')), ''), v_trade || ', ' || v_class),
          v_trade, v_trade, v_class,
          coalesce(p_base_wage, 0), coalesce(p_fringe_per_hour, 0),
          coalesce(p_fringe_is_taxable, false), coalesce(p_burden_percent, 0),
          coalesce(p_overtime_multiplier, 1.5), coalesce(p_doubletime_multiplier, 2.0),
          v_s.name, (v_s.basis = 'union'),
          v_s.effective_date, v_s.expires_on,
          app.copy_status(v_s.company_id),
          case when app.has_permission(v_s.company_id, 'libraries.approve')
               then 'approved'::app.approval_state else 'pending'::app.approval_state end,
          'Wage sheet ' || v_s.code, 'company',
          app.copy_approver(v_s.company_id), app.copy_approved_at(v_s.company_id))
  returning id into v_id;
  return v_id;
end;
$$;

/** Correct a rate on a sheet — the wage you actually get paid. */
create or replace function app.set_wage_rate(
  p_rate uuid,
  p_base_wage numeric default null,
  p_fringe_per_hour numeric default null,
  p_burden_percent numeric default null,
  p_fringe_is_taxable boolean default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_r labor_rates%rowtype;
begin
  select * into v_r from labor_rates where id = p_rate;
  if v_r.id is null then
    raise exception 'No such labor rate' using errcode = 'no_data_found';
  end if;
  if v_r.company_id is null then
    raise exception 'That rate belongs to the shipped catalog'
      using errcode = 'insufficient_privilege',
            hint = 'Make your own copy of it first — the GrounUp seed badge on the row does it.';
  end if;
  perform app.company_for_write(v_r.company_id, 'libraries.write');
  if coalesce(p_base_wage, 0) < 0 or coalesce(p_fringe_per_hour, 0) < 0 then
    raise exception 'A wage and a fringe cannot be negative' using errcode = 'check_violation';
  end if;

  update labor_rates
     set base_wage_per_hour = coalesce(p_base_wage, base_wage_per_hour),
         fringe_per_hour    = coalesce(p_fringe_per_hour, fringe_per_hour),
         burden_percent     = coalesce(p_burden_percent, burden_percent),
         fringe_is_taxable  = coalesce(p_fringe_is_taxable, fringe_is_taxable),
         updated_at         = now()
   where id = p_rate;
end;
$$;

/** Say that a rate is a percentage of a journeyman rather than a figure. */
create or replace function app.set_apprentice_step(
  p_rate uuid,
  p_journeyman uuid,
  p_percent numeric)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_r labor_rates%rowtype;
  v_j labor_rates%rowtype;
begin
  select * into v_r from labor_rates where id = p_rate;
  select * into v_j from labor_rates where id = p_journeyman;
  if v_r.id is null or v_j.id is null then
    raise exception 'No such labor rate' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_r.company_id, 'libraries.write');
  if p_rate = p_journeyman then
    raise exception 'A rate cannot be a percentage of itself' using errcode = 'check_violation';
  end if;
  if p_percent is null or p_percent <= 0 or p_percent > 1 then
    raise exception 'An apprentice step is a fraction between 0 and 1'
      using errcode = 'check_violation';
  end if;
  if v_j.percent_of_journeyman is not null then
    raise exception 'That journeyman rate is itself an apprentice step'
      using errcode = 'check_violation',
            hint = 'Point the apprentice at the journeyman it is a percentage of, not at another step.';
  end if;

  update labor_rates
     set percent_of_journeyman = p_percent,
         journeyman_rate_id    = p_journeyman,
         base_wage_per_hour    = round(v_j.base_wage_per_hour * p_percent, 4),
         updated_at            = now()
   where id = p_rate;
end;
$$;

-- -----------------------------------------------------------------------------
-- The raise you enter once
-- -----------------------------------------------------------------------------

/**
 * Copy a sheet forward with its scheduled increase applied.
 *
 * This is the whole reason the union half is worth building. An agreement
 * carries its raises years ahead — plus a dollar twenty-five on the first of
 * May, again the May after — and every estimator bids at today's rate anyway,
 * because remembering three Mays from now is nobody's job.
 *
 * Enter it once, this afternoon. Every bid for work dated after that step
 * prices at the stepped rate, and the sheet it came from is named on the line.
 *
 * The increase can be given as dollars, as a fraction, or both — agreements are
 * written both ways, and a screen that only took one would get the other typed
 * into it wrong. The old sheet is dated to expire the day the new one starts,
 * so the chain reads as one agreement rather than as two that overlap.
 */
create or replace function app.schedule_wage_increase(
  p_schedule uuid,
  p_effective_date date,
  p_wage_increase numeric default 0,
  p_fringe_increase numeric default 0,
  p_wage_percent numeric default 0,
  p_name text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s   wage_schedules%rowtype;
  v_new uuid;
  v_n   int;
begin
  select * into v_s from wage_schedules where id = p_schedule;
  if v_s.id is null then
    raise exception 'No such wage sheet' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_s.company_id, 'libraries.write');

  if p_effective_date is null or p_effective_date <= v_s.effective_date then
    raise exception 'A raise takes effect after the sheet it raises (%)', v_s.effective_date
      using errcode = 'check_violation';
  end if;
  if coalesce(p_wage_increase, 0) = 0 and coalesce(p_fringe_increase, 0) = 0
     and coalesce(p_wage_percent, 0) = 0 then
    raise exception 'Say what the increase is'
      using errcode = 'check_violation',
            hint = 'Dollars on the wage, dollars on the fringe, a percentage, or any combination — agreements are written every way.';
  end if;
  if coalesce(p_wage_percent, 0) < 0 or coalesce(p_wage_percent, 0) > 1 then
    raise exception 'A percentage increase is a fraction between 0 and 1'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from wage_schedules
              where supersedes_id = p_schedule and effective_date = p_effective_date) then
    raise exception 'That step is already on file for %', p_effective_date
      using errcode = 'unique_violation';
  end if;

  insert into wage_schedules (
    company_id, code, name, basis, union_name, local_number, district,
    determination_number, county, state_code, construction_type,
    effective_date, supersedes_id, notes, status, created_by)
  values (v_s.company_id,
          v_s.code || '-' || to_char(p_effective_date, 'YYYYMMDD'),
          coalesce(nullif(trim(coalesce(p_name, '')), ''),
                   v_s.name || ' — ' || to_char(p_effective_date, 'FMMonth YYYY')),
          v_s.basis, v_s.union_name, v_s.local_number, v_s.district,
          v_s.determination_number, v_s.county, v_s.state_code, v_s.construction_type,
          p_effective_date, p_schedule,
          'Scheduled increase from ' || v_s.code, 'draft', auth.uid())
  returning id into v_new;

  /*
   * Every class comes forward. A step that carried only the classes somebody
   * remembered would leave the rest silently on last year's money, which is the
   * exact failure this function exists to prevent.
   *
   * Apprentice steps come across as percentages and are recomputed from their
   * new journeyman below, rather than having the raise applied to them twice.
   */
  insert into labor_rates (
    company_id, wage_schedule_id, code, classification, labor_group, trade, class_label,
    base_wage_per_hour, fringe_per_hour, fringe_is_taxable, burden_percent,
    overtime_multiplier, doubletime_multiplier, region, is_union,
    effective_date, status, approval_state, source, origin,
    percent_of_journeyman)
  select r.company_id, v_new,
         replace(r.code, v_s.code, v_s.code || '-' || to_char(p_effective_date, 'YYYYMMDD')),
         r.classification, r.labor_group, r.trade, r.class_label,
         case when r.percent_of_journeyman is not null then r.base_wage_per_hour
              else round((r.base_wage_per_hour + coalesce(p_wage_increase, 0))
                         * (1 + coalesce(p_wage_percent, 0)), 4) end,
         round(r.fringe_per_hour + coalesce(p_fringe_increase, 0), 4),
         r.fringe_is_taxable, r.burden_percent,
         r.overtime_multiplier, r.doubletime_multiplier, r.region, r.is_union,
         p_effective_date, 'draft',
         'pending'::app.approval_state,
         'Scheduled increase from ' || r.code, 'company',
         r.percent_of_journeyman
    from labor_rates r
   where r.wage_schedule_id = p_schedule
     and r.status <> 'retired';

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'That sheet has no rates to carry forward' using errcode = 'no_data_found';
  end if;

  /* Re-point each apprentice at its journeyman on the *new* sheet, and take
     the step from the new journeyman wage rather than from last year's. */
  update labor_rates a
     set journeyman_rate_id = j.id,
         base_wage_per_hour = round(j.base_wage_per_hour * a.percent_of_journeyman, 4)
    from labor_rates old_a
    join labor_rates old_j on old_j.id = old_a.journeyman_rate_id
    join labor_rates j on j.wage_schedule_id = v_new
                      and j.trade = old_j.trade and j.class_label = old_j.class_label
   where a.wage_schedule_id = v_new
     and a.percent_of_journeyman is not null
     and old_a.wage_schedule_id = p_schedule
     and old_a.trade = a.trade and old_a.class_label = a.class_label;

  /* The old sheet stops the day the new one starts. */
  update wage_schedules set expires_on = p_effective_date, updated_at = now()
   where id = p_schedule;
  update labor_rates set expires_on = p_effective_date, updated_at = now()
   where wage_schedule_id = p_schedule;

  return v_new;
end;
$$;

comment on function app.schedule_wage_increase(uuid, date, numeric, numeric, numeric, text) is
  'Copies a wage sheet forward with its scheduled increase applied and dates it. WORKFLOW: an agreement carries its raises years ahead and everybody bids at today''s rate anyway, because remembering is nobody''s job. Entered once, every bid after the step prices right on its own.';

-- -----------------------------------------------------------------------------
-- Which sheet an estimate prices from
-- -----------------------------------------------------------------------------

/**
 * Point an estimate version at a wage sheet, or back at nothing.
 *
 * Null puts it back on the rates its crews already name — the identity path, and
 * the default every open-shop company stays on.
 */
create or replace function app.set_estimate_wage_schedule(
  p_version uuid,
  p_schedule uuid default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  text;
  v_s       wage_schedules%rowtype;
begin
  select company_id, status into v_company, v_status
    from estimate_versions where id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_company, 'estimates.write');
  if v_status <> 'draft' then
    raise exception 'That version is % and its pricing basis is fixed', v_status
      using errcode = 'restrict_violation',
            hint = 'An issued bid keeps the wages it was priced with. Open a new version to bid it another way.';
  end if;

  if p_schedule is not null then
    select * into v_s from wage_schedules where id = p_schedule;
    if v_s.id is null or v_s.company_id <> v_company then
      raise exception 'No such wage sheet' using errcode = 'no_data_found';
    end if;
    if v_s.status <> 'active' then
      raise exception 'The wage sheet "%" is % and cannot price anything yet', v_s.name, v_s.status
        using errcode = 'check_violation',
              hint = 'Approve it first. A wage nobody has looked at should not reach a bid.';
    end if;
  end if;

  update estimate_versions
     set wage_schedule_id = p_schedule, updated_at = now()
   where id = p_version;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

create or replace view my_wage_schedules
with (security_invoker = true) as
select s.id, s.company_id, s.code, s.name, s.basis,
       s.union_name, s.local_number, s.district,
       s.determination_number, s.county, s.state_code, s.construction_type,
       s.effective_date, s.expires_on, s.supersedes_id, s.source_document_path,
       s.notes, s.status, s.approved_at,
       (select count(*) from labor_rates r where r.wage_schedule_id = s.id) as rate_count,
       -- What the sheet is, in the words a person would use for it.
       case s.basis
         when 'union' then s.union_name || ' Local ' || s.local_number
                           || coalesce(' · ' || s.district, '')
         when 'prevailing_wage' then s.determination_number || ' · ' || s.county
                           || ', ' || s.state_code || ' · ' || initcap(s.construction_type)
         else 'Company scale'
       end                                                    as scope_says,
       -- In force today, which is not the same as approved: a sheet dated for
       -- next May is approved now and prices nothing until May.
       (s.status = 'active'
        and s.effective_date <= current_date
        and (s.expires_on is null or s.expires_on > current_date))  as in_force_today,
       (s.effective_date > current_date)                      as starts_later,
       (select count(*) from estimate_versions v where v.wage_schedule_id = s.id) as estimates_using
  from wage_schedules s;

revoke all on my_wage_schedules from public, anon;
grant select on my_wage_schedules to authenticated, service_role;

create or replace view my_wage_rates
with (security_invoker = true) as
select r.id, r.company_id, r.wage_schedule_id, r.trade, r.class_label, r.classification,
       r.base_wage_per_hour, r.fringe_per_hour, r.fringe_is_taxable, r.burden_percent,
       r.overtime_multiplier, r.doubletime_multiplier,
       r.percent_of_journeyman, r.journeyman_rate_id,
       r.effective_date, r.expires_on, r.status,
       s.name                                                 as schedule_name,
       s.basis, s.code                                        as schedule_code,
       /*
        * The loaded figure, computed the way the engine computes it so the
        * library and the bid cannot disagree: base plus burden, plus fringe,
        * plus burden on the fringe only where it is paid as cash.
        */
       round(r.base_wage_per_hour * (1 + r.burden_percent)
             + r.fringe_per_hour
             + case when r.fringe_is_taxable
                    then r.fringe_per_hour * r.burden_percent else 0 end, 4)
                                                              as loaded_per_hour,
       (r.percent_of_journeyman is not null)                  as follows_a_journeyman,
       j.classification                                       as journeyman_classification
  from labor_rates r
  join wage_schedules s on s.id = r.wage_schedule_id
  left join labor_rates j on j.id = r.journeyman_rate_id;

revoke all on my_wage_rates from public, anon;
grant select on my_wage_rates to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.create_wage_schedule(
  p_company uuid, p_name text, p_basis text, p_effective_date date default current_date,
  p_union_name text default null, p_local_number text default null,
  p_district text default null, p_determination_number text default null,
  p_county text default null, p_state_code text default null,
  p_construction_type text default null, p_source_document_path text default null,
  p_notes text default null, p_code text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_wage_schedule(p_company, p_name, p_basis, p_effective_date,
       p_union_name, p_local_number, p_district, p_determination_number, p_county,
       p_state_code, p_construction_type, p_source_document_path, p_notes, p_code); $$;

create or replace function public.approve_wage_schedule(p_schedule uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.approve_wage_schedule(p_schedule); $$;

create or replace function public.add_wage_rate(
  p_schedule uuid, p_trade text, p_class_label text, p_base_wage numeric,
  p_fringe_per_hour numeric default 0, p_burden_percent numeric default 0,
  p_fringe_is_taxable boolean default false, p_classification text default null,
  p_overtime_multiplier numeric default 1.5, p_doubletime_multiplier numeric default 2.0)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_wage_rate(p_schedule, p_trade, p_class_label, p_base_wage,
       p_fringe_per_hour, p_burden_percent, p_fringe_is_taxable, p_classification,
       p_overtime_multiplier, p_doubletime_multiplier); $$;

create or replace function public.set_wage_rate(
  p_rate uuid, p_base_wage numeric default null, p_fringe_per_hour numeric default null,
  p_burden_percent numeric default null, p_fringe_is_taxable boolean default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_wage_rate(p_rate, p_base_wage, p_fringe_per_hour, p_burden_percent,
       p_fringe_is_taxable); $$;

create or replace function public.set_apprentice_step(
  p_rate uuid, p_journeyman uuid, p_percent numeric)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_apprentice_step(p_rate, p_journeyman, p_percent); $$;

create or replace function public.schedule_wage_increase(
  p_schedule uuid, p_effective_date date, p_wage_increase numeric default 0,
  p_fringe_increase numeric default 0, p_wage_percent numeric default 0,
  p_name text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.schedule_wage_increase(p_schedule, p_effective_date, p_wage_increase,
       p_fringe_increase, p_wage_percent, p_name); $$;

create or replace function public.set_estimate_wage_schedule(
  p_version uuid, p_schedule uuid default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_estimate_wage_schedule(p_version, p_schedule); $$;

create or replace function public.resolve_labor_rate(p_crew_member uuid, p_version uuid)
returns uuid language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.resolve_labor_rate(p_crew_member, p_version); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_wage_schedule(uuid, text, text, date, text, text, text, text, text, text, text, text, text, text)',
    'public.approve_wage_schedule(uuid)',
    'public.add_wage_rate(uuid, text, text, numeric, numeric, numeric, boolean, text, numeric, numeric)',
    'public.set_wage_rate(uuid, numeric, numeric, numeric, boolean)',
    'public.set_apprentice_step(uuid, uuid, numeric)',
    'public.schedule_wage_increase(uuid, date, numeric, numeric, numeric, text)',
    'public.set_estimate_wage_schedule(uuid, uuid)',
    'public.resolve_labor_rate(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();

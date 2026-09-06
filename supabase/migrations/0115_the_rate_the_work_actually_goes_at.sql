-- =============================================================================
-- 0115 — The rate the work actually goes at
--
-- A production rate is the number that turns a quantity into hours, and hours
-- into everything else: crew cost, machine cost, fuel, duration, the schedule.
-- The library ships 2,124 of them. An estimator could not see which one a line
-- was using, could not choose a different one, and could not say "that is not
-- what my crew does" — the rate was picked once, silently, when the line was
-- created, and there was no way back to it.
--
-- Three doors, and the design point is that none of them is a hidden number.
--
--   * **Seeing it.** `app.production_rate_candidates()` is the ranking, in one
--     place. `add_estimate_line` picked a rate with an ordering written inline
--     in migration 0097; that ordering now lives here and 0097's function reads
--     it, so the screen that explains the choice and the code that makes it
--     cannot disagree about what "best" means.
--
--   * **Choosing another.** `app.set_line_production_rate` points a line at a
--     different rate from the library, refusing one measured in a unit the line
--     is not bid in — a rate of 240 LF/hr on a line measured in CY is a number
--     that will price, and price wrongly.
--
--   * **Overriding it.** `app.override_line_production` does *not* write a
--     private number onto the line. It files a company production rate with
--     `source_type = 'estimator_judgment'`, the reason the estimator gave, and
--     `approval_state = 'pending'`, then points the line at that. So an
--     override carries provenance, scores through the same confidence engine as
--     every other rate, and can be approved into the library if it turns out to
--     be right. A number typed into a hidden column would have done none of
--     that, and would have made the estimate's confidence a lie.
--
-- And `app.record_production_actual` is how a measured rate gets into a
-- company's library at all — the thing that makes the shipped benchmarks
-- replaceable rather than permanent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The half of the shipped library nobody could read
-- -----------------------------------------------------------------------------
--
-- Found while making the rate a line uses visible, and larger than that.
--
-- `services`, `assemblies` and `production_rates` are three-tier library tables
-- and use `app.apply_library_rls`, whose read policy admits a platform row —
-- the one with no company and no enterprise group. Their *child* tables were
-- given `app.apply_tenant_rls` instead, whose read policy is
-- `app.is_member(company_id)`. A platform row's `company_id` is null, and
-- `is_member(null)` is not true, so:
--
--     assembly_components   8,159 platform rows,  0 readable by any user
--     crew_members             29 platform rows,  0 readable
--     markup_components         9 platform rows,  0 readable
--     equipment_rates          17 platform rows,  0 readable
--
-- Proven by test before this was written. The consequences are not cosmetic. No
-- screen could show what a service is built from; the shipped crew presets
-- appeared to have nobody in them; the platform pricing profiles' markups were
-- invisible; and the seed equipment rates that RULE-003 sits at the bottom of
-- could not be read by the browser at all. Everything that worked, worked
-- because it went through a `security definer` function that bypassed the
-- policy — which is exactly why nothing noticed.
--
-- The fix is the read policy these should always have had. Writing stays
-- company-scoped: a tenant reads the platform's rows and writes none of them.
-- -----------------------------------------------------------------------------

/**
 * Row level security for a library table's children.
 *
 * The parent's three-tier read without the enterprise-group column the children
 * do not carry: a platform row is readable by everyone, a company's own by its
 * members, and nobody writes a platform row.
 */
create or replace function app.apply_library_child_rls(
  p_table text,
  p_write_permission text default 'libraries.write')
returns void
language plpgsql
as $$
declare
  v_read text := format('(%1$I.company_id is null or app.is_member(%1$I.company_id))', p_table);
  v_write text := format(
    '(company_id is not null and app.is_member(company_id) and app.has_permission(company_id, %L))',
    p_write_permission);
  v_write_using text := format(
    '(%1$I.company_id is not null and app.is_member(%1$I.company_id) and app.has_permission(%1$I.company_id, %2$L))',
    p_table, p_write_permission);
begin
  execute format('alter table %I enable row level security', p_table);
  execute format('alter table %I force row level security', p_table);

  execute format('drop policy if exists %I on %I', p_table || '_select', p_table);
  execute format('create policy %I on %I for select to authenticated using (%s)',
                 p_table || '_select', p_table, v_read);

  execute format('drop policy if exists %I on %I', p_table || '_insert', p_table);
  execute format('create policy %I on %I for insert to authenticated with check (%s)',
                 p_table || '_insert', p_table, v_write);

  execute format('drop policy if exists %I on %I', p_table || '_update', p_table);
  execute format('create policy %I on %I for update to authenticated using (%s) with check (%s)',
                 p_table || '_update', p_table, v_write_using, v_write);

  execute format('drop policy if exists %I on %I', p_table || '_delete', p_table);
  execute format('create policy %I on %I for delete to authenticated using (%s)',
                 p_table || '_delete', p_table, v_write_using);
end;
$$;

comment on function app.apply_library_child_rls(text, text) is
  'The three-tier read a library table''s children need: a platform row is readable by every tenant and writable by none. WORKFLOW guard.';

select app.apply_library_child_rls('assembly_components');
select app.apply_library_child_rls('crew_members');
select app.apply_library_child_rls('markup_components');
select app.apply_library_child_rls('equipment_rates');

/**
 * The production rates a line could use, best first.
 *
 * The ordering, stated once. A rate in the unit the line is bid in comes first,
 * because that is the one whose number means what the estimator thinks it
 * means. A company's own measured rate beats a shipped benchmark. Production
 * tasks beat setup and cleanup tasks. Confidence breaks what is left.
 *
 * `set-returning` rather than `limit 1` so the same query answers both
 * questions: which rate wins, and what else was available.
 */
create or replace function app.production_rate_candidates(
  p_service uuid,
  p_unit    app.unit_code,
  p_company uuid)
returns table (
  rate_id        uuid,
  task_id        uuid,
  task_name      text,
  rate_per_hour  numeric,
  rate_unit      app.unit_code,
  utilization_factor numeric,
  shift_hours    numeric,
  source_type    app.production_source,
  confidence_score numeric,
  sample_size    int,
  approval_state app.approval_state,
  is_own         boolean,
  unit_matches   boolean,
  rank           int)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select pr.id, t.id, t.name, pr.rate_per_hour, pr.rate_unit,
         pr.utilization_factor, pr.shift_hours, pr.source_type,
         pr.confidence_score, pr.sample_size, pr.approval_state,
         pr.company_id is not null,
         pr.rate_unit = p_unit,
         (row_number() over (
            order by (pr.rate_unit = p_unit) desc,
                     (pr.company_id is not null) desc,
                     (t.category = 'Production') desc,
                     pr.confidence_score desc nulls last,
                     ac.sort_order))::int
  from services s
  join assembly_components ac on ac.assembly_id = s.default_assembly_id
                             and ac.component_kind = 'task'
  join production_rates pr on pr.task_id = ac.task_id and pr.status = 'active'
  join tasks t on t.id = ac.task_id
  where s.id = p_service
    and (pr.company_id = p_company or pr.company_id is null)
    and pr.superseded_by_id is null;
$$;

comment on function app.production_rate_candidates(uuid, app.unit_code, uuid) is
  'The production rates a service''s assembly offers, ranked. ENGINE support: one ordering, read by the line that picks a rate and by the screen that explains the choice.';

/**
 * Add a line from the library.
 *
 * Unchanged from migration 0097 except in one respect: the rate ordering it
 * used to carry inline now comes from `app.production_rate_candidates`, so the
 * choice this makes and the choice a screen explains are the same choice.
 */
create or replace function app.add_estimate_line(
  p_version uuid,
  p_service uuid default null,
  p_description text default null,
  p_quantity numeric default 0,
  p_unit app.unit_code default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_service services%rowtype;
  v_unit    app.unit_code;
  v_desc    text;
  v_rate    uuid;
  v_sort    int;
  v_id      uuid;
begin
  select v.company_id, v.status into v_company, v_status
  from estimate_versions v where v.id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  if p_service is not null then
    select * into v_service from services s
    where s.id = p_service
      and (s.company_id = v_company or s.company_id is null)
      and s.status = 'active';
    if not found then
      raise exception 'That service is not in your library' using errcode = 'no_data_found';
    end if;
  end if;

  v_unit := coalesce(p_unit, v_service.default_unit, 'LS');
  v_desc := coalesce(nullif(trim(coalesce(p_description, '')), ''), v_service.name);
  if v_desc is null then
    raise exception 'A line needs a description, or a service to take one from'
      using errcode = 'check_violation';
  end if;
  if v_service.id is not null and not (v_unit = any (v_service.supported_units)) then
    raise exception '% is not measured in %', v_service.name, v_unit
      using errcode = 'check_violation',
            hint = 'The units it supports are on the service in the library.';
  end if;

  if v_service.id is not null then
    select c.rate_id into v_rate
    from app.production_rate_candidates(v_service.id, v_unit, v_company) c
    where c.rank = 1;
  end if;

  select coalesce(max(sort_order), 0) + 10 into v_sort
  from estimate_line_items where estimate_version_id = p_version;

  insert into estimate_line_items (
    company_id, estimate_version_id, sort_order, description, service_id,
    cost_code_id, measured_quantity, unit, production_rate_id, created_by)
  values (
    v_company, p_version, v_sort, v_desc, v_service.id,
    v_service.cost_code_id, greatest(coalesce(p_quantity, 0), 0), v_unit, v_rate,
    auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Choosing a different one
-- -----------------------------------------------------------------------------

/**
 * Point a line at a different production rate.
 *
 * A rate measured in a unit the line is not bid in is refused rather than
 * warned about: 240 LF/hr on a line measured in cubic yards is a number that
 * will price, and price wrongly, and nothing downstream would notice.
 */
create or replace function app.set_line_production_rate(p_line uuid, p_rate uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_unit    app.unit_code;
  v_desc    text;
  v_rate    production_rates%rowtype;
begin
  select l.company_id, v.status, l.unit, l.description
    into v_company, v_status, v_unit, v_desc
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;
  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  if p_rate is null then
    update estimate_line_items set production_rate_id = null where id = p_line;
    return;
  end if;

  select * into v_rate from production_rates
  where id = p_rate and status = 'active'
    and (company_id = v_company or company_id is null);
  if not found then
    raise exception 'That production rate is not in your library'
      using errcode = 'no_data_found';
  end if;
  if v_rate.rate_unit <> v_unit then
    raise exception 'That rate is measured in % and "%" is bid in %',
      v_rate.rate_unit, v_desc, v_unit
      using errcode = 'check_violation',
            hint = 'Change the line''s unit, or pick a rate measured the same way.';
  end if;

  update estimate_line_items set production_rate_id = p_rate where id = p_line;
end;
$$;

-- -----------------------------------------------------------------------------
-- Saying what your crew actually does
-- -----------------------------------------------------------------------------

/**
 * Record a production rate the estimator is asserting for this line.
 *
 * This files a rate rather than writing a private number. `estimator_judgment`
 * is one of the six source types the confidence engine already knows, and it
 * scores below a measured company actual and above nothing — which is the
 * truth about a number somebody is confident in but has not measured.
 *
 * The reason is required and long enough to be a reason. `approval_state` is
 * `pending`, so the estimating engine says out loud that the rate under this
 * line has not been approved, exactly as it does for the shipped benchmarks.
 */
create or replace function app.override_line_production(
  p_line uuid,
  p_per_hour numeric,
  p_reason text,
  p_utilization numeric default null,
  p_shift_hours numeric default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_unit    app.unit_code;
  v_task    uuid;
  v_service uuid;
  v_current production_rates%rowtype;
  v_id      uuid;
  v_code    text;
begin
  select l.company_id, v.status, l.unit, l.service_id
    into v_company, v_status, v_unit, v_service
  from estimate_line_items l
  join estimate_versions v on v.id = l.estimate_version_id
  where l.id = p_line;
  if v_company is null then
    raise exception 'No such estimate line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;
  if p_per_hour is null or p_per_hour <= 0 then
    raise exception 'A production rate is a quantity per hour, above zero'
      using errcode = 'check_violation';
  end if;
  if p_reason is null or length(trim(p_reason)) < 12 then
    raise exception 'Say why this rate is right for this work, in a sentence'
      using errcode = 'check_violation',
            hint = 'The rate under a line is the number that decides its hours; a bare figure cannot be reviewed.';
  end if;

  -- Keep it attached to the same task, so it sits with its peers in the library.
  select production_rate_id into v_id from estimate_line_items where id = p_line;
  if v_id is not null then
    select * into v_current from production_rates where id = v_id;
    v_task := v_current.task_id;
  end if;

  v_code := 'PR-OWN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into production_rates (
    company_id, code, task_id, service_id, rate_per_hour, rate_unit,
    utilization_factor, shift_hours, source_type, confidence_score, sample_size,
    approval_state, status, effective_date, controlling_resource)
  values (
    v_company, v_code, v_task, v_service, p_per_hour, v_unit,
    coalesce(p_utilization, v_current.utilization_factor, 0.83),
    coalesce(p_shift_hours, v_current.shift_hours, 8),
    'estimator_judgment', 0.55, 0,
    /*
     * Draft, not active. A company row that is live has to name who approved
     * it (migration 0028), and an estimator's judgment has not been approved by
     * anyone — saying otherwise to satisfy a constraint would be the lie the
     * constraint exists to prevent. Draft also keeps it out of
     * `production_rate_candidates`, so one line's judgment is not quietly
     * offered to every other line in the company.
     */
    'pending', 'draft', current_date, trim(p_reason))
  returning id into v_id;

  update estimate_line_items set production_rate_id = v_id where id = p_line;
  return v_id;
end;
$$;

comment on function app.override_line_production(uuid, numeric, text, numeric, numeric) is
  'Files the estimator''s own production rate for a line as a company rate carrying its reason, then points the line at it. LIBRARY + WORKFLOW: an override that is a record rather than a hidden number is one the confidence engine can score and a reviewer can approve.';

/**
 * Record a production rate this company has measured.
 *
 * The thing that makes a shipped benchmark replaceable rather than permanent.
 * `company_actual` is the highest reliability the confidence engine knows, so
 * it is gated on a sample size: a rate measured once is a story, and the
 * platform should not treat it as the company's standard.
 */
create or replace function app.record_production_actual(
  p_task uuid,
  p_per_hour numeric,
  p_unit app.unit_code,
  p_sample_size int,
  p_note text default null,
  p_utilization numeric default null,
  p_company uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_id      uuid;
  v_code    text;
begin
  if p_company is not null then
    v_company := p_company;
  else
    select company_id into v_company from company_memberships
     where user_id = auth.uid() and status = 'active' limit 2;
    if (select count(*) from company_memberships
         where user_id = auth.uid() and status = 'active') > 1 then
      raise exception 'You belong to more than one company; say which this rate is for'
        using errcode = 'check_violation';
    end if;
  end if;
  if v_company is null then
    raise exception 'Open a company before recording a rate'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'libraries.write') then
    raise exception 'You do not have permission to change the libraries'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from tasks t
                  where t.id = p_task and (t.company_id = v_company or t.company_id is null)) then
    raise exception 'That task is not in your library' using errcode = 'no_data_found';
  end if;
  if p_per_hour is null or p_per_hour <= 0 then
    raise exception 'A production rate is a quantity per hour, above zero'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_sample_size, 0) < 1 then
    raise exception 'Say how many times this was measured'
      using errcode = 'check_violation',
            hint = 'A rate measured no times is estimator judgment, which app.override_line_production files instead.';
  end if;

  v_code := 'PR-ACT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into production_rates (
    company_id, code, task_id, rate_per_hour, rate_unit, utilization_factor,
    source_type, confidence_score, sample_size, approval_state, status,
    effective_date, controlling_resource, approved_by, approved_at)
  values (
    v_company, v_code, p_task, p_per_hour, p_unit,
    coalesce(p_utilization, 0.83),
    'company_actual',
    /*
     * Confidence grows with the sample and stops at 0.95. A single measurement
     * is not a standard, and nothing in this platform is ever certain.
     */
    least(0.95, 0.60 + 0.05 * least(coalesce(p_sample_size, 0), 7)),
    p_sample_size, 'approved', 'active', current_date, nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(), now())
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

/**
 * The rate under each line, with where it came from.
 *
 * `security_invoker`, so row level security decides which lines a person sees.
 * The `hours_at_this_rate` column is derived here rather than stored: it is the
 * quantity divided by the rate, which is the sentence an estimator is actually
 * reading when they look at a production rate at all.
 */
create or replace view estimate_line_production
with (security_invoker = true) as
select l.id                     as line_item_id,
       l.estimate_version_id,
       l.company_id,
       l.description,
       l.unit,
       l.measured_quantity,
       pr.id                    as production_rate_id,
       pr.code                  as rate_code,
       pr.rate_per_hour,
       pr.rate_unit,
       pr.utilization_factor,
       pr.shift_hours,
       pr.source_type,
       pr.confidence_score,
       pr.sample_size,
       pr.approval_state,
       pr.controlling_resource,
       pr.company_id is not null as is_own_rate,
       t.name                    as task_name,
       case
         when pr.id is null or pr.rate_per_hour is null or pr.rate_per_hour = 0 then null
         when pr.rate_unit <> l.unit then null
         else round(l.measured_quantity
                    / (pr.rate_per_hour * pr.utilization_factor), 2)
       end as hours_at_this_rate
from estimate_line_items l
left join production_rates pr on pr.id = l.production_rate_id
left join tasks t on t.id = pr.task_id;

revoke all on estimate_line_production from public, anon;
grant select on estimate_line_production to authenticated;

comment on view estimate_line_production is
  'The production rate under each estimate line, with its provenance and the hours it implies. The hours are derived from the quantity and the rate, never stored, so they cannot disagree with either.';

/**
 * This company's production rates and the platform's, together.
 *
 * The Master Libraries screen rendered a fixture of eight rates while the
 * database held 2,124. This is what it should have been reading.
 */
create or replace view my_production_rates
with (security_invoker = true) as
select pr.id,
       pr.company_id,
       pr.code,
       pr.rate_per_hour,
       pr.rate_unit,
       pr.utilization_factor,
       pr.shift_hours,
       pr.source_type,
       pr.confidence_score,
       pr.sample_size,
       pr.approval_state,
       pr.region,
       pr.effective_date,
       pr.controlling_resource,
       pr.equipment_spread,
       pr.company_id is not null as is_own,
       t.id   as task_id,
       t.code as task_code,
       t.name as task_name,
       t.category as task_category
from production_rates pr
left join tasks t on t.id = pr.task_id
where pr.status in ('active', 'draft') and pr.superseded_by_id is null;

revoke all on my_production_rates from public, anon;
grant select on my_production_rates to authenticated;

/** The rates a line could use, for the picker that changes one. */
create or replace function app.line_production_options(p_line uuid)
returns table (
  rate_id uuid, task_name text, rate_per_hour numeric, rate_unit app.unit_code,
  utilization_factor numeric, shift_hours numeric, source_type app.production_source,
  confidence_score numeric, sample_size int, approval_state app.approval_state,
  is_own boolean, unit_matches boolean, rank int, is_current boolean)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select c.rate_id, c.task_name, c.rate_per_hour, c.rate_unit,
         c.utilization_factor, c.shift_hours, c.source_type, c.confidence_score,
         c.sample_size, c.approval_state, c.is_own, c.unit_matches, c.rank,
         c.rate_id = l.production_rate_id
  from estimate_line_items l
  cross join lateral app.production_rate_candidates(l.service_id, l.unit, l.company_id) c
  where l.id = p_line
  order by c.rank;
$$;

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.set_line_production_rate(p_line uuid, p_rate uuid)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_line_production_rate(p_line, p_rate); end; $$;

create or replace function public.override_line_production(
  p_line uuid, p_per_hour numeric, p_reason text,
  p_utilization numeric default null, p_shift_hours numeric default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.override_line_production(p_line, p_per_hour, p_reason, p_utilization, p_shift_hours);
end; $$;

create or replace function public.record_production_actual(
  p_task uuid, p_per_hour numeric, p_unit app.unit_code, p_sample_size int,
  p_note text default null, p_utilization numeric default null, p_company uuid default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.record_production_actual(
    p_task, p_per_hour, p_unit, p_sample_size, p_note, p_utilization, p_company);
end; $$;

create or replace function public.line_production_options(p_line uuid)
returns table (
  rate_id uuid, task_name text, rate_per_hour numeric, rate_unit app.unit_code,
  utilization_factor numeric, shift_hours numeric, source_type app.production_source,
  confidence_score numeric, sample_size int, approval_state app.approval_state,
  is_own boolean, unit_matches boolean, rank int, is_current boolean)
language sql stable security invoker set search_path = public, pg_catalog
as $$ select * from app.line_production_options(p_line); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.set_line_production_rate(uuid, uuid)',
    'public.override_line_production(uuid, numeric, text, numeric, numeric)',
    'public.record_production_actual(uuid, numeric, app.unit_code, int, text, numeric, uuid)',
    'public.line_production_options(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();

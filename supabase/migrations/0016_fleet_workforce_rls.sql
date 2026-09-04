-- =============================================================================
-- GrounUp Enterprise — 0016 Policies for the fleet, workforce and schedule
--
-- Also promotes the two safety gates into a reusable function. Every future
-- migration that adds a table ends with `select app.assert_security_gates()`,
-- so the check is one line rather than forty duplicated ones — and forgetting
-- it is a review-visible omission rather than a silent hole.
-- =============================================================================

/**
 * Fails if any table in `public` lacks row level security, or if the anonymous
 * role can read anything beyond the public plan catalog.
 */
create or replace function app.assert_security_gates()
returns void
language plpgsql
as $$
declare
  v_missing text[];
  v_leaks   text[];
begin
  select array_agg(c.relname order by c.relname) into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'RLS coverage gate failed. Tables without row level security: %',
      array_to_string(v_missing, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  select array_agg(c.relname order by c.relname) into v_leaks
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v')
    and c.relname not in ('plans', 'plan_prices')
    and has_table_privilege('anon', c.oid, 'SELECT');
  if v_leaks is not null then
    raise exception 'Privilege gate failed. The anon role can read: %', array_to_string(v_leaks, ', ')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function app.assert_security_gates is
  'Run at the end of every migration that adds a table. Both gates fail the deployment rather than shipping an unprotected table.';

-- -----------------------------------------------------------------------------
-- Workforce
--
-- Employee records carry compensation, so reading them needs the HR permission
-- rather than bare membership — a foreman should not see everyone''s wage.
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('employees', 'hr.read', 'hr.write');
select app.apply_tenant_rls('credentials', 'hr.read', 'hr.write');

-- Time entries are read by the crew's supervisor and by payroll; writing one is
-- a field action, approving it is not.
select app.apply_tenant_rls('time_entries', null, 'projects.write');

-- -----------------------------------------------------------------------------
-- Fleet
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('assets', null, 'fleet.write');
select app.apply_tenant_rls('meter_readings', null, 'fleet.write');
select app.apply_tenant_rls('maintenance_schedules', null, 'fleet.write');
select app.apply_tenant_rls('work_orders', null, 'fleet.write');
select app.apply_tenant_rls('fuel_transactions', null, 'fleet.write');

-- -----------------------------------------------------------------------------
-- Scheduling and resource planning
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('schedule_activities', null, 'projects.write');
select app.apply_tenant_rls('schedule_dependencies', null, 'projects.write');
select app.apply_tenant_rls('resource_assignments', null, 'projects.write');

-- -----------------------------------------------------------------------------
-- New permissions used above, granted to the roles that should hold them
-- -----------------------------------------------------------------------------
update roles set permissions = array(
  select distinct unnest(permissions || array['hr.read', 'hr.write', 'fleet.read', 'fleet.write'])
) where company_id is null and key in ('admin', 'owner');

update roles set permissions = array(
  select distinct unnest(permissions || array['fleet.read', 'fleet.write', 'hr.read'])
) where company_id is null and key = 'project_manager';

update roles set permissions = array(
  select distinct unnest(permissions || array['fleet.read'])
) where company_id is null and key in ('superintendent', 'estimator', 'senior_estimator', 'chief_estimator');

update roles set permissions = array(
  select distinct unnest(permissions || array['hr.read', 'fleet.read'])
) where company_id is null and key = 'accountant';

-- -----------------------------------------------------------------------------
-- Triggers and grants
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  v_new constant text[] := array[
    'employees', 'credentials', 'time_entries', 'assets', 'meter_readings',
    'maintenance_schedules', 'work_orders', 'fuel_transactions',
    'schedule_activities', 'schedule_dependencies', 'resource_assignments'
  ];
begin
  foreach t in array v_new loop
    perform app.attach_standard_triggers(format('public.%I', t)::regclass);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select on plans to anon;
grant select on plan_prices to anon;

select app.assert_security_gates();

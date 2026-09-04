-- =============================================================================
-- GrounUp Enterprise — 0022 Policies for safety, quality and connectors
-- =============================================================================

-- Safety records are read broadly on purpose: a crew that cannot see the
-- incidents and observations on its own job cannot learn from them.
select app.apply_tenant_rls('safety_incidents', null, 'safety.write');
select app.apply_tenant_rls('toolbox_talks', null, 'safety.write');
select app.apply_tenant_rls('safety_observations', null, 'safety.write');

select app.apply_tenant_rls('inspections', null, 'quality.write');
select app.apply_tenant_rls('deficiencies', null, 'quality.write');

-- Connector configuration is administrative; its runs are readable by anyone
-- who needs to know whether last night's sync worked.
select app.apply_tenant_rls('connectors', 'company.manage', 'company.manage');
select app.apply_tenant_rls('connector_runs', null, 'company.manage');

update roles set permissions = array(
  select distinct unnest(permissions || array['safety.read', 'safety.write', 'quality.read', 'quality.write'])
) where company_id is null and key in ('owner', 'admin', 'project_manager', 'superintendent');

update roles set permissions = array(
  select distinct unnest(permissions || array['safety.read', 'safety.write', 'quality.read'])
) where company_id is null and key = 'foreman';

update roles set permissions = array(
  select distinct unnest(permissions || array['safety.read', 'quality.read'])
) where company_id is null and key in ('estimator', 'senior_estimator', 'chief_estimator', 'viewer');

do $$
declare
  t text;
  v_new constant text[] := array[
    'safety_incidents', 'toolbox_talks', 'safety_observations',
    'inspections', 'deficiencies', 'connectors', 'connector_runs'
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

-- =============================================================================
-- GrounUp Enterprise — 0018 Policies for finance and procurement
--
-- Financial records are the most sensitive tenant data after payroll, so these
-- tables gate reads on an explicit permission rather than bare membership.
-- =============================================================================

select app.apply_tenant_rls('schedule_of_values', 'finance.read', 'finance.write');
select app.apply_tenant_rls('pay_applications', 'finance.read', 'finance.write');
select app.apply_tenant_rls('pay_application_lines', 'finance.read', 'finance.write');
select app.apply_tenant_rls('ap_invoices', 'finance.read', 'finance.write');

select app.apply_tenant_rls('rfqs', null, 'procurement.write');
select app.apply_tenant_rls('rfq_responses', null, 'procurement.write');
select app.apply_tenant_rls('purchase_orders', null, 'procurement.write');
select app.apply_tenant_rls('purchase_order_items', null, 'procurement.write');
select app.apply_tenant_rls('deliveries', null, 'projects.write');
select app.apply_tenant_rls('inventory_items', null, 'procurement.write');
select app.apply_tenant_rls('inventory_transactions', null, 'procurement.write');

-- -----------------------------------------------------------------------------
-- Permissions for the roles that should hold them
-- -----------------------------------------------------------------------------
update roles set permissions = array(
  select distinct unnest(permissions || array[
    'finance.read', 'finance.write', 'procurement.read', 'procurement.write'
  ])
) where company_id is null and key in ('owner', 'admin');

-- Accountants own the money; they do not buy.
update roles set permissions = array(
  select distinct unnest(permissions || array['finance.read', 'finance.write', 'procurement.read'])
) where company_id is null and key = 'accountant';

-- Project managers buy for their jobs and need to see the billing position.
update roles set permissions = array(
  select distinct unnest(permissions || array['finance.read', 'procurement.read', 'procurement.write'])
) where company_id is null and key = 'project_manager';

-- Estimators price subcontract scope, so they read quotes but do not commit.
update roles set permissions = array(
  select distinct unnest(permissions || array['procurement.read'])
) where company_id is null and key in ('estimator', 'senior_estimator', 'chief_estimator');

update roles set permissions = array(
  select distinct unnest(permissions || array['procurement.read'])
) where company_id is null and key = 'superintendent';

-- -----------------------------------------------------------------------------
-- Triggers and grants
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  v_new constant text[] := array[
    'schedule_of_values', 'pay_applications', 'pay_application_lines', 'ap_invoices',
    'rfqs', 'rfq_responses', 'purchase_orders', 'purchase_order_items',
    'deliveries', 'inventory_items', 'inventory_transactions'
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

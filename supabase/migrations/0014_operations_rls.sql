-- =============================================================================
-- GrounUp Enterprise — 0014 Policies, triggers and grants for the 0013 tables
--
-- The gates in 0011 and 0012 run before this file, so they cannot catch a table
-- added in 0013. Both gates are therefore re-run at the end of this migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Standard tenant policies
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('submittals', null, 'projects.write');
select app.apply_tenant_rls('proposal_line_items', null, 'estimates.write');
select app.apply_tenant_rls('daily_report_labor', null, 'projects.write');
select app.apply_tenant_rls('daily_report_equipment', null, 'projects.write');
select app.apply_tenant_rls('change_order_items', null, 'projects.write');

-- -----------------------------------------------------------------------------
-- Notifications: a member sees company-wide notices and their own
-- -----------------------------------------------------------------------------
alter table notifications enable row level security;
alter table notifications force row level security;

create policy notifications_select on notifications for select to authenticated
  using (app.is_member(company_id) and (user_id is null or user_id = auth.uid()));

-- Any member may raise a notification for their company (the app does this on
-- approval, RFI and finding events); a targeted one may only be addressed to a
-- member of that same company.
create policy notifications_insert on notifications for insert to authenticated
  with check (
    app.is_member(company_id)
    and (user_id is null or exists (
      select 1 from company_memberships m
      where m.user_id = notifications.user_id and m.company_id = notifications.company_id
        and m.status = 'active'
    ))
  );

-- A user may only mark their own notifications read or dismissed.
create policy notifications_update on notifications for update to authenticated
  using (app.is_member(company_id) and (user_id = auth.uid() or user_id is null))
  with check (app.is_member(company_id) and (user_id = auth.uid() or user_id is null));

alter table notification_preferences enable row level security;
alter table notification_preferences force row level security;
create policy notification_preferences_all on notification_preferences for all to authenticated
  using (user_id = auth.uid() and app.is_member(company_id))
  with check (user_id = auth.uid() and app.is_member(company_id));

-- -----------------------------------------------------------------------------
-- Model and prompt registry
-- -----------------------------------------------------------------------------

-- The model catalog is global and read-only to tenants; pricing and
-- availability are a platform decision, not a tenant setting.
alter table ai_models enable row level security;
alter table ai_models force row level security;
create policy ai_models_select on ai_models for select to authenticated
  using (is_enabled);

alter table ai_prompts enable row level security;
alter table ai_prompts force row level security;

-- A tenant reads the shipped governed prompts plus any of its own.
create policy ai_prompts_select on ai_prompts for select to authenticated
  using (company_id is null or app.is_member(company_id));

-- A tenant may author its own prompt variants, never edit the shipped ones.
create policy ai_prompts_insert on ai_prompts for insert to authenticated
  with check (company_id is not null and app.has_permission(company_id, 'company.manage'));
create policy ai_prompts_update on ai_prompts for update to authenticated
  using (company_id is not null and app.has_permission(company_id, 'company.manage'))
  with check (company_id is not null and app.has_permission(company_id, 'company.manage'));
create policy ai_prompts_delete on ai_prompts for delete to authenticated
  using (company_id is not null and app.has_permission(company_id, 'company.manage'));

-- -----------------------------------------------------------------------------
-- Standard triggers on the new tables
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  v_new constant text[] := array[
    'submittals', 'proposal_line_items', 'notification_preferences',
    'ai_models', 'ai_prompts', 'daily_report_labor', 'daily_report_equipment',
    'change_order_items'
  ];
begin
  foreach t in array v_new loop
    perform app.attach_standard_triggers(format('public.%I', t)::regclass);
  end loop;
end $$;

-- `notifications` is high-volume and append-mostly: auditing every read receipt
-- would swamp the ledger without telling anyone anything. It keeps RLS but not
-- the row audit trigger.

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select on plans to anon;
grant select on plan_prices to anon;

-- -----------------------------------------------------------------------------
-- Re-run both safety gates now that 0013 has added tables
-- -----------------------------------------------------------------------------
do $$
declare v_missing text[];
begin
  select array_agg(c.relname order by c.relname) into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'RLS coverage gate failed. Tables without row level security: %',
      array_to_string(v_missing, ', ');
  end if;
end $$;

do $$
declare v_leaks text[];
begin
  select array_agg(c.relname order by c.relname) into v_leaks
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v')
    and c.relname not in ('plans', 'plan_prices')
    and has_table_privilege('anon', c.oid, 'SELECT');
  if v_leaks is not null then
    raise exception 'Privilege gate failed. The anon role can read: %', array_to_string(v_leaks, ', ');
  end if;
end $$;

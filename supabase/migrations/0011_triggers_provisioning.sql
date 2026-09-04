-- =============================================================================
-- GrounUp Enterprise — 0011 Triggers, provisioning and the RLS coverage gate
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Attach updated_at + audit triggers to every governed table
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  -- Excluded because they are append-only ledgers that audit themselves, or
  -- because auditing them would recurse.
  v_skip constant text[] := array['audit_events', 'usage_events', 'stripe_events', 'ai_messages'];
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name <> all (v_skip)
    order by table_name
  loop
    perform app.attach_standard_triggers(format('public.%I', t)::regclass);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- New auth user -> application profile
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into user_profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function app.handle_new_user is
  'Creates the application profile when Supabase Auth creates a user. Attach with: create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();';

-- -----------------------------------------------------------------------------
-- System roles
-- -----------------------------------------------------------------------------
insert into roles (company_id, key, name, description, permissions, approval_tier, is_system) values
  (null, 'owner', 'Owner',
   'Full control of the company including billing, users and all governed data.',
   array['*'], 4, true),

  (null, 'admin', 'Administrator',
   'Company administration, users, libraries and configuration. No billing changes.',
   array['company.manage','users.manage','libraries.read','libraries.write','libraries.approve',
         'estimates.read','estimates.write','estimates.approve','estimates.issue',
         'crm.read','crm.write','projects.read','projects.write','documents.read','documents.write',
         'reports.read','audit.read','ai.accept_findings','billing.read'], 3, true),

  (null, 'chief_estimator', 'Chief Estimator',
   'Approves and issues estimates, approves library changes, resolves RFIs.',
   array['libraries.read','libraries.write','libraries.approve',
         'estimates.read','estimates.write','estimates.approve','estimates.issue',
         'crm.read','crm.write','projects.read','documents.read','documents.write',
         'reports.read','audit.read','ai.accept_findings'], 3, true),

  (null, 'senior_estimator', 'Senior Estimator',
   'Full estimating authority including senior review sign-off.',
   array['libraries.read','libraries.write','estimates.read','estimates.write','estimates.approve',
         'crm.read','crm.write','projects.read','documents.read','documents.write',
         'reports.read','ai.accept_findings'], 2, true),

  (null, 'estimator', 'Estimator',
   'Builds estimates and accepts AI findings at the estimator-review tier.',
   array['libraries.read','estimates.read','estimates.write',
         'crm.read','crm.write','projects.read','documents.read','documents.write',
         'reports.read','ai.accept_findings'], 1, true),

  (null, 'project_manager', 'Project Manager',
   'Runs awarded work: schedule, cost, change orders and field production.',
   array['libraries.read','estimates.read','projects.read','projects.write',
         'crm.read','documents.read','documents.write','reports.read','ai.accept_findings'], 2, true),

  (null, 'superintendent', 'Superintendent',
   'Field execution: daily reports, installed quantities and production actuals.',
   array['libraries.read','projects.read','projects.write','documents.read','reports.read'], 1, true),

  (null, 'foreman', 'Foreman',
   'Records field production and daily reports for assigned work.',
   array['projects.read','projects.write','documents.read'], 0, true),

  (null, 'accountant', 'Accountant',
   'Job cost, billing and financial reporting. No estimating authority.',
   array['projects.read','estimates.read','reports.read','billing.read','billing.manage','audit.read'], 1, true),

  (null, 'sales', 'Sales',
   'CRM pipeline and proposals. Reads estimates but cannot change pricing.',
   array['crm.read','crm.write','estimates.read','documents.read','reports.read'], 0, true),

  (null, 'viewer', 'Viewer',
   'Read-only access to estimates, projects, documents and reports.',
   array['libraries.read','estimates.read','crm.read','projects.read','documents.read','reports.read'], 0, true);

-- -----------------------------------------------------------------------------
-- Company provisioning
-- -----------------------------------------------------------------------------

/**
 * Creates a company, makes the caller its owner, and seeds the configuration a
 * new tenant needs to build its first estimate.
 *
 * SECURITY DEFINER because the caller has no membership yet and therefore
 * cannot satisfy any tenant policy — this function is the bootstrap that
 * creates the membership those policies read.
 */
create or replace function app.provision_company(
  p_name text,
  p_slug text,
  p_plan_id text default 'starter'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_user    uuid := auth.uid();
  v_owner_role uuid;
  v_profile uuid;
  v_trial_days int;
begin
  if v_user is null then
    raise exception 'provision_company requires an authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_owner_role from roles where company_id is null and key = 'owner';
  if v_owner_role is null then
    raise exception 'System role "owner" is missing; migrations are incomplete';
  end if;

  insert into companies (name, slug, created_by) values (p_name, p_slug, v_user)
  returning id into v_company;

  insert into company_memberships (company_id, user_id, role_id, status, is_owner, joined_at)
  values (v_company, v_user, v_owner_role, 'active', true, now());

  -- Default pricing profile, so the first estimate can be priced immediately.
  insert into pricing_profiles (company_id, code, name, method, is_default, region)
  values (v_company, 'PP-DEFAULT', 'Company Default', 'parallel', true, null);

  insert into markup_components (company_id, pricing_profile_id, code, label, percent, basis, sequence)
  select v_company, p.id, c.code, c.label, c.percent, 'profile_default', c.sequence
  from pricing_profiles p,
       (values ('OH', 'Overhead', 0.10, 10),
               ('PROFIT', 'Profit', 0.12, 20),
               ('CONT', 'Contingency', 0.03, 30)) as c(code, label, percent, sequence)
  where p.company_id = v_company and p.code = 'PP-DEFAULT';

  update companies
  set default_pricing_profile_id = (select id from pricing_profiles where company_id = v_company and code = 'PP-DEFAULT')
  where id = v_company;

  -- Start the plan's trial. Entitlement is provisional until Stripe confirms,
  -- and `valid_until` bounds it so an unpaid trial cannot run forever.
  select trial_days into v_trial_days from plans where id = p_plan_id;
  insert into entitlements (company_id, plan_id, is_active, features, max_seats,
                            max_active_estimates, max_active_projects, storage_gb,
                            ai_credits_per_month, valid_until, source)
  select v_company, pl.id, coalesce(v_trial_days, 0) > 0, pl.features, pl.max_seats,
         pl.max_active_estimates, pl.max_active_projects, pl.storage_gb,
         pl.ai_credits_per_month,
         case when coalesce(v_trial_days, 0) > 0 then now() + (v_trial_days || ' days')::interval end,
         'trial'
  from plans pl where pl.id = p_plan_id;

  select id into v_profile from user_profiles where id = v_user;
  if v_profile is not null then
    update user_profiles set default_company_id = v_company where id = v_user and default_company_id is null;
  end if;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id, new_state, reason)
  values (v_company, v_user, 'insert', 'public.companies', v_company::text,
          jsonb_build_object('name', p_name, 'slug', p_slug, 'plan', p_plan_id),
          'Company provisioned');

  return v_company;
end;
$$;

grant execute on function app.provision_company(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Estimate version revision (RULE-009)
-- -----------------------------------------------------------------------------

/**
 * Creates the next version of an estimate by copying the current one.
 *
 * This is the only sanctioned way to change an issued estimate: the priced
 * record a bid went out from is never edited, and the new version carries an
 * explicit revision reason so the history explains itself.
 */
create or replace function app.revise_estimate_version(
  p_version_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_src     estimate_versions%rowtype;
  v_new     uuid;
  v_next    int;
  v_line    record;
  v_map     jsonb := '{}'::jsonb;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'A revision must state why it exists' using errcode = 'check_violation';
  end if;

  select * into v_src from estimate_versions where id = p_version_id;
  if not found then
    raise exception 'Estimate version % not found or not visible', p_version_id using errcode = 'no_data_found';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from estimate_versions where estimate_id = v_src.estimate_id;

  insert into estimate_versions (
    company_id, estimate_id, version_number, status, pricing_profile_id,
    shift_hours, calendar_efficiency, fuel_price_per_gallon, def_price_per_gallon,
    swell_percent, shrink_percent, bid_rounding_increment, revision_reason, created_by
  )
  values (
    v_src.company_id, v_src.estimate_id, v_next, 'draft', v_src.pricing_profile_id,
    v_src.shift_hours, v_src.calendar_efficiency, v_src.fuel_price_per_gallon, v_src.def_price_per_gallon,
    v_src.swell_percent, v_src.shrink_percent, v_src.bid_rounding_increment, p_reason, auth.uid()
  )
  returning id into v_new;

  -- Copy lines, remembering old id -> new id so children can be re-parented.
  for v_line in
    select * from estimate_line_items where estimate_version_id = p_version_id order by sort_order
  loop
    declare v_new_line uuid;
    begin
      insert into estimate_line_items (
        company_id, estimate_version_id, sort_order, line_number, description,
        service_id, assembly_id, cost_code_id, discipline, bid_item_number,
        measured_quantity, unit, measurement_method, adjusted_quantity, gross_quantity,
        waste_percent, loss_percent, waste_basis, quantity_adjustments, volume_state,
        production_rate_id, crew_id, production_modifier,
        check_primary_source, check_cross_source, check_reconciliation,
        conflict_count, has_open_rfi, documents_cannot_resolve,
        material_geotech_assumption, major_earthwork_decision,
        origin, source_references, notes, created_by
      )
      values (
        v_line.company_id, v_new, v_line.sort_order, v_line.line_number, v_line.description,
        v_line.service_id, v_line.assembly_id, v_line.cost_code_id, v_line.discipline, v_line.bid_item_number,
        v_line.measured_quantity, v_line.unit, v_line.measurement_method, v_line.adjusted_quantity, v_line.gross_quantity,
        v_line.waste_percent, v_line.loss_percent, v_line.waste_basis, v_line.quantity_adjustments, v_line.volume_state,
        v_line.production_rate_id, v_line.crew_id, v_line.production_modifier,
        v_line.check_primary_source, v_line.check_cross_source, v_line.check_reconciliation,
        v_line.conflict_count, v_line.has_open_rfi, v_line.documents_cannot_resolve,
        v_line.material_geotech_assumption, v_line.major_earthwork_decision,
        'copied', v_line.source_references, v_line.notes, auth.uid()
      )
      returning id into v_new_line;
      v_map := v_map || jsonb_build_object(v_line.id::text, v_new_line);
    end;
  end loop;

  -- Re-point copied parent references at the copies, not the originals.
  update estimate_line_items c
  set parent_line_id = (v_map ->> o.parent_line_id::text)::uuid
  from estimate_line_items o
  where c.estimate_version_id = v_new
    and o.estimate_version_id = p_version_id
    and o.parent_line_id is not null
    and c.id = (v_map ->> o.id::text)::uuid;

  insert into estimate_indirects (company_id, estimate_version_id, code, label, amount,
                                  percent_of_direct, per_day, days, basis, sort_order)
  select company_id, v_new, code, label, amount, percent_of_direct, per_day, days, basis, sort_order
  from estimate_indirects where estimate_version_id = p_version_id;

  insert into estimate_exclusions (company_id, estimate_version_id, exclusion, category, reason, sort_order)
  select company_id, v_new, exclusion, category, reason, sort_order
  from estimate_exclusions where estimate_version_id = p_version_id;

  update estimates set current_version_id = v_new, updated_at = now() where id = v_src.estimate_id;

  return v_new;
end;
$$;

grant execute on function app.revise_estimate_version(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS coverage gate
-- -----------------------------------------------------------------------------

/**
 * Fails the migration if any table in `public` lacks row level security.
 *
 * This is the safety net for the whole isolation design: adding a table and
 * forgetting its policy breaks the build here rather than leaking data in
 * production.
 */
do $$
declare
  v_missing text[];
begin
  select array_agg(c.relname order by c.relname) into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'RLS coverage gate failed. Tables without row level security: %',
      array_to_string(v_missing, ', ');
  end if;
end $$;

/** Reports which public tables have RLS and how many policies each carries. */
create or replace view rls_coverage as
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

comment on view rls_coverage is
  'Operational check: every row must show rls_enabled and rls_forced. Tables with policy_count = 0 are service-role only by design.';

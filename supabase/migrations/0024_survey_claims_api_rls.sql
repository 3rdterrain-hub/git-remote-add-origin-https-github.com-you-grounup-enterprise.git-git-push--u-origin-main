-- =============================================================================
-- GrounUp Enterprise — 0024 Policies for survey, claims, network and the API
--
-- The network tables are the first in the platform that are *deliberately*
-- cross-tenant. Every other table is isolated; a published vendor listing is
-- readable by any authenticated member of any company, because a directory only
-- one company can see is not a directory. The boundary is drawn at consent and
-- at what the owning company chose to publish.
-- =============================================================================

select app.apply_tenant_rls('surveys', null, 'projects.write');
select app.apply_tenant_rls('surfaces', null, 'projects.write');
select app.apply_tenant_rls('surface_comparisons', null, 'projects.write');
select app.apply_tenant_rls('machine_control_files', null, 'projects.write');
select app.apply_tenant_rls('machine_assignments', null, 'projects.write');
select app.apply_tenant_rls('contracts', 'finance.read', 'estimates.approve');
select app.apply_tenant_rls('claims', null, 'estimates.approve');
select app.apply_tenant_rls('api_requests', null, 'company.manage');

-- -----------------------------------------------------------------------------
-- API keys — readable by administrators, never exposing a usable secret
-- -----------------------------------------------------------------------------
alter table api_keys enable row level security;
alter table api_keys force row level security;

create policy api_keys_select on api_keys for select to authenticated
  using (app.has_permission(company_id, 'company.manage'));
create policy api_keys_insert on api_keys for insert to authenticated
  with check (app.has_permission(company_id, 'company.manage'));
-- Revocation is an update; rotation means issuing a new key, not editing a hash.
create policy api_keys_update on api_keys for update to authenticated
  using (app.has_permission(company_id, 'company.manage'))
  with check (app.has_permission(company_id, 'company.manage'));

/** A key's hash and prefix are set once. Rotation issues a new key. */
create or replace function app.forbid_api_key_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.key_hash is distinct from old.key_hash or new.key_prefix is distinct from old.key_prefix then
    raise exception 'An API key cannot be rewritten in place. Revoke this key and issue a new one.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger forbid_api_key_rewrite
  before update on api_keys
  for each row execute function app.forbid_api_key_rewrite();

-- -----------------------------------------------------------------------------
-- The network — cross-tenant by design, bounded by consent
-- -----------------------------------------------------------------------------
alter table network_vendors enable row level security;
alter table network_vendors force row level security;

-- Any member of any company sees a published listing; only the owning company
-- sees its own unpublished drafts.
create policy network_vendors_select on network_vendors for select to authenticated
  using (
    is_published
    or app.is_member(owner_company_id)
  );

create policy network_vendors_insert on network_vendors for insert to authenticated
  with check (app.has_permission(owner_company_id, 'libraries.write'));
create policy network_vendors_update on network_vendors for update to authenticated
  using (app.has_permission(owner_company_id, 'libraries.write'))
  with check (app.has_permission(owner_company_id, 'libraries.write'));
create policy network_vendors_delete on network_vendors for delete to authenticated
  using (app.has_permission(owner_company_id, 'libraries.write'));

alter table network_ratings enable row level security;
alter table network_ratings force row level security;

-- A rating is visible wherever its listing is, because a directory of
-- subcontractors with hidden ratings is just a phone book.
create policy network_ratings_select on network_ratings for select to authenticated
  using (exists (
    select 1 from network_vendors nv
    where nv.id = network_ratings.network_vendor_id
      and (nv.is_published or app.is_member(nv.owner_company_id))
  ));

-- A company may only leave a rating as itself, and only on a published listing.
create policy network_ratings_insert on network_ratings for insert to authenticated
  with check (
    app.has_permission(rating_company_id, 'crm.write')
    and exists (select 1 from network_vendors nv where nv.id = network_vendor_id and nv.is_published)
  );

-- No update policy: `network_ratings_immutable` blocks it anyway, and the
-- absence of a policy makes the intent explicit rather than trigger-only.
create policy network_ratings_delete on network_ratings for delete to authenticated
  using (app.has_permission(rating_company_id, 'crm.write'));

-- -----------------------------------------------------------------------------
-- Metric definitions — global defaults readable by all, company overrides owned
-- -----------------------------------------------------------------------------
alter table metric_definitions enable row level security;
alter table metric_definitions force row level security;

create policy metric_definitions_select on metric_definitions for select to authenticated
  using (company_id is null or app.is_member(company_id));
create policy metric_definitions_insert on metric_definitions for insert to authenticated
  with check (company_id is not null and app.has_permission(company_id, 'reports.read'));
create policy metric_definitions_update on metric_definitions for update to authenticated
  using (company_id is not null and app.has_permission(company_id, 'reports.read'))
  with check (company_id is not null and app.has_permission(company_id, 'reports.read'));
create policy metric_definitions_delete on metric_definitions for delete to authenticated
  using (company_id is not null and app.has_permission(company_id, 'reports.read'));

-- -----------------------------------------------------------------------------
-- Triggers and grants
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  v_new constant text[] := array[
    'surveys', 'surfaces', 'surface_comparisons', 'machine_control_files',
    'machine_assignments', 'contracts', 'claims', 'network_vendors',
    'api_keys', 'metric_definitions'
  ];
begin
  foreach t in array v_new loop
    perform app.attach_standard_triggers(format('public.%I', t)::regclass);
  end loop;
end $$;

-- `network_ratings` and `api_requests` are append-only ledgers; auditing every
-- row would double their volume without answering a question anyone asks.

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select on plans to anon;
grant select on plan_prices to anon;

select app.assert_security_gates();

-- =============================================================================
-- 0109 — Markup on this bid
--
-- `markup_components` hangs off a pricing profile, which is right for a
-- company's standard: overhead, profit and contingency are the same on most
-- jobs and belong somewhere they are set once.
--
-- A bid is not most jobs. This one is bonded and the last one was not; this
-- owner is tax exempt; this negotiation ended in a discount. An estimator
-- making any of those adjustments today has two options, and both are wrong:
-- change the company profile and affect every other open estimate, or make a
-- new profile per bid and end up with forty of them.
--
-- So a version may carry its own components. When it carries any, they are the
-- markup for that bid; when it carries none, the profile's stand — which means
-- an estimate nobody has touched keeps behaving exactly as it does today.
--
-- `enabled` is the switch rather than deleting the row, because switching a
-- bond off and on again during a negotiation should not lose the rate somebody
-- looked up.
-- =============================================================================

create table estimate_version_markups (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions(id) on delete cascade,

  code                text not null check (code ~ '^[A-Z][A-Z0-9_]{0,20}$'),
  label               text not null check (length(trim(label)) between 1 and 80),
  percent             numeric(8,6) not null check (percent >= 0 and percent <= 5),
  /*
   * Which figure the percentage is taken of. The same list the profile uses,
   * and the distinction that matters: bond and tax are charged on the marked-up
   * total, so they are applied in a second pass rather than beside overhead and
   * profit. Getting that wrong is a few percent on every bonded bid.
   */
  basis               text not null default 'profile_default'
                        check (basis in ('profile_default', 'direct_cost', 'direct_plus_indirect',
                                         'running_total', 'marked_up_total')),
  sequence            int not null default 10,
  /** Whether the customer is told this component exists. */
  disclosed           boolean not null default false,
  /*
   * Off rather than deleted. Switching a bond off and on again during a
   * negotiation should not lose the rate somebody looked up.
   */
  enabled             boolean not null default true,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (estimate_version_id, code)
);

create index evm_version_idx on estimate_version_markups(estimate_version_id, sequence);
-- Every tenant key is indexed, so a policy filtering on it is a lookup rather
-- than a scan of somebody else's rows on the way to none of them.
create index evm_tenant_idx on estimate_version_markups(company_id);

comment on table estimate_version_markups is
  'This bid''s own overhead, profit, contingency, bond, tax or discount. ENTITY. A version carrying none uses its pricing profile, so an estimate nobody has adjusted behaves exactly as it did before. Held per version because the alternatives are editing the company profile — which moves every other open estimate — or making a profile per bid.';

select app.apply_tenant_rls('estimate_version_markups', null, 'estimates.write');
select app.attach_standard_triggers('public.estimate_version_markups'::regclass);
select app.guard_suspension('estimate_version_markups');

create trigger estimate_version_markups_tenant_parent
  before insert or update on estimate_version_markups
  for each row execute function app.enforce_tenant_parent(
    'estimate_versions', 'estimate_version_id', 'id');

/**
 * Set one adjustment on a bid.
 *
 * Upsert on the code, because an estimator turning tax from 7.3 to 6.5 is
 * changing the tax rather than adding a second one — and a second TAX row
 * would be applied twice, which is the kind of mistake that only shows up on
 * the invoice.
 */
create or replace function app.set_estimate_markup(
  p_version uuid,
  p_code text,
  p_fields jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  app.estimate_status;
  v_id      uuid;
begin
  select company_id, status into v_company, v_status
  from estimate_versions where id = p_version;

  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;

  insert into estimate_version_markups (
    company_id, estimate_version_id, code, label, percent, basis, sequence,
    disclosed, enabled)
  values (
    v_company, p_version, upper(trim(p_code)),
    coalesce(p_fields->>'label', initcap(replace(trim(p_code), '_', ' '))),
    coalesce((p_fields->>'percent')::numeric, 0),
    coalesce(p_fields->>'basis', 'profile_default'),
    coalesce((p_fields->>'sequence')::int, 10),
    coalesce((p_fields->>'disclosed')::boolean, false),
    coalesce((p_fields->>'enabled')::boolean, true))
  on conflict (estimate_version_id, code) do update
    set label     = coalesce(excluded.label, estimate_version_markups.label),
        percent   = coalesce((p_fields->>'percent')::numeric, estimate_version_markups.percent),
        basis     = coalesce(p_fields->>'basis', estimate_version_markups.basis),
        sequence  = coalesce((p_fields->>'sequence')::int, estimate_version_markups.sequence),
        disclosed = coalesce((p_fields->>'disclosed')::boolean,
                             estimate_version_markups.disclosed),
        enabled   = coalesce((p_fields->>'enabled')::boolean, estimate_version_markups.enabled),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Start this bid from the company's standard.
 *
 * Copies the profile's components onto the version so an estimator has
 * something to adjust rather than an empty panel and a blank page. Refuses
 * when the version already carries its own, because overwriting somebody's
 * adjustments with the defaults is the worst thing this could do.
 */
create or replace function app.adopt_profile_markups(p_version uuid)
returns int
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status app.estimate_status; v_profile uuid; v_count int;
begin
  select v.company_id, v.status, v.pricing_profile_id
    into v_company, v_status, v_profile
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
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from estimate_version_markups where estimate_version_id = p_version) then
    raise exception 'This bid already has its own adjustments'
      using errcode = 'unique_violation',
            hint = 'Change them one at a time rather than replacing the set.';
  end if;
  if v_profile is null then
    raise exception 'This version names no pricing profile to copy from'
      using errcode = 'no_data_found';
  end if;

  insert into estimate_version_markups (company_id, estimate_version_id, code, label,
                                        percent, basis, sequence, disclosed, enabled)
  select v_company, p_version, m.code, m.label, m.percent, m.basis, m.sequence,
         m.disclosed, true
  from markup_components m
  where m.pricing_profile_id = v_profile;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app.remove_estimate_markup(p_version uuid, p_code text)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status app.estimate_status;
begin
  select company_id, status into v_company, v_status
  from estimate_versions where id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('draft', 'in_review') then
    raise exception 'This version is %; make a new version to change it', v_status
      using errcode = 'check_violation';
  end if;

  delete from estimate_version_markups
   where estimate_version_id = p_version and code = upper(trim(p_code));
end;
$$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.set_estimate_markup(uuid, text, jsonb)',
    'app.adopt_profile_markups(uuid)',
    'app.remove_estimate_markup(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

create or replace function public.set_estimate_markup(p_version uuid, p_code text, p_fields jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.set_estimate_markup(p_version, p_code, p_fields); end; $$;

create or replace function public.adopt_profile_markups(p_version uuid)
returns int language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.adopt_profile_markups(p_version); end; $$;

create or replace function public.remove_estimate_markup(p_version uuid, p_code text)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.remove_estimate_markup(p_version, p_code); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.set_estimate_markup(uuid, text, jsonb)',
    'public.adopt_profile_markups(uuid)',
    'public.remove_estimate_markup(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();

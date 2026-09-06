-- =============================================================================
-- 0097 — Building an estimate
--
-- The schema for estimating has been complete since migration 0005 and the
-- pricing engine since 0058. What has never existed is the path from a person
-- to either of them: no way to create an estimate, add a line, or move one from
-- draft to a bid that went out. The screens render a demonstration estimate out
-- of a fixture file.
--
-- So this is the missing half of the thing the platform is for. Four acts, and
-- each is a function rather than a bare insert for a reason worth stating:
--
--   * **Creating one** has to make three rows agree — the estimate, its first
--     version, and the pointer from one to the other. Three inserts from a
--     browser is three chances to leave a version nothing points at.
--
--   * **Adding a line** is where the library actually earns its place. A
--     service carries its own unit, its description and a production rate
--     somebody measured; a line that did not pick those up would be a row a
--     person retyped, and the library would be decoration.
--
--   * **Moving the status** carries the rules that make an estimate a document
--     rather than a draft: nothing is approved unpriced, nobody approves their
--     own work, and an issued bid is never edited — it is superseded.
--
--   * **Issuing a proposal** turns a priced version into the thing that goes to
--     a customer, and freezes the number that went with it.
-- =============================================================================

/**
 * Start an estimate.
 *
 * The number is generated when nobody supplies one, and generated per company
 * rather than globally: an estimator quoting their fourth job this year expects
 * E-2026-0004, not whatever the platform happens to be up to.
 */
create or replace function app.create_estimate(
  p_name text,
  p_customer_id uuid default null,
  p_number text default null,
  p_bid_due_at timestamptz default null,
  p_company uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_estimate uuid;
  v_version uuid;
  v_number text;
  v_profile uuid;
begin
  /*
   * A person can belong to more than one company and the application has no
   * switcher yet, so the sole membership is the answer when there is exactly
   * one. Two memberships and no argument is a question, not a default: guessing
   * would file a bid under the wrong company.
   */
  if p_company is not null then
    v_company := p_company;
  else
    select company_id into v_company from company_memberships
     where user_id = auth.uid() and status = 'active' limit 2;
    if (select count(*) from company_memberships
         where user_id = auth.uid() and status = 'active') > 1 then
      raise exception 'You belong to more than one company; say which this estimate is for'
        using errcode = 'check_violation';
    end if;
  end if;
  if v_company is null then
    raise exception 'Open a company before creating an estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'estimates.write') then
    raise exception 'You do not have permission to create an estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'An estimate needs a name' using errcode = 'check_violation';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from customers c
                      where c.id = p_customer_id and c.company_id = v_company) then
    raise exception 'That customer is not one of yours' using errcode = 'no_data_found';
  end if;

  v_number := nullif(trim(coalesce(p_number, '')), '');
  if v_number is null then
    select 'E-' || to_char(now(), 'YYYY') || '-' ||
           lpad((count(*) + 1)::text, 4, '0')
      into v_number
      from estimates e
     where e.company_id = v_company
       and date_trunc('year', e.created_at) = date_trunc('year', now());
  end if;
  if exists (select 1 from estimates e
              where e.company_id = v_company and e.number = v_number) then
    v_number := v_number || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end if;

  select default_pricing_profile_id into v_profile from companies where id = v_company;

  insert into estimates (company_id, number, name, customer_id, status,
                         bid_due_at, estimator_id, created_by)
  values (v_company, v_number, trim(p_name), p_customer_id, 'draft',
          p_bid_due_at, auth.uid(), auth.uid())
  returning id into v_estimate;

  /*
   * Version one, carrying the company's own pricing profile. An estimate with
   * no version is an estimate nothing can be added to, so the two are made
   * together or not at all.
   */
  insert into estimate_versions (company_id, estimate_id, version_number, status,
                                 pricing_profile_id, created_by)
  values (v_company, v_estimate, 1, 'draft', v_profile, auth.uid())
  returning id into v_version;

  update estimates set current_version_id = v_version where id = v_estimate;

  return v_estimate;
end;
$$;

/**
 * Add a line from the library.
 *
 * This is where the library earns its place. The service carries the unit its
 * trade bids in, its own description, and — where somebody has measured one —
 * a production rate. A line that made the estimator retype all three would
 * make the library decoration.
 *
 * The costs are not written here. They belong to the engine, and migration
 * 0058 refuses a hand-written one; a line arrives unpriced and stays that way
 * until the engine has run.
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
  /*
   * A version that has been priced and approved is a record of what was agreed.
   * Changing it would change a document somebody signed off; migration 0011
   * built `app.revise_estimate_version` to make the next one instead.
   */
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
  -- A unit the service cannot be bid in is a mistake worth catching here rather
  -- than at pricing time, where it reads as a strange number.
  if v_service.id is not null and not (v_unit = any (v_service.supported_units)) then
    raise exception '% is not measured in %', v_service.name, v_unit
      using errcode = 'check_violation',
            hint = 'The units it supports are on the service in the library.';
  end if;

  /*
   * The controlling production rate, found the way the library is actually
   * built: a service points at an assembly, the assembly lists the tasks the
   * work is made of, and a rate hangs off a task. `production_rates.service_id`
   * exists and is null on every seeded row, so reading it would have found
   * nothing — the join has to walk the assembly.
   *
   * A rate stated in the unit the line is bid in comes first, because that is
   * the one whose number means what the estimator thinks it means. A company's
   * own measured rate beats the shipped benchmark, and confidence breaks the
   * remaining ties.
   */
  if v_service.id is not null then
    select pr.id into v_rate
    from assembly_components ac
    join production_rates pr on pr.task_id = ac.task_id and pr.status = 'active'
    join tasks t on t.id = ac.task_id
    where ac.assembly_id = v_service.default_assembly_id
      and ac.component_kind = 'task'
      and (pr.company_id = v_company or pr.company_id is null)
      and pr.superseded_by_id is null
    order by (pr.rate_unit = v_unit) desc,
             (pr.company_id is not null) desc,
             (t.category = 'Production') desc,
             pr.confidence_score desc nulls last,
             ac.sort_order
    limit 1;
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


/**
 * Refuse to let a bid go out that the engine said should not.
 *
 * `estimate_versions.blocked_from_issue` and `estimate_line_items.blocks_issue`
 * have been computed by the pricing engine since migration 0058 and carried an
 * index built for exactly this question. Until now the only thing that read
 * either was the award-to-project conversion in 0007 — meaning the platform
 * would stop you turning a bad estimate into a project, but not stop you
 * sending it to the customer first. The expensive half was the unguarded one.
 */
create or replace function app.assert_issuable(p_version uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_blocked boolean;
  v_lines   text;
begin
  select blocked_from_issue into v_blocked from estimate_versions where id = p_version;

  select string_agg(coalesce(nullif(line_number, ''), description), ', ' order by sort_order)
    into v_lines
  from estimate_line_items
  where estimate_version_id = p_version and blocks_issue;

  if v_lines is not null then
    raise exception 'These lines are not confident enough to bid: %', v_lines
      using errcode = 'check_violation',
            hint = 'Each needs a verified rate, or a senior sign-off on the line.';
  end if;
  if v_blocked then
    raise exception 'The pricing engine has not cleared this estimate to be issued'
      using errcode = 'check_violation',
            hint = 'Price it again once the low-confidence inputs are resolved.';
  end if;
end;
$$;

/**
 * Move an estimate along.
 *
 * The rules that make an estimate a document rather than a draft, in one place
 * rather than spread across whichever screen happened to call an update.
 */
create or replace function app.set_estimate_status(
  p_version uuid, p_status app.estimate_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v       estimate_versions%rowtype;
  v_lines   int;
  v_unpriced int;
begin
  select * into v_v from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;

  if p_status in ('approved', 'awarded') then
    if not app.has_permission(v_v.company_id, 'estimates.approve') then
      raise exception 'You do not have permission to approve an estimate'
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_status = 'issued' then
    if not app.has_permission(v_v.company_id, 'estimates.issue') then
      raise exception 'You do not have permission to issue a bid'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not app.has_permission(v_v.company_id, 'estimates.write') then
      raise exception 'You do not have permission to change this estimate'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select count(*), count(*) filter (where total_direct_cost = 0 and measured_quantity > 0)
    into v_lines, v_unpriced
  from estimate_line_items where estimate_version_id = p_version;

  if p_status = 'approved' then
    /*
     * Nothing is approved unpriced. An approved estimate with a zero on it is
     * a bid somebody will send, and the zero is the most expensive kind of
     * mistake this platform can allow — so it is refused rather than warned
     * about.
     */
    if v_lines = 0 then
      raise exception 'There is nothing on this estimate to approve'
        using errcode = 'check_violation';
    end if;
    if v_unpriced > 0 then
      raise exception '% line(s) have a quantity and no price. Price it first', v_unpriced
        using errcode = 'check_violation',
              hint = 'Pricing runs the engine over every line and writes what it costs.';
    end if;
    /*
     * Not your own — below tier 3. The oldest rule in a bid room: the person
     * who wants the job is not the person who decides the number is right.
     *
     * Tier is the cut rather than a permission key because it is already the
     * per-role dial a company can turn. A chief estimator or an owner runs the
     * bid room and signs their own work; a senior estimator does not.
     */
    if v_v.created_by = auth.uid() and app.approval_tier(v_v.company_id) < 3 then
      raise exception 'The person who built an estimate cannot be the one who approves it'
        using errcode = 'insufficient_privilege',
              hint = 'Somebody at chief-estimator authority or above has to sign this off.';
    end if;
  end if;

  if p_status = 'issued' then
    if v_v.status <> 'approved' then
      raise exception 'An estimate is approved before it is issued'
        using errcode = 'check_violation';
    end if;
    perform app.assert_issuable(p_version);
  end if;
  if v_v.status in ('issued', 'awarded', 'lost') and p_status in ('draft', 'in_review') then
    raise exception 'This version has already gone out; make a new version instead'
      using errcode = 'check_violation',
            hint = 'app.revise_estimate_version copies it forward with a reason.';
  end if;

  update estimate_versions
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         updated_at = now()
   where id = p_version;

  -- The estimate follows its current version, so a list does not have to join
  -- to know where something stands.
  update estimates e set status = p_status, updated_at = now()
   where e.id = v_v.estimate_id and e.current_version_id = p_version;

  insert into audit_events (company_id, actor_id, action, entity_table, entity_id,
                            new_state, reason)
  values (v_v.company_id, auth.uid(),
          case when p_status = 'approved' then 'approve'
               when p_status = 'issued' then 'issue'
               when p_status = 'awarded' then 'award'
               when p_status = 'lost' then 'reject'
               else 'update' end::app.audit_action,
          'public.estimate_versions', p_version::text,
          jsonb_build_object('status', p_status, 'was', v_v.status),
          nullif(trim(coalesce(p_reason, '')), ''));
end;
$$;

/**
 * Issue a proposal from a priced version.
 *
 * The price is copied onto the proposal rather than read through a join, and
 * that is deliberate: a proposal is what a customer was sent. If the estimate
 * is later revised, the document that went out still says what it said.
 */
create or replace function app.issue_proposal(
  p_version uuid,
  p_title text default null,
  p_cover_letter text default null,
  p_validity_days int default 30)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v estimate_versions%rowtype;
  v_e estimates%rowtype;
  v_number text;
  v_id uuid;
begin
  select * into v_v from estimate_versions where id = p_version;
  if not found then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_v.company_id, 'estimates.issue') then
    raise exception 'You do not have permission to issue a proposal'
      using errcode = 'insufficient_privilege';
  end if;
  if v_v.status not in ('approved', 'issued') then
    raise exception 'An estimate is approved before a proposal goes out'
      using errcode = 'check_violation';
  end if;
  if v_v.total_price <= 0 then
    raise exception 'That version has no price on it' using errcode = 'check_violation';
  end if;
  perform app.assert_issuable(p_version);

  select * into v_e from estimates where id = v_v.estimate_id;

  select 'P-' || to_char(now(), 'YYYY') || '-' || lpad((count(*) + 1)::text, 4, '0')
    into v_number
    from proposals p
   where p.company_id = v_v.company_id
     and date_trunc('year', p.created_at) = date_trunc('year', now());

  insert into proposals (company_id, estimate_version_id, customer_id, number, title,
                         cover_letter, validity_days, total_price, status,
                         issued_at, created_by)
  values (v_v.company_id, p_version, v_e.customer_id, v_number,
          coalesce(nullif(trim(coalesce(p_title, '')), ''), v_e.name),
          nullif(trim(coalesce(p_cover_letter, '')), ''),
          greatest(coalesce(p_validity_days, 30), 1),
          -- Frozen. A proposal is what the customer was sent.
          v_v.total_price, 'issued', now(), auth.uid())
  returning id into v_id;

  if v_v.status <> 'issued' then
    perform app.set_estimate_status(p_version, 'issued',
      'Proposal ' || v_number || ' issued');
  end if;

  return v_id;
end;
$$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.assert_issuable(uuid)',
    'app.create_estimate(text, uuid, text, timestamptz, uuid)',
    'app.add_estimate_line(uuid, uuid, text, numeric, app.unit_code)',
    'app.set_estimate_status(uuid, app.estimate_status, text)',
    'app.issue_proposal(uuid, text, text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

create or replace function public.create_estimate(
  p_name text, p_customer_id uuid default null, p_number text default null,
  p_bid_due_at timestamptz default null, p_company uuid default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.create_estimate(p_name, p_customer_id, p_number, p_bid_due_at, p_company); end; $$;

create or replace function public.add_estimate_line(
  p_version uuid, p_service uuid default null, p_description text default null,
  p_quantity numeric default 0, p_unit text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.add_estimate_line(p_version, p_service, p_description, p_quantity,
       nullif(p_unit, '')::app.unit_code); end; $$;

create or replace function public.set_estimate_status(
  p_version uuid, p_status text, p_reason text default null)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_estimate_status(p_version, p_status::app.estimate_status, p_reason); end; $$;

create or replace function public.issue_proposal(
  p_version uuid, p_title text default null, p_cover_letter text default null,
  p_validity_days int default 30)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin return app.issue_proposal(p_version, p_title, p_cover_letter, p_validity_days); end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.create_estimate(text, uuid, text, timestamptz, uuid)',
    'public.add_estimate_line(uuid, uuid, text, numeric, text)',
    'public.set_estimate_status(uuid, text, text)',
    'public.issue_proposal(uuid, text, text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();

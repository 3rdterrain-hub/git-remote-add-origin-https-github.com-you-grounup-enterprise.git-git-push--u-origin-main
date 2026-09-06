-- =============================================================================
-- 0098 — A snapshot of what priced it
--
-- Migration 0026 built `library_snapshots`: the library rows an estimate was
-- priced from, copied rather than referenced, so an old bid stays reproducible
-- when the catalog moves underneath it. It built the immutability triggers, the
-- drift report, and a trigger refusing to approve or issue a version with no
-- snapshot.
--
-- It did not build the thing that takes one. Nothing in the platform ever wrote
-- a `library_snapshots` row, so `library_snapshot_id` was null on every version
-- ever created and the enforcement trigger refused every approval. The estimate
-- module could not reach 'approved' at all.
--
-- The capture happens at approval rather than at every price. While a version
-- is a draft it is re-priced freely and a snapshot would be noise; the moment
-- somebody signs it off, what priced it is frozen. That also fits the one-per-
-- version uniqueness 0026 chose, which a capture-on-every-price would fight.
-- =============================================================================

/**
 * Copy in every library row that priced a version.
 *
 * The set is taken from what the estimate actually resolved to — the lines'
 * services, rates, crews and cost codes, the tasks under each assembly, and
 * every resource the engine extended — rather than from the library as a whole.
 * A snapshot of the whole catalog would be honest but useless: the question it
 * has to answer later is "what moved under *this* bid".
 *
 * Returns the existing snapshot when one is already held, because a version has
 * exactly one and re-approving must not fail on the second attempt.
 */
create or replace function app.capture_library_snapshot(p_version uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company  uuid;
  v_engine   text;
  v_existing uuid;
  v_snapshot uuid;
  v_kind     record;
  v_entries  jsonb := '[]'::jsonb;
  v_batch    jsonb;
begin
  select company_id, engine_version into v_company, v_engine
  from estimate_versions where id = p_version;
  if v_company is null then
    raise exception 'No such estimate version' using errcode = 'no_data_found';
  end if;

  select id into v_existing from library_snapshots where estimate_version_id = p_version;
  if v_existing is not null then return v_existing; end if;

  if v_engine is null or length(trim(v_engine)) = 0 then
    raise exception 'This version has not been priced, so there is nothing to snapshot'
      using errcode = 'check_violation',
            hint = 'Price it first; the engine records which build produced the number.';
  end if;

  /*
   * Which rows to copy, per library. Held as a list rather than fifteen near
   * identical blocks so a new library is one row here and cannot be added to
   * the schema while being quietly left out of the snapshot.
   *
   * `source` is a query returning the ids this version used; $1 is the version.
   */
  for v_kind in
    select * from (values
      ('pricing_profile', 'pricing_profiles', true,
       'select pricing_profile_id from estimate_versions where id = $1'),
      ('service', 'services', true,
       'select service_id from estimate_line_items where estimate_version_id = $1'),
      ('cost_code', 'cost_codes', true,
       'select cost_code_id from estimate_line_items where estimate_version_id = $1'),
      ('production_rate', 'production_rates', true,
       'select production_rate_id from estimate_line_items where estimate_version_id = $1'),
      ('crew', 'crews', true,
       'select crew_id from estimate_line_items where estimate_version_id = $1'),
      ('assembly', 'assemblies', true,
       'select a.id from estimate_line_items l
          join services s on s.id = l.service_id
          join assemblies a on a.id = s.default_assembly_id
         where l.estimate_version_id = $1
        union
        select assembly_id from estimate_line_items where estimate_version_id = $1'),
      ('task', 'tasks', true,
       'select ac.task_id from estimate_line_items l
          join services s on s.id = l.service_id
          join assembly_components ac on ac.assembly_id = s.default_assembly_id
         where l.estimate_version_id = $1 and ac.component_kind = ''task'''),
      ('condition_modifier', 'condition_modifiers', true,
       'select m.condition_modifier_id from estimate_line_modifiers m
          join estimate_line_items l on l.id = m.line_item_id
         where l.estimate_version_id = $1'),
      ('labor_rate', 'labor_rates', true,
       'select r.labor_rate_id from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where l.estimate_version_id = $1'),
      ('equipment', 'equipment', true,
       'select r.equipment_id from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where l.estimate_version_id = $1'),
      ('equipment_rate', 'equipment_rates', false,
       'select er.id from equipment_rates er
         where er.equipment_id in (
           select r.equipment_id from estimate_line_resources r
             join estimate_line_items l on l.id = r.line_item_id
            where l.estimate_version_id = $1)'),
      ('material', 'materials', true,
       'select r.material_id from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where l.estimate_version_id = $1'),
      ('trucking_rate', 'trucking_rates', false,
       'select r.trucking_rate_id from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where l.estimate_version_id = $1'),
      ('disposal_site', 'disposal_sites', false,
       'select r.disposal_site_id from estimate_line_resources r
          join estimate_line_items l on l.id = r.line_item_id
         where l.estimate_version_id = $1')
    ) as k(kind, tbl, has_group, source)
  loop
    execute format($fmt$
      select coalesce(jsonb_agg(e order by e->>'source_id'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'kind', %L,
                 'source_id', t.id,
                 'source_updated_at', t.updated_at,
                 'scope', case when t.company_id is not null then 'company'
                               when %s then 'group' else 'platform' end,
                 'payload', to_jsonb(t)) as e
        from %I t
        where t.id in (%s)
      ) x
    $fmt$,
      v_kind.kind,
      case when v_kind.has_group then 't.enterprise_group_id is not null' else 'false' end,
      v_kind.tbl,
      v_kind.source)
    into v_batch using p_version;

    v_entries := v_entries || v_batch;
  end loop;

  /*
   * The digest is computed before the snapshot row is written because 0026
   * refuses UPDATE on it — correctly, since a snapshot that can be edited is
   * not a snapshot. Ordering the entries makes the digest a property of the
   * content rather than of the order rows happened to come back in.
   */
  select coalesce(jsonb_agg(e order by e->>'kind', e->>'source_id'), '[]'::jsonb)
    into v_entries
  from jsonb_array_elements(v_entries) e;

  insert into library_snapshots (company_id, estimate_version_id, captured_by,
                                 engine_version, entry_count, digest)
  values (v_company, p_version, auth.uid(), v_engine,
          jsonb_array_length(v_entries),
          substr(md5(v_entries::text), 1, 16))
  returning id into v_snapshot;

  insert into library_snapshot_entries (company_id, snapshot_id, kind, source_id,
                                        source_updated_at, scope, payload)
  select v_company, v_snapshot, e->>'kind', (e->>'source_id')::uuid,
         (e->>'source_updated_at')::timestamptz, e->>'scope', e->'payload'
  from jsonb_array_elements(v_entries) e;

  return v_snapshot;
end;
$$;

comment on function app.capture_library_snapshot(uuid) is
  'Copies every library row an estimate version was priced from into an immutable snapshot, so the bid stays reproducible when the catalog changes. Taken at approval; returns the existing snapshot if the version already holds one.';

revoke all on function app.capture_library_snapshot(uuid) from public, anon;
grant execute on function app.capture_library_snapshot(uuid) to authenticated, service_role;

/**
 * Approval now captures the snapshot before it moves the status.
 *
 * Order matters: `enforce_issued_version_snapshot` fires on the same UPDATE
 * that sets 'approved', so the version has to be pointed at its snapshot first.
 */
create or replace function app.set_estimate_status(
  p_version uuid, p_status app.estimate_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_v        estimate_versions%rowtype;
  v_lines    int;
  v_unpriced int;
  v_snapshot uuid;
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

    -- Freeze what priced it, before the status moves.
    if v_v.library_snapshot_id is null then
      v_snapshot := app.capture_library_snapshot(p_version);
      update estimate_versions set library_snapshot_id = v_snapshot where id = p_version;
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

revoke all on function app.set_estimate_status(uuid, app.estimate_status, text) from public, anon;
grant execute on function app.set_estimate_status(uuid, app.estimate_status, text) to authenticated;

/**
 * What the live library has done since this estimate was priced.
 *
 * `app.snapshot_drift` has existed since 0026 and took a snapshot id, which
 * nobody had. This is the question people actually ask, phrased against the
 * estimate: is it still safe to re-issue this bid?
 */
create or replace function public.estimate_drift(p_version uuid)
returns table (kind text, source_id uuid, status text,
               snapshot_updated_at timestamptz, live_updated_at timestamptz)
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_snapshot uuid;
begin
  select library_snapshot_id into v_snapshot from estimate_versions where id = p_version;
  if v_snapshot is null then return; end if;
  return query select d.kind, d.source_id, d.status, d.snapshot_updated_at, d.live_updated_at
               from app.snapshot_drift(v_snapshot) d;
end;
$$;

revoke all on function public.estimate_drift(uuid) from public, anon;
grant execute on function public.estimate_drift(uuid) to authenticated;

select app.assert_security_gates();

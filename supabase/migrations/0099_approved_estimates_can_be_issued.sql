-- =============================================================================
-- 0099 — An approved estimate can be issued
--
-- RULE-009 in migration 0006 freezes a version once it is approved, issued,
-- awarded or lost, and then adds:
--
--     -- An issued version may only move forward to a terminal commercial state.
--     if new.status <> old.status and new.status not in ('awarded','lost','archived')
--
-- The comment says *issued*. The code says any frozen status, and 'approved' is
-- one of them — so the transition approved → issued was refused, and the legal
-- life of an estimate stopped one step before a bid could go out. `estimates.
-- issue` was a permission that could never be exercised, and `proposals` a
-- table nothing could reach. Nothing caught it because until 0097 there was no
-- way to approve a version in the first place.
--
-- The transitions are written out below rather than expressed as "not these
-- three", because a list of what is allowed is a thing you can read and check
-- against how the business actually works.
-- =============================================================================

create or replace function app.enforce_version_immutability()
returns trigger
language plpgsql
as $$
declare
  v_locked   constant text[] := array['approved', 'issued', 'awarded', 'lost'];
  v_old      jsonb := to_jsonb(old);
  v_new      jsonb := to_jsonb(new);
  v_mutable  constant text[] := array[
    'status', 'updated_at', 'issued_at', 'issued_by', 'approved_at', 'approved_by',
    'awarded_at', 'lost_at'
  ];
  v_generated text[];
  v_allowed  text[];
  k text;
begin
  if not (old.status::text = any (v_locked)) then
    return new;
  end if;

  -- PostgreSQL leaves generated columns unpopulated in a BEFORE trigger, so
  -- comparing them would report a spurious change. They cannot move on their
  -- own anyway: only their source columns can, and those are checked.
  select coalesce(array_agg(a.attname::text), '{}')
  into v_generated
  from pg_attribute a
  where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
    and a.attgenerated <> '';

  for k in select jsonb_object_keys(v_old) loop
    if k = any (v_mutable) or k = any (v_generated) then
      continue;
    end if;
    if (v_old -> k) is distinct from (v_new -> k) then
      raise exception
        'Estimate version % is % and immutable (RULE-009); field "%" cannot change. Create a new version instead.',
        old.id, old.status, k
        using errcode = 'restrict_violation';
    end if;
  end loop;

  /*
   * Where a frozen version may go next.
   *
   *   approved → issued   the bid goes to the customer
   *   issued   → awarded  they took it
   *            → lost     they did not
   *   any      → archived filed away
   *
   * Everything else is refused, including every way back to draft: a version
   * that has been signed off is reopened by making the next version, which is
   * what `app.revise_estimate_version` is for.
   */
  if new.status::text <> old.status::text then
    v_allowed := case old.status::text
      when 'approved' then array['issued', 'awarded', 'lost', 'archived']
      when 'issued'   then array['awarded', 'lost', 'archived']
      else array['archived']
    end;
    if not (new.status::text = any (v_allowed)) then
      raise exception 'Estimate version % cannot move from % to %. It may become: %',
        old.id, old.status, new.status, array_to_string(v_allowed, ', ')
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.enforce_version_immutability is
  'RULE-009. Freezes a version''s content once it is approved, issued, awarded or lost, and permits only the forward transitions an estimate actually has: approved to issued, issued to awarded or lost, and anything to archived.';

/**
 * Issuing stamps who sent it and when.
 *
 * `issued_at` and `issued_by` have been on `estimate_versions` and in RULE-009's
 * mutable list since 0006, and nothing ever wrote either. A bid the platform
 * cannot say who sent is a gap in exactly the record a dispute turns on.
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
     */
    if v_v.created_by = auth.uid() and app.approval_tier(v_v.company_id) < 3 then
      raise exception 'The person who built an estimate cannot be the one who approves it'
        using errcode = 'insufficient_privilege',
              hint = 'Somebody at chief-estimator authority or above has to sign this off.';
    end if;
    /*
     * The engine's own verdict is checked here as well as at issue. Approving
     * something that can never be issued wastes the approver's signature, and
     * tells them at the point they can still do something about it.
     */
    perform app.assert_issuable(p_version);

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
         issued_by   = case when p_status = 'issued'   then auth.uid() else issued_by end,
         issued_at   = case when p_status = 'issued'   then now() else issued_at end,
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

select app.assert_security_gates();

-- =============================================================================
-- 0102 — An estimate that expires, and a client it belongs to
--
-- Three things an estimator needs on the estimate itself and could not have:
--
--   * **A date the price stops being good.** A bid priced against September
--     fuel and September steel is not a bid in March, and an estimate carried
--     no way to say so. `proposals.validity_days` says how long the *document*
--     stands; nothing said how long the *estimate* does.
--
--   * **The client it is for**, at creation. The column has existed since 0006
--     and `app.create_estimate` accepted it, but nothing offered a way to pick
--     one, so every estimate was for nobody.
--
--   * **When it was made.** `created_at` has always been there and no screen
--     read it. That one needs no schema.
--
-- Expiry is derived, never stored. A stored `is_expired` is a boolean that is
-- wrong from the moment the clock passes it until something runs to correct it,
-- and the thing that runs never exists. `expires_at` is the fact; expired is
-- what follows from it and the current time.
-- =============================================================================

alter table estimates drop constraint if exists estimates_expiry_after_creation;
alter table estimates
  add column if not exists expires_at timestamptz,
  add constraint estimates_expiry_after_creation
    check (expires_at is null or expires_at > created_at);

comment on column estimates.expires_at is
  'When this estimate''s price stops being good. Optional: an estimate with no expiry does not expire. Expiry is derived from this and the clock, never stored as a status — a stored flag is wrong between the moment it passes and whatever would have corrected it.';

create index if not exists estimates_expiring_idx on estimates(company_id, expires_at)
  where expires_at is not null and status in ('draft', 'in_review', 'approved', 'issued');

/** Has this estimate's price stopped being good? */
create or replace function app.estimate_is_expired(p_estimate uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog
as $$
  select coalesce(expires_at <= now(), false) from estimates where id = p_estimate;
$$;

revoke all on function app.estimate_is_expired(uuid) from public, anon;
grant execute on function app.estimate_is_expired(uuid) to authenticated;

/**
 * Set or clear the expiry.
 *
 * Separate from creation because the answer often arrives later — a customer
 * asks how long the number holds after the estimate already exists. Refused
 * once the version has gone out, for the same reason the rest of it is: the
 * document a customer holds already states how long it stands.
 */
create or replace function app.set_estimate_expiry(p_estimate uuid, p_expires_at timestamptz)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_e estimates%rowtype;
begin
  select * into v_e from estimates where id = p_estimate;
  if not found then
    raise exception 'No such estimate' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_e.company_id, 'estimates.write') then
    raise exception 'You do not have permission to change this estimate'
      using errcode = 'insufficient_privilege';
  end if;
  if v_e.status in ('issued', 'awarded', 'lost', 'archived') then
    raise exception 'This estimate is %; its terms are already with the customer', v_e.status
      using errcode = 'check_violation';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'An expiry in the past would expire it immediately'
      using errcode = 'check_violation';
  end if;

  update estimates set expires_at = p_expires_at, updated_at = now() where id = p_estimate;
end;
$$;

revoke all on function app.set_estimate_expiry(uuid, timestamptz) from public, anon;
grant execute on function app.set_estimate_expiry(uuid, timestamptz) to authenticated;

create or replace function public.set_estimate_expiry(p_estimate uuid, p_expires_at timestamptz)
returns void language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin perform app.set_estimate_expiry(p_estimate, p_expires_at); end; $$;

revoke all on function public.set_estimate_expiry(uuid, timestamptz) from public, anon;
grant execute on function public.set_estimate_expiry(uuid, timestamptz) to authenticated;

/**
 * Creation takes the expiry and the client.
 *
 * Replaces the 0097 signature rather than adding an overload: two functions
 * that both create an estimate is how one of them ends up missing a rule.
 */
drop function if exists app.create_estimate(text, uuid, text, timestamptz, uuid);
drop function if exists public.create_estimate(text, uuid, text, timestamptz, uuid);

create or replace function app.create_estimate(
  p_name text,
  p_customer_id uuid default null,
  p_number text default null,
  p_bid_due_at timestamptz default null,
  p_company uuid default null,
  p_expires_at timestamptz default null,
  p_description text default null)
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
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'An expiry in the past would expire it immediately'
      using errcode = 'check_violation';
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

  insert into estimates (company_id, number, name, description, customer_id, status,
                         bid_due_at, expires_at, estimator_id, created_by)
  values (v_company, v_number, trim(p_name),
          nullif(trim(coalesce(p_description, '')), ''), p_customer_id, 'draft',
          p_bid_due_at, p_expires_at, auth.uid(), auth.uid())
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

revoke all on function app.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text)
  from public, anon;
grant execute on function app.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text)
  to authenticated;

create or replace function public.create_estimate(
  p_name text, p_customer_id uuid default null, p_number text default null,
  p_bid_due_at timestamptz default null, p_company uuid default null,
  p_expires_at timestamptz default null, p_description text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog
as $$ begin
  return app.create_estimate(p_name, p_customer_id, p_number, p_bid_due_at, p_company,
                             p_expires_at, p_description);
end; $$;

revoke all on function public.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text)
  from public, anon;
grant execute on function public.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text)
  to authenticated;

/**
 * An expired estimate is not approved, and not issued.
 *
 * The check lives beside the others in `set_estimate_status` rather than in a
 * trigger, because it is a rule about a decision a person is making now — and
 * the message has to say what to do about it, which a constraint cannot.
 */
create or replace function app.assert_not_expired(p_version uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare v_expires timestamptz;
begin
  select e.expires_at into v_expires
  from estimate_versions v join estimates e on e.id = v.estimate_id
  where v.id = p_version;

  if v_expires is not null and v_expires <= now() then
    raise exception 'This estimate expired on %', to_char(v_expires, 'FMMonth FMDD, YYYY')
      using errcode = 'check_violation',
            hint = 'Move the expiry out, or price it again against today''s rates.';
  end if;
end;
$$;

revoke all on function app.assert_not_expired(uuid) from public, anon;
grant execute on function app.assert_not_expired(uuid) to authenticated;

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
    perform app.assert_not_expired(p_version);
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
    perform app.assert_not_expired(p_version);
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

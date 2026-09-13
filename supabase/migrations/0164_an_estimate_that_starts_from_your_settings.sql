-- =============================================================================
-- 0164 — An estimate that starts from your settings
--
-- `companies` has carried six estimating defaults since 0002 — shift hours,
-- calendar efficiency, swell, shrink, fuel price, bid rounding — and Company
-- Settings has offered them since the screen was made live. `create_estimate`
-- never read one. It inserted a version with a company, a number, a status, a
-- pricing profile and a creator, and let every other column fall to its own
-- table default.
--
-- Two of those table defaults disagree with the company's, and both disagree in
-- a direction that flatters the bid:
--
--   * **Fuel is zero.** The column defaults to 0 and a company to 4.25. Fuel is
--     one of RULE-001's ten separately tracked buckets precisely so that nobody
--     can hide it inside an equipment rate — and it was being priced at nothing
--     on every estimate this platform has ever created.
--   * **Calendar efficiency is 1.** The column defaults to 1 and a company to
--     0.85. One says no day is ever lost to weather, breakdown or access. The
--     other is what the company actually believes.
--
-- Shift hours, swell and shrink happen to agree today, which is exactly why
-- this went unnoticed: four of six matched, and the two that did not were the
-- two nobody reads back.
--
-- So a version inherits all six at the moment it is created, and the settings
-- screen stops being a form that changes nothing.
--
-- **What this does not do is reprice anything.** The repair below touches only
-- draft versions that have never been priced. A version that has been through
-- the engine carries a price somebody has read, and moving an input underneath
-- it would leave the stored price disagreeing with the stored assumptions —
-- which is the unreproducible number this whole schema exists to prevent.
-- Those are left alone, visibly wrong in their own header, for a person to
-- re-price.
--
-- Engine: the inputs a price is computed from.
-- =============================================================================

create or replace function app.create_estimate(
  p_name text,
  p_customer_id uuid default null,
  p_number text default null,
  p_bid_due_at timestamptz default null,
  p_company uuid default null,
  p_expires_at timestamptz default null,
  p_description text default null,
  p_site_address text default null,
  p_site_city text default null,
  p_site_state text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_estimate uuid;
  v_version uuid;
  v_number text;
  v_profile uuid;
  v_defaults companies%rowtype;
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

  select * into v_defaults from companies where id = v_company;
  v_profile := v_defaults.default_pricing_profile_id;

  insert into estimates (company_id, number, name, description, customer_id, status,
                         bid_due_at, expires_at, estimator_id, created_by,
                         site_address, site_city, site_state)
  values (v_company, v_number, trim(p_name),
          nullif(trim(coalesce(p_description, '')), ''), p_customer_id, 'draft',
          p_bid_due_at, p_expires_at, auth.uid(), auth.uid(),
          nullif(trim(coalesce(p_site_address, '')), ''),
          nullif(trim(coalesce(p_site_city, '')), ''),
          nullif(upper(trim(coalesce(p_site_state, ''))), ''))
  returning id into v_estimate;

  /*
   * Version one, carrying the company's own pricing profile and the six
   * estimating defaults it has stated. An estimate with no version is an
   * estimate nothing can be added to, so the two are made together or not at
   * all.
   *
   * The six were left to fall to their own table defaults, and two of those
   * disagree with a company's in the direction that flatters a bid: fuel
   * defaults to 0 against a company's 4.25, and calendar efficiency to 1
   * against 0.85. Fuel is one of RULE-001's separately tracked buckets
   * precisely so nobody can bury it in an equipment rate, and it was priced at
   * nothing on every estimate ever made here.
   */
  insert into estimate_versions (company_id, estimate_id, version_number, status,
                                 pricing_profile_id, created_by,
                                 shift_hours, calendar_efficiency,
                                 fuel_price_per_gallon, swell_percent,
                                 shrink_percent, bid_rounding_increment)
  values (v_company, v_estimate, 1, 'draft', v_profile, auth.uid(),
          v_defaults.default_shift_hours,
          v_defaults.default_calendar_efficiency,
          v_defaults.default_fuel_price,
          v_defaults.default_swell_percent,
          v_defaults.default_shrink_percent,
          v_defaults.bid_rounding_increment)
  returning id into v_version;

  update estimates set current_version_id = v_version where id = v_estimate;

  return v_estimate;
end;
$$;

comment on function app.create_estimate(text, uuid, text, timestamptz, uuid, timestamptz, text, text, text, text) is
  'Creates an estimate and its first version under the company own estimating defaults. ENGINE: fuel defaulted to zero and calendar efficiency to 1 before this, so every estimate priced fuel at nothing and assumed no day was ever lost.';

-- -----------------------------------------------------------------------------
-- The ones already made, that nobody has priced
-- -----------------------------------------------------------------------------

/*
 * Only drafts the engine has never seen.
 *
 * A version with a `calculated_at` carries a price somebody has read. Moving an
 * input underneath it would leave the price disagreeing with the assumptions
 * printed beside it, and a number nobody can reproduce from what is on the
 * screen is the one thing this schema refuses to produce. Those keep their
 * wrong fuel price, visible in their own header, until a person re-prices them.
 */
update estimate_versions v
   set fuel_price_per_gallon = c.default_fuel_price,
       calendar_efficiency   = c.default_calendar_efficiency,
       shift_hours           = c.default_shift_hours,
       swell_percent         = c.default_swell_percent,
       shrink_percent        = c.default_shrink_percent,
       updated_at            = now()
  from companies c
 where c.id = v.company_id
   and v.status = 'draft'
   and v.calculated_at is null
   and (v.fuel_price_per_gallon is distinct from c.default_fuel_price
     or v.calendar_efficiency   is distinct from c.default_calendar_efficiency);

select app.assert_security_gates();

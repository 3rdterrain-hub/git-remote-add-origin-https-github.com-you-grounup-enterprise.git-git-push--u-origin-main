-- =============================================================================
-- 0188 — The work comes in by phone
--
-- Found by the owner using the product, which is the most expensive way to find
-- anything and the way this repository keeps finding things.
--
-- The Leads tab says "No leads yet — put the form on the Website form tab onto
-- your site, and what people send lands here." That is the *only* way a lead
-- can exist: `app.submit_lead` (0065) takes a public form key and is granted to
-- `anon`. There is no signed-in path at all.
--
-- Directly beneath it, the Lead source breakdown lists Website, Phone call,
-- Referral, Repeat customer, Walk-in, Bid board and Social media. Six of the
-- seven could never have a row. For a contractor, six of the seven are how the
-- work actually arrives.
--
-- The Pipeline tab then says "An opportunity arrives when a qualified lead
-- converts" — so with no lead, no opportunity, ever. And the Customers page's
-- primary action, `Add customer`, was a `<Button>` with no `onClick`: it
-- rendered, it hovered, and it did nothing. There is no `create_customer`
-- anywhere in the schema; the only code that has ever inserted a customer is
-- the lead-conversion path inside 0065.
--
-- So the first three steps of the workflow this platform exists to run — get a
-- lead, make it a customer, open an opportunity — could not be performed by a
-- signed-in person at all. Everything downstream was built and tested against
-- rows that had to be inserted by hand.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Codes
-- -----------------------------------------------------------------------------

/**
 * The next customer code for a company.
 *
 * Lifted out of 0065's conversion path, where it was written inline, so the
 * hand-entered customer and the converted one are numbered by the same rule
 * rather than by two copies of it that will eventually disagree.
 */
create or replace function app.next_company_customer_code(p_company uuid)
returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select 'CUS-' || lpad((coalesce(max(substring(c.code from '^CUS-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from customers c
  where c.company_id = p_company and c.code ~ '^CUS-\d+$';
$$;

comment on function app.next_company_customer_code(uuid) is
  'The next CUS-nnnn for a company. Codes are unique per company, so the database issues them. ENTITY.';

/** The next opportunity number for a company, within the year. */
create or replace function app.next_company_opportunity_number(p_company uuid)
returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select 'OPP-' || to_char(now(), 'YYYY') || '-'
         || lpad((coalesce(max(substring(o.number from '(\d+)$')::int), 0) + 1)::text, 4, '0')
  from opportunities o
  where o.company_id = p_company;
$$;

comment on function app.next_company_opportunity_number(uuid) is
  'The next OPP-YYYY-nnnn for a company. ENTITY.';

-- -----------------------------------------------------------------------------
-- A customer entered by hand
-- -----------------------------------------------------------------------------

/**
 * Add a customer.
 *
 * The same name is refused rather than quietly duplicated. 0065 already reuses
 * a customer of the same name on conversion "rather than making a second one,
 * which is how a CRM ends up with four records for the same contractor" — that
 * reasoning applies at least as strongly to somebody typing it in, and the
 * error says which record already exists so they can open it instead.
 */
create or replace function app.create_customer(
  p_company       uuid,
  p_name          text,
  p_customer_type text default 'commercial',
  p_email         text default null,
  p_phone         text default null,
  p_city          text default null,
  p_state         text default null,
  p_address       text default null,
  p_postal_code   text default null,
  p_payment_terms text default null,
  p_notes         text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'crm.write');
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_existing text;
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A customer needs a name' using errcode = 'check_violation';
  end if;
  if p_customer_type not in ('residential','commercial','municipal','state_dot',
                             'federal','industrial','developer','general_contractor') then
    raise exception 'Unknown kind of customer %', p_customer_type
      using errcode = 'check_violation';
  end if;

  select code into v_existing from customers
   where company_id = v_company and lower(btrim(name)) = lower(v_name)
   limit 1;
  if v_existing is not null then
    raise exception 'You already have a customer called % (%)', v_name, v_existing
      using errcode = 'unique_violation',
            hint = 'Open that record rather than making a second one for the same outfit.';
  end if;

  insert into customers (
    company_id, code, name, customer_type, email, phone, address_line1,
    city, state_province, postal_code, payment_terms, notes, created_by)
  values (
    v_company, app.next_company_customer_code(v_company), v_name,
    p_customer_type,
    nullif(btrim(coalesce(p_email,'')),''),
    nullif(btrim(coalesce(p_phone,'')),''),
    nullif(btrim(coalesce(p_address,'')),''),
    nullif(btrim(coalesce(p_city,'')),''),
    nullif(btrim(coalesce(p_state,'')),''),
    nullif(btrim(coalesce(p_postal_code,'')),''),
    coalesce(nullif(btrim(coalesce(p_payment_terms,'')),''), 'Net 30'),
    nullif(btrim(coalesce(p_notes,'')),''),
    auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.create_customer(uuid, text, text, text, text, text, text, text, text, text, text) is
  'Adds a customer. The first one anywhere: the Add customer button had no handler and no function existed behind it, so the only customers this platform could ever hold were the ones lead conversion made. ENTITY.';

/** Correct a customer, or change their terms. */
create or replace function app.update_customer(
  p_customer      uuid,
  p_name          text default null,
  p_customer_type text default null,
  p_email         text default null,
  p_phone         text default null,
  p_city          text default null,
  p_state         text default null,
  p_address       text default null,
  p_postal_code   text default null,
  p_payment_terms text default null,
  p_notes         text default null,
  p_status        text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from customers where id = p_customer;
  if v_company is null then
    raise exception 'No such customer' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to change customers'
      using errcode = 'insufficient_privilege';
  end if;
  if p_customer_type is not null and p_customer_type not in
     ('residential','commercial','municipal','state_dot','federal','industrial',
      'developer','general_contractor') then
    raise exception 'Unknown kind of customer %', p_customer_type
      using errcode = 'check_violation';
  end if;

  update customers
     set name = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         customer_type = coalesce(p_customer_type, customer_type),
         email = coalesce(nullif(btrim(coalesce(p_email,'')),''), email),
         phone = coalesce(nullif(btrim(coalesce(p_phone,'')),''), phone),
         address_line1 = coalesce(nullif(btrim(coalesce(p_address,'')),''), address_line1),
         city = coalesce(nullif(btrim(coalesce(p_city,'')),''), city),
         state_province = coalesce(nullif(btrim(coalesce(p_state,'')),''), state_province),
         postal_code = coalesce(nullif(btrim(coalesce(p_postal_code,'')),''), postal_code),
         payment_terms = coalesce(nullif(btrim(coalesce(p_payment_terms,'')),''), payment_terms),
         notes = coalesce(p_notes, notes),
         status = coalesce(p_status::app.record_status, status),
         updated_at = now()
   where id = p_customer;
end;
$$;

comment on function app.update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text) is
  'Corrects a customer or changes their terms. ENTITY.';

-- -----------------------------------------------------------------------------
-- A lead that came in some other way
-- -----------------------------------------------------------------------------

/**
 * Record a lead that did not come through the website.
 *
 * `app.submit_lead` (0065) is the public form: it takes a form key, is granted
 * to `anon`, rate-limits by IP and carries a honeypot. All of that is right for
 * a form on the open internet and none of it fits somebody writing down a phone
 * call. This is the other door, and it is the one a contractor uses most:
 * phone, referral, walk-in, a bid board, somebody stopping at the gate.
 *
 * The source is required and closed, because the Lead source breakdown on the
 * screen is a real question — where does our work come from — and free text
 * makes it unanswerable within a month.
 */
create or replace function app.create_lead(
  p_company     uuid,
  p_company_name text,
  p_source      text default 'Phone call',
  p_contact_name text default null,
  p_email       text default null,
  p_phone       text default null,
  p_description text default null,
  p_city        text default null,
  p_state       text default null,
  p_estimated_value numeric default null,
  p_follow_up_at timestamptz default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'crm.write');
  v_name    text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A lead needs a name to call it by'
      using errcode = 'check_violation',
            hint = 'The outfit, or the person, if that is all you have.';
  end if;
  /*
   * The source is NOT checked against a list written here. `lead_source` is a
   * user-addable category — migration 0124 governs `leads.source` through
   * `library_categories`, and 0150 made those categories manageable — so a
   * company that gets work from a way nobody thought of adds it rather than
   * asking for a migration. A second list in this function would be a second
   * opinion about the same question, and the two would drift.
   */
  /*
   * Something to reply to, in the same words 0065 uses: without one there is no
   * lead, only a note. Enforced here too rather than trusted to the form.
   */
  if coalesce(nullif(btrim(coalesce(p_email,'')),''),
              nullif(btrim(coalesce(p_phone,'')),'')) is null then
    raise exception 'A lead needs a phone number or an email'
      using errcode = 'check_violation',
            hint = 'Without one there is no lead, only a note.';
  end if;

  insert into leads (
    company_id, source, company_name, contact_name, email, phone,
    project_description, city, state_province, estimated_value,
    next_follow_up_at, stage, assigned_to)
  values (
    v_company, p_source, v_name,
    nullif(btrim(coalesce(p_contact_name,'')),''),
    nullif(btrim(coalesce(p_email,'')),''),
    nullif(btrim(coalesce(p_phone,'')),''),
    nullif(btrim(coalesce(p_description,'')),''),
    nullif(btrim(coalesce(p_city,'')),''),
    nullif(btrim(coalesce(p_state,'')),''),
    p_estimated_value, p_follow_up_at, 'new', auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.create_lead(uuid, text, text, text, text, text, text, text, text, numeric, timestamptz) is
  'Writes down a lead that came in by phone, referral, walk-in or a bid board. app.submit_lead (0065) is the public website form and was the only way a lead could exist, so every source but Website could never have a row. The source is validated by the library-category guard from 0124, never by a list in here, because the list is the company''s to extend. WORKFLOW.';

/** Move a lead along, or record that it came to nothing. */
create or replace function app.update_lead(
  p_lead        uuid,
  p_stage       text default null,
  p_contact_name text default null,
  p_email       text default null,
  p_phone       text default null,
  p_description text default null,
  p_estimated_value numeric default null,
  p_follow_up_at timestamptz default null,
  p_notes       text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_stage text;
begin
  select company_id, stage into v_company, v_stage from leads where id = p_lead;
  if v_company is null then
    raise exception 'No such lead' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to change leads'
      using errcode = 'insufficient_privilege';
  end if;
  if v_stage = 'converted' then
    raise exception 'That lead has already been converted'
      using errcode = 'check_violation',
            hint = 'Work the opportunity it became.';
  end if;
  if p_stage is not null and p_stage not in ('new','contacted','qualified','unqualified') then
    raise exception 'Converting a lead is its own action, because it creates a customer'
      using errcode = 'check_violation';
  end if;

  update leads
     set stage = coalesce(p_stage, stage),
         contact_name = coalesce(nullif(btrim(coalesce(p_contact_name,'')),''), contact_name),
         email = coalesce(nullif(btrim(coalesce(p_email,'')),''), email),
         phone = coalesce(nullif(btrim(coalesce(p_phone,'')),''), phone),
         project_description = coalesce(p_description, project_description),
         estimated_value = coalesce(p_estimated_value, estimated_value),
         next_follow_up_at = coalesce(p_follow_up_at, next_follow_up_at),
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_lead;
end;
$$;

comment on function app.update_lead(uuid, text, text, text, text, text, numeric, timestamptz, text) is
  'Works a lead through its stages. Converting is its own action, because it creates a customer and an opportunity. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- An opportunity opened directly
-- -----------------------------------------------------------------------------

/**
 * Open an opportunity against a customer.
 *
 * `move_opportunity_stage` and `update_opportunity` (0175) work one; nothing
 * could create one except lead conversion. A repeat customer ringing up about
 * the next job is not a lead — they are already a customer — and making
 * somebody invent a lead to get an opportunity is the kind of paperwork that
 * ends with the pipeline not being used at all.
 */
create or replace function app.create_opportunity(
  p_customer    uuid,
  p_name        text,
  p_description text default null,
  p_estimated_value numeric default null,
  p_bid_due_at  timestamptz default null,
  p_site_city   text default null,
  p_site_state  text default null,
  p_delivery_method text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  select company_id into v_company from customers where id = p_customer;
  if v_company is null then
    raise exception 'No such customer' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to open opportunities'
      using errcode = 'insufficient_privilege';
  end if;
  if v_name is null then
    raise exception 'An opportunity needs a name'
      using errcode = 'check_violation',
            hint = 'What the job is: Maumee Commerce Park sitework.';
  end if;

  insert into opportunities (
    company_id, customer_id, number, name, description, stage,
    estimated_value, bid_due_at, site_city, site_state, delivery_method,
    owner_user_id)
  values (
    v_company, p_customer, app.next_company_opportunity_number(v_company),
    v_name, nullif(btrim(coalesce(p_description,'')),''), 'identified',
    p_estimated_value, p_bid_due_at,
    nullif(btrim(coalesce(p_site_city,'')),''),
    nullif(btrim(coalesce(p_site_state,'')),''),
    nullif(btrim(coalesce(p_delivery_method,'')),''),
    auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.create_opportunity(uuid, text, text, numeric, timestamptz, text, text, text) is
  'Opens an opportunity against a customer. Lead conversion was the only thing that could create one, so a repeat customer ringing about the next job had to be entered as a stranger first. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.create_customer(
  p_company uuid, p_name text, p_customer_type text default 'commercial',
  p_email text default null, p_phone text default null, p_city text default null,
  p_state text default null, p_address text default null,
  p_postal_code text default null, p_payment_terms text default null,
  p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_customer(p_company, p_name, p_customer_type, p_email, p_phone,
       p_city, p_state, p_address, p_postal_code, p_payment_terms, p_notes); $$;

create or replace function public.update_customer(
  p_customer uuid, p_name text default null, p_customer_type text default null,
  p_email text default null, p_phone text default null, p_city text default null,
  p_state text default null, p_address text default null,
  p_postal_code text default null, p_payment_terms text default null,
  p_notes text default null, p_status text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_customer(p_customer, p_name, p_customer_type, p_email, p_phone,
       p_city, p_state, p_address, p_postal_code, p_payment_terms, p_notes, p_status); $$;

create or replace function public.create_lead(
  p_company uuid, p_company_name text, p_source text default 'phone_call',
  p_contact_name text default null, p_email text default null,
  p_phone text default null, p_description text default null,
  p_city text default null, p_state text default null,
  p_estimated_value numeric default null, p_follow_up_at timestamptz default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_lead(p_company, p_company_name, p_source, p_contact_name,
       p_email, p_phone, p_description, p_city, p_state, p_estimated_value,
       p_follow_up_at); $$;

create or replace function public.update_lead(
  p_lead uuid, p_stage text default null, p_contact_name text default null,
  p_email text default null, p_phone text default null,
  p_description text default null, p_estimated_value numeric default null,
  p_follow_up_at timestamptz default null, p_notes text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_lead(p_lead, p_stage, p_contact_name, p_email, p_phone,
       p_description, p_estimated_value, p_follow_up_at, p_notes); $$;

create or replace function public.create_opportunity(
  p_customer uuid, p_name text, p_description text default null,
  p_estimated_value numeric default null, p_bid_due_at timestamptz default null,
  p_site_city text default null, p_site_state text default null,
  p_delivery_method text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_opportunity(p_customer, p_name, p_description,
       p_estimated_value, p_bid_due_at, p_site_city, p_site_state, p_delivery_method); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_customer(uuid, text, text, text, text, text, text, text, text, text, text)',
    'public.update_customer(uuid, text, text, text, text, text, text, text, text, text, text, text)',
    'public.create_lead(uuid, text, text, text, text, text, text, text, text, numeric, timestamptz)',
    'public.update_lead(uuid, text, text, text, text, text, numeric, timestamptz, text)',
    'public.create_opportunity(uuid, text, text, numeric, timestamptz, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

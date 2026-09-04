-- =============================================================================
-- 0065 — Leads arriving from outside
--
-- `leads`, `opportunities` and `crm_activities` have existed since migration
-- 0005 and nothing has ever written one. A lead reached the platform by
-- somebody typing it in, which means most of them never reached it at all.
--
-- This is the only write in GrounUp that an unauthenticated visitor may
-- perform, and that makes it the only surface where the platform's usual
-- reasoning does not apply. Everywhere else the question is "may this person do
-- this to this company"; here there is no person. So the design is different in
-- kind, and the differences are the interesting part:
--
--   * **The form is addressed, not the company.** A public form has its own
--     key, and that key can be turned off or replaced without touching the
--     company it feeds. A URL carrying a company's own id would make the
--     tenant identifier public and permanent, and there would be no way to stop
--     a form once its address was scraped.
--   * **A bad key and a disabled key answer identically.** Anything else is an
--     oracle telling a stranger which companies exist here.
--   * **Nothing is read back.** `anon` may call one function and select from
--     nothing. A submitted lead is invisible to the person who submitted it,
--     because a form that confirms what it stored is a form that can be used to
--     read what others stored.
--   * **The rate limit is per form and per address**, counted from the rows
--     themselves rather than a counter somebody has to reset. A form with no
--     limit is a form that fills a company's pipeline with noise the first time
--     it is found.
--   * **An arriving lead is unqualified by construction.** It lands at stage
--     `new` with no assignee and no value, because everything a stranger types
--     is a claim rather than a fact.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A public form
-- -----------------------------------------------------------------------------
create table lead_intake_forms (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),

  -- The form's public address. Random, opaque, and replaceable without
  -- disturbing the company or the leads already collected.
  public_key    text not null unique
                  default encode(gen_random_bytes(18), 'base64')
                  check (length(public_key) between 16 and 64),

  is_active     boolean not null default true,
  -- Where the lead is recorded as having come from, so a company running three
  -- forms can tell which one works.
  source_label  text not null default 'website',

  -- What a stranger is allowed to send. A form with no ceiling is a form that
  -- can be used to write a novel into somebody's pipeline.
  max_per_hour_per_form    int not null default 60 check (max_per_hour_per_form between 1 and 10000),
  max_per_hour_per_address int not null default 5  check (max_per_hour_per_address between 1 and 1000),

  redirect_url  text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index lead_intake_forms_company_idx on lead_intake_forms(company_id);
-- The lookup every submission makes, and the only one anon causes.
create unique index lead_intake_forms_key_idx on lead_intake_forms(public_key) where is_active;

comment on table lead_intake_forms is
  'A public address that accepts leads for one company. ENTITY. Keyed separately from the company so a form can be disabled or replaced without exposing or changing the tenant identifier, and so a scraped address can be turned off.';

comment on column lead_intake_forms.public_key is
  'The form''s public address. Opaque and replaceable. A company id here would make the tenant identifier permanent and public, and there would be no way to retire a form once its URL was scraped.';

alter table lead_intake_forms enable row level security;
alter table lead_intake_forms force row level security;

-- Readable and writable by the company that owns it, and by nobody else.
-- `anon` is absent: the submission function reads the form with definer rights,
-- so a visitor never selects from this table at all.
create policy lead_intake_forms_select on lead_intake_forms for select to authenticated
  using (app.has_permission(company_id, 'crm.read'));
create policy lead_intake_forms_insert on lead_intake_forms for insert to authenticated
  with check (app.has_permission(company_id, 'crm.write'));
create policy lead_intake_forms_update on lead_intake_forms for update to authenticated
  using (app.has_permission(company_id, 'crm.write'))
  with check (app.has_permission(company_id, 'crm.write'));
create policy lead_intake_forms_delete on lead_intake_forms for delete to authenticated
  using (app.has_permission(company_id, 'crm.write'));

grant select, insert, update, delete on lead_intake_forms to authenticated;
revoke all on lead_intake_forms from anon;

select app.attach_standard_triggers('public.lead_intake_forms'::regclass);

-- -----------------------------------------------------------------------------
-- Where a lead came from
--
-- Columns on `leads` rather than a side table, because the origin of a lead is
-- part of the lead: a company needs to know which form produced it and, when
-- something goes wrong, what address sent it.
-- -----------------------------------------------------------------------------
alter table leads
  add column intake_form_id uuid references lead_intake_forms(id) on delete set null,
  add column submitted_ip inet,
  add column submitted_user_agent text,
  add column submitted_at timestamptz;

create index leads_intake_form_idx on leads(intake_form_id) where intake_form_id is not null;
-- The rate-limit lookup, which runs on every public submission.
create index leads_intake_recent_idx on leads(intake_form_id, submitted_at desc)
  where intake_form_id is not null;

comment on column leads.submitted_ip is
  'The address a public submission came from, kept so a company can block abuse and so the rate limit has something to count. Null for a lead somebody entered by hand.';

-- -----------------------------------------------------------------------------
-- Submitting
-- -----------------------------------------------------------------------------
/**
 * Accept a lead from a public form.
 *
 * The only function `anon` may execute in this schema. `security definer`
 * because a visitor must be able to cause a row to exist in a company they
 * cannot see, read, or name.
 *
 * Returns nothing but a boolean. A submission that reported an id would let a
 * stranger learn something about the company's data; one that reported "that
 * key is unknown" differently from "that form is switched off" would tell them
 * which companies exist here.
 */
create or replace function app.submit_lead(
  p_key         text,
  p_company_name text,
  p_contact_name text default null,
  p_email       text default null,
  p_phone       text default null,
  p_description text default null,
  p_city        text default null,
  p_state       text default null,
  -- A field a person never fills in and a robot always does.
  p_trap        text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_form lead_intake_forms%rowtype;
  v_ip   inet;
  v_ua   text;
  v_from_form int;
  v_from_ip   int;
begin
  /*
   * A robot filling the hidden field is answered exactly like a success. Told
   * "rejected", it adapts; told "thank you", it moves on.
   */
  if p_trap is not null and length(trim(p_trap)) > 0 then
    return true;
  end if;

  if p_company_name is null or length(trim(p_company_name)) < 2 then
    raise exception 'Tell us who you are' using errcode = 'check_violation';
  end if;

  -- Something to reply to, or there is no lead — only a note.
  if coalesce(nullif(trim(p_email), ''), nullif(trim(p_phone), '')) is null then
    raise exception 'Leave an email address or a phone number so we can reply'
      using errcode = 'check_violation';
  end if;

  select * into v_form from lead_intake_forms
  where public_key = p_key and is_active;
  if not found then
    -- Deliberately the same answer for a key that never existed, a key that was
    -- replaced, and a form that was switched off.
    raise exception 'That form is not available' using errcode = 'no_data_found';
  end if;

  select ip_address, user_agent into v_ip, v_ua from app.request_context();

  select count(*) into v_from_form from leads
  where intake_form_id = v_form.id and submitted_at > now() - interval '1 hour';
  if v_from_form >= v_form.max_per_hour_per_form then
    raise exception 'This form has taken too many submissions in the last hour'
      using errcode = 'too_many_connections';
  end if;

  if v_ip is not null then
    select count(*) into v_from_ip from leads
    where intake_form_id = v_form.id and submitted_ip = v_ip
      and submitted_at > now() - interval '1 hour';
    if v_from_ip >= v_form.max_per_hour_per_address then
      raise exception 'Too many submissions from this address. Try again later'
        using errcode = 'too_many_connections';
    end if;
  end if;

  /*
   * Everything a stranger typed is a claim. The lead lands unqualified, with no
   * assignee, no value and no score — a person decides those after speaking to
   * them, and prefilling any of it would put a stranger's guess into a
   * company's pipeline as though it were the company's own judgment.
   */
  insert into leads (
    company_id, source, company_name, contact_name, email, phone,
    project_description, city, state_province, stage,
    intake_form_id, submitted_ip, submitted_user_agent, submitted_at)
  values (
    v_form.company_id, v_form.source_label,
    left(trim(p_company_name), 200),
    left(nullif(trim(p_contact_name), ''), 200),
    left(nullif(trim(p_email), ''), 320),
    left(nullif(trim(p_phone), ''), 50),
    left(nullif(trim(p_description), ''), 4000),
    left(nullif(trim(p_city), ''), 120),
    left(nullif(trim(p_state), ''), 120),
    'new',
    v_form.id, v_ip, left(v_ua, 500), now());

  return true;
end;
$$;

revoke all on function app.submit_lead(text, text, text, text, text, text, text, text, text) from public;
grant execute on function app.submit_lead(text, text, text, text, text, text, text, text, text)
  to anon, authenticated;

comment on function app.submit_lead(text, text, text, text, text, text, text, text, text) is
  'The only function anon may execute. Accepts a lead for the company a form belongs to, rate limited per form and per address, with an unknown key and a disabled form answering identically so the platform is not an oracle for which companies exist.';

-- -----------------------------------------------------------------------------
-- Down the funnel
-- -----------------------------------------------------------------------------
/**
 * Turn a qualified lead into a customer and an opportunity.
 *
 * The step the schema has always anticipated — `leads.converted_customer_id`
 * has been there since 0005 — and which nothing performed, so a lead had
 * nowhere to go.
 *
 * Refuses a lead that has not been qualified. Converting straight from `new`
 * would put an unexamined stranger into the pipeline with a value attached,
 * which is how a forecast stops meaning anything.
 */
create or replace function app.convert_lead(
  p_lead uuid,
  p_opportunity_name text default null,
  p_estimated_value numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_lead     leads%rowtype;
  v_customer uuid;
  v_opp      uuid;
  v_number   text;
  v_code     text;
begin
  select * into v_lead from leads where id = p_lead;
  if not found then
    raise exception 'Lead % not found', p_lead using errcode = 'no_data_found';
  end if;
  /*
   * Order matters. A converted lead is at stage `converted`, so checking the
   * stage first would answer "only a qualified lead can be converted" to
   * somebody converting one twice — technically true and useless, and it makes
   * the second branch unreachable.
   */
  if v_lead.converted_customer_id is not null then
    raise exception 'That lead was already converted' using errcode = 'unique_violation';
  end if;
  if v_lead.stage <> 'qualified' then
    raise exception 'Only a qualified lead can be converted; this one is %', v_lead.stage
      using errcode = 'check_violation',
            hint = 'Speak to them first, then mark the lead qualified.';
  end if;

  -- Reuse a customer of the same name rather than making a second one, which is
  -- how a CRM ends up with four records for the same contractor.
  select id into v_customer from customers
  where company_id = v_lead.company_id
    and lower(trim(name)) = lower(trim(v_lead.company_name))
  limit 1;

  if v_customer is null then
    select 'CUS-' || lpad((coalesce(max(substring(code from '\d+$')::int), 0) + 1)::text, 4, '0')
      into v_code
    from customers where company_id = v_lead.company_id and code ~ '^CUS-\d+$';
    insert into customers (company_id, code, name, city, state_province)
    values (v_lead.company_id, coalesce(v_code, 'CUS-0001'),
            trim(v_lead.company_name), v_lead.city, v_lead.state_province)
    returning id into v_customer;
  end if;

  select 'OPP-' || to_char(now(), 'YYYY') || '-'
         || lpad((coalesce(max(substring(number from '\d+$')::int), 0) + 1)::text, 4, '0')
    into v_number
  from opportunities where company_id = v_lead.company_id;

  insert into opportunities (
    company_id, customer_id, number, name, description, stage,
    estimated_value, site_city, site_state, owner_user_id)
  values (
    v_lead.company_id, v_customer, coalesce(v_number, 'OPP-0001'),
    coalesce(nullif(trim(p_opportunity_name), ''),
             trim(v_lead.company_name) || ' enquiry'),
    v_lead.project_description, 'identified',
    coalesce(p_estimated_value, v_lead.estimated_value),
    v_lead.city, v_lead.state_province,
    coalesce(v_lead.assigned_to, auth.uid()))
  returning id into v_opp;

  update leads
     set stage = 'converted',
         converted_customer_id = v_customer,
         converted_at = now(),
         updated_at = now()
   where id = p_lead;

  insert into crm_activities (
    company_id, customer_id, opportunity_id, lead_id, activity_type,
    subject, body, completed_at, created_by)
  values (
    v_lead.company_id, v_customer, v_opp, p_lead, 'note',
    'Lead converted to an opportunity',
    format('Arrived from %s on %s.', coalesce(v_lead.source, 'an unknown source'),
           to_char(coalesce(v_lead.submitted_at, v_lead.created_at), 'FMDay DD Month YYYY')),
    now(), auth.uid());

  return v_opp;
end;
$$;

grant execute on function app.convert_lead(uuid, text, numeric) to authenticated;

comment on function app.convert_lead(uuid, text, numeric) is
  'Turns a qualified lead into a customer and an opportunity, reusing an existing customer of the same name. Refuses an unqualified lead: converting straight from new puts an unexamined stranger into the pipeline with a value attached, which is how a forecast stops meaning anything.';

-- -----------------------------------------------------------------------------
-- Reachable from a browser
-- -----------------------------------------------------------------------------
/*
 * The one wrapper that is `security definer` rather than invoker.
 *
 * `anon` has no USAGE on the `app` schema and should not be given any: that
 * schema holds every governance function in the platform, and opening it to
 * unauthenticated callers to make one function reachable would be a wide answer
 * to a narrow problem. A definer wrapper means a visitor calls something in
 * `public`, and `app` stays closed to them entirely.
 *
 * It adds no privilege of its own. Everything it does is done by
 * `app.submit_lead`, which validates the key, rate limits, and writes an
 * unqualified lead — and which is itself definer for the same reason.
 */
create or replace function public.submit_lead(
  p_key text, p_company_name text, p_contact_name text default null,
  p_email text default null, p_phone text default null, p_description text default null,
  p_city text default null, p_state text default null, p_trap text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return app.submit_lead(p_key, p_company_name, p_contact_name, p_email, p_phone,
                         p_description, p_city, p_state, p_trap);
end;
$$;

create or replace function public.convert_lead(
  p_lead uuid, p_opportunity_name text default null, p_estimated_value numeric default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  return app.convert_lead(p_lead, p_opportunity_name, p_estimated_value);
end;
$$;

revoke all on function public.submit_lead(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text)
  to anon, authenticated;
revoke all on function public.convert_lead(uuid, text, numeric) from public, anon;
grant execute on function public.convert_lead(uuid, text, numeric) to authenticated;

select app.assert_security_gates();

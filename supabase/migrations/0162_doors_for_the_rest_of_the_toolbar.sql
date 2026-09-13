-- =============================================================================
-- 0162 — Doors for the rest of the toolbar
--
-- Clicking round a fresh company found fifteen controls that render and cannot
-- do anything. 0161 took the first four. These are the rest of the ones with a
-- governed table behind them and no writer: Create project, New RFQ, Purchase
-- order, Report incident, Toolbox talk, and Pay application.
--
-- Every one of these tables has existed since 0007, 0017 or 0021, fully
-- governed — a purchase order's invoiced amount is derived and cannot be typed
-- (0046), a pay application locks when it is certified (0017), an awarded RFQ
-- must name the vendor and the reason it won — and not one of them had a way in.
--
-- The four rules, the same as 0157 and 0161:
--
--   * **The company is verified, never trusted.** Where there is a parent row
--     to read it off — a project for a pay application — it is read off that.
--   * **The permission is the one the table's own policy already chose**:
--     `projects.write`, `procurement.write`, `safety.write`, `finance.write`.
--   * **Numbers are generated here**, because each of these is unique per
--     company and two people clicking at once would collide on the index.
--   * **Nothing starts in the state that ends its workflow.** A purchase order
--     and an RFQ start `draft` because issuing one is what commits the company;
--     an incident starts with its investigation `open`; a pay application
--     starts uncertified, because certifying is what locks it.
--
-- One thing is deliberately not here. `create_project` exists for work that
-- never had an estimate — time and materials, a call-out, an emergency repair.
-- Awarding an estimate remains the ordinary path and still goes through
-- `award_estimate_version`, which copies the priced lines onto the project as
-- budgeted activities. A project made here has no budget, and says so by having
-- one of zero rather than by pretending.
--
-- Entity and Workflow: the records a contractor opens during a job.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numbers that do not collide
-- -----------------------------------------------------------------------------

/** PRJ-2026-0001. Per company and per year, which is how a job is referred to. */
create or replace function app.next_project_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'PRJ-' || to_char(current_date, 'YYYY') || '-'
         || lpad((coalesce(max(substring(p.number from '^PRJ-\d{4}-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from projects p
  where p.company_id = p_company
    and p.number ~ ('^PRJ-' || to_char(current_date, 'YYYY') || '-\d+$');
$$;

comment on function app.next_project_number(uuid) is
  'The next unused PRJ-YYYY-0000 for one company this year. ENTITY support: projects is unique on (company_id, number).';

/** PO-0001 for this company. */
create or replace function app.next_purchase_order_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'PO-' || lpad((coalesce(max(substring(o.number from '^PO-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from purchase_orders o
  where o.company_id = p_company and o.number ~ '^PO-\d+$';
$$;

comment on function app.next_purchase_order_number(uuid) is
  'The next unused PO-0000 for one company. ENTITY support: purchase_orders is unique on (company_id, number).';

/** RFQ-0001 for this company. */
create or replace function app.next_rfq_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'RFQ-' || lpad((coalesce(max(substring(r.number from '^RFQ-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from rfqs r
  where r.company_id = p_company and r.number ~ '^RFQ-\d+$';
$$;

comment on function app.next_rfq_number(uuid) is
  'The next unused RFQ-0000 for one company. ENTITY support: rfqs is unique on (company_id, number).';

/** INC-0001 for this company. */
create or replace function app.next_incident_number(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'INC-' || lpad((coalesce(max(substring(i.number from '^INC-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from safety_incidents i
  where i.company_id = p_company and i.number ~ '^INC-\d+$';
$$;

comment on function app.next_incident_number(uuid) is
  'The next unused INC-0000 for one company. ENTITY support: safety_incidents is unique on (company_id, number).';

-- -----------------------------------------------------------------------------
-- A job that never had an estimate
-- -----------------------------------------------------------------------------

/**
 * Open a project directly.
 *
 * The ordinary way a project begins is by awarding an estimate, which copies
 * every priced line onto it as a budgeted activity. This is the other way: work
 * that arrives without a bid. Its budget is zero because nothing has priced it,
 * which is the honest figure — a project claiming a budget nobody estimated
 * would make every variance report wrong from its first day.
 */
create or replace function app.create_project(
  p_company uuid,
  p_name text,
  p_customer_id uuid default null,
  p_site_address text default null,
  p_site_city text default null,
  p_site_state text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'projects.write');
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A project needs a name' using errcode = 'check_violation';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from customers where id = p_customer_id and company_id = v_company) then
    raise exception 'That customer is not one of yours' using errcode = 'no_data_found';
  end if;

  insert into projects (
    company_id, customer_id, number, name, status,
    site_address, site_city, site_state, created_by)
  values (
    v_company, p_customer_id,
    app.next_project_number(v_company),
    v_name, 'preconstruction',
    nullif(trim(coalesce(p_site_address, '')), ''),
    nullif(trim(coalesce(p_site_city, '')), ''),
    nullif(trim(coalesce(p_site_state, '')), ''),
    auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_project(uuid, text, uuid, text, text, text) is
  'Opens a project for work that never had an estimate, with no budget. ENTITY: awarding an estimate remains the ordinary path and carries the priced lines across.';

-- -----------------------------------------------------------------------------
-- Buying something
-- -----------------------------------------------------------------------------

/**
 * Raise a purchase order, in draft.
 *
 * Draft because issuing a purchase order is what commits the company to the
 * money — `committed_amount` is what makes an overrun visible before an invoice
 * arrives — and a document created already issued could never be checked first.
 * The amounts start at zero for the same reason: they come from the lines
 * somebody adds, and a total typed here would be a number nobody can reproduce.
 */
create or replace function app.create_purchase_order(
  p_company uuid,
  p_vendor uuid,
  p_title text,
  p_po_type text default 'material',
  p_project_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'procurement.write');
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
  v_id      uuid;
begin
  if v_title is null then
    raise exception 'A purchase order needs a title saying what it is for'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from vendors where id = p_vendor and company_id = v_company) then
    raise exception 'That vendor is not one of yours' using errcode = 'no_data_found';
  end if;
  if p_project_id is not null and not exists (
    select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'That project is not one of yours' using errcode = 'no_data_found';
  end if;

  insert into purchase_orders (
    company_id, vendor_id, project_id, number, title, po_type, status)
  values (
    v_company, p_vendor, p_project_id,
    app.next_purchase_order_number(v_company),
    v_title,
    coalesce(nullif(trim(coalesce(p_po_type, '')), ''), 'material'),
    'draft')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_purchase_order(uuid, uuid, text, text, uuid) is
  'Raises a purchase order in draft with no committed amount. WORKFLOW: issuing it is what commits the money, and that is a separate decision.';

-- -----------------------------------------------------------------------------
-- Asking several vendors for a price
-- -----------------------------------------------------------------------------

/**
 * Start an RFQ, in draft.
 *
 * Draft because issuing it is what puts the company's name in front of a
 * vendor. The award fields are untouched: 0017 refuses to mark an RFQ awarded
 * without naming both the vendor and the reason it won, which is the rule that
 * makes a bid comparison auditable rather than a recollection.
 */
create or replace function app.create_rfq(
  p_company uuid,
  p_title text,
  p_due_at timestamptz default null,
  p_project_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'procurement.write');
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
  v_id      uuid;
begin
  if v_title is null then
    raise exception 'An RFQ needs a title saying what is being quoted'
      using errcode = 'check_violation';
  end if;
  if p_project_id is not null and not exists (
    select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'That project is not one of yours' using errcode = 'no_data_found';
  end if;

  insert into rfqs (company_id, project_id, number, title, due_at, status)
  values (
    v_company, p_project_id,
    app.next_rfq_number(v_company),
    v_title, p_due_at, 'draft')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_rfq(uuid, text, timestamptz, uuid) is
  'Starts a request for quotation in draft. WORKFLOW: awarding one must name the vendor and the reason, which is what makes a comparison auditable.';

-- -----------------------------------------------------------------------------
-- Something that happened on site
-- -----------------------------------------------------------------------------

/**
 * Record a safety incident.
 *
 * The investigation starts open, and OSHA recordability is left at its default
 * rather than inferred from the type. Whether a medical-treatment case is
 * recordable is a determination a person makes against the rule, and a function
 * that decided it from an enum would be inventing a regulatory finding.
 *
 * The time it happened is required and may not be in the future: an incident
 * report is evidence, and 0021 treats it as such.
 */
create or replace function app.create_safety_incident(
  p_company uuid,
  p_occurred_at timestamptz,
  p_incident_type text,
  p_description text,
  p_severity text default 'low',
  p_project_id uuid default null,
  p_location text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company     uuid := app.company_for_write(p_company, 'safety.write');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_id          uuid;
begin
  if v_description is null then
    raise exception 'An incident report needs a description of what happened'
      using errcode = 'check_violation';
  end if;
  if p_occurred_at is null then
    raise exception 'An incident report needs the time it happened'
      using errcode = 'check_violation';
  end if;
  if p_occurred_at > now() then
    raise exception 'An incident report records something that has happened'
      using errcode = 'check_violation';
  end if;
  if p_project_id is not null and not exists (
    select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'That project is not one of yours' using errcode = 'no_data_found';
  end if;

  insert into safety_incidents (
    company_id, project_id, number, occurred_at, incident_type,
    severity, description, location, investigation_state)
  values (
    v_company, p_project_id,
    app.next_incident_number(v_company),
    p_occurred_at, p_incident_type,
    coalesce(nullif(trim(coalesce(p_severity, '')), ''), 'low'),
    v_description,
    nullif(trim(coalesce(p_location, '')), ''),
    'open')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_safety_incident(uuid, timestamptz, text, text, text, uuid, text) is
  'Records an incident with its investigation open. WORKFLOW: OSHA recordability is a determination a person makes, never inferred from the type.';

-- -----------------------------------------------------------------------------
-- The talk before the shift
-- -----------------------------------------------------------------------------

/**
 * Record a toolbox talk.
 *
 * The attendee count is the point of the record — a talk nobody attended is a
 * document rather than a briefing — so it is taken here rather than left to be
 * filled in later, and it may not be negative.
 */
create or replace function app.create_toolbox_talk(
  p_company uuid,
  p_held_on date,
  p_topic text,
  p_attendee_count int default 0,
  p_project_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'safety.write');
  v_topic   text := nullif(trim(coalesce(p_topic, '')), '');
  v_id      uuid;
begin
  if v_topic is null then
    raise exception 'A toolbox talk needs a topic' using errcode = 'check_violation';
  end if;
  if coalesce(p_held_on, current_date) > current_date then
    raise exception 'A toolbox talk records a briefing that has happened'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_attendee_count, 0) < 0 then
    raise exception 'Attendance cannot be negative' using errcode = 'check_violation';
  end if;
  if p_project_id is not null and not exists (
    select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'That project is not one of yours' using errcode = 'no_data_found';
  end if;

  insert into toolbox_talks (company_id, project_id, held_on, topic, attendee_count)
  values (v_company, p_project_id, coalesce(p_held_on, current_date),
          v_topic, coalesce(p_attendee_count, 0))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_toolbox_talk(uuid, date, text, int, uuid) is
  'Records a toolbox talk and who was at it. ENTITY: attendance is the point of the record, so it is taken at the time.';

-- -----------------------------------------------------------------------------
-- Asking to be paid
-- -----------------------------------------------------------------------------

/**
 * Open the next pay application on a project.
 *
 * The company is read off the project, and the contract sum is read off it too
 * rather than taken from the caller — that figure is what the whole application
 * is measured against, and a browser that could name it could ask to be paid
 * against a contract that does not exist.
 *
 * It starts uncertified. Certifying is what locks it (0017), and an application
 * created already certified could never be filled in.
 */
create or replace function app.create_pay_application(
  p_project uuid,
  p_period_start date,
  p_period_end date)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'finance.write');
  v_next    int;
  v_sum     numeric(18,2);
  v_retain  numeric(6,4);
  v_id      uuid;
begin
  if p_period_start is null or p_period_end is null then
    raise exception 'A pay application covers a period, so it needs both dates'
      using errcode = 'check_violation';
  end if;
  if p_period_end < p_period_start then
    raise exception 'A period cannot end before it starts' using errcode = 'check_violation';
  end if;

  select coalesce(max(application_number), 0) + 1 into v_next
  from pay_applications where project_id = p_project;

  select coalesce(contract_value, 0), coalesce(retainage_percent, 0.05)
    into v_sum, v_retain
  from projects where id = p_project;

  insert into pay_applications (
    company_id, project_id, application_number, period_start, period_end,
    contract_sum, retainage_percent)
  values (v_company, p_project, v_next, p_period_start, p_period_end, v_sum, v_retain)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_pay_application(uuid, date, date) is
  'Opens the next pay application on a project, uncertified. WORKFLOW: certifying is what locks it, and the contract sum is read off the project rather than taken from the caller.';


-- -----------------------------------------------------------------------------
-- A material and a vendor you can add
-- -----------------------------------------------------------------------------

/**
 * The next unused V-0001 for this company.
 *
 * The same shape and the same reasoning as `app.next_company_material_code` in
 * 0127: vendors is unique on (company_id, code), so a screen must not pick one.
 */
create or replace function app.next_company_vendor_code(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'V-' || lpad((coalesce(max(substring(v.code from '^V-(\d+)$')::int), 0) + 1)::text, 4, '0')
  from vendors v
  where v.company_id = p_company and v.code ~ '^V-\d+$';
$$;

comment on function app.next_company_vendor_code(uuid) is
  'The next unused V-0000 for one company. LIBRARY support: vendors is unique on (company_id, code).';

/**
 * Add a material to the company's own library.
 *
 * `createMaterial` has existed in the data layer since the price-list import
 * was built, stamping `source = 'Added in the library screen'` — for a screen
 * that was never built. This is that screen's writer, and it generates the code
 * rather than letting a browser pick one, because two people adding a material
 * at the same moment would otherwise collide on the index.
 *
 * A waste factor must state its basis. The database says so, and saying it here
 * makes the refusal about the material rather than about a constraint name.
 */
create or replace function app.create_material(
  p_company uuid,
  p_name text,
  p_unit text default 'EA',
  p_unit_cost numeric default 0,
  p_category text default null,
  p_default_waste_percent numeric default 0,
  p_waste_basis text default null,
  p_specification text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_waste   numeric := coalesce(p_default_waste_percent, 0);
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A material needs a name' using errcode = 'check_violation';
  end if;
  if v_waste < 0 or v_waste > 1 then
    raise exception 'Waste is a fraction between 0 and 1' using errcode = 'check_violation';
  end if;
  if v_waste > 0 and nullif(trim(coalesce(p_waste_basis, '')), '') is null then
    raise exception 'A waste factor has to say what it is based on'
      using errcode = 'check_violation',
            hint = 'Say where the allowance comes from, so somebody can check it later.';
  end if;

  /*
   * The person adding it is the person approving it.
   *
   * Migration 0028 refuses a live company library row that does not name who
   * made it live, and refuses half an approval — both columns or neither. That
   * rule is right and it is why this cannot be a plain insert from a browser:
   * adding a material to your own library *is* the act of approving it for use,
   * and the record has to say who did it and when.
   */
  insert into materials (
    company_id, code, name, category, unit, unit_cost,
    default_waste_percent, waste_basis, specification, origin, source,
    approved_by, approved_at)
  values (
    v_company,
    app.next_company_material_code(v_company),
    v_name,
    nullif(trim(coalesce(p_category, '')), ''),
    p_unit::app.unit_code,
    coalesce(p_unit_cost, 0),
    v_waste,
    case when v_waste > 0 then trim(p_waste_basis) else null end,
    nullif(trim(coalesce(p_specification, '')), ''),
    'company',
    'Added in the library screen',
    auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_material(uuid, text, text, numeric, text, numeric, text, text) is
  'Adds a material to the company library, numbered per company. LIBRARY: a waste factor must state its basis, which is the rule rather than this function''s opinion.';

/**
 * Add a vendor.
 *
 * Qualification is left false. Whether a vendor is qualified to work for this
 * company is a decision somebody makes about insurance, safety record and
 * performance — a form that set it true on creation would be asserting a
 * finding nobody made.
 */
create or replace function app.create_vendor(
  p_company uuid,
  p_name text,
  p_vendor_type text default 'supplier',
  p_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_city text default null,
  p_state_province text default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'libraries.write');
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_id      uuid;
begin
  if v_name is null then
    raise exception 'A vendor needs a name' using errcode = 'check_violation';
  end if;

  insert into vendors (
    company_id, code, name, vendor_type, contact_name, email, phone,
    city, state_province, is_qualified)
  values (
    v_company,
    app.next_company_vendor_code(v_company),
    v_name,
    coalesce(nullif(trim(coalesce(p_vendor_type, '')), ''), 'supplier'),
    nullif(trim(coalesce(p_contact_name, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_state_province, '')), ''),
    false)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.create_vendor(uuid, text, text, text, text, text, text, text) is
  'Adds a vendor, unqualified. LIBRARY: qualification is a finding about insurance and performance, never set by the form that creates the row.';


/**
 * Submit a pay application.
 *
 * Leaving draft is what freezes it. `app.enforce_pay_application_lock` lets
 * everything change while the status is `draft` and almost nothing afterwards
 * — and `submitted_at` is not among the columns it keeps mutable, so the time
 * has to be stamped in the same statement that changes the status. One update,
 * for that reason and not for tidiness.
 *
 * Nothing else is touched. What was completed, what is stored and what is held
 * as retainage are the claim being made, and a function that adjusted them on
 * the way out would be submitting something other than what was reviewed.
 */
create or replace function app.submit_pay_application(p_application uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_status  text;
begin
  select project_id, status into v_project, v_status
  from pay_applications where id = p_application;
  if v_project is null then
    raise exception 'No such application' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_project, 'finance.write');

  if v_status <> 'draft' then
    raise exception 'This application was already submitted'
      using errcode = 'restrict_violation',
            hint = 'A submitted application is evidence; open the next one instead.';
  end if;

  update pay_applications
     set status = 'submitted', submitted_at = now(), updated_at = now()
   where id = p_application;
end;
$$;

comment on function app.submit_pay_application(uuid) is
  'Submits a draft pay application, stamping the time in the same statement. WORKFLOW: leaving draft is what freezes the record, so the stamp cannot be a second update.';

-- -----------------------------------------------------------------------------
-- The doors a browser uses
-- -----------------------------------------------------------------------------

create or replace function public.create_project(
  p_company uuid, p_name text, p_customer_id uuid default null,
  p_site_address text default null, p_site_city text default null,
  p_site_state text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_project(p_company, p_name, p_customer_id,
                                p_site_address, p_site_city, p_site_state); $$;

create or replace function public.create_purchase_order(
  p_company uuid, p_vendor uuid, p_title text,
  p_po_type text default 'material', p_project_id uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_purchase_order(p_company, p_vendor, p_title, p_po_type, p_project_id); $$;

create or replace function public.create_rfq(
  p_company uuid, p_title text, p_due_at timestamptz default null,
  p_project_id uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_rfq(p_company, p_title, p_due_at, p_project_id); $$;

create or replace function public.create_safety_incident(
  p_company uuid, p_occurred_at timestamptz, p_incident_type text, p_description text,
  p_severity text default 'low', p_project_id uuid default null,
  p_location text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_safety_incident(p_company, p_occurred_at, p_incident_type,
                                        p_description, p_severity, p_project_id, p_location); $$;

create or replace function public.create_toolbox_talk(
  p_company uuid, p_held_on date, p_topic text,
  p_attendee_count int default 0, p_project_id uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_toolbox_talk(p_company, p_held_on, p_topic,
                                     p_attendee_count, p_project_id); $$;

create or replace function public.create_pay_application(
  p_project uuid, p_period_start date, p_period_end date)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_pay_application(p_project, p_period_start, p_period_end); $$;

create or replace function public.create_material(
  p_company uuid, p_name text, p_unit text default 'EA', p_unit_cost numeric default 0,
  p_category text default null, p_default_waste_percent numeric default 0,
  p_waste_basis text default null, p_specification text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_material(p_company, p_name, p_unit, p_unit_cost, p_category,
                                 p_default_waste_percent, p_waste_basis, p_specification); $$;

create or replace function public.create_vendor(
  p_company uuid, p_name text, p_vendor_type text default 'supplier',
  p_contact_name text default null, p_email text default null, p_phone text default null,
  p_city text default null, p_state_province text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_vendor(p_company, p_name, p_vendor_type, p_contact_name,
                               p_email, p_phone, p_city, p_state_province); $$;

create or replace function public.submit_pay_application(p_application uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.submit_pay_application(p_application); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'app.next_company_vendor_code(uuid)',
    'app.create_material(uuid, text, text, numeric, text, numeric, text, text)',
    'app.create_vendor(uuid, text, text, text, text, text, text, text)',
    'public.create_material(uuid, text, text, numeric, text, numeric, text, text)',
    'public.create_vendor(uuid, text, text, text, text, text, text, text)',
    'app.submit_pay_application(uuid)',
    'public.submit_pay_application(uuid)',
    'app.next_project_number(uuid)',
    'app.next_purchase_order_number(uuid)',
    'app.next_rfq_number(uuid)',
    'app.next_incident_number(uuid)',
    'app.create_project(uuid, text, uuid, text, text, text)',
    'app.create_purchase_order(uuid, uuid, text, text, uuid)',
    'app.create_rfq(uuid, text, timestamptz, uuid)',
    'app.create_safety_incident(uuid, timestamptz, text, text, text, uuid, text)',
    'app.create_toolbox_talk(uuid, date, text, int, uuid)',
    'app.create_pay_application(uuid, date, date)',
    'public.create_project(uuid, text, uuid, text, text, text)',
    'public.create_purchase_order(uuid, uuid, text, text, uuid)',
    'public.create_rfq(uuid, text, timestamptz, uuid)',
    'public.create_safety_incident(uuid, timestamptz, text, text, text, uuid, text)',
    'public.create_toolbox_talk(uuid, date, text, int, uuid)',
    'public.create_pay_application(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;

select app.assert_security_gates();

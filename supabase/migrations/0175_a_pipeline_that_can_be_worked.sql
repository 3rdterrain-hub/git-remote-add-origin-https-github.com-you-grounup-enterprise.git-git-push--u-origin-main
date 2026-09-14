/**
 * A pipeline that can be worked, and somebody to call.
 *
 * Three tables from migration 0005, each fully modeled and each unreachable.
 *
 * **`opportunities`** has eight stages in a check constraint — identified,
 * qualifying, estimating, proposed, negotiating, won, lost, abandoned — a
 * probability, a bid due date, an expected award date, an owner, a loss reason
 * and a winning competitor. It has exactly one writer in the whole system:
 * `convert_lead`, which inserts it at `identified`. Nothing can move a stage.
 * So every opportunity ever created has sat in the stage it was born in, the
 * CRM's win-rate tile can only ever read zero, and the loss-reason line under
 * it can never render. A pipeline that cannot be worked is a list.
 *
 * **`contacts`** has a customer-or-vendor constraint, a partial unique index
 * enforcing one primary per customer, and indexes for both owners. Zero
 * readers, zero writers. The plan blurb sells "Customers, contacts and the lead
 * intake form".
 *
 * **`crm_activities`** has eight activity types, a due date, an assignee, a
 * completion, and an index on `(company_id, due_at) where completed_at is null`
 * — an index built to answer "what is due next" for a list that was never
 * built. One writer (`convert_lead` logs the conversion), no readers.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- Working the pipeline
-- -----------------------------------------------------------------------------

/**
 * Move an opportunity to a stage.
 *
 * Won and lost are not just stages: they stamp `won_at` / `lost_at`, and lost
 * requires a reason. "We lost it" with no reason recorded is the single most
 * expensive omission in a contractor's CRM — it is the only data that ever
 * answers whether the number was wrong or the relationship was.
 *
 * Every move writes an activity, because a stage with no history is a stage
 * nobody can account for at the end of the quarter.
 */
create or replace function app.move_opportunity_stage(
  p_opportunity uuid,
  p_stage       text,
  p_reason      text default null,
  p_competitor  text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_o      opportunities%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_o from opportunities where id = p_opportunity;
  if v_o.id is null then
    raise exception 'No such opportunity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_o.company_id, 'crm.write') then
    raise exception 'You do not have permission to change this opportunity'
      using errcode = 'insufficient_privilege';
  end if;
  if p_stage not in ('identified','qualifying','estimating','proposed',
                     'negotiating','won','lost','abandoned') then
    raise exception 'Unknown stage %', p_stage using errcode = 'check_violation';
  end if;
  if p_stage = v_o.stage then
    return;
  end if;
  if p_stage = 'lost' and v_reason is null then
    raise exception 'Say why it was lost'
      using errcode = 'check_violation',
            hint = 'A loss with no reason is the one number that never gets better.';
  end if;

  update opportunities
     set stage      = p_stage,
         won_at     = case when p_stage = 'won'  then coalesce(won_at, now())  else null end,
         lost_at    = case when p_stage = 'lost' then coalesce(lost_at, now()) else null end,
         loss_reason = case when p_stage = 'lost' then v_reason else null end,
         winning_competitor = case when p_stage = 'lost'
                                   then nullif(btrim(coalesce(p_competitor, '')), '')
                                   else null end,
         /* Won is certain and abandoned is over. Otherwise leave the estimate alone. */
         probability = case when p_stage = 'won' then 1
                            when p_stage in ('lost','abandoned') then 0
                            else probability end,
         updated_at = now()
   where id = p_opportunity;

  insert into crm_activities (
    company_id, customer_id, opportunity_id, activity_type, subject, body,
    completed_at, created_by)
  values (
    v_o.company_id, v_o.customer_id, v_o.id, 'note',
    format('Moved from %s to %s', v_o.stage, p_stage),
    case when p_stage = 'lost'
         then v_reason || coalesce(' Lost to ' || nullif(btrim(coalesce(p_competitor,'')),'') || '.', '')
         else v_reason end,
    now(), auth.uid());
end;
$$;

comment on function app.move_opportunity_stage(uuid, text, text, text) is
  'Moves an opportunity through the eight stages 0005 defined and nothing could reach, stamping won/lost and refusing a loss with no reason. WORKFLOW.';

/**
 * Change what is known about an opportunity.
 *
 * Null leaves a field alone, the same rule as `identify_sheet`: a form sends
 * what it touched. The stage is deliberately not here — moving a stage has
 * consequences and belongs in the function that knows them.
 */
create or replace function app.update_opportunity(
  p_opportunity     uuid,
  p_name            text default null,
  p_description     text default null,
  p_estimated_value numeric default null,
  p_probability     numeric default null,
  p_bid_due_at      timestamptz default null,
  p_expected_award_at date default null,
  p_expected_start_at date default null,
  p_owner           uuid default null,
  p_delivery_method text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from opportunities where id = p_opportunity;
  if v_company is null then
    raise exception 'No such opportunity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to change this opportunity'
      using errcode = 'insufficient_privilege';
  end if;
  if p_probability is not null and (p_probability < 0 or p_probability > 1) then
    raise exception 'A probability is between 0 and 1, not %', p_probability
      using errcode = 'check_violation';
  end if;
  if p_estimated_value is not null and p_estimated_value < 0 then
    raise exception 'An estimated value cannot be negative' using errcode = 'check_violation';
  end if;

  update opportunities
     set name            = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         description     = coalesce(p_description, description),
         estimated_value = coalesce(p_estimated_value, estimated_value),
         probability     = coalesce(p_probability, probability),
         bid_due_at      = coalesce(p_bid_due_at, bid_due_at),
         expected_award_at = coalesce(p_expected_award_at, expected_award_at),
         expected_start_at = coalesce(p_expected_start_at, expected_start_at),
         owner_user_id   = coalesce(p_owner, owner_user_id),
         delivery_method = coalesce(nullif(btrim(coalesce(p_delivery_method,'')),''),
                                    delivery_method),
         updated_at = now()
   where id = p_opportunity;
end;
$$;

comment on function app.update_opportunity(uuid, text, text, numeric, numeric, timestamptz, date, date, uuid, text) is
  'Changes what is known about an opportunity. Null leaves a field alone. The stage is not here — moving one has consequences. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Somebody to call
-- -----------------------------------------------------------------------------

/**
 * Add or change a contact.
 *
 * A contact belongs to a customer or to a vendor and never to both — the table
 * says so in a check constraint — so this takes one of the two and refuses
 * neither. That is why it serves Procurement as well as this section: a vendor
 * has a dispatcher and a salesman the same way a customer has a project manager
 * and an accounts payable clerk.
 *
 * `is_primary` is enforced by a partial unique index on the table. Rather than
 * letting that surface as a constraint violation, the previous primary is
 * stood down in the same statement — one person is the one you call, and
 * saying so about a second is how you name the new one.
 */
create or replace function app.save_contact(
  p_contact    uuid default null,
  p_customer   uuid default null,
  p_vendor     uuid default null,
  p_first_name text default null,
  p_last_name  text default null,
  p_title      text default null,
  p_email      text default null,
  p_phone      text default null,
  p_mobile     text default null,
  p_role       text default null,
  p_notes      text default null,
  p_is_primary boolean default false)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_id      uuid := p_contact;
  v_cust    uuid := p_customer;
  v_vend    uuid := p_vendor;
begin
  if v_id is not null then
    select company_id, customer_id, vendor_id into v_company, v_cust, v_vend
      from contacts where id = v_id;
    if v_company is null then
      raise exception 'No such contact' using errcode = 'no_data_found';
    end if;
  else
    if num_nonnulls(v_cust, v_vend) <> 1 then
      raise exception 'A contact belongs to a customer or to a vendor, not to both and not to neither'
        using errcode = 'check_violation';
    end if;
    if v_cust is not null then
      select company_id into v_company from customers where id = v_cust;
    else
      select company_id into v_company from vendors where id = v_vend;
    end if;
    if v_company is null then
      raise exception 'No such customer or vendor' using errcode = 'no_data_found';
    end if;
  end if;

  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to change contacts'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * Stand the previous primary down *before* writing, not after. The partial
   * unique index fires on the insert itself, so doing it afterwards means the
   * database refuses the new primary and the tidy-up never runs.
   */
  if coalesce(p_is_primary, false) and v_cust is not null then
    update contacts set is_primary = false, updated_at = now()
     where customer_id = v_cust
       and is_primary
       and (v_id is null or id <> v_id);
  end if;

  if v_id is null then
    if coalesce(btrim(coalesce(p_first_name,'')),'') = ''
       or coalesce(btrim(coalesce(p_last_name,'')),'') = '' then
      raise exception 'A contact needs a first and last name'
        using errcode = 'check_violation';
    end if;
    insert into contacts (
      company_id, customer_id, vendor_id, first_name, last_name, title,
      email, phone, mobile, role, notes, is_primary)
    values (
      v_company, v_cust, v_vend, btrim(p_first_name), btrim(p_last_name),
      nullif(btrim(coalesce(p_title,'')),''), nullif(btrim(coalesce(p_email,'')),''),
      nullif(btrim(coalesce(p_phone,'')),''), nullif(btrim(coalesce(p_mobile,'')),''),
      nullif(btrim(coalesce(p_role,'')),''), nullif(btrim(coalesce(p_notes,'')),''),
      coalesce(p_is_primary, false))
    returning id into v_id;
  else
    update contacts
       set first_name = coalesce(nullif(btrim(coalesce(p_first_name,'')),''), first_name),
           last_name  = coalesce(nullif(btrim(coalesce(p_last_name,'')),''), last_name),
           title  = coalesce(p_title, title),
           email  = coalesce(p_email, email),
           phone  = coalesce(p_phone, phone),
           mobile = coalesce(p_mobile, mobile),
           role   = coalesce(p_role, role),
           notes  = coalesce(p_notes, notes),
           is_primary = coalesce(p_is_primary, is_primary),
           updated_at = now()
     where id = v_id;
  end if;

  return v_id;
end;
$$;

comment on function app.save_contact(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean) is
  'Adds or changes a contact on a customer or a vendor, standing the previous primary down rather than letting the unique index refuse the new one. ENTITY.';

/** Retire a contact. Kept, not deleted: they answered the phone for two years. */
create or replace function app.retire_contact(p_contact uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from contacts where id = p_contact;
  if v_company is null then
    raise exception 'No such contact' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to change contacts'
      using errcode = 'insufficient_privilege';
  end if;
  update contacts
     set status = 'archived', is_primary = false, updated_at = now()
   where id = p_contact;
end;
$$;

comment on function app.retire_contact(uuid) is
  'Archives a contact rather than deleting them, so the history of who was called keeps its names. ENTITY.';

-- -----------------------------------------------------------------------------
-- What was said, and what is due
-- -----------------------------------------------------------------------------

/**
 * Log something that happened, or something that has to.
 *
 * Both, because they are the same record seen from either side of a date: a
 * call made is `completed_at`, a call to make is `due_at`. The table has had an
 * index on `(company_id, due_at) where completed_at is null` since 0005 — an
 * index built to answer "what is due next" for a list nobody ever wrote.
 */
create or replace function app.log_crm_activity(
  p_activity_type text,
  p_subject       text,
  p_body          text default null,
  p_customer      uuid default null,
  p_opportunity   uuid default null,
  p_lead          uuid default null,
  p_due_at        timestamptz default null,
  p_completed     boolean default true,
  p_assigned_to   uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_cust    uuid := p_customer;
  v_id      uuid;
begin
  if num_nonnulls(p_customer, p_opportunity, p_lead) = 0 then
    raise exception 'Say who this is about'
      using errcode = 'check_violation',
            hint = 'An activity belongs to a customer, an opportunity or a lead.';
  end if;
  if p_activity_type not in ('call','email','meeting','site_visit','note','task',
                             'proposal_sent','follow_up') then
    raise exception 'Unknown activity type %', p_activity_type
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(coalesce(p_subject,'')),'') = '' then
    raise exception 'Say what it was about' using errcode = 'check_violation';
  end if;

  /*
   * The company comes from whichever subject was given, never from the caller's
   * membership — that is the difference between logging a call on your own
   * customer and logging one on somebody else's.
   */
  if p_opportunity is not null then
    select company_id, customer_id into v_company, v_cust
      from opportunities where id = p_opportunity;
  elsif p_customer is not null then
    select company_id into v_company from customers where id = p_customer;
  else
    select company_id into v_company from leads where id = p_lead;
  end if;
  if v_company is null then
    raise exception 'No such customer, opportunity or lead' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to log activity here'
      using errcode = 'insufficient_privilege';
  end if;

  insert into crm_activities (
    company_id, customer_id, opportunity_id, lead_id, activity_type, subject, body,
    due_at, completed_at, assigned_to, created_by)
  values (
    v_company, coalesce(v_cust, p_customer), p_opportunity, p_lead,
    p_activity_type, btrim(p_subject), nullif(btrim(coalesce(p_body,'')),''),
    p_due_at,
    case when coalesce(p_completed, true) then now() else null end,
    coalesce(p_assigned_to, auth.uid()), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.log_crm_activity(text, text, text, uuid, uuid, uuid, timestamptz, boolean, uuid) is
  'Records a call, an email, a meeting, a site visit, a note or something still to do. The only writer of crm_activities besides convert_lead. WORKFLOW.';

/** Tick one off. */
create or replace function app.complete_crm_activity(p_activity uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid;
begin
  select company_id into v_company from crm_activities where id = p_activity;
  if v_company is null then
    raise exception 'No such activity' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'crm.write') then
    raise exception 'You do not have permission to change this activity'
      using errcode = 'insufficient_privilege';
  end if;
  update crm_activities
     set completed_at = coalesce(completed_at, now()), updated_at = now()
   where id = p_activity;
end;
$$;

comment on function app.complete_crm_activity(uuid) is
  'Marks a follow-up done. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------

/** Everyone worth calling, on a customer or a vendor. */
create or replace view my_contacts as
select c.id, c.company_id, c.customer_id, c.vendor_id,
       c.first_name, c.last_name,
       c.first_name || ' ' || c.last_name as full_name,
       c.title, c.email, c.phone, c.mobile, c.role, c.notes,
       c.is_primary, c.status, c.created_at,
       cu.name as customer_name,
       v.name  as vendor_name
  from contacts c
  left join customers cu on cu.id = c.customer_id
  left join vendors v on v.id = c.vendor_id
 where c.status <> 'archived';

revoke all on my_contacts from public, anon;
grant select on my_contacts to authenticated;
alter view my_contacts set (security_invoker = on);

comment on view my_contacts is
  'The people at a customer or a vendor. The table has existed since 0005 and was read by nothing.';

/**
 * The pipeline, with what is owed on each one.
 *
 * `days_in_stage` is computed rather than stored — an opportunity that has sat
 * in "proposed" for six weeks is the thing a pipeline review is looking for,
 * and it is a function of two dates rather than a column somebody maintains.
 */
create or replace view my_pipeline as
select o.id, o.company_id, o.customer_id, o.number, o.name, o.description,
       o.stage, o.estimated_value, o.probability,
       o.estimated_value * coalesce(o.probability, 0) as weighted_value,
       o.bid_due_at, o.expected_award_at, o.expected_start_at,
       o.site_city, o.site_state, o.delivery_method,
       o.owner_user_id, o.won_at, o.lost_at, o.loss_reason, o.winning_competitor,
       o.created_at, o.updated_at,
       cu.name as customer_name,
       greatest(0, extract(day from now() - o.updated_at))::int as days_in_stage,
       (o.stage in ('won','lost','abandoned')) as is_closed,
       (select count(*) from crm_activities a
         where a.opportunity_id = o.id and a.completed_at is null) as open_activities,
       (select min(a.due_at) from crm_activities a
         where a.opportunity_id = o.id and a.completed_at is null) as next_due_at
  from opportunities o
  join customers cu on cu.id = o.customer_id;

revoke all on my_pipeline from public, anon;
grant select on my_pipeline to authenticated;
alter view my_pipeline set (security_invoker = on);

comment on view my_pipeline is
  'Opportunities with weighted value, days in stage and what is owed on each. Every stage but the first was unreachable before 0174.';

/** What is owed, soonest first. The list the 0005 index was built for. */
create or replace view my_crm_activities as
select a.id, a.company_id, a.customer_id, a.opportunity_id, a.lead_id,
       a.activity_type, a.subject, a.body, a.due_at, a.completed_at,
       a.assigned_to, a.created_by, a.created_at,
       cu.name as customer_name,
       o.name  as opportunity_name,
       o.number as opportunity_number,
       l.company_name as lead_name,
       (a.completed_at is null and a.due_at is not null and a.due_at < now()) as overdue
  from crm_activities a
  left join customers cu on cu.id = a.customer_id
  left join opportunities o on o.id = a.opportunity_id
  left join leads l on l.id = a.lead_id;

revoke all on my_crm_activities from public, anon;
grant select on my_crm_activities to authenticated;
alter view my_crm_activities set (security_invoker = on);

comment on view my_crm_activities is
  'Calls, emails, meetings, site visits and follow-ups. Written only by convert_lead until 0174, and read by nothing.';

create or replace function public.move_opportunity_stage(
  p_opportunity uuid, p_stage text, p_reason text default null,
  p_competitor text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.move_opportunity_stage(p_opportunity, p_stage, p_reason, p_competitor); $$;

create or replace function public.update_opportunity(
  p_opportunity uuid, p_name text default null, p_description text default null,
  p_estimated_value numeric default null, p_probability numeric default null,
  p_bid_due_at timestamptz default null, p_expected_award_at date default null,
  p_expected_start_at date default null, p_owner uuid default null,
  p_delivery_method text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_opportunity(p_opportunity, p_name, p_description,
       p_estimated_value, p_probability, p_bid_due_at, p_expected_award_at,
       p_expected_start_at, p_owner, p_delivery_method); $$;

create or replace function public.save_contact(
  p_contact uuid default null, p_customer uuid default null, p_vendor uuid default null,
  p_first_name text default null, p_last_name text default null, p_title text default null,
  p_email text default null, p_phone text default null, p_mobile text default null,
  p_role text default null, p_notes text default null, p_is_primary boolean default false)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.save_contact(p_contact, p_customer, p_vendor, p_first_name, p_last_name,
       p_title, p_email, p_phone, p_mobile, p_role, p_notes, p_is_primary); $$;

create or replace function public.retire_contact(p_contact uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.retire_contact(p_contact); $$;

create or replace function public.log_crm_activity(
  p_activity_type text, p_subject text, p_body text default null,
  p_customer uuid default null, p_opportunity uuid default null, p_lead uuid default null,
  p_due_at timestamptz default null, p_completed boolean default true,
  p_assigned_to uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.log_crm_activity(p_activity_type, p_subject, p_body, p_customer,
       p_opportunity, p_lead, p_due_at, p_completed, p_assigned_to); $$;

create or replace function public.complete_crm_activity(p_activity uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.complete_crm_activity(p_activity); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.move_opportunity_stage(uuid, text, text, text)',
    'public.update_opportunity(uuid, text, text, numeric, numeric, timestamptz, date, date, uuid, text)',
    'public.save_contact(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean)',
    'public.retire_contact(uuid)',
    'public.log_crm_activity(text, text, text, uuid, uuid, uuid, timestamptz, boolean, uuid)',
    'public.complete_crm_activity(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.attach_standard_triggers('public.contacts');
select app.attach_standard_triggers('public.crm_activities');
select app.guard_suspension('contacts');
select app.guard_suspension('crm_activities');

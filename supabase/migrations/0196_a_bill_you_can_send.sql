-- =============================================================================
-- 0196 — A bill you can send, and one you can pay
--
-- Finance had one writer: `create_pay_application` (0162) opens a header. That
-- is genuinely all it does, and the consequences run right through the section.
--
--   * **`schedule_of_values` had no writer** (O-020). The schedule of values is
--     the spine of a pay application — the contracted breakdown the billing is
--     measured against — so without it every application was a header against
--     nothing.
--
--   * **`pay_application_lines` had no writer.** An application could be opened
--     and submitted, and there was no way to fill one in. `submit_pay_application`
--     would happily certify a bill for zero dollars.
--
--   * **`ap_invoices` had no writer.** The payables screen reads them; nothing
--     could record a vendor invoice, so `ap_invoices_pay_requires_match` — the
--     control that stops a company paying for goods it never received — had
--     never once been tested against a real invoice.
--
-- The rule this migration is built on, and the reason it is a migration rather
-- than a form: **the figures on a pay application are computed, never typed.**
--
--   `completed_to_date`  = the sum of its lines
--   `stored_materials`   = the sum of its lines
--   `retainage_to_date`  = the sum of its lines' retainage
--   `previous_payments`  = what earlier applications on this project were paid
--   `current_due`        = earned − retainage − previous payments
--
-- and a line's `previous_completed` is read off the previous application rather
-- than carried by hand. Every one of those is a number somebody would otherwise
-- retype from last month's paperwork, and the first one that is retyped wrong
-- is a bill the owner rejects or, worse, pays.
--
-- Recomputed on every change rather than incremented, for the reason 0177, 0179,
-- 0181 and 0191 all found: an increment drifts the first time a line is deleted.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The schedule of values
-- -----------------------------------------------------------------------------

/**
 * Add one billing item to a project's schedule of values.
 *
 * The item number is the owner's reference and stays the caller's to choose —
 * it has to match the paperwork the owner already holds — but it is unique per
 * project and the refusal says so in those terms rather than naming an index.
 */
create or replace function app.add_sov_item(
  p_project uuid,
  p_item_number text,
  p_description text,
  p_scheduled_value numeric,
  p_billing_basis text default 'lump_sum',
  p_quantity numeric default null,
  p_unit text default null,
  p_unit_price numeric default null,
  p_cost_code uuid default null,
  p_source_line uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'finance.write');
  v_num     text := nullif(trim(coalesce(p_item_number, '')), '');
  v_desc    text := nullif(trim(coalesce(p_description, '')), '');
  v_next    int;
  v_id      uuid;
begin
  if v_num is null then
    raise exception 'A billing item needs the number the owner will see'
      using errcode = 'check_violation';
  end if;
  if v_desc is null then
    raise exception 'A billing item needs a description' using errcode = 'check_violation';
  end if;
  if coalesce(p_scheduled_value, 0) < 0 then
    raise exception 'A scheduled value cannot be negative' using errcode = 'check_violation';
  end if;
  if p_billing_basis not in ('lump_sum', 'unit_price') then
    raise exception 'Billing is by lump sum or by unit price' using errcode = 'check_violation';
  end if;
  if p_billing_basis = 'unit_price' and (p_quantity is null or p_unit_price is null) then
    raise exception 'A unit-price item bills quantity times price, so it needs both'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from schedule_of_values
              where project_id = p_project and item_number = v_num) then
    raise exception 'Item % is already on this schedule of values', v_num
      using errcode = 'unique_violation';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
    from schedule_of_values where project_id = p_project;

  insert into schedule_of_values (
    company_id, project_id, source_line_item_id, cost_code_id, item_number,
    description, scheduled_value, billing_basis, quantity, unit, unit_price, sort_order)
  values (v_company, p_project, p_source_line, p_cost_code, v_num, v_desc,
          coalesce(p_scheduled_value, 0), p_billing_basis, p_quantity,
          p_unit::app.unit_code, p_unit_price, v_next)
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Build the schedule of values from the estimate the project was awarded on.
 *
 * The library principle, applied to billing: a number is entered once. The
 * estimate already holds a priced breakdown with the sell price on every line,
 * and retyping it into a schedule of values is how the bill stops agreeing with
 * the bid. `source_line_item_id` exists on this table for exactly this and had
 * never been written.
 *
 * It refuses rather than duplicating when items are already there, because a
 * second pass would bill the job twice.
 */
create or replace function app.build_sov_from_estimate(p_project uuid)
returns int
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.project_company_for_write(p_project, 'finance.write');
  v_version uuid;
  v_n       int := 0;
  v_row     record;
begin
  if exists (select 1 from schedule_of_values where project_id = p_project) then
    raise exception 'This project already has a schedule of values'
      using errcode = 'unique_violation',
            hint = 'Add or change items individually. Rebuilding it would bill the job twice.';
  end if;

  select source_estimate_version_id into v_version from projects where id = p_project;
  if v_version is null then
    raise exception 'This project was not created from an estimate, so there is nothing to build from'
      using errcode = 'no_data_found',
            hint = 'Add the billing items directly.';
  end if;

  for v_row in
    select l.id, l.description, coalesce(l.total_price, 0) as value, l.cost_code_id, l.sort_order
      from estimate_line_items l
     where l.estimate_version_id = v_version
     order by l.sort_order, l.description
  loop
    v_n := v_n + 1;
    insert into schedule_of_values (
      company_id, project_id, source_line_item_id, cost_code_id, item_number,
      description, scheduled_value, billing_basis, sort_order)
    values (v_company, p_project, v_row.id, v_row.cost_code_id,
            lpad(v_n::text, 3, '0'), v_row.description, v_row.value, 'lump_sum', v_n - 1);
  end loop;

  if v_n = 0 then
    raise exception 'That estimate has no lines to bill from' using errcode = 'no_data_found';
  end if;
  return v_n;
end;
$$;

/** Correct a billing item. Refused once anything has been billed against it. */
create or replace function app.update_sov_item(
  p_item uuid,
  p_item_number text default null,
  p_description text default null,
  p_scheduled_value numeric default null,
  p_billing_basis text default null,
  p_quantity numeric default null,
  p_unit text default null,
  p_unit_price numeric default null,
  p_cost_code uuid default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s      schedule_of_values%rowtype;
  v_billed int;
begin
  select * into v_s from schedule_of_values where id = p_item;
  if v_s.id is null then
    raise exception 'No such billing item' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_s.project_id, 'finance.write');

  if coalesce(p_scheduled_value, v_s.scheduled_value) is distinct from v_s.scheduled_value then
    select count(*) into v_billed
      from pay_application_lines l
      join pay_applications a on a.id = l.pay_application_id
     where l.sov_id = p_item and a.status <> 'draft';
    if v_billed > 0 then
      raise exception
        'Item % has been billed on a certified application, so its scheduled value is fixed', v_s.item_number
        using errcode = 'restrict_violation',
              hint = 'A change in scope is a change order, which is what carries approved changes onto the next application.';
    end if;
  end if;

  update schedule_of_values
     set item_number     = coalesce(nullif(trim(coalesce(p_item_number, '')), ''), item_number),
         description     = coalesce(nullif(trim(coalesce(p_description, '')), ''), description),
         scheduled_value = coalesce(p_scheduled_value, scheduled_value),
         billing_basis   = coalesce(p_billing_basis, billing_basis),
         quantity        = coalesce(p_quantity, quantity),
         unit            = coalesce(p_unit::app.unit_code, unit),
         unit_price      = coalesce(p_unit_price, unit_price),
         cost_code_id    = coalesce(p_cost_code, cost_code_id),
         updated_at      = now()
   where id = p_item;
end;
$$;

/** Remove a billing item nothing has been billed against. */
create or replace function app.remove_sov_item(p_item uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s   schedule_of_values%rowtype;
  v_n   int;
begin
  select * into v_s from schedule_of_values where id = p_item;
  if v_s.id is null then
    raise exception 'No such billing item' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_s.project_id, 'finance.write');

  select count(*) into v_n
    from pay_application_lines l
    join pay_applications a on a.id = l.pay_application_id
   where l.sov_id = p_item and a.status <> 'draft';
  if v_n > 0 then
    raise exception 'Item % has been billed on a certified application', v_s.item_number
      using errcode = 'restrict_violation';
  end if;

  delete from pay_application_lines where sov_id = p_item;
  delete from schedule_of_values where id = p_item;
end;
$$;

-- -----------------------------------------------------------------------------
-- The application, computed from its lines
-- -----------------------------------------------------------------------------

/**
 * Recompute a pay application's totals from its lines and its history.
 *
 * Recomputed, never incremented — the lesson 0177, 0179, 0181 and 0191 each
 * arrived at separately. An increment drifts the first time a line is deleted,
 * and on a bill the drift is money somebody is asked for.
 *
 * `previous_payments` is what earlier applications on this project were actually
 * paid, not what they were billed. The difference is the whole point of the
 * figure: an owner who short-paid application 3 is still owed against it, and a
 * `previous_payments` taken from what was billed would quietly forgive it.
 */
create or replace function app.recompute_pay_application(p_application uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_a        pay_applications%rowtype;
  v_earned   numeric(18,2);
  v_stored   numeric(18,2);
  v_retain   numeric(18,2);
  v_previous numeric(18,2);
  v_changes  numeric(18,2);
begin
  select * into v_a from pay_applications where id = p_application;
  if v_a.id is null then return; end if;
  -- A certified application's figures stop moving; 0017's lock says so, and
  -- reaching it from here would turn that rule into a constraint error.
  if v_a.status <> 'draft' then return; end if;

  select coalesce(sum(l.previous_completed + l.this_period), 0),
         coalesce(sum(l.stored_materials), 0),
         coalesce(sum(l.retainage), 0)
    into v_earned, v_stored, v_retain
    from pay_application_lines l
   where l.pay_application_id = p_application;

  select coalesce(sum(p.amount_paid), 0) into v_previous
    from pay_applications p
   where p.project_id = v_a.project_id
     and p.application_number < v_a.application_number;

  /*
   * Approved change orders, which is what "contract sum to date" means. Both
   * `approved` and `executed` count: an executed change order is an approved one
   * that has been signed, and leaving it out would drop the contract sum back
   * down the day the paperwork came back.
   */
  select coalesce(sum(c.price_impact), 0) into v_changes
    from change_orders c
   where c.project_id = v_a.project_id and c.status in ('approved', 'executed');

  update pay_applications
     set completed_to_date = v_earned,
         stored_materials  = v_stored,
         retainage_to_date = v_retain,
         previous_payments = v_previous,
         approved_changes  = v_changes,
         current_due       = (v_earned + v_stored) - v_retain - v_previous,
         updated_at        = now()
   where id = p_application;
end;
$$;

create or replace function app.recompute_pay_application_from_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform app.recompute_pay_application(
    coalesce(new.pay_application_id, old.pay_application_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists pay_application_lines_recompute on pay_application_lines;
create trigger pay_application_lines_recompute
  after insert or update or delete on pay_application_lines
  for each row execute function app.recompute_pay_application_from_line();

/**
 * Fill an application with one line per billing item.
 *
 * `previous_completed` is read off the previous application rather than carried
 * by hand. That figure is the one an estimator retypes from last month's
 * paperwork, and the first time it is retyped wrong the owner is either
 * short-billed or billed twice for the same work.
 *
 * Retainage is withheld per line at the application's own rate, because that is
 * how it is released: a line finished and accepted can have its retainage cut
 * while the rest of the job keeps it.
 */
create or replace function app.build_pay_application_lines(p_application uuid)
returns int
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_a   pay_applications%rowtype;
  v_n   int := 0;
  v_row record;
begin
  select * into v_a from pay_applications where id = p_application;
  if v_a.id is null then
    raise exception 'No such pay application' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_a.project_id, 'finance.write');
  if v_a.status <> 'draft' then
    raise exception 'Application % is % and its figures are certified',
      v_a.application_number, v_a.status using errcode = 'restrict_violation';
  end if;
  if exists (select 1 from pay_application_lines where pay_application_id = p_application) then
    raise exception 'This application already has its lines'
      using errcode = 'unique_violation';
  end if;
  if not exists (select 1 from schedule_of_values where project_id = v_a.project_id) then
    raise exception 'This project has no schedule of values to bill against'
      using errcode = 'no_data_found',
            hint = 'Build it from the estimate, or add the billing items the owner agreed to.';
  end if;

  for v_row in
    select s.id, s.item_number, s.description, s.scheduled_value, s.sort_order,
           coalesce((
             select l.completed_to_date
               from pay_application_lines l
               join pay_applications a on a.id = l.pay_application_id
              where l.sov_id = s.id
                and a.project_id = v_a.project_id
                and a.application_number < v_a.application_number
              order by a.application_number desc
              limit 1), 0) as previously
      from schedule_of_values s
     where s.project_id = v_a.project_id
     order by s.sort_order, s.item_number
  loop
    v_n := v_n + 1;
    insert into pay_application_lines (
      company_id, pay_application_id, sov_id, item_number, description,
      scheduled_value, previous_completed, sort_order)
    values (v_a.company_id, p_application, v_row.id, v_row.item_number,
            v_row.description, v_row.scheduled_value, v_row.previously, v_row.sort_order);
  end loop;
  return v_n;
end;
$$;

/**
 * Bill a line for this period.
 *
 * Either a dollar figure or a percent of the scheduled value — estimators work
 * both ways and a screen that insists on one of them gets the other typed into
 * it wrong. The percent is converted here and the dollar figure is what is
 * stored, so there is one number on file and not two that can disagree.
 *
 * Billing a line past its scheduled value is refused by name. The header
 * constraint would catch it later as an over-billing of the whole contract, but
 * by then the message is about the contract rather than about the line somebody
 * just typed into.
 */
create or replace function app.set_pay_application_line(
  p_line uuid,
  p_this_period numeric default null,
  p_percent_complete numeric default null,
  p_stored_materials numeric default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_l      pay_application_lines%rowtype;
  v_a      pay_applications%rowtype;
  v_this   numeric(18,2);
  v_stored numeric(18,2);
  v_pct    numeric(7,6);
begin
  select * into v_l from pay_application_lines where id = p_line;
  if v_l.id is null then
    raise exception 'No such billing line' using errcode = 'no_data_found';
  end if;
  select * into v_a from pay_applications where id = v_l.pay_application_id;
  perform app.project_company_for_write(v_a.project_id, 'finance.write');
  if v_a.status <> 'draft' then
    raise exception 'Application % is % and its figures are certified',
      v_a.application_number, v_a.status
      using errcode = 'restrict_violation',
            hint = 'Bill the correction on the next application.';
  end if;

  if p_this_period is not null and p_percent_complete is not null then
    raise exception 'Bill a line by amount or by percent, not by both'
      using errcode = 'check_violation',
            hint = 'Two figures that can disagree is one figure too many.';
  end if;

  if p_percent_complete is not null then
    if p_percent_complete < 0 or p_percent_complete > 1 then
      raise exception 'Percent complete is a fraction between 0 and 1'
        using errcode = 'check_violation';
    end if;
    v_this := round(v_l.scheduled_value * p_percent_complete, 2) - v_l.previous_completed;
    if v_this < 0 then
      raise exception
        'That is less than has already been billed on item %. A line cannot be un-billed on a later application.',
        v_l.item_number
        using errcode = 'check_violation',
              hint = 'A credit is a change order, so the owner sees it as one.';
    end if;
  else
    v_this := coalesce(p_this_period, v_l.this_period);
  end if;

  v_stored := coalesce(p_stored_materials, v_l.stored_materials);
  if v_stored < 0 then
    raise exception 'Stored materials cannot be negative' using errcode = 'check_violation';
  end if;

  if v_l.previous_completed + v_this + v_stored > v_l.scheduled_value + 0.005 then
    raise exception
      'Item % is scheduled at % and this would bill % to date',
      v_l.item_number, v_l.scheduled_value, v_l.previous_completed + v_this + v_stored
      using errcode = 'check_violation',
            hint = 'Extra scope is a change order. Billing past the schedule of values is a claim the owner will reject.';
  end if;

  v_pct := case when v_l.scheduled_value > 0
                then least((v_l.previous_completed + v_this + v_stored) / v_l.scheduled_value, 1)
                end;

  update pay_application_lines
     set this_period       = v_this,
         stored_materials  = v_stored,
         percent_complete  = v_pct,
         retainage         = round((v_l.previous_completed + v_this + v_stored)
                                   * v_a.retainage_percent, 2),
         updated_at        = now()
   where id = p_line;
end;
$$;

/** Remove a billing line from a draft application. */
create or replace function app.remove_pay_application_line(p_line uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_l pay_application_lines%rowtype;
  v_a pay_applications%rowtype;
begin
  select * into v_l from pay_application_lines where id = p_line;
  if v_l.id is null then
    raise exception 'No such billing line' using errcode = 'no_data_found';
  end if;
  select * into v_a from pay_applications where id = v_l.pay_application_id;
  perform app.project_company_for_write(v_a.project_id, 'finance.write');
  if v_a.status <> 'draft' then
    raise exception 'Application % is % and its lines are certified',
      v_a.application_number, v_a.status using errcode = 'restrict_violation';
  end if;
  delete from pay_application_lines where id = p_line;
end;
$$;

/**
 * The owner approves the certificate.
 *
 * Separate from submitting, because they are different people on different days
 * and the gap between them is the thing a contractor chases.
 */
create or replace function app.approve_pay_application(p_application uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_a pay_applications%rowtype;
begin
  select * into v_a from pay_applications where id = p_application;
  if v_a.id is null then
    raise exception 'No such application' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_a.project_id, 'finance.approve');
  if v_a.status <> 'submitted' then
    raise exception 'Application % is %, and only a submitted one can be approved',
      v_a.application_number, v_a.status using errcode = 'restrict_violation';
  end if;
  update pay_applications
     set status = 'approved', approved_at = now(), updated_at = now()
   where id = p_application;
end;
$$;

/** The owner rejects it, with the reason on the record. */
create or replace function app.reject_pay_application(p_application uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_a      pay_applications%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_a from pay_applications where id = p_application;
  if v_a.id is null then
    raise exception 'No such application' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_a.project_id, 'finance.approve');
  if v_a.status not in ('submitted', 'approved') then
    raise exception 'Application % is %', v_a.application_number, v_a.status
      using errcode = 'restrict_violation';
  end if;
  if v_reason is null then
    raise exception 'A rejection has to say what is wrong with the bill'
      using errcode = 'check_violation',
            hint = 'The next application is built from this one, and whoever builds it needs to know.';
  end if;
  update pay_applications
     set status = 'rejected',
         notes  = coalesce(notes || E'\n', '') || 'Rejected: ' || v_reason,
         updated_at = now()
   where id = p_application;
end;
$$;

/**
 * Money arrived against an application.
 *
 * Accumulated, and the status follows the arithmetic rather than being chosen:
 * paid when the whole of what is due has arrived, partially paid otherwise. A
 * status somebody picks and an amount somebody types will eventually disagree,
 * and the one people act on is the status.
 */
create or replace function app.record_pay_application_payment(
  p_application uuid,
  p_amount numeric,
  p_received_on date default current_date)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_a     pay_applications%rowtype;
  v_total numeric(18,2);
begin
  select * into v_a from pay_applications where id = p_application;
  if v_a.id is null then
    raise exception 'No such application' using errcode = 'no_data_found';
  end if;
  perform app.project_company_for_write(v_a.project_id, 'finance.write');
  if v_a.status not in ('approved', 'partially_paid', 'submitted') then
    raise exception 'Application % is %, so a payment against it would be against nothing',
      v_a.application_number, v_a.status using errcode = 'restrict_violation';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A payment is an amount greater than zero' using errcode = 'check_violation';
  end if;

  v_total := v_a.amount_paid + p_amount;
  if v_total > v_a.current_due + 0.005 then
    raise exception 'That is more than the % due on application %',
      v_a.current_due, v_a.application_number
      using errcode = 'check_violation',
            hint = 'An overpayment is applied to the next application, not to this one.';
  end if;

  update pay_applications
     set amount_paid = v_total,
         status      = case when v_total >= v_a.current_due - 0.005 then 'paid'
                            else 'partially_paid' end,
         paid_at     = case when v_total >= v_a.current_due - 0.005
                            then (p_received_on)::timestamptz else paid_at end,
         updated_at  = now()
   where id = p_application;
end;
$$;

-- -----------------------------------------------------------------------------
-- The bills that arrive
-- -----------------------------------------------------------------------------

/**
 * What the three-way match says about an invoice against its purchase order.
 *
 * PO, receipt and invoice have to agree before money moves. The states are the
 * schema's own, and what is added here is the arithmetic that decides between
 * them:
 *
 *   no_po              — nothing to match against, which is a decision somebody
 *                        makes rather than a failure.
 *   quantity_variance  — the order has not been received in full. Paying for
 *                        goods that have not arrived is the specific thing this
 *                        control exists to stop.
 *   price_variance     — it arrived, and the bill is not the price agreed.
 *   matched            — received, and priced as ordered.
 *
 * Quantity is checked before price, because an unreceived order cannot be
 * meaningfully priced.
 */
create or replace function app.match_ap_invoice(
  p_purchase_order uuid,
  p_amount numeric)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ordered  numeric(18,2);
  v_received numeric(18,2);
begin
  if p_purchase_order is null then
    return 'no_po';
  end if;

  select coalesce(sum(i.quantity * i.unit_price), 0),
         coalesce(sum(i.quantity_received * i.unit_price), 0)
    into v_ordered, v_received
    from purchase_order_items i
   where i.purchase_order_id = p_purchase_order;

  if v_received + 0.005 < coalesce(p_amount, 0) then
    return 'quantity_variance';
  end if;
  /* A penny either way is a rounding difference, not a variance. */
  if abs(coalesce(p_amount, 0) - v_received) > 0.01 then
    return 'price_variance';
  end if;
  return 'matched';
end;
$$;

/**
 * Record a vendor's invoice.
 *
 * The match state is computed here rather than taken from the caller, for the
 * same reason a price is: a browser that could declare an invoice matched could
 * declare a company's way past the control that stops it paying for materials
 * it never received.
 */
create or replace function app.record_ap_invoice(
  p_company uuid,
  p_vendor uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_amount numeric,
  p_tax numeric default 0,
  p_due_date date default null,
  p_purchase_order uuid default null,
  p_project uuid default null,
  p_retainage_withheld numeric default 0)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid := app.company_for_write(p_company, 'finance.write');
  v_num     text := nullif(trim(coalesce(p_invoice_number, '')), '');
  v_id      uuid;
begin
  if v_num is null then
    raise exception 'An invoice needs the number the vendor put on it'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_amount, 0) < 0 then
    raise exception 'An invoice amount cannot be negative' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from vendors where id = p_vendor and company_id = v_company) then
    raise exception 'No such vendor' using errcode = 'no_data_found';
  end if;
  if p_purchase_order is not null
     and not exists (select 1 from purchase_orders
                      where id = p_purchase_order and company_id = v_company) then
    raise exception 'No such purchase order' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from ap_invoices
              where company_id = v_company and vendor_id = p_vendor and invoice_number = v_num) then
    raise exception 'That vendor has already sent invoice %', v_num
      using errcode = 'unique_violation',
            hint = 'A duplicate invoice number from the same vendor is how a bill gets paid twice.';
  end if;

  insert into ap_invoices (
    company_id, vendor_id, purchase_order_id, project_id, invoice_number,
    invoice_date, due_date, amount, tax, retainage_withheld, match_status)
  values (v_company, p_vendor, p_purchase_order, p_project, v_num,
          coalesce(p_invoice_date, current_date), p_due_date,
          coalesce(p_amount, 0), coalesce(p_tax, 0), coalesce(p_retainage_withheld, 0),
          app.match_ap_invoice(p_purchase_order, coalesce(p_amount, 0)))
  returning id into v_id;
  return v_id;
end;
$$;

/** Re-run the match, after a receipt or a corrected order. */
create or replace function app.rematch_ap_invoice(p_invoice uuid)
returns text
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_i     ap_invoices%rowtype;
  v_match text;
begin
  select * into v_i from ap_invoices where id = p_invoice;
  if v_i.id is null then
    raise exception 'No such invoice' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_i.company_id, 'finance.write');
  v_match := app.match_ap_invoice(v_i.purchase_order_id, v_i.amount);
  update ap_invoices set match_status = v_match, updated_at = now() where id = p_invoice;
  return v_match;
end;
$$;

/** Approve an invoice for payment. */
create or replace function app.approve_ap_invoice(p_invoice uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_i ap_invoices%rowtype;
begin
  select * into v_i from ap_invoices where id = p_invoice;
  if v_i.id is null then
    raise exception 'No such invoice' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_i.company_id, 'finance.approve');
  if v_i.status in ('paid', 'void') then
    raise exception 'Invoice % is %', v_i.invoice_number, v_i.status
      using errcode = 'restrict_violation';
  end if;
  update ap_invoices
     set status = 'approved', approval_state = 'approved',
         approved_by = auth.uid(), approved_at = now(), updated_at = now()
   where id = p_invoice;
end;
$$;

/** Hold, dispute or void an invoice, with the reason where people read it. */
create or replace function app.set_ap_invoice_status(
  p_invoice uuid, p_status text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_i ap_invoices%rowtype;
begin
  select * into v_i from ap_invoices where id = p_invoice;
  if v_i.id is null then
    raise exception 'No such invoice' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_i.company_id, 'finance.write');
  if p_status not in ('received', 'on_hold', 'disputed', 'void') then
    raise exception 'Approving and paying are their own actions'
      using errcode = 'check_violation';
  end if;
  if v_i.amount_paid > 0 and p_status = 'void' then
    raise exception 'Invoice % has been paid and cannot be voided', v_i.invoice_number
      using errcode = 'restrict_violation';
  end if;
  update ap_invoices set status = p_status, updated_at = now() where id = p_invoice;
end;
$$;

/**
 * Pay a vendor invoice.
 *
 * The refusal that matters is the first one. `ap_invoices_pay_requires_match`
 * has stood since 0017 and had never been reached by anything, because nothing
 * could record an invoice; a constraint that has never fired is a rule nobody
 * has checked. It is stated here in the terms a person needs — which order, and
 * what is wrong with it — rather than as a constraint name.
 */
create or replace function app.record_ap_payment(
  p_invoice uuid,
  p_amount numeric,
  p_paid_on date default current_date)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_i     ap_invoices%rowtype;
  v_total numeric(18,2);
  v_due   numeric(18,2);
begin
  select * into v_i from ap_invoices where id = p_invoice;
  if v_i.id is null then
    raise exception 'No such invoice' using errcode = 'no_data_found';
  end if;
  perform app.company_for_write(v_i.company_id, 'finance.write');

  if v_i.match_status not in ('matched', 'no_po') then
    raise exception
      'Invoice % is %, so it cannot be paid yet',
      v_i.invoice_number,
      case v_i.match_status
        when 'quantity_variance' then 'billing for more than has been received'
        when 'price_variance'    then 'billing a different price than was ordered'
        else 'not matched to its order' end
      using errcode = 'restrict_violation',
            hint = 'Receive the rest of the order, correct the order, or decide it has no order to match. Paying an unmatched invoice is how a company pays for materials it never got.';
  end if;
  if v_i.status in ('void', 'disputed', 'on_hold') then
    raise exception 'Invoice % is %', v_i.invoice_number, v_i.status
      using errcode = 'restrict_violation';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A payment is an amount greater than zero' using errcode = 'check_violation';
  end if;

  v_due   := v_i.amount + v_i.tax - v_i.retainage_withheld;
  v_total := v_i.amount_paid + p_amount;
  if v_total > v_i.amount + v_i.tax + 0.005 then
    raise exception 'That is more than invoice % is for', v_i.invoice_number
      using errcode = 'check_violation';
  end if;

  update ap_invoices
     set amount_paid = v_total,
         status      = case when v_total >= v_due - 0.005 then 'paid' else 'partially_paid' end,
         updated_at  = now()
   where id = p_invoice;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

create or replace view my_schedule_of_values
with (security_invoker = true) as
select s.id, s.company_id, s.project_id, s.item_number, s.description,
       s.scheduled_value, s.billing_basis, s.quantity, s.unit, s.unit_price,
       s.sort_order, s.source_line_item_id, s.cost_code_id,
       p.number                                        as project_number,
       cc.code                                         as cost_code,
       -- What has been billed against this item on certified applications, so
       -- the schedule reads as a progress sheet rather than as a price list.
       coalesce((
         select l.completed_to_date
           from pay_application_lines l
           join pay_applications a on a.id = l.pay_application_id
          where l.sov_id = s.id and a.status <> 'draft'
          order by a.application_number desc limit 1), 0) as billed_to_date,
       (s.source_line_item_id is not null)              as from_the_estimate
  from schedule_of_values s
  join projects p on p.id = s.project_id
  left join cost_codes cc on cc.id = s.cost_code_id;

revoke all on my_schedule_of_values from public, anon;
grant select on my_schedule_of_values to authenticated, service_role;

create or replace view my_pay_application_lines
with (security_invoker = true) as
select l.id, l.company_id, l.pay_application_id, l.sov_id, l.item_number,
       l.description, l.scheduled_value, l.previous_completed, l.this_period,
       l.stored_materials, l.completed_to_date, l.percent_complete, l.retainage,
       l.sort_order,
       (l.scheduled_value - l.completed_to_date)        as balance_to_finish,
       a.application_number, a.status                   as application_status,
       a.project_id
  from pay_application_lines l
  join pay_applications a on a.id = l.pay_application_id;

revoke all on my_pay_application_lines from public, anon;
grant select on my_pay_application_lines to authenticated, service_role;

create or replace view my_ap_invoices
with (security_invoker = true) as
select i.id, i.company_id, i.vendor_id, i.purchase_order_id, i.project_id,
       i.invoice_number, i.invoice_date, i.due_date, i.amount, i.tax,
       i.retainage_withheld, i.amount_paid, i.match_status, i.approval_state,
       i.status, i.approved_at,
       v.name                                           as vendor_name,
       po.number                                        as purchase_order_number,
       p.number                                         as project_number,
       (i.amount + i.tax - i.retainage_withheld - i.amount_paid) as balance_due,
       (i.match_status in ('matched', 'no_po'))         as payable,
       -- Why it is not payable, said once, where the list is read. A screen
       -- that only shows a state leaves everybody guessing what to do about it.
       case i.match_status
         when 'quantity_variance' then 'Billing for more than has been received'
         when 'price_variance'    then 'Billing a different price than was ordered'
         when 'unmatched'         then 'Not matched to its order'
       end                                              as match_problem,
       case when i.due_date is null then null
            else (current_date - i.due_date) end        as days_overdue
  from ap_invoices i
  join vendors v on v.id = i.vendor_id
  left join purchase_orders po on po.id = i.purchase_order_id
  left join projects p on p.id = i.project_id;

revoke all on my_ap_invoices from public, anon;
grant select on my_ap_invoices to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.add_sov_item(
  p_project uuid, p_item_number text, p_description text, p_scheduled_value numeric,
  p_billing_basis text default 'lump_sum', p_quantity numeric default null,
  p_unit text default null, p_unit_price numeric default null,
  p_cost_code uuid default null, p_source_line uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_sov_item(p_project, p_item_number, p_description, p_scheduled_value,
       p_billing_basis, p_quantity, p_unit, p_unit_price, p_cost_code, p_source_line); $$;

create or replace function public.build_sov_from_estimate(p_project uuid)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.build_sov_from_estimate(p_project); $$;

create or replace function public.update_sov_item(
  p_item uuid, p_item_number text default null, p_description text default null,
  p_scheduled_value numeric default null, p_billing_basis text default null,
  p_quantity numeric default null, p_unit text default null,
  p_unit_price numeric default null, p_cost_code uuid default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_sov_item(p_item, p_item_number, p_description, p_scheduled_value,
       p_billing_basis, p_quantity, p_unit, p_unit_price, p_cost_code); $$;

create or replace function public.remove_sov_item(p_item uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_sov_item(p_item); $$;

create or replace function public.build_pay_application_lines(p_application uuid)
returns int language sql security invoker set search_path = public, pg_catalog
as $$ select app.build_pay_application_lines(p_application); $$;

create or replace function public.set_pay_application_line(
  p_line uuid, p_this_period numeric default null,
  p_percent_complete numeric default null, p_stored_materials numeric default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_pay_application_line(p_line, p_this_period, p_percent_complete,
       p_stored_materials); $$;

create or replace function public.remove_pay_application_line(p_line uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_pay_application_line(p_line); $$;

create or replace function public.approve_pay_application(p_application uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.approve_pay_application(p_application); $$;

create or replace function public.reject_pay_application(p_application uuid, p_reason text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.reject_pay_application(p_application, p_reason); $$;

create or replace function public.record_pay_application_payment(
  p_application uuid, p_amount numeric, p_received_on date default current_date)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_pay_application_payment(p_application, p_amount, p_received_on); $$;

create or replace function public.record_ap_invoice(
  p_company uuid, p_vendor uuid, p_invoice_number text, p_invoice_date date,
  p_amount numeric, p_tax numeric default 0, p_due_date date default null,
  p_purchase_order uuid default null, p_project uuid default null,
  p_retainage_withheld numeric default 0)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_ap_invoice(p_company, p_vendor, p_invoice_number, p_invoice_date,
       p_amount, p_tax, p_due_date, p_purchase_order, p_project, p_retainage_withheld); $$;

create or replace function public.rematch_ap_invoice(p_invoice uuid)
returns text language sql security invoker set search_path = public, pg_catalog
as $$ select app.rematch_ap_invoice(p_invoice); $$;

create or replace function public.approve_ap_invoice(p_invoice uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.approve_ap_invoice(p_invoice); $$;

create or replace function public.set_ap_invoice_status(p_invoice uuid, p_status text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.set_ap_invoice_status(p_invoice, p_status); $$;

create or replace function public.record_ap_payment(
  p_invoice uuid, p_amount numeric, p_paid_on date default current_date)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_ap_payment(p_invoice, p_amount, p_paid_on); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_sov_item(uuid, text, text, numeric, text, numeric, text, numeric, uuid, uuid)',
    'public.build_sov_from_estimate(uuid)',
    'public.update_sov_item(uuid, text, text, numeric, text, numeric, text, numeric, uuid)',
    'public.remove_sov_item(uuid)',
    'public.build_pay_application_lines(uuid)',
    'public.set_pay_application_line(uuid, numeric, numeric, numeric)',
    'public.remove_pay_application_line(uuid)',
    'public.approve_pay_application(uuid)',
    'public.reject_pay_application(uuid, text)',
    'public.record_pay_application_payment(uuid, numeric, date)',
    'public.record_ap_invoice(uuid, uuid, text, date, numeric, numeric, date, uuid, uuid, numeric)',
    'public.rematch_ap_invoice(uuid)',
    'public.approve_ap_invoice(uuid)',
    'public.set_ap_invoice_status(uuid, text)',
    'public.record_ap_payment(uuid, numeric, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select app.assert_security_gates();

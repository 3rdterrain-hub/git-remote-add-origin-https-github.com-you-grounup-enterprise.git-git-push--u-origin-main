-- =============================================================================
-- 0191 — A purchase order worth something, and a quote you can compare
--
-- The same shape as the change orders in 0181, and with a worse consequence.
--
-- Migration 0037 put a signing limit on `purchase_orders`, checked as the order
-- crosses into `issued` — "a purchase order is the commitment a contractor
-- makes most often, and it was the one commitment with no signing limit". The
-- limit is checked against `committed_amount`. Nothing computes that from the
-- order's lines, because **nothing could create a line**: `purchase_order_items`
-- has had no writer since it was written.
--
-- So every purchase order was worth $0.00 at the moment it was issued, the
-- signing limit passed for every order whatever its real value, and 0046's
-- posting of open commitment into `project_costs` posted nothing. A control
-- that never refuses is not a control.
--
-- `rfq_responses` is the second. It carries `leveled_amount` as a generated
-- column — the quote plus a leveling adjustment — so the bid-leveling machinery
-- is built and correct, and no vendor's quote could ever be recorded. An RFQ
-- could be sent and nothing could come back, which is the whole point of
-- sending one.
--
-- **Recompute, never increment.** The same rule as 0177, 0179 and 0181: an
-- incremented total drifts the first time a line is deleted or a function runs
-- twice, and a drifted `committed_amount` here is a signing limit checked
-- against the wrong number. A trigger recomputes from the lines and cannot be
-- bypassed, including by a direct PostgREST write.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a purchase order is worth
-- -----------------------------------------------------------------------------

/**
 * Recompute an order's committed amount from its lines.
 *
 * `extended` is generated on the line — quantity times unit price — so this
 * sums a figure nobody typed. `received_amount` is recomputed the same way,
 * from what has actually arrived, because the difference between committed and
 * received is the open commitment 0046 posts to job cost.
 */
create or replace function app.recompute_purchase_order_amounts()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update purchase_orders p
     set committed_amount = coalesce(t.committed, 0),
         received_amount  = coalesce(t.received, 0),
         updated_at = now()
    from (
      select sum(i.extended)                           as committed,
             sum(i.quantity_received * i.unit_price)   as received
        from purchase_order_items i
       where i.purchase_order_id = v_po
    ) t
   where p.id = v_po;
  return coalesce(new, old);
end;
$$;

drop trigger if exists purchase_order_items_recompute on purchase_order_items;
create trigger purchase_order_items_recompute
  after insert or update or delete on purchase_order_items
  for each row execute function app.recompute_purchase_order_amounts();

comment on function app.recompute_purchase_order_amounts() is
  'Recomputes a purchase order''s committed and received amounts from its lines. Recomputed, never incremented: a drifted committed_amount is a signing limit (0037) checked against the wrong number. WORKFLOW.';

/**
 * Put a line on a purchase order.
 *
 * The first writer of `purchase_order_items` anywhere. Refused once the order
 * is issued: the vendor holds a document the company is bound by, and changing
 * what it says after the fact is how a commitment and its signing approval stop
 * describing the same thing. A change goes on a new order.
 */
create or replace function app.add_purchase_order_item(
  p_purchase_order uuid,
  p_description text,
  p_quantity    numeric,
  p_unit_price  numeric,
  p_unit        text default null,
  p_material    uuid default null,
  p_cost_code   uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_po  purchase_orders%rowtype;
  v_id  uuid;
begin
  select * into v_po from purchase_orders where id = p_purchase_order;
  if v_po.id is null then
    raise exception 'No such purchase order' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_po.company_id, 'procurement.write') then
    raise exception 'You do not have permission to change purchase orders'
      using errcode = 'insufficient_privilege';
  end if;
  if v_po.status <> 'draft' then
    raise exception 'That order is % — the vendor already holds it', v_po.status
      using errcode = 'check_violation',
            hint = 'Raise a new order for the change, so the commitment and the approval on it stay the same document.';
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'A line needs a description' using errcode = 'check_violation';
  end if;
  if coalesce(p_quantity, 0) < 0 or coalesce(p_unit_price, 0) < 0 then
    raise exception 'A quantity and a price cannot be negative'
      using errcode = 'check_violation';
  end if;

  insert into purchase_order_items (
    company_id, purchase_order_id, material_id, cost_code_id, sort_order,
    description, quantity, unit, unit_price)
  values (
    v_po.company_id, p_purchase_order, p_material, p_cost_code,
    (select coalesce(max(sort_order), 0) + 10 from purchase_order_items
      where purchase_order_id = p_purchase_order),
    btrim(p_description), coalesce(p_quantity, 0),
    nullif(btrim(coalesce(p_unit, '')), '')::app.unit_code,
    coalesce(p_unit_price, 0))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.add_purchase_order_item(uuid, text, numeric, numeric, text, uuid, uuid) is
  'Puts a line on a draft purchase order. The first writer of purchase_order_items: before this every order was worth $0.00 when issued, so the signing limit from 0037 passed for every one of them. WORKFLOW.';

/** Take a line off a draft order. The committed amount falls with it. */
create or replace function app.remove_purchase_order_item(p_item uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_company uuid; v_status text;
begin
  select i.company_id, p.status into v_company, v_status
    from purchase_order_items i
    join purchase_orders p on p.id = i.purchase_order_id
   where i.id = p_item;
  if v_company is null then
    raise exception 'No such line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'procurement.write') then
    raise exception 'You do not have permission to change purchase orders'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'draft' then
    raise exception 'That order is % and its lines are the commitment', v_status
      using errcode = 'check_violation';
  end if;
  delete from purchase_order_items where id = p_item;
end;
$$;

comment on function app.remove_purchase_order_item(uuid) is
  'Removes a line from a draft order. WORKFLOW.';

/**
 * Receive against a line.
 *
 * What arrived, not what was ordered — they differ often enough that a platform
 * assuming otherwise is wrong on most jobs. Receiving more than was ordered is
 * refused: it is nearly always the wrong line, and an over-receipt silently
 * accepted becomes an over-invoice the schema then refuses at the worst moment.
 *
 * The order's status follows what its lines say rather than being set by hand,
 * so "partially received" cannot disagree with the lines underneath it.
 */
create or replace function app.receive_purchase_order_item(
  p_item uuid, p_quantity numeric, p_received_on date default current_date)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_item purchase_order_items%rowtype;
  v_po   purchase_orders%rowtype;
  v_all  boolean;
  v_any  boolean;
begin
  select * into v_item from purchase_order_items where id = p_item;
  if v_item.id is null then
    raise exception 'No such line' using errcode = 'no_data_found';
  end if;
  select * into v_po from purchase_orders where id = v_item.purchase_order_id;
  if not app.has_permission(v_po.company_id, 'procurement.write') then
    raise exception 'You do not have permission to receive against this order'
      using errcode = 'insufficient_privilege';
  end if;
  if v_po.status not in ('issued', 'partially_received') then
    raise exception 'That order is % — nothing can be received against it', v_po.status
      using errcode = 'check_violation';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Say how much arrived' using errcode = 'check_violation';
  end if;
  if v_item.quantity_received + p_quantity > v_item.quantity * 1.001 then
    raise exception
      'That would receive % of % ordered on "%"',
      v_item.quantity_received + p_quantity, v_item.quantity, v_item.description
      using errcode = 'check_violation',
            hint = 'Receiving more than was ordered is nearly always the wrong line. Check the ticket against the order.';
  end if;

  update purchase_order_items
     set quantity_received = quantity_received + p_quantity,
         updated_at = now()
   where id = p_item;

  /* The status follows the lines, so the two cannot disagree. */
  select bool_and(i.quantity_received >= i.quantity * 0.999),
         bool_or(i.quantity_received > 0)
    into v_all, v_any
    from purchase_order_items i
   where i.purchase_order_id = v_po.id;

  update purchase_orders
     set status = case when v_all then 'received'
                       when v_any then 'partially_received'
                       else status end,
         updated_at = now()
   where id = v_po.id;
end;
$$;

comment on function app.receive_purchase_order_item(uuid, numeric, date) is
  'Records what actually arrived against a line, and moves the order''s status to match its lines rather than letting somebody set it by hand. WORKFLOW.';

/**
 * Issue a purchase order.
 *
 * The moment the signing limit from 0037 is checked, and the moment it means
 * something now that the order is worth the sum of its lines. An empty order is
 * refused: issuing one commits the company to nothing and leaves a document
 * with a vendor's name on it that nobody can reconcile.
 */
create or replace function app.issue_purchase_order(p_purchase_order uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_po purchase_orders%rowtype; v_lines int;
begin
  select * into v_po from purchase_orders where id = p_purchase_order;
  if v_po.id is null then
    raise exception 'No such purchase order' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_po.company_id, 'procurement.write') then
    raise exception 'You do not have permission to issue purchase orders'
      using errcode = 'insufficient_privilege';
  end if;
  if v_po.status <> 'draft' then
    raise exception 'That order is already %', v_po.status using errcode = 'check_violation';
  end if;

  select count(*) into v_lines from purchase_order_items
   where purchase_order_id = p_purchase_order;
  if v_lines = 0 then
    raise exception 'That order has nothing on it'
      using errcode = 'check_violation',
            hint = 'An order with no lines commits you to nothing and cannot be reconciled against a delivery.';
  end if;

  /* The authority trigger from 0037 fires on this transition. */
  update purchase_orders
     set status = 'issued', issued_at = now(), updated_at = now()
   where id = p_purchase_order;
end;
$$;

comment on function app.issue_purchase_order(uuid) is
  'Issues a draft order, which is where the signing limit from 0037 is checked — and where it means something, now that the order is worth the sum of its lines. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- A quote you can compare
-- -----------------------------------------------------------------------------

/**
 * Record what a vendor quoted.
 *
 * `rfq_responses` has carried a generated `leveled_amount` — the quote plus a
 * leveling adjustment — since it was written, and nothing could record a quote,
 * so nothing was ever leveled. An RFQ could be sent and nothing could come
 * back.
 *
 * The leveling adjustment is what makes two quotes comparable: one vendor
 * excludes traffic control, another includes it, and the raw numbers are not
 * the same scope. Storing the adjustment separately keeps the quote as the
 * vendor gave it and the comparison as the estimator made it — two facts, not
 * one edited number.
 */
create or replace function app.record_rfq_response(
  p_rfq uuid,
  p_vendor uuid,
  p_quoted_amount numeric default null,
  p_lead_time_days int default null,
  p_valid_until date default null,
  p_inclusions text default null,
  p_exclusions text default null,
  p_leveling_adjustment numeric default 0,
  p_declined boolean default false,
  p_notes text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_rfq rfqs%rowtype; v_id uuid;
begin
  select * into v_rfq from rfqs where id = p_rfq;
  if v_rfq.id is null then
    raise exception 'No such RFQ' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_rfq.company_id, 'procurement.write') then
    raise exception 'You do not have permission to record quotes'
      using errcode = 'insufficient_privilege';
  end if;
  if v_rfq.status in ('awarded', 'canceled') then
    raise exception 'That RFQ is %', v_rfq.status using errcode = 'check_violation';
  end if;
  if not p_declined and p_quoted_amount is null then
    raise exception 'A quote needs an amount, or say the vendor declined'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from vendors v where v.id = p_vendor) then
    raise exception 'No such vendor' using errcode = 'no_data_found';
  end if;

  insert into rfq_responses (
    company_id, rfq_id, vendor_id, quoted_amount, leveling_adjustment,
    lead_time_days, valid_until, inclusions, exclusions, status, received_at, notes)
  values (
    v_rfq.company_id, p_rfq, p_vendor,
    case when p_declined then null else p_quoted_amount end,
    coalesce(p_leveling_adjustment, 0),
    p_lead_time_days, p_valid_until,
    nullif(btrim(coalesce(p_inclusions,'')),''),
    nullif(btrim(coalesce(p_exclusions,'')),''),
    case when p_declined then 'declined' else 'received' end,
    now(), nullif(btrim(coalesce(p_notes,'')),''))
  on conflict (rfq_id, vendor_id) do update
     set quoted_amount = excluded.quoted_amount,
         leveling_adjustment = excluded.leveling_adjustment,
         lead_time_days = coalesce(excluded.lead_time_days, rfq_responses.lead_time_days),
         valid_until = coalesce(excluded.valid_until, rfq_responses.valid_until),
         inclusions = coalesce(excluded.inclusions, rfq_responses.inclusions),
         exclusions = coalesce(excluded.exclusions, rfq_responses.exclusions),
         status = excluded.status,
         received_at = now(),
         notes = coalesce(excluded.notes, rfq_responses.notes),
         updated_at = now()
  returning id into v_id;

  /* An RFQ with a quote against it is being received, not merely issued. */
  update rfqs set status = 'receiving', updated_at = now()
   where id = p_rfq and status = 'issued';

  return v_id;
end;
$$;

comment on function app.record_rfq_response(uuid, uuid, numeric, int, date, text, text, numeric, boolean, text) is
  'Records what a vendor quoted, and the leveling adjustment that makes two quotes comparable. The first writer of rfq_responses: the leveling machinery was built and nothing was ever leveled, because nothing could record a quote. WORKFLOW.';

/**
 * Award an RFQ to a vendor.
 *
 * The reason is required. Awarding to the lowest number needs no explanation and
 * awarding to anyone else does — and it is the second case that gets asked about
 * a year later, by an owner, an auditor, or the vendor who lost.
 */
create or replace function app.award_rfq(p_rfq uuid, p_vendor uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_rfq rfqs%rowtype; v_has boolean;
begin
  select * into v_rfq from rfqs where id = p_rfq;
  if v_rfq.id is null then
    raise exception 'No such RFQ' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_rfq.company_id, 'procurement.write') then
    raise exception 'You do not have permission to award'
      using errcode = 'insufficient_privilege';
  end if;
  if v_rfq.status = 'awarded' then
    raise exception 'That RFQ was already awarded' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why this vendor'
      using errcode = 'check_violation',
            hint = 'Awarding to the lowest number needs no explanation; awarding to anybody else does, and that is the one somebody asks about later.';
  end if;

  select true into v_has from rfq_responses
   where rfq_id = p_rfq and vendor_id = p_vendor and status not in ('declined');
  if v_has is not true then
    raise exception 'That vendor has no quote on this RFQ' using errcode = 'check_violation';
  end if;

  update rfqs
     set status = 'awarded', awarded_vendor_id = p_vendor,
         awarded_at = now(), award_reason = btrim(p_reason), updated_at = now()
   where id = p_rfq;

  update rfq_responses
     set status = case when vendor_id = p_vendor then 'awarded' else 'not_awarded' end,
         updated_at = now()
   where rfq_id = p_rfq and status <> 'declined';
end;
$$;

comment on function app.award_rfq(uuid, uuid, text) is
  'Awards an RFQ with the reason, and marks every other quote not awarded. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- What it is all worth reading
-- -----------------------------------------------------------------------------

/** Purchase orders with what is on them, received and still open. */
create or replace view my_purchase_orders
with (security_invoker = true) as
select p.id, p.company_id, p.project_id, p.number, p.title, p.po_type, p.status,
       p.committed_amount, p.received_amount, p.invoiced_amount, p.paid_amount,
       greatest(p.committed_amount - p.invoiced_amount, 0) as open_commitment,
       p.needed_by, p.issued_at, p.created_at,
       v.name                                              as vendor_name,
       pr.number                                           as project_number,
       (select count(*) from purchase_order_items i where i.purchase_order_id = p.id)
                                                           as line_count,
       (select count(*) from purchase_order_items i
         where i.purchase_order_id = p.id
           and i.quantity_received < i.quantity * 0.999)    as lines_outstanding
  from purchase_orders p
  join vendors v on v.id = p.vendor_id
  left join projects pr on pr.id = p.project_id;

comment on view my_purchase_orders is
  'Purchase orders with what is committed, received and still open. ENTITY. The committed figure is the sum of the lines, recomputed by trigger — it is what the signing limit in 0037 is checked against.';

revoke all on my_purchase_orders from public, anon;
grant select on my_purchase_orders to authenticated, service_role;

/** The lines on an order, and how much of each has arrived. */
create or replace view my_purchase_order_items
with (security_invoker = true) as
select i.id, i.company_id, i.purchase_order_id, i.sort_order, i.description,
       i.quantity, i.unit, i.unit_price, i.extended,
       i.quantity_received,
       greatest(i.quantity - i.quantity_received, 0)       as quantity_outstanding,
       m.name                                              as material_name,
       c.code                                              as cost_code
  from purchase_order_items i
  left join materials m on m.id = i.material_id
  left join cost_codes c on c.id = i.cost_code_id;

comment on view my_purchase_order_items is
  'Each line with what has arrived against it. ENTITY.';

revoke all on my_purchase_order_items from public, anon;
grant select on my_purchase_order_items to authenticated, service_role;

/**
 * Quotes against an RFQ, leveled and ranked.
 *
 * Ranked on the leveled figure, not the quoted one — comparing raw quotes of
 * different scope is the mistake bid leveling exists to prevent.
 */
create or replace view my_rfq_responses
with (security_invoker = true) as
select r.id, r.company_id, r.rfq_id, r.vendor_id,
       v.name                                              as vendor_name,
       r.quoted_amount, r.leveling_adjustment, r.leveled_amount,
       r.lead_time_days, r.valid_until, r.inclusions, r.exclusions,
       r.status, r.received_at, r.notes,
       case when r.leveled_amount is not null
            then rank() over (partition by r.rfq_id
                              order by r.leveled_amount)
       end                                                 as leveled_rank,
       (r.valid_until is not null and r.valid_until < current_date) as is_expired
  from rfq_responses r
  join vendors v on v.id = r.vendor_id;

comment on view my_rfq_responses is
  'Quotes against an RFQ, ranked on the leveled figure rather than the quoted one — comparing raw quotes of different scope is the mistake leveling exists to prevent. ENTITY.';

revoke all on my_rfq_responses from public, anon;
grant select on my_rfq_responses to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.add_purchase_order_item(
  p_purchase_order uuid, p_description text, p_quantity numeric, p_unit_price numeric,
  p_unit text default null, p_material uuid default null, p_cost_code uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_purchase_order_item(p_purchase_order, p_description, p_quantity,
       p_unit_price, p_unit, p_material, p_cost_code); $$;

create or replace function public.remove_purchase_order_item(p_item uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_purchase_order_item(p_item); $$;

create or replace function public.receive_purchase_order_item(
  p_item uuid, p_quantity numeric, p_received_on date default current_date)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.receive_purchase_order_item(p_item, p_quantity, p_received_on); $$;

create or replace function public.issue_purchase_order(p_purchase_order uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.issue_purchase_order(p_purchase_order); $$;

create or replace function public.record_rfq_response(
  p_rfq uuid, p_vendor uuid, p_quoted_amount numeric default null,
  p_lead_time_days int default null, p_valid_until date default null,
  p_inclusions text default null, p_exclusions text default null,
  p_leveling_adjustment numeric default 0, p_declined boolean default false,
  p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_rfq_response(p_rfq, p_vendor, p_quoted_amount, p_lead_time_days,
       p_valid_until, p_inclusions, p_exclusions, p_leveling_adjustment, p_declined,
       p_notes); $$;

create or replace function public.award_rfq(p_rfq uuid, p_vendor uuid, p_reason text)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.award_rfq(p_rfq, p_vendor, p_reason); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_purchase_order_item(uuid, text, numeric, numeric, text, uuid, uuid)',
    'public.remove_purchase_order_item(uuid)',
    'public.receive_purchase_order_item(uuid, numeric, date)',
    'public.issue_purchase_order(uuid)',
    'public.record_rfq_response(uuid, uuid, numeric, int, date, text, text, numeric, boolean, text)',
    'public.award_rfq(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

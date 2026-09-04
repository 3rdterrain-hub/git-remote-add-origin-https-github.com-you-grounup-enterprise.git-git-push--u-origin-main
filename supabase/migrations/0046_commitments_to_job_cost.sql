-- =============================================================================
-- 0046 — Commitments and vendor cost never reached the job either
--
-- Migration 0044 found that labor never posted to `project_costs` and fixed it.
-- The same survey of P07 found the rest of the hole:
--
--   * **`is_committed` is read and never written.** The financial view splits
--     job cost into actual and committed on that flag, and nothing in the
--     schema had ever set it — so `committed_cost` was always zero and a
--     project manager could not see a dollar of what the company had already
--     promised a vendor.
--   * **Vendor invoices never posted.** `ap_invoices` carries an amount, a
--     project and an approval, and nothing turned an approved one into cost.
--     `material_cost` and `subcontract_cost` in the financial view were
--     therefore also always zero.
--   * **`purchase_orders.invoiced_amount` was written by nothing.** The
--     `purchase_orders_not_over_invoiced` constraint guards it and reads
--     "a vendor invoicing over the PO is a change to approve, not a payable to
--     quietly post" — a good rule, guarding a number no invoice ever moved.
--     A vendor could be invoiced to twice the commitment and nothing would
--     notice, because the check was watching a column only a human ever set.
--
-- After 0044 the actual cost of a job was its labor and its fuel. After this it
-- is labor, fuel, materials, subcontracts, rentals and services, with the open
-- commitment beside it — which is the number a project manager actually
-- forecasts from.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a vendor has actually invoiced against a commitment
-- -----------------------------------------------------------------------------
/**
 * Approved vendor invoices against a purchase order.
 *
 * Tax is included because it is money the job owes. Retainage withheld is not
 * deducted: retainage is a payment timing decision, not a reduction in what the
 * work cost.
 */
create or replace function app.purchase_order_invoiced(p_po uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(i.amount + i.tax), 0)
  from ap_invoices i
  where i.purchase_order_id = p_po and i.approval_state = 'approved';
$$;

grant execute on function app.purchase_order_invoiced(uuid) to authenticated, service_role;

/**
 * Keep a purchase order's invoiced total equal to the invoices against it.
 *
 * Derived rather than stored-and-hoped-for, the rule this platform applies to a
 * library rate's validity, a schedule's baseline, a plan's version, a metric's
 * definition and a credential's expiry. The over-invoicing constraint has always
 * been right; it was watching a column nothing fed.
 *
 * The refusal is raised here rather than left to the check constraint, so the
 * message names the purchase order, what was committed, what is already
 * invoiced and what this invoice would add — instead of a constraint name.
 */
create or replace function app.sync_purchase_order_invoiced()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_po  purchase_orders%rowtype;
  v_new numeric;
  po_id uuid;
begin
  -- A moved invoice changes two purchase orders, so both are resynced. An
  -- invoice with no purchase order at all aggregates to nothing, and FOREACH
  -- refuses a null array rather than treating it as empty.
  foreach po_id in array coalesce((
    select array_agg(distinct x) from unnest(array[
      case when tg_op <> 'INSERT' then old.purchase_order_id end,
      case when tg_op <> 'DELETE' then new.purchase_order_id end]) x
    where x is not null), '{}'::uuid[])
  loop
    select * into v_po from purchase_orders where id = po_id;
    continue when not found;

    v_new := app.purchase_order_invoiced(po_id);

    if v_new > v_po.committed_amount * 1.001 then
      raise exception
        'Purchase order % is committed at % and this would take invoices against it to %. A vendor invoicing over the purchase order is a change to approve, not a payable to quietly post.',
        v_po.number, v_po.committed_amount, v_new
        using errcode = 'restrict_violation';
    end if;

    update purchase_orders set invoiced_amount = v_new where id = po_id;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

/**
 * Refuse a hand-set invoiced total that disagrees with the invoices.
 *
 * Only when it is actually being changed to something inconsistent, so the
 * derived write above is not fighting its own guard — the same shape as the
 * claim deadline rule in 0032.
 */
create or replace function app.guard_purchase_order_invoiced()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_derived numeric := app.purchase_order_invoiced(new.id);
begin
  if new.invoiced_amount is distinct from old.invoiced_amount
     and new.invoiced_amount is distinct from v_derived then
    raise exception
      'Purchase order % has % approved in vendor invoices against it; its invoiced total is derived from them and cannot be set to %.',
      new.number, v_derived, new.invoiced_amount
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger guard_purchase_order_invoiced
  before update of invoiced_amount on purchase_orders
  for each row execute function app.guard_purchase_order_invoiced();

-- -----------------------------------------------------------------------------
-- The open commitment, on the job
-- -----------------------------------------------------------------------------
/**
 * Write a purchase order's open commitment onto its project, or remove it.
 *
 * The **open** commitment — what is promised and not yet invoiced — rather than
 * the whole purchase order value. Actual cost and committed cost sit side by
 * side in the financial view, so posting the full value would count the
 * invoiced part twice and overstate what the job is going to cost.
 *
 * Allocated across the purchase order's line items in proportion to their
 * value, so a commitment lands on the cost codes it was raised against. The
 * last line absorbs the rounding remainder, so the rows always add to the
 * commitment exactly rather than to within a cent of it.
 */
create or replace function app.post_purchase_order_commitment(p_po purchase_orders)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ref   text := 'purchase_order:' || p_po.id::text;
  v_open  numeric;
  v_total numeric;
  v_used  numeric := 0;
  v_share numeric;
  v_type  text;
  r       record;
  v_n     int;
  v_i     int := 0;
begin
  delete from project_costs where company_id = p_po.company_id and reference = v_ref;

  if p_po.project_id is null
     or p_po.status not in ('issued', 'partially_received', 'received') then
    return;
  end if;

  v_open := greatest(p_po.committed_amount - p_po.invoiced_amount, 0);
  if v_open <= 0 then
    return;
  end if;

  v_type := case p_po.po_type
              when 'subcontract' then 'subcontract'
              when 'rental' then 'equipment'
              when 'service' then 'other'
              else 'material' end;

  select coalesce(sum(extended), 0), count(*) into v_total, v_n
  from purchase_order_items where purchase_order_id = p_po.id;

  if v_total <= 0 then
    -- No priced detail to spread it over: one row for the whole commitment.
    insert into project_costs (company_id, project_id, cost_date, cost_type, description,
      quantity, unit_cost, amount, reference, source, is_committed, posted_at)
    values (p_po.company_id, p_po.project_id, coalesce(p_po.issued_at::date, current_date),
      v_type, 'Open commitment — ' || p_po.number || ' ' || p_po.title,
      1, v_open, v_open, v_ref, 'purchase_order', true, now());
    return;
  end if;

  for r in select * from purchase_order_items
            where purchase_order_id = p_po.id order by sort_order, id
  loop
    v_i := v_i + 1;
    if v_i = v_n then
      v_share := v_open - v_used;           -- the last line takes the remainder
    else
      v_share := round(v_open * r.extended / v_total, 2);
      v_used := v_used + v_share;
    end if;
    continue when v_share = 0;

    insert into project_costs (company_id, project_id, cost_code_id, cost_date, cost_type,
      description, quantity, unit, unit_cost, amount, vendor_id, reference, source,
      is_committed, posted_at)
    values (p_po.company_id, p_po.project_id, r.cost_code_id,
      coalesce(p_po.issued_at::date, current_date), v_type,
      'Open commitment — ' || p_po.number || ' ' || r.description,
      r.quantity, r.unit, r.unit_price, v_share, p_po.vendor_id, v_ref, 'purchase_order',
      true, now());
  end loop;
end;
$$;

create or replace function app.post_purchase_order_to_job_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    delete from project_costs where company_id = old.company_id
      and reference = 'purchase_order:' || old.id::text;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    delete from project_costs where company_id = old.company_id
      and reference = 'purchase_order:' || old.id::text;
  end if;
  perform app.post_purchase_order_commitment(new);
  return new;
end;
$$;

create trigger post_purchase_order_to_job_cost
  after insert or update or delete on purchase_orders
  for each row execute function app.post_purchase_order_to_job_cost();

-- A line item added, repriced or removed changes how the commitment is spread.
create or replace function app.repost_purchase_order_items()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_po purchase_orders%rowtype;
begin
  select * into v_po from purchase_orders
   where id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if found then perform app.post_purchase_order_commitment(v_po); end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger repost_purchase_order_items
  after insert or update or delete on purchase_order_items
  for each row execute function app.repost_purchase_order_items();

-- -----------------------------------------------------------------------------
-- Vendor cost, on the job
-- -----------------------------------------------------------------------------
/**
 * Write an approved vendor invoice onto its project, or remove it.
 *
 * Approved only, the rule the platform already applies to time and to every
 * other figure it reports: an unapproved invoice is a claim by a vendor, not a
 * record of what the job cost. Tax is included and retainage is not deducted,
 * for the reasons stated on `app.purchase_order_invoiced`.
 *
 * The cost type follows the purchase order it was raised against. An invoice
 * with no purchase order is posted as `other` rather than guessed at, because
 * an unmatched invoice is exactly the case where the platform does not know
 * what was bought.
 */
create or replace function app.post_ap_invoice_cost(p_inv ap_invoices)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ref  text := 'ap_invoice:' || p_inv.id::text;
  v_po   purchase_orders%rowtype;
  v_type text := 'other';
  v_desc text;
begin
  delete from project_costs where company_id = p_inv.company_id and reference = v_ref;

  if p_inv.project_id is null or p_inv.approval_state <> 'approved' then
    return;
  end if;

  if p_inv.purchase_order_id is not null then
    select * into v_po from purchase_orders where id = p_inv.purchase_order_id;
    if found then
      v_type := case v_po.po_type
                  when 'subcontract' then 'subcontract'
                  when 'rental' then 'equipment'
                  when 'service' then 'other'
                  else 'material' end;
    end if;
  end if;

  select coalesce(v.name, 'Vendor') || ' — invoice ' || p_inv.invoice_number
    into v_desc from vendors v where v.id = p_inv.vendor_id;

  insert into project_costs (company_id, project_id, cost_date, cost_type, description,
    quantity, unit_cost, amount, vendor_id, reference, source, is_committed, posted_at)
  values (p_inv.company_id, p_inv.project_id, p_inv.invoice_date, v_type,
    coalesce(v_desc, 'Vendor invoice ' || p_inv.invoice_number),
    1, p_inv.amount + p_inv.tax, p_inv.amount + p_inv.tax, p_inv.vendor_id,
    v_ref, 'accounting_import', false, now());
end;
$$;

create or replace function app.post_ap_invoice_to_job_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    delete from project_costs where company_id = old.company_id
      and reference = 'ap_invoice:' || old.id::text;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    delete from project_costs where company_id = old.company_id
      and reference = 'ap_invoice:' || old.id::text;
  end if;
  perform app.post_ap_invoice_cost(new);
  return new;
end;
$$;

-- Ordered after the invoiced-total sync by name, so the purchase order's open
-- commitment is already correct when this posts the actual cost beside it.
create trigger sync_purchase_order_invoiced
  after insert or update or delete on ap_invoices
  for each row execute function app.sync_purchase_order_invoiced();

create trigger zz_post_ap_invoice_to_job_cost
  after insert or update or delete on ap_invoices
  for each row execute function app.post_ap_invoice_to_job_cost();

comment on function app.post_ap_invoice_cost(ap_invoices) is
  'Writes one approved vendor invoice onto its job, or removes what it wrote. Idempotent by reference, so a correction corrects the job cost and a withdrawn approval takes it back off.';

-- Everything already recorded, posted now.
do $$
declare p purchase_orders%rowtype; i ap_invoices%rowtype;
begin
  for p in select * from purchase_orders loop
    perform app.post_purchase_order_commitment(p);
  end loop;
  for i in select * from ap_invoices loop
    perform app.post_ap_invoice_cost(i);
  end loop;
end;
$$;

select app.assert_security_gates();

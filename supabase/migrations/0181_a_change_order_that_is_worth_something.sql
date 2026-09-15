/**
 * A change order that is worth something.
 *
 * `change_orders` has carried `cost_impact` and `price_impact` since migration
 * 0007, under a comment reading "Priced by the same deterministic engine as the
 * base estimate". `change_order_items` has carried the lines those figures
 * should come from since 0013, with row level security, a tenant trigger and an
 * index.
 *
 * **Nothing has ever written an item.** `create_change_order` deliberately
 * prices nothing — correctly, because a change order is raised before anybody
 * knows what it costs — and nothing was ever built to price it afterwards. So
 * every change order this platform has ever raised is worth $0.00, forever, and
 * `cost_impact` and `price_impact` are two columns that can only ever hold
 * their defaults.
 *
 * That is the expensive kind of nothing. A change order at zero does not look
 * broken: it looks like a change order that has not been priced yet, on a
 * screen that offers no way to price it, and it rolls into the revised contract
 * value as a real zero.
 *
 * **Recomputed, never typed.** The header is the sum of the items, maintained
 * by trigger — the rule from 0170, D-034 and 0179. Nobody types an impact,
 * because a typed impact is a number that stops agreeing with its own detail
 * the first time a line changes.
 *
 * **And it stops when the change order does.** `forbid_executed_change_order_edit`
 * (0032) freezes the impact of an approved or executed change order, because
 * that figure is the amendment to the contract. Items cannot be added to one
 * either, and the recompute leaves a frozen header alone rather than fighting
 * the trigger that protects it.
 *
 * WORKFLOW.
 */

-- -----------------------------------------------------------------------------
-- The header is the sum of the detail
-- -----------------------------------------------------------------------------

/**
 * Set a change order's impact to the sum of its items.
 *
 * `security definer` because it runs from a trigger on the items and writes the
 * header. Silent on an approved or executed change order: 0032 owns that
 * refusal and says it in a sentence about raising a new change order, which is
 * better than a trigger arguing with a trigger.
 */
create or replace function app.recompute_change_order_impact(p_change_order uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_cost   numeric;
  v_price  numeric;
begin
  if p_change_order is null then return; end if;

  select status into v_status from change_orders where id = p_change_order;
  if v_status is null or v_status in ('approved', 'executed') then
    return;
  end if;

  select coalesce(sum(cost_amount), 0), coalesce(sum(price_amount), 0)
    into v_cost, v_price
    from change_order_items where change_order_id = p_change_order;

  update change_orders
     set cost_impact = v_cost, price_impact = v_price, updated_at = now()
   where id = p_change_order;
end;
$$;

comment on function app.recompute_change_order_impact(uuid) is
  'Sets a change order''s cost and price impact to the sum of its items. Recomputed rather than typed, so the header cannot stop agreeing with its own detail. WORKFLOW.';

create or replace function app.sync_change_order_from_items()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.recompute_change_order_impact(old.change_order_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.recompute_change_order_impact(new.change_order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists change_order_items_sync_header on change_order_items;
create trigger change_order_items_sync_header
  after insert or update or delete on change_order_items
  for each row execute function app.sync_change_order_from_items();

comment on function app.sync_change_order_from_items() is
  'Keeps a change order''s impact in step with the lines it is made of. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Pricing one
-- -----------------------------------------------------------------------------

/**
 * Put a priced line on a change order.
 *
 * Cost and price are both taken, and they are not the same question: the cost
 * is what the work takes, the price is what the owner is asked for, and the gap
 * between them is the margin on the change. A change order priced at cost is a
 * change order done for nothing, and that should be a decision somebody made
 * rather than a field nobody filled in — so the price defaults to the cost and
 * says so, rather than defaulting to zero.
 *
 * `price_amount` comes from quantity times unit price when a unit price is
 * given, because a line stating both a rate and a total can disagree with
 * itself. A lump sum passes the price directly and leaves the rate null.
 */
create or replace function app.add_change_order_item(
  p_change_order uuid,
  p_description  text,
  p_cost_amount  numeric,
  p_price_amount numeric default null,
  p_quantity     numeric default null,
  p_unit         app.unit_code default null,
  p_unit_price   numeric default null,
  p_cost_code    uuid default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_co    change_orders%rowtype;
  v_price numeric;
  v_sort  int;
  v_id    uuid;
begin
  select * into v_co from change_orders where id = p_change_order;
  if v_co.id is null then
    raise exception 'No such change order' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_co.company_id, 'projects.write') then
    raise exception 'You do not have permission to price this change order'
      using errcode = 'insufficient_privilege';
  end if;
  if v_co.status in ('approved', 'executed') then
    raise exception
      'Change order % is %; its impact is the amendment and cannot be repriced. Raise a new change order.',
      v_co.number, v_co.status
      using errcode = 'restrict_violation';
  end if;
  if v_co.status in ('rejected', 'withdrawn') then
    raise exception 'Change order % was %; there is nothing to price',
      v_co.number, v_co.status using errcode = 'check_violation';
  end if;

  if coalesce(btrim(coalesce(p_description, '')), '') = '' then
    raise exception 'Say what the line is for' using errcode = 'check_violation';
  end if;
  if p_cost_amount is null or p_cost_amount < 0 then
    raise exception 'A change order line costs zero or more'
      using errcode = 'check_violation',
            hint = 'A credit back to the owner is a negative price on its own line, not a negative cost.';
  end if;
  if p_quantity is not null and p_quantity < 0 then
    raise exception 'A quantity is zero or more' using errcode = 'check_violation';
  end if;

  /*
   * The price: from the rate where there is one, from the figure given where
   * there is not, and from the cost where neither was stated — which is a
   * change order done at cost, and is at least a number somebody can see and
   * argue with rather than a silent zero.
   */
  v_price := case
    when p_unit_price is not null and p_quantity is not null
      then round(p_quantity * p_unit_price, 2)
    when p_price_amount is not null then round(p_price_amount, 2)
    else round(p_cost_amount, 2)
  end;

  select coalesce(max(sort_order), -1) + 1 into v_sort
    from change_order_items where change_order_id = p_change_order;

  insert into change_order_items (
    company_id, change_order_id, sort_order, description, cost_code_id,
    quantity, unit, unit_price, cost_amount, price_amount)
  values (
    v_co.company_id, p_change_order, v_sort, btrim(p_description), p_cost_code,
    coalesce(p_quantity, 0), p_unit, coalesce(p_unit_price, 0),
    round(p_cost_amount, 2), v_price)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.add_change_order_item(uuid, text, numeric, numeric, numeric, app.unit_code, numeric, uuid) is
  'Puts a priced line on a change order. The only writer of change_order_items — before 0181 nothing wrote one, so every change order was worth $0 forever. WORKFLOW.';

/** Take a line off. The header falls with it, because the header is the sum. */
create or replace function app.remove_change_order_item(p_item uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_status  text;
  v_number  text;
begin
  select i.company_id, c.status, c.number into v_company, v_status, v_number
    from change_order_items i
    join change_orders c on c.id = i.change_order_id
   where i.id = p_item;
  if v_company is null then
    raise exception 'No such change order line' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to change this change order'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status in ('approved', 'executed') then
    raise exception 'Change order % is %; its lines are the amendment',
      v_number, v_status using errcode = 'restrict_violation';
  end if;

  delete from change_order_items where id = p_item;
end;
$$;

comment on function app.remove_change_order_item(uuid) is
  'Removes a change order line. The impact is recomputed without it. WORKFLOW.';

-- -----------------------------------------------------------------------------
-- Doors
-- -----------------------------------------------------------------------------

/**
 * What a change order is made of, and what it is worth.
 *
 * `margin` is on the row because the gap between what the work costs and what
 * the owner is asked for is the decision a change order actually contains, and
 * it is the one nobody sees when only a total is shown.
 */
create or replace view my_change_order_items as
select i.id,
       i.company_id,
       i.change_order_id,
       i.sort_order,
       i.description,
       i.quantity,
       i.unit,
       i.unit_price,
       i.cost_amount,
       i.price_amount,
       (i.price_amount - i.cost_amount) as margin,
       cc.code as cost_code,
       cc.name as cost_code_name,
       c.number as change_order_number,
       c.status as change_order_status,
       c.project_id
  from change_order_items i
  join change_orders c on c.id = i.change_order_id
  left join cost_codes cc on cc.id = i.cost_code_id;

revoke all on my_change_order_items from public, anon;
grant select on my_change_order_items to authenticated;
alter view my_change_order_items set (security_invoker = on);

comment on view my_change_order_items is
  'The priced lines of a change order, with the margin on each. change_order_items has existed since 0013 and held no rows until 0181.';

create or replace function public.add_change_order_item(
  p_change_order uuid, p_description text, p_cost_amount numeric,
  p_price_amount numeric default null, p_quantity numeric default null,
  p_unit app.unit_code default null, p_unit_price numeric default null,
  p_cost_code uuid default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.add_change_order_item(p_change_order, p_description, p_cost_amount,
       p_price_amount, p_quantity, p_unit, p_unit_price, p_cost_code); $$;

create or replace function public.remove_change_order_item(p_item uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_change_order_item(p_item); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_change_order_item(uuid, text, numeric, numeric, numeric, app.unit_code, numeric, uuid)',
    'public.remove_change_order_item(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

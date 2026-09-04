-- =============================================================================
-- 0045 — The number sent to the customer, unchecked against the number the
--        engine computed
--
-- A proposal must cite an estimate version — `estimate_version_id` is NOT NULL,
-- and that was the whole of the connection. Everything else about the price was
-- free text. Reproduced against real PostgreSQL before this was written:
--
--   * a proposal was **issued from a draft estimate** — one nobody had
--     approved, whose contingency and confidence band had been through no
--     review at all;
--   * it was issued at **a total price of zero while the estimate it cited bid
--     $1,200,000**, and nothing objected;
--   * a **line item of $5 was added against that stated total of zero**;
--   * and the line item was added **after the proposal was issued**, to a
--     proposal the platform had already frozen.
--
-- That last one is the most misleading. `app.enforce_proposal_immutability()`
-- refuses to let an issued proposal change and says so — "its content is fixed;
-- issue a new proposal instead" — while the content lives in
-- `proposal_line_items`, a different table the trigger never touched. The
-- header was frozen and every line of the document could still be rewritten.
--
-- RULE-008 says deterministic estimating output is authoritative and AI may not
-- overwrite it. The same reasoning applies with more force to a human typing a
-- number into the document that goes to the customer: the engine computes the
-- bid price, and the proposal presents it.
-- =============================================================================

/**
 * The base scope of a proposal: what the customer is being asked to pay for
 * before alternates and options.
 *
 * Null rather than zero when there are no line items, so "this proposal carries
 * no detail" stays distinguishable from "this proposal's detail adds to
 * nothing". Only the first of those is allowed to skip the tie-out below.
 */
create or replace function app.proposal_base_total(p_proposal uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select sum(extended_price)
  from proposal_line_items
  where proposal_id = p_proposal
    and not is_alternate
    and not is_optional;
$$;

grant execute on function app.proposal_base_total(uuid) to authenticated, service_role;

comment on function app.proposal_base_total(uuid) is
  'The base price of a proposal from its own line items, excluding alternates and options. Null when the proposal carries no detail, which is different from a detail that sums to nothing.';

/**
 * A proposal presents an estimate; it does not have an opinion about it.
 *
 * Three rules, in the order they matter:
 *
 *   1. **The price is derived, not typed.** While a proposal is a draft its
 *      total is the cited version's bid price — the engine's own output after
 *      markup and bid rounding. There is no way to state a different number.
 *   2. **Nothing is sent from an unapproved estimate.** Leaving draft requires
 *      the cited version to be approved, issued or awarded. An estimate still
 *      in review is a working document, and a price taken off one is a
 *      commitment nobody authorized.
 *   3. **The detail must agree with the total.** If the proposal carries line
 *      items, their base scope must tie to the price on its face at the moment
 *      it is issued.
 *
 * Once issued the total is left exactly as it went out. Re-deriving it later
 * would let a subsequent estimate revision quietly restate a price a customer
 * has already been given, which is the opposite of what this migration is for.
 */
create or replace function app.enforce_proposal_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_status app.estimate_status;
  v_bid    numeric;
  v_base   numeric;
begin
  select ev.status, ev.bid_price into v_status, v_bid
  from estimate_versions ev where ev.id = new.estimate_version_id;

  if not found then
    raise exception 'Proposal % cites an estimate version that does not exist.', new.number
      using errcode = 'foreign_key_violation';
  end if;

  -- Derived while it is still a draft, and on a proposal created already
  -- issued. Never afterwards: what went out is what went out.
  if tg_op = 'INSERT' or new.status = 'draft' then
    new.total_price := v_bid;
  end if;

  -- Only on the way out of draft, so a draft can be built up in any order.
  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    if v_status not in ('approved', 'issued', 'awarded') then
      raise exception
        'Proposal % cites an estimate version that is %. A price cannot be sent to a customer from an estimate nobody has approved.',
        new.number, v_status
        using errcode = 'restrict_violation';
    end if;

    v_base := app.proposal_base_total(new.id);
    if v_base is not null and abs(v_base - new.total_price) > 0.01 then
      raise exception
        'Proposal % states %, and its base line items add to %. The detail and the total must agree before it goes to a customer.',
        new.number, new.total_price, v_base
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Named to sort after enforce_proposal_immutability, which must see the row as
-- the caller submitted it before this one derives anything on top.
create trigger enforce_proposal_integrity
  before insert or update on proposals
  for each row execute function app.enforce_proposal_integrity();

comment on function app.enforce_proposal_integrity() is
  'Ties a proposal to the estimate it cites: the price is the engine bid price rather than a typed number, nothing leaves draft from an unapproved estimate, and the line detail must agree with the total on the way out.';

-- -----------------------------------------------------------------------------
-- Freezing the content, not just the cover
-- -----------------------------------------------------------------------------
/**
 * An issued proposal's line items stop changing with it.
 *
 * `app.enforce_proposal_immutability()` has always said an issued proposal's
 * "content is fixed" and only ever guarded the header row. The content is here,
 * in another table, and it was fully editable — so the document a customer
 * holds and the document the platform stores could differ line by line while
 * the platform reported the proposal as frozen.
 */
create or replace function app.enforce_proposal_line_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_proposal proposals%rowtype;
begin
  select * into v_proposal from proposals
   where id = coalesce(new.proposal_id, old.proposal_id);

  if found and v_proposal.status <> 'draft' then
    raise exception
      'Proposal % is % and its line items are fixed; % is not permitted. Issue a new proposal instead.',
      v_proposal.number, v_proposal.status, tg_op
      using errcode = 'restrict_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger enforce_proposal_line_lock
  before insert or update or delete on proposal_line_items
  for each row execute function app.enforce_proposal_line_lock();

comment on function app.enforce_proposal_line_lock() is
  'Holds an issued proposal''s line items as fixed as its header. The immutability control had always claimed the content was frozen while the content lived in this table and was not.';

select app.assert_security_gates();

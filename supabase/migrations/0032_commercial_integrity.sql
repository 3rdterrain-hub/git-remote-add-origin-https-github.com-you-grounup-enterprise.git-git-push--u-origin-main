-- =============================================================================
-- 0032 — Commercial integrity: agreed records, derived deadlines, real evidence
--
-- RULE-009 makes an issued estimate immutable, and the platform enforces it
-- properly. An issued estimate is an offer. Nothing protected the records that
-- follow it, which are obligations:
--
--   * An **executed contract**'s notice_days, claim_days, liquidated damages,
--     retainage and original value were all editable after execution — and
--     claim deadlines are derived from two of those clauses.
--   * An **executed change order**'s price_impact was editable. A change order
--     is a contract amendment; its price is the amendment.
--   * A **settled claim**'s cost_awarded and resolution were editable after the
--     claim was resolved.
--
-- Two further defects, both of the same family the platform has now found four
-- times — a value the interface presents as derived that a caller can simply
-- type:
--
--   * `derive_claim_deadlines` computed a deadline **only when the column was
--     null**, so supplying `notice_due_on` bypassed the contract clause with no
--     record that it had been bypassed. And nothing re-derived a deadline when
--     the clause it came from was edited, so a stored deadline could disagree
--     with the contract it claims to be from.
--   * A claim's supporting daily reports, RFIs and documents were plain `uuid[]`
--     columns with no integrity at all. A claim could cite a record that does
--     not exist, was deleted, or belongs to another company — while the schema
--     comment calls them "the contemporaneous records a claim actually rests
--     on". A claim is won or lost on those records.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- An agreed record cannot be rewritten
-- -----------------------------------------------------------------------------

/**
 * Freeze the commercial terms of an executed contract.
 *
 * Not the whole row: a contract legitimately moves from executed to active to
 * closed, and administrative fields like the stored document path may be
 * corrected. What is frozen is what the parties agreed — the value, the
 * completion dates and the clauses a claim will be argued under.
 *
 * A genuine amendment is a change order, which is what change orders are for.
 */
create or replace function app.forbid_executed_contract_edit()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;

  if new.original_value is distinct from old.original_value
     or new.contract_type is distinct from old.contract_type
     or new.notice_days is distinct from old.notice_days
     or new.claim_days is distinct from old.claim_days
     or new.liquidated_damages_per_day is distinct from old.liquidated_damages_per_day
     or new.retainage_percent is distinct from old.retainage_percent
     or new.executed_on is distinct from old.executed_on
     or new.substantial_completion_on is distinct from old.substantial_completion_on
     or new.final_completion_on is distinct from old.final_completion_on then
    raise exception
      'Contract % is % and its agreed terms cannot be changed. Amend it with a change order.',
      old.number, old.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger contracts_terms_frozen
  before update on contracts
  for each row execute function app.forbid_executed_contract_edit();

comment on function app.forbid_executed_contract_edit() is
  'An executed contract''s value, dates and clauses are what the parties agreed. Claim deadlines derive from two of those clauses, so editing them retroactively would move deadlines on claims already filed.';

/**
 * Freeze a change order once it is approved or executed.
 *
 * The price impact of an executed change order is the amendment. Editing it
 * afterwards changes the contract value with no record that it moved.
 */
create or replace function app.forbid_executed_change_order_edit()
returns trigger
language plpgsql
as $$
begin
  if old.status not in ('approved', 'executed') then
    return new;
  end if;

  -- Approved may still advance to executed; executed is the end of the line.
  if old.status = 'approved' and new.status = 'executed'
     and new.cost_impact is not distinct from old.cost_impact
     and new.price_impact is not distinct from old.price_impact
     and new.schedule_impact_days is not distinct from old.schedule_impact_days then
    return new;
  end if;

  if new.cost_impact is distinct from old.cost_impact
     or new.price_impact is distinct from old.price_impact
     or new.schedule_impact_days is distinct from old.schedule_impact_days
     or new.estimate_version_id is distinct from old.estimate_version_id
     or new.status is distinct from old.status then
    raise exception
      'Change order % is % and its impact cannot be changed. Raise a new change order.',
      old.number, old.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger change_orders_impact_frozen
  before update on change_orders
  for each row execute function app.forbid_executed_change_order_edit();

/**
 * Freeze a claim once it is resolved.
 *
 * What was awarded, and on what reasoning, is the record of a settlement.
 */
create or replace function app.forbid_resolved_claim_edit()
returns trigger
language plpgsql
as $$
begin
  if old.status not in ('settled', 'denied') then
    return new;
  end if;

  if new.cost_awarded is distinct from old.cost_awarded
     or new.time_awarded_days is distinct from old.time_awarded_days
     or new.resolution is distinct from old.resolution
     or new.resolved_on is distinct from old.resolved_on
     or new.cost_claimed is distinct from old.cost_claimed
     or new.time_claimed_days is distinct from old.time_claimed_days
     or new.status is distinct from old.status then
    raise exception
      'Claim % is % and its award cannot be changed. Reopening a settled claim is a new claim.',
      old.number, old.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger claims_award_frozen
  before update on claims
  for each row execute function app.forbid_resolved_claim_edit();

-- -----------------------------------------------------------------------------
-- A deadline is derived, not typed
-- -----------------------------------------------------------------------------

/**
 * Derive the notice and claim deadlines from the contract's clauses, always.
 *
 * The previous version computed a deadline only when the column was null,
 * which meant supplying one bypassed the contract entirely and left no record
 * that it had been bypassed. Most construction claims are lost on the notice
 * clause rather than on their merits, so a deadline that disagrees with the
 * contract is the most dangerous field in this table.
 *
 * A deadline is now always computed from the clause. A caller who supplies a
 * different one is refused and told to record it as a value override — the
 * mechanism this platform already uses for a person overriding a computed
 * figure, which requires a reason and a separate approver.
 */
create or replace function app.derive_claim_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_notice_days int;
  v_claim_days  int;
  v_notice_due  date;
  v_claim_due   date;
begin
  if new.contract_id is null then
    return new;
  end if;

  select notice_days, claim_days into v_notice_days, v_claim_days
  from contracts where id = new.contract_id;

  v_notice_due := case when v_notice_days is null then null
                       else new.event_date + v_notice_days end;
  v_claim_due  := case when v_claim_days is null then null
                       else new.event_date + v_claim_days end;

  /*
   * On an update, only a deadline the caller actually touched is a claim about
   * what the deadline should be. A stored deadline left alone while the event
   * date moves is simply stale, and re-deriving it is the whole point —
   * refusing it there would mean an event date could never be corrected.
   */
  if tg_op = 'UPDATE' then
    if new.notice_due_on is not distinct from old.notice_due_on then
      new.notice_due_on := null;
    end if;
    if new.claim_due_on is not distinct from old.claim_due_on then
      new.claim_due_on := null;
    end if;
  end if;

  if v_notice_due is not null
     and new.notice_due_on is not null
     and new.notice_due_on <> v_notice_due then
    raise exception
      'Notice is due % under the contract''s % day clause, not %. Record a different date as a value override on claims.notice_due_on, with a reason and an approver.',
      v_notice_due, v_notice_days, new.notice_due_on
      using errcode = 'check_violation';
  end if;

  if v_claim_due is not null
     and new.claim_due_on is not null
     and new.claim_due_on <> v_claim_due then
    raise exception
      'The claim is due % under the contract''s % day clause, not %. Record a different date as a value override on claims.claim_due_on, with a reason and an approver.',
      v_claim_due, v_claim_days, new.claim_due_on
      using errcode = 'check_violation';
  end if;

  new.notice_due_on := coalesce(v_notice_due, new.notice_due_on);
  new.claim_due_on  := coalesce(v_claim_due, new.claim_due_on);
  return new;
end;
$$;

-- Fire on every insert and update, not only when the event date or contract
-- changes: a deadline written directly into the column has to be caught too.
drop trigger if exists derive_claim_deadlines on claims;
create trigger derive_claim_deadlines
  before insert or update on claims
  for each row execute function app.derive_claim_deadlines();

comment on function app.derive_claim_deadlines() is
  'Computes notice and claim deadlines from the contract clause and refuses a supplied value that disagrees. A deadline that differs from the contract is a decision, and a decision belongs in value_overrides where it carries a reason and an approver.';

-- -----------------------------------------------------------------------------
-- Supporting evidence has to exist
-- -----------------------------------------------------------------------------

/**
 * Every record a claim cites must exist and belong to the same company.
 *
 * These are `uuid[]` columns rather than join tables, which is a reasonable
 * shape for a short list of citations but gives no integrity at all on its own.
 * A claim citing another company's daily report would be a cross-tenant read
 * the moment anybody rendered it, and a claim citing a deleted report is a
 * claim resting on evidence that is not there.
 */
create or replace function app.enforce_claim_evidence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_missing uuid[];
begin
  select array_agg(id) into v_missing from (
    select unnest(new.supporting_daily_reports) as id
    except
    select d.id from daily_reports d
    where d.company_id = new.company_id and d.id = any (new.supporting_daily_reports)
  ) q;
  if v_missing is not null then
    raise exception 'Claim % cites daily report(s) % that do not exist in this company.',
      new.number, v_missing using errcode = 'foreign_key_violation';
  end if;

  select array_agg(id) into v_missing from (
    select unnest(new.supporting_rfis) as id
    except
    select r.id from rfis r
    where r.company_id = new.company_id and r.id = any (new.supporting_rfis)
  ) q;
  if v_missing is not null then
    raise exception 'Claim % cites RFI(s) % that do not exist in this company.',
      new.number, v_missing using errcode = 'foreign_key_violation';
  end if;

  select array_agg(id) into v_missing from (
    select unnest(new.supporting_documents) as id
    except
    select d.id from documents d
    where d.company_id = new.company_id and d.id = any (new.supporting_documents)
  ) q;
  if v_missing is not null then
    raise exception 'Claim % cites document(s) % that do not exist in this company.',
      new.number, v_missing using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger claims_evidence_exists
  before insert or update on claims
  for each row execute function app.enforce_claim_evidence();

comment on function app.enforce_claim_evidence() is
  'A claim rests on contemporaneous records. Citing one that does not exist, or one belonging to another company, is refused at write time because nothing else would catch it.';

select app.assert_security_gates();

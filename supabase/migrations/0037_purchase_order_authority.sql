-- =============================================================================
-- 0037 — Signing authority on purchase orders
--
-- Migration 0033 gave the platform commercial authority: per-company signing
-- limits, enforced when a record crosses into a committing state, naming the
-- tier held and the tier needed. It covered change orders, contracts and claim
-- settlements.
--
-- It did not cover purchase orders, which is the commitment a construction
-- company makes most often. A purchase order carries `committed_amount` — the
-- cost the company is on the hook for before any invoice arrives — and anyone
-- holding `procurement.write` could issue one of any size.
--
-- Procurement's other controls are strong and were already there: an invoice
-- cannot exceed its commitment, a payment cannot exceed its invoice, a
-- three-way match refuses a mismatch, an award must name a vendor and a
-- reason, a delivery that is not accepted must say why, an inventory
-- adjustment must be explained. Every one of those governs what happens
-- *after* the commitment. Nothing governed the commitment.
-- =============================================================================

alter table commercial_authority_limits
  drop constraint commercial_authority_limits_record_type_check;

alter table commercial_authority_limits
  add constraint commercial_authority_limits_record_type_check
  check (record_type in ('change_order', 'contract', 'claim_settlement', 'purchase_order'));

comment on column commercial_authority_limits.record_type is
  'What is being committed. An explicit list rather than free text, because a limit on a record type nothing checks is a limit nobody has.';

/*
 * Checked on the crossing into `issued`, not on every edit.
 *
 * A draft purchase order of any size is a quote somebody is working up, and
 * working one up is not committing to it — the same reasoning as a draft
 * change order and a draft contract. Once issued, the vendor has a document
 * the company is bound by.
 */
create trigger purchase_orders_authority
  before insert or update on purchase_orders
  for each row execute function app.enforce_commercial_authority(
    'purchase_order', 'committed_amount', 'issued,partially_received,received,closed');

comment on trigger purchase_orders_authority on purchase_orders is
  'A purchase order is the commitment a contractor makes most often, and it was the one commitment with no signing limit.';

select app.assert_security_gates();

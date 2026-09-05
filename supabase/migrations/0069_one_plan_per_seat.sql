-- =============================================================================
-- 0069 — One plan, priced per seat, with the two real costs metered
--
-- The catalog shipped five tiers. Tiers make sense where different customers
-- need different capabilities, and in construction they do not: a one-man shop
-- and a forty-person contractor both need estimating, takeoff, projects, fleet
-- and job cost, and neither needs a "professional" version of estimating
-- because there is no such thing.
--
-- Gating features by tier therefore means the smallest customer evaluates a
-- deliberately crippled product — which is the worst possible arrangement for a
-- platform whose cheapest tier is also its demo.
--
-- What actually varies is scale. So: one plan, everything in it, priced per
-- seat, with the two things that genuinely cost money to serve measured rather
-- than tiered.
--
-- **AI credits are a flow.** Requests happen, they are counted over the paid
-- period, and `usage_events` has recorded them since the document analyst was
-- built. Nothing changes.
--
-- **Storage is a level, and that distinction is the whole reason migration 0039
-- said it could not be metered.** `app.current_usage` sums events within a
-- period, which is right for consumption and wrong for occupancy: summing
-- upload events would bill a company for bytes they deleted last week. Storage
-- has to be measured — what is held right now — rather than accumulated. It is
-- derivable from `document_versions.byte_size`, so it is derived, and it cannot
-- go stale the way a running total would.
--
-- The old plans are retired rather than deleted. They are versioned commercial
-- terms and anything that ever bought under one still points at it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seats, measured
-- -----------------------------------------------------------------------------
/**
 * How many seats a company is billed for.
 *
 * Active memberships. Not invited-and-never-accepted, and not removed people:
 * a seat is somebody who can sign in and do work, which is the only definition
 * a customer will accept when they read the invoice.
 */
create or replace function app.billable_seats(p_company uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::int from company_memberships
  where company_id = p_company and status = 'active';
$$;

grant execute on function app.billable_seats(uuid) to authenticated, service_role;

comment on function app.billable_seats(uuid) is
  'Seats billed: people who can sign in and do work. Not pending invitations and not removed members — any other definition produces an invoice a customer will dispute, correctly.';

-- -----------------------------------------------------------------------------
-- Storage, measured rather than accumulated
-- -----------------------------------------------------------------------------
/**
 * Bytes a company is currently holding.
 *
 * Measured, not summed from events. Storage is occupancy: what matters is what
 * is held now, and a running total of uploads would charge for everything ever
 * deleted. Derived from the file sizes already recorded on document versions,
 * so it cannot drift from what is actually stored.
 *
 * A version with no recorded size contributes nothing rather than a guess. That
 * understates rather than overstates, which is the right direction for a number
 * on an invoice, and `reporting_company_usage` reports how many are unmeasured
 * so the understatement is visible rather than silent.
 */
create or replace function app.storage_bytes(p_company uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(dv.byte_size), 0)::bigint
  from document_versions dv
  where dv.company_id = p_company;
$$;

grant execute on function app.storage_bytes(uuid) to authenticated, service_role;

comment on function app.storage_bytes(uuid) is
  'Bytes currently held, measured from recorded file sizes. Storage is occupancy rather than consumption: summing upload events — which is what app.current_usage does, correctly, for AI requests — would bill for everything ever deleted.';

-- -----------------------------------------------------------------------------
-- The three billing inputs, in one place
-- -----------------------------------------------------------------------------
create or replace view reporting_company_usage
with (security_invoker = true) as
select
  c.id                                    as company_id,
  c.name,

  app.billable_seats(c.id)                as seats,

  -- A flow: requests within the paid period.
  app.current_usage(c.id, 'ai.request')   as ai_requests_this_period,
  app.plan_limit(c.id, 'ai_credits_per_month') as ai_credits_included,

  -- A level: what is held right now.
  app.storage_bytes(c.id)                 as storage_bytes,
  round(app.storage_bytes(c.id) / 1073741824.0, 3) as storage_gb,
  app.plan_limit(c.id, 'storage_gb')      as storage_gb_included,

  /*
   * How much of the stored total is unmeasured. A file whose size was never
   * recorded contributes nothing above, so this says how far the figure could
   * be understated rather than leaving it to be discovered on a dispute.
   */
  (select count(*) from document_versions dv
    where dv.company_id = c.id and dv.byte_size is null) as files_without_a_size
from companies c;

comment on view reporting_company_usage is
  'The three things a company is billed on: seats it holds, AI requests it made this period, and bytes it is currently storing. Seats and storage are measured; AI is metered. files_without_a_size says how far the storage figure could be understated, because an invoice line nobody can reconcile is worse than a slightly low one.';

grant select on reporting_company_usage to authenticated;
revoke all on reporting_company_usage from anon;

-- -----------------------------------------------------------------------------
-- The catalog itself is seed data
--
-- The one-plan catalog lives in `supabase/seed/0002_plan_catalog.sql` rather
-- than here, because plans are data and this file is schema. Putting the
-- retirement in a migration also happened not to work: migrations run before
-- seeds, so it retired rows the seed then re-inserted as active — a change that
-- looked applied and was undone eight seconds later.
--
-- What belongs here is the two column comments the new pricing makes true.
-- -----------------------------------------------------------------------------
comment on column plans.max_seats is
  'A ceiling on people, where a plan has one. Null on the per-seat plan on purpose: seats are what is billed rather than what is capped, and a limit here would refuse the eleventh person on a plan that charges for the eleventh person.';

comment on column plans.storage_gb is
  'Gigabytes included. Measured against app.storage_bytes(), which reports occupancy rather than a sum of upload events — storage is a level and metering it as a flow would bill for deleted files.';

-- -----------------------------------------------------------------------------
-- Storage, enforced the same way AI credits are
-- -----------------------------------------------------------------------------
/**
 * Is this company inside its storage allowance?
 *
 * Deliberately shaped like `app.ai_request_allowed`, and deliberately not
 * routed through `app.usage_allowance`: that function compares a period sum
 * against a limit, which is the right arithmetic for requests and the wrong one
 * for occupancy.
 *
 * A null allowance is unlimited, and so is having no active entitlement — the
 * same permissive default as everywhere else in this schema. A billing gap must
 * not become an outage.
 */
create or replace function app.storage_within_allowance(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when app.plan_limit(p_company, 'storage_gb') is null then true
    else app.storage_bytes(p_company)
         <= app.plan_limit(p_company, 'storage_gb')::bigint * 1073741824
  end;
$$;

grant execute on function app.storage_within_allowance(uuid) to authenticated, service_role;

comment on function app.storage_within_allowance(uuid) is
  'Whether a company is inside its storage allowance, measured as occupancy. Shaped like the AI credit check and deliberately not built on app.usage_allowance, which sums a period and would therefore charge for deleted files.';

-- -----------------------------------------------------------------------------
-- Reachable from a browser
-- -----------------------------------------------------------------------------
create or replace function public.billable_seats(p_company uuid)
returns int language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.billable_seats(p_company); $$;

create or replace function public.storage_bytes(p_company uuid)
returns bigint language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.storage_bytes(p_company); $$;

create or replace function public.storage_within_allowance(p_company uuid)
returns boolean language sql stable security invoker set search_path = public, pg_catalog
as $$ select app.storage_within_allowance(p_company); $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.billable_seats(uuid)',
    'public.storage_bytes(uuid)',
    'public.storage_within_allowance(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end $$;

select app.assert_security_gates();

-- =============================================================================
-- 0067 — Haul priced by the trip
--
-- `trucking_rates` carried an hourly rate and a `preliminary_unit_rate`, which
-- covers two of the three ways a haul is actually bought and misses the
-- commonest one. A trucker quotes "$85 a load". That is not an hourly rate and
-- it is not a rate per cubic yard.
--
-- The difference is not pedantry. **You pay for the truck that arrives, not the
-- dirt in it**, so a partial load costs a whole trip: 1,200 CY at 14 CY a truck
-- is 85.71 loads and 86 trips paid. Priced as a rate per yard that is short by
-- most of a trip on every job, and on a small haul the unfilled part of the
-- last truck is a large share of the bill.
--
-- So a rate now says which of the three bases it is, and carries the figure
-- that basis needs:
--
--   * **cycle** — the hourly rate, with the load, dump and speed figures the
--     engine needs to work out a real haul cycle. The most defensible, and the
--     only one that also tells you how many trucks the loader needs and how
--     long the haul takes.
--   * **per_trip** — a negotiated price for one load, with an optional minimum
--     billable quantity for a quote written as "$12 a ton, 22-ton minimum".
--   * **per_unit** — a rate per ton or yard. Defensible as a number and it
--     contains no schedule; RULE-004 already treats it as preliminary.
--
-- A rate must carry the figure its own basis needs. A trip-priced rate with no
-- trip price is not a rate, and finding that out when an estimate fails to
-- price is finding out too late.
-- =============================================================================

alter table trucking_rates
  add column if not exists pricing_basis text not null default 'cycle'
    check (pricing_basis in ('cycle', 'per_trip', 'per_unit')),
  add column if not exists rate_per_trip numeric(14,2)
    check (rate_per_trip is null or rate_per_trip >= 0),
  add column if not exists minimum_billable_quantity numeric(14,4)
    check (minimum_billable_quantity is null or minimum_billable_quantity > 0),
  /*
   * Whether a partial load is paid as a whole trip. True is what "per trip"
   * means; a quote that genuinely prorates the last load is rare enough to be
   * worth stating rather than assuming.
   */
  add column if not exists charges_whole_trips boolean not null default true;

comment on column trucking_rates.pricing_basis is
  'Which of the three ways this haul is bought. cycle: hourly, with the load, dump and speed figures for a real cycle analysis — the only basis that also yields a duration and a truck count. per_trip: a price per load, where a partial load is still a whole trip. per_unit: a rate per ton or yard, which RULE-004 treats as preliminary.';

comment on column trucking_rates.minimum_billable_quantity is
  'Quantity billed per trip whether or not the truck is filled — "$12 a ton, 22-ton minimum". Defaults to the truck''s capacity, which is the usual arrangement.';

-- A rate must carry the figure its own basis needs.
alter table trucking_rates drop constraint if exists trucking_rates_basis_has_its_figure;
alter table trucking_rates
  add constraint trucking_rates_basis_has_its_figure
    check (
      (pricing_basis = 'cycle'    and hourly_rate is not null)
      or (pricing_basis = 'per_trip' and rate_per_trip is not null)
      or (pricing_basis = 'per_unit' and preliminary_unit_rate is not null)
    );

/*
 * A trip-priced haul needs to know what a truck holds, or the trip count cannot
 * be worked out. `capacity` is already not null, so this only guards the case
 * of a capacity entered as zero.
 */
alter table trucking_rates drop constraint if exists trucking_rates_trip_needs_capacity;
alter table trucking_rates
  add constraint trucking_rates_trip_needs_capacity
    check (pricing_basis <> 'per_trip' or capacity > 0);

/**
 * What a haul costs, by whichever basis its rate is written on.
 *
 * A view rather than a function because it answers a question about rows that
 * already exist — "what would this rate cost for this quantity" — and because
 * a company comparing three quotes wants them side by side on one effective
 * rate per unit rather than three headline numbers in different shapes.
 *
 * The trip arithmetic is duplicated from `packages/engine/src/trucking.ts`
 * rather than shared, which is a real cost and the alternative was worse: the
 * engine cannot be called from SQL, and a company comparing quotes on a screen
 * should not need an Edge Function round trip per row. A test runs the same
 * cases through both and fails if they ever disagree.
 */
create or replace function app.haul_cost(
  p_rate_id  uuid,
  p_quantity numeric
)
returns table (
  pricing_basis text,
  trips_paid numeric,
  cost numeric,
  effective_rate_per_unit numeric,
  unused_capacity numeric
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    r.pricing_basis,
    case when r.pricing_basis = 'per_trip' then
      case when r.charges_whole_trips
           then ceil(p_quantity / nullif(r.capacity, 0))
           else round(p_quantity / nullif(r.capacity, 0), 4) end
    end as trips_paid,
    case r.pricing_basis
      when 'per_trip' then round(
        (case when r.charges_whole_trips
              then ceil(p_quantity / nullif(r.capacity, 0))
              else p_quantity / nullif(r.capacity, 0) end) * r.rate_per_trip, 2)
      when 'per_unit' then round(p_quantity * r.preliminary_unit_rate, 2)
      -- A cycle-priced haul has no cost without a cycle analysis, and inventing
      -- one from the hourly rate alone would be the shortcut this basis exists
      -- to avoid.
      else null
    end as cost,
    case r.pricing_basis
      when 'per_trip' then round(
        ((case when r.charges_whole_trips
               then ceil(p_quantity / nullif(r.capacity, 0))
               else p_quantity / nullif(r.capacity, 0) end) * r.rate_per_trip)
        / nullif(p_quantity, 0), 4)
      when 'per_unit' then r.preliminary_unit_rate
      else null
    end as effective_rate_per_unit,
    case when r.pricing_basis = 'per_trip' and r.charges_whole_trips then
      greatest(
        ceil(p_quantity / nullif(r.capacity, 0))
          * coalesce(r.minimum_billable_quantity, r.capacity) - p_quantity, 0)
    end as unused_capacity
  from trucking_rates r
  where r.id = p_rate_id;
$$;

grant execute on function app.haul_cost(uuid, numeric) to authenticated;

comment on function app.haul_cost(uuid, numeric) is
  'What a haul costs under whichever basis its rate carries, so three quotes in three shapes can be compared on one effective rate per unit. Returns no cost for a cycle-priced rate: that basis has no cost without a cycle analysis, and deriving one from the hourly rate alone would be the shortcut it exists to avoid.';

select app.assert_security_gates();

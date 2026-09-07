-- =============================================================================
-- 0107 — Building a line the way an estimator does
--
-- `estimate_line_resources` has held the crew, machines, materials, trucks and
-- subcontracts behind a line since migration 0006, and no screen has ever let
-- anybody put one there. So an estimate line is a service and a quantity, and
-- everything that decides what the work actually costs — two operators and a
-- laborer, a D5 and a skid steer on a weekly rate with mobilization, a quad
-- axle running a twenty-one minute cycle — has had nowhere to go.
--
-- Three things are missing for that to work, and none of them is arithmetic:
-- the engine already prices all of it.
--
--   * **What the customer is allowed to see.** An estimator shows a client a
--     lump sum for excavation and keeps the crew composition to themselves.
--     That is a presentation choice per line and per cost category, and the
--     platform had no way to record it — so a proposal either disclosed the
--     whole build-up or nothing.
--
--   * **What a single line is marked up at.** A profile carries the company's
--     standard markup; a line sometimes differs, and the difference is the
--     estimator's judgment about that scope rather than a new profile.
--
--   * **A resource's own place in the line.** Which rows drive the hours, and
--     what order they read in. `estimate_line_resources` has no sort order at
--     all, so a crew list comes back in whatever order the table returns.
--
-- Everything below is an *input*. Not one of these columns is an engine output,
-- which is why none of them is guarded by 0058: they are what the estimator
-- says, and the engine's job is to price what they said.
-- =============================================================================

alter table estimate_line_items
  -- Default true because the usual case is a line the customer sees. A hidden
  -- line is still priced and still in the internal total; it is left off the
  -- document.
  add column if not exists client_visible boolean not null default true,
  -- Null means "whatever the pricing profile says". A number here is this
  -- line's own markup, and it is a fraction rather than a percentage so it
  -- reads the same way every other rate in the schema does.
  add column if not exists markup_override numeric(8,6)
    check (markup_override is null or (markup_override >= 0 and markup_override <= 5));

comment on column estimate_line_items.client_visible is
  'Whether this line appears on the proposal. A hidden line is still priced and still counted internally — an estimator shows a client a lump sum for excavation and keeps the build-up to themselves.';

comment on column estimate_line_items.markup_override is
  'This line''s own markup as a fraction, or null to use the pricing profile. A line that differs from the company standard is the estimator''s judgment about that scope, not a reason to make a new profile.';

create index if not exists eli_client_visible_idx on estimate_line_items(estimate_version_id)
  where not client_visible;

/*
 * What the customer sees of the build-up.
 *
 * Per category rather than one switch, because the decision genuinely differs:
 * a contractor will happily show a client the material and the trucking, and
 * will not show them what the crew costs.
 */
alter table estimate_versions
  add column if not exists show_labor      boolean not null default false,
  add column if not exists show_equipment  boolean not null default false,
  add column if not exists show_materials  boolean not null default true,
  add column if not exists show_hauling    boolean not null default true,
  add column if not exists show_subcontract boolean not null default true;

comment on column estimate_versions.show_labor is
  'Whether the proposal discloses labor cost. Defaults off: a customer is shown a price for the work, and what the crew costs is the contractor''s business unless they choose otherwise.';

/*
 * Order, and which rows drive the line's hours.
 *
 * `drives_hours` is the "Prod/Hr" checkbox an estimator ticks on the machines
 * that actually govern production. Two dozers at 100 units an hour are 200
 * between them, and everything else on the line works those same hours — so
 * which rows count has to be recorded rather than assumed from the kind.
 */
alter table estimate_line_resources
  add column if not exists sort_order int not null default 0,
  add column if not exists drives_hours boolean not null default false,
  add column if not exists production_per_hour numeric(16,6)
    check (production_per_hour is null or production_per_hour > 0),
  -- How a machine is billed. An hourly rate and a weekly rate are different
  -- numbers with different rounding, and the difference is most of what an
  -- equipment line costs.
  add column if not exists rate_basis text not null default 'hour'
    check (rate_basis in ('hour', 'day', 'week', 'month', 'unit', 'lump')),
  add column if not exists mobilization_cost numeric(16,2) not null default 0
    check (mobilization_cost >= 0),
  add column if not exists standby_days numeric(10,2) not null default 0 check (standby_days >= 0),
  add column if not exists minimum_hours numeric(10,2) check (minimum_hours is null or minimum_hours > 0),
  add column if not exists is_owned boolean not null default true,
  /*
   * Trip-based hauling. Held as the inputs rather than the answer: the cycle
   * time, the load count and the truck count are the engine's to compute from
   * these, and storing them would be storing a conclusion that goes stale the
   * moment somebody changes the haul distance.
   */
  add column if not exists haul_mode text not null default 'hours'
    check (haul_mode in ('hours', 'trip')),
  add column if not exists round_trip_miles numeric(10,2)
    check (round_trip_miles is null or round_trip_miles > 0),
  add column if not exists average_speed_mph numeric(8,2)
    check (average_speed_mph is null or average_speed_mph > 0),
  add column if not exists truck_capacity numeric(12,4)
    check (truck_capacity is null or truck_capacity > 0),
  add column if not exists tons_per_load numeric(12,4)
    check (tons_per_load is null or tons_per_load > 0),
  add column if not exists load_minutes numeric(8,2) check (load_minutes is null or load_minutes >= 0),
  add column if not exists dump_minutes numeric(8,2) check (dump_minutes is null or dump_minutes >= 0),
  add column if not exists queue_minutes numeric(8,2) check (queue_minutes is null or queue_minutes >= 0),
  add column if not exists includes_disposal boolean not null default false,
  -- Labor: what the wage is before burden, so the loaded rate is derived and
  -- not a third number somebody can contradict.
  add column if not exists base_rate numeric(16,4) check (base_rate is null or base_rate >= 0),
  add column if not exists burden_rate numeric(16,4) check (burden_rate is null or burden_rate >= 0),
  add column if not exists role text,
  add column if not exists notes text;

comment on column estimate_line_resources.drives_hours is
  'Whether this row''s production governs the line''s hours. Two dozers at 100 units an hour are 200 between them and every other row works those same hours, so which rows count is recorded rather than guessed from the kind.';

comment on column estimate_line_resources.haul_mode is
  'Whether trucking is priced from hours somebody entered or from a haul cycle. Trip mode holds the inputs — distance, speed, capacity, load and dump times — and never the cycle time or the load count, which are the engine''s to compute and would go stale the moment the haul distance changed.';

comment on column estimate_line_resources.rate_basis is
  'How the machine is billed. An hourly rate and a weekly rate are different numbers with different rounding, and that difference is most of what an equipment line costs.';

create index if not exists elr_line_order_idx on estimate_line_resources(line_item_id, sort_order);

/*
 * A trip-based haul needs the inputs a cycle is computed from. Left to the
 * application it would be a row that prices as zero and looks complete.
 */
alter table estimate_line_resources drop constraint if exists elr_trip_inputs;
alter table estimate_line_resources
  add constraint elr_trip_inputs check (
    haul_mode <> 'trip'
    or (round_trip_miles is not null and average_speed_mph is not null
        and truck_capacity is not null)
  );

/*
 * A row that drives the hours has to say at what rate. Without this a ticked
 * Prod/Hr box contributes nothing to the fleet rate and silently makes the
 * line take longer than it should.
 */
alter table estimate_line_resources drop constraint if exists elr_driver_needs_production;
alter table estimate_line_resources
  add constraint elr_driver_needs_production check (
    not drives_hours or production_per_hour is not null
  );

select app.assert_security_gates();

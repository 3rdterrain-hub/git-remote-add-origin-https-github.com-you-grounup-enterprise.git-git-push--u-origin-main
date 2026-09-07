-- =============================================================================
-- 0103 — Measuring a pond
--
-- `takeoff_measurements` knows four shapes: a count, a run, an area, and a
-- volume that is an area times a depth. The last one is right for a slab, a
-- base course or a trench of constant section, and wrong for every hole dug in
-- the ground.
--
-- A detention pond does not have vertical walls. It is cut at 3:1 or 4:1, so
-- the floor is much smaller than the top, and taking it off as area times depth
-- overstates the excavation badly — a 200 by 100 foot pond eight feet deep on
-- 3:1 is 4,020 cubic yards, and area times depth says 5,926. Forty-seven
-- percent high, on what is usually the largest single line in the bid.
--
-- So a fifth kind, `basin`, with the geometry a sloped hole actually needs:
-- one or more lifts, each with its own depth and side slope, optionally
-- separated by a bench, and a freeboard so the platform can report what it
-- holds as well as what it costs to dig. The arithmetic is the engine's —
-- `measureBasin` in @grounup/engine — and this is where the inputs live.
-- =============================================================================

alter table takeoff_measurements
  drop constraint if exists takeoff_measurements_kind_check;

alter table takeoff_measurements
  add constraint takeoff_measurements_kind_check
  check (kind in ('count', 'linear', 'area', 'volume', 'basin'));

alter table takeoff_measurements
  -- Top down. Each entry is {depth_feet, side_slope_run, bench_width_feet?, label?}.
  add column if not exists lifts jsonb not null default '[]'::jsonb,
  -- From the top of bank down to the design water surface. Storage is what
  -- sits below it; excavation is the whole hole.
  add column if not exists freeboard_feet numeric(10,4)
    check (freeboard_feet is null or freeboard_feet >= 0);

comment on column takeoff_measurements.lifts is
  'The cuts that make up a basin, top down: depth_feet, side_slope_run, and optionally bench_width_feet and label. A pond cut 4:1 to a safety bench and 3:1 below it is two lifts. Empty for every other kind of measurement.';

comment on column takeoff_measurements.freeboard_feet is
  'Depth from the top of bank to the design water surface. What a basin holds is computed below this line; what it costs to dig is the whole hole.';

/**
 * A basin is a basin, and nothing else is.
 *
 * Written as a constraint rather than left to the application because the two
 * mistakes it prevents are silent: a basin with no lifts prices as a hole with
 * no depth, and lifts on an area measurement are inputs nothing reads, which
 * look like they were taken into account and were not.
 */
alter table takeoff_measurements drop constraint if exists takeoff_measurements_basin_shape;
alter table takeoff_measurements
  add constraint takeoff_measurements_basin_shape check (
    case kind
      when 'basin' then
        jsonb_typeof(lifts) = 'array'
        and jsonb_array_length(lifts) > 0
        -- A basin's quantity is a volume, or the area of what lines it.
        and unit in ('CY', 'SF', 'SY', 'ACRE', 'GAL')
      else jsonb_array_length(lifts) = 0 and freeboard_feet is null
    end
  );

/**
 * Every lift has to state a depth and a slope.
 *
 * A check constraint cannot walk a JSON array, so this is a trigger. The
 * alternative — a `takeoff_measurement_lifts` table — would be the tidier
 * shape and the wrong one: a lift has no identity, no life of its own, and is
 * never referenced by anything. It is part of the measurement, the way a
 * traced point is.
 */
create or replace function app.validate_basin_lifts()
returns trigger
language plpgsql
as $$
declare
  v_lift jsonb;
  v_i int := 0;
begin
  if new.kind <> 'basin' then return new; end if;

  for v_lift in select * from jsonb_array_elements(new.lifts) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_lift) <> 'object' then
      raise exception 'Lift % is not an object', v_i using errcode = 'check_violation';
    end if;
    if (v_lift->>'depth_feet') is null or (v_lift->>'depth_feet')::numeric <= 0 then
      raise exception 'Lift % needs a depth greater than zero', v_i
        using errcode = 'check_violation';
    end if;
    if (v_lift->>'side_slope_run') is null or (v_lift->>'side_slope_run')::numeric < 0 then
      raise exception 'Lift % needs a side slope; use 0 for a vertical face', v_i
        using errcode = 'check_violation',
              hint = 'A 3:1 slope is 3 — the horizontal run per one foot of fall.';
    end if;
    if coalesce((v_lift->>'bench_width_feet')::numeric, 0) < 0 then
      raise exception 'Lift % has a negative bench', v_i using errcode = 'check_violation';
    end if;
  end loop;

  -- Freeboard cannot be the whole basin: that is a pond that holds nothing,
  -- which is a typo rather than a design.
  if new.freeboard_feet is not null and jsonb_array_length(new.lifts) > 0 then
    if new.freeboard_feet >= (
      select coalesce(sum((l->>'depth_feet')::numeric), 0)
      from jsonb_array_elements(new.lifts) l
    ) then
      raise exception 'The freeboard is as deep as the basin, so it would hold nothing'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists takeoff_measurements_basin_lifts on takeoff_measurements;
create trigger takeoff_measurements_basin_lifts
  before insert or update on takeoff_measurements
  for each row execute function app.validate_basin_lifts();

comment on function app.validate_basin_lifts is
  'Checks that every lift on a basin states a depth and a side slope, and that the freeboard does not swallow the basin. A check constraint cannot walk a JSON array, and a lift has no identity of its own to earn a table.';

create index if not exists takeoff_measurements_basin_idx
  on takeoff_measurements(company_id, document_sheet_id)
  where kind = 'basin';

select app.assert_security_gates();

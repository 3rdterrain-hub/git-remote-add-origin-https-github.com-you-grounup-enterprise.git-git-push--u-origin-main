-- =============================================================================
-- 0047 — A surface with no location, compared to another surface with no
--        location
--
-- `app.enforce_surface_datum_match()` exists because "a volume computed between
-- two surfaces on different vertical datums is wrong by the offset and looks
-- entirely plausible." That is exactly right, and the same sentence is true of
-- three things it does not check.
--
--   * **Neither surface is anchored to the ground.** A surface is a grid of
--     elevations with a cell size and a row and column count, and no origin. The
--     comparison requires the two grids to have the same shape and calls that
--     "sharing a grid". Two hundred-by-hundred grids at five feet, one over the
--     north end of a site and one over the south, satisfy every check the
--     platform makes and produce a cut and fill figure that is entirely
--     fictitious and entirely plausible.
--   * **The horizontal datum and the coordinate system are not compared**,
--     though the vertical datum is. NAD27 and NAD83 differ by tens of meters in
--     places; two grids on different horizontal datums do not cover the same
--     ground even when their origins read the same.
--   * **The surfaces need not belong to the project the comparison is filed
--     under.** The tenant guard checks that the comparison's project belongs to
--     the company; nothing checks that either surface belongs to that project.
--     One site's existing ground can be differenced against another site's
--     design and booked to a third.
--
-- Earthwork quantity is the number a heavy civil bid is won or lost on. A wrong
-- one that looks right is the worst failure this module can have, which is what
-- the original datum guard was written to say.
--
-- @implements EDM-000041
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Where the grid sits on the ground
-- -----------------------------------------------------------------------------
alter table surfaces
  add column origin_easting  numeric(14,4),
  add column origin_northing numeric(14,4);

comment on column surfaces.origin_easting is
  'Easting of the center of cell (0,0), in the survey''s coordinate system and units. Without it a grid is a shape rather than a place, and two grids of equal shape can be differenced no matter what ground they cover.';
comment on column surfaces.origin_northing is
  'Northing of the center of cell (0,0), in the survey''s coordinate system and units.';

-- Both or neither: half a georeference locates nothing.
alter table surfaces
  add constraint surfaces_origin_complete
  check (num_nonnulls(origin_easting, origin_northing) <> 1);

-- -----------------------------------------------------------------------------
-- A comparison between two surfaces that are actually comparable
-- -----------------------------------------------------------------------------
/**
 * Everything that has to agree before a volume between two surfaces means
 * anything.
 *
 * Vertical datum, units and grid shape were already checked and still are. Added
 * here: the horizontal datum and coordinate system, the georeference, and that
 * both surfaces belong to the project the comparison is filed under.
 *
 * A surface with no origin is refused rather than compared on trust. Storing an
 * ungeoreferenced surface stays legal — an imported file may arrive before
 * anybody has established where it goes — but a quantity cannot be computed
 * from one.
 */
create or replace function app.enforce_surface_datum_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_a record;
  v_b record;
begin
  select sv.vertical_datum, sv.horizontal_datum, sv.coordinate_system, sv.units,
         sv.project_id, s.cell_size_ft, s.grid_rows, s.grid_cols,
         s.origin_easting, s.origin_northing, s.name
  into v_a from surfaces s join surveys sv on sv.id = s.survey_id
  where s.id = new.existing_surface_id;

  select sv.vertical_datum, sv.horizontal_datum, sv.coordinate_system, sv.units,
         sv.project_id, s.cell_size_ft, s.grid_rows, s.grid_cols,
         s.origin_easting, s.origin_northing, s.name
  into v_b from surfaces s join surveys sv on sv.id = s.survey_id
  where s.id = new.design_surface_id;

  if v_a.project_id <> new.project_id or v_b.project_id <> new.project_id then
    raise exception
      'Both surfaces must belong to the project the comparison is filed under. One site''s ground differenced against another site''s design is not a quantity.'
      using errcode = 'check_violation';
  end if;

  if v_a.vertical_datum is distinct from v_b.vertical_datum then
    raise exception
      'Surfaces are on different vertical datums (% and %). The volume between them would be wrong by the datum offset.',
      v_a.vertical_datum, v_b.vertical_datum
      using errcode = 'check_violation';
  end if;

  if v_a.horizontal_datum is distinct from v_b.horizontal_datum then
    raise exception
      'Surfaces are on different horizontal datums (% and %). They do not cover the same ground.',
      v_a.horizontal_datum, v_b.horizontal_datum
      using errcode = 'check_violation';
  end if;

  if v_a.coordinate_system is distinct from v_b.coordinate_system then
    raise exception
      'Surfaces are on different coordinate systems (% and %). They do not cover the same ground.',
      coalesce(v_a.coordinate_system, 'unstated'), coalesce(v_b.coordinate_system, 'unstated')
      using errcode = 'check_violation';
  end if;

  if v_a.units is distinct from v_b.units then
    raise exception 'Surfaces use different units (% and %).', v_a.units, v_b.units
      using errcode = 'check_violation';
  end if;

  if v_a.cell_size_ft is distinct from v_b.cell_size_ft
     or v_a.grid_rows is distinct from v_b.grid_rows
     or v_a.grid_cols is distinct from v_b.grid_cols then
    raise exception 'Surfaces must share a grid; resample one onto the other before comparing.'
      using errcode = 'check_violation';
  end if;

  if v_a.origin_easting is null or v_b.origin_easting is null then
    raise exception
      'Surface "%" has no georeference. A grid with no origin is a shape rather than a place, and a volume computed from one is not a quantity.',
      case when v_a.origin_easting is null then v_a.name else v_b.name end
      using errcode = 'check_violation';
  end if;

  if v_a.origin_easting is distinct from v_b.origin_easting
     or v_a.origin_northing is distinct from v_b.origin_northing then
    raise exception
      'Surfaces start at different places (%, % and %, %). Grids of the same shape over different ground produce a plausible and fictitious volume.',
      v_a.origin_easting, v_a.origin_northing, v_b.origin_easting, v_b.origin_northing
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.enforce_surface_datum_match() is
  'Everything that has to agree before a volume between two surfaces means anything: project, vertical and horizontal datum, coordinate system, units, grid shape and georeference. Earthwork quantity is what a heavy civil bid is won on, and a wrong one that looks right is the worst failure this module can have.';

select app.assert_security_gates();

-- =============================================================================
-- 0193 — A surface somebody shot, and a file a machine can be sent
--
-- Survey and grade was the last whole section of the platform with no writer of
-- any kind. Five governed tables — `surveys`, `surfaces`, `surface_comparisons`,
-- `machine_control_files`, `machine_assignments` — with row level security,
-- tenant guards, a georeference check added in 0047 and four integrity guards
-- added in 0048, and nothing anywhere that could put a row into any of them.
-- Two of those guards had never fired in their lives, because nothing could
-- reach the state they refuse:
--
--   * `enforce_published_surface_frozen` — a surface a machine is cutting to
--     cannot have its elevations moved underneath the machine.
--   * `enforce_surface_datum_match` — two surfaces on different vertical datums
--     produce a volume wrong by exactly the datum offset and entirely
--     plausible.
--
-- What is deliberately NOT here: a form that types elevations in. A surface
-- arrives as a file — LandXML, a TIN, a points CSV — and parsing those is its
-- own piece of work with its own tests. So `create_surface` takes a grid and a
-- storage path, and the file readers are built on top of this rather than
-- instead of it. A grid a person typed is not a survey.
--
-- And the volumes stay an engine output. `surface_comparisons` holds cut, fill,
-- net, areas, depths and coverage; every one of those columns is now guarded by
-- 0058's engine-output guard and written only by `app.record_surface_comparison`,
-- which is granted to `service_role` alone and called by the `compare-surfaces`
-- Edge Function. The same boundary 0058 drew around a price and 0158 drew
-- around float, for the same reason: a yardage somebody typed is a yardage
-- nobody can reproduce.
--
-- WORKFLOW.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The capture
-- -----------------------------------------------------------------------------

/**
 * Record a survey — one visit to the site, by one method, on one datum.
 *
 * The datum and the units are the whole reason this row exists separately from
 * the surfaces built out of it. A rover shot on NAVD88 and a design model on
 * NGVD29 differ by about three and a half feet in Ohio, and nothing about
 * either file says so.
 */
create or replace function app.record_survey(
  p_project uuid,
  p_name text,
  p_capture_method text default 'gps_rover',
  p_captured_on date default current_date,
  p_captured_by text default null,
  p_horizontal_datum text default 'NAD83',
  p_vertical_datum text default 'NAVD88',
  p_coordinate_system text default null,
  p_units text default 'us_survey_feet',
  p_point_count int default null,
  p_area_sf numeric default null,
  p_storage_path text default null,
  p_notes text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_id      uuid;
begin
  select company_id into v_company from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to record a survey on this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'A survey needs a name' using errcode = 'check_violation';
  end if;
  if p_capture_method not in ('gps_rover', 'total_station', 'drone_photogrammetry',
                              'lidar', 'design_model', 'as_built', 'imported') then
    raise exception 'Unknown capture method %', p_capture_method using errcode = 'check_violation';
  end if;
  if p_units not in ('us_survey_feet', 'international_feet', 'meters') then
    raise exception 'Unknown units %', p_units using errcode = 'check_violation';
  end if;
  if p_vertical_datum is null or length(trim(p_vertical_datum)) = 0
     or p_horizontal_datum is null or length(trim(p_horizontal_datum)) = 0 then
    raise exception 'A survey must say which datums it was shot on'
      using errcode = 'check_violation',
            hint = 'A volume computed across two datums is wrong by the offset between them and looks entirely plausible.';
  end if;
  if p_captured_on > current_date then
    raise exception 'A survey cannot have been captured in the future'
      using errcode = 'check_violation';
  end if;

  insert into surveys (company_id, project_id, name, capture_method, captured_on,
                       captured_by, horizontal_datum, vertical_datum, coordinate_system,
                       units, point_count, area_sf, storage_path, notes, created_by)
  values (v_company, p_project, trim(p_name), p_capture_method, p_captured_on,
          nullif(trim(coalesce(p_captured_by, '')), ''), trim(p_horizontal_datum),
          trim(p_vertical_datum), nullif(trim(coalesce(p_coordinate_system, '')), ''),
          p_units, p_point_count, p_area_sf,
          nullif(trim(coalesce(p_storage_path, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Correct a survey.
 *
 * The datum, the coordinate system and the units are refused once a volume has
 * been computed from any surface in this capture. Changing them afterwards
 * would leave a stored yardage that no longer follows from its inputs, and the
 * yardage is what somebody bid.
 */
create or replace function app.update_survey(
  p_survey uuid,
  p_name text default null,
  p_capture_method text default null,
  p_captured_on date default null,
  p_captured_by text default null,
  p_horizontal_datum text default null,
  p_vertical_datum text default null,
  p_coordinate_system text default null,
  p_units text default null,
  p_point_count int default null,
  p_area_sf numeric default null,
  p_notes text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s        surveys%rowtype;
  v_compared int;
begin
  select * into v_s from surveys where id = p_survey;
  if v_s.id is null then
    raise exception 'No such survey' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_s.company_id, 'projects.write') then
    raise exception 'You do not have permission to change this survey'
      using errcode = 'insufficient_privilege';
  end if;
  if p_capture_method is not null
     and p_capture_method not in ('gps_rover', 'total_station', 'drone_photogrammetry',
                                  'lidar', 'design_model', 'as_built', 'imported') then
    raise exception 'Unknown capture method %', p_capture_method using errcode = 'check_violation';
  end if;
  if p_units is not null and p_units not in ('us_survey_feet', 'international_feet', 'meters') then
    raise exception 'Unknown units %', p_units using errcode = 'check_violation';
  end if;

  if coalesce(p_vertical_datum, v_s.vertical_datum)   is distinct from v_s.vertical_datum
     or coalesce(p_horizontal_datum, v_s.horizontal_datum) is distinct from v_s.horizontal_datum
     or coalesce(p_units, v_s.units)                  is distinct from v_s.units
     or coalesce(p_coordinate_system, v_s.coordinate_system) is distinct from v_s.coordinate_system then
    select count(*) into v_compared
      from surface_comparisons c
      join surfaces s on s.id in (c.existing_surface_id, c.design_surface_id)
     where s.survey_id = p_survey;
    if v_compared > 0 then
      raise exception
        'A volume has already been computed from this survey, so its datum, coordinate system and units are fixed'
        using errcode = 'restrict_violation',
              hint = 'Record the corrected capture as its own survey and compare again. The yardage on file has to keep following from its inputs.';
    end if;
  end if;

  update surveys
     set name              = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
         capture_method    = coalesce(p_capture_method, capture_method),
         captured_on       = coalesce(p_captured_on, captured_on),
         captured_by       = coalesce(nullif(trim(coalesce(p_captured_by, '')), ''), captured_by),
         horizontal_datum  = coalesce(nullif(trim(coalesce(p_horizontal_datum, '')), ''), horizontal_datum),
         vertical_datum    = coalesce(nullif(trim(coalesce(p_vertical_datum, '')), ''), vertical_datum),
         coordinate_system = coalesce(nullif(trim(coalesce(p_coordinate_system, '')), ''), coordinate_system),
         units             = coalesce(p_units, units),
         point_count       = coalesce(p_point_count, point_count),
         area_sf           = coalesce(p_area_sf, area_sf),
         notes             = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
         updated_at        = now()
   where id = p_survey;
end;
$$;

-- -----------------------------------------------------------------------------
-- The surface
-- -----------------------------------------------------------------------------

/**
 * Build a surface out of a capture.
 *
 * A grid, not a form. `p_elevations` is the row-major array the engine reads,
 * and it is checked against the grid it claims to be: an array of the wrong
 * length is the one error in this whole area that produces a plausible answer
 * instead of a failure, because the cells simply shift and every depth is
 * wrong by whatever the offset happened to be.
 *
 * A surface may instead carry only a storage path — an imported file too large
 * to hold inline, or one that has not been gridded yet. The schema already
 * requires one or the other; what is added here is that "inline" means the
 * whole grid and not part of it.
 *
 * The extent is computed, never given. A minimum and maximum elevation somebody
 * typed would disagree with the array beneath it the first time either changed.
 */
create or replace function app.create_surface(
  p_survey uuid,
  p_name text,
  p_surface_role text,
  p_cell_size_ft numeric,
  p_grid_rows int,
  p_grid_cols int,
  p_elevations jsonb default null,
  p_storage_path text default null,
  p_origin_easting numeric default null,
  p_origin_northing numeric default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_cells   int;
  v_given   int;
  v_min     numeric;
  v_max     numeric;
  v_id      uuid;
begin
  select company_id into v_company from surveys where id = p_survey;
  if v_company is null then
    raise exception 'No such survey' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to add a surface to this survey'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'A surface needs a name' using errcode = 'check_violation';
  end if;
  if p_surface_role not in ('existing', 'design', 'as_built', 'stockpile_base', 'stockpile', 'subgrade') then
    raise exception 'Unknown surface role %', p_surface_role using errcode = 'check_violation';
  end if;
  if p_cell_size_ft is null or p_cell_size_ft <= 0 then
    raise exception 'A grid needs a cell size' using errcode = 'check_violation';
  end if;
  if coalesce(p_grid_rows, 0) <= 0 or coalesce(p_grid_cols, 0) <= 0 then
    raise exception 'A grid needs a row count and a column count' using errcode = 'check_violation';
  end if;

  if p_elevations is not null and jsonb_typeof(p_elevations) <> 'array' then
    raise exception 'Elevations are a row-major array, one value per cell'
      using errcode = 'check_violation';
  end if;

  v_cells := p_grid_rows * p_grid_cols;
  v_given := coalesce(jsonb_array_length(p_elevations), 0);

  if v_given = 0 then
    if nullif(trim(coalesce(p_storage_path, '')), '') is null then
      raise exception 'A surface with no elevations must say where its file is'
        using errcode = 'check_violation',
              hint = 'Either hand the grid over inline or give the storage path the file was uploaded to.';
    end if;
  elsif v_given <> v_cells then
    raise exception
      'That is % elevations for a % × % grid, which needs %',
      v_given, p_grid_rows, p_grid_cols, v_cells
      using errcode = 'check_violation',
            hint = 'An array of the wrong length shifts every cell and every depth with it, and the volume that comes out looks entirely reasonable.';
  end if;

  if v_given > 0 then
    select min(e), max(e) into v_min, v_max
      from (select nullif(value, 'null'::jsonb)::numeric as e
              from jsonb_array_elements(p_elevations)) t
     where e is not null;
  end if;

  insert into surfaces (company_id, survey_id, name, surface_role, cell_size_ft,
                        grid_rows, grid_cols, elevations, storage_path,
                        min_elevation, max_elevation, origin_easting, origin_northing)
  values (v_company, p_survey, trim(p_name), p_surface_role, p_cell_size_ft,
          p_grid_rows, p_grid_cols,
          case when v_given > 0 then p_elevations else null end,
          nullif(trim(coalesce(p_storage_path, '')), ''),
          v_min, v_max, p_origin_easting, p_origin_northing)
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Change a surface.
 *
 * The name, the role and the georeference of a surface nothing has been cut to
 * can all be corrected here — a surface that arrives before anybody has
 * established where it goes is legal, and this is how it gets placed. The
 * moment a machine control file cut from it is published, 0048's guard refuses
 * every one of those geometry changes, and this function does not argue with
 * it: the message that comes back names the file on the machine.
 */
create or replace function app.update_surface(
  p_surface uuid,
  p_name text default null,
  p_surface_role text default null,
  p_origin_easting numeric default null,
  p_origin_northing numeric default null,
  p_storage_path text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_s surfaces%rowtype;
begin
  select * into v_s from surfaces where id = p_surface;
  if v_s.id is null then
    raise exception 'No such surface' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_s.company_id, 'projects.write') then
    raise exception 'You do not have permission to change this surface'
      using errcode = 'insufficient_privilege';
  end if;
  if p_surface_role is not null
     and p_surface_role not in ('existing', 'design', 'as_built', 'stockpile_base', 'stockpile', 'subgrade') then
    raise exception 'Unknown surface role %', p_surface_role using errcode = 'check_violation';
  end if;
  if num_nonnulls(p_origin_easting, p_origin_northing) = 1 then
    raise exception 'A georeference is both an easting and a northing'
      using errcode = 'check_violation';
  end if;

  update surfaces
     set name            = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
         surface_role    = coalesce(p_surface_role, surface_role),
         origin_easting  = coalesce(p_origin_easting, origin_easting),
         origin_northing = coalesce(p_origin_northing, origin_northing),
         storage_path    = coalesce(nullif(trim(coalesce(p_storage_path, '')), ''), storage_path),
         updated_at      = now()
   where id = p_surface;
end;
$$;

/**
 * Remove a surface nothing depends on.
 *
 * A surface a volume was computed from, or a machine control file was cut from,
 * is the evidence behind a number somebody used. Deleting it would leave the
 * number with nothing under it, so it is refused and the dependent is named.
 */
create or replace function app.remove_surface(p_surface uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_s surfaces%rowtype;
  v_n text;
begin
  select * into v_s from surfaces where id = p_surface;
  if v_s.id is null then
    raise exception 'No such surface' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_s.company_id, 'projects.write') then
    raise exception 'You do not have permission to remove this surface'
      using errcode = 'insufficient_privilege';
  end if;

  select c.name into v_n from surface_comparisons c
   where p_surface in (c.existing_surface_id, c.design_surface_id) limit 1;
  if v_n is not null then
    raise exception 'The volume "%" was computed from this surface', v_n
      using errcode = 'restrict_violation',
            hint = 'Delete the comparison first, or keep the surface: a yardage with nothing under it is a yardage nobody can check.';
  end if;

  select f.name into v_n from machine_control_files f where f.surface_id = p_surface limit 1;
  if v_n is not null then
    raise exception 'The machine control file "%" was cut from this surface', v_n
      using errcode = 'restrict_violation';
  end if;

  delete from surfaces where id = p_surface;
end;
$$;

-- -----------------------------------------------------------------------------
-- The file a machine cuts to
-- -----------------------------------------------------------------------------

/**
 * Record a machine control file against a project.
 *
 * It arrives as a draft. Publishing is separate and needs a digest, because
 * 0048's `mc_published` constraint refuses a published file without one: a file
 * nobody can verify is exactly what that constraint exists to prevent.
 */
create or replace function app.record_machine_control_file(
  p_project uuid,
  p_name text,
  p_file_format text,
  p_storage_path text,
  p_surface uuid default null,
  p_vendor text default null,
  p_checksum text default null)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_next    int;
  v_id      uuid;
begin
  select company_id into v_company from projects where id = p_project;
  if v_company is null then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to add a machine control file to this project'
      using errcode = 'insufficient_privilege';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'A machine control file needs a name' using errcode = 'check_violation';
  end if;
  if p_file_format not in ('ttm', 'dxf', 'xml_landxml', 'gc3', 'svd', 'csv_points') then
    raise exception 'Unknown machine control format %', p_file_format using errcode = 'check_violation';
  end if;
  if p_vendor is not null
     and p_vendor not in ('trimble', 'topcon', 'leica', 'komatsu', 'caterpillar', 'other') then
    raise exception 'Unknown machine vendor %', p_vendor using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'A machine control file is a file; it needs the path it was uploaded to'
      using errcode = 'check_violation';
  end if;
  if p_checksum is not null and p_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'A digest is the 64 lowercase hex characters of a SHA-256'
      using errcode = 'check_violation';
  end if;
  if p_surface is not null
     and not exists (select 1 from surfaces s where s.id = p_surface and s.company_id = v_company) then
    raise exception 'No such surface' using errcode = 'no_data_found';
  end if;

  /* Versions run per project and name, so a re-cut of the same design reads as
     version 2 rather than as a second file with the same name. */
  select coalesce(max(version), 0) + 1 into v_next
    from machine_control_files
   where project_id = p_project and name = trim(p_name);

  insert into machine_control_files (company_id, project_id, surface_id, name,
                                     file_format, vendor, version, storage_path,
                                     checksum_sha256, status)
  values (v_company, p_project, p_surface, trim(p_name), p_file_format, p_vendor,
          v_next, trim(p_storage_path), p_checksum, 'draft')
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Publish a file to the machines.
 *
 * From here the surface it was cut from stops moving: 0048's
 * `enforce_published_surface_frozen` refuses every geometry change to it while
 * this file is live. That guard had never fired, because nothing could publish.
 */
create or replace function app.publish_machine_control_file(
  p_file uuid,
  p_checksum text default null)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_f       machine_control_files%rowtype;
  v_digest  text;
begin
  select * into v_f from machine_control_files where id = p_file;
  if v_f.id is null then
    raise exception 'No such machine control file' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_f.company_id, 'projects.write') then
    raise exception 'You do not have permission to publish a design to machines'
      using errcode = 'insufficient_privilege';
  end if;
  if v_f.status <> 'draft' then
    raise exception 'That file is already %', v_f.status using errcode = 'check_violation';
  end if;

  v_digest := coalesce(nullif(trim(coalesce(p_checksum, '')), ''), v_f.checksum_sha256);
  if v_digest is null then
    raise exception 'A published file records the digest of what was published'
      using errcode = 'check_violation',
            hint = 'Without it there is no way to show that the file on the machine is the file that was approved.';
  end if;
  if v_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'A digest is the 64 lowercase hex characters of a SHA-256'
      using errcode = 'check_violation';
  end if;

  update machine_control_files
     set status          = 'published',
         checksum_sha256 = v_digest,
         published_at    = now(),
         published_by    = auth.uid(),
         updated_at      = now()
   where id = p_file;
end;
$$;

/**
 * Replace a live design with a newer one.
 *
 * The old file names its replacement, which is what lets an operator always be
 * told which file is current — and 0048's `notify_superseded_assignment` tells
 * every machine holding the old one.
 */
create or replace function app.supersede_machine_control_file(
  p_file uuid,
  p_replacement uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_f machine_control_files%rowtype;
  v_r machine_control_files%rowtype;
begin
  select * into v_f from machine_control_files where id = p_file;
  select * into v_r from machine_control_files where id = p_replacement;
  if v_f.id is null or v_r.id is null then
    raise exception 'No such machine control file' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_f.company_id, 'projects.write') then
    raise exception 'You do not have permission to supersede a design'
      using errcode = 'insufficient_privilege';
  end if;
  if v_r.project_id <> v_f.project_id then
    raise exception 'A replacement has to be a file on the same project'
      using errcode = 'check_violation';
  end if;
  if v_r.status <> 'published' then
    raise exception 'The replacement is % — publish it before it replaces anything', v_r.status
      using errcode = 'check_violation';
  end if;

  update machine_control_files
     set status = 'superseded', superseded_by_id = p_replacement, updated_at = now()
   where id = p_file;
end;
$$;

/** Withdraw a file nobody should cut to, without pretending it never existed. */
create or replace function app.withdraw_machine_control_file(p_file uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_f machine_control_files%rowtype;
begin
  select * into v_f from machine_control_files where id = p_file;
  if v_f.id is null then
    raise exception 'No such machine control file' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_f.company_id, 'projects.write') then
    raise exception 'You do not have permission to withdraw a design'
      using errcode = 'insufficient_privilege';
  end if;
  if v_f.status = 'superseded' then
    raise exception 'That file has already been replaced' using errcode = 'check_violation';
  end if;

  update machine_control_files set status = 'withdrawn', updated_at = now() where id = p_file;
  update machine_assignments set is_current = false, updated_at = now()
   where machine_control_file_id = p_file and is_current;
end;
$$;

/**
 * Send a published design to a machine. O-022, finally closed.
 *
 * One current file per machine — the schema says so with a partial unique
 * index, and the reason is that an operator holding two designs has no way to
 * know which one the office meant. So the previous assignment is stood down in
 * the same statement that makes the new one current, and 0048's
 * `enforce_assignment_file_published` refuses a draft outright.
 */
create or replace function app.send_file_to_machine(
  p_asset uuid,
  p_file uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
  v_company uuid;
  v_f       machine_control_files%rowtype;
  v_id      uuid;
begin
  select company_id into v_company from assets where id = p_asset;
  if v_company is null then
    raise exception 'No such machine' using errcode = 'no_data_found';
  end if;
  select * into v_f from machine_control_files where id = p_file;
  if v_f.id is null then
    raise exception 'No such machine control file' using errcode = 'no_data_found';
  end if;
  if v_f.company_id <> v_company then
    raise exception 'That file belongs to another company' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_permission(v_company, 'projects.write') then
    raise exception 'You do not have permission to send a design to a machine'
      using errcode = 'insufficient_privilege';
  end if;
  if v_f.status <> 'published' then
    raise exception 'That file is %, and a machine is only ever sent a published one', v_f.status
      using errcode = 'check_violation';
  end if;

  update machine_assignments set is_current = false, updated_at = now()
   where asset_id = p_asset and is_current;

  insert into machine_assignments (company_id, asset_id, machine_control_file_id,
                                   assigned_by, is_current)
  values (v_company, p_asset, p_file, auth.uid(), true)
  returning id into v_id;
  return v_id;
end;
$$;

/** The operator says the machine has it. Until then nobody knows that it does. */
create or replace function app.acknowledge_machine_file(p_assignment uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_a machine_assignments%rowtype;
begin
  select * into v_a from machine_assignments where id = p_assignment;
  if v_a.id is null then
    raise exception 'No such assignment' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_a.company_id, 'projects.write') then
    raise exception 'You do not have permission to acknowledge this design'
      using errcode = 'insufficient_privilege';
  end if;
  if v_a.acknowledged_at is not null then
    return;
  end if;
  update machine_assignments set acknowledged_at = now(), updated_at = now()
   where id = p_assignment;
end;
$$;

-- -----------------------------------------------------------------------------
-- The volume between two surfaces is an engine output
-- -----------------------------------------------------------------------------

/*
 * The inputs — which two surfaces, on which project, under what name — stay a
 * person's choice. Everything the comparison *reports* is what the method
 * produces from those two grids, and from here it is written by one function
 * granted to one role. A cut yardage somebody typed is a cut yardage nobody can
 * reproduce, and it is the number the job is bid and paid on.
 */
drop trigger if exists surface_comparisons_engine_outputs on surface_comparisons;
create trigger surface_comparisons_engine_outputs
  before insert or update on surface_comparisons
  for each row execute function app.guard_engine_outputs(
    'cut_bcy', 'fill_ccy', 'net_bcy', 'cut_area_sf', 'fill_area_sf',
    'max_cut_depth_ft', 'max_fill_depth_ft', 'average_cut_depth_ft',
    'average_fill_depth_ft', 'cells_compared', 'cells_skipped', 'coverage',
    'engine_version', 'warnings');

/**
 * Record one comparison of two surfaces. ENGINE.
 *
 * Called by the `compare-surfaces` Edge Function, which holds the service role
 * and runs `compareSurfaces` out of `@grounup/engine` — the same code the
 * estimator's own earthwork uses, so a volume on this screen and a volume on a
 * line agree by construction rather than by coincidence.
 *
 * An unknown key in `p_result` is refused rather than ignored, because a key
 * that matches nothing writes nothing and reports success. 0136 and 0139
 * learned that twice; this is the third place it would have happened.
 */
create or replace function app.record_surface_comparison(
  p_company uuid,
  p_project uuid,
  p_existing uuid,
  p_design uuid,
  p_name text,
  p_engine_version text,
  p_result jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_known constant text[] := array[
    'cut_bcy', 'fill_ccy', 'net_bcy', 'cut_area_sf', 'fill_area_sf',
    'max_cut_depth_ft', 'max_fill_depth_ft', 'average_cut_depth_ft',
    'average_fill_depth_ft', 'cells_compared', 'cells_skipped', 'coverage',
    'warnings'];
  v_unknown text[];
  v_id      uuid;
begin
  if p_engine_version is null or length(trim(p_engine_version)) = 0 then
    raise exception 'A computed volume must record which engine produced it'
      using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_result) <> 'object' then
    raise exception 'The result is given as an object.'
      using errcode = 'invalid_parameter_value';
  end if;

  select array_agg(distinct k order by k) into v_unknown
    from jsonb_object_keys(p_result) k
   where k <> all (v_known);
  if v_unknown is not null then
    raise exception 'A surface comparison has no field called %. It takes: %.',
      array_to_string(v_unknown, ', '), array_to_string(v_known, ', ')
      using errcode = 'undefined_column';
  end if;

  if not exists (select 1 from projects where id = p_project and company_id = p_company) then
    raise exception 'That project does not belong to that company'
      using errcode = 'no_data_found';
  end if;

  -- Everything below this line is the engine writing.
  perform set_config('app.engine_write', 'on', true);

  insert into surface_comparisons (
    company_id, project_id, existing_surface_id, design_surface_id, name,
    computed_at, cut_bcy, fill_ccy, net_bcy, cut_area_sf, fill_area_sf,
    max_cut_depth_ft, max_fill_depth_ft, average_cut_depth_ft, average_fill_depth_ft,
    cells_compared, cells_skipped, coverage, engine_version, warnings, created_by)
  values (
    p_company, p_project, p_existing, p_design, p_name, now(),
    coalesce((p_result->>'cut_bcy')::numeric, 0),
    coalesce((p_result->>'fill_ccy')::numeric, 0),
    coalesce((p_result->>'net_bcy')::numeric, 0),
    coalesce((p_result->>'cut_area_sf')::numeric, 0),
    coalesce((p_result->>'fill_area_sf')::numeric, 0),
    (p_result->>'max_cut_depth_ft')::numeric,
    (p_result->>'max_fill_depth_ft')::numeric,
    (p_result->>'average_cut_depth_ft')::numeric,
    (p_result->>'average_fill_depth_ft')::numeric,
    coalesce((p_result->>'cells_compared')::int, 0),
    coalesce((p_result->>'cells_skipped')::int, 0),
    coalesce((p_result->>'coverage')::numeric, 0),
    trim(p_engine_version),
    coalesce(p_result->'warnings', '[]'::jsonb),
    auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.record_surface_comparison(uuid, uuid, uuid, uuid, text, text, jsonb) is
  'Records one comparison of two surfaces. ENGINE: the only writer of cut, fill, net, areas, depths and coverage, granted to service_role alone — a yardage somebody typed is a yardage nobody can reproduce.';

revoke all on function app.record_surface_comparison(uuid, uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function app.record_surface_comparison(uuid, uuid, uuid, uuid, text, text, jsonb)
  to service_role;

/**
 * Delete a comparison.
 *
 * Not an engine output — which volumes a company keeps on file is its own
 * business. A comparison a line item was priced from is refused, because that
 * line's quantity would then point at nothing.
 */
create or replace function app.remove_surface_comparison(p_comparison uuid)
returns void
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare v_c surface_comparisons%rowtype;
begin
  select * into v_c from surface_comparisons where id = p_comparison;
  if v_c.id is null then
    raise exception 'No such comparison' using errcode = 'no_data_found';
  end if;
  if not app.has_permission(v_c.company_id, 'projects.write') then
    raise exception 'You do not have permission to remove this volume'
      using errcode = 'insufficient_privilege';
  end if;
  if v_c.applied_line_item_id is not null then
    raise exception 'That volume was carried onto an estimate line'
      using errcode = 'restrict_violation',
            hint = 'Change the line first. A quantity that points at nothing is a quantity nobody can check.';
  end if;
  delete from surface_comparisons where id = p_comparison;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a screen reads
-- -----------------------------------------------------------------------------

create or replace view my_surveys
with (security_invoker = true) as
select s.id, s.company_id, s.project_id, s.name, s.capture_method, s.captured_on,
       s.captured_by, s.horizontal_datum, s.vertical_datum, s.coordinate_system,
       s.units, s.point_count, s.area_sf, s.storage_path, s.notes, s.status,
       p.number                                   as project_number,
       p.name                                     as project_name,
       (select count(*) from surfaces f where f.survey_id = s.id) as surface_count,
       -- A capture nothing was built from is a file somebody uploaded, not a
       -- surface anybody can compare. The screen says which it is.
       exists (select 1 from surfaces f where f.survey_id = s.id
                and f.origin_easting is not null)  as is_georeferenced
  from surveys s
  join projects p on p.id = s.project_id;

revoke all on my_surveys from public, anon;
grant select on my_surveys to authenticated, service_role;

create or replace view my_surfaces
with (security_invoker = true) as
select f.id, f.company_id, f.survey_id, f.name, f.surface_role, f.cell_size_ft,
       f.grid_rows, f.grid_cols, f.storage_path, f.min_elevation, f.max_elevation,
       f.origin_easting, f.origin_northing, f.created_at,
       (f.grid_rows * f.grid_cols)                as cell_count,
       (f.elevations is not null)                 as has_grid,
       s.project_id, s.name                       as survey_name,
       s.captured_on, s.vertical_datum, s.horizontal_datum, s.units,
       s.coordinate_system,
       -- Whether this surface can still be moved, and if not, what is cutting
       -- to it. 0048 refuses the change; this is how a screen says so first.
       (select f2.name from machine_control_files f2
         where f2.surface_id = f.id and f2.status = 'published' limit 1)
                                                  as frozen_by_file,
       (select count(*) from surface_comparisons c
         where f.id in (c.existing_surface_id, c.design_surface_id))
                                                  as comparison_count
  from surfaces f
  join surveys s on s.id = f.survey_id;

revoke all on my_surfaces from public, anon;
grant select on my_surfaces to authenticated, service_role;

create or replace view my_machine_assignments
with (security_invoker = true) as
select a.id, a.company_id, a.asset_id, a.machine_control_file_id, a.assigned_at,
       a.acknowledged_at, a.is_current,
       ast.asset_number, ast.name                 as asset_name,
       f.name                                     as file_name,
       f.file_format, f.vendor, f.version, f.status as file_status,
       f.checksum_sha256, f.project_id,
       p.number                                   as project_number,
       sup.name                                   as superseded_by_name,
       -- The one thing an operator needs and nobody was telling them: the file
       -- on this machine is not the current one any more.
       (f.status <> 'published')                  as file_withdrawn_or_superseded,
       (a.acknowledged_at is null)                as awaiting_acknowledgement
  from machine_assignments a
  join assets ast on ast.id = a.asset_id
  join machine_control_files f on f.id = a.machine_control_file_id
  left join projects p on p.id = f.project_id
  left join machine_control_files sup on sup.id = f.superseded_by_id;

revoke all on my_machine_assignments from public, anon;
grant select on my_machine_assignments to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The doors
-- -----------------------------------------------------------------------------

create or replace function public.record_survey(
  p_project uuid, p_name text, p_capture_method text default 'gps_rover',
  p_captured_on date default current_date, p_captured_by text default null,
  p_horizontal_datum text default 'NAD83', p_vertical_datum text default 'NAVD88',
  p_coordinate_system text default null, p_units text default 'us_survey_feet',
  p_point_count int default null, p_area_sf numeric default null,
  p_storage_path text default null, p_notes text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_survey(p_project, p_name, p_capture_method, p_captured_on,
       p_captured_by, p_horizontal_datum, p_vertical_datum, p_coordinate_system,
       p_units, p_point_count, p_area_sf, p_storage_path, p_notes); $$;

create or replace function public.update_survey(
  p_survey uuid, p_name text default null, p_capture_method text default null,
  p_captured_on date default null, p_captured_by text default null,
  p_horizontal_datum text default null, p_vertical_datum text default null,
  p_coordinate_system text default null, p_units text default null,
  p_point_count int default null, p_area_sf numeric default null,
  p_notes text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_survey(p_survey, p_name, p_capture_method, p_captured_on,
       p_captured_by, p_horizontal_datum, p_vertical_datum, p_coordinate_system,
       p_units, p_point_count, p_area_sf, p_notes); $$;

create or replace function public.create_surface(
  p_survey uuid, p_name text, p_surface_role text, p_cell_size_ft numeric,
  p_grid_rows int, p_grid_cols int, p_elevations jsonb default null,
  p_storage_path text default null, p_origin_easting numeric default null,
  p_origin_northing numeric default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.create_surface(p_survey, p_name, p_surface_role, p_cell_size_ft,
       p_grid_rows, p_grid_cols, p_elevations, p_storage_path, p_origin_easting,
       p_origin_northing); $$;

create or replace function public.update_surface(
  p_surface uuid, p_name text default null, p_surface_role text default null,
  p_origin_easting numeric default null, p_origin_northing numeric default null,
  p_storage_path text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.update_surface(p_surface, p_name, p_surface_role, p_origin_easting,
       p_origin_northing, p_storage_path); $$;

create or replace function public.remove_surface(p_surface uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_surface(p_surface); $$;

create or replace function public.record_machine_control_file(
  p_project uuid, p_name text, p_file_format text, p_storage_path text,
  p_surface uuid default null, p_vendor text default null, p_checksum text default null)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.record_machine_control_file(p_project, p_name, p_file_format,
       p_storage_path, p_surface, p_vendor, p_checksum); $$;

create or replace function public.publish_machine_control_file(
  p_file uuid, p_checksum text default null)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.publish_machine_control_file(p_file, p_checksum); $$;

create or replace function public.supersede_machine_control_file(
  p_file uuid, p_replacement uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.supersede_machine_control_file(p_file, p_replacement); $$;

create or replace function public.withdraw_machine_control_file(p_file uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.withdraw_machine_control_file(p_file); $$;

create or replace function public.send_file_to_machine(p_asset uuid, p_file uuid)
returns uuid language sql security invoker set search_path = public, pg_catalog
as $$ select app.send_file_to_machine(p_asset, p_file); $$;

create or replace function public.acknowledge_machine_file(p_assignment uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.acknowledge_machine_file(p_assignment); $$;

create or replace function public.remove_surface_comparison(p_comparison uuid)
returns void language sql security invoker set search_path = public, pg_catalog
as $$ select app.remove_surface_comparison(p_comparison); $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_survey(uuid, text, text, date, text, text, text, text, text, int, numeric, text, text)',
    'public.update_survey(uuid, text, text, date, text, text, text, text, text, int, numeric, text)',
    'public.create_surface(uuid, text, text, numeric, int, int, jsonb, text, numeric, numeric)',
    'public.update_surface(uuid, text, text, numeric, numeric, text)',
    'public.remove_surface(uuid)',
    'public.record_machine_control_file(uuid, text, text, text, uuid, text, text)',
    'public.publish_machine_control_file(uuid, text)',
    'public.supersede_machine_control_file(uuid, uuid)',
    'public.withdraw_machine_control_file(uuid)',
    'public.send_file_to_machine(uuid, uuid)',
    'public.acknowledge_machine_file(uuid)',
    'public.remove_surface_comparison(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

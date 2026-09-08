-- =============================================================================
-- GENERATED — do not edit.
--
-- A verbatim copy of `supabase/seed/0004_trades_library.sql`, so the catalog can be applied
-- by `supabase db push` rather than by a direct database connection. The seed
-- file is the source; this is the delivery. `npm run seed:migrations`
-- regenerates it and a governance test fails if the two ever differ.
--
-- Everything below is idempotent — `on conflict do nothing` throughout — so
-- applying it twice changes nothing, which is what makes it safe as a
-- migration.
-- =============================================================================

-- =============================================================================
-- 0004 — The trades the service catalog already covers
--
-- Seed 0001 ships 857 services across electrical, plumbing, HVAC, roofing,
-- drywall, flooring, masonry, steel and landscaping — and 17 machines, 12 labor
-- classifications and 8 crews, every one of them heavy civil. So an estimator
-- could find "Install branch circuit wiring" and then had no electrician to put
-- on it, no crew to price it with, and no lift to reach the ceiling.
--
-- This is the other side of that catalog: the equipment, the labor titles and
-- the crews the building trades actually use.
--
-- Two things about the numbers.
--
-- **The wages are a Toledo, Ohio baseline**, the same basis 0001 states for its
-- twelve, and they are open-shop rather than union. A rate is a starting point
-- a company overrides, and RULE-003 puts a company's own rate above a seeded
-- one everywhere it is read — but a seeded rate that pretends to be local is
-- worse than one that says where it came from, so every row says.
--
-- **The equipment rates are ownership-cost assumptions, not quotes.** They
-- carry the same reference line 0001 uses, which reads as a warning rather than
-- a price: replace it with a vendor rate before issuing.
--
-- Everything is `on conflict do nothing`, so this file is safe to replay and
-- safe to run beside 0001.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The categories these rows are filed under
--
-- `equipment.equipment_class`, `labor_rates.labor_group` and `crews.discipline`
-- have been governed by `library_categories` since migration 0113: a value not
-- on the list is refused rather than quietly creating a fourth spelling. So the
-- lists come first, as platform rows every tenant reads and none can edit.
-- -----------------------------------------------------------------------------
insert into library_categories (company_id, kind, name, sort_order)
select null, v.kind, v.name, v.sort
from (values
  ('equipment_class', 'Aerial Lift', 200), ('equipment_class', 'Material Handling', 210),
  ('equipment_class', 'Access', 220), ('equipment_class', 'Concrete', 230),
  ('equipment_class', 'Electrical', 240), ('equipment_class', 'Power', 250),
  ('equipment_class', 'Plumbing', 260), ('equipment_class', 'HVAC', 270),
  ('equipment_class', 'Finishes', 280), ('equipment_class', 'Roofing', 290),
  ('equipment_class', 'Welding', 300), ('equipment_class', 'Crane', 310),
  ('equipment_class', 'Air', 320), ('equipment_class', 'Temporary Services', 330),
  ('equipment_class', 'Waste', 340),

  ('labor_group', 'Electrical', 200), ('labor_group', 'Plumbing', 210),
  ('labor_group', 'Mechanical', 220), ('labor_group', 'HVAC', 230),
  ('labor_group', 'Carpentry', 240), ('labor_group', 'Finishes', 250),
  ('labor_group', 'Roofing', 260), ('labor_group', 'Envelope', 270),
  ('labor_group', 'Masonry', 280), ('labor_group', 'Steel', 290),
  ('labor_group', 'Concrete', 300), ('labor_group', 'Demolition', 310),
  ('labor_group', 'Environmental', 320), ('labor_group', 'Landscaping', 330),

  ('crew_discipline', 'Electrical', 200), ('crew_discipline', 'Plumbing', 210),
  ('crew_discipline', 'HVAC', 220), ('crew_discipline', 'Mechanical', 230),
  ('crew_discipline', 'Carpentry', 240), ('crew_discipline', 'Finishes', 250),
  ('crew_discipline', 'Roofing', 260), ('crew_discipline', 'Envelope', 270),
  ('crew_discipline', 'Masonry', 280), ('crew_discipline', 'Steel', 290),
  ('crew_discipline', 'Concrete', 300), ('crew_discipline', 'Environmental', 310),
  ('crew_discipline', 'Technical', 320)
) as v(kind, name, sort)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Equipment the building trades use
-- -----------------------------------------------------------------------------
insert into equipment (code, name, equipment_class, ownership_type, planned_hours_per_day,
                       fuel_gallons_per_hour, def_percent_of_fuel, operator_required,
                       mobilization_required, status, source) values
  -- Access
  ('EQ-SCS-19', 'Scissor Lift 19 ft electric', 'Aerial Lift', 'either', 8, 0, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-SCS-32', 'Scissor Lift 32 ft rough terrain', 'Aerial Lift', 'either', 8, 0.35, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-BOOM-45', 'Boom Lift 45 ft articulating', 'Aerial Lift', 'either', 8, 0.55, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-BOOM-60', 'Boom Lift 60 ft telescopic', 'Aerial Lift', 'either', 8, 0.75, 0.03, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-TELE', 'Telehandler 8000 lb', 'Material Handling', 'either', 8, 0.85, 0.03, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-FORK', 'Warehouse Forklift 5000 lb', 'Material Handling', 'either', 8, 0.4, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-SCAF', 'Scaffold System per section', 'Access', 'either', 8, 0, 0, false, true, 'active', 'GrounUp trades pack v1'),
  -- Concrete and masonry
  ('EQ-PUMP-TR', 'Concrete Pump Truck 32 m', 'Concrete', 'rented', 8, 1.4, 0.03, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-PUMP-LN', 'Concrete Line Pump', 'Concrete', 'either', 8, 0.85, 0.03, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-MIX', 'Mortar Mixer 9 CF', 'Concrete', 'either', 8, 0.15, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-PWR-TRW', 'Ride-On Power Trowel', 'Concrete', 'either', 8, 0.35, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-SAW-CON', 'Walk-Behind Concrete Saw', 'Concrete', 'either', 8, 0.4, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-CORE', 'Core Drill Rig', 'Concrete', 'either', 8, 0, 0, true, true, 'active', 'GrounUp trades pack v1'),
  -- Electrical
  ('EQ-PULL', 'Cable Puller 8000 lb', 'Electrical', 'either', 8, 0, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-BEND', 'Hydraulic Conduit Bender', 'Electrical', 'either', 8, 0, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-TRENCH', 'Walk-Behind Trencher 36 in', 'Electrical', 'either', 8, 0.45, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-GEN-25', 'Towable Generator 25 kW', 'Power', 'either', 8, 1.6, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-GEN-100', 'Towable Generator 100 kW', 'Power', 'either', 8, 5.5, 0.03, false, true, 'active', 'GrounUp trades pack v1'),
  -- Mechanical, plumbing, HVAC
  ('EQ-THREAD', 'Pipe Threading Machine', 'Plumbing', 'either', 8, 0, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-PRESS', 'Press Tool Kit', 'Plumbing', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-JET', 'Sewer Jetter Trailer', 'Plumbing', 'either', 8, 1.2, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-CAM', 'Sewer Inspection Camera', 'Plumbing', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-RECOV', 'Refrigerant Recovery Machine', 'HVAC', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-VAC', 'Vacuum Pump 8 CFM', 'HVAC', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-DUCT', 'Duct Cleaning Rig', 'HVAC', 'either', 8, 0.6, 0, true, true, 'active', 'GrounUp trades pack v1'),
  -- Finishes
  ('EQ-DW-LIFT', 'Drywall Panel Lift', 'Finishes', 'either', 8, 0, 0, false, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-DW-SAND', 'Drywall Sander with Vacuum', 'Finishes', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-TEX', 'Texture and Drywall Sprayer', 'Finishes', 'either', 8, 0.2, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-PAINT', 'Airless Paint Sprayer', 'Finishes', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-TILE', 'Wet Tile Saw 10 in', 'Finishes', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  ('EQ-FLR-SAND', 'Floor Sander Drum', 'Finishes', 'either', 8, 0, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-FLR-GRIND', 'Concrete Floor Grinder', 'Finishes', 'either', 8, 0, 0, true, true, 'active', 'GrounUp trades pack v1'),
  -- Roofing and envelope
  ('EQ-ROOF-KET', 'Roofing Kettle', 'Roofing', 'either', 8, 1.1, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-ROOF-HOI', 'Roofing Ladder Hoist', 'Roofing', 'either', 8, 0.12, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-WELD-HOT', 'Hot Air Membrane Welder', 'Roofing', 'either', 8, 0, 0, true, false, 'active', 'GrounUp trades pack v1'),
  -- Steel and welding
  ('EQ-WELD', 'Engine Drive Welder 300 A', 'Welding', 'either', 8, 0.65, 0, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-CRANE-30', 'Carry Deck Crane 15 ton', 'Crane', 'rented', 8, 0.9, 0.03, true, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-MAN-LIFT', 'Material Lift 24 ft', 'Material Handling', 'either', 8, 0, 0, false, true, 'active', 'GrounUp trades pack v1'),
  -- Site services shared by every trade
  ('EQ-COMP-185', 'Air Compressor 185 CFM', 'Air', 'either', 8, 1.1, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-HEAT', 'Construction Heater 400k BTU', 'Temporary Services', 'either', 8, 2.8, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-DEHU', 'Dehumidifier 250 pint', 'Temporary Services', 'either', 8, 0, 0, false, true, 'active', 'GrounUp trades pack v1'),
  ('EQ-DUMP-40', 'Roll-Off Dumpster 40 CY', 'Waste', 'rented', 8, 0, 0, false, true, 'active', 'GrounUp trades pack v1')
on conflict do nothing;

insert into equipment_rates (company_id, equipment_id, source, hourly_rate, daily_rate,
                             weekly_rate, monthly_rate, reference, effective_date)
select null, e.id, 'global_seed', v.hourly, v.daily, v.weekly, v.monthly,
       'GrounUp v2.0 seed assumption — replace with a vendor or company rate before issuing',
       date '2026-01-01'
from (values
  ('EQ-SCS-19', 12.5::numeric, 100::numeric, 300::numeric, 750::numeric),
  ('EQ-SCS-32', 25::numeric, 200::numeric, 600::numeric, 1500::numeric),
  ('EQ-BOOM-45', 37.5::numeric, 300::numeric, 900::numeric, 2400::numeric),
  ('EQ-BOOM-60', 56.25::numeric, 450::numeric, 1350::numeric, 3600::numeric),
  ('EQ-TELE', 43.75::numeric, 350::numeric, 1050::numeric, 2800::numeric),
  ('EQ-FORK', 25::numeric, 200::numeric, 600::numeric, 1600::numeric),
  ('EQ-SCAF', 1.5::numeric, 12::numeric, 36::numeric, 95::numeric),
  ('EQ-PUMP-TR', 218.75::numeric, 1750::numeric, 7000::numeric, 21000::numeric),
  ('EQ-PUMP-LN', 106.25::numeric, 850::numeric, 3400::numeric, 10200::numeric),
  ('EQ-MIX', 7.5::numeric, 60::numeric, 180::numeric, 480::numeric),
  ('EQ-PWR-TRW', 18.75::numeric, 150::numeric, 450::numeric, 1200::numeric),
  ('EQ-SAW-CON', 15::numeric, 120::numeric, 360::numeric, 950::numeric),
  ('EQ-CORE', 16.25::numeric, 130::numeric, 390::numeric, 1050::numeric),
  ('EQ-PULL', 21.25::numeric, 170::numeric, 510::numeric, 1350::numeric),
  ('EQ-BEND', 11.25::numeric, 90::numeric, 270::numeric, 720::numeric),
  ('EQ-TRENCH', 21.25::numeric, 170::numeric, 510::numeric, 1350::numeric),
  ('EQ-GEN-25', 18.75::numeric, 150::numeric, 450::numeric, 1200::numeric),
  ('EQ-GEN-100', 50::numeric, 400::numeric, 1200::numeric, 3200::numeric),
  ('EQ-THREAD', 12.5::numeric, 100::numeric, 300::numeric, 800::numeric),
  ('EQ-PRESS', 10::numeric, 80::numeric, 240::numeric, 640::numeric),
  ('EQ-JET', 43.75::numeric, 350::numeric, 1050::numeric, 2800::numeric),
  ('EQ-CAM', 25::numeric, 200::numeric, 600::numeric, 1600::numeric),
  ('EQ-RECOV', 9.375::numeric, 75::numeric, 225::numeric, 600::numeric),
  ('EQ-VAC', 6.25::numeric, 50::numeric, 150::numeric, 400::numeric),
  ('EQ-DUCT', 37.5::numeric, 300::numeric, 900::numeric, 2400::numeric),
  ('EQ-DW-LIFT', 5::numeric, 40::numeric, 120::numeric, 320::numeric),
  ('EQ-DW-SAND', 8.75::numeric, 70::numeric, 210::numeric, 560::numeric),
  ('EQ-TEX', 18.75::numeric, 150::numeric, 450::numeric, 1200::numeric),
  ('EQ-PAINT', 11.25::numeric, 90::numeric, 270::numeric, 720::numeric),
  ('EQ-TILE', 7.5::numeric, 60::numeric, 180::numeric, 480::numeric),
  ('EQ-FLR-SAND', 12.5::numeric, 100::numeric, 300::numeric, 800::numeric),
  ('EQ-FLR-GRIND', 21.25::numeric, 170::numeric, 510::numeric, 1350::numeric),
  ('EQ-ROOF-KET', 31.25::numeric, 250::numeric, 750::numeric, 2000::numeric),
  ('EQ-ROOF-HOI', 11.25::numeric, 90::numeric, 270::numeric, 720::numeric),
  ('EQ-WELD-HOT', 15::numeric, 120::numeric, 360::numeric, 960::numeric),
  ('EQ-WELD', 25::numeric, 200::numeric, 600::numeric, 1600::numeric),
  ('EQ-CRANE-30', 125::numeric, 1000::numeric, 4000::numeric, 12000::numeric),
  ('EQ-MAN-LIFT', 6.25::numeric, 50::numeric, 150::numeric, 400::numeric),
  ('EQ-COMP-185', 21.25::numeric, 170::numeric, 510::numeric, 1350::numeric),
  ('EQ-HEAT', 18.75::numeric, 150::numeric, 450::numeric, 1200::numeric),
  ('EQ-DEHU', 12.5::numeric, 100::numeric, 300::numeric, 800::numeric),
  ('EQ-DUMP-40', 0::numeric, 0::numeric, 0::numeric, 0::numeric)
) as v(code, hourly, daily, weekly, monthly)
join equipment e on e.code = v.code and e.company_id is null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- The people
--
-- Journeyman and apprentice are separate rows rather than one averaged rate,
-- because the ratio on a crew is the thing a company changes to win work, and
-- an average hides it.
-- -----------------------------------------------------------------------------
insert into labor_rates (code, classification, labor_group, base_wage_per_hour, burden_percent,
                         overtime_multiplier, doubletime_multiplier, region, effective_date,
                         status, source) values
  -- Electrical
  ('LAB-ELEC-JW', 'Electrician Journeyman', 'Electrical', 42, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-ELEC-AP', 'Electrician Apprentice', 'Electrical', 26, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-ELEC-FR', 'Electrical Foreman', 'Electrical', 50, 0.38, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-LV-TECH', 'Low Voltage Technician', 'Electrical', 34, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- Plumbing and mechanical
  ('LAB-PLM-JW', 'Plumber Journeyman', 'Plumbing', 43, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-PLM-AP', 'Plumber Apprentice', 'Plumbing', 26, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-PLM-FR', 'Plumbing Foreman', 'Plumbing', 51, 0.38, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-PIPEFIT', 'Pipefitter', 'Mechanical', 44, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-SPRINK', 'Sprinkler Fitter', 'Mechanical', 43, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- HVAC
  ('LAB-HVAC-JW', 'HVAC Technician Journeyman', 'HVAC', 41, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-HVAC-AP', 'HVAC Apprentice', 'HVAC', 25, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-SHEET', 'Sheet Metal Worker', 'HVAC', 40, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-BALANCE', 'Test and Balance Technician', 'HVAC', 46, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- Carpentry and framing
  ('LAB-CARP-JW', 'Carpenter Journeyman', 'Carpentry', 38, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-CARP-AP', 'Carpenter Apprentice', 'Carpentry', 24, 0.33, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-CARP-FIN', 'Finish Carpenter', 'Carpentry', 41, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-FRAME', 'Framer', 'Carpentry', 34, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- Drywall, paint and finishes
  ('LAB-DW-HANG', 'Drywall Hanger', 'Finishes', 32, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-DW-FIN', 'Drywall Finisher', 'Finishes', 34, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-PAINT', 'Painter', 'Finishes', 31, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-TAPE', 'Taper', 'Finishes', 33, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-FLOOR', 'Flooring Installer', 'Finishes', 33, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-TILE', 'Tile Setter', 'Finishes', 36, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-CEIL', 'Acoustical Ceiling Installer', 'Finishes', 33, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- Envelope
  ('LAB-ROOF', 'Roofer', 'Roofing', 33, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-ROOF-FR', 'Roofing Foreman', 'Roofing', 42, 0.38, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-SIDING', 'Siding Installer', 'Roofing', 31, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-GLAZ', 'Glazier', 'Envelope', 38, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-INSUL', 'Insulator', 'Envelope', 30, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-WATERPRF', 'Waterproofer', 'Envelope', 34, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- Structure
  ('LAB-MASON', 'Mason', 'Masonry', 39, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-MASON-TEND', 'Mason Tender', 'Masonry', 27, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-IRON', 'Ironworker', 'Steel', 44, 0.38, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-WELDER', 'Certified Welder', 'Steel', 45, 0.38, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-REBAR', 'Rebar Placer', 'Concrete', 34, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-FORM', 'Form Carpenter', 'Concrete', 37, 0.35, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  -- Specialty
  ('LAB-DEMO', 'Demolition Worker', 'Demolition', 29, 0.36, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-ABATE', 'Abatement Worker', 'Environmental', 36, 0.4, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-DRONE', 'Drone Pilot Part 107', 'Technical', 45, 0.32, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-LSC', 'Landscape Installer', 'Landscaping', 28, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-IRRIG', 'Irrigation Technician', 'Landscaping', 33, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-FENCE', 'Fence Installer', 'Landscaping', 30, 0.34, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-SUPT', 'Superintendent', 'Supervision', 58, 0.32, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1'),
  ('LAB-APPREN', 'General Apprentice', 'Labor', 22, 0.33, 1.5, 2, 'Toledo, Ohio open-shop baseline', '2026-07-21', 'active', 'GrounUp trades pack v1')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Crews
--
-- Sized the way a small commercial contractor actually runs them: a lead, a
-- helper, and the ratio between them. Somebody who runs two-man electrical
-- crews changes the headcount and the estimate follows.
-- -----------------------------------------------------------------------------
insert into crews (code, name, discipline, shift_hours, status, source) values
  ('CRW-ELEC-01', 'Electrical rough-in crew', 'Electrical', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-ELEC-02', 'Electrical trim and device crew', 'Electrical', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-ELEC-03', 'Electrical service and gear crew', 'Electrical', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-LV-01', 'Low voltage and data crew', 'Electrical', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-PLM-01', 'Plumbing rough-in crew', 'Plumbing', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-PLM-02', 'Plumbing trim and fixture crew', 'Plumbing', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-PLM-03', 'Site utility plumbing crew', 'Plumbing', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-HVAC-01', 'HVAC ductwork crew', 'HVAC', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-HVAC-02', 'HVAC equipment set crew', 'HVAC', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-HVAC-03', 'HVAC controls and balancing crew', 'HVAC', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-SPRINK-01', 'Fire sprinkler crew', 'Mechanical', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-FRAME-01', 'Framing crew', 'Carpentry', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-CARP-01', 'Finish carpentry crew', 'Carpentry', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-DW-01', 'Drywall hanging crew', 'Finishes', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-DW-02', 'Drywall finishing crew', 'Finishes', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-PAINT-01', 'Painting crew', 'Finishes', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-FLR-01', 'Flooring crew', 'Finishes', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-TILE-01', 'Tile crew', 'Finishes', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-CEIL-01', 'Acoustical ceiling crew', 'Finishes', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-ROOF-01', 'Roofing crew', 'Roofing', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-ROOF-02', 'Low slope membrane crew', 'Roofing', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-SIDE-01', 'Siding and trim crew', 'Roofing', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-GLAZ-01', 'Glazing crew', 'Envelope', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-INSUL-01', 'Insulation crew', 'Envelope', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-WP-01', 'Waterproofing crew', 'Envelope', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-MAS-01', 'Masonry crew', 'Masonry', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-STL-01', 'Structural steel erection crew', 'Steel', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-REBAR-01', 'Rebar placing crew', 'Concrete', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-FORM-01', 'Concrete forming crew', 'Concrete', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-FLAT-01', 'Concrete flatwork crew', 'Concrete', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-ABATE-01', 'Abatement crew', 'Environmental', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-DRONE-01', 'Drone survey crew', 'Technical', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-IRRIG-01', 'Irrigation crew', 'Landscaping', 8, 'active', 'GrounUp trades pack v1'),
  ('CRW-FENCE-01', 'Fencing crew', 'Landscaping', 8, 'active', 'GrounUp trades pack v1')
on conflict do nothing;

insert into crew_members (company_id, crew_id, labor_rate_id, headcount)
select null, c.id, l.id, v.headcount
from (values
  ('CRW-ELEC-01', 'LAB-ELEC-FR', 1), ('CRW-ELEC-01', 'LAB-ELEC-JW', 2), ('CRW-ELEC-01', 'LAB-ELEC-AP', 2),
  ('CRW-ELEC-02', 'LAB-ELEC-JW', 1), ('CRW-ELEC-02', 'LAB-ELEC-AP', 1),
  ('CRW-ELEC-03', 'LAB-ELEC-FR', 1), ('CRW-ELEC-03', 'LAB-ELEC-JW', 2),
  ('CRW-LV-01', 'LAB-LV-TECH', 2),
  ('CRW-PLM-01', 'LAB-PLM-FR', 1), ('CRW-PLM-01', 'LAB-PLM-JW', 2), ('CRW-PLM-01', 'LAB-PLM-AP', 2),
  ('CRW-PLM-02', 'LAB-PLM-JW', 1), ('CRW-PLM-02', 'LAB-PLM-AP', 1),
  ('CRW-PLM-03', 'LAB-PLM-FR', 1), ('CRW-PLM-03', 'LAB-PIPE', 2), ('CRW-PLM-03', 'LAB-OP1', 1),
  ('CRW-HVAC-01', 'LAB-SHEET', 2), ('CRW-HVAC-01', 'LAB-HVAC-AP', 1),
  ('CRW-HVAC-02', 'LAB-HVAC-JW', 2), ('CRW-HVAC-02', 'LAB-HVAC-AP', 1), ('CRW-HVAC-02', 'LAB-OP1', 1),
  ('CRW-HVAC-03', 'LAB-BALANCE', 1), ('CRW-HVAC-03', 'LAB-HVAC-JW', 1),
  ('CRW-SPRINK-01', 'LAB-SPRINK', 2), ('CRW-SPRINK-01', 'LAB-APPREN', 1),
  ('CRW-FRAME-01', 'LAB-FRM', 1), ('CRW-FRAME-01', 'LAB-FRAME', 3), ('CRW-FRAME-01', 'LAB-CARP-AP', 1),
  ('CRW-CARP-01', 'LAB-CARP-FIN', 2), ('CRW-CARP-01', 'LAB-CARP-AP', 1),
  ('CRW-DW-01', 'LAB-DW-HANG', 3), ('CRW-DW-01', 'LAB-APPREN', 1),
  ('CRW-DW-02', 'LAB-DW-FIN', 2), ('CRW-DW-02', 'LAB-TAPE', 2),
  ('CRW-PAINT-01', 'LAB-PAINT', 3),
  ('CRW-FLR-01', 'LAB-FLOOR', 2), ('CRW-FLR-01', 'LAB-APPREN', 1),
  ('CRW-TILE-01', 'LAB-TILE', 2), ('CRW-TILE-01', 'LAB-APPREN', 1),
  ('CRW-CEIL-01', 'LAB-CEIL', 2),
  ('CRW-ROOF-01', 'LAB-ROOF-FR', 1), ('CRW-ROOF-01', 'LAB-ROOF', 4),
  ('CRW-ROOF-02', 'LAB-ROOF-FR', 1), ('CRW-ROOF-02', 'LAB-ROOF', 3),
  ('CRW-SIDE-01', 'LAB-SIDING', 2), ('CRW-SIDE-01', 'LAB-APPREN', 1),
  ('CRW-GLAZ-01', 'LAB-GLAZ', 2), ('CRW-GLAZ-01', 'LAB-APPREN', 1),
  ('CRW-INSUL-01', 'LAB-INSUL', 2),
  ('CRW-WP-01', 'LAB-WATERPRF', 2),
  ('CRW-MAS-01', 'LAB-FRM', 1), ('CRW-MAS-01', 'LAB-MASON', 3), ('CRW-MAS-01', 'LAB-MASON-TEND', 2),
  ('CRW-STL-01', 'LAB-FRM', 1), ('CRW-STL-01', 'LAB-IRON', 3), ('CRW-STL-01', 'LAB-WELDER', 1),
  ('CRW-REBAR-01', 'LAB-REBAR', 3),
  ('CRW-FORM-01', 'LAB-FORM', 3), ('CRW-FORM-01', 'LAB-LAB', 2),
  ('CRW-FLAT-01', 'LAB-FRM', 1), ('CRW-FLAT-01', 'LAB-CONC', 3), ('CRW-FLAT-01', 'LAB-LAB', 2),
  ('CRW-ABATE-01', 'LAB-ABATE', 3),
  ('CRW-DRONE-01', 'LAB-DRONE', 1), ('CRW-DRONE-01', 'LAB-SURV', 1),
  ('CRW-IRRIG-01', 'LAB-IRRIG', 2), ('CRW-IRRIG-01', 'LAB-LSC', 1),
  ('CRW-FENCE-01', 'LAB-FENCE', 2), ('CRW-FENCE-01', 'LAB-APPREN', 1)
) as v(crew_code, labor_code, headcount)
join crews c on c.code = v.crew_code and c.company_id is null
join labor_rates l on l.code = v.labor_code and l.company_id is null
on conflict do nothing;

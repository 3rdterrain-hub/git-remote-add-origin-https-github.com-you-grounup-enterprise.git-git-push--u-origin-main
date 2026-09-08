-- =============================================================================
-- GENERATED — do not edit.
--
-- A verbatim copy of `supabase/seed/0005_resource_catalog.sql`, so the catalog can be applied
-- by `supabase db push` rather than by a direct database connection. The seed
-- file is the source; this is the delivery. `npm run seed:migrations`
-- regenerates it and a governance test fails if the two ever differ.
--
-- Everything below is idempotent — `on conflict do nothing` throughout — so
-- applying it twice changes nothing, which is what makes it safe as a
-- migration.
-- =============================================================================

-- =============================================================================
-- 0005 — The product resource catalog
--
-- 183 machines, tools and attachments from the resource library, organized by
-- trade family and equipment group, with a column saying which kinds of work
-- each is used on — and no rates. None. That is the ordinary state of a
-- resource list: somebody builds the catalog long before anybody prices it.
--
-- It is loaded anyway, because an estimator who can find "Hydraulic Conduit
-- Bender" and see that it needs a rate is ahead of one who cannot find it at
-- all. What makes that safe rather than dangerous is migration 0128: a machine
-- with no `equipment_rates` row reads as `unrated`, `my_unrated_equipment`
-- lists every one, and nothing here writes a zero that would look like a price.
--
-- Four corrections were made on the way in.
--
-- **Branded rows are named for the machine they are.** The file carries a class
-- row ("Compact Track Loader") and specific machines (Bobcat T76, Caterpillar
-- 259D3) under the same name — 49 names appeared more than once. A branded row
-- is filed as "Compact Track Loader — Bobcat T76", so a search returns three
-- distinguishable things instead of three identical ones.
--
-- **Class rows the library already covers are dropped** (8 of them). A generic
-- "Dozer" beside the existing "Dozer D6 class" and "Dozer D8 class" adds a
-- third search result and no information.
--
-- **Machines keep the catalog's own grouping.** Earthmoving, Access, Compaction,
-- Drone — that organization is the most valuable thing in the file and
-- flattening it into this schema's older classes would throw it away. Only the
-- non-machines are reclassified, by what they are: a tool carries no operator,
-- needs no mobilization and burns no fuel.
--
-- **Ownership is read rather than assumed.** `owned/rental` and a blank both
-- become `either`, which is what a company that might own or rent one has.
-- =============================================================================

insert into library_categories (company_id, kind, name, sort_order)
select null, 'equipment_class', v.name, v.sort
from (values
  ('Access Equipment', 500),
  ('Accessories', 510),
  ('Attachments', 520),
  ('Barrier Equipment', 530),
  ('Compact Equipment', 540),
  ('Compaction Equipment', 550),
  ('Concrete Equipment', 560),
  ('Drone Equipment', 570),
  ('Drywall Equipment', 580),
  ('Earthmoving Equipment', 590),
  ('Electrical Tools', 600),
  ('Fabrication Equipment', 610),
  ('Finishes Equipment', 620),
  ('HVAC Equipment', 630),
  ('Hauling Equipment', 640),
  ('Hauling Vehicles', 650),
  ('Marine Equipment', 660),
  ('Marking Equipment', 670),
  ('Masonry Equipment', 680),
  ('Material Handling', 690),
  ('Material Handling Equipment', 700),
  ('Metalworking Equipment', 710),
  ('On-Road Hauling', 720),
  ('Painting Equipment', 730),
  ('Paving Equipment', 740),
  ('Plumbing Tools', 750),
  ('Pollution Equipment', 760),
  ('Power Equipment', 770),
  ('Safety Equipment', 780),
  ('Siding Equipment', 790),
  ('Small Tools', 800),
  ('Technology', 810),
  ('Traffic Control Devices', 820),
  ('Traffic Control Equipment', 830),
  ('Utility Equipment', 840),
  ('Utility Vehicles', 850),
  ('Washing Equipment', 860),
  ('Water Equipment', 870)
) as v(name, sort)
on conflict do nothing;

insert into equipment (code, name, equipment_class, ownership_type, planned_hours_per_day,
                       fuel_gallons_per_hour, def_percent_of_fuel, operator_required,
                       mobilization_required, status, brand, model, service_groups, source) values
  ('EQC-ACCESS-CONTROL-PROGRAMMER-HID-PROG', 'Access Control Programmer — HID Programmer', 'Technology', 'owned', 8, 0, 0, false, false, 'active', 'HID', 'Programmer', array['Access control configuration']::text[], 'GrounUp resource catalog v1'),
  ('EQC-AIR-SCRUBBER-ABATEMENT-TECHNOLOGIE', 'Air Scrubber — Abatement Technologies HEPA-AIRE', 'Pollution Equipment', 'either', 8, 0, 0, true, true, 'active', 'Abatement Technologies', 'HEPA-AIRE', array['Pollution control']::text[], 'GrounUp resource catalog v1'),
  ('EQC-ARROW-BOARD-WANCO-WTSP55-4', 'Arrow Board — Wanco WTSP55-4', 'Traffic Control Equipment', 'either', 8, 0, 0, true, true, 'active', 'Wanco', 'WTSP55-4', array['Closures', 'tapers']::text[], 'GrounUp resource catalog v1'),
  ('EQC-ARROW-BOARD', 'Arrow Board', 'Traffic Control Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Closures', 'tapers']::text[], 'GrounUp resource catalog v1'),
  ('EQC-ARTICULATED-DUMP-TRUCK-VOLVO-A30G', 'Articulated Dump Truck — Volvo A30G', 'Hauling Equipment', 'rented', 8, 0, 0, true, true, 'active', 'Volvo', 'A30G', array['Mass haul']::text[], 'GrounUp resource catalog v1'),
  ('EQC-ASPHALT-PAVER-CATERPILLAR-AP555F', 'Asphalt Paver — Caterpillar AP555F', 'Paving Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', 'AP555F', array['Paving', 'resurfacing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-AUGER-DRIVE-BOBCAT-25C', 'Auger Drive — Bobcat 25C', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Bobcat', '25C', array['Post holes', 'piers']::text[], 'GrounUp resource catalog v1'),
  ('EQC-BATTERIES-DJI-ENTERPRISE-BATTERY-S', 'Batteries — DJI Enterprise Battery Set', 'Accessories', 'owned', 8, 0, 0, false, false, 'active', 'DJI', 'Enterprise Battery Set', array['All drone missions']::text[], 'GrounUp resource catalog v1'),
  ('EQC-BEAM-CLAMP-RIGGING-SET-CM-LODESTAR', 'Beam Clamp / Rigging Set — CM Lodestar Rigging', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', 'CM', 'Lodestar Rigging', array['Steel install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-BEARING-HEATER-SKF-TIH-100M', 'Bearing Heater — SKF TIH 100m', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'SKF', 'TIH 100m', array['Material processing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-BOOM-LIFT-JLG-450AJ', 'Boom Lift — JLG 450AJ', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'JLG', '450AJ', array['Steel', 'facade', 'openings']::text[], 'GrounUp resource catalog v1'),
  ('EQC-BUCKET-CATERPILLAR-36IN-TRENCHING', 'Bucket — Caterpillar 36in Trenching Bucket', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Caterpillar', '36in Trenching Bucket', array['Trenching']::text[], 'GrounUp resource catalog v1'),
  ('EQC-BUCKET-CATERPILLAR-CLEANUP-BUCKET', 'Bucket — Caterpillar Cleanup Bucket', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Caterpillar', 'Cleanup Bucket', array['Fine grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CCTV-TESTER-HIKMICRO-CCTV-TEST-MON', 'CCTV Tester — Hikmicro CCTV Test Monitor', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Hikmicro', 'CCTV Test Monitor', array['Camera setup']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CABINET-SPRAYER-TITAN-FLEXSPRAY-HV', 'Cabinet Sprayer — Titan FlexSpray HVLP', 'Painting Equipment', 'either', 8, 0, 0, true, true, 'active', 'Titan', 'FlexSpray HVLP', array['Cabinet finishing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CABLE-TESTER-FLUKE-NETWORKS-DSX-50', 'Cable Tester — Fluke Networks DSX-5000', 'Technology', 'either', 8, 0, 0, false, false, 'active', 'Fluke Networks', 'DSX-5000', array['Termination', 'QA']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CABLE-TESTER', 'Cable Tester', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Termination', 'QA']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CAMERA-DRONE', 'Camera Drone', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Media capture']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CAULK-GUN-MILWAUKEE-M18-CAULK-AND', 'Caulk Gun — Milwaukee M18 Caulk and Adhesive Gun', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Milwaukee', 'M18 Caulk and Adhesive Gun', array['Sealants', 'adhesives']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CHEMICAL-INJECTOR-GENERAL-PUMP-DOW', 'Chemical Injector — General Pump Downstream Injector', 'Attachments', 'owned', 8, 0, 0, false, false, 'active', 'General Pump', 'Downstream Injector', array['Pretreat', 'post-treat']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CHEMICAL-TANK', 'Chemical Tank', 'Attachments', 'either', 8, 0, 0, false, false, 'active', null, null, array['Pretreat', 'post-treat']::text[], 'GrounUp resource catalog v1'),
  ('EQC-COMBUSTION-ANALYZER-TESTO-300', 'Combustion Analyzer — Testo 300', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Testo', '300', array['Combustion setup']::text[], 'GrounUp resource catalog v1'),
  ('EQC-COMPACT-TRACK-LOADER-BOBCAT-T76', 'Compact Track Loader — Bobcat T76', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', 'Bobcat', 'T76', array['General site support']::text[], 'GrounUp resource catalog v1'),
  ('EQC-COMPACT-TRACK-LOADER-CATERPILLAR-2', 'Compact Track Loader — Caterpillar 259D3', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', '259D3', array['General site support']::text[], 'GrounUp resource catalog v1'),
  ('EQC-COMPACTOR', 'Compactor', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Backfill', 'compaction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONCRETE-BARRIER', 'Concrete Barrier', 'Barrier Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Barriers', 'rail']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONCRETE-FORMS', 'Concrete Forms', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Forming', 'placing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONCRETE-SAW-HUSQVARNA-FS-5000-D', 'Concrete Saw — Husqvarna FS 5000 D', 'Concrete Equipment', 'either', 8, 0, 0, true, true, 'active', 'Husqvarna', 'FS 5000 D', array['Sawcut', 'joint work']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONCRETE-SAW', 'Concrete Saw', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Sawcut', 'joint work']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONCRETE-VIBRATOR-WACKER-NEUSON-IR', 'Concrete Vibrator — Wacker Neuson IRFU 57', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Wacker Neuson', 'IRFU 57', array['Consolidation']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONCRETE-VIBRATOR', 'Concrete Vibrator', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Consolidation']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONDUIT-BENDER-GREENLEE-855GX', 'Conduit Bender — Greenlee 855GX', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', 'Greenlee', '855GX', array['Conduit install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONDUIT-BENDER', 'Conduit Bender', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Conduit install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONTROLLER-DJI-RC-PLUS', 'Controller — DJI RC Plus', 'Accessories', 'owned', 8, 0, 0, false, false, 'active', 'DJI', 'RC Plus', array['All drone missions']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONVEYOR-INSTALL-TOOLS-FLEXCO-BELT', 'Conveyor Install Tools — Flexco Belt Installation Kit', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Flexco', 'Belt Installation Kit', array['Material processing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-CONVEYOR-INSTALL-TOOLS', 'Conveyor Install Tools', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Material processing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DIGITAL-GAUGE-SET-FIELDPIECE-SM480', 'Digital Gauge Set — Fieldpiece SM480V', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Fieldpiece', 'SM480V', array['Charging', 'testing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DOZER-CATERPILLAR-D5', 'Dozer — Caterpillar D5', 'Earthmoving Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', 'D5', array['Earthwork', 'grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DOZER-JOHN-DEERE-650K', 'Dozer — John Deere 650K', 'Earthmoving Equipment', 'either', 8, 0, 0, true, true, 'active', 'John Deere', '650K', array['Earthwork', 'grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DRAIN-CAMERA-RIDGID-SEESNAKE-COMPA', 'Drain Camera — RIDGID SeeSnake Compact C40', 'Technology', 'either', 8, 0, 0, false, false, 'active', 'RIDGID', 'SeeSnake Compact C40', array['Drain', 'sewer inspection']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DRONE-BATTERIES', 'Drone Batteries', 'Accessories', 'either', 8, 0, 0, false, false, 'active', null, null, array['All drone missions']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DRONE-CONTROLLER', 'Drone Controller', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['All drone missions']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DRONE-PROCESSING-WORKSTATION', 'Drone Processing Workstation', 'Technology', 'either', 8, 0, 0, false, false, 'active', null, null, array['Processing', 'deliverables']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DRYWALL-LIFT-PANELLIFT-439', 'Drywall Lift — Panellift 439', 'Drywall Equipment', 'either', 8, 0, 0, true, true, 'active', 'Panellift', '439', array['Drywall ceiling install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DRYWALL-SANDER-FESTOOL-PLANEX-LHS', 'Drywall Sander — Festool PLANEX LHS 2 225', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Festool', 'PLANEX LHS 2 225', array['Drywall finishing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DUCT-LIFT-TELPRO-PANELLIFT-DUCT-LI', 'Duct Lift — Telpro Panellift Duct Lift', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'Telpro', 'Panellift Duct Lift', array['Duct install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DUMP-TRUCK-KENWORTH-T880', 'Dump Truck — Kenworth T880', 'On-Road Hauling', 'either', 8, 0, 0, true, true, 'active', 'Kenworth', 'T880', array['Hauling', 'disposal']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DUMP-TRUCK-MACK-GRANITE', 'Dump Truck — Mack Granite', 'On-Road Hauling', 'either', 8, 0, 0, true, true, 'active', 'Mack', 'Granite', array['Hauling', 'disposal']::text[], 'GrounUp resource catalog v1'),
  ('EQC-DUMP-TRUCK', 'Dump Truck', 'Hauling Vehicles', 'either', 8, 0, 0, true, true, 'active', null, null, array['Hauling', 'stockpile', 'disposal']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FINISH-NAILER-DEWALT-DCN660', 'Finish Nailer — DeWalt DCN660', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'DeWalt', 'DCN660', array['Windows', 'doors', 'trim']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FIRE-ALARM-TEST-SET-HONEYWELL-FIRE', 'Fire Alarm Test Set — Honeywell Fire Alarm Test Kit', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Honeywell', 'Fire Alarm Test Kit', array['Alarm testing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FLOOR-ROLLER-ROBERTS-10-950', 'Floor Roller — Roberts 10-950', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Roberts', '10-950', array['LVP', 'resilient flooring']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FLOOR-ROLLER', 'Floor Roller', 'Finishes Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Flooring install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FORK-ATTACHMENT-BOBCAT-PALLET-FORK', 'Fork Attachment — Bobcat Pallet Fork', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Bobcat', 'Pallet Fork', array['Material handling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FORKLIFT-JLG-G5-18A', 'Forklift — JLG G5-18A', 'Material Handling', 'either', 8, 0, 0, true, true, 'active', 'JLG', 'G5-18A', array['Masonry', 'framing support']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FORKLIFT-TOYOTA-8FGCU25', 'Forklift — Toyota 8FGCU25', 'Material Handling', 'either', 8, 0, 0, true, true, 'active', 'Toyota', '8FGCU25', array['Equipment', 'furnishings', 'special construction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FORKLIFT', 'Forklift', 'Material Handling Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Equipment', 'furnishings', 'special construction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FRAMING-NAILER-PASLODE-CF325XP', 'Framing Nailer — Paslode CF325XP', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Paslode', 'CF325XP', array['Wood framing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FRAMING-NAILER', 'Framing Nailer', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Framing install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-FUSION-SPLICER-FUJIKURA-90S', 'Fusion Splicer — Fujikura 90S+', 'Technology', 'either', 8, 0, 0, false, false, 'active', 'Fujikura', '90S+', array['Fiber splicing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GCP-TARGET-KIT-PROPELLER-AEROPOINT', 'GCP Target Kit — Propeller AeroPoints', 'Accessories', 'either', 8, 0, 0, false, false, 'active', 'Propeller', 'AeroPoints', array['Mapping', 'modeling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GPS-ROVER-TRIMBLE-R12I', 'GPS Rover — Trimble R12i', 'Technology', 'either', 8, 0, 0, false, false, 'active', 'Trimble', 'R12i', array['Layout', 'grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GAS-DETECTOR-MSA-ALTAIR-4XR', 'Gas Detector — MSA ALTAIR 4XR', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'MSA', 'ALTAIR 4XR', array['Pollution control', 'confined space']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GENERATOR-GENERAC-RG048', 'Generator — Generac RG048', 'Power Equipment', 'either', 8, 0, 0, true, true, 'active', 'Generac', 'RG048', array['Power generation']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GENERATOR', 'Generator', 'Power Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Power generation']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GRAPPLE-CATERPILLAR-G315B', 'Grapple — Caterpillar G315B', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Caterpillar', 'G315B', array['Sorting', 'loading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GRAPPLE', 'Grapple', 'Attachments', 'either', 8, 0, 0, false, false, 'active', null, null, array['Sorting', 'debris handling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GROUND-CONTROL-KIT', 'Ground Control Kit', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Mapping', 'modeling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-GROUND-CONTROL-ROVER-EMLID-REACH-R', 'Ground Control Rover — Emlid Reach RS3', 'Technology', 'either', 8, 0, 0, false, false, 'active', 'Emlid', 'Reach RS3', array['Mapping', 'modeling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HOT-WATER-PRESSURE-WASHER-HOTSY-10', 'Hot Water Pressure Washer — Hotsy 1075SSE', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', 'Hotsy', '1075SSE', array['Method-specific washing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HOT-WATER-PRESSURE-WASHER', 'Hot Water Pressure Washer', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Method-specific washing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDRAULIC-BREAKER-BOBCAT-HB980', 'Hydraulic Breaker — Bobcat HB980', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Bobcat', 'HB980', array['Concrete', 'rock demolition']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDRAULIC-BREAKER-CAT-WORK-TOOLS-H', 'Hydraulic Breaker — Cat Work Tools H120', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Cat Work Tools', 'H120', array['Concrete', 'rock demolition']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDRAULIC-BREAKER', 'Hydraulic Breaker', 'Attachments', 'either', 8, 0, 0, false, false, 'active', null, null, array['Concrete', 'rock demolition']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDRAULIC-EXCAVATOR-CATERPILLAR-32', 'Hydraulic Excavator — Caterpillar 320', 'Earthmoving Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', '320', array['Excavation & Earthwork']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDRAULIC-EXCAVATOR-JOHN-DEERE-210', 'Hydraulic Excavator — John Deere 210G LC', 'Earthmoving Equipment', 'either', 8, 0, 0, true, true, 'active', 'John Deere', '210G LC', array['Excavation & Earthwork']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDRAULIC-EXCAVATOR-KOMATSU-PC210L', 'Hydraulic Excavator — Komatsu PC210LC', 'Earthmoving Equipment', 'either', 8, 0, 0, true, true, 'active', 'Komatsu', 'PC210LC', array['Excavation & Earthwork']::text[], 'GrounUp resource catalog v1'),
  ('EQC-HYDROVAC-TRUCK-VACTOR-2100I', 'Hydrovac Truck — Vactor 2100i', 'Utility Vehicles', 'rented', 8, 0, 0, true, true, 'active', 'Vactor', '2100i', array['Utility exposure', 'potholing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-INSPECTION-DRONE-DJI-MAVIC-3-ENTER', 'Inspection Drone — DJI Mavic 3 Enterprise', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', 'DJI', 'Mavic 3 Enterprise', array['Inspection', 'survey']::text[], 'GrounUp resource catalog v1'),
  ('EQC-INSPECTION-DRONE', 'Inspection Drone', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Inspection', 'survey']::text[], 'GrounUp resource catalog v1'),
  ('EQC-JUMPING-JACK-RAMMER-WACKER-NEUSON', 'Jumping Jack Rammer — Wacker Neuson BS60-4', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', 'Wacker Neuson', 'BS60-4', array['Trench compaction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-LABEL-PRINTER-BRADY-M611', 'Label Printer — Brady M611', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Brady', 'M611', array['Cable identification']::text[], 'GrounUp resource catalog v1'),
  ('EQC-LASER-LEVEL-TOPCON-RL-H5A', 'Laser Level — Topcon RL-H5A', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Topcon', 'RL-H5A', array['Layout', 'fine grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-LASER-LEVEL', 'Laser Level', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Layout', 'fine grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-LEAK-DETECTOR-TESTO-316-4', 'Leak Detector — Testo 316-4', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Testo', '316-4', array['Gas', 'plumbing checks']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MAG-DRILL-HOUGEN-HMD904', 'Mag Drill — Hougen HMD904', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Hougen', 'HMD904', array['Steel drilling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MAPPING-PAYLOAD-DJI-ZENMUSE-P1', 'Mapping Payload — DJI Zenmuse P1', 'Accessories', 'either', 8, 0, 0, false, false, 'active', 'DJI', 'Zenmuse P1', array['Mapping', 'modeling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MASONRY-MIXER', 'Masonry Mixer', 'Masonry Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Mortar mixing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MEDIA-DRONE-DJI-AIR-3', 'Media Drone — DJI Air 3', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', 'DJI', 'Air 3', array['Media capture']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MINI-EXCAVATOR-BOBCAT-E50', 'Mini Excavator — Bobcat E50', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', 'Bobcat', 'E50', array['Tight-access earthwork']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MINI-EXCAVATOR-CATERPILLAR-305-CR', 'Mini Excavator — Caterpillar 305 CR', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', '305 CR', array['Tight-access earthwork']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MINI-EXCAVATOR-KUBOTA-KX040-4', 'Mini Excavator — Kubota KX040-4', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', 'Kubota', 'KX040-4', array['Tight-access earthwork']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MITER-SAW-DEWALT-DWS780', 'Miter Saw — DeWalt DWS780', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'DeWalt', 'DWS780', array['Trim', 'framing cuts']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MITER-SAW', 'Miter Saw', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Trim', 'framing cuts']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MORTAR-MIXER-MULTIQUIP-MC94SH8', 'Mortar Mixer — Multiquip MC94SH8', 'Masonry Equipment', 'either', 8, 0, 0, true, true, 'active', 'Multiquip', 'MC94SH8', array['Mortar mixing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MULTIMETER-FLUKE-87V', 'Multimeter — Fluke 87V', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Fluke', '87V', array['Testing', 'troubleshooting']::text[], 'GrounUp resource catalog v1'),
  ('EQC-MULTIMETER', 'Multimeter', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Testing', 'troubleshooting']::text[], 'GrounUp resource catalog v1'),
  ('EQC-ORBITAL-SANDER-FESTOOL-ETS-EC-150', 'Orbital Sander — Festool ETS EC 150', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Festool', 'ETS EC 150', array['Prep', 'sanding']::text[], 'GrounUp resource catalog v1'),
  ('EQC-OUTBOARD-MOTOR-YAMAHA-F60', 'Outboard Motor — Yamaha F60', 'Accessories', 'either', 8, 0, 0, false, false, 'active', 'Yamaha', 'F60', array['Marine', 'shoreline work']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PEX-EXPANDER-MILWAUKEE-M18-PROPEX', 'PEX Expander — Milwaukee M18 ProPEX Expansion Tool', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Milwaukee', 'M18 ProPEX Expansion Tool', array['PEX install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PADFOOT-ROLLER-BOMAG-BW177', 'Padfoot Roller — Bomag BW177', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', 'Bomag', 'BW177', array['Clay', 'embankment compaction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PAINT-SPRAYER-GRACO-ULTRA-MAX-II-4', 'Paint Sprayer — Graco Ultra Max II 495', 'Painting Equipment', 'either', 8, 0, 0, true, true, 'active', 'Graco', 'Ultra Max II 495', array['Painting', 'coatings']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PAINT-SPRAYER', 'Paint Sprayer', 'Finishes Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Painting', 'coatings']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PAVER', 'Paver', 'Paving Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Paving', 'resurfacing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PIPE-CAMERA', 'Pipe Camera', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Drain', 'sewer inspection']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PIPE-FUSION-MACHINE-MCELROY-TRACST', 'Pipe Fusion Machine — McElroy TracStar 618', 'Water Equipment', 'either', 8, 0, 0, true, true, 'active', 'McElroy', 'TracStar 618', array['HDPE process piping']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PIPE-LASER-TOPCON-TP-L6', 'Pipe Laser — Topcon TP-L6', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Topcon', 'TP-L6', array['Pipe', 'sewer line install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PIPE-LAYER-CATERPILLAR-PL61', 'Pipe Layer — Caterpillar PL61', 'Utility Equipment', 'rented', 8, 0, 0, true, true, 'active', 'Caterpillar', 'PL61', array['Large utility install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PLATE-COMPACTOR-WACKER-NEUSON-DPU4', 'Plate Compactor — Wacker Neuson DPU4545', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', 'Wacker Neuson', 'DPU4545', array['Trench', 'tight-access compaction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PORTABLE-SIGNS-TRAFFIX-ROLL-UP-SIG', 'Portable Signs — TrafFix Roll-Up Sign Kit', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'TrafFix', 'Roll-Up Sign Kit', array['Work zone control']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PORTABLE-TRAFFIC-SIGNAL-VER-MAC-TR', 'Portable Traffic Signal — Ver-Mac TRAFX', 'Traffic Control Equipment', 'rented', 8, 0, 0, true, true, 'active', 'Ver-Mac', 'TRAFX', array['Temporary signals']::text[], 'GrounUp resource catalog v1'),
  ('EQC-POWER-TROWEL-ALLEN-HDX780', 'Power Trowel — Allen HDX780', 'Concrete Equipment', 'either', 8, 0, 0, true, true, 'active', 'Allen', 'HDX780', array['Concrete finishing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-POWER-TROWEL', 'Power Trowel', 'Concrete Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Concrete finishing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PRESS-TOOL-RIDGID-RP-350', 'Press Tool — RIDGID RP 350', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', 'RIDGID', 'RP 350', array['Piping install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PRESSURE-WASHER-HONDA-SIMPSON-PS60', 'Pressure Washer — Honda / Simpson PS60843', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', 'Honda / Simpson', 'PS60843', array['Residential', 'surface washing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PRESSURE-WASHER', 'Pressure Washer', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Residential', 'surface washing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PULVERIZER-GENESIS-GXP300', 'Pulverizer — Genesis GXP300', 'Attachments', 'rented', 8, 0, 0, false, false, 'active', 'Genesis', 'GXP300', array['Concrete processing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PUMP-JACK-SYSTEM-QUAL-CRAFT-PUMP-J', 'Pump Jack System — Qual-Craft Pump Jack Set', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'Qual-Craft', 'Pump Jack Set', array['Siding install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PUMP-SETTING-EQUIPMENT-THERN-DAVIT', 'Pump Setting Equipment — Thern Davit Crane', 'Water Equipment', 'either', 8, 0, 0, true, true, 'active', 'Thern', 'Davit Crane', array['Water', 'wastewater equipment']::text[], 'GrounUp resource catalog v1'),
  ('EQC-PUMP-SETTING-EQUIPMENT', 'Pump Setting Equipment', 'Water Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Water', 'wastewater equipment']::text[], 'GrounUp resource catalog v1'),
  ('EQC-RTK-MAPPING-DRONE-DJI-MATRICE-350', 'RTK Mapping Drone — DJI Matrice 350 RTK', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', 'DJI', 'Matrice 350 RTK', array['Mapping', 'modeling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-RTK-MAPPING-DRONE', 'RTK Mapping Drone', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Mapping', 'modeling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-REBAR-BENDER-CUTTER-BN-PRODUCTS-DC', 'Rebar Bender / Cutter — BN Products DC-20WH', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', 'BN Products', 'DC-20WH', array['Rebar install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-RECOVERY-MACHINE-FIELDPIECE-MR45', 'Recovery Machine — Fieldpiece MR45', 'HVAC Equipment', 'owned', 8, 0, 0, true, true, 'active', 'Fieldpiece', 'MR45', array['Refrigerant recovery']::text[], 'GrounUp resource catalog v1'),
  ('EQC-RECOVERY-MACHINE', 'Recovery Machine', 'HVAC Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Refrigerant recovery']::text[], 'GrounUp resource catalog v1'),
  ('EQC-REFRIGERANT-GAUGES', 'Refrigerant Gauges', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Charging', 'testing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-ROOFING-NAILER-BOSTITCH-RN46-1', 'Roofing Nailer — Bostitch RN46-1', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Bostitch', 'RN46-1', array['Shingle roofing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SAFETY-HARNESS-KIT-3M-DBI-SALA-FAL', 'Safety Harness Kit — 3M DBI-SALA Fall Protection Kit', 'Safety Equipment', 'owned', 8, 0, 0, false, false, 'active', '3M DBI-SALA', 'Fall Protection Kit', array['Roofing', 'elevated work']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SCAFFOLD-BIL-JAX-BAKER-SCAFFOLD', 'Scaffold — Bil-Jax Baker Scaffold', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'Bil-Jax', 'Baker Scaffold', array['Masonry', 'facade work']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SCISSOR-LIFT-GENIE-GS-3246', 'Scissor Lift — Genie GS-3246', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'Genie', 'GS-3246', array['Specialties', 'ceilings', 'accessories']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SCISSOR-LIFT-SKYJACK-SJIII-4632', 'Scissor Lift — Skyjack SJIII 4632', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'Skyjack', 'SJIII 4632', array['Interior framing', 'ceilings']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SCREED-MULTIQUIP-MAGIC-SCREED', 'Screed — Multiquip Magic Screed', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Multiquip', 'Magic Screed', array['Concrete placing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SEALANT-GUN', 'Sealant Gun', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Seal', 'finish']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SHEET-METAL-BRAKE-TAPCO-MAX-20', 'Sheet Metal Brake — Tapco Max-20', 'Fabrication Equipment', 'either', 8, 0, 0, true, true, 'active', 'Tapco', 'Max-20', array['Duct fabrication']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SHEET-METAL-BRAKE', 'Sheet Metal Brake', 'Fabrication Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Duct fabrication']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SHIMMING-KIT-WINBAG-WINDOW-DOOR-KI', 'Shimming Kit — Winbag Window & Door Kit', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Winbag', 'Window & Door Kit', array['Windows', 'doors']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SHIMMING-KIT', 'Shimming Kit', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Unit setting', 'alignment']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SIDING-BRAKE-TAPCO-PRO-19', 'Siding Brake — Tapco PRO 19', 'Siding Equipment', 'either', 8, 0, 0, true, true, 'active', 'Tapco', 'PRO 19', array['Aluminum', 'trim coil bending']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SIGN-SUPPORT-LIFT-VERSALIFT-BUCKET', 'Sign Support Lift — Versalift Bucket Truck', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', 'Versalift', 'Bucket Truck', array['Signs', 'signals', 'lighting']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SIGN-SUPPORT-LIFT', 'Sign Support Lift', 'Access Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Signs', 'signals', 'lighting']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SIGNAL-TEST-SET-EBERLE-MMU2A-TEST', 'Signal Test Set — Eberle MMU2A Test Set', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Eberle', 'MMU2A Test Set', array['Signals', 'ITS']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SIGNAL-TEST-SET', 'Signal Test Set', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Signals', 'ITS']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SKID-STEER-LOADER-BOBCAT-S770', 'Skid Steer Loader — Bobcat S770', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', 'Bobcat', 'S770', array['General site support']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SMOOTH-DRUM-ROLLER-CATERPILLAR-CS5', 'Smooth Drum Roller — Caterpillar CS56B', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', 'CS56B', array['Subgrade', 'fill compaction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SMOOTH-DRUM-ROLLER', 'Smooth Drum Roller', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Subgrade', 'paving compaction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SOFT-WASH-PUMP-SYSTEM', 'Soft Wash Pump System', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Soft wash']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SOFT-WASH-SYSTEM-SOUTHEAST-SOFTWAS', 'Soft Wash System — Southeast Softwash Skid Pro 200', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', 'Southeast Softwash', 'Skid Pro 200', array['Soft wash']::text[], 'GrounUp resource catalog v1'),
  ('EQC-STANDING-SEAM-SEAMER-MALCO-TURBOSH', 'Standing Seam Seamer — Malco TurboShear Seamer', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Malco', 'TurboShear Seamer', array['Metal roofing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-STEAM-CLEANER-ALKOTA-3305X4', 'Steam Cleaner — Alkota 3305X4', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', 'Alkota', '3305X4', array['Method-specific washing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-STEAM-CLEANER', 'Steam Cleaner', 'Washing Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Method-specific washing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-STEEL-DRUM-ROLLER-CATERPILLAR-CB54', 'Steel Drum Roller — Caterpillar CB54B', 'Compaction Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', 'CB54B', array['Paving', 'resurfacing']::text[], 'GrounUp resource catalog v1'),
  ('EQC-STRIPING-MACHINE-GRACO-LINELAZER-V', 'Striping Machine — Graco LineLazer V 3900', 'Marking Equipment', 'either', 8, 0, 0, true, true, 'active', 'Graco', 'LineLazer V 3900', array['Striping', 'markings']::text[], 'GrounUp resource catalog v1'),
  ('EQC-STRIPING-MACHINE', 'Striping Machine', 'Marking Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Striping', 'markings']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SURFACE-CLEANER-WHISPER-WASH-CLASS', 'Surface Cleaner — Whisper Wash Classic 19', 'Attachments', 'owned', 8, 0, 0, false, false, 'active', 'Whisper Wash', 'Classic 19', array['Flat surface cleaning']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SURFACE-CLEANER', 'Surface Cleaner', 'Attachments', 'either', 8, 0, 0, false, false, 'active', null, null, array['Flat surface cleaning']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SWITCHGEAR-RIGGING-GEAR-GREENLEE-R', 'Switchgear Rigging Gear — Greenlee Rigging Set', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Greenlee', 'Rigging Set', array['Power generation']::text[], 'GrounUp resource catalog v1'),
  ('EQC-SWITCHGEAR-RIGGING-GEAR', 'Switchgear Rigging Gear', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Power generation']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TABLE-SAW-SAWSTOP-PCS31230', 'Table Saw — SawStop PCS31230', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'SawStop', 'PCS31230', array['Cutting wood products']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TELEHANDLER-JCB-510-56', 'Telehandler — JCB 510-56', 'Material Handling', 'either', 8, 0, 0, true, true, 'active', 'JCB', '510-56', array['Framing', 'roofing support']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TELEHANDLER-JLG-943', 'Telehandler — JLG 943', 'Material Handling', 'either', 8, 0, 0, true, true, 'active', 'JLG', '943', array['Special construction']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TELESCOPING-WAND-X-JET-M5-X-JET', 'Telescoping Wand — X-Jet M5 X-Jet', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'X-Jet', 'M5 X-Jet', array['High reach cleaning']::text[], 'GrounUp resource catalog v1'),
  ('EQC-THERMAL-DRONE-DJI-MAVIC-3-THERMAL', 'Thermal Drone — DJI Mavic 3 Thermal', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', 'DJI', 'Mavic 3 Thermal', array['Thermal inspection']::text[], 'GrounUp resource catalog v1'),
  ('EQC-THERMAL-DRONE', 'Thermal Drone', 'Drone Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Thermal inspection']::text[], 'GrounUp resource catalog v1'),
  ('EQC-THERMAL-IMAGER-FLUKE-TIS20', 'Thermal Imager — Fluke TiS20+', 'Technology', 'owned', 8, 0, 0, false, false, 'active', 'Fluke', 'TiS20+', array['Thermal scanning']::text[], 'GrounUp resource catalog v1'),
  ('EQC-THREADING-MACHINE-RIDGID-535A', 'Threading Machine — RIDGID 535A', 'Plumbing Tools', 'either', 8, 0, 0, true, true, 'active', 'RIDGID', '535A', array['Threaded pipe install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-THREADING-MACHINE', 'Threading Machine', 'Plumbing Tools', 'either', 8, 0, 0, true, true, 'active', null, null, array['Threaded pipe install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-THUMB-WERK-BRAU-HYDRAULIC-THUMB', 'Thumb — Werk-Brau Hydraulic Thumb', 'Attachments', 'either', 8, 0, 0, false, false, 'active', 'Werk-Brau', 'Hydraulic Thumb', array['General grab', 'place']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TILE-SAW-DEWALT-D24000', 'Tile Saw — DeWalt D24000', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'DeWalt', 'D24000', array['Tile install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TILE-SAW', 'Tile Saw', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Tile install']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TRACK-LOADER-CATERPILLAR-953', 'Track Loader — Caterpillar 953', 'Earthmoving Equipment', 'either', 8, 0, 0, true, true, 'active', 'Caterpillar', '953', array['Earthwork', 'grading']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TRACK-LOADER', 'Track Loader', 'Compact Equipment', 'either', 8, 0, 0, true, true, 'active', null, null, array['Earthwork', 'grading', 'material handling']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TRAFFIC-DRUMS-TRAFFIX-42IN-DRUM', 'Traffic Drums — TrafFix 42in Drum', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'TrafFix', '42in Drum', array['Closures', 'channelization']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TRAFFIC-DRUMS', 'Traffic Drums', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Closures', 'channelization']::text[], 'GrounUp resource catalog v1'),
  ('EQC-TRAFFIC-SIGNS', 'Traffic Signs', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Work zone control']::text[], 'GrounUp resource catalog v1'),
  ('EQC-UPS-APC-SYMMETRA-PX', 'UPS — APC Symmetra PX', 'Power Equipment', 'either', 8, 0, 0, true, true, 'active', 'APC', 'Symmetra PX', array['Critical power']::text[], 'GrounUp resource catalog v1'),
  ('EQC-VACUUM-PUMP-FIELDPIECE-VPX7', 'Vacuum Pump — Fieldpiece VPX7', 'Small Tools', 'owned', 8, 0, 0, false, false, 'active', 'Fieldpiece', 'VPX7', array['Refrigeration', 'startup']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WATER-FILLED-BARRIER-YODOCK-2001MB', 'Water Filled Barrier — Yodock 2001MB', 'Traffic Control Devices', 'either', 8, 0, 0, true, true, 'active', 'Yodock', '2001MB', array['Temporary barrier']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WATER-TANK-LEG-TANK-225-GALLON', 'Water Tank — Leg Tank 225 Gallon', 'Accessories', 'owned', 8, 0, 0, false, false, 'active', 'Leg Tank', '225 Gallon', array['Mobile washing support']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WELDER-MILLER-MILLERMATIC-252', 'Welder — Miller Millermatic 252', 'Metalworking Equipment', 'either', 8, 0, 0, true, true, 'active', 'Miller', 'Millermatic 252', array['Steel', 'metal fabrication']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WIRE-PULLER-SOUTHWIRE-MAXIS-XD1', 'Wire Puller — Southwire Maxis XD1', 'Electrical Tools', 'either', 8, 0, 0, true, true, 'active', 'Southwire', 'Maxis XD1', array['Cable pulls']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WIRE-PULLER', 'Wire Puller', 'Small Tools', 'either', 8, 0, 0, false, false, 'active', null, null, array['Cable pulls']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WORK-BOAT-ALUMACRAFT-JON-BOAT', 'Work Boat — Alumacraft Jon Boat', 'Marine Equipment', 'either', 8, 0, 0, true, true, 'active', 'Alumacraft', 'Jon Boat', array['Marine', 'shoreline work']::text[], 'GrounUp resource catalog v1'),
  ('EQC-WORKSTATION-PUGET-SYSTEMS-PROCESSI', 'Workstation — Puget Systems Processing Workstation', 'Technology', 'owned', 8, 0, 0, false, false, 'active', 'Puget Systems', 'Processing Workstation', array['Processing', 'deliverables']::text[], 'GrounUp resource catalog v1')
on conflict do nothing;

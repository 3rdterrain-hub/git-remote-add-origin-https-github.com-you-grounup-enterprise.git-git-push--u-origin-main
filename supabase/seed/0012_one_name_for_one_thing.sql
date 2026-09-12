-- =============================================================================
-- GrounUp Enterprise — one name for one thing
--
-- The catalog was assembled from more than one source and the category
-- vocabularies were never reconciled, so the same idea is filed under several
-- names at once. Counted against the company's own three source files, which
-- are the authority for what these things are called:
--
--   * **Materials** — 42 categories where the source file has 25. Eighty rows
--     sit under seventeen categories that are fragments or synonyms of ones
--     already there: `Paint & Finishes` beside `Paint & Coating`, `Masonry`
--     beside `Tile & Masonry`, `Steel & Structural` beside `Structural Steel`,
--     `Misc` and `Other` beside each other.
--   * **Services** — 31 categories where the source file has 5. Here it is not
--     a synonym problem but a loading bug: for all 860 rows outside the five,
--     `category` holds an exact copy of `industry`. Nothing is lost by
--     correcting it — the detail is already in the column it belongs in, and
--     `subcategory` (109 of them) carries the finer split.
--   * **Equipment** — 71 classes, of which about eighteen are real and
--     populated and the rest are strays of one to three rows duplicating them:
--     `Access` beside `Access Equipment`, `Power` beside `Power Equipment`,
--     `Truck` and `Utility Vehicles` beside `Hauling Vehicles`.
--
-- Equipment is treated differently from the other two on purpose. The source
-- file's five equipment groups are coarser than the catalog's classes, and a
-- person hunting for a machine is served better by `Excavator` than by
-- `Site / Civil / Transportation`. So the strays are merged into the populated
-- classes rather than everything being flattened to five — "no duplicates" is
-- not the same instruction as "fewer categories".
--
-- Nothing is invented. Every row keeps its name, its unit and its cost; only
-- the label it is filed under changes, and each is mapped by what the item
-- plainly is.
--
-- **This is a seed file rather than an ordinary migration, and that is what
-- makes it work.** The catalog ships as migrations 0900 upward, so anything
-- numbered in the hand-written range sorts *before* the data it corrects and
-- updates nothing — which is exactly what the first attempt did. As a seed it
-- is generated into `0909_catalog_0012_*`, after the catalog it repairs, and
-- the harness replays it in the same order.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Services: the category column stops being a copy of the industry column
-- -----------------------------------------------------------------------------
update services set category = 'Site, Civil & Transportation'
 where company_id is null and category in (
   'Heavy Civil Extended', 'Landscaping and Irrigation', 'Landscaping and Site Finishes',
   'Earthwork', 'Utilities', 'Demolition', 'Highway and DOT', 'Asphalt',
   'Pool Construction and Demolition', 'Mining', 'Agriculture', 'Municipal Public Works',
   -- Both of these are excavation and site preparation throughout: basement,
   -- footing, pad, trench. They are market segments rather than trades, and the
   -- segment is already recorded in `industry`.
   'Commercial Construction', 'Residential Construction');

update services set category = 'Building Shell & Structure'
 where company_id is null and category in (
   'Concrete', 'Roofing and Waterproofing', 'Masonry and Structural Steel',
   'Rough Carpentry', 'Doors, Windows and Glazing', 'Thermal and Moisture Protection');

update services set category = 'MEP & Systems'
 where company_id is null and category in ('Electrical', 'Plumbing', 'Mechanical');

update services set category = 'Interiors & Specialty'
 where company_id is null and category in ('Finishes', 'Drywall and Plaster');

-- Drone photogrammetry, LiDAR, stockpile flights and progress photography:
-- measurement of the work rather than the work itself.
update services set category = 'Project Controls'
 where company_id is null and category = 'Survey and Aerial Services';

-- -----------------------------------------------------------------------------
-- Materials: eighty rows, each filed by what it is
--
-- Mapped by code rather than by category, because a category name is not always
-- a safe proxy for its contents: `Pipe & Utilities` holds a cable tray as well
-- as ductile pipe, and `Other` holds fiberglass batt beside a safety fence.
-- -----------------------------------------------------------------------------
update materials set category = 'Disposal & Export' where company_id is null and code in (
  'MAT-0062','MAT-0063','MAT-0064','MAT-0065','MAT-0066','MAT-0068','MAT-0069',
  'MAT-0291','MAT-0294','MAT-0296');

update materials set category = 'Erosion Control' where company_id is null and code in (
  'MAT-0067','MAT-0286','MAT-0287','MAT-0288','MAT-0289');

update materials set category = 'Drywall & Plaster' where company_id is null and code in (
  'MAT-0083','MAT-0084','MAT-0085','MAT-0087','MAT-0088','MAT-0224');

update materials set category = 'Insulation' where company_id is null and code in (
  'MAT-0176','MAT-0177','MAT-0178','MAT-0179','MAT-0180','MAT-0221','MAT-0222');

update materials set category = 'Tile & Masonry' where company_id is null and code in (
  'MAT-0213','MAT-0214','MAT-0215','MAT-0216','MAT-0217','MAT-0218','MAT-0219');

update materials set category = 'Electrical' where company_id is null and code in (
  'MAT-0146','MAT-0147','MAT-0165','MAT-0168','MAT-0239');

update materials set category = 'Paint & Coating' where company_id is null and code in (
  'MAT-0232','MAT-0233','MAT-0234','MAT-0235');

update materials set category = 'Asphalt & Paving' where company_id is null and code in (
  'MAT-0236','MAT-0237','MAT-0238');

-- Wet utilities: pipe, structures and the drain line that goes with them.
update materials set category = 'Plumbing' where company_id is null and code in (
  'MAT-0223','MAT-0240','MAT-0241','MAT-0242','MAT-0243','MAT-0244','MAT-0245','MAT-0276');

update materials set category = 'Safety & Temporary' where company_id is null and code in (
  'MAT-0086','MAT-0225','MAT-0277');

update materials set category = 'Landscaping' where company_id is null and code in (
  'MAT-0290','MAT-0292','MAT-0295');

update materials set category = 'Aggregate & Stone' where company_id is null and code in (
  'MAT-0293');

update materials set category = 'Structural Steel' where company_id is null and code in (
  'MAT-0305','MAT-0306','MAT-0307');

update materials set category = 'Cabinets & Countertops' where company_id is null and code in (
  'MAT-0020','MAT-0021');

-- Consumables, process equipment allowances and interior specialties: the
-- source file's own catch-all, used as a catch-all and nothing more.
update materials set category = 'Specialty' where company_id is null and code in (
  'MAT-0019','MAT-0022','MAT-0164','MAT-0166','MAT-0167','MAT-0169','MAT-0220',
  'MAT-0278','MAT-0297','MAT-0298','MAT-0299','MAT-0300','MAT-0301');

-- -----------------------------------------------------------------------------
-- Equipment: strays merged into the classes that are actually populated
--
-- Every target below is a class the catalog already uses. `equipment_class` is
-- held to the governed list by a trigger, so inventing a tidier name here would
-- be refused — and rightly: a new name to solve a duplicate-name problem is one
-- more name for the same thing.
-- -----------------------------------------------------------------------------
update equipment set equipment_class = 'Earthmoving Equipment'
 where company_id is null and equipment_class in (
   'Excavator','Dozer','Loader','Grader','Skid Steer','Track Loader','Compact Equipment',
   'Crane','Processing','Milling');

update equipment set equipment_class = 'Hauling Vehicles'
 where company_id is null and equipment_class in (
   'Truck','Utility Vehicles','On-Road Hauling','Hauling Equipment');

update equipment set equipment_class = 'Compaction Equipment'
 where company_id is null and equipment_class = 'Compactor';

update equipment set equipment_class = 'Access Equipment'
 where company_id is null and equipment_class in ('Access','Aerial Lift');

-- Generation, compressed air and the metal trades that run off them.
update equipment set equipment_class = 'Power Equipment'
 where company_id is null and equipment_class in (
   'Power','Air','Welding','Fabrication Equipment','Metalworking Equipment',
   'Electrical','Electrical Tools');

update equipment set equipment_class = 'Material Handling Equipment'
 where company_id is null and equipment_class = 'Material Handling';

update equipment set equipment_class = 'Concrete Equipment'
 where company_id is null and equipment_class in ('Concrete','Masonry Equipment');

update equipment set equipment_class = 'Finishes Equipment'
 where company_id is null and equipment_class in (
   'Finishes','Painting Equipment','Drywall Equipment','Siding Equipment','Roofing');

update equipment set equipment_class = 'HVAC Equipment'
 where company_id is null and equipment_class = 'HVAC';

update equipment set equipment_class = 'Paving Equipment'
 where company_id is null and equipment_class = 'Paving';

update equipment set equipment_class = 'Traffic Control Equipment'
 where company_id is null and equipment_class in (
   'Traffic Control','Traffic Control Devices','Barrier Equipment','Marking Equipment');

update equipment set equipment_class = 'Technology'
 where company_id is null and equipment_class = 'Diagnostics';

-- The site services a job runs on: temporary power and water, washing, waste,
-- pollution control, and the attachments and accessories that go with them.
update equipment set equipment_class = 'Utility Equipment'
 where company_id is null and equipment_class in (
   'Temporary Services','Accessories','Attachments','Water Equipment',
   'Plumbing','Plumbing Tools','Pollution Control','Pollution Equipment',
   'Waste','Washing Equipment','Pressure Washing','Safety Equipment');

-- -----------------------------------------------------------------------------
-- And the dropdowns are rebuilt from what is actually in use
--
-- A category offered but carried by nothing is a filter that returns an empty
-- list; one carried but not offered cannot be chosen for the next row. Both are
-- the same defect, so the list is derived rather than maintained beside the
-- data.
-- -----------------------------------------------------------------------------
delete from library_categories c
 where c.company_id is null
   and c.kind = 'material_category'
   and not exists (select 1 from materials m
                    where m.company_id is null and m.category = c.name);

delete from library_categories c
 where c.company_id is null
   and c.kind = 'service_category'
   and not exists (select 1 from services s
                    where s.company_id is null and s.category = c.name);

delete from library_categories c
 where c.company_id is null
   and c.kind = 'equipment_class'
   and not exists (select 1 from equipment e
                    where e.company_id is null and e.equipment_class = c.name);

insert into library_categories (company_id, kind, name, sort_order)
select null, 'equipment_class', e.equipment_class, 100
  from (select distinct equipment_class from equipment where company_id is null
         and equipment_class is not null) e
 where not exists (select 1 from library_categories c
                    where c.company_id is null and c.kind = 'equipment_class'
                      and c.name = e.equipment_class)
on conflict do nothing;

select app.assert_security_gates();

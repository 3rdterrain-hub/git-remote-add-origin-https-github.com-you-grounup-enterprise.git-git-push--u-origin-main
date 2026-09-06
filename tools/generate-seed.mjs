/**
 * Generates the GrounUp global seed library as SQL from the governed v2.0
 * catalog CSVs.
 *
 * The seed is written as global-scope rows (company_id and enterprise_group_id
 * both NULL), which every tenant can read and none can edit. A company that
 * wants its own numbers copies a row into its own scope and edits the copy —
 * so the shipped benchmark stays intact and comparable across tenants.
 *
 * Run: npm run seed:generate
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'supabase', 'seed');

const CATALOG = process.env.GROUNUP_CATALOG_DIR
  ?? '/Users/tradertree/Downloads/GrounUp Enterprise v2.0 Package (ZIP)-2/06-Catalog-and-Architecture-Data/catalog-v2.0';

// ---------------------------------------------------------------------------
// Minimal RFC-4180 CSV reader (quoted fields, embedded commas and newlines)
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const read = async (name) => parseCsv(await readFile(join(CATALOG, name), 'utf8'));

// ---------------------------------------------------------------------------
// SQL literal helpers
// ---------------------------------------------------------------------------
const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v, fallback = 'null') => {
  if (v === null || v === undefined || v === '') return fallback;
  const num = Number(v);
  if (!Number.isFinite(num)) return fallback;
  return String(num);
};
const bool = (v) => (String(v).toLowerCase() === 'true' ? 'true' : 'false');
const arr = (values) => (values.length === 0 ? "'{}'" : `array[${values.map(q).join(',')}]`);

const VALID_UNITS = new Set(['LS','EA','LF','SF','SY','CY','TON','HR','DAY','ACRE','GAL','LB','MO','WK']);
const unit = (v, fallback = 'LS') => (VALID_UNITS.has(String(v).trim().toUpperCase()) ? String(v).trim().toUpperCase() : fallback);

const banner = (title) => `\n-- ${'-'.repeat(75)}\n-- ${title}\n-- ${'-'.repeat(75)}\n`;

/**
 * The per-service unit corrections, read from migration 0089.
 *
 * Parsed rather than duplicated. If the migration is ever revised the seed
 * follows it, and if the migration cannot be found or its shape has changed
 * this throws instead of quietly emitting a library where every unit is a
 * lump sum — which is the state 0089 exists to fix.
 */
async function readServiceUnitCorrections() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const file = (await readdir(dir)).find((f) => /^0089_.*\.sql$/.test(f));
  if (!file) throw new Error('Migration 0089 (service units) not found; cannot emit a correct seed.');
  const sql = await readFile(join(dir, file), 'utf8');
  const map = new Map();
  const row = /\('(SVC-\d+)',\s*'([A-Z]+)',\s*array\[([^\]]*)\]/g;
  let m;
  while ((m = row.exec(sql)) !== null) {
    map.set(m[1], {
      unit: unit(m[2]),
      supported: m[3].split(',').map((u) => unit(u.replace(/['\s]/g, ''))),
    });
  }
  if (map.size === 0) {
    throw new Error(
      `${file} carries no service unit rows in the shape this generator reads. `
      + 'The seed would fall back to the catalog, where every service is a lump sum.');
  }
  return map;
}

/**
 * The trade packs, from the repository rather than the external catalog.
 *
 * The shipped catalog is heavy civil and nothing else, so a contractor outside
 * those trades opens the library and finds nothing for their work. These are
 * the rest: written here, reviewed here, versioned with the code that reads
 * them.
 *
 * Every service they produce is structurally complete — a unit its trade bids
 * in, an assembly, the tasks it is made of, and a production rate so it prices
 * rather than returning zero. Every rate they produce is an unsourced
 * benchmark, and says so three times over: `seed_benchmark` as the source type,
 * which the engine warns about by name; `pending` approval, so the engine says
 * to approve it or substitute a company actual before issuing; and a confidence
 * score below what the sourced heavy-civil rates carry.
 */
async function readTradePacks() {
  const dir = join(ROOT, 'catalog', 'trades');
  let names;
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const packs = [];
  for (const name of names) {
    const pack = JSON.parse(await readFile(join(dir, name), 'utf8'));
    if (!pack.code || !Array.isArray(pack.categories)) {
      throw new Error(`${name} is not a trade pack: it needs a code and categories.`);
    }
    if (!Array.isArray(pack.tasks) || pack.tasks.length === 0) {
      throw new Error(`${name} has no tasks, so its services would price as nothing.`);
    }
    if (!pack.tasks.includes(pack.productionTask)) {
      throw new Error(
        `${name} names "${pack.productionTask}" as the task the rate hangs off, and it is not `
        + 'in the task list. The rate would attach to nothing and every service would price at zero.');
    }
    packs.push({ ...pack, source: name });
  }
  return packs;
}

/** Flatten a pack into the rows the seed needs, with codes that cannot collide. */
function expandTradePack(pack) {
  const services = [];
  const tasks = [];
  const assemblies = [];
  const components = [];
  const rates = [];
  const costCodes = [];

  let n = 0;
  for (const category of pack.categories) {
    for (const svc of category.services) {
      n += 1;
      const seq = String(n).padStart(4, '0');
      /*
       * Prefixed by trade rather than continuing the catalog's numbering, so
       * where a row came from is legible in the data and a future catalog
       * update cannot collide with one of ours.
       */
      const serviceCode = `SVC-${pack.code}-${seq}`;
      const assemblyCode = `ASM-${pack.code}-${seq}`;
      const costCode = `CC-${pack.code}-${seq}`;
      const supported = (svc.units && svc.units.length ? svc.units : [svc.unit])
        .map((u) => unit(u))
        .filter((v, i, a) => a.indexOf(v) === i);
      const def = unit(svc.unit);
      if (!supported.includes(def)) supported.unshift(def);

      services.push({
        code: serviceCode, name: svc.name, industry: pack.trade,
        industryPack: `IND-${pack.code}`, category: pack.trade,
        subcategory: category.name,
        description: svc.description
          ?? `Provide complete ${svc.name.toLowerCase()} including labor, equipment, `
             + 'materials, controls, documentation and closeout as applicable.',
        unit: def, supported, costCode,
      });
      costCodes.push({ code: costCode, name: svc.name, division: pack.trade });
      assemblies.push({
        code: assemblyCode, name: `${svc.name} — Standard Assembly`,
        serviceCode, unit: def,
      });

      pack.tasks.forEach((taskName, i) => {
        const taskCode = `TSK-${pack.code}-${seq}-${String(i + 1).padStart(2, '0')}`;
        const isProduction = taskName === pack.productionTask;
        tasks.push({
          code: taskCode, name: taskName,
          category: isProduction ? 'Production' : 'Support',
          unit: isProduction ? def : 'HR',
          method: `MTH-${pack.code}-${seq}-${String(i + 1).padStart(2, '0')}`,
        });
        components.push({ assemblyCode, taskCode, sort: (i + 1) * 10, unit: isProduction ? def : 'HR' });
        if (isProduction) {
          rates.push({
            code: `PR-${pack.code}-${seq}`, taskCode,
            method: `MTH-${pack.code}-${seq}-${String(i + 1).padStart(2, '0')}`,
            rate: svc.rate, unit: def,
          });
        }
      });
    }
  }
  return { services, tasks, assemblies, components, rates, costCodes };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const [services, tasks, labor, equipment, productionRates, assemblies, modifiers, profiles] =
    await Promise.all([
      read('service_catalog.csv'),
      read('task_library.csv'),
      read('01_labor_library.csv'),
      read('02_equipment_library.csv'),
      read('02_production_rate_library.csv'),
      read('01_assembly_library.csv'),
      read('03_condition_modifier_library.csv'),
      read('04_pricing_and_markup_profiles.csv'),
    ]);

  const out = [];
  out.push(`-- =============================================================================
-- GrounUp Enterprise — global seed library (generated)
--
-- Generated by tools/generate-seed.mjs from the governed GrounUp v2.0 catalog.
-- DO NOT EDIT BY HAND: rerun \`npm run seed:generate\` instead.
--
-- Every row is global scope (company_id IS NULL AND enterprise_group_id IS NULL):
-- readable by every tenant, writable by none. A company that needs different
-- numbers copies a row into its own scope, which keeps the shipped benchmark
-- intact and keeps cross-tenant comparison meaningful.
--
-- Source counts: ${services.length} services, ${tasks.length} tasks, ${labor.length} labor classes,
-- ${equipment.length} equipment items, ${productionRates.length} production rates,
-- ${assemblies.length} assemblies, ${modifiers.length} condition modifiers, ${profiles.length} pricing profiles.
-- =============================================================================

set local check_function_bodies = off;
`);

  /*
   * Migration 0113 makes a library category a record and refuses one that is
   * not in the list, so the catalog's own categories have to be filed before
   * the rows that use them. The slot is filled at the end from the values this
   * file actually emits — derived rather than listed, so a trade pack naming a
   * new category brings it along and cannot be forgotten.
   */
  const CATEGORY_SLOT = out.length;
  out.push('');

  // --- Labor ---------------------------------------------------------------
  out.push(banner('Labor classifications'));
  out.push('insert into labor_rates (code, classification, labor_group, base_wage_per_hour, burden_percent, overtime_multiplier, doubletime_multiplier, region, effective_date, status) values');
  out.push(labor.map((r) =>
    `  (${q(r.labor_class_id)}, ${q(r.classification)}, ${q(r.group)}, ${n(r.base_wage_per_hour, '0')}, ${n(r.burden_percent, '0')}, ${n(r.overtime_multiplier, '1.5')}, ${n(r.doubletime_multiplier, '2')}, ${q(r.region)}, ${q(r.effective_date || '2026-01-01')}, 'active')`,
  ).join(',\n') + '\non conflict do nothing;\n');

  // --- Equipment -----------------------------------------------------------
  out.push(banner('Equipment'));
  out.push('insert into equipment (code, name, equipment_class, ownership_type, planned_hours_per_day, fuel_gallons_per_hour, def_percent_of_fuel, operator_required, mobilization_required, status) values');
  out.push(equipment.map((r) =>
    `  (${q(r.equipment_id)}, ${q(r.equipment_name)}, ${q(r.equipment_class)}, 'either', ${n(r.planned_hours_per_day, '8')}, ${n(r.fuel_gallons_per_hour, '0')}, ${n(r.def_percent_of_fuel, '0')}, ${bool(r.operator_required)}, ${bool(r.mobilization_required)}, 'active')`,
  ).join(',\n') + '\non conflict do nothing;\n');

  // Equipment rate sheets. The shipped numbers are explicitly seed assumptions,
  // so they enter at the lowest precedence tier and the engine warns on use.
  out.push(banner('Equipment rate sheets (global_seed precedence — RULE-003)'));
  out.push(`insert into equipment_rates (company_id, equipment_id, source, hourly_rate, daily_rate, weekly_rate, monthly_rate, reference, effective_date)
select null, e.id, 'global_seed', v.hourly, v.daily, v.weekly, v.monthly,
       'GrounUp v2.0 seed assumption — replace with a vendor or company rate before issuing',
       date '2026-01-01'
from (values
${equipment.map((r) => `  (${q(r.equipment_id)}, ${n(r.hourly_rate, '0')}::numeric, ${n(r.daily_rate)}::numeric, ${n(r.weekly_rate)}::numeric, ${n(r.monthly_rate)}::numeric)`).join(',\n')}
) as v(code, hourly, daily, weekly, monthly)
join equipment e on e.code = v.code and e.company_id is null and e.enterprise_group_id is null
-- RULE from migration 0056: one platform rate per machine, per source, per date.
on conflict (equipment_id, source, effective_date) where company_id is null do nothing;
`);

  // --- Services ------------------------------------------------------------
  out.push(banner('Service catalog'));
  /*
   * The units a service is actually bid in.
   *
   * The shipped catalog says 'LS' for all 188 — common excavation a lump sum,
   * storm sewer a lump sum, asphalt surface course a lump sum. Migration 0089
   * corrected every one of them, and the correction has to be applied here as
   * well as there: migrations run before the seed on a fresh database, so 0089
   * updates rows that do not exist yet and the catalog's 'LS' would win.
   *
   * The mapping is read out of the migration rather than copied, so there is
   * one place a unit is decided and the seed cannot drift from the schema. It
   * is also how the equipment rate conflict clause and these same units were
   * lost before: a hand correction to the generated file that the generator
   * never learned, silently reverted by the next regeneration.
   */
  /** Rows per insert statement. Large enough to be few, small enough to read. */
  const CHUNK = 500;

  const correctedUnits = await readServiceUnitCorrections();
  /*
   * The trades the shipped catalog does not cover. Expanded here so every
   * emitter below writes the catalog's rows and the packs' rows together, and
   * a service is a service whichever it came from.
   */
  const packs = await readTradePacks();
  const trade = packs.map(expandTradePack);
  const tradeServices = trade.flatMap((t) => t.services);
  const tradeTasks = trade.flatMap((t) => t.tasks);
  const tradeAssemblies = trade.flatMap((t) => t.assemblies);
  const tradeComponents = trade.flatMap((t) => t.components);
  const tradeRates = trade.flatMap((t) => t.rates);
  const tradeCostCodes = trade.flatMap((t) => t.costCodes);
  const serviceValues = services.map((r) => {
    const fix = correctedUnits.get(r.service_id);
    const supported = fix
      ? [...fix.supported]
      : (r.supported_units || 'LS').split(';').map((u) => unit(u)).filter((v, i, a) => a.indexOf(v) === i);
    const def = fix ? fix.unit : unit(r.default_estimate_unit);
    if (!supported.includes(def)) supported.unshift(def);
    return `  (${q(r.service_id)}, ${q(r.service_name)}, ${q(r.industry)}, ${q(r.industry_pack_id)}, ${q(r.category)}, ${q(r.subcategory)}, ${q(r.description)}, '${def}', array[${supported.map((u) => `'${u}'`).join(',')}]::app.unit_code[], ${q(r.pricing_method)}, ${q(r.version || '2.0')}, ${q(r.source)})`;
  });
  out.push('insert into services (code, name, industry, industry_pack_id, category, subcategory, description, default_unit, supported_units, pricing_method, version, source) values');
  out.push(serviceValues.join(',\n') + '\non conflict do nothing;\n');

  if (tradeServices.length > 0) {
    out.push(banner('Trade packs — the work the shipped catalog does not cover'));
    for (let i = 0; i < tradeServices.length; i += CHUNK) {
      out.push('insert into services (code, name, industry, industry_pack_id, category, subcategory, description, default_unit, supported_units, pricing_method, version, source) values');
      out.push(tradeServices.slice(i, i + CHUNK).map((r) =>
        `  (${q(r.code)}, ${q(r.name)}, ${q(r.industry)}, ${q(r.industryPack)}, `
        + `${q(r.category)}, ${q(r.subcategory)}, ${q(r.description)}, '${r.unit}', `
        + `array[${r.supported.map((u) => `'${u}'`).join(',')}]::app.unit_code[], `
        + `'Assembly/Task Rollup', '1.0', 'GrounUp trade pack')`).join(',\n')
        + '\non conflict do nothing;\n');
    }
  }

  // --- Cost codes ----------------------------------------------------------
  // The catalog gives every service a cost code and the generator used to drop
  // it, which left `services.cost_code_id` null on all 188 rows and the cost
  // code library empty. A line that cannot name its cost code cannot be rolled
  // up against a budget, which is the whole point of having one.
  out.push(banner('Cost code library'));
  out.push(`insert into cost_codes (code, name, division, status)
values
${[...services.map((r) => `  (${q(r.cost_code_id)}, ${q(r.service_name)}, ${q(r.category)}, 'active')`),
   ...tradeCostCodes.map((c) => `  (${q(c.code)}, ${q(c.name)}, ${q(c.division)}, 'active')`)].join(',\n')}
on conflict do nothing;

update services s
set cost_code_id = c.id
from (values
${[...services.map((r) => `  (${q(r.service_id)}, ${q(r.cost_code_id)})`),
   ...tradeCostCodes.map((c, i) => `  (${q(tradeServices[i].code)}, ${q(c.code)})`)].join(',\n')}
) as m(service_code, cost_code)
join cost_codes c on c.code = m.cost_code
  and c.company_id is null and c.enterprise_group_id is null
where s.code = m.service_code
  and s.company_id is null and s.enterprise_group_id is null;
`);

  // --- Tasks ---------------------------------------------------------------
  out.push(banner('Task library'));
  for (let i = 0; i < tasks.length; i += CHUNK) {
    const chunk = tasks.slice(i, i + CHUNK);
    out.push('insert into tasks (code, name, category, default_unit, default_method_code, production_required, crew_required, equipment_required, material_required, safety_review_required, quality_review_required, version) values');
    out.push(chunk.map((r) =>
      `  (${q(r.task_id)}, ${q(r.task_name)}, ${q(r.task_category)}, '${unit(r.default_unit)}', ${q(r.default_method_id)}, ${bool(r.production_required)}, ${bool(r.crew_required)}, ${bool(r.equipment_required)}, ${bool(r.material_required)}, ${bool(r.safety_review_required)}, ${bool(r.quality_review_required)}, ${q(r.version || '2.0')})`,
    ).join(',\n') + '\non conflict do nothing;\n');
  }

  for (let i = 0; i < tradeTasks.length; i += CHUNK) {
    out.push('insert into tasks (code, name, category, default_unit, default_method_code, production_required, crew_required, equipment_required, material_required, safety_review_required, quality_review_required, version) values');
    out.push(tradeTasks.slice(i, i + CHUNK).map((t) =>
      `  (${q(t.code)}, ${q(t.name)}, ${q(t.category)}, '${unit(t.unit)}', ${q(t.method)}, `
      + `${t.category === 'Production' ? 'true' : 'false'}, true, true, false, true, false, '1.0')`)
      .join(',\n') + '\non conflict do nothing;\n');
  }

  // --- Assemblies ----------------------------------------------------------
  out.push(banner('Assembly library'));
  out.push(`insert into assemblies (code, name, service_id, assembly_type, quantity_unit, description, supports_nested, supports_options, version, status)
select v.code, v.name, s.id, v.atype, v.qunit::app.unit_code, v.descr, v.nested, v.options, v.version, 'active'
from (values
${assemblies.map((r) => `  (${q(r.assembly_id)}, ${q(r.assembly_name)}, ${q(r.service_id)}, ${q(r.assembly_type)}, ${q(unit(r.quantity_unit))}, ${q(r.description)}, ${bool(r.supports_nested_components)}, ${bool(r.supports_options)}, ${q(r.version || '2.0')})`).join(',\n')}
) as v(code, name, service_code, atype, qunit, descr, nested, options, version)
left join services s on s.code = v.service_code and s.company_id is null and s.enterprise_group_id is null
on conflict do nothing;

-- Point each service at its default assembly now that both exist.
update services s
set default_assembly_id = a.id
from assemblies a
where a.service_id = s.id
  and s.company_id is null and s.enterprise_group_id is null
  and a.company_id is null and a.enterprise_group_id is null
  and s.default_assembly_id is null;
`);

  if (tradeAssemblies.length > 0) {
    for (let i = 0; i < tradeAssemblies.length; i += CHUNK) {
      out.push(`insert into assemblies (code, name, service_id, assembly_type, quantity_unit, description, supports_nested, supports_options, version, status)
select v.code, v.name, s.id, 'Standard', v.qunit::app.unit_code,
       'Reusable task and resource rollup.', true, true, '1.0', 'active'
from (values
${tradeAssemblies.slice(i, i + CHUNK).map((a) =>
  `  (${q(a.code)}, ${q(a.name)}, ${q(a.serviceCode)}, '${a.unit}')`).join(',\n')}
) as v(code, name, service_code, qunit)
left join services s on s.code = v.service_code and s.company_id is null
  and s.enterprise_group_id is null
on conflict do nothing;
`);
    }
    out.push(`update services s
set default_assembly_id = a.id
from assemblies a
where a.service_id = s.id
  and s.company_id is null and s.enterprise_group_id is null
  and a.company_id is null and a.enterprise_group_id is null
  and s.default_assembly_id is null;
`);
  }

  // --- Assembly components -------------------------------------------------
  /*
   * The connection that was missing.
   *
   * 188 services each pointed at an assembly, 2,783 tasks carried the method
   * and unit for the work, and 1,452 production rates hung off those tasks —
   * but no row joined a service to its tasks, so `assembly_components` was
   * empty and not one service in the shipped library could be priced. The
   * catalog has no explicit mapping file, so the ordering is the mapping: the
   * task library is written as one contiguous block per service, in service
   * order, each block closed by a 'Demobilize' task. That reads as an accident
   * of formatting until you count — there are exactly 188 'Demobilize' rows for
   * exactly 188 services, with nothing left over, and the blocks say what the
   * services say: 'Parking lot paving' gets place aggregate base and fine grade
   * base, 'Inground pool demolition' gets locate/protect utilities and excavate
   * or demolish.
   *
   * Both halves of that are asserted below rather than assumed, because a
   * mapping this important being silently off by one would misprice every job
   * after the mistake.
   */
  const taskBlocks = [];
  {
    let current = [];
    for (const t of tasks) {
      current.push(t);
      if (t.task_name === 'Demobilize') { taskBlocks.push(current); current = []; }
    }
    if (current.length > 0) {
      throw new Error(
        `Task library ends with ${current.length} task(s) after the last 'Demobilize' `
        + `(${current[0].task_id}..). The per-service blocking no longer holds; the `
        + 'service-to-task mapping must be re-derived before this seed can be trusted.');
    }
    if (taskBlocks.length !== services.length) {
      throw new Error(
        `Found ${taskBlocks.length} task blocks for ${services.length} services. `
        + 'Each service needs exactly one block of tasks for its assembly to be priceable.');
    }
  }

  out.push(banner('Assembly components — what each service is actually made of'));
  const componentRows = [];
  services.forEach((svc, i) => {
    const assembly = assemblies.find((a) => a.service_id === svc.service_id);
    if (!assembly) throw new Error(`Service ${svc.service_id} has no assembly.`);
    taskBlocks[i].forEach((t, j) => {
      componentRows.push(
        `  (${q(assembly.assembly_id)}, ${(j + 1) * 10}, ${q(t.task_id)}, '${unit(t.default_unit)}')`);
    });
  });
  for (let i = 0; i < componentRows.length; i += CHUNK) {
    out.push(`insert into assembly_components (assembly_id, sort_order, component_kind, task_id, quantity_per_unit, unit)
select a.id, v.sort, 'task', t.id, 1, v.unit::app.unit_code
from (values
${componentRows.slice(i, i + CHUNK).join(',\n')}
) as v(assembly_code, sort, task_code, unit)
join assemblies a on a.code = v.assembly_code
  and a.company_id is null and a.enterprise_group_id is null
join tasks t on t.code = v.task_code
  and t.company_id is null and t.enterprise_group_id is null
on conflict do nothing;
`);
  }

  for (let i = 0; i < tradeComponents.length; i += CHUNK) {
    out.push(`insert into assembly_components (assembly_id, sort_order, component_kind, task_id, quantity_per_unit, unit)
select a.id, v.sort, 'task', t.id, 1, v.unit::app.unit_code
from (values
${tradeComponents.slice(i, i + CHUNK).map((c) =>
  `  (${q(c.assemblyCode)}, ${c.sort}, ${q(c.taskCode)}, '${unit(c.unit)}')`).join(',\n')}
) as v(assembly_code, sort, task_code, unit)
join assemblies a on a.code = v.assembly_code
  and a.company_id is null and a.enterprise_group_id is null
join tasks t on t.code = v.task_code
  and t.company_id is null and t.enterprise_group_id is null
on conflict do nothing;
`);
  }

  // --- Production rates ----------------------------------------------------
  out.push(banner('Production rate library'));
  out.push(`-- rate_unit in the source catalog is written "CY/HR"; the numerator is the
-- quantity unit and the denominator is always the hour, so only the numerator
-- is stored. Every seed rate enters as source_type 'seed_benchmark' with its
-- catalog confidence, which is what makes the engine warn that it is a
-- starting point rather than a company production standard (RULE-010).
`);
  for (let i = 0; i < productionRates.length; i += CHUNK) {
    const chunk = productionRates.slice(i, i + CHUNK);
    out.push(`insert into production_rates (code, task_id, method_code, rate_per_hour, rate_unit, utilization_factor, shift_hours, equipment_spread, controlling_resource, material_condition, access_condition, weather_condition, region, source_type, confidence_score, sample_size, approval_state, status, effective_date)
select v.code, t.id, v.method, v.rate, v.runit::app.unit_code, v.util, v.shift, v.spread, v.controlling,
       v.material, v.access, v.weather, v.region, 'seed_benchmark', v.confidence, 0, 'not_required', 'active', v.eff::date
from (values
${chunk.map((r) => {
      const ru = unit(String(r.rate_unit || 'HR').split('/')[0], 'HR');
      return `  (${q(r.production_rate_id)}, ${q(r.task_id)}, ${q(r.method_id)}, ${n(r.rate_value, '1')}::numeric, ${q(ru)}, ${n(r.utilization_factor, '0.83')}::numeric, ${n(r.shift_hours, '8')}::numeric, ${q(r.equipment_spread)}, ${q(r.controlling_resource)}, ${q(r.material_condition)}, ${q(r.access_condition)}, ${q(r.weather_condition)}, ${q(r.region)}, ${n(r.confidence_score, '0.45')}::numeric, ${q(r.effective_date || '2026-01-01')})`;
    }).join(',\n')}
) as v(code, task_code, method, rate, runit, util, shift, spread, controlling, material, access, weather, region, confidence, eff)
left join tasks t on t.code = v.task_code and t.company_id is null and t.enterprise_group_id is null
on conflict do nothing;
`);
  }

  /*
   * The packs' rates, marked three times over as unsourced.
   *
   * `seed_benchmark` is warned about by name by the engine; `pending` makes it
   * a draft catalog rate, which the engine says to approve or replace with a
   * company actual before issuing; and a confidence of 0.30 sits below the
   * 0.45 the sourced heavy-civil rates carry, so an estimate built on these
   * scores for what it is. A rate nobody can source is the same defect as a
   * typed price — the difference is whether the platform says which it is.
   */
  if (tradeRates.length > 0) {
    for (let i = 0; i < tradeRates.length; i += CHUNK) {
      out.push(`insert into production_rates (code, task_id, method_code, rate_per_hour, rate_unit, utilization_factor, shift_hours, equipment_spread, controlling_resource, region, source_type, confidence_score, sample_size, approval_state, status, effective_date)
select v.code, t.id, v.method, v.rate::numeric, v.runit::app.unit_code, 0.83, 8,
       'Trade-dependent spread', 'Primary crew', 'Unsourced benchmark',
       'seed_benchmark', 0.30, 0, 'pending', 'active', date '2026-01-01'
from (values
${tradeRates.slice(i, i + CHUNK).map((r) =>
  `  (${q(r.code)}, ${q(r.taskCode)}, ${q(r.method)}, ${n(r.rate, '1')}, ${q(unit(r.unit))})`)
  .join(',\n')}
) as v(code, task_code, method, rate, runit)
join tasks t on t.code = v.task_code
  and t.company_id is null and t.enterprise_group_id is null
on conflict do nothing;
`);
    }
  }

  // --- Condition modifiers -------------------------------------------------
  out.push(banner('Condition modifiers'));
  out.push(`-- The source catalog records one factor plus a slash-separated target list
-- ("0.88 / Labor+Production"), which is ambiguous about whether labor gets
-- 12% slower or 12% cheaper. Each modifier is therefore expanded here into an
-- explicit factor per target so it can only mean what it is written to mean.
-- Production entries carry the catalog factor as a rate multiplier; the five
-- Section 7.1 cost modifiers carry their surcharge as a cost multiplier.
`);
  const productionModifiers = modifiers.map((r) => {
    const factors = {};
    const targets = String(r.target || '').split('/').map((t) => t.trim().toLowerCase());
    const f = Number(r.default_factor);
    const hasFactor = Number.isFinite(f) && f > 0;
    for (const t of targets) {
      if (!hasFactor) continue;
      if (t === 'production') factors.production = f;
      else if (t === 'labor') factors.labor_cost = f > 1 ? f : Number((2 - f).toFixed(4));
      else if (t === 'equipment') factors.equipment_cost = f > 1 ? f : Number((2 - f).toFixed(4));
      else if (t === 'material') factors.material_cost = f > 1 ? f : Number((2 - f).toFixed(4));
      else if (t === 'disposal') factors.disposal_cost = f > 1 ? f : Number((2 - f).toFixed(4));
      else if (t === 'indirect') factors.indirect_cost = f > 1 ? f : Number((2 - f).toFixed(4));
      else if (t === 'safety' || t === 'schedule') factors.schedule = f;
      else if (t === 'risk') factors.risk = f;
    }
    if (Object.keys(factors).length === 0 && hasFactor) factors.production = f;
    return { code: r.modifier_id, name: r.modifier_name, category: r.target, factors, rule: r.application_rule };
  }).filter((m) => Object.keys(m.factors).length > 0);

  // Section 7.1 cost-side modifiers, which the source library does not carry.
  const section71 = [
    { code: 'MOD-WET-SOIL', name: 'Wet soil', category: 'Section 7.1', factors: { labor_cost: 1.15, production: 0.85 }, rule: 'Geotechnical report or field observation indicates saturated soil' },
    { code: 'MOD-ROCK', name: 'Rock', category: 'Section 7.1', factors: { labor_cost: 1.35, equipment_cost: 1.35, production: 0.65 }, rule: 'Rock indicated by boring logs or observed in excavation' },
    { code: 'MOD-TIGHT-ACCESS', name: 'Tight access', category: 'Section 7.1', factors: { equipment_cost: 1.2, production: 0.8 }, rule: 'Working room restricts equipment size or movement' },
    { code: 'MOD-WINTER-COST', name: 'Winter conditions (cost)', category: 'Section 7.1', factors: { labor_cost: 1.12 }, rule: 'Work scheduled during winter months' },
    { code: 'MOD-NIGHT-COST', name: 'Night work (cost)', category: 'Section 7.1', factors: { labor_cost: 1.18, production: 0.88 }, rule: 'Owner or agency requires night work' },
  ];

  const allModifiers = [...productionModifiers, ...section71];
  out.push('insert into condition_modifiers (code, name, category, factors, application_rule, status) values');
  out.push(allModifiers.map((m) =>
    `  (${q(m.code)}, ${q(m.name)}, ${q(m.category)}, ${q(JSON.stringify(m.factors))}::jsonb, ${q(m.rule)}, 'active')`,
  ).join(',\n') + '\non conflict do nothing;\n');

  // --- Pricing profiles ----------------------------------------------------
  out.push(banner('Pricing profiles and markup components'));
  out.push('insert into pricing_profiles (code, name, method, labor_profile, equipment_profile, status) values');
  out.push(profiles.map((r) =>
    `  (${q(r.pricing_profile_id)}, ${q(r.profile_name)}, ${q(String(r.markup_method).toLowerCase() === 'stacked' ? 'stacked' : 'parallel')}, ${q(r.labor_profile)}, ${q(r.equipment_profile)}, 'active')`,
  ).join(',\n') + '\non conflict do nothing;\n');

  const markupRows = profiles.flatMap((r) => {
    const rows = [];
    const add = (code, label, pct, seq) => {
      const v = Number(pct);
      if (Number.isFinite(v) && v > 0) rows.push({ profile: r.pricing_profile_id, code, label, pct: v, seq });
    };
    add('OH', 'Overhead', r.overhead_percent, 10);
    add('PROFIT', 'Profit', r.profit_percent, 20);
    add('CONT', 'Contingency', r.contingency_percent, 30);
    return rows;
  });
  out.push(`insert into markup_components (company_id, pricing_profile_id, code, label, percent, basis, sequence)
select null, p.id, v.code, v.label, v.pct, 'profile_default', v.seq
from (values
${markupRows.map((m) => `  (${q(m.profile)}, ${q(m.code)}, ${q(m.label)}, ${m.pct}::numeric, ${m.seq})`).join(',\n')}
) as v(profile_code, code, label, pct, seq)
join pricing_profiles p on p.code = v.profile_code and p.company_id is null and p.enterprise_group_id is null
on conflict do nothing;
`);

  // --- Seed crews ----------------------------------------------------------
  // The v2.0 package references crew ids but ships no crew library, so the
  // discipline crews below are built from the shipped labor classifications.
  out.push(banner('Discipline crews (built from the shipped labor classifications)'));
  const crews = [
    { code: 'CRW-EW-01', name: 'Earthwork crew — small', discipline: 'Earthwork', members: [['LAB-FRM', 1], ['LAB-OP1', 1], ['LAB-LAB', 1]] },
    { code: 'CRW-EW-02', name: 'Mass excavation crew', discipline: 'Earthwork', members: [['LAB-FRM', 1], ['LAB-OP2', 2], ['LAB-OP1', 1], ['LAB-LAB', 1], ['LAB-SURV', 1]] },
    { code: 'CRW-UTL-01', name: 'Underground utility crew', discipline: 'Utilities', members: [['LAB-FRM', 1], ['LAB-OP1', 1], ['LAB-PIPE', 2], ['LAB-LAB', 1]] },
    { code: 'CRW-CON-01', name: 'Site concrete crew', discipline: 'Concrete', members: [['LAB-FRM', 1], ['LAB-CONC', 2], ['LAB-LAB', 2]] },
    { code: 'CRW-ASP-01', name: 'Asphalt paving crew', discipline: 'Asphalt', members: [['LAB-FRM', 1], ['LAB-OP2', 2], ['LAB-LAB', 3], ['LAB-DRV', 1]] },
    { code: 'CRW-DEM-01', name: 'Demolition crew', discipline: 'Demolition', members: [['LAB-FRM', 1], ['LAB-OP2', 1], ['LAB-LAB', 2]] },
    { code: 'CRW-LSC-01', name: 'Landscaping and site finishes crew', discipline: 'Landscaping', members: [['LAB-FRM', 1], ['LAB-OP1', 1], ['LAB-LAB', 3]] },
    { code: 'CRW-GRD-01', name: 'Fine grading crew', discipline: 'Earthwork', members: [['LAB-FRM', 1], ['LAB-OP2', 1], ['LAB-SURV', 1], ['LAB-LAB', 1]] },
  ];
  out.push('insert into crews (code, name, discipline, shift_hours, status) values');
  out.push(crews.map((c) => `  (${q(c.code)}, ${q(c.name)}, ${q(c.discipline)}, 8, 'active')`).join(',\n') + '\non conflict do nothing;\n');

  out.push(`insert into crew_members (company_id, crew_id, labor_rate_id, headcount)
select null, c.id, l.id, v.headcount
from (values
${crews.flatMap((c) => c.members.map(([code, count]) => `  (${q(c.code)}, ${q(code)}, ${count})`)).join(',\n')}
) as v(crew_code, labor_code, headcount)
join crews c on c.code = v.crew_code and c.company_id is null and c.enterprise_group_id is null
join labor_rates l on l.code = v.labor_code and l.company_id is null and l.enterprise_group_id is null
on conflict do nothing;
`);

  /*
   * The categories, derived from everything above. A value the catalog uses and
   * this misses would make the whole seed fail on 0113's guard, which is the
   * behavior wanted: a silent category is what this migration exists to stop.
   */
  const categorySources = [
    ['industry', [...services, ...tradeServices].map((r) => r.industry)],
    ['service_category', [...services, ...tradeServices].map((r) => r.category)],
    ['service_subcategory', [...services, ...tradeServices].map((r) => r.subcategory)],
    ['task_category', [...tasks, ...tradeTasks].map((r) => r.task_category)],
    ['modifier_category', allModifiers.map((m) => m.category)],
    ['labor_group', labor.map((r) => r.group)],
    ['equipment_class', equipment.map((r) => r.equipment_class)],
    ['crew_discipline', crews.map((c) => c.discipline)],
  ];
  const categoryRows = [];
  for (const [kind, values] of categorySources) {
    const seen = new Set();
    for (const raw of values) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      categoryRows.push(`  (${q(kind)}, ${q(name)})`);
    }
  }
  out[CATEGORY_SLOT] = [
    banner('Library categories — the vocabulary the catalog groups by'),
    'insert into library_categories (company_id, kind, name)',
    'select null, v.kind, v.name from (values',
    categoryRows.join(',\n'),
    ') as v(kind, name)',
    'on conflict do nothing;\n',
  ].join('\n');

  await writeFile(join(OUT_DIR, '0001_global_library.sql'), out.join('\n'), 'utf8');

  console.log(`Generated supabase/seed/0001_global_library.sql`);
  console.log(`  services            ${services.length}`);
  console.log(`  tasks               ${tasks.length}`);
  console.log(`  assembly components ${componentRows.length}`);
  if (packs.length > 0) {
    console.log(`  trade packs         ${packs.length} (${packs.map((p) => p.trade).join(', ')})`);
    console.log(`  trade services      ${tradeServices.length}`);
    console.log(`  trade tasks         ${tradeTasks.length}`);
    console.log(`  trade rates         ${tradeRates.length} (unsourced benchmarks)`);
  }
  console.log(`  labor classes       ${labor.length}`);
  console.log(`  equipment           ${equipment.length}`);
  console.log(`  production rates    ${productionRates.length}`);
  console.log(`  assemblies          ${assemblies.length}`);
  console.log(`  condition modifiers ${allModifiers.length}`);
  console.log(`  pricing profiles    ${profiles.length}`);
  console.log(`  crews               ${crews.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

/**
 * A rate you type, and a crew you did not have to assemble.
 *
 * Both halves of this were already half-built and unreachable. Migration 0066
 * added `parametric_cost_per_unit` with a constraint requiring a stated basis,
 * and nothing ever wrote it. `assembly_components` holds 8,159 platform rows
 * saying what a service is made of, and nothing ever read them onto a line.
 *
 * The property tested hardest is that a line cannot carry both. A rate somebody
 * typed and resources built up underneath it would report a number nobody could
 * reproduce from what is on the line, which is the failure mode this whole
 * schema is arranged to prevent.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a rate you type, and a crew you did not', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let versionId = '';
  let n = 0;

  const sql = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  const line = async (description = 'Mass excavation', qty = 1000, unit = 'CY') => {
    const [r] = await sql<{ id: string }>(
      `insert into estimate_line_items
         (company_id, estimate_version_id, line_number, description, unit,
          measured_quantity, gross_quantity)
       values ($1, $2, $3, $4, $5::app.unit_code, $6, $6) returning id`,
      [company, versionId, ++n, description, unit, qty]);
    return r!.id;
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;

    const [c] = await sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'C-1','Northside')
       returning id`, [company]);
    const [e] = await sql<{ id: string }>(
      `insert into estimates (company_id, customer_id, number, name)
       values ($1,$2,'E-2026-0001','Yard') returning id`, [company, c!.id]);
    const [v] = await sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,1,'draft') returning id`, [company, e!.id]);
    versionId = v!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('typing a unit cost', () => {
    let id = '';

    it('takes the rate and the reason together', async () => {
      id = await line('Sitework subcontract', 1);
      const [r] = await sql<{ parametric_cost_per_unit: string; parametric_basis: string }>(
        `select parametric_cost_per_unit::text, parametric_basis
         from set_line_unit_cost($1, 48250.00, 'Sub quote, Delaney Bros, 14 Aug')`, [id]);
      expect(Number(r!.parametric_cost_per_unit)).toBe(48250);
      expect(r!.parametric_basis).toBe('Sub quote, Delaney Bros, 14 Aug');
    });

    it('scores it as the allowance it is, rather than as a measured line', async () => {
      /*
       * `measurement_method` decides which approval gate a line passes through.
       * A conceptual line labeled as an explicit dimension would sail through
       * one it has not earned.
       */
      const [r] = await sql<{ measurement_method: string }>(
        `select measurement_method::text from estimate_line_items where id = $1`, [id]);
      expect(r!.measurement_method).toBe('estimator_allowance');
    });

    it('refuses a rate with no reason behind it', async () => {
      const l = await line('Allowance for something');
      await expect(sql(`select set_line_unit_cost($1, 100, 'x')`, [l]))
        .rejects.toThrow(/Say where the rate came from/);
    });

    it('refuses a negative rate', async () => {
      const l = await line('Negative money');
      await expect(sql(`select set_line_unit_cost($1, -5, 'A quote from nobody')`, [l]))
        .rejects.toThrow(/cannot be negative/);
    });

    it('takes it back off again', async () => {
      const [r] = await sql<{ parametric_cost_per_unit: string | null }>(
        `select parametric_cost_per_unit::text from clear_line_unit_cost($1)`, [id]);
      expect(r!.parametric_cost_per_unit).toBeNull();
    });

    it('does not quietly upgrade the line back to a measured one', async () => {
      /*
       * Whether the quantity is measured is a claim only an estimator can make.
       * Resetting the method here would raise the line's confidence on the
       * platform's own say-so.
       */
      const [r] = await sql<{ measurement_method: string }>(
        `select measurement_method::text from estimate_line_items where id = $1`, [id]);
      expect(r!.measurement_method).toBe('estimator_allowance');
    });

    it('refuses a rate on a line that has children, because a parent is their sum', async () => {
      const parent = await line('Sitework');
      const child = await line('Under it');
      await sql(`update estimate_line_items set parent_line_id = $1 where id = $2`,
        [parent, child]);
      await expect(sql(
        `select set_line_unit_cost($1, 1000, 'A number I know')`, [parent]))
        .rejects.toThrow(/a parent is the sum of its children/);
    });

    it('refuses once the version is frozen', async () => {
      /*
       * `in_review` is past draft and has no snapshot gate of its own. Issuing
       * requires a library snapshot, which is a different rule with its own
       * test; what is checked here is that the freeze is honored at all.
       */
      const l = await line('Late rate');
      await sql(`update estimate_versions set status = 'archived' where id = $1`, [versionId]);
      await expect(sql(`select set_line_unit_cost($1, 10, 'A quote from August')`, [l]))
        .rejects.toThrow(/make a new version to change it/);
      await sql(`update estimate_versions set status = 'draft' where id = $1`, [versionId]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('a rate and resources cannot both be on one line', () => {
    it('refuses a rate when resources are already priced', async () => {
      const l = await line('Already built up');
      await sql(`select app.save_line_resource($1, 'labor', '{"quantity":8,"unit_rate":42}'::jsonb)`,
        [l]);
      await expect(sql(`select set_line_unit_cost($1, 99, 'A quote from August')`, [l]))
        .rejects.toThrow(/already has 1 resources/);
    });

    it('refuses resources when a rate is already typed', async () => {
      const l = await line('Already rated');
      await sql(`select set_line_unit_cost($1, 12.5, 'Last year on the Hallow job')`, [l]);
      await expect(sql(`select apply_line_resource_suggestions($1)`, [l]))
        .rejects.toThrow(/priced at a typed rate/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('what the library says a line is made of', () => {
    let id = '';
    let serviceId = '';

    beforeAll(async () => {
      /*
       * A service with an assembly holding one machine and one material, which
       * is the shape of thousands of platform rows.
       */
      const [a] = await sql<{ id: string }>(
        `insert into assemblies (company_id, code, name, quantity_unit, status, approved_by, approved_at)
         values ($1,'ASM-T','Excavate and haul','CY','active',$2,now()) returning id`,
        [company, chief]);
      const [eq] = await sql<{ id: string }>(
        `insert into equipment (company_id, code, name, status, approved_by, approved_at)
         values ($1,'EQ-T','Excavator 320','active', $2, now()) returning id`,
        [company, chief]);
      // The rate lives in equipment_rates, one row per source (RULE-003).
      await sql(
        `insert into equipment_rates (company_id, equipment_id, source, hourly_rate)
         values ($1, $2, 'tenant_approved', 145)`, [company, eq!.id]);
      const [m] = await sql<{ id: string }>(
        `insert into materials (company_id, code, name, unit, unit_cost, status, approved_by, approved_at)
         values ($1,'MAT-T','Aggregate base','TON', 22.5, 'active', $2, now()) returning id`,
        [company, chief]);
      await sql(
        `insert into assembly_components
           (company_id, assembly_id, component_kind, equipment_id, quantity_per_unit, sort_order)
         values ($1,$2,'equipment',$3, 0.02, 10)`, [company, a!.id, eq!.id]);
      await sql(
        `insert into assembly_components
           (company_id, assembly_id, component_kind, material_id, quantity_per_unit, sort_order)
         values ($1,$2,'material',$3, 1.4, 20)`, [company, a!.id, m!.id]);
      const [s] = await sql<{ id: string }>(
        `insert into services (company_id, code, name, default_unit, supported_units,
                               default_assembly_id, status, approved_by, approved_at)
         values ($1,'C-T','Excavate and haul','CY', array['CY']::app.unit_code[], $2,
                 'active', $3, now()) returning id`, [company, a!.id, chief]);
      serviceId = s!.id;

      id = await line('Excavate and haul', 500, 'CY');
      await sql(`update estimate_line_items set service_id = $1 where id = $2`, [serviceId, id]);
    });

    it('scales every component by the line quantity', async () => {
      const rows = await sql<{ resource_kind: string; quantity: string; unit_rate: string }>(
        `select resource_kind, quantity::text, unit_rate::text
         from app.line_resource_suggestions($1) order by resource_kind`, [id]);
      const equipment = rows.find((r) => r.resource_kind === 'equipment')!;
      const material = rows.find((r) => r.resource_kind === 'material')!;
      expect(Number(equipment.quantity)).toBe(10);      // 0.02 × 500
      expect(Number(material.quantity)).toBe(700);      // 1.4 × 500
      expect(Number(equipment.unit_rate)).toBe(145);
    });

    it('extends each one at the library rate', async () => {
      const [r] = await sql<{ extended_cost: string }>(
        `select extended_cost::text from app.line_resource_suggestions($1)
         where resource_kind = 'material'`, [id]);
      expect(Number(r!.extended_cost)).toBe(15750);     // 700 × 22.50
    });

    it('names each one, so a screen is not showing bare identifiers', async () => {
      const rows = await sql<{ name: string }>(
        `select name from app.line_resource_suggestions($1) order by name`, [id]);
      expect(rows.map((r) => r.name)).toEqual(['Aggregate base', 'Excavator 320']);
    });

    it('suggests nothing for a line with no service behind it', async () => {
      const bare = await line('Something typed');
      const rows = await sql(`select * from app.line_resource_suggestions($1)`, [bare]);
      expect(rows.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('putting the library answer on the line', () => {
    let id = '';

    beforeAll(async () => {
      const [s] = await sql<{ id: string }>(
        `select id from services where company_id = $1 and code = 'C-T'`, [company]);
      id = await line('Excavate and haul again', 500, 'CY');
      await sql(`update estimate_line_items set service_id = $1 where id = $2`, [s!.id, id]);
    });

    it('writes what the assembly said, and says how many', async () => {
      const [r] = await sql<{ n: string }>(
        `select apply_line_resource_suggestions($1)::text as n`, [id]);
      expect(Number(r!.n)).toBe(2);
    });

    it('lands them as real resources with the quantities scaled', async () => {
      const rows = await sql<{ resource_kind: string; quantity: string }>(
        `select resource_kind, quantity::text from estimate_line_resources
         where line_item_id = $1 order by resource_kind`, [id]);
      expect(rows.map((r) => r.resource_kind)).toEqual(['equipment', 'material']);
      expect(Number(rows[0]!.quantity)).toBe(10);
    });

    it('adds nothing the second time, rather than doubling the crew', async () => {
      const [r] = await sql<{ n: string }>(
        `select apply_line_resource_suggestions($1)::text as n`, [id]);
      expect(Number(r!.n)).toBe(0);
    });

    it('takes only the kinds asked for', async () => {
      const [s] = await sql<{ id: string }>(
        `select id from services where company_id = $1 and code = 'C-T'`, [company]);
      const only = await line('Materials only', 100, 'CY');
      await sql(`update estimate_line_items set service_id = $1 where id = $2`, [s!.id, only]);
      const [r] = await sql<{ n: string }>(
        `select apply_line_resource_suggestions($1, array['material'])::text as n`, [only]);
      expect(Number(r!.n)).toBe(1);
      const rows = await sql<{ resource_kind: string }>(
        `select resource_kind from estimate_line_resources where line_item_id = $1`, [only]);
      expect(rows.map((r) => r.resource_kind)).toEqual(['material']);
    });

    it('shows nobody anything anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(`select * from my_line_resource_suggestions`))
          .rejects.toThrow(/permission denied/);
      });
    });
  });
});

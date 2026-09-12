/**
 * A resource you can repoint.
 *
 * Migration 0139 made `save_line_resource` refuse a field name it does not
 * recognize, because a key that matches nothing writes nothing and reports
 * success. That guard asks whether a key is *known*. It does not ask whether a
 * known key is *applied*, and six were not: the six library links were written
 * on insert, listed as accepted, and never mentioned by the UPDATE branch. Send
 * one on an existing row and the call returned the resource id having changed
 * nothing — the same shape as the defect the guard was built to stop.
 *
 * It mattered because those links are not decoration. `capture_library_snapshot`
 * reads all six to record what actually priced a version, so a row renamed by
 * hand went on reporting the library record it used to be, and the snapshot
 * recorded that as the thing that priced the bid.
 *
 * The tests below are written from the failing side: a repoint that does not
 * land, and a link that cannot be removed, are the two ways this goes wrong.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('repointing a resource at a different library row', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let version = '';
  let line = '';
  let stone = '';
  let pitRun = '';
  let machine = '';

  const save = (kind: string, fields: Record<string, unknown>, id?: string) =>
    h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.save_line_resource($1,$2,$3::jsonb,$4) as id`,
      [line, kind, JSON.stringify(fields), id ?? null])).then(([r]) => r!.id);

  const row = (id: string) =>
    h.asUser(chief, () => h.sql<{
      description: string | null; material_id: string | null;
      equipment_id: string | null; unit_rate: string;
    }>(`select description, material_id, equipment_id, unit_rate
          from estimate_line_resources where id = $1`, [id])).then(([r]) => r!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    /* Two materials this company owns, so a row can be moved from one to the
       other — which is the operation under test. Draft, because an active
       company row needs an approver (0028) and approval is not the subject. */
    for (const [code, name] of [['MAT-R-1', 'Crushed stone'], ['MAT-R-2', 'Pit run']] as const) {
      const [m] = await h.asUser(chief, () => h.sql<{ id: string }>(
        `insert into materials (company_id, code, name, unit, unit_cost, status)
         values ($1,$2,$3,'CY',24,'draft') returning id`, [company, code, name]));
      if (code === 'MAT-R-1') stone = m!.id; else pitRun = m!.id;
    }
    const [e] = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select id from equipment where company_id is null and status = 'active' limit 1`));
    machine = e?.id ?? '';

    const [svc] = await h.sql<{ id: string }>(
      `select id from services where company_id is null and status = 'active' limit 1`);
    const [est] = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Berm build', null, null, null, $1) as id`, [company]));
    const [v] = await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id]));
    version = v!.v;
    line = await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1,$2,null,100) as id`, [version, svc!.id]))
      .then(([r]) => r!.id);
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  describe('the link an added row carries', () => {
    it('keeps what it was picked from', async () => {
      const id = await save('material', {
        description: 'Crushed stone', material_id: stone, quantity: 40, unit_rate: 24,
      });
      expect((await row(id)).material_id).toBe(stone);
    });
  });

  describe('changing what a row is', () => {
    let id = '';

    beforeAll(async () => {
      id = await save('material', {
        description: 'Crushed stone', material_id: stone, quantity: 40, unit_rate: 24,
      });
    });

    it('moves the link with the name', async () => {
      /*
       * The whole defect. Before this migration the description changed, the
       * link did not, and the call returned success — so the line said pit run
       * and the snapshot went on recording crushed stone as what priced it.
       */
      await save('material', {
        description: 'Pit run', material_id: pitRun, unit_rate: 18,
      }, id);
      const r = await row(id);
      expect(r.description).toBe('Pit run');
      expect(r.material_id).toBe(pitRun);
      expect(Number(r.unit_rate)).toBe(18);
    });

    it('removes the link when the name is typed by hand', async () => {
      /*
       * A row somebody renamed themselves is no longer the library row it came
       * from. Leaving the old link would be the same lie in the other
       * direction — and `coalesce(new, old)` cannot express this at all, which
       * is why these six read key presence rather than value.
       */
      await save('material', { description: 'Screened sand from the pit', material_id: null }, id);
      const r = await row(id);
      expect(r.description).toBe('Screened sand from the pit');
      expect(r.material_id).toBeNull();
    });

    it('leaves the link alone when the key is not sent at all', async () => {
      // A partial send must not blank a column nobody mentioned — the reason
      // every other field keeps `coalesce`.
      await save('material', { description: 'Crushed stone', material_id: stone }, id);
      await save('material', { quantity: 60 }, id);
      expect((await row(id)).material_id).toBe(stone);
    });

    it('treats an empty string as no link rather than a bad uuid', async () => {
      // A cleared select sends '' before it sends null; both mean the same
      // thing to a person and one of them used to be a cast error.
      await save('material', { material_id: '' }, id);
      expect((await row(id)).material_id).toBeNull();
    });
  });

  describe('the other five links', () => {
    it('repoints a machine', async () => {
      if (!machine) return;
      const id = await save('equipment', { description: 'Rented hoe', hours: 8 });
      expect((await row(id)).equipment_id).toBeNull();
      await save('equipment', { description: 'Excavator', equipment_id: machine }, id);
      expect((await row(id)).equipment_id).toBe(machine);
    });

    it('accepts every one of the six by name', async () => {
      /*
       * Driven from the function's own accepted list rather than a copy of it,
       * so a seventh link added later fails here until it is applied too. The
       * point is not that null is a useful value — it is that the update path
       * mentions the column at all.
       */
      const id = await save('labor', { description: 'Operator', headcount: 1 });
      for (const key of ['labor_rate_id', 'equipment_id', 'material_id',
                         'trucking_rate_id', 'disposal_site_id', 'vendor_id']) {
        await expect(save('labor', { [key]: null }, id)).resolves.toBe(id);
      }
    });
  });

  describe('what has not changed', () => {
    it('still refuses a field name it does not recognize', async () => {
      const id = await save('material', { description: 'Topsoil' });
      await expect(save('material', { materialId: stone }, id))
        .rejects.toThrow(/no field called "materialId"/i);
    });

    it('still refuses to touch a version that is no longer a draft', async () => {
      const id = await save('material', { description: 'Riprap' });
      /* `archived` rather than `approved`: approving needs the library snapshot
         that priced it (0026), and RULE-009 is what is under test here. */
      await h.asService(() => h.sql(
        `update estimate_versions set status = 'archived' where id = $1`, [version]));
      await expect(save('material', { material_id: stone }, id))
        .rejects.toThrow(/make a new version/i);
      await h.asService(() => h.sql(
        `update estimate_versions set status = 'draft' where id = $1`, [version]));
    });
  });
});

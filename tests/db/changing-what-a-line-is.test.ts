/**
 * Changing what a line is.
 *
 * The description has been read-only since the workspace was built. An
 * estimator could change a line's quantity, unit, crew, rate and markup, and
 * could not fix a typo in what it says or swap it onto the right library item
 * once they found it.
 *
 * The interesting half is what follows the swap. The unit, the cost code and
 * the production rate belong to the service rather than to the line — so they
 * come across, except the unit, which is held back the moment resources are
 * priced on the line. Rescaling a measured quantity underneath somebody is
 * worse than leaving the unit alone and telling them.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

interface Report {
  service: string | null;
  unit?: string;
  unit_held?: boolean;
  priced_resources?: number;
  changed: string[];
}

describe('changing what a line is', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '', versionId = '';
  let excavation = '', storm = '';
  let n = 0;

  const sql = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  const line = async (description: string, unit = 'CY', service: string | null = null) => {
    const [r] = await sql<{ id: string }>(
      `insert into estimate_line_items
         (company_id, estimate_version_id, line_number, description, unit,
          measured_quantity, service_id)
       values ($1,$2,$3,$4,$5::app.unit_code,100,$6) returning id`,
      [company, versionId, ++n, description, unit, service]);
    return r!.id;
  };

  const repoint = async (lineId: string, service: string | null, keep = false) => {
    const [r] = await sql<{ report: Report }>(
      `select set_line_service($1, $2, $3) as report`, [lineId, service, keep]);
    return r!.report;
  };

  const read = (lineId: string) => sql<{
    description: string; unit: string; service_id: string | null;
    cost_code_id: string | null; production_rate_id: string | null;
  }>(`select description, unit::text, service_id, cost_code_id, production_rate_id
      from estimate_line_items where id = $1`, [lineId]).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;

    const [c] = await sql<{ id: string }>(
      `insert into customers (company_id, code, name) values ($1,'C-1','North') returning id`,
      [company]);
    const [e] = await sql<{ id: string }>(
      `insert into estimates (company_id, customer_id, number, name)
       values ($1,$2,'E-1','Yard') returning id`, [company, c!.id]);
    const [v] = await sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,1,'draft') returning id`, [company, e!.id]);
    versionId = v!.id;

    const [a] = await sql<{ id: string }>(
      `select id from services where company_id is null and default_unit = 'CY' limit 1`);
    excavation = a!.id;
    const [b] = await sql<{ id: string }>(
      `select id from services where company_id is null and default_unit = 'LF'
         and cost_code_id is not null limit 1`);
    storm = b!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('typing a description', () => {
    it('changes the words on a line of your own', async () => {
      const l = await line('Haul spoil ofsite');
      await sql(`select update_estimate_line($1, '{"description":"Haul spoil offsite"}'::jsonb)`,
        [l]);
      expect((await read(l)).description).toBe('Haul spoil offsite');
    });

    it('changes the words on a line that came from the library', async () => {
      /*
       * A library line is not frozen prose. "Mass excavation" becomes "Mass
       * excavation — north half" and the link stays, because the estimator is
       * describing this job rather than renaming the service.
       */
      const l = await line('Mass excavation', 'CY', excavation);
      await sql(`select update_estimate_line($1,
                   '{"description":"Mass excavation — north half"}'::jsonb)`, [l]);
      const after = await read(l);
      expect(after.description).toBe('Mass excavation — north half');
      expect(after.service_id).toBe(excavation);
    });
  });

  // ---------------------------------------------------------------------------
  describe('swapping the line onto a different library item', () => {
    it('takes the new name', async () => {
      const l = await line('Something I typed');
      const r = await repoint(l, storm);
      expect(r.service).toBeTruthy();
      expect((await read(l)).description).toBe(r.service);
    });

    it('brings the unit across when nothing is priced yet', async () => {
      const l = await line('Still a guess', 'CY');
      const r = await repoint(l, storm);
      expect((await read(l)).unit).toBe('LF');
      expect(r.changed).toContain('unit');
    });

    it('brings the cost code, so the line still reaches a budget', async () => {
      const l = await line('No code yet');
      await repoint(l, storm);
      expect((await read(l)).cost_code_id).toBeTruthy();
    });

    it('keeps the words when asked to', async () => {
      const l = await line('Storm line — as marked on C-301');
      await repoint(l, storm, true);
      const after = await read(l);
      expect(after.description).toBe('Storm line — as marked on C-301');
      expect(after.service_id).toBe(storm);
    });
  });

  // ---------------------------------------------------------------------------
  describe('when the line has already been priced', () => {
    it('holds the unit rather than rescaling a measured quantity', async () => {
      /*
       * The refusal that matters. Somebody measured 100 CY; changing the unit
       * to LF underneath them leaves the number and changes what it means.
       */
      const l = await line('Priced already', 'CY');
      await sql(`select app.save_line_resource($1,'labor','{"quantity":8,"unit_rate":42}'::jsonb)`,
        [l]);
      const r = await repoint(l, storm);
      expect((await read(l)).unit).toBe('CY');
      expect(r.unit_held).toBe(true);
      expect(r.changed).not.toContain('unit');
    });

    it('still repoints the line, so the swap is not refused outright', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from estimate_line_items
         where description is not null and service_id = $1`, [storm]);
      expect(Number(r!.c)).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('taking a line back off the library', () => {
    it('clears the link and keeps the words', async () => {
      const l = await line('Mass excavation', 'CY', excavation);
      await sql(`select update_estimate_line($1, '{"description":"My own wording"}'::jsonb)`, [l]);
      const r = await repoint(l, null);
      expect(r.service).toBeNull();
      const after = await read(l);
      expect(after.service_id).toBeNull();
      expect(after.description).toBe('My own wording');
    });
  });

  // ---------------------------------------------------------------------------
  describe('what it refuses', () => {
    it('refuses a service from another company', async () => {
      const rival = '44444444-4444-4444-8444-444444444444';
      await h.sql(`insert into auth.users (id, email) values ($1,'r@r.test')`, [rival]);
      await h.sql(`insert into user_profiles (id, email) values ($1,'r@r.test')
                   on conflict (id) do nothing`, [rival]);
      const [other] = await h.asUser(rival, () => h.sql<{ id: string }>(
        `select app.provision_company('Rival','rival','starter') as id`));
      // Written as the rival's own owner: the policy is the point of the test.
      const [s] = await h.asUser(rival, () => h.sql<{ id: string }>(
        `insert into services (company_id, code, name, default_unit, supported_units,
                               status, approved_by, approved_at)
         values ($1,'C-X','Theirs','LS',array['LS']::app.unit_code[],'active',$2,now())
         returning id`, [other!.id, rival]));
      const l = await line('Mine');
      await expect(repoint(l, s!.id)).rejects.toThrow(/No such service in your library/);
    });

    it('refuses once the version is frozen', async () => {
      const l = await line('Late change');
      await sql(`update estimate_versions set status = 'archived' where id = $1`, [versionId]);
      await expect(repoint(l, storm)).rejects.toThrow(/make a new version to change it/);
      await sql(`update estimate_versions set status = 'draft' where id = $1`, [versionId]);
    });

    it('lets nobody reach it anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(
          `select set_line_service('00000000-0000-4000-8000-000000000000', null)`))
          .rejects.toThrow(/permission denied/);
      });
    });
  });
});

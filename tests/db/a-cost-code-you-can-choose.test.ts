/**
 * A cost code you can choose.
 *
 * The field was optional and unreachable, which is not the same thing. Nothing
 * refuses a line without a cost code and no gate blocks issuing over one — but
 * `update_estimate_line` never accepted the field and no screen offered a
 * picker, so the only way a line ever got one was inheritance from the library
 * service it was created from. The code shown on a line came from somewhere the
 * estimator did not choose and could not change.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a cost code on a line', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  const rival = '22222222-2222-4222-8222-222222222222';
  let company = '', other = '', line = '', ownCode = '', platformCode = '', theirCode = '';

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);
  const codeOn = () => sql<{ c: string | null }>(
    `select cost_code_id::text as c from estimate_line_items where id = $1`, [line])
    .then((r) => r[0]!.c);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, e] of [[chief,'c@r.test'],[rival,'o@r.test']] as const) {
      await h.sql(`insert into auth.users (id,email) values ($1,$2)`, [id, e]);
      await h.sql(`insert into user_profiles (id,email) values ($1,$2)
                   on conflict (id) do nothing`, [id, e]);
    }
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    other = (await as<{ id: string }>(rival,
      `select app.provision_company('Other','otherco','enterprise') as id`))[0]!.id;

    line = await h.asUser(chief, async () => {
      const e = (await h.sql<{ id: string }>(
        `insert into estimates (company_id,number,name) values ($1,'E-1','Kingsway')
         returning id`, [company]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `insert into estimate_versions (company_id,estimate_id,version_number)
         values ($1,$2,1) returning id`, [company, e]))[0]!.id;
      return (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id,estimate_version_id,description,
                                          measured_quantity,unit)
         values ($1,$2,'Mass excavation',12000,'CY') returning id`, [company, v]))[0]!.id;
    });

    ownCode = (await sql<{ id: string }>(
      `insert into cost_codes (company_id, code, name, status, approved_by, approved_at)
       values ($1,'CC-OURS','Our earthwork','active',$2,now()) returning id`,
      [company, chief]))[0]!.id;
    theirCode = (await as<{ id: string }>(rival,
      `insert into cost_codes (company_id, code, name, status, approved_by, approved_at)
       values ($1,'CC-THEIRS','Their earthwork','active',$2,now()) returning id`,
      [other, rival]))[0]!.id;
    const [p] = await sql<{ id: string }>(
      `select id from cost_codes where company_id is null limit 1`);
    platformCode = p!.id;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  it('takes one the company owns', async () => {
    await sql(`select update_estimate_line($1, jsonb_build_object('cost_code_id', $2::text))`,
      [line, ownCode]);
    expect(await codeOn()).toBe(ownCode);
  });

  it('takes one the platform ships, because a shipped CSI code is a real rollup', async () => {
    await sql(`select update_estimate_line($1, jsonb_build_object('cost_code_id', $2::text))`,
      [line, platformCode]);
    expect(await codeOn()).toBe(platformCode);
  });

  it('clears it, because optional means it can be taken off again', async () => {
    await sql(`select update_estimate_line($1, '{"cost_code_id": null}'::jsonb)`, [line]);
    expect(await codeOn()).toBeNull();
  });

  it('reads an empty string as cleared rather than as a broken uuid', async () => {
    // A select that offers "none" hands back "" and it must not be a crash.
    await sql(`select update_estimate_line($1, jsonb_build_object('cost_code_id', $2::text))`,
      [line, ownCode]);
    await sql(`select update_estimate_line($1, '{"cost_code_id": ""}'::jsonb)`, [line]);
    expect(await codeOn()).toBeNull();
  });

  it('leaves it alone when the field is not mentioned at all', async () => {
    await sql(`select update_estimate_line($1, jsonb_build_object('cost_code_id', $2::text))`,
      [line, ownCode]);
    await sql(`select update_estimate_line($1, '{"description": "Renamed"}'::jsonb)`, [line]);
    expect(await codeOn()).toBe(ownCode);
  });

  it('refuses another company code rather than rolling the line into their budget', async () => {
    await expect(sql(
      `select update_estimate_line($1, jsonb_build_object('cost_code_id', $2::text))`,
      [line, theirCode])).rejects.toThrow(/not one this company can use/);
  });

  it('refuses a cost code that does not exist', async () => {
    await expect(sql(
      `select update_estimate_line($1, '{"cost_code_id": "55555555-5555-4555-8555-555555555555"}'::jsonb)`,
      [line])).rejects.toThrow(/not one this company can use/);
  });

  it('offers the codes a line may use, saying which are the company own', async () => {
    const rows = await sql<{ code: string; is_own: boolean }>(
      `select code, is_own from my_cost_codes where code in ('CC-OURS','CC-THEIRS')`);
    expect(rows.map((r) => r.code)).toEqual(['CC-OURS']);
    expect(rows[0]!.is_own).toBe(true);
  });

  it('still refuses a field name it does not know', async () => {
    await expect(sql(`select update_estimate_line($1, '{"costCodeId": "x"}'::jsonb)`, [line]))
      .rejects.toThrow(/costCodeId/);
  });
});

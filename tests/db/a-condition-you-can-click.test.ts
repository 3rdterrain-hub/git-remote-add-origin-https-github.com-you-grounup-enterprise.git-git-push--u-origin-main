/**
 * A condition somebody can actually put on a line.
 *
 * `estimate_line_modifiers` has existed since migration 0006: a line, a
 * condition, the factors it applied, and a justification the table itself
 * insists is ten characters or more. The engine reads it — `modifiers.combined`
 * multiplies labor, equipment, material, trucking and disposal cost by what
 * comes out.
 *
 * The only writers were the template and revision copiers from 0112, which move
 * conditions that already exist from one version to the next. Nothing let a
 * person put one on a line, so the COND. column rendered `1.0x` as gray text on
 * every estimate ever built — a number that could never be anything else, on a
 * column whose whole purpose is to be changed.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const CHIEF = '11111111-1111-4111-8111-111111111111';
const CLERK = '22222222-2222-4222-8222-222222222222';
const RIVAL = '33333333-3333-4333-8333-333333333333';

describe('a condition you can click', () => {
  let h: Harness;
  let company = '';
  let theirs = '';
  let line = '';
  let modifier = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[CHIEF, 'chief@ridge.test'], [CLERK, 'clerk@ridge.test'],
      [RIVAL, 'rival@other.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await h.asUser(CHIEF, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','grounup') as id`)))[0]!.id;

    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       select $1, $2, r.id, 'active', now() from roles r
        where r.company_id is null and r.key = 'foreman' limit 1`, [company, CLERK]);

    line = await h.asUser(CHIEF, async () => {
      const est = (await h.sql<{ id: string }>(
        `select public.create_estimate('Rock at the invert', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `select current_version_id as id from estimates where id = $1`, [est]))[0]!.id;
      return (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id, estimate_version_id, description,
                                          measured_quantity, unit)
         values ($1,$2,'Storm sewer, 12 in RCP',240,'LF') returning id`,
        [company, v]))[0]!.id;
    });

    modifier = (await h.sql<{ id: string }>(
      `select id from condition_modifiers where status = 'active' limit 1`))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  it('had a library of conditions and no way to reach it', async () => {
    // The premise: the library was always there.
    const [row] = await h.sql<{ n: string }>(
      `select count(*)::text as n from condition_modifiers where status = 'active'`);
    expect(Number(row!.n)).toBeGreaterThan(0);
  });

  it('puts one on a line, with the reason it applies', async () => {
    await h.asUser(CHIEF, () => h.sql(
      `select public.apply_line_condition($1, $2, 'Limestone ledge at 9 ft, not on the borings')`,
      [line, modifier]));
    const [row] = await h.asUser(CHIEF, () => h.sql<Record<string, unknown>>(
      `select justification, applied_factors, applied_by
         from estimate_line_modifiers where line_item_id = $1`, [line]));
    expect(row!.justification).toBe('Limestone ledge at 9 ft, not on the borings');
    expect(row!.applied_by).toBe(CHIEF);
  });

  it('copies the factors as they stand, so a retune cannot re-price an old bid', async () => {
    /*
     * The same reasoning as the library snapshot. A modifier the company
     * adjusts next month must not silently change what a bid already went out
     * at — so the row carries what was applied, not a pointer to what the
     * library currently says.
     */
    const [applied] = await h.asUser(CHIEF, () => h.sql<{ f: Record<string, number> }>(
      `select applied_factors as f from estimate_line_modifiers where line_item_id = $1`, [line]));
    const [library] = await h.sql<{ f: Record<string, number> }>(
      `select factors as f from condition_modifiers where id = $1`, [modifier]);
    expect(applied!.f).toEqual(library!.f);

    await h.asService(() => h.sql(
      `update condition_modifiers set factors = '{"labor_cost": 9.99}'::jsonb where id = $1`,
      [modifier]));
    const [after] = await h.asUser(CHIEF, () => h.sql<{ f: Record<string, number> }>(
      `select applied_factors as f from estimate_line_modifiers where line_item_id = $1`, [line]));
    expect(after!.f).toEqual(library!.f);
    expect(after!.f).not.toEqual({ labor_cost: 9.99 });

    await h.asService(() => h.sql(
      `update condition_modifiers set factors = $2::jsonb where id = $1`,
      [modifier, JSON.stringify(library!.f)]));
  });

  it('refuses a justification nobody wrote', async () => {
    await expect(h.asUser(CHIEF, () => h.sql(
      `select public.apply_line_condition($1, $2, 'rock')`, [line, modifier])))
      .rejects.toThrow(/Say why this condition applies/);
  });

  it('rewrites the reason rather than failing on the same condition twice', async () => {
    // The common edit is improving the wording, not adding it again — and the
    // unique constraint would otherwise raise something nobody can act on.
    await h.asUser(CHIEF, () => h.sql(
      `select public.apply_line_condition($1, $2, 'Ledge confirmed by the test pits')`,
      [line, modifier]));
    const rows = await h.asUser(CHIEF, () => h.sql<{ justification: string }>(
      `select justification from estimate_line_modifiers where line_item_id = $1`, [line]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.justification).toBe('Ledge confirmed by the test pits');
  });

  it('shows it on the view a screen reads', async () => {
    const [row] = await h.asUser(CHIEF, () => h.sql<Record<string, unknown>>(
      `select code, name, category, application_rule, applied_factors, justification
         from my_line_conditions where line_item_id = $1`, [line]));
    expect(row!.code).toBeTruthy();
    expect(row!.name).toBeTruthy();
  });

  it('takes one off again', async () => {
    await h.asUser(CHIEF, () => h.sql(
      `select public.remove_line_condition($1, $2)`, [line, modifier]));
    const rows = await h.asUser(CHIEF, () => h.sql(
      `select 1 from estimate_line_modifiers where line_item_id = $1`, [line]));
    expect(rows).toHaveLength(0);
  });

  it('refuses somebody without estimates.write', async () => {
    await expect(h.asUser(CLERK, () => h.sql(
      `select public.apply_line_condition($1, $2, 'Trying it on from a foreman account')`,
      [line, modifier]))).rejects.toThrow(/permission/);
  });

  it('refuses another company’s line', async () => {
    await expect(h.asUser(RIVAL, () => h.sql(
      `select public.apply_line_condition($1, $2, 'Not my estimate at all')`,
      [line, modifier]))).rejects.toThrow();
    expect(theirs).toBeTruthy();
  });

  it('refuses a version that is no longer being worked on', async () => {
    const frozen = await h.asUser(CHIEF, async () => {
      const est = (await h.sql<{ id: string }>(
        `select public.create_estimate('Already approved', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await h.sql<{ id: string }>(
        `select current_version_id as id from estimates where id = $1`, [est]))[0]!.id;
      const l = (await h.sql<{ id: string }>(
        `insert into estimate_line_items (company_id, estimate_version_id, description,
                                          measured_quantity, unit)
         values ($1,$2,'Frozen line',10,'LF') returning id`, [company, v]))[0]!.id;
      const snap = (await h.sql<{ id: string }>(
        `insert into library_snapshots (company_id, estimate_version_id, engine_version,
                                        entry_count, digest)
         values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [company, v]))[0]!.id;
      await h.asService(() => h.sql(
        `update estimate_versions set library_snapshot_id = $2, status = 'approved'
          where id = $1`, [v, snap]));
      return l;
    });
    await expect(h.asUser(CHIEF, () => h.sql(
      `select public.apply_line_condition($1, $2, 'Too late for this one')`,
      [frozen, modifier]))).rejects.toThrow(/make a new version/);
  });

  it('is granted to a signed-in person and to nobody else', async () => {
    const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated',
                'public.apply_line_condition(uuid, uuid, text)', 'execute') as authenticated,
              has_function_privilege('anon',
                'public.apply_line_condition(uuid, uuid, text)', 'execute') as anon`);
    expect(g!.authenticated).toBe(true);
    expect(g!.anon).toBe(false);
  });
});

/**
 * Where the work is, which nothing could record.
 *
 * `estimates.site_address`, `site_city` and `site_state` have existed since
 * migration 0006. `app.award_estimate_version` reads all three and copies them
 * onto the project it creates — which is how a job knows where it is, and what
 * the site forecast needs, because a forecast at the yard is a different claim
 * from one at the site.
 *
 * Nothing had ever written them. Not at creation, not afterwards. Every
 * estimate carried three nulls, so every project awarded from one did too, and
 * the weather panel reported from the yard with no way for anybody to change
 * it. Found by awarding a real estimate and reading the project.
 *
 * The joint these tests hold is the one that was missing: that the site can be
 * recorded, and that it reaches the project.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';

describe('where the work is', () => {
  let h: Harness;
  let mine = '';
  let theirs = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'owner@ridge.test'], [RIVAL, 'rival@other.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    mine = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;
    theirs = (await h.asUser(RIVAL, () => h.sql<{ id: string }>(
      `select app.provision_company('Other Co','other-co','grounup') as id`)))[0]!.id;
  });

  afterAll(async () => { await h?.db.close(); });

  describe('creating one with a site', () => {
    it('takes the address the bid invitation carried', async () => {
      const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `select public.create_estimate('Sandusky transfer station', null, null, null, $1,
                                        null, null,
                                        '1400 Venice Rd', 'Sandusky', 'OH') as id`, [mine]));
      const [e] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select site_address, site_city, site_state from estimates where id = $1`, [r!.id]));
      expect(e!.site_address).toBe('1400 Venice Rd');
      expect(e!.site_city).toBe('Sandusky');
      expect(e!.site_state).toBe('OH');
    });

    it('upper-cases the state, because a forecast is looked up by it', async () => {
      // "oh" and "OH" are not the same string to anything downstream.
      const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `select public.create_estimate('Lower case state', null, null, null, $1,
                                        null, null, null, 'Toledo', '  oh ') as id`, [mine]));
      const [e] = await h.asUser(OWNER, () => h.sql<{ site_state: string }>(
        `select site_state from estimates where id = $1`, [r!.id]));
      expect(e!.site_state).toBe('OH');
    });

    it('leaves them null when nobody says, rather than inventing an empty string', async () => {
      const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `select public.create_estimate('No site yet', null, null, null, $1) as id`, [mine]));
      const [e] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select site_address, site_city, site_state from estimates where id = $1`, [r!.id]));
      expect(e!.site_address).toBeNull();
      expect(e!.site_city).toBeNull();
      expect(e!.site_state).toBeNull();
    });

    it('still creates the first version, which the old signature did', async () => {
      /*
       * The signature was replaced rather than overloaded — 0102's rule, when
       * it did the same thing — so every rule in the body has to still be here.
       */
      const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `select public.create_estimate('With a version', null, null, null, $1,
                                        null, null, null, 'Perrysburg', 'OH') as id`, [mine]));
      const [v] = await h.asUser(OWNER, () => h.sql<{ n: string; current: string | null }>(
        `select count(v.*)::text as n, max(e.current_version_id::text) as current
           from estimate_versions v join estimates e on e.id = v.estimate_id
          where v.estimate_id = $1`, [r!.id]));
      expect(Number(v!.n)).toBe(1);
      expect(v!.current).toBeTruthy();
    });

    it('still refuses an estimate with no name', async () => {
      await expect(h.asUser(OWNER, () => h.sql(
        `select public.create_estimate('x', null, null, null, $1)`, [mine])))
        .rejects.toThrow(/needs a name/);
    });
  });

  describe('setting it afterwards', () => {
    let estimate = '';

    beforeAll(async () => {
      estimate = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `select public.create_estimate('Address arrives later', null, null, null, $1) as id`,
        [mine])))[0]!.id;
    });

    it('records it, because the answer often arrives after the bid does', async () => {
      await h.asUser(OWNER, () => h.sql(
        `select public.set_estimate_site($1, '640 Tyler St', 'Fremont', 'oh')`, [estimate]));
      const [e] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select site_address, site_city, site_state from estimates where id = $1`, [estimate]));
      expect(e!.site_address).toBe('640 Tyler St');
      expect(e!.site_city).toBe('Fremont');
      expect(e!.site_state).toBe('OH');
    });

    it('clears it when the address turns out to be wrong', async () => {
      await h.asUser(OWNER, () => h.sql(
        `select public.set_estimate_site($1, null, null, null)`, [estimate]));
      const [e] = await h.asUser(OWNER, () => h.sql<{ site_address: string | null }>(
        `select site_address from estimates where id = $1`, [estimate]));
      expect(e!.site_address).toBeNull();
    });

    it('refuses once the estimate has gone out', async () => {
      /*
       * Where the work is was part of what was bid. Moving it under an issued
       * price would move the job without moving the number — and the project
       * awarded from it copies this.
       */
      const frozen = await h.asUser(OWNER, async () => {
        const id = (await h.sql<{ id: string }>(
          `select public.create_estimate('Already out', null, null, null, $1) as id`,
          [mine]))[0]!.id;
        await h.asService(() => h.sql(
          `update estimates set status = 'issued' where id = $1`, [id]));
        return id;
      });
      await expect(h.asUser(OWNER, () => h.sql(
        `select public.set_estimate_site($1, 'Too late', 'Nowhere', 'OH')`, [frozen])))
        .rejects.toThrow(/was part of what went out/);
    });

    it('refuses another company’s estimate', async () => {
      await expect(h.asUser(RIVAL, () => h.sql(
        `select public.set_estimate_site($1, 'Not yours', 'Nowhere', 'OH')`, [estimate])))
        .rejects.toThrow();
      expect(theirs).toBeTruthy();
    });

    it('is granted to a signed-in person and to nobody else', async () => {
      const [g] = await h.sql<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated',
                  'public.set_estimate_site(uuid, text, text, text)', 'execute') as authenticated,
                has_function_privilege('anon',
                  'public.set_estimate_site(uuid, text, text, text)', 'execute') as anon`);
      expect(g!.authenticated).toBe(true);
      expect(g!.anon).toBe(false);
    });
  });

  describe('and it reaches the project', () => {
    it('carries the site onto the project the award creates', async () => {
      /*
       * The whole reason the three columns matter, and the thing that was
       * broken: a real award produced a project with a null site, because the
       * estimate it came from had never been asked for one.
       */
      const version = await h.asUser(OWNER, async () => {
        const est = (await h.sql<{ id: string }>(
          `select public.create_estimate('Awarded with a site', null, null, null, $1,
                                          null, null,
                                          '1400 Venice Rd', 'Sandusky', 'OH') as id`,
          [mine]))[0]!.id;
        const v = (await h.sql<{ id: string }>(
          `select current_version_id as id from estimates where id = $1`, [est]))[0]!.id;
        const line = (await h.sql<{ id: string }>(
          `insert into estimate_line_items (company_id, estimate_version_id, description,
                                            measured_quantity, adjusted_quantity, unit, sort_order)
           values ($1,$2,'Mass excavation',12500,12500,'CY',10) returning id`,
          [mine, v]))[0]!.id;
        await h.asService(() => h.sql(
          `select app.record_engine_result($1, 'engine-test', $2::jsonb, $3::jsonb)`,
          [v,
            JSON.stringify({ direct_cost: 44728.91, indirect_cost: 0,
              total_price: 56805.72, bid_price: 56805.72, blocked_from_issue: false }),
            JSON.stringify([{ id: line, adjusted_quantity: 12500,
              total_direct_cost: 44728.91, labor_hours: 201, blocks_issue: false }])]));
        const snap = (await h.sql<{ id: string }>(
          `insert into library_snapshots (company_id, estimate_version_id, engine_version,
                                          entry_count, digest)
           values ($1,$2,'1.0.0',0,'0000000000000000') returning id`, [mine, v]))[0]!.id;
        await h.sql(
          `update estimate_versions set library_snapshot_id = $2, status = 'approved'
            where id = $1`, [v, snap]);
        return v;
      });

      const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
        `select public.award_estimate_version($1,'PRJ-SITE','Sandusky transfer station') as id`,
        [version]));
      const [p] = await h.asUser(OWNER, () => h.sql<Record<string, unknown>>(
        `select site_address, site_city, site_state from projects where id = $1`, [r!.id]));
      expect(p!.site_address).toBe('1400 Venice Rd');
      expect(p!.site_city).toBe('Sandusky');
      expect(p!.site_state).toBe('OH');
    });
  });
});

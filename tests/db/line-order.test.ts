/**
 * A line where you are looking, in the order you want it.
 *
 * `sort_order` has been on every line since migration 0006 and nothing ever
 * wrote it but the append. So a bid could only be built top to bottom, and the
 * sequence a proposal is read in — by somebody deciding whether to award it —
 * was whatever order the estimator happened to think of things.
 *
 * The property worth testing is not that a move changes a number. It is that
 * the order stays a total order after any sequence of moves: no ties, no gaps
 * that run out, and a child never wanders out from under its parent.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('a line where you are looking', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let version = '';
  let service = '';

  const asChief = <T,>(q: string, p?: unknown[]) =>
    h.asUser(chief, () => h.sql<T extends object ? T : never>(q, p));

  const add = (description: string) =>
    asChief<{ id: string }>(
      `select app.add_estimate_line($1,null,$2,1,'CY') as id`, [version, description])
      .then((r) => r[0]!.id);

  const order = () =>
    asChief<{ description: string; sort_order: number }>(
      `select description, sort_order from estimate_line_items
        where estimate_version_id = $1 and parent_line_id is null
        order by sort_order`, [version])
      .then((rows) => rows.map((r) => r.description));

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'chief@ridge.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'chief@ridge.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;

    const [s] = await h.sql<{ id: string }>(
      `select s.id from services s
        join assembly_components ac on ac.assembly_id = s.default_assembly_id
       where s.company_id is null and s.status = 'active' and s.default_unit = 'CY'
       group by s.id limit 1`);
    service = s!.id;

    const e = (await h.asUser(chief, () => h.sql<{ id: string }>(
      `select app.create_estimate('Order', null, null, null, $1) as id`, [company])))[0]!.id;
    version = (await h.asUser(chief, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [e])))[0]!.v;
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  describe('inserting after a line', () => {
    it('puts the new line immediately after the one it was added from', async () => {
      const a = await add('A');
      await add('C');
      await asChief(`select app.insert_estimate_line_after($1,null,'B',5,'CY')`, [a]);
      expect(await order()).toEqual(['A', 'B', 'C']);
    });

    it('takes the library the same way the button at the top does', async () => {
      const first = (await asChief<{ id: string }>(
        `select id from estimate_line_items
          where estimate_version_id = $1 order by sort_order limit 1`, [version]))[0]!.id;
      const id = (await asChief<{ id: string }>(
        `select app.insert_estimate_line_after($1,$2,null,120) as id`, [first, service]))[0]!.id;
      const [line] = await asChief<{ service_id: string; unit: string;
                                    production_rate_id: string | null }>(
        `select service_id, unit, production_rate_id from estimate_line_items where id = $1`, [id]);
      expect(line!.service_id).toBe(service);
      expect(line!.unit).toBe('CY');
      // The library earns its place: a rate came with it, unasked.
      expect(line!.production_rate_id).not.toBeNull();
    });

    it('leaves the order in tens, so there is always room for the next one', async () => {
      const rows = await asChief<{ sort_order: number }>(
        `select sort_order from estimate_line_items
          where estimate_version_id = $1 and parent_line_id is null order by sort_order`, [version]);
      expect(rows.map((r) => Number(r.sort_order)))
        .toEqual(rows.map((_, i) => (i + 1) * 10));
    });

    it('does not run out of room, however many go in the same gap', async () => {
      /*
       * The reason this renumbers instead of choosing a value between two
       * neighbors: fractional insertion runs out after about fifty inserts in
       * one gap, silently, and the line lands somewhere else.
       */
      const anchor = (await asChief<{ id: string }>(
        `select id from estimate_line_items
          where estimate_version_id = $1 and parent_line_id is null
          order by sort_order limit 1`, [version]))[0]!.id;
      for (let i = 0; i < 60; i += 1) {
        await asChief(`select app.insert_estimate_line_after($1,null,$2,1,'CY')`,
          [anchor, `Wedge ${i}`]);
      }
      const rows = await asChief<{ description: string; sort_order: number }>(
        `select description, sort_order from estimate_line_items
          where estimate_version_id = $1 and parent_line_id is null order by sort_order`, [version]);
      // The most recent insert sits directly after the anchor, every time.
      expect(rows[1]!.description).toBe('Wedge 59');
      expect(new Set(rows.map((r) => Number(r.sort_order))).size).toBe(rows.length);
    });
  });

  describe('moving one', () => {
    let a = '', b = '', c = '';

    beforeAll(async () => {
      await h.asUser(chief, () => h.sql(
        `delete from estimate_line_items where estimate_version_id = $1`, [version]));
      a = await add('First');
      b = await add('Second');
      c = await add('Third');
    });

    it('moves a line after another', async () => {
      await asChief(`select app.move_estimate_line($1,$2)`, [a, b]);
      expect(await order()).toEqual(['Second', 'First', 'Third']);
    });

    it('moves a line to the top when nothing is named to follow', async () => {
      await asChief(`select app.move_estimate_line($1,null)`, [c]);
      expect(await order()).toEqual(['Third', 'Second', 'First']);
    });

    it('leaves a total order behind, with no ties', async () => {
      const rows = await asChief<{ sort_order: number }>(
        `select sort_order from estimate_line_items
          where estimate_version_id = $1 and parent_line_id is null`, [version]);
      expect(new Set(rows.map((r) => Number(r.sort_order))).size).toBe(rows.length);
    });

    it('refuses to move a line after itself', async () => {
      await expect(asChief(`select app.move_estimate_line($1,$1)`, [a]))
        .rejects.toThrow(/after itself/i);
    });

    it('refuses to move a line onto another estimate', async () => {
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Elsewhere', null, null, null, $1) as id`,
        [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      const other = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,null,'Theirs',1,'CY') as id`, [v]))[0]!.id;
      await expect(asChief(`select app.move_estimate_line($1,$2)`, [a, other]))
        .rejects.toThrow(/different estimates/i);
    });

    it('will not move a line out from under its parent by reordering', async () => {
      /*
       * A child's parent says what it is part of. Dragging it beside a top
       * level line would change its meaning, not its position, so it is
       * refused with the reason rather than done quietly.
       */
      const child = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,null,'Under first',1,'CY') as id`, [version]))[0]!.id;
      await asChief(`update estimate_line_items set parent_line_id = $2 where id = $1`,
        [child, a]);
      await expect(asChief(`select app.move_estimate_line($1,$2)`, [child, b]))
        .rejects.toThrow(/sits beside/i);
    });

    it('orders children among themselves, independently of the top level', async () => {
      const c1 = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,null,'Child one',1,'CY') as id`, [version]))[0]!.id;
      const c2 = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,null,'Child two',1,'CY') as id`, [version]))[0]!.id;
      await asChief(`update estimate_line_items set parent_line_id = $2 where id in ($1,$3)`,
        [c1, b, c2]);
      await asChief(`select app.move_estimate_line($1,null)`, [c2]);
      const rows = await asChief<{ description: string }>(
        `select description from estimate_line_items
          where parent_line_id = $1 order by sort_order`, [b]);
      expect(rows.map((r) => r.description)).toEqual(['Child two', 'Child one']);
    });
  });

  describe('a version that is no longer open', () => {
    it('refuses both, the way every other edit does', async () => {
      const e = (await asChief<{ id: string }>(
        `select app.create_estimate('Frozen', null, null, null, $1) as id`, [company]))[0]!.id;
      const v = (await asChief<{ v: string }>(
        `select current_version_id as v from estimates where id = $1`, [e]))[0]!.v;
      const line = (await asChief<{ id: string }>(
        `select app.add_estimate_line($1,null,'Only line',1,'CY') as id`, [v]))[0]!.id;
      await h.asService(() => h.sql(
        `update estimate_versions set status = 'archived' where id = $1`, [v]));

      await expect(asChief(`select app.move_estimate_line($1,null)`, [line]))
        .rejects.toThrow(/make a new version/i);
      await expect(asChief(`select app.insert_estimate_line_after($1,null,'Next',1,'CY')`, [line]))
        .rejects.toThrow(/make a new version/i);
    });
  });

  describe('adding several at once', () => {
    let anchor = '';

    beforeAll(async () => {
      await h.asUser(chief, () => h.sql(
        `delete from estimate_line_items where estimate_version_id = $1`, [version]));
      anchor = await add('Anchor');
      await add('Tail');
    });

    it('adds them in the order they were given', async () => {
      await asChief(
        `select app.add_estimate_lines($1, $2::jsonb, $3)`,
        [version, JSON.stringify([
          { description: 'One', unit: 'CY', quantity: 1 },
          { description: 'Two', unit: 'CY', quantity: 2 },
          { description: 'Three', unit: 'CY', quantity: 3 },
        ]), anchor]);
      expect(await order()).toEqual(['Anchor', 'One', 'Two', 'Three', 'Tail']);
    });

    it('hands back the ids in the same order, so a caller can match its own list', async () => {
      const [r] = await asChief<{ ids: string[] }>(
        `select app.add_estimate_lines($1, $2::jsonb, null) as ids`,
        [version, JSON.stringify([
          { description: 'Alpha', unit: 'CY' },
          { description: 'Beta', unit: 'CY' },
        ])]);
      expect(r!.ids).toHaveLength(2);
      const rows = await asChief<{ description: string }>(
        `select description from estimate_line_items where id = any($1)
          order by array_position($1, id)`, [r!.ids]);
      expect(rows.map((x) => x.description)).toEqual(['Alpha', 'Beta']);
    });

    it('takes the library exactly as a single addition does', async () => {
      const [r] = await asChief<{ ids: string[] }>(
        `select app.add_estimate_lines($1, $2::jsonb, null) as ids`,
        [version, JSON.stringify([{ service_id: service, quantity: 500 }])]);
      const [line] = await asChief<{ service_id: string; unit: string;
                                    production_rate_id: string | null; description: string }>(
        `select service_id, unit, production_rate_id, description
           from estimate_line_items where id = $1`, [r!.ids[0]]);
      expect(line!.service_id).toBe(service);
      expect(line!.unit).toBe('CY');
      expect(line!.production_rate_id).not.toBeNull();
      expect(line!.description.length).toBeGreaterThan(0);
    });

    it('adds none of them when one is impossible', async () => {
      /*
       * One transaction, so a selection is added completely or not at all. Half
       * an addition is worse than none: it looks like a whole one.
       */
      const before = (await order()).length;
      await expect(asChief(
        `select app.add_estimate_lines($1, $2::jsonb, null)`,
        [version, JSON.stringify([
          { description: 'Good one', unit: 'CY' },
          { service_id: '00000000-0000-4000-8000-00000000dead' },
        ])])).rejects.toThrow(/not in your library/i);
      expect((await order()).length).toBe(before);
    });

    it('accepts an empty list without inventing anything', async () => {
      const before = (await order()).length;
      const [r] = await asChief<{ ids: string[] }>(
        `select app.add_estimate_lines($1, '[]'::jsonb, null) as ids`, [version]);
      expect(r!.ids).toEqual([]);
      expect((await order()).length).toBe(before);
    });

    it('refuses a list that is not a list', async () => {
      await expect(asChief(
        `select app.add_estimate_lines($1, '"nope"'::jsonb, null)`, [version]))
        .rejects.toThrow(/as a list/i);
    });

    it('refuses more than one addition should carry', async () => {
      const many = JSON.stringify(
        Array.from({ length: 201 }, (_, i) => ({ description: `L${i}`, unit: 'CY' })));
      await expect(asChief(
        `select app.add_estimate_lines($1, $2::jsonb, null)`, [version, many]))
        .rejects.toThrow(/more lines than one addition/i);
    });

    it('leaves the order in tens afterwards', async () => {
      const rows = await asChief<{ sort_order: number }>(
        `select sort_order from estimate_line_items
          where estimate_version_id = $1 and parent_line_id is null order by sort_order`,
        [version]);
      expect(rows.map((r) => Number(r.sort_order)))
        .toEqual(rows.map((_, i) => (i + 1) * 10));
    });
  });

});

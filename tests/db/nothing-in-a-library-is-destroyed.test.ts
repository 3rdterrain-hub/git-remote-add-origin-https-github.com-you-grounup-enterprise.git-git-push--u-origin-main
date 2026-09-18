/**
 * Nothing in a library is destroyed.
 *
 * The owner: "I accidentally deleted excavation crew A." It had not been
 * deleted — `retireCrew` archives — so the crew and both its members were still
 * there. But nothing on screen said so, archived rows vanished from the list,
 * and there was no way back. A delete you cannot undo and a delete you *believe*
 * you cannot undo cost the same in the moment.
 *
 * Their instruction: keep archiving, and put it on every library.
 *
 * The refusal worth most here is the shipped row. A company archiving a row
 * GrounUp ships would be hiding it from every other company on the platform.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f';

describe('nothing in a library is destroyed', () => {
  let h: Harness;
  let company = '';
  let crew = '';
  let material = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const statusOf = (table: string, id: string) =>
    asOwner(() => h.sql<{ status: string }>(
      `select status from ${table} where id = $1`, [id])).then((r) => r[0]?.status ?? null);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [OWNER, 'o@arch.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [OWNER, 'o@arch.test']);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Archive Civil','archive-civil','enterprise') as id`)))[0]!.id;

    crew = (await asOwner(() => h.sql<{ id: string }>(
      `insert into crews (company_id, code, name, discipline, shift_hours, approved_by, approved_at)
       values ($1,'CRW-EXCA','Excavation Crew A','Earthwork',10,$2,now()) returning id`,
      [company, OWNER])))[0]!.id;
    material = (await asOwner(() => h.sql<{ id: string }>(
      `insert into materials (company_id, code, name, unit, approved_by, approved_at)
       values ($1,'MAT-STONE','Crushed stone','TON',$2,now()) returning id`,
      [company, OWNER])))[0]!.id;
  }, 180_000);

  describe('putting something away, and getting it back', () => {
    it('archives a crew rather than destroying it', async () => {
      await asOwner(() => h.sql(`select public.set_library_status('crew',$1,'archived')`, [crew]));
      expect(await statusOf('crews', crew)).toBe('archived');
      /* The row is still there — which is the whole point. */
      const [row] = await asOwner(() => h.sql<{ name: string }>(
        `select name from crews where id = $1`, [crew]));
      expect(row!.name).toBe('Excavation Crew A');
    });

    it('brings it back through the same door', async () => {
      await asOwner(() => h.sql(`select public.set_library_status('crew',$1,'active')`, [crew]));
      expect(await statusOf('crews', crew)).toBe('active');
    });

    it('works the same way on a library that never had the action at all', async () => {
      /* Materials was one of the ten tabs with no archive door of any kind. */
      await asOwner(() => h.sql(`select public.set_library_status('material',$1,'archived')`, [material]));
      expect(await statusOf('materials', material)).toBe('archived');
      await asOwner(() => h.sql(`select public.set_library_status('material',$1,'active')`, [material]));
      expect(await statusOf('materials', material)).toBe('active');
    });

    it('answers with the status it set, so a screen need not re-read', async () => {
      const [{ set }] = await asOwner(() => h.sql<{ set: string }>(
        `select public.set_library_status('crew',$1,'archived') as set`, [crew]));
      expect(set).toBe('archived');
      await asOwner(() => h.sql(`select public.set_library_status('crew',$1,'active')`, [crew]));
    });
  });

  describe('what it refuses', () => {
    it('will not archive a row GrounUp ships, and says what to do instead', async () => {
      /*
       * The one that matters. A shipped row belongs to every company on the
       * platform — archiving it for this one would hide it from all of them.
       */
      const [{ id }] = await asOwner(() => h.sql<{ id: string }>(
        `select id from services where company_id is null limit 1`));
      await expect(asOwner(() => h.sql(
        `select public.set_library_status('service',$1,'archived')`, [id])))
        .rejects.toThrow(/shipped with GrounUp and is shared by every company/);
    });

    it('offers no status other than archived and active', async () => {
      for (const status of ['retired', 'draft', 'inactive', 'deleted']) {
        await expect(asOwner(() => h.sql(
          `select public.set_library_status('crew',$1,$2)`, [crew, status])))
          .rejects.toThrow(/archived or active/);
      }
      /* Nothing moved while all four were refused. */
      expect(await statusOf('crews', crew)).toBe('active');
    });

    it('refuses a library that does not exist rather than doing nothing quietly', async () => {
      await expect(asOwner(() => h.sql(
        `select public.set_library_status('spaceship',$1,'archived')`, [crew])))
        .rejects.toThrow(/no library called spaceship/i);
    });

    it('will not touch another company’s row', async () => {
      const other = '6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a';
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [other, 'x@arch.test']);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [other, 'x@arch.test']);
      await h.asUser(other, () => h.sql(
        `select app.provision_company('Rival Archive','rival-archive','enterprise')`));

      await expect(h.asUser(other, () => h.sql(
        `select public.set_library_status('crew',$1,'archived')`, [crew])))
        .rejects.toThrow(/No such row/);
      expect(await statusOf('crews', crew)).toBe('active');
    });
  });
});

/**
 * A shipped row you can put out of the way.
 *
 * 0217 refused to archive a shipped row and was right to: it belongs to every
 * company on the platform. The consequence did not survive a real library —
 * 333 of 333 materials and 2,143 of 2,190 production rates are shipped, so the
 * control rendered on almost nothing and the owner would have been looking at
 * the same screen that prompted "none of them have delete buttons".
 *
 * So a company can decide a shipped row is not part of *its* library. The row
 * is untouched; the decision is recorded beside it, per company.
 */
describe('a shipped row put out of one company’s way', () => {
  let h2: Harness;
  let mine = '';
  let theirs = '';
  let shipped = '';
  const ME = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';
  const THEM = '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c';

  beforeAll(async () => {
    h2 = await createHarness({ seed: true });
    for (const [id, email] of [[ME, 'me@hide.test'], [THEM, 'them@hide.test']]) {
      await h2.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h2.sql(`insert into user_profiles (id, email) values ($1,$2)
                    on conflict (id) do nothing`, [id, email]);
    }
    mine = (await h2.asUser(ME, () => h2.sql<{ id: string }>(
      `select app.provision_company('Hide Civil','hide-civil','enterprise') as id`)))[0]!.id;
    theirs = (await h2.asUser(THEM, () => h2.sql<{ id: string }>(
      `select app.provision_company('Other Hide','other-hide','enterprise') as id`)))[0]!.id;
    shipped = (await h2.asUser(ME, () => h2.sql<{ id: string }>(
      `select id from services where company_id is null limit 1`)))[0]!.id;
  }, 180_000);

  const hiddenFor = (user: string) => h2.asUser(user, () => h2.sql<{ row_id: string }>(
    `select row_id from my_hidden_library_rows where kind = 'service'`));

  it('hides it for the company that asked, and nobody else', async () => {
    await h2.asUser(ME, () => h2.sql(
      `select public.hide_library_row($1,'service',$2,true)`, [mine, shipped]));

    expect((await hiddenFor(ME)).map((r) => r.row_id)).toEqual([shipped]);
    /* The other company's library is untouched — which is the whole point. */
    expect(await hiddenFor(THEM)).toEqual([]);
  });

  it('changes nothing about the row itself', async () => {
    const [row] = await h2.asUser(ME, () => h2.sql<{ status: string; company_id: string | null }>(
      `select status, company_id from services where id = $1`, [shipped]));
    expect(row!.status).toBe('active');
    expect(row!.company_id).toBeNull();
  });

  it('brings it back through the same door', async () => {
    await h2.asUser(ME, () => h2.sql(
      `select public.hide_library_row($1,'service',$2,false)`, [mine, shipped]));
    expect(await hiddenFor(ME)).toEqual([]);
  });

  it('hiding twice is not an error, and does not record it twice', async () => {
    for (let i = 0; i < 2; i += 1) {
      await h2.asUser(ME, () => h2.sql(
        `select public.hide_library_row($1,'service',$2,true)`, [mine, shipped]));
    }
    expect(await hiddenFor(ME)).toHaveLength(1);
  });

  it('will not let one company hide a row on another’s behalf', async () => {
    await expect(h2.asUser(THEM, () => h2.sql(
      `select public.hide_library_row($1,'service',$2,true)`, [mine, shipped])))
      .rejects.toThrow(/No such company|permission/i);
  });
});

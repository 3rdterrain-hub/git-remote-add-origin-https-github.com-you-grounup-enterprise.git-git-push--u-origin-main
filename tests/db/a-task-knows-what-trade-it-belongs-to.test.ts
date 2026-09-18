/**
 * A task knows what trade it belongs to.
 *
 * The owner, looking at the Tasks tab: "what is task category showing." It was
 * showing `Support` for 7,161 of 8,532 tasks and `Production` for the rest —
 * a real distinction, and the wrong one to navigate by. Nothing on a task said
 * which trade it was.
 *
 * The trade is not typed onto the row. It is read from the services whose
 * build-ups use the task, because that relationship is already in the catalog
 * and inventing 8,532 trades would be the largest invented-data exercise in
 * this repository.
 *
 * The tests that matter are the refusals: a task used by two trades is given
 * neither, and a task used by none is given nothing. An alphabetically-first
 * guess would be a figure nobody could check.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d';

interface TaskView {
  code: string;
  trade: string | null;
  trade_certainty: string;
  services_using: number;
}

describe('a task knows what trade it belongs to', () => {
  let h: Harness;
  let company = '';

  const asOwner = <T>(fn: () => Promise<T>) => h.asUser(OWNER, fn);
  const task = (code: string) => asOwner(() => h.sql<TaskView>(
    `select code, trade, trade_certainty, services_using
       from my_library_tasks where code = $1`, [code])).then((r) => r[0]!);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [OWNER, 'o@trade.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [OWNER, 'o@trade.test']);
    company = (await asOwner(() => h.sql<{ id: string }>(
      `select app.provision_company('Trade Civil','trade-civil','enterprise') as id`)))[0]!.id;

    /*
     * Three tasks and two assemblies, arranged so each case the view has to
     * decide is present: one trade, two trades, and no service at all.
     *
     * Every row carries an approver: 0028 refuses an active company-owned
     * library row that does not name who made it live, and a fixture that
     * works around a governance rule is a fixture testing a different schema.
     */
    await asOwner(() => h.sql(`
      insert into tasks (company_id, code, name, default_unit, category, approved_by, approved_at)
      values ($1,'T-DIG','Trench excavation','LF','Production',$2,now()),
             ($1,'T-BOTH','Cleanup','HR','Support',$2,now()),
             ($1,'T-ORPHAN','Something nobody builds on','EA','Support',$2,now())`,
      [company, OWNER]));

    await asOwner(() => h.sql(`
      insert into assemblies (company_id, code, name, quantity_unit, approved_by, approved_at)
      values ($1,'A-EARTH','Earthwork build-up','LF',$2,now()),
             ($1,'A-MEP','Mechanical build-up','EA',$2,now())`, [company, OWNER]));

    await asOwner(() => h.sql(`
      insert into assembly_components (company_id, assembly_id, component_kind, task_id, quantity_per_unit, unit)
      select $1, a.id, 'task', t.id, 1, t.default_unit
        from assemblies a, tasks t
       where a.company_id = $1 and t.company_id = $1
         and ((a.code = 'A-EARTH' and t.code in ('T-DIG','T-BOTH'))
           or (a.code = 'A-MEP'   and t.code = 'T-BOTH'))`, [company]));

    /*
     * The two trades, registered before use. 0113 refuses a category that is
     * not one of the company's options — categories are a list somebody
     * maintains, not free text, which is what keeps one name for one thing.
     */
    for (const trade of ['Site, Civil & Transportation', 'MEP & Systems',
      'Building Shell & Structure']) {
      await asOwner(() => h.sql(
        `select app.add_library_category('service_category', $1, null, $2)`, [trade, company]));
    }

    /* One service per assembly, in two different categories. */
    await asOwner(() => h.sql(`
      insert into services (company_id, code, name, default_unit, supported_units, category, default_assembly_id, approved_by, approved_at)
      select $1,'SVC-EARTH','Mass excavation','LF',array['LF']::app.unit_code[],'Site, Civil & Transportation', a.id, $2, now()
        from assemblies a where a.company_id = $1 and a.code = 'A-EARTH'`, [company, OWNER]));
    await asOwner(() => h.sql(`
      insert into services (company_id, code, name, default_unit, supported_units, category, default_assembly_id, approved_by, approved_at)
      select $1,'SVC-MEP','Duct rough-in','EA',array['EA']::app.unit_code[],'MEP & Systems', a.id, $2, now()
        from assemblies a where a.company_id = $1 and a.code = 'A-MEP'`, [company, OWNER]));
  }, 180_000);

  it('takes the trade from the service that builds on it', async () => {
    const t = await task('T-DIG');
    expect(t.trade).toBe('Site, Civil & Transportation');
    expect(t.trade_certainty).toBe('derived');
    expect(Number(t.services_using)).toBe(1);
  });

  it('names no trade for a task two trades both use', async () => {
    /*
     * Cleanup sits in an earthwork build-up and a mechanical one. Either answer
     * would be as true as the other, so the view gives neither and says why.
     */
    const t = await task('T-BOTH');
    expect(t.trade).toBeNull();
    expect(t.trade_certainty).toBe('ambiguous');
    expect(Number(t.services_using)).toBe(2);
  });

  it('names no trade for a task no service builds on', async () => {
    const t = await task('T-ORPHAN');
    expect(t.trade).toBeNull();
    expect(t.trade_certainty).toBe('unused');
    expect(Number(t.services_using)).toBe(0);
  });

  it('follows the service when the catalog is rearranged, because nothing is stored', async () => {
    /*
     * The reason this is a view. A stored trade would be right the day it was
     * written and wrong the first time somebody moved a task, with nothing to
     * notice — the same reasoning that makes every total here recomputed rather
     * than incremented.
     */
    await asOwner(() => h.sql(
      `update services set category = 'Building Shell & Structure' where code = 'SVC-EARTH'`));
    expect((await task('T-DIG')).trade).toBe('Building Shell & Structure');

    await asOwner(() => h.sql(
      `update services set category = 'Site, Civil & Transportation' where code = 'SVC-EARTH'`));
    expect((await task('T-DIG')).trade).toBe('Site, Civil & Transportation');
  });

  it('keeps every task, whether or not a trade could be found', async () => {
    const [{ view, table }] = await asOwner(() => h.sql<{ view: number; table: number }>(
      `select (select count(*) from my_library_tasks) as view,
              (select count(*) from tasks) as table`));
    expect(Number(view)).toBe(Number(table));
  });

  it('leaves the kind alone — production and support are a different fact', async () => {
    const [row] = await asOwner(() => h.sql<{ category: string }>(
      `select category from my_library_tasks where code = 'T-DIG'`));
    expect(row!.category).toBe('Production');
  });

  it('shows a company only the tasks it may already read', async () => {
    const other = '4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e';
    await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [other, 'x@trade.test']);
    await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                 on conflict (id) do nothing`, [other, 'x@trade.test']);
    await h.asUser(other, () => h.sql(
      `select app.provision_company('Rival Trade','rival-trade','enterprise')`));

    const theirs = await h.asUser(other, () => h.sql<TaskView>(
      `select code, trade, trade_certainty, services_using
         from my_library_tasks where code in ('T-DIG','T-BOTH','T-ORPHAN')`));
    expect(theirs).toHaveLength(0);
  });
});

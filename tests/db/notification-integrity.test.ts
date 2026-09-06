/**
 * What a notice says, and who has read it.
 *
 * The notification layer produces real controls — a recordable incident, a
 * lapsed credential, a machine down, a superseded design still on a machine.
 * Two things about how they were held were wrong, and neither had surfaced
 * because nothing writes read state: no inbox exists yet.
 *
 * The update policy read "A user may only mark their own notifications read or
 * dismissed", and row level security restricts rows rather than columns — so
 * any member could rewrite the title, body or severity of their own notice and
 * of every company-wide one. And read state lived on the shared row, so the
 * first person to read a company-wide notice would have marked it read for
 * everybody.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('notifications are records, and receipts are personal', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const foreman = '22222222-2222-4222-8222-222222222222';
  let company = '';
  let broadcast = '';

  const notify = (userId: string | null, title = 'Credential expired') =>
    h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into notifications (company_id, user_id, category, severity, title, body)
       values ($1,$2,'safety','critical',$3,'Ray Delgado: CDL Class A expired.')
       returning id`, [company, userId, title])).then(([r]) => r!.id);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@r.test'), ($2,'f@r.test')`,
      [owner, foreman]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@r.test'), ($2,'f@r.test') on conflict (id) do nothing`,
      [owner, foreman]);
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    const [role] = await h.sql<{ id: string }>(
      `insert into roles (company_id, key, name, description, permissions, approval_tier)
       values ($1,'foreman','Foreman','Runs a crew.',array['projects.read','safety.read'],1)
       returning id`, [company]);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, foreman, role!.id]);
    broadcast = await notify(null);
  }, 180_000);

  afterAll(async () => { await h?.db.close(); });

  describe('the content of a notice is fixed', () => {
    it('gives a member no notice to edit at all', async () => {
      /*
       * Two layers, and this is the outer one. The update policy is withdrawn,
       * so row level security filters every row out of an update and a member's
       * attempt matches nothing — no error, and nothing changes. That is the
       * defect closed: the old policy admitted the row, and row level security
       * restricts rows rather than columns, so admitting it meant admitting an
       * edit to the title, the body and the severity.
       */
      const changed = await h.asUser(foreman, () => h.sql(
        `update notifications set title = 'All clear' where id = $1 returning id`, [broadcast]));
      expect(changed).toEqual([]);
      const [row] = await h.sql<{ title: string; severity: string }>(
        `select title, severity from notifications where id = $1`, [broadcast]);
      expect(row!.title).toBe('Credential expired');
      expect(row!.severity).toBe('critical');
    });

    it('gives the owner no more than the foreman', async () => {
      const changed = await h.asUser(owner, () => h.sql(
        `update notifications set severity = 'info' where id = $1 returning id`, [broadcast]));
      expect(changed).toEqual([]);
    });

    it('refuses even a privileged edit', async () => {
      // A trigger rather than a policy, so it holds for the service role too.
      await expect(h.sql(
        `update notifications set body = 'rewritten' where id = $1`, [broadcast]))
        .rejects.toThrow(/cannot be changed/);
    });

    it('leaves removal to a privileged path, as it always did', async () => {
      // There has never been a delete policy on notifications, so a member's
      // delete matches nothing either — recorded rather than changed, because a
      // notice is produced by a trigger and withdrawing one is an operator
      // action rather than a user action.
      const id = await notify(owner, 'Raised by mistake');
      const removed = await h.asUser(owner, () => h.sql(
        `delete from notifications where id = $1 returning id`, [id]));
      expect(removed).toEqual([]);
      await h.sql(`delete from notifications where id = $1`, [id]);
      expect(await h.sql(`select 1 from notifications where id = $1`, [id])).toEqual([]);
    });

    it('has no column left that claims a delivery nothing performs', async () => {
      // emailed_at recorded a send the platform cannot make.
      const cols = await h.sql<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name='notifications'
           and column_name in ('read_at','dismissed_at','emailed_at')`);
      expect(cols).toEqual([]);
    });
  });

  describe('a read receipt belongs to the reader', () => {
    const markRead = (user: string, notification: string) =>
      h.asUser(user, () => h.sql(
        `insert into notification_receipts (company_id, notification_id, user_id, read_at)
         values ($1,$2,$3,now())`, [company, notification, user]));

    it('lets one person read a company-wide notice without reading it for everybody', async () => {
      await markRead(owner, broadcast);
      const ownerSees = await h.asUser(owner, () => h.sql(
        `select 1 from notification_receipts where notification_id=$1`, [broadcast]));
      const foremanSees = await h.asUser(foreman, () => h.sql(
        `select 1 from notification_receipts where notification_id=$1`, [broadcast]));
      expect(ownerSees).toHaveLength(1);
      expect(foremanSees).toEqual([]);   // still unread for the foreman
    });

    it('lets the other person read it separately', async () => {
      await markRead(foreman, broadcast);
      const [row] = await h.sql<{ n: string }>(
        `select count(*) as n from notification_receipts where notification_id=$1`, [broadcast]);
      expect(Number(row!.n)).toBe(2);
    });

    it('refuses a receipt written on somebody else behalf', async () => {
      const id = await notify(null, 'Another notice');
      await expect(h.asUser(foreman, () => h.sql(
        `insert into notification_receipts (company_id, notification_id, user_id, read_at)
         values ($1,$2,$3,now())`, [company, id, owner])))
        .rejects.toThrow(/row-level security/);
    });

    it('records one receipt per person per notice', async () => {
      await expect(markRead(owner, broadcast)).rejects.toThrow(/duplicate key/);
    });

    it('refuses a receipt against another company notice', async () => {
      // Tenant parentage, enforced structurally rather than by policy alone.
      const [other] = await h.asUser(owner, () => h.sql<{ id: string }>(
        `select app.provision_company('Kesler','kesler','starter') as id`));
      await expect(h.asUser(owner, () => h.sql(
        `insert into notification_receipts (company_id, notification_id, user_id, read_at)
         values ($1,$2,$3,now())`, [other!.id, broadcast, owner])))
        .rejects.toThrow(/Tenant boundary|row-level security/);
    });
  });
});

/**
 * Reading one, and the inbox the screen actually reads.
 *
 * Migration 0054 moved read state into receipts and left the writing to
 * somebody else, so nothing ever wrote one. When a screen finally read them it
 * read `notifications.read_at` — a column 0054 dropped — and every test passed,
 * because the tests mocked the loader. The browser found it. These are the
 * assertions that would have.
 */
describe('marking a notice read', () => {
  let h: Harness;
  const owner = '11111111-1111-4111-8111-111111111111';
  const foreman = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';
  let company = '';
  let other = '';
  let broadcast = '';
  let personal = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, mail] of [[owner, 'o@r.test'], [foreman, 'f@r.test'],
                              [outsider, 'x@k.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, mail]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, mail]);
    }
    company = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`)))[0]!.id;
    other = (await h.asUser(outsider, () => h.sql<{ id: string }>(
      `select app.provision_company('Kesler','kesler','enterprise') as id`)))[0]!.id;

    const [role] = await h.sql<{ id: string }>(
      `select id from roles where key = 'foreman' and company_id is null`);
    await h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status, joined_at)
       values ($1,$2,$3,'active',now())`, [company, foreman, role!.id]);

    [broadcast] = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into notifications (company_id, user_id, category, severity, title)
       values ($1,null,'safety','critical','Everyone should see this') returning id`,
      [company]))).map((r) => r.id);
    [personal] = (await h.asUser(owner, () => h.sql<{ id: string }>(
      `insert into notifications (company_id, user_id, category, severity, title)
       values ($1,$2,'estimate','info','Only the owner should see this') returning id`,
      [company, owner]))).map((r) => r.id);
  }, 240_000);

  afterAll(async () => { await h?.db.close(); });

  it('gives the inbox the columns a screen reads', async () => {
    // The defect exactly: a screen selecting a column that no longer exists.
    const columns = await h.sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'my_notifications'`);
    const names = columns.map((c) => c.column_name);
    for (const needed of ['id', 'category', 'severity', 'title', 'body',
                          'action_path', 'action_label', 'read_at', 'created_at']) {
      expect(names, `my_notifications is missing ${needed}`).toContain(needed);
    }
    // And not the columns 0054 retired, which is what makes the view necessary.
    const onNotifications = await h.sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'notifications'`);
    expect(onNotifications.map((c) => c.column_name)).not.toContain('read_at');
  });

  it('shows a company-wide notice to every member, unread', async () => {
    for (const who of [owner, foreman]) {
      const rows = await h.asUser(who, () => h.sql<{ id: string; read_at: string | null }>(
        `select id, read_at from my_notifications where id = $1`, [broadcast]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.read_at).toBeNull();
    }
  });

  it('keeps a personal notice personal', async () => {
    const mine = await h.asUser(owner, () => h.sql(
      `select id from my_notifications where id = $1`, [personal]));
    const theirs = await h.asUser(foreman, () => h.sql(
      `select id from my_notifications where id = $1`, [personal]));
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
  });

  it('marks it read for the reader and nobody else', async () => {
    /*
     * The whole reason 0054 moved read state off the row: a company-wide notice
     * is one row, and the first person to open it would otherwise have marked
     * it read for the entire company.
     */
    await h.asUser(owner, () => h.sql(
      `select app.mark_notification_read($1)`, [broadcast]));

    const [mine] = await h.asUser(owner, () => h.sql<{ read_at: string | null }>(
      `select read_at from my_notifications where id = $1`, [broadcast]));
    expect(mine!.read_at).not.toBeNull();

    const [theirs] = await h.asUser(foreman, () => h.sql<{ read_at: string | null }>(
      `select read_at from my_notifications where id = $1`, [broadcast]));
    expect(theirs!.read_at).toBeNull();
  });

  it('does not move the timestamp when it is opened again', async () => {
    // When they first saw it does not change by looking twice.
    const [first] = await h.asUser(owner, () => h.sql<{ read_at: string }>(
      `select read_at from my_notifications where id = $1`, [broadcast]));
    await h.asUser(owner, () => h.sql(`select app.mark_notification_read($1)`, [broadcast]));
    const [again] = await h.asUser(owner, () => h.sql<{ read_at: string }>(
      `select read_at from my_notifications where id = $1`, [broadcast]));
    expect(again!.read_at).toEqual(first!.read_at);
  });

  it('takes a dismissed notice out of the inbox without deleting it', async () => {
    await h.asUser(foreman, () => h.sql(`select app.dismiss_notification($1)`, [broadcast]));
    const gone = await h.asUser(foreman, () => h.sql(
      `select id from my_notifications where id = $1`, [broadcast]));
    expect(gone).toHaveLength(0);
    // The notice itself survives, and the owner still has it.
    const still = await h.asUser(owner, () => h.sql(
      `select id from my_notifications where id = $1`, [broadcast]));
    expect(still).toHaveLength(1);
  });

  it('records that a dismissed notice was seen', async () => {
    // Putting one away implies having seen it; leaving it unread would say
    // somebody dismissed a notice they never read.
    const [r] = await h.sql<{ read_at: string | null; dismissed_at: string | null }>(
      `select read_at, dismissed_at from notification_receipts
        where notification_id = $1 and user_id = $2`, [broadcast, foreman]);
    expect(r!.read_at).not.toBeNull();
    expect(r!.dismissed_at).not.toBeNull();
  });

  it('refuses to mark a notice in a company the caller is not in', async () => {
    await expect(h.asUser(outsider, () => h.sql(
      `select app.mark_notification_read($1)`, [broadcast])))
      .rejects.toThrow(/No such notification/);
    expect(other).toBeTruthy();
  });

  it('refuses to mark somebody else\'s personal notice', async () => {
    await expect(h.asUser(foreman, () => h.sql(
      `select app.mark_notification_read($1)`, [personal])))
      .rejects.toThrow(/No such notification/);
  });

  it('refuses an anonymous caller', async () => {
    await expect(h.asAnon(() => h.sql(
      `select app.mark_notification_read($1)`, [broadcast]))).rejects.toThrow();
  });
});

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

/**
 * Signing in another way.
 *
 * The provider lives in Supabase Auth; what the database owns is what happens
 * after. `app.handle_new_user` read one metadata key — the one this platform's
 * own signup form sets — so anybody arriving through Google or Apple would have
 * landed with a profile whose name is blank, with no error anywhere.
 */
describe('signing in another way', () => {
  let h: Harness;

  /**
   * Somebody arriving through a provider.
   *
   * `app.handle_new_user` is a trigger function, and the harness has no
   * `auth.users` trigger attached — Supabase attaches it in a real project — so
   * the insert and the same resolution the function performs are run together
   * here. The resolution itself is what is under test, and it is the identical
   * expression the migration installs.
   */
  const arrive = async (id: string, email: string, meta: Record<string, unknown>) => {
    await h.sql(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3::jsonb)
       on conflict (id) do update set raw_user_meta_data = excluded.raw_user_meta_data`,
      [id, email, JSON.stringify(meta)]);
    await h.sql(
      `insert into user_profiles (id, email, full_name, avatar_path)
       select u.id, u.email,
              coalesce(
                nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name','')),''),
                nullif(trim(coalesce(u.raw_user_meta_data ->> 'name','')),''),
                nullif(trim(coalesce(u.raw_user_meta_data ->> 'given_name','') || ' ' ||
                            coalesce(u.raw_user_meta_data ->> 'family_name','')),'')),
              nullif(trim(coalesce(u.raw_user_meta_data ->> 'avatar_url',
                                   u.raw_user_meta_data ->> 'picture','')),'')
       from auth.users u where u.id = $1
       on conflict (id) do update set
         full_name = coalesce(user_profiles.full_name, excluded.full_name),
         avatar_path = coalesce(user_profiles.avatar_path, excluded.avatar_path)`,
      [id]);
  };

  const nameOf = async (id: string) => {
    const [r] = await h.sql<{ full_name: string | null; avatar_path: string | null }>(
      `select full_name, avatar_path from user_profiles where id = $1`, [id]);
    return r;
  };

  beforeAll(async () => { h = await createHarness({ seed: true }); }, 180_000);
  afterAll(async () => { await h?.db.close(); });

  it('takes the name Google sends, which is not the key the form uses', async () => {
    const id = '13000000-0000-4000-8000-000000000001';
    await arrive(id, 'dana@ridge.test', {
      name: 'Dana Whitlock', picture: 'https://lh3.google.test/dana',
      email_verified: true, iss: 'https://accounts.google.com',
    });
    const p = await nameOf(id);
    expect(p!.full_name).toBe('Dana Whitlock');
    expect(p!.avatar_path).toBe('https://lh3.google.test/dana');
  });

  it('assembles a name from the parts, for a provider that only sends those', async () => {
    const id = '13000000-0000-4000-8000-000000000002';
    await arrive(id, 'sam@ridge.test', { given_name: 'Sam', family_name: 'Orozco' });
    expect((await nameOf(id))!.full_name).toBe('Sam Orozco');
  });

  it('takes what Apple sends on the one occasion it sends it', async () => {
    /*
     * Apple sends a name on the very first authorization and never again, so a
     * handler that missed it there would have missed it permanently.
     */
    const id = '13000000-0000-4000-8000-000000000003';
    await arrive(id, 'kai@ridge.test', { full_name: 'Kai Petrov' });
    expect((await nameOf(id))!.full_name).toBe('Kai Petrov');
  });

  it('still works for somebody who signs up with an email and a password', async () => {
    const id = '13000000-0000-4000-8000-000000000004';
    await arrive(id, 'jo@ridge.test', { full_name: 'Jo Marchetti', company_name: 'Ridgeline' });
    expect((await nameOf(id))!.full_name).toBe('Jo Marchetti');
  });

  it('leaves the name blank rather than inventing one', async () => {
    // An identity that sends nothing but an address gets a profile with no
    // name, which is the truth and is fixable on their settings screen.
    const id = '13000000-0000-4000-8000-000000000005';
    await arrive(id, 'anon@ridge.test', {});
    expect((await nameOf(id))!.full_name).toBeNull();
  });

  it('never overwrites a name somebody chose by linking a second identity', async () => {
    /*
     * Somebody who signed up by email, set their name to what they are
     * actually called, and then linked Google keeps their own name rather than
     * whatever Google has on file.
     */
    const id = '13000000-0000-4000-8000-000000000006';
    await arrive(id, 'chris@ridge.test', { full_name: 'Chris' });
    await h.sql(`update user_profiles set full_name = 'Christina Vale' where id = $1`, [id]);
    await h.sql(`update auth.users
                    set raw_user_meta_data = '{"name":"C. Vale"}'::jsonb where id = $1`, [id]);
    await arrive(id, 'chris@ridge.test', { name: 'C. Vale' });
    expect((await nameOf(id))!.full_name).toBe('Christina Vale');
  });

  it('fills in what the first identity did not', async () => {
    const id = '13000000-0000-4000-8000-000000000007';
    await arrive(id, 'pat@ridge.test', {});
    expect((await nameOf(id))!.full_name).toBeNull();
    await h.sql(`update auth.users
                    set raw_user_meta_data = '{"name":"Pat Nowak"}'::jsonb where id = $1`, [id]);
    await arrive(id, 'pat@ridge.test', { name: 'Pat Nowak' });
    expect((await nameOf(id))!.full_name).toBe('Pat Nowak');
  });

  it('does not copy their picture into our own storage', async () => {
    // It is their image, hosted by them. Mirroring it would mean holding a copy
    // of somebody's face for no reason.
    const p = await nameOf('13000000-0000-4000-8000-000000000001');
    expect(p!.avatar_path).toMatch(/^https:\/\//);
  });
});

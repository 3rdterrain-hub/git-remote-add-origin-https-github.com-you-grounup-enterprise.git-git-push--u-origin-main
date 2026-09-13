/**
 * Saying something to somebody, on the record it is about.
 *
 * Nothing in this platform let one person address another. There were
 * notifications (the system speaking), announcements (a super admin speaking),
 * outbound email and conversations with an agent. A foreman could not ask the
 * office a question.
 *
 * Built as comments on records rather than an inbox, and these hold the two
 * reasons why: a comment is bound to the thing it is about and cannot be
 * orphaned from it, and it inherits that thing's sensitivity rather than being
 * visible to whoever happens to be a member.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '55555555-5555-4555-8555-555555555555';
const FOREMAN = '66666666-6666-4666-8666-666666666666';

describe('comments on the record they are about', () => {
  let h: Harness;
  let company = '';
  let project = '';
  let incident = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[OWNER, 'o@ridge.test'], [FOREMAN, 'f@ridge.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      // A trigger on auth.users creates the profile, so the name has to be
      // written over it rather than inserted beside it.
      await h.sql(`insert into user_profiles (id, email, full_name) values ($1,$2,$3)
                   on conflict (id) do update set full_name = excluded.full_name`,
        [id, email, id === OWNER ? 'Dana Whitfield' : 'Marcus Ruiz']);
    }
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridge Civil','ridge-civil','grounup') as id`)))[0]!.id;
    project = (await h.asService(() => h.sql<{ id: string }>(
      `insert into projects (company_id, number, name, status)
       values ($1,'PRJ-2026-0300','Airport Highway','active') returning id`, [company])))[0]!.id;
    // The foreman joins here rather than mid-suite: a mention of somebody who
    // is not a member is filtered out, which is the behavior one of these
    // tests is about and would otherwise silently break another.
    await h.asService(() => h.sql(
      `insert into company_memberships (company_id, user_id, role_id, status)
       select $1,$2,r.id,'active' from roles r where r.key='foreman' limit 1`,
      [company, FOREMAN]));
    incident = (await h.asService(() => h.sql<{ id: string }>(
      `insert into safety_incidents (company_id, project_id, number, occurred_at,
         incident_type, severity, description)
       values ($1,$2,'INC-001', now(), 'near_miss', 'low', 'Bucket swung wide')
       returning id`, [company, project])))[0]!.id;
  });

  it('keeps a comment on the record it names', async () => {
    const [c] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project', $1, 'Storm crossing is blocked at station 12+00') as id`,
      [project]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ subject_kind: string; author_name: string }>(
      `select subject_kind, author_name from my_record_comments where id=$1`, [c!.id]));
    expect(row!.subject_kind).toBe('project');
    expect(row!.author_name).toBe('Dana Whitfield');
  });

  it('refuses a comment on a record that does not exist', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.post_comment('project','00000000-0000-4000-8000-000000000000','hello')`)))
      .rejects.toThrow(/no project with that id/i);
  });

  it('refuses a kind nobody decided to keep comments on', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.post_comment('invoice', $1, 'hello')`, [project])))
      .rejects.toThrow(/not kept on/);
  });

  it('lets a reply answer the comment that started the thread, and no deeper', async () => {
    const [a] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project',$1,'Who is covering Thursday?') as id`, [project]));
    const [b] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project',$1,'I am',$2) as id`, [project, a!.id]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.post_comment('project',$1,'and me',$2)`, [project, b!.id])))
      .rejects.toThrow(/one level deep/);
  });

  it('will not let a reply sit on a different record from the comment it answers', async () => {
    const [a] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project',$1,'Thread root') as id`, [project]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.post_comment('safety_incident',$1,'wrong record',$2)`, [incident, a!.id])))
      .rejects.toThrow(/same record/);
  });

  it('notifies the person named, down the path notifications already take', async () => {
    await h.asUser(OWNER, () => h.sql(
      `select app.post_comment('project',$1,'@Marcus can you confirm the survey?',null,
         array[$2]::uuid[])`, [project, FOREMAN]));
    const [n] = await h.asService(() => h.sql<{ title: string; body: string; user_id: string }>(
      `select title, body, user_id from notifications
        where user_id=$1 order by created_at desc limit 1`, [FOREMAN]));
    expect(n!.title).toBe('Dana Whitfield mentioned you');
    expect(n!.body).toMatch(/confirm the survey/);
  });

  it('drops a mention of somebody who is not in the company', async () => {
    /*
     * A mention of a stranger is a notification that leads nowhere, and a way
     * to find out whether a user id exists.
     */
    const [c] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project',$1,'hello',null,
         array['77777777-7777-4777-8777-777777777777']::uuid[]) as id`, [project]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ mentions: string[] }>(
      `select mentions from record_comments where id=$1`, [c!.id]));
    expect(row!.mentions).toEqual([]);
  });

  it('stamps an edit, and lets only the author make one', async () => {
    const [c] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project',$1,'Origianl') as id`, [project]));
    await h.asUser(OWNER, () => h.sql(`select app.edit_comment($1,'Original')`, [c!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{ body: string; edited_at: string }>(
      `select body, edited_at from record_comments where id=$1`, [c!.id]));
    expect(row!.body).toBe('Original');
    expect(row!.edited_at).not.toBeNull();

    await expect(h.asUser(FOREMAN, () => h.sql(
      `select app.edit_comment($1,'not mine to change')`, [c!.id])))
      .rejects.toThrow(/Only the person who wrote/);
  });

  it('withdraws rather than deletes, so the record does not quietly lose a sentence', async () => {
    const [c] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.post_comment('project',$1,'Wrong photo attached') as id`, [project]));
    await h.asUser(OWNER, () => h.sql(
      `select app.retract_comment($1,'posted on the wrong job')`, [c!.id]));
    const [row] = await h.asUser(OWNER, () => h.sql<{
      retracted_at: string; retract_reason: string; body: string;
    }>(`select retracted_at, retract_reason, body from record_comments where id=$1`, [c!.id]));
    expect(row!.retracted_at).not.toBeNull();
    expect(row!.retract_reason).toBe('posted on the wrong job');
    // Still there. A comment that vanishes from a record somebody is claiming
    // against is worse than one that says it was withdrawn.
    expect(row!.body).toBe('Wrong photo attached');
  });

  it('gives a comment the sensitivity of what it is about', async () => {
    /*
     * A remark on a safety incident is not a remark on a purchase order. The
     * read permission is the subject's, not the table's.
     */
    const perm = await h.asUser(OWNER, () => h.sql<{ p: string }>(
      `select app.comment_read_permission('safety_incident') as p`));
    expect(perm[0]!.p).toBe('safety.read');
    const other = await h.asUser(OWNER, () => h.sql<{ p: string }>(
      `select app.comment_read_permission('purchase_order') as p`));
    expect(other[0]!.p).toBe('procurement.read');
  });

  it('lets nobody insert a comment straight into the table', async () => {
    // Every write goes through the function, which checks the subject, filters
    // the mentions and stamps the edit. An insert would skip all three.
    await expect(h.asUser(OWNER, () => h.sql(
      `insert into record_comments (company_id, subject_kind, subject_id, author_id, body)
       values ($1,'project',$2,$3,'straight in')`, [company, project, OWNER])))
      .rejects.toThrow();
  });
});

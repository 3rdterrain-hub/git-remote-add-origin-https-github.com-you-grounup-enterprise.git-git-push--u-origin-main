/**
 * The drawing says one thing and the specification says another.
 *
 * `document_conflicts` has existed since 0006 with the right shape — both sides
 * in their own words, the sheet each came from, severity, and whether it moves
 * quantity, cost or schedule — an index on the unresolved ones, row level
 * security, and `rfis.conflict_id` pointing at it. Five mentions in the whole
 * repository and every one is schema: nothing read it and nothing wrote it.
 *
 * That is not an ordinary missing screen. `confidence.ts` takes twenty-two
 * points off a line for every unresolved conflict and routes it to senior
 * review, and the column it reads has never been incremented — so every bid was
 * priced as though the documents agreed.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '88888888-8888-4888-8888-888888888888';

describe('where the documents disagree', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let line = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@dgl.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@dgl.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('DGL Civil','dgl-civil','enterprise') as id`)))[0]!.id;
    const [est] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.create_estimate('Airport Highway', null, null, null, $1) as id`, [company]));
    version = (await h.asUser(OWNER, () => h.sql<{ v: string }>(
      `select current_version_id as v from estimates where id = $1`, [est!.id])))[0]!.v;
    line = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.add_estimate_line($1, null, 'Storm sewer, 8 inch', 234, 'LF') as id`,
      [version])))[0]!.id;
  });

  const raise = (over: Record<string, unknown> = {}) => h.asUser(OWNER, () => h.sql<{ id: string }>(
    `select app.raise_document_conflict($1,$2,$3,$4,$5,$6,null,$7,null,$8) as id`, [
      over.title ?? 'Storm pipe size disagrees',
      over.description ?? 'The plan and the specification call for different pipe.',
      over.source_a ?? 'C1.0 Site Plan',
      over.source_a_says ?? '8 inch RCP at 0.38%',
      over.source_b ?? 'Specification 33 41 00',
      over.source_b_says ?? '12 inch RCP minimum',
      over.line === null ? null : (over.line ?? line),
      over.severity ?? 'high',
    ]));

  it('refuses a conflict stated from only one side', async () => {
    /*
     * "The plan and the spec conflict" is not a conflict anybody but its author
     * can resolve. Both documents, and what each one says.
     */
    await expect(raise({ source_b_says: '   ' }))
      .rejects.toThrow(/what each document is, and what each one says/i);
  });

  it('refuses one nobody can place', async () => {
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.raise_document_conflict('t','d','a','as','b','bs',null,null)`)))
      .rejects.toThrow(/which estimate or line/i);
  });

  it('takes twenty-two points off the line, which is the whole reason to record it', async () => {
    const [before] = await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select conflict_count as n from estimate_line_items where id=$1`, [line]));
    expect(Number(before!.n)).toBe(0);

    await raise();

    const [after] = await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select conflict_count as n from estimate_line_items where id=$1`, [line]));
    expect(Number(after!.n)).toBe(1);
  });

  it('counts rather than increments, so it cannot drift', async () => {
    // Two more on the same line, then one settled: the count is recomputed from
    // the conflicts themselves every time, never added to and taken away from.
    const a = (await raise({ title: 'Invert elevation' }))[0]!.id;
    await raise({ title: 'Bedding depth' });
    const [three] = await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select conflict_count as n from estimate_line_items where id=$1`, [line]));
    expect(Number(three!.n)).toBe(3);

    await h.asUser(OWNER, () => h.sql(
      `select app.resolve_document_conflict($1,'Specification governs; 12 inch used')`, [a]));
    const [two] = await h.asUser(OWNER, () => h.sql<{ n: number }>(
      `select conflict_count as n from estimate_line_items where id=$1`, [line]));
    expect(Number(two!.n)).toBe(2);
  });

  it('will not settle one with no answer', async () => {
    const [c] = await raise({ title: 'Trench width' });
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.resolve_document_conflict($1, '  ')`, [c!.id])))
      .rejects.toThrow(/how it was settled/i);
  });

  it('turns into the question it implies, carrying both sides across', async () => {
    const [c] = await raise({ title: 'Pavement section' });
    const [r] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.conflict_to_rfi($1) as id`, [c!.id]));

    const [rfi] = await h.asUser(OWNER, () => h.sql<{
      number: string; question: string; existing_information: string;
      conflict_id: string; drawing_reference: string; specification_reference: string;
    }>(`select number, question, existing_information, conflict_id,
               drawing_reference, specification_reference from rfis where id=$1`, [r!.id]));

    // `rfis.conflict_id` has pointed at this table since 0006 and nothing set it.
    expect(rfi!.conflict_id).toBe(c!.id);
    expect(rfi!.number).toMatch(/^RFI-/);
    expect(rfi!.question).toMatch(/Which governs/);
    expect(rfi!.existing_information).toMatch(/C1\.0 Site Plan says: 8 inch RCP/);
    expect(rfi!.existing_information).toMatch(/Specification 33 41 00 says: 12 inch RCP/);
    expect(rfi!.drawing_reference).toBe('C1.0 Site Plan');
    expect(rfi!.specification_reference).toBe('Specification 33 41 00');
  });

  it('will not ask about one already settled', async () => {
    const [c] = await raise({ title: 'Curb type' });
    await h.asUser(OWNER, () => h.sql(
      `select app.resolve_document_conflict($1,'Plan governs')`, [c!.id]));
    await expect(h.asUser(OWNER, () => h.sql(`select app.conflict_to_rfi($1)`, [c!.id])))
      .rejects.toThrow(/already settled/i);
  });

  it('has a door that says where each one lands and whether it was asked about', async () => {
    const rows = await h.asUser(OWNER, () => h.sql<{
      title: string; line_description: string; rfi_count: string; estimate_number: string;
    }>(`select title, line_description, rfi_count, estimate_number
          from my_document_conflicts where title = 'Pavement section'`));
    expect(rows[0]!.line_description).toBe('Storm sewer, 8 inch');
    expect(Number(rows[0]!.rfi_count)).toBe(1);
    expect(rows[0]!.estimate_number).toMatch(/^E-/);
  });
});

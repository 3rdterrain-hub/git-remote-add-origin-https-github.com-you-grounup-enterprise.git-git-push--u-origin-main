/**
 * From punches to a timecard.
 *
 * The arithmetic here is somebody's pay, so every case is a worked example with
 * the answer computed by hand first: a plain day, a long day under two different
 * state rules, a week that crosses forty on a Thursday, and a day split across
 * two jobs where it matters *which* job the overtime lands on.
 *
 * The default is federal — weekly overtime only — because defaulting to eight
 * hours a day would pay overtime most employers do not owe.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('from punches to a timecard', () => {
  let h: Harness;
  const chief = '11111111-1111-4111-8111-111111111111';
  let company = '';
  let me = '';
  let jobA = '';
  let jobB = '';
  let n = 0;

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));
  const sql = <T,>(q: string, p?: unknown[]) => as<T>(chief, q, p);

  const punch = (kind: string, at: string, project: string | null = null) =>
    sql(`select app.punch($1, $2::app.punch_kind, $3, $4, null, null, null,
                          null, null, null, 'web', null, $5::timestamptz)`,
      [company, kind, me, project, at]);

  const post = (day: string) =>
    sql<{ straight_hours: string; overtime_hours: string; doubletime_hours: string; project_id: string | null }>(
      `select straight_hours::text, overtime_hours::text, doubletime_hours::text, project_id
       from post_punches_to_timecard($1, $2::date) order by project_id nulls first`, [me, day]);

  const totals = async (day: string) => {
    const rows = await post(day);
    return {
      straight: rows.reduce((a, r) => a + Number(r.straight_hours), 0),
      overtime: rows.reduce((a, r) => a + Number(r.overtime_hours), 0),
      doubletime: rows.reduce((a, r) => a + Number(r.doubletime_hours), 0),
      rows,
    };
  };

  /*
   * Punches have no delete policy — that is the append-only guarantee from
   * migration 0122 — so clearing between worked examples goes through the
   * service role, which is the only thing that can. The first version of this
   * helper used the chief's own session, silently deleted nothing, and two
   * cases downstream started reading a previous example's week.
   */
  const wipe = async () => {
    await sql(`delete from time_entries where company_id = $1`, [company]);
    await h.asService(() => h.sql(`delete from time_punches where company_id = $1`, [company]));
  };

  const federal = () => sql(
    `select set_overtime_policy($1, null, null, 40, 0, 1, 'nearest')`, [company]);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'c@r.test')`, [chief]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'c@r.test')
                 on conflict (id) do nothing`, [chief]);
    company = (await sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;
    me = (await sql<{ id: string }>(
      `insert into employees (company_id, employee_number, first_name, last_name, status)
       values ($1, 'E-1', 'Dale', 'Rhodes', 'active') returning id`, [company]))[0]!.id;
    for (const name of ['North Yard', 'South Yard']) {
      const [p] = await sql<{ id: string }>(
        `insert into projects (company_id, number, name, status)
         values ($1, $2, $3, 'active') returning id`, [company, `P-${++n}`, name]);
      if (n === 1) jobA = p!.id; else jobB = p!.id;
    }
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('the rule a company has not set', () => {
    it('is the federal one, not California\'s', async () => {
      const [p] = await sql<{ daily_overtime_after: string | null; weekly_overtime_after: string }>(
        `select daily_overtime_after::text, weekly_overtime_after::text
         from app.overtime_policy($1)`, [company]);
      expect(p!.daily_overtime_after).toBeNull();
      expect(Number(p!.weekly_overtime_after)).toBe(40);
    });

    it('does no rounding until somebody turns it on', async () => {
      const [p] = await sql<{ rounding_minutes: number }>(
        `select rounding_minutes from app.overtime_policy($1)`, [company]);
      expect(p!.rounding_minutes).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('a plain day', () => {
    beforeAll(async () => { await wipe(); await federal(); });

    it('posts eight straight hours and no overtime', async () => {
      await punch('in',  '2026-04-06T07:00:00Z', jobA);
      await punch('out', '2026-04-06T15:00:00Z');
      const t = await totals('2026-04-06');
      expect(t.straight).toBe(8);
      expect(t.overtime).toBe(0);
    });

    it('keeps the job the hours were worked on', async () => {
      const [r] = await sql<{ project_id: string; source: string }>(
        `select project_id, source from time_entries where work_date = '2026-04-06'`, []);
      expect(r!.project_id).toBe(jobA);
      expect(r!.source).toBe('clock');
    });

    it('leaves the hours pending rather than approving its own work', async () => {
      const [r] = await sql<{ approval_state: string }>(
        `select approval_state::text from time_entries where work_date = '2026-04-06'`, []);
      expect(r!.approval_state).toBe('pending');
    });

    it('takes the break out of the paid hours', async () => {
      await punch('in',          '2026-04-07T07:00:00Z', jobA);
      await punch('break_start', '2026-04-07T11:00:00Z');
      await punch('break_end',   '2026-04-07T11:30:00Z');
      await punch('out',         '2026-04-07T15:30:00Z');
      const t = await totals('2026-04-07');
      expect(t.straight).toBe(8);
    });

    it('refuses to post a day that is still running', async () => {
      await punch('in', '2026-04-08T07:00:00Z', jobA);
      await expect(post('2026-04-08')).rejects.toThrow(/still open/);
      await punch('out', '2026-04-08T15:00:00Z');
    });
  });

  // ---------------------------------------------------------------------------
  describe('a ten-hour day', () => {
    beforeAll(async () => { await wipe(); });

    it('is all straight time under the federal rule', async () => {
      await federal();
      await punch('in',  '2026-04-13T06:00:00Z', jobA);
      await punch('out', '2026-04-13T16:00:00Z');
      const t = await totals('2026-04-13');
      expect(t.straight).toBe(10);
      expect(t.overtime).toBe(0);
    });

    it('is eight and two where the company has a daily rule', async () => {
      await sql(`select set_overtime_policy($1, 8, null, 40, 0, 1, 'nearest')`, [company]);
      const t = await totals('2026-04-13');
      expect(t.straight).toBe(8);
      expect(t.overtime).toBe(2);
    });

    it('re-posting replaced the earlier rows rather than doubling them', async () => {
      const [r] = await sql<{ c: string }>(
        `select count(*)::text as c from time_entries where work_date = '2026-04-13'`, []);
      expect(Number(r!.c)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('a thirteen-hour day in a state with doubletime', () => {
    beforeAll(async () => {
      await wipe();
      await sql(`select set_overtime_policy($1, 8, 12, 40, 0, 1, 'nearest')`, [company]);
    });

    it('splits eight straight, four overtime and one doubletime', async () => {
      await punch('in',  '2026-04-20T05:00:00Z', jobA);
      await punch('out', '2026-04-20T18:00:00Z');
      const t = await totals('2026-04-20');
      expect(t.straight).toBe(8);
      expect(t.overtime).toBe(4);
      expect(t.doubletime).toBe(1);
    });

    it('refuses a doubletime threshold below the overtime one', async () => {
      await expect(sql(`select set_overtime_policy($1, 12, 8, 40, 0, 1, 'nearest')`, [company]))
        .rejects.toThrow(/overtime_policies_tiers_ascend/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('a week that crosses forty', () => {
    beforeAll(async () => { await wipe(); await federal(); });

    it('pays four nine-hour days straight', async () => {
      // Monday 2026-04-27 through Thursday: 9 hours each, 36 by Thursday night.
      for (const d of ['27', '28', '29', '30']) {
        await punch('in',  `2026-04-${d}T07:00:00Z`, jobA);
        await punch('out', `2026-04-${d}T16:00:00Z`);
        const t = await totals(`2026-04-${d}`);
        expect(t.overtime).toBe(0);
        expect(t.straight).toBe(9);
      }
    });

    it('splits Friday at the fortieth hour', async () => {
      await punch('in',  '2026-05-01T07:00:00Z', jobA);
      await punch('out', '2026-05-01T16:00:00Z');
      const t = await totals('2026-05-01');
      expect(t.straight).toBe(4);   // 36 already worked; 4 left under 40
      expect(t.overtime).toBe(5);
    });

    it('pays Saturday entirely at overtime', async () => {
      await punch('in',  '2026-05-02T07:00:00Z', jobA);
      await punch('out', '2026-05-02T13:00:00Z');
      const t = await totals('2026-05-02');
      expect(t.straight).toBe(0);
      expect(t.overtime).toBe(6);
    });

    it('starts the next week over', async () => {
      // 2026-05-03 is a Sunday, which is where the week starts.
      await punch('in',  '2026-05-03T07:00:00Z', jobA);
      await punch('out', '2026-05-03T15:00:00Z');
      const t = await totals('2026-05-03');
      expect(t.straight).toBe(8);
      expect(t.overtime).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('a day split across two jobs', () => {
    beforeAll(async () => {
      await wipe();
      await sql(`select set_overtime_policy($1, 8, null, 40, 0, 1, 'nearest')`, [company]);
    });

    it('bills the overtime to the job that was worked past eight', async () => {
      await punch('in',  '2026-05-11T06:00:00Z', jobA);   // 6 hours on the north yard
      await punch('out', '2026-05-11T12:00:00Z');
      await punch('in',  '2026-05-11T12:30:00Z', jobB);   // 4 hours on the south yard
      await punch('out', '2026-05-11T16:30:00Z');
      const rows = await post('2026-05-11');
      const a = rows.find((r) => r.project_id === jobA)!;
      const b = rows.find((r) => r.project_id === jobB)!;
      expect(Number(a.straight_hours)).toBe(6);
      expect(Number(a.overtime_hours)).toBe(0);
      expect(Number(b.straight_hours)).toBe(2);   // takes the day to eight
      expect(Number(b.overtime_hours)).toBe(2);   // and the rest is overtime
    });
  });

  // ---------------------------------------------------------------------------
  describe('rounding, when a company asks for it', () => {
    beforeAll(async () => { await wipe(); });

    it('leaves the minutes alone by default', async () => {
      await federal();
      await punch('in',  '2026-05-18T06:53:00Z', jobA);
      await punch('out', '2026-05-18T15:00:00Z');
      const t = await totals('2026-05-18');
      expect(t.straight).toBe(8.12);          // 487 minutes
    });

    it('rounds to the nearest quarter hour when told to', async () => {
      // The seven-minute rule: 487 minutes is 7 past the quarter, so it rounds
      // back to 480. This is the rounding that costs somebody time, which is
      // why it is off until a company chooses it.
      await sql(`select set_overtime_policy($1, null, null, 40, 0, 15, 'nearest')`, [company]);
      const t = await totals('2026-05-18');
      expect(t.straight).toBe(8);             // 487 → 480 minutes
    });

    it('rounds up when told to, and never silently down', async () => {
      await sql(`select set_overtime_policy($1, null, null, 40, 0, 15, 'up')`, [company]);
      const t = await totals('2026-05-18');
      expect(t.straight).toBe(8.25);
    });
  });

  // ---------------------------------------------------------------------------
  describe('what posting will not touch', () => {
    beforeAll(async () => { await wipe(); await federal(); });

    it('leaves a hand-typed entry for the same day alone', async () => {
      await sql(
        `insert into time_entries (company_id, employee_id, work_date, straight_hours, source)
         values ($1, $2, '2026-06-01', 2, 'manual')`, [company, me]);
      await punch('in',  '2026-06-01T07:00:00Z', jobA);
      await punch('out', '2026-06-01T15:00:00Z');
      await post('2026-06-01');
      const [r] = await sql<{ c: string; hours: string }>(
        `select count(*)::text as c, sum(straight_hours)::text as hours
         from time_entries where work_date = '2026-06-01'`, []);
      expect(Number(r!.c)).toBe(2);
      expect(Number(r!.hours)).toBe(10);
    });

    it('stops rather than overwriting hours somebody has approved', async () => {
      await sql(
        `update time_entries set approval_state = 'approved', approved_by = $1, approved_at = now()
         where work_date = '2026-06-01' and source = 'clock'`, [chief]);
      await expect(post('2026-06-01')).rejects.toThrow(/already approved or exported/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the days still waiting to be posted', () => {
    it('lists a finished day with no timecard rows yet', async () => {
      await wipe();
      await federal();
      await punch('in',  '2026-06-08T07:00:00Z', jobA);
      await punch('out', '2026-06-08T15:00:00Z');
      const [r] = await sql<{ work_date: string; has_a_clock_out: boolean }>(
        `select work_date::text, has_a_clock_out from my_unposted_days
         where employee_id = $1 order by work_date`, [me]);
      expect(r!.work_date).toBe('2026-06-08');
      expect(r!.has_a_clock_out).toBe(true);
    });

    it('drops off the list once it is posted', async () => {
      await post('2026-06-08');
      const rows = await sql(`select 1 from my_unposted_days where employee_id = $1`, [me]);
      expect(rows.length).toBe(0);
    });

    it('shows nobody anything anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(`select * from my_unposted_days`)).rejects.toThrow(/permission denied/);
        await expect(h.sql(`select * from overtime_policies`)).rejects.toThrow(/permission denied/);
      });
    });
  });
});

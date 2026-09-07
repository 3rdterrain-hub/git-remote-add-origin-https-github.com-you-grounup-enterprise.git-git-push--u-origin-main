/**
 * The clock on the wall.
 *
 * `time_entries` was the only place time lived, and it is a timecard: hours per
 * day, typed after the fact, gated behind `projects.write`. A laborer recording
 * their own start needed the permission to edit the project schedule.
 *
 * These are the punches. What is being tested is mostly refusal — the clock
 * declines to guess about anything that turns into somebody's pay.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('the clock on the wall', () => {
  let h: Harness;
  const chief   = '11111111-1111-4111-8111-111111111111';
  const laborer = '22222222-2222-4222-8222-222222222222';
  const nosy    = '33333333-3333-4333-8333-333333333333';
  let company = '';
  let me = '';        // the laborer's employee row
  let mate = '';      // another employee, no login
  let n = 0;

  const as = <T,>(who: string, q: string, p?: unknown[]) =>
    h.asUser(who, () => h.sql<T extends object ? T : never>(q, p));

  const employee = (user: string | null) =>
    as<{ id: string }>(chief,
      `insert into employees (company_id, user_id, employee_number, first_name, last_name, status)
       values ($1, $2, $3, 'Crew', $4, 'active') returning id`,
      [company, user, `E-${++n}`, `Member${n}`]).then((r) => r[0]!.id);

  /** Punch at a stated moment, so a whole day can be built without waiting. */
  const punchAt = (employeeId: string, kind: string, at: string) =>
    as(chief, `select app.punch($1, $2::app.punch_kind, $3, null, null, null, null,
                                null, null, null, 'web', null, $4::timestamptz)`,
      [company, kind, employeeId, at]);

  const clear = () => h.sql(`delete from time_punches where company_id = $1`, [company]);

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    for (const [id, email] of [[chief, 'c@r.test'], [laborer, 'l@r.test'], [nosy, 'n@r.test']] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1,$2)`, [id, email]);
      await h.sql(`insert into user_profiles (id, email) values ($1,$2)
                   on conflict (id) do nothing`, [id, email]);
    }
    company = (await as<{ id: string }>(chief,
      `select app.provision_company('Ridgeline','ridgeline','enterprise') as id`))[0]!.id;

    // Both extra users are plain members: no hr.* and no projects.write.
    for (const u of [laborer, nosy]) {
      // Viewer: no hr.*, no time.punch_crew. The floor this feature has to work from.
      await h.sql(
        `insert into company_memberships (company_id, user_id, role_id, status)
         select $1, $2, r.id, 'active' from roles r
         where r.company_id is null and r.key = 'viewer' limit 1`, [company, u]);
    }
    me = await employee(laborer);
    mate = await employee(null);
  }, 300_000);

  afterAll(async () => { await h?.db.close(); });

  // ---------------------------------------------------------------------------
  describe('punching yourself in', () => {
    it('needs no permission beyond being the employee', async () => {
      await clear();
      const [r] = await as<{ kind: string }>(laborer,
        `select (clock_in($1)).kind::text as kind`, [company]);
      expect(r!.kind).toBe('in');
    });

    it('puts them on the clock', async () => {
      const [r] = await as<{ standing: string }>(laborer,
        `select standing from my_time_clock where employee_id = $1`, [me]);
      expect(r!.standing).toBe('On the clock');
    });

    it('refuses a second clock-in', async () => {
      await expect(as(laborer, `select clock_in($1)`, [company]))
        .rejects.toThrow(/Already clocked in/);
    });

    it('records who pressed the button', async () => {
      const [r] = await as<{ punched_by: string; punched_by_somebody_else: boolean }>(
        laborer, `select punched_by, punched_by_somebody_else from my_time_punches
                  where employee_id = $1 order by punched_at desc limit 1`, [me]);
      expect(r!.punched_by).toBe(laborer);
      expect(r!.punched_by_somebody_else).toBe(false);
    });

    it('clocks back out', async () => {
      const [r] = await as<{ kind: string }>(laborer,
        `select (clock_out($1)).kind::text as kind`, [company]);
      expect(r!.kind).toBe('out');
    });

    it('refuses a clock-out from off the clock', async () => {
      await expect(as(laborer, `select clock_out($1)`, [company]))
        .rejects.toThrow(/Already clocked out/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the order punches come in', () => {
    it('will not start a break off the clock', async () => {
      await clear();
      await expect(as(laborer, `select start_break($1)`, [company]))
        .rejects.toThrow(/Clock in before starting a break/);
    });

    it('will not end a break nobody is on', async () => {
      await as(laborer, `select clock_in($1)`, [company]);
      await expect(as(laborer, `select end_break($1)`, [company]))
        .rejects.toThrow(/no break to end/);
    });

    it('will not start a break twice', async () => {
      await as(laborer, `select start_break($1)`, [company]);
      await expect(as(laborer, `select start_break($1)`, [company]))
        .rejects.toThrow(/Already on break/);
    });

    it('refuses to clock out of a break rather than guessing what it was worth', async () => {
      await expect(as(laborer, `select clock_out($1)`, [company]))
        .rejects.toThrow(/End the break before clocking out/);
    });

    it('lets them out once the break has ended', async () => {
      await as(laborer, `select end_break($1)`, [company]);
      const [r] = await as<{ kind: string }>(laborer,
        `select (clock_out($1)).kind::text as kind`, [company]);
      expect(r!.kind).toBe('out');
    });

    it('refuses a punch in the future', async () => {
      await clear();
      await expect(as(chief,
        `select app.punch($1,'in'::app.punch_kind,$2,null,null,null,null,null,null,null,'web',null,
                          now() + interval '3 hours')`, [company, me]))
        .rejects.toThrow(/cannot be in the future/);
    });

    it('refuses a punch before the one already recorded', async () => {
      await clear();
      await punchAt(me, 'in', '2026-03-02T14:00:00Z');
      await expect(punchAt(me, 'out', '2026-03-02T09:00:00Z'))
        .rejects.toThrow(/recorded in order/);
    });

    it('refuses a punch from a terminated employee', async () => {
      await clear();
      const gone = await employee(null);
      await as(chief, `update employees set status = 'terminated', termination_date = current_date
                       where id = $1`, [gone]);
      await expect(punchAt(gone, 'in', '2026-03-02T09:00:00Z'))
        .rejects.toThrow(/terminated/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('what the punches add up to', () => {
    it('counts a plain shift', async () => {
      await clear();
      await punchAt(me, 'in',  '2026-03-03T07:00:00Z');
      await punchAt(me, 'out', '2026-03-03T15:00:00Z');
      const [r] = await as<{ worked_minutes: string; open: boolean }>(chief,
        `select worked_minutes::text, open from app.punch_day($1, '2026-03-03')`, [me]);
      expect(Number(r!.worked_minutes)).toBe(480);
      expect(r!.open).toBe(false);
    });

    it('subtracts the break that was actually taken', async () => {
      await clear();
      await punchAt(me, 'in',          '2026-03-04T07:00:00Z');
      await punchAt(me, 'break_start', '2026-03-04T11:00:00Z');
      await punchAt(me, 'break_end',   '2026-03-04T11:30:00Z');
      await punchAt(me, 'out',         '2026-03-04T15:00:00Z');
      const [r] = await as<{ worked_minutes: string; break_minutes: string }>(chief,
        `select worked_minutes::text, break_minutes::text from app.punch_day($1, '2026-03-04')`, [me]);
      expect(Number(r!.worked_minutes)).toBe(450);
      expect(Number(r!.break_minutes)).toBe(30);
    });

    it('counts two shifts in one day', async () => {
      await clear();
      await punchAt(me, 'in',  '2026-03-05T06:00:00Z');
      await punchAt(me, 'out', '2026-03-05T10:00:00Z');
      await punchAt(me, 'in',  '2026-03-05T13:00:00Z');
      await punchAt(me, 'out', '2026-03-05T17:00:00Z');
      const [r] = await as<{ worked_minutes: string; first_in: string; last_out: string }>(chief,
        `select worked_minutes::text, first_in, last_out from app.punch_day($1, '2026-03-05')`, [me]);
      expect(Number(r!.worked_minutes)).toBe(480);
    });

    it('says a running day is open rather than reporting it as finished', async () => {
      await clear();
      await as(laborer, `select clock_in($1)`, [company]);
      const [r] = await as<{ open: boolean }>(chief,
        `select open from app.punch_day($1, (now() at time zone 'UTC')::date)`, [me]);
      expect(r!.open).toBe(true);
    });

    it('reports nothing rather than zero-by-accident for a day with no punches', async () => {
      const [r] = await as<{ worked_minutes: string; punch_count: number; first_in: string | null }>(chief,
        `select worked_minutes::text, punch_count, first_in from app.punch_day($1, '2001-01-01')`, [me]);
      expect(r!.punch_count).toBe(0);
      expect(r!.first_in).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('correcting a punch', () => {
    it('voids the last one, with a reason', async () => {
      await clear();
      await punchAt(me, 'in', '2026-03-06T07:00:00Z');
      const [p] = await as<{ id: string }>(laborer,
        `select id from my_time_punches where employee_id = $1 order by punched_at desc limit 1`, [me]);
      const [r] = await as<{ voided: boolean }>(laborer,
        `select (void_punch($1,'Punched on the wrong job')).voided_at is not null as voided`, [p!.id]);
      expect(r!.voided).toBe(true);
    });

    it('leaves the row where it was', async () => {
      const [r] = await as<{ c: string }>(laborer,
        `select count(*)::text as c from my_time_punches where employee_id = $1`, [me]);
      expect(Number(r!.c)).toBe(1);
    });

    it('takes the voided punch out of the clock state', async () => {
      const [r] = await as<{ standing: string }>(laborer,
        `select standing from my_time_clock where employee_id = $1`, [me]);
      expect(r!.standing).toBe('Off the clock');
    });

    it('refuses a void with no reason', async () => {
      await clear();
      await punchAt(me, 'in', '2026-03-07T07:00:00Z');
      const [p] = await as<{ id: string }>(laborer,
        `select id from my_time_punches where employee_id = $1 order by punched_at desc limit 1`, [me]);
      await expect(as(laborer, `select void_punch($1, '  ')`, [p!.id]))
        .rejects.toThrow(/Say why/);
    });

    it('refuses to void out of the middle of a day', async () => {
      await clear();
      await punchAt(me, 'in',  '2026-03-08T07:00:00Z');
      await punchAt(me, 'out', '2026-03-08T15:00:00Z');
      const [first] = await as<{ id: string }>(laborer,
        `select id from my_time_punches where employee_id = $1 order by punched_at limit 1`, [me]);
      await expect(as(laborer, `select void_punch($1,'wrong time')`, [first!.id]))
        .rejects.toThrow(/Only the most recent punch/);
    });

    it('cannot be updated directly, void or not', async () => {
      const [r] = await as<{ n: string }>(laborer,
        `with u as (update time_punches set note = 'edited' where employee_id = $1 returning 1)
         select count(*)::text as n from u`, [me]);
      expect(Number(r!.n)).toBe(0);
    });

    it('cannot be deleted directly', async () => {
      const [r] = await as<{ n: string }>(laborer,
        `with d as (delete from time_punches where employee_id = $1 returning 1)
         select count(*)::text as n from d`, [me]);
      expect(Number(r!.n)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  describe('punching somebody else in', () => {
    it('is refused without hr.write', async () => {
      await clear();
      await expect(as(laborer,
        `select clock_in($1, null, null, null, null, null, null, null, $2)`, [company, mate]))
        .rejects.toThrow(/time\.punch_crew/);
    });

    it('is allowed to an administrator, and says so on the row', async () => {
      const [p] = await as<{ id: string }>(chief,
        `select (clock_in($1, null, null, null, null, null, null, null, $2)).id`, [company, mate]);
      const [r] = await as<{ source: string; punched_by_somebody_else: boolean }>(chief,
        `select source, punched_by_somebody_else from my_time_punches where id = $1`, [p!.id]);
      expect(r!.source).toBe('supervisor');
      expect(r!.punched_by_somebody_else).toBe(true);
    });

    it('tells a person with no employee record what to do about it', async () => {
      await expect(as(nosy, `select clock_in($1)`, [company]))
        .rejects.toThrow(/no employee record for you/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('who can see a punch', () => {
    it('shows an employee their own', async () => {
      await as(laborer, `select clock_in($1)`, [company]);
      const [r] = await as<{ c: string }>(laborer,
        `select count(*)::text as c from my_time_punches where employee_id = $1`, [me]);
      expect(Number(r!.c)).toBeGreaterThan(0);
    });

    it('does not show one crew member another', async () => {
      const [r] = await as<{ c: string }>(laborer,
        `select count(*)::text as c from my_time_punches where employee_id = $1`, [mate]);
      expect(Number(r!.c)).toBe(0);
    });

    it('shows an administrator the whole company', async () => {
      const [r] = await as<{ c: string }>(chief,
        `select count(*)::text as c from my_time_punches where company_id = $1`, [company]);
      expect(Number(r!.c)).toBeGreaterThan(0);
    });

    it('shows nobody anything anonymously', async () => {
      await h.asAnon(async () => {
        await expect(h.sql(`select * from my_time_punches`)).rejects.toThrow(/permission denied/);
        await expect(h.sql(`select * from my_time_clock`)).rejects.toThrow(/permission denied/);
        await expect(h.sql(`select * from time_punches`)).rejects.toThrow(/permission denied/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('a day that has gone to payroll', () => {
    it('takes no more punches', async () => {
      await clear();
      await as(chief,
        `insert into time_entries (company_id, employee_id, work_date, straight_hours,
                                   exported_at, payroll_batch)
         values ($1, $2, '2026-03-09', 8, now(), 'PR-2026-10')`, [company, me]);
      await expect(punchAt(me, 'in', '2026-03-09T07:00:00Z'))
        .rejects.toThrow(/exported to payroll/);
    });

    it('still takes punches on the days either side of it', async () => {
      const r = await punchAt(me, 'in', '2026-03-10T07:00:00Z');
      expect(r).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('the board a superintendent reads', () => {
    it('lists everybody, including the ones who have not punched', async () => {
      const [r] = await as<{ c: string }>(chief,
        `select count(*)::text as c from my_time_clock where company_id = $1`, [company]);
      expect(Number(r!.c)).toBeGreaterThanOrEqual(2);
    });

    it('says off the clock rather than leaving the standing blank', async () => {
      const [r] = await as<{ standing: string }>(chief,
        `select standing from my_time_clock where employee_id = $1`, [mate]);
      expect(['On the clock', 'On break', 'Off the clock']).toContain(r!.standing);
    });
  });
});

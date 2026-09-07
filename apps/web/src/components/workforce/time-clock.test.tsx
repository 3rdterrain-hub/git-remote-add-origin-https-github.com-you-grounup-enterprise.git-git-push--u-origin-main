/**
 * The punch card.
 *
 * Two properties matter more than anything else on this screen.
 *
 * A person is never offered a button whose only outcome is a refusal. The
 * database's state machine decides what is legal; `nextPunches` mirrors it, and
 * the first block below is that mirror checked case by case against
 * `app.punch_refusal` in migration 0122. If the two ever drift, this is where
 * it shows up.
 *
 * And when a punch is refused anyway — a second device, a screen left open over
 * lunch — the database's own sentence reaches the person unaltered. Rewording
 * refusals in the browser is how two copies of one rule start disagreeing about
 * somebody's pay.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClockRow, PunchKind } from '@/lib/data/time-clock';

const hoisted = vi.hoisted(() => ({
  configured: true,
  mine: null as ClockRow | null,
  board: [] as ClockRow[],
  punches: [] as Array<{ kind: string }>,
  refuse: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/time-clock', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/time-clock')>(
    '@/lib/data/time-clock');
  return {
    ...actual,
    loadMyClock: async () => hoisted.mine,
    loadTimeClock: async () => hoisted.board,
    loadRecentPunches: () => async () => [],
    punch: async (kind: string) => {
      if (hoisted.refuse) throw new Error(hoisted.refuse);
      hoisted.punches.push({ kind });
    },
  };
});

import { PunchCard, TimeClockBoard, nextPunches } from './time-clock';

const row = (over: Partial<ClockRow> = {}): ClockRow => ({
  employeeId: 'e1', companyId: 'c1', employeeName: 'Dale Rhodes', employeeNumber: 'E-1',
  standing: 'Off the clock', state: null, since: null,
  projectId: null, projectName: null,
  workedMinutes: 0, breakMinutes: 0, stillOpen: false,
  ...over,
});

beforeEach(() => {
  hoisted.configured = true;
  hoisted.mine = row();
  hoisted.board = [];
  hoisted.punches = [];
  hoisted.refuse = null;
});

// ---------------------------------------------------------------------------
describe('what the clock will accept next', () => {
  const cases: Array<[PunchKind | null, PunchKind[]]> = [
    [null, ['in']],
    ['out', ['in']],
    ['in', ['out', 'break_start']],
    ['break_end', ['out', 'break_start']],
    ['break_start', ['break_end']],
  ];

  it.each(cases)('offers %s → %s', (state, expected) => {
    expect(nextPunches(state)).toEqual(expected);
  });

  it('never offers clocking out of a break, which the database refuses', () => {
    expect(nextPunches('break_start')).not.toContain('out');
  });

  it('never offers a second clock-in', () => {
    expect(nextPunches('in')).not.toContain('in');
  });
});

// ---------------------------------------------------------------------------
describe('the punch card', () => {
  it('offers one button to somebody off the clock', async () => {
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByRole('button', { name: /Clock in/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock out/ })).not.toBeInTheDocument();
  });

  it('offers clock out and start break to somebody on it', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in', workedMinutes: 132 });
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByRole('button', { name: /Clock out/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start break/ })).toBeInTheDocument();
  });

  it('offers only ending the break to somebody on one', async () => {
    hoisted.mine = row({ standing: 'On break', state: 'break_start' });
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByRole('button', { name: /End break/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clock out/ })).not.toBeInTheDocument();
  });

  it('says the hours the way a person says them', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in', workedMinutes: 132 });
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByText('2h 12m')).toBeInTheDocument();
  });

  it('says a running day is still running', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in', workedMinutes: 60, stillOpen: true });
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByText(/still running/)).toBeInTheDocument();
  });

  it('punches when the button is pressed', async () => {
    render(<PunchCard companyId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Clock in/ }));
    await waitFor(() => expect(hoisted.punches).toEqual([{ kind: 'in' }]));
  });

  it('shows the database refusal word for word', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in' });
    hoisted.refuse = 'On break. End the break before clocking out.';
    render(<PunchCard companyId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Clock out/ }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('On break. End the break before clocking out.');
  });

  it('tells somebody with no employee record what to do about it', async () => {
    hoisted.mine = null;
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByText(/no employee record in this company/)).toBeInTheDocument();
  });

  it('shows the job they are on', async () => {
    hoisted.mine = row({ standing: 'On the clock', state: 'in', projectName: 'North Yard' });
    render(<PunchCard companyId="c1" />);
    expect(await screen.findByText('North Yard')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('the board', () => {
  it('counts who is on rather than making somebody count the rows', async () => {
    hoisted.board = [
      row({ employeeId: 'a', employeeName: 'Ana Ruiz', standing: 'On the clock' }),
      row({ employeeId: 'b', employeeName: 'Bo Neal', standing: 'On break' }),
      row({ employeeId: 'c', employeeName: 'Cy Park', standing: 'Off the clock' }),
    ];
    render(<TimeClockBoard companyId="c1" />);
    expect(await screen.findByText('2 of 3 on the clock.')).toBeInTheDocument();
  });

  it('says so plainly when nobody is on', async () => {
    hoisted.board = [row({ employeeId: 'c', standing: 'Off the clock' })];
    render(<TimeClockBoard companyId="c1" />);
    expect(await screen.findByText('Nobody is on the clock.')).toBeInTheDocument();
  });

  it('lists the people who have not punched, not only the ones who have', async () => {
    hoisted.board = [row({ employeeId: 'c', employeeName: 'Cy Park', standing: 'Off the clock' })];
    render(<TimeClockBoard companyId="c1" />);
    expect(await screen.findByText('Cy Park')).toBeInTheDocument();
  });
});

/**
 * The schedule page, live.
 *
 * It read a fixture that ran the *real* critical path engine over invented
 * activities at module load — a correct calculation of a job that does not
 * exist, under a real project number.
 *
 * The property worth protecting is not that the page renders rows. It is that
 * **null float is not zero float**. Float is null until the method has run, and
 * rendering that as `0` would say the opposite of the truth, because zero float
 * means an activity is on the critical path. Half these tests are about that
 * one distinction.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  ScheduleActivityRow, ScheduleCalculationRow, ResourceAssignmentRow, ProjectOption,
} from '@/lib/data/schedule';

const hoisted = vi.hoisted(() => ({
  configured: true,
  projects: [] as ProjectOption[],
  activities: [] as ScheduleActivityRow[],
  calculation: null as ScheduleCalculationRow | null,
  assignments: [] as ResourceAssignmentRow[],
  recalculated: [] as Array<[string, string]>,
  fail: null as string | null,
  can: true,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return hoisted.configured; },
  get supabase() { return hoisted.configured ? {} : null; },
}));

vi.mock('@/lib/data/session', () => ({
  usePermissions: () => ({ can: () => hoisted.can, loading: false }),
  useCompanyId: () => ({ companyId: 'co-1', loading: false }),
}));

vi.mock('@/lib/data/schedule', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/schedule')>('@/lib/data/schedule');
  return {
    ...actual,
    loadScheduleProjects: async () => hoisted.projects,
    loadScheduleActivities: () => async () => hoisted.activities,
    loadLatestScheduleCalculation: () => async () => hoisted.calculation,
    loadResourceAssignments: () => async () => hoisted.assignments,
    recalculateSchedule: async (c: string, p: string) => {
      if (hoisted.fail) throw new Error(hoisted.fail);
      hoisted.recalculated.push([c, p]);
      return { activities: 2, projectFinish: '2026-05-22', criticalCount: 1, warnings: [] };
    },
  };
});

const { SchedulePage } = await import('./schedule');

const activity = (over: Partial<ScheduleActivityRow> = {}): ScheduleActivityRow => ({
  id: 'a-1', wbsCode: '1.1', name: 'Strip topsoil',
  plannedStart: '2026-05-04', plannedFinish: '2026-05-08',
  actualStart: null, actualFinish: null,
  durationDays: 5, percentComplete: 0,
  totalFloatDays: null, freeFloatDays: null,
  earlyStart: null, earlyFinish: null, lateStart: null, lateFinish: null,
  calculationId: null,
  isCritical: false, isMilestone: false, crewName: null,
  constraintType: null, constraintDate: null, sortOrder: 10, ...over,
});

const calculation = (over: Partial<ScheduleCalculationRow> = {}): ScheduleCalculationRow => ({
  id: 'c-1', dataDate: '2026-05-04', engineVersion: 'grounup-engine/schedule@1',
  projectStart: '2026-05-04', projectFinish: '2026-05-22',
  durationWorkingDays: 15, requiredFinish: null, finishFloatDays: null,
  criticalPath: ['a-1'], warnings: [], calculatedAt: '2026-05-04T12:00:00Z', ...over,
});

const show = () => render(<MemoryRouter><SchedulePage /></MemoryRouter>);

beforeEach(() => {
  hoisted.configured = true;
  hoisted.can = true;
  hoisted.projects = [{ id: 'p-1', number: 'PRJ-2026-0011', name: 'Maumee Commerce Park', status: 'active' }];
  hoisted.activities = [activity()];
  hoisted.calculation = null;
  hoisted.assignments = [];
  hoisted.recalculated = []; hoisted.fail = null;
});

describe('a schedule nobody has calculated', () => {
  it('says so rather than showing zeros', async () => {
    show();
    expect(await screen.findByText(/has not been calculated/i)).toBeTruthy();
    expect(screen.getByText(/showing zero would say the opposite of the truth/i)).toBeTruthy();
  });

  it('shows the float column as not calculated, never as a number', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Strip topsoil')).toBeTruthy());
    expect(screen.getByText('not calculated')).toBeTruthy();
  });

  it('leaves the critical-path tile as an em dash rather than zero', async () => {
    /*
     * "0 critical activities" and "nobody has looked" are different facts, and
     * a tile reading 0 is the one that gets believed.
     */
    show();
    await waitFor(() => expect(screen.getByText('Critical path')).toBeTruthy());
    expect(screen.getByText('not calculated yet')).toBeTruthy();
  });

  it('still shows the planned window, because somebody did plan it', async () => {
    show();
    await waitFor(() =>
      expect(screen.getByText(/as planned\. Nobody has run the critical path/i)).toBeTruthy());
  });
});

describe('a schedule that has been calculated', () => {
  beforeEach(() => {
    hoisted.calculation = calculation();
    hoisted.activities = [
      activity({ totalFloatDays: 0, freeFloatDays: 0, isCritical: true, calculationId: 'c-1' }),
      activity({ id: 'a-2', wbsCode: '1.2', name: 'Mass excavation',
        plannedStart: '2026-05-11', plannedFinish: '2026-05-22',
        totalFloatDays: 3, freeFloatDays: 1, calculationId: 'c-1' }),
    ];
  });

  it('names the engine and the data date it was calculated from', async () => {
    show();
    expect(await screen.findByText(/grounup-engine\/schedule@1/)).toBeTruthy();
  });

  it('shows total float, and free float only where the two differ', async () => {
    /*
     * Free float is the slip that moves nobody else. Where it equals total
     * float the second number says nothing; where it differs, that difference
     * is the whole question of who else is affected.
     */
    show();
    await waitFor(() => expect(screen.getByText('Mass excavation')).toBeTruthy());
    expect(screen.getByText('1 free')).toBeTruthy();
    expect(screen.queryByText('0 free')).toBeNull();
  });

  it('narrows to the critical path when the tile is pressed', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByText('Mass excavation')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /only the activities on the critical path/i }));
    await waitFor(() => expect(screen.queryByText('Mass excavation')).toBeNull());
    expect(screen.getByText('Strip topsoil')).toBeTruthy();
  });

  it('puts every activity back', async () => {
    /* Carried over from the test this file replaced: the critical-path tile is
       a toggle, and a filter with no way out is a trap. */
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByText('Mass excavation')).toBeTruthy());
    const tile = screen.getByRole('button', { name: /only the activities on the critical path/i });
    await user.click(tile);
    await waitFor(() => expect(screen.queryByText('Mass excavation')).toBeNull());
    await user.click(tile);
    await waitFor(() => expect(screen.getByText('Mass excavation')).toBeTruthy());
  });

  it('opens resource loading from the two boxes that count resources', async () => {
    // Also carried over. A number on a tile answers the question it raises.
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByText('Crew assignments')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Show the crew loading/i }));
    expect(await screen.findByText('Crew loading')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /^Schedule$/i }));
    await user.click(screen.getByRole('button', { name: /Show the equipment assignments/i }));
    /* "Equipment assignments" is both the tile label and the card title, so the
       assertion is on text only the card carries. */
    expect(await screen.findByText(/Which machine is on which activity/i)).toBeTruthy();
  });

  it('shows every warning the engine reported', async () => {
    hoisted.calculation = calculation({
      warnings: ['Activity 1.2 has no predecessor', 'Constraint on 1.4 cannot be met'],
    });
    show();
    expect(await screen.findByText(/has no predecessor/)).toBeTruthy();
    expect(screen.getByText(/cannot be met/)).toBeTruthy();
  });

  it('says which side of the required date the job lands on', async () => {
    hoisted.calculation = calculation({ requiredFinish: '2026-05-15', finishFloatDays: -5 });
    show();
    expect(await screen.findByText(/5 working\s+days after the date required/i)).toBeTruthy();
  });
});

describe('calculating', () => {
  it('asks the engine rather than computing in the browser', async () => {
    const user = userEvent.setup();
    show();
    await waitFor(() => expect(screen.getByText('Strip topsoil')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Calculate the schedule/i }));
    await waitFor(() => expect(hoisted.recalculated).toEqual([['co-1', 'p-1']]));
  });

  it('shows what the engine refused rather than pretending it worked', async () => {
    const user = userEvent.setup();
    hoisted.fail = 'This company has no work calendar, so a duration in days is not yet a span of dates.';
    show();
    await waitFor(() => expect(screen.getByText('Strip topsoil')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Calculate the schedule/i }));
    expect(await screen.findByText(/no work calendar/i)).toBeTruthy();
  });

  it('offers nothing to calculate when there are no activities', async () => {
    hoisted.activities = [];
    show();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Calculate the schedule/i })
        .hasAttribute('disabled')).toBe(true));
  });

  it('is not offered without permission to change the project', async () => {
    hoisted.can = false;
    show();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Calculate the schedule/i })
        .hasAttribute('disabled')).toBe(true));
  });
});

describe('resource loading', () => {
  beforeEach(() => {
    hoisted.assignments = [
      { id: 'r-1', activityId: 'a-1', activityName: 'Strip topsoil', kind: 'asset',
        resourceName: 'Cat 336 Excavator', assetCode: 'EX-4412', assetId: 'as-1',
        startsOn: '2026-05-04', endsOn: '2026-05-08', allocation: 0.5, notes: null },
      { id: 'r-2', activityId: 'a-1', activityName: 'Strip topsoil', kind: 'crew',
        resourceName: 'Excavation Crew A', assetCode: null, assetId: null,
        startsOn: '2026-05-04', endsOn: '2026-05-08', allocation: 1, notes: null },
    ];
  });

  it('makes the asset code a link, because a reference is a link', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Resource loading/i }));
    const link = await screen.findByRole('link', { name: 'EX-4412' });
    expect(link.getAttribute('href')).toContain('as-1');
  });

  it('shows the fraction of a machine an assignment consumes', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Resource loading/i }));
    await waitFor(() => expect(screen.getByText('50%')).toBeTruthy());
  });

  it('separates the people from the machines', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Resource loading/i }));
    const crew = (await screen.findByText('Crew loading')).closest('div[class*="rounded"]')!;
    expect(within(crew as HTMLElement).getByText('Excavation Crew A')).toBeTruthy();
  });
});

describe('without a workspace', () => {
  it('says it is a demonstration rather than showing invented activities', async () => {
    hoisted.configured = false;
    show();
    await waitFor(() => expect(screen.queryByText('Strip topsoil')).toBeNull());
  });
});

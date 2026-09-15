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
  ScheduleDependencyRow, AssignableResource, SchedulableProject,
  ScheduleBaselineRow, ScheduleVarianceRow,
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
  dependencies: [] as ScheduleDependencyRow[],
  resources: [] as AssignableResource[],
  schedulable: null as SchedulableProject | null,
  baselines: [] as ScheduleBaselineRow[],
  variance: [] as ScheduleVarianceRow[],
  /* What the page actually asked the database to do, in order. */
  wrote: [] as Array<[string, unknown]>,
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
    loadScheduleDependencies: () => async () => hoisted.dependencies,
    loadAssignableResources: async () => hoisted.resources,
    loadSchedulable: () => async () => hoisted.schedulable,
    loadWorkCalendars: async () => [],
    loadScheduleBaselines: () => async () => hoisted.baselines,
    loadScheduleVariance: () => async () => hoisted.variance,
    takeScheduleBaseline: async (_c: unknown, input: unknown) => {
      hoisted.wrote.push(['baseline', input]); return 'new-b';
    },
    buildScheduleFromTasks: async (_c: unknown, project: string, start: string | null) => {
      hoisted.wrote.push(['build', { project, start }]);
      return 3;
    },
    addScheduleActivity: async (_c: unknown, input: unknown) => {
      hoisted.wrote.push(['add-activity', input]); return 'new-a';
    },
    updateScheduleActivity: async (_c: unknown, input: unknown) => {
      hoisted.wrote.push(['update-activity', input]);
    },
    removeScheduleActivity: async (_c: unknown, id: unknown) => {
      hoisted.wrote.push(['remove-activity', id]);
    },
    addScheduleDependency: async (_c: unknown, input: unknown) => {
      hoisted.wrote.push(['link', input]); return 'new-d';
    },
    updateScheduleDependency: async (_c: unknown, input: unknown) => {
      hoisted.wrote.push(['relink', input]);
    },
    removeScheduleDependency: async (_c: unknown, id: unknown) => {
      hoisted.wrote.push(['unlink', id]);
    },
    assignResource: async (_c: unknown, input: unknown) => {
      hoisted.wrote.push(['assign', input]); return 'new-r';
    },
    releaseResource: async (_c: unknown, id: unknown) => {
      hoisted.wrote.push(['release', id]);
    },
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
  constraintType: null, constraintDate: null, sortOrder: 10,
  projectTaskId: null, updatedAt: '2026-05-01T00:00:00Z', ...over,
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
  hoisted.projects = [{ id: 'p-1', number: 'PRJ-2026-0011', name: 'Maumee Commerce Park', status: 'active', plannedStart: '2026-05-04' }];
  hoisted.activities = [activity()];
  hoisted.calculation = null;
  hoisted.assignments = [];
  hoisted.recalculated = []; hoisted.fail = null;
  hoisted.dependencies = []; hoisted.resources = [];
  hoisted.schedulable = null; hoisted.wrote = [];
  hoisted.baselines = []; hoisted.variance = [];
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

/**
 * The doors, added by migration 0183.
 *
 * Until it, nothing anywhere wrote an activity, a dependency, a resource
 * assignment or a working week. The engine was finished, tested and deployed,
 * the governance around it was written twice, and the page that showed the
 * result could never have anything to show.
 */
describe('building a schedule that did not exist', () => {
  it('offers to build activities from the tasks that were budgeted', async () => {
    hoisted.activities = [];
    hoisted.schedulable = { taskCount: 3, unscheduledTaskCount: 3, activityCount: 0 };
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Build 3 activities/i }));
    await waitFor(() => expect(hoisted.wrote[0]![0]).toBe('build'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ project: 'p-1' });
  });

  it('does not offer when every task already has an activity', async () => {
    hoisted.schedulable = { taskCount: 3, unscheduledTaskCount: 0, activityCount: 3 };
    show();
    await screen.findByText('Strip topsoil');
    expect(screen.queryByRole('button', { name: /Build .* activit/i })).toBeNull();
  });

  it('offers to add an activity that came from no priced line', async () => {
    hoisted.activities = [];
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Add an activity/i }));
    await user.type(screen.getByLabelText(/What it is/i), 'Await permit');
    await user.click(screen.getByLabelText(/a milestone/i));
    await user.click(screen.getByRole('button', { name: /^Add it$/i }));
    await waitFor(() => expect(hoisted.wrote[0]![0]).toBe('add-activity'));
    expect(hoisted.wrote[0]![1]).toMatchObject({ name: 'Await permit', isMilestone: true });
  });

  it('opens the activity under its own row', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Strip topsoil/ }));
    expect((await screen.findByLabelText('Activity')).getAttribute('value')).toBe('Strip topsoil');
  });

  it('saves a moved bar without touching the float', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Strip topsoil/ }));
    await user.click(await screen.findByRole('button', { name: /Save the activity/i }));
    await waitFor(() => expect(hoisted.wrote[0]![0]).toBe('update-activity'));
    const sent = hoisted.wrote[0]![1] as Record<string, unknown>;
    /* The engine owns these. A form that sent one would be the hole 0158 closes. */
    expect(Object.keys(sent)).not.toContain('totalFloatDays');
    expect(Object.keys(sent)).not.toContain('isCritical');
    expect(Object.keys(sent)).not.toContain('calculationId');
  });

  it('links one activity to another', async () => {
    hoisted.activities = [activity(), activity({ id: 'a-2', name: 'Place base', wbsCode: '1.2' })];
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Strip topsoil/ }));
    await user.selectOptions(await screen.findByLabelText(/Add a predecessor/i), 'a-2');
    await user.click(screen.getByRole('button', { name: /^Link$/i }));
    await waitFor(() => expect(hoisted.wrote[0]![0]).toBe('link'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      predecessorId: 'a-2', successorId: 'a-1', type: 'finish_to_start',
    });
  });

  it('says what an activity waits on, and what waits on it', async () => {
    hoisted.activities = [activity(), activity({ id: 'a-2', name: 'Place base' })];
    hoisted.dependencies = [{
      id: 'd-1', predecessorId: 'a-1', successorId: 'a-2',
      dependencyType: 'finish_to_start', lagDays: 2,
    }];
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Strip topsoil/ }));
    expect(await screen.findByText(/1 activity waits on this one: Place base/i)).toBeTruthy();
  });

  it('puts a crew on an activity', async () => {
    hoisted.resources = [{ id: 'c-1', kind: 'crew', label: 'Dirt crew', code: 'C1' }];
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Strip topsoil/ }));
    await user.selectOptions(await screen.findByLabelText(/Put somebody on it/i), 'crew:c-1');
    await user.click(screen.getByRole('button', { name: /^Assign$/i }));
    await waitFor(() => expect(hoisted.wrote[0]![0]).toBe('assign'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      activityId: 'a-1', kind: 'crew', crewId: 'c-1', allocation: 1,
    });
  });

  it('says the float is from an earlier plan rather than blanking it', async () => {
    hoisted.activities = [activity({
      calculationId: 'calc-1', totalFloatDays: 4,
      updatedAt: '2026-05-10T12:00:00Z',
    })];
    hoisted.calculation = {
      id: 'calc-1', dataDate: '2026-05-04', engineVersion: 'engine@1',
      projectStart: '2026-05-04', projectFinish: '2026-05-22',
      durationWorkingDays: 15, requiredFinish: null, finishFloatDays: null,
      criticalPath: [], warnings: [], calculatedAt: '2026-05-05T12:00:00Z',
    };
    show();
    expect(await screen.findByText(/changed since the last calculation/i)).toBeTruthy();
    /* The number itself is still on screen. Old and readable beats erased. */
    await waitFor(() => expect(screen.getAllByText('4').length).toBeGreaterThan(0));
  });

  it('does not call a float stale when nobody has moved it', async () => {
    hoisted.activities = [activity({
      calculationId: 'calc-1', totalFloatDays: 4,
      updatedAt: '2026-05-05T12:00:00Z',
    })];
    hoisted.calculation = {
      id: 'calc-1', dataDate: '2026-05-04', engineVersion: 'engine@1',
      projectStart: '2026-05-04', projectFinish: '2026-05-22',
      durationWorkingDays: 15, requiredFinish: null, finishFloatDays: null,
      criticalPath: [], warnings: [], calculatedAt: '2026-05-05T12:00:00Z',
    };
    show();
    await screen.findByText('Strip topsoil');
    expect(screen.queryByText(/changed since the last calculation/i)).toBeNull();
  });

  it('opens the working week, which the engine refuses to calculate without', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('tab', { name: /Working week/i }));
    expect(await screen.findByText(/refuses to calculate a schedule without it/i)).toBeTruthy();
  });
});

/**
 * A baseline somebody took.
 *
 * `reporting_schedule_variance` has existed since 0029 and returned no rows on
 * every project, because it joins the current baseline and nothing could take
 * one.
 */
describe('baselining', () => {
  const openBaseline = async (user: ReturnType<typeof userEvent.setup>) => {
    show();
    await user.click(await screen.findByRole('tab', { name: /Against the baseline/i }));
  };

  it('will not offer a baseline of a schedule nobody has calculated', async () => {
    const user = userEvent.setup();
    await openBaseline(user);
    const button = await screen.findByRole('button', { name: /Take a baseline/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toMatch(/Calculate the schedule first/i);
  });

  it('takes one once the method has run, and insists on a reason', async () => {
    hoisted.activities = [activity({ calculationId: 'calc-1', totalFloatDays: 0, isCritical: true })];
    hoisted.calculation = {
      id: 'calc-1', dataDate: '2026-05-04', engineVersion: 'engine@1',
      projectStart: '2026-05-04', projectFinish: '2026-05-22',
      durationWorkingDays: 15, requiredFinish: null, finishFloatDays: null,
      criticalPath: [], warnings: [], calculatedAt: '2026-05-05T12:00:00Z',
    };
    const user = userEvent.setup();
    await openBaseline(user);
    await user.click(await screen.findByRole('button', { name: /Take a baseline/i }));
    await user.type(screen.getByLabelText(/Call it/i), 'Original');

    /* Eight characters is the floor: "why" is not a reason six months later. */
    const take = screen.getByRole('button', { name: /Take the baseline/i });
    expect(take.hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/Why it is being taken/i), 'Contract award baseline');
    await user.click(screen.getByRole('button', { name: /Take the baseline/i }));
    await waitFor(() => expect(hoisted.wrote[0]?.[0]).toBe('baseline'));
    expect(hoisted.wrote[0]![1]).toMatchObject({
      projectId: 'p-1', name: 'Original', reason: 'Contract award baseline',
    });
  });

  it('says a slip on the critical path is the finish date moving', async () => {
    hoisted.variance = [{
      activityId: 'a-1', activityName: 'Strip topsoil', wbsCode: '1.1',
      baselineStart: '2026-05-04', baselineFinish: '2026-05-08',
      currentStart: '2026-05-11', currentFinish: '2026-05-15',
      startVarianceDays: 7, finishVarianceDays: 7, status: 'behind',
      isCritical: true, percentComplete: 0.25,
    }];
    const user = userEvent.setup();
    await openBaseline(user);
    expect(await screen.findByText(/that slip is the finish date moving/i)).toBeTruthy();
    expect(screen.getByText('+7')).toBeTruthy();
  });

  it('marks an activity added after the baseline rather than calling it on time', async () => {
    hoisted.variance = [{
      activityId: 'a-2', activityName: 'Await permit', wbsCode: null,
      baselineStart: null, baselineFinish: null,
      currentStart: '2026-06-01', currentFinish: '2026-06-05',
      startVarianceDays: null, finishVarianceDays: null, status: 'not_in_baseline',
      isCritical: false, percentComplete: 0,
    }];
    const user = userEvent.setup();
    await openBaseline(user);
    expect(await screen.findByText('Added since')).toBeTruthy();
  });
});

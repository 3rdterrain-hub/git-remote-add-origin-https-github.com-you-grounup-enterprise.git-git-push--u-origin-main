/**
 * Critical path scheduling.
 *
 * Every expected date here was worked out by hand against a 2026 calendar
 * before the code was run. 2026-05-04 is a Monday; 2026-05-08 a Friday;
 * 2026-05-25 is Memorial Day.
 */
import { describe, expect, it } from 'vitest';
import {
  ScheduleCycleError, ScheduleInputError, calculateSchedule, compareToBaseline,
} from '../src/schedule.js';
import type { ScheduleBaseline, ScheduleInput, ScheduleResult } from '../src/schedule.js';
import { STANDARD_WORK_WEEK, standardCalendar } from '../src/calendar.js';
import type { WorkCalendar } from '../src/calendar.js';

const FIVE_DAY = standardCalendar('five', 'Five-day week');
const SIX_DAY: WorkCalendar = { id: 'six', name: 'Six-day week', workingWeekdays: [1, 2, 3, 4, 5, 6] };
const WITH_HOLIDAY: WorkCalendar = {
  id: 'holiday', name: 'Five-day week with Memorial Day',
  workingWeekdays: STANDARD_WORK_WEEK, holidays: ['2026-05-25'],
};

function schedule(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    dataDate: '2026-05-04',
    calendars: [FIVE_DAY],
    defaultCalendarId: 'five',
    activities: [],
    dependencies: [],
    ...over,
  };
}

const act = (id: string, durationDays: number, over = {}) =>
  ({ id, name: id, durationDays, ...over });
const fs = (predecessorId: string, successorId: string, lagDays = 0) =>
  ({ predecessorId, successorId, type: 'finish_to_start' as const, lagDays });

const by = (result: ScheduleResult, id: string) =>
  result.activities.find((a) => a.id === id)!;

describe('the forward pass', () => {
  it('starts the first activity at the data date and runs it in working days', () => {
    // Five days from Monday finishes Friday, not the following Monday.
    const r = calculateSchedule(schedule({ activities: [act('A', 5)] }));
    expect(by(r, 'A').earlyStart).toBe('2026-05-04');
    expect(by(r, 'A').earlyFinish).toBe('2026-05-08');
  });

  it('finishes a one-day activity the day it starts', () => {
    const r = calculateSchedule(schedule({ activities: [act('A', 1)] }));
    expect(by(r, 'A').earlyFinish).toBe('2026-05-04');
  });

  it('gives a milestone one date and no span', () => {
    const r = calculateSchedule(schedule({ activities: [act('M', 0)] }));
    expect(by(r, 'M').earlyStart).toBe('2026-05-04');
    expect(by(r, 'M').earlyFinish).toBe('2026-05-04');
    expect(by(r, 'M').isMilestone).toBe(true);
  });

  it('starts a successor the next working day, not the day the predecessor ends', () => {
    // This is the one people get wrong. A finishes Friday; B starts Monday.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 5)],
      dependencies: [fs('A', 'B')],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-11');
    expect(by(r, 'B').earlyFinish).toBe('2026-05-15');
  });

  it('waits out a lag in working days', () => {
    // A finishes Friday 8th; two days of lag put B on Wednesday 13th.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 3)],
      dependencies: [fs('A', 'B', 2)],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-13');
  });

  it('accepts a negative lag as a lead', () => {
    // Lag moves the successor from where it would otherwise start, which is
    // Monday the 11th. Two working days earlier is Thursday the 7th — not the
    // 6th, which is what counting back from A's finish would give.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 3)],
      dependencies: [fs('A', 'B', -2)],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-07');
  });

  it('takes the latest of several predecessors', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 2), act('C', 3)],
      dependencies: [fs('A', 'C'), fs('B', 'C')],
    }));
    expect(by(r, 'C').earlyStart).toBe('2026-05-11');
    expect(by(r, 'C').drivingPredecessorId).toBe('A');
  });

  it('works around a holiday, not through it', () => {
    // Friday 22nd plus four more working days: Monday the 25th is Memorial
    // Day, so the finish lands Friday the 29th.
    const r = calculateSchedule(schedule({
      calendars: [WITH_HOLIDAY], defaultCalendarId: 'holiday',
      dataDate: '2026-05-22', activities: [act('A', 5)],
    }));
    expect(by(r, 'A').earlyFinish).toBe('2026-05-29');
  });

  it('starts on the first working day when the data date is a Saturday', () => {
    const r = calculateSchedule(schedule({ dataDate: '2026-05-09', activities: [act('A', 1)] }));
    expect(by(r, 'A').earlyStart).toBe('2026-05-11');
  });
});

describe('the other three relationships', () => {
  it('start-to-start begins the successor once the predecessor has begun', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 10), act('B', 3)],
      dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'start_to_start', lagDays: 2 }],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-06');
  });

  it('finish-to-finish holds the successor open until the predecessor is done', () => {
    // A finishes Friday the 8th, so B must too; B is three days, so it starts
    // Wednesday the 6th.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 3)],
      dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'finish_to_finish', lagDays: 0 }],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-06');
    expect(by(r, 'B').earlyFinish).toBe('2026-05-08');
  });

  it('start-to-finish stops the successor finishing before the predecessor starts', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5, { constraintType: 'start_no_earlier', constraintDate: '2026-05-11' }), act('B', 2)],
      dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'start_to_finish', lagDays: 0 }],
    }));
    // A cannot start before the 11th, so B cannot finish before it.
    expect(by(r, 'B').earlyFinish).toBe('2026-05-11');
    expect(by(r, 'B').earlyStart).toBe('2026-05-08');
  });

  it('lets a finish-driven bound override a start-driven one', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 10), act('B', 8), act('C', 2)],
      dependencies: [
        fs('A', 'C'),
        { predecessorId: 'B', successorId: 'C', type: 'finish_to_finish', lagDays: 5 },
      ],
    }));
    // A finishes 15th so C could start the 18th; B finishes the 13th and five
    // days of lag hold C's finish to the 20th, which starts it on the 19th.
    expect(by(r, 'C').earlyFinish).toBe('2026-05-20');
    expect(by(r, 'C').earlyStart).toBe('2026-05-19');
  });
});

describe('float and the critical path', () => {
  const parallel = schedule({
    activities: [act('A', 5), act('B', 5), act('C', 2), act('D', 3)],
    dependencies: [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')],
  });

  it('finds zero float on the longest path', () => {
    const r = calculateSchedule(parallel);
    for (const id of ['A', 'B', 'D']) {
      expect(by(r, id).totalFloatDays, id).toBe(0);
      expect(by(r, id).isCritical, id).toBe(true);
    }
  });

  it('finds float on the shorter parallel path', () => {
    // C is two days against B's five, so it can slip three days.
    const r = calculateSchedule(parallel);
    expect(by(r, 'C').totalFloatDays).toBe(3);
    expect(by(r, 'C').isCritical).toBe(false);
  });

  it('reports free float as the slip that moves nobody else', () => {
    const r = calculateSchedule(parallel);
    // C's only successor is D, which cannot start earlier anyway, so C's free
    // float equals its total float here.
    expect(by(r, 'C').freeFloatDays).toBe(3);
    expect(by(r, 'B').freeFloatDays).toBe(0);
  });

  it('separates free float from total float when a successor is not the constraint', () => {
    // E follows C but is itself far from critical: C can move without moving
    // E's early start by less than its own total float.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 10), act('C', 2), act('E', 1), act('D', 3)],
      dependencies: [fs('A', 'B'), fs('A', 'C'), fs('C', 'E'), fs('B', 'D'), fs('E', 'D')],
    }));
    // C can slip seven working days before D moves, but not one day before E
    // moves: total float and free float are different questions.
    expect(by(r, 'C').freeFloatDays).toBe(0);
    expect(by(r, 'C').totalFloatDays).toBe(7);
  });

  it('returns the critical path as a chain, not a bag of zero-float activities', () => {
    const r = calculateSchedule(parallel);
    expect(r.criticalPath).toEqual(['A', 'B', 'D']);
  });

  it('reports the project span in working days', () => {
    const r = calculateSchedule(parallel);
    expect(r.projectStart).toBe('2026-05-04');
    expect(r.projectFinish).toBe('2026-05-20');
    expect(r.durationWorkingDays).toBe(13);
  });

  it('never reports free float larger than total float', () => {
    const r = calculateSchedule(parallel);
    for (const a of r.activities) {
      expect(a.freeFloatDays, a.id).toBeLessThanOrEqual(Math.max(a.totalFloatDays, 0));
    }
  });
});

describe('a required finish date', () => {
  const late = schedule({
    activities: [act('A', 5), act('B', 5), act('C', 3)],
    dependencies: [fs('A', 'B'), fs('B', 'C')],
    requiredFinish: '2026-05-15',
  });

  it('produces negative float when the work does not fit', () => {
    // The chain finishes the 20th against a contract date of the 15th.
    const r = calculateSchedule(late);
    expect(r.projectFinish).toBe('2026-05-20');
    expect(r.finishFloatDays).toBe(-3);
    expect(by(r, 'A').totalFloatDays).toBe(-3);
  });

  it('says so in a warning rather than only in a number', () => {
    const r = calculateSchedule(late);
    expect(r.warnings.join(' ')).toContain('3 working days after the required finish');
  });

  it('produces positive float across the board when the date is generous', () => {
    const r = calculateSchedule({ ...late, requiredFinish: '2026-05-27' });
    expect(r.finishFloatDays).toBe(5);
    expect(by(r, 'C').totalFloatDays).toBe(5);
    expect(by(r, 'C').isCritical).toBe(false);
  });
});

describe('constraints', () => {
  it('holds an activity back to a start-no-earlier date', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 3, { constraintType: 'start_no_earlier', constraintDate: '2026-05-11' })],
    }));
    expect(by(r, 'A').earlyStart).toBe('2026-05-11');
  });

  it('snaps a constraint date that falls on a weekend', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 3, { constraintType: 'start_no_earlier', constraintDate: '2026-05-09' })],
    }));
    expect(by(r, 'A').earlyStart).toBe('2026-05-11');
  });

  it('does not pull an activity earlier than its logic', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 3, { constraintType: 'start_no_earlier', constraintDate: '2026-05-04' })],
      dependencies: [fs('A', 'B')],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-11');
  });

  it('honors a must-start-on that breaks the logic, and says that it did', () => {
    // Silently moving the date would hide the contradiction; silently keeping
    // the logic would ignore the instruction. Do what was asked, and say so.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 3, { constraintType: 'must_start_on', constraintDate: '2026-05-06' })],
      dependencies: [fs('A', 'B')],
    }));
    expect(by(r, 'B').earlyStart).toBe('2026-05-06');
    expect(r.warnings.join(' ')).toContain('The constraint was honored and the logic broken');
  });

  it('lets a finish-no-later date show up as float rather than moving work', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5, { constraintType: 'finish_no_later', constraintDate: '2026-05-06' })],
    }));
    expect(by(r, 'A').earlyFinish).toBe('2026-05-08');
    expect(by(r, 'A').totalFloatDays).toBe(-2);
  });

  it('refuses a constraint type with no date and a date with no type', () => {
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1, { constraintType: 'must_start_on' })],
    }))).toThrow(/constraint with no date/);
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1, { constraintDate: '2026-05-04' })],
    }))).toThrow(/constraint date with no constraint type/);
  });
});

describe('more than one calendar', () => {
  it('runs each activity on its own working week', () => {
    // A works six days a week, so six days from Monday lands on Saturday.
    const r = calculateSchedule(schedule({
      calendars: [FIVE_DAY, SIX_DAY],
      activities: [act('A', 6, { calendarId: 'six' }), act('B', 2)],
      dependencies: [fs('A', 'B')],
    }));
    expect(by(r, 'A').earlyFinish).toBe('2026-05-09');
    // B works five days, so the first day it can take up the work is Monday —
    // not Tuesday, which is what stepping a working day off Saturday would give.
    expect(by(r, 'B').earlyStart).toBe('2026-05-11');
  });

  it('refuses an activity naming a calendar nobody supplied', () => {
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1, { calendarId: 'nope' })],
    }))).toThrow(/names calendar nope/);
  });

  it('refuses a default calendar that is not among the calendars', () => {
    expect(() => calculateSchedule(schedule({
      defaultCalendarId: 'missing', activities: [act('A', 1)],
    }))).toThrow(/default calendar missing/);
  });
});

describe('what it refuses', () => {
  it('names the cycle rather than recursing into it', () => {
    const input = schedule({
      activities: [act('A', 1), act('B', 1), act('C', 1)],
      dependencies: [fs('A', 'B'), fs('B', 'C'), fs('C', 'A')],
    });
    expect(() => calculateSchedule(input)).toThrow(ScheduleCycleError);
    try {
      calculateSchedule(input);
    } catch (e) {
      expect((e as ScheduleCycleError).cycle).toEqual(['A', 'B', 'C', 'A']);
      expect((e as Error).message).toContain('A -> B -> C -> A');
    }
  });

  it('refuses a dependency on an activity that is not here', () => {
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1)], dependencies: [fs('A', 'ghost')],
    }))).toThrow(/successor ghost/);
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1)], dependencies: [fs('ghost', 'A')],
    }))).toThrow(/predecessor ghost/);
  });

  it('refuses two activities with the same id', () => {
    expect(() => calculateSchedule(schedule({ activities: [act('A', 1), act('A', 2)] })))
      .toThrow(/share the id A/);
  });

  it('refuses the same pair linked twice', () => {
    // Two links between one pair is a modeling choice tools disagree about.
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1), act('B', 1)],
      dependencies: [fs('A', 'B'), { predecessorId: 'A', successorId: 'B', type: 'start_to_start' }],
    }))).toThrow(/linked more than once/);
  });

  it('refuses a negative duration and an empty schedule', () => {
    expect(() => calculateSchedule(schedule({ activities: [act('A', -1)] }))).toThrow(ScheduleInputError);
    expect(() => calculateSchedule(schedule({ activities: [] }))).toThrow(/at least one activity/);
  });

  it('refuses a fractional lag', () => {
    expect(() => calculateSchedule(schedule({
      activities: [act('A', 1), act('B', 1)], dependencies: [fs('A', 'B', 0.5)],
    }))).toThrow(/lag is whole working days/);
  });

  it('rounds a fractional duration up and says that it did', () => {
    // Half a day has no finish date on a working-day calendar. Rounding is
    // defensible; rounding silently is not.
    const r = calculateSchedule(schedule({ activities: [act('A', 2.5)] }));
    expect(by(r, 'A').durationDays).toBe(3);
    expect(r.warnings.join(' ')).toContain('has no finish date on a working-day calendar');
  });
});

describe('the result explains itself', () => {
  it('gives every activity a derivation naming its driver', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 3)], dependencies: [fs('A', 'B')],
    }));
    expect(by(r, 'B').derivation).toContain('driven by A');
    expect(by(r, 'B').derivation).toContain('2026-05-11 to 2026-05-13');
    expect(by(r, 'A').derivation).toContain('starts at the data date');
  });

  it('produces the same answer twice, and the same answer from shuffled input', () => {
    // A schedule two people cannot reproduce is a schedule they cannot argue
    // about from the same evidence.
    const activities = [act('A', 5), act('B', 5), act('C', 2), act('D', 3)];
    const dependencies = [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')];
    const first = calculateSchedule(schedule({ activities, dependencies }));
    const again = calculateSchedule(schedule({ activities, dependencies }));
    const shuffled = calculateSchedule(schedule({
      activities: [...activities].reverse(), dependencies: [...dependencies].reverse(),
    }));
    expect(again).toEqual(first);
    const dates = (r: typeof first) => Object.fromEntries(
      r.activities.map((a) => [a.id, [a.earlyStart, a.earlyFinish, a.totalFloatDays]]));
    expect(dates(shuffled)).toEqual(dates(first));
    expect(shuffled.criticalPath).toEqual(first.criticalPath);
  });

  it('does not mutate the input it was given', () => {
    const activities = [act('A', 5)];
    const input = schedule({ activities });
    const before = JSON.stringify(input);
    calculateSchedule(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('measuring against a baseline', () => {
  const current = calculateSchedule(schedule({
    activities: [act('A', 5), act('B', 8), act('N', 2)],
    dependencies: [fs('A', 'B')],
  }));

  const baseline: ScheduleBaseline = {
    id: 'BL-1', name: 'Approved schedule', takenOn: '2026-04-20',
    activities: [
      { activityId: 'A', name: 'A', plannedStart: '2026-05-04', plannedFinish: '2026-05-08', durationDays: 5 },
      { activityId: 'B', name: 'B', plannedStart: '2026-05-11', plannedFinish: '2026-05-15', durationDays: 5 },
      { activityId: 'G', name: 'G', plannedStart: '2026-05-18', plannedFinish: '2026-05-19', durationDays: 2 },
    ],
  };

  it('reports an activity that has not moved as on baseline', () => {
    const v = compareToBaseline(current, baseline, FIVE_DAY);
    const a = v.activities.find((x) => x.activityId === 'A')!;
    expect(a.status).toBe('on_baseline');
    expect(a.finishVarianceDays).toBe(0);
  });

  it('measures slippage in working days', () => {
    // B was five days and is now eight, so it finishes three working days late.
    const v = compareToBaseline(current, baseline, FIVE_DAY);
    const b = v.activities.find((x) => x.activityId === 'B')!;
    expect(b.status).toBe('behind');
    expect(b.finishVarianceDays).toBe(3);
    expect(b.startVarianceDays).toBe(0);
    expect(v.behindCount).toBe(1);
  });

  it('separates scope change from slippage', () => {
    // An activity added since approval has not slipped; it did not exist.
    const v = compareToBaseline(current, baseline, FIVE_DAY);
    expect(v.activities.find((x) => x.activityId === 'N')!.status).toBe('not_in_baseline');
    expect(v.activities.find((x) => x.activityId === 'G')!.status).toBe('removed');
  });

  it('measures the project finish against the baseline finish', () => {
    // The baseline ended on the 19th with G in it. G has since been deleted,
    // and today's schedule ends the 20th. One day late is the right answer:
    // the comparison is against what was approved, not against what is left
    // of it — otherwise deleting work would read as finishing early.
    const v = compareToBaseline(current, baseline, FIVE_DAY);
    expect(v.projectFinishVarianceDays).toBe(1);
  });

  it('reports zero variance against a baseline of the same schedule', () => {
    const self: ScheduleBaseline = {
      id: 'BL-2', name: 'Self', takenOn: '2026-05-04',
      activities: current.activities.map((a) => ({
        activityId: a.id, name: a.name,
        plannedStart: a.earlyStart, plannedFinish: a.earlyFinish, durationDays: a.durationDays,
      })),
    };
    const v = compareToBaseline(current, self, FIVE_DAY);
    expect(v.behindCount).toBe(0);
    expect(v.aheadCount).toBe(0);
    expect(v.projectFinishVarianceDays).toBe(0);
    expect(v.activities.every((a) => a.status === 'on_baseline')).toBe(true);
  });
});

describe('modeling mistakes it names', () => {
  it('warns about an activity nothing waits on', () => {
    // Arithmetically its float is enormous and correct. Practically somebody
    // forgot a link, and it can never be critical however important it is.
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 20), act('LOOSE', 2)],
      dependencies: [fs('A', 'B'), fs('A', 'LOOSE')],
    }));
    expect(r.warnings.join(' ')).toContain('LOOSE has no successor');
    expect(by(r, 'LOOSE').totalFloatDays).toBeGreaterThan(10);
  });

  it('does not warn about the activity that ends the job', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 5)], dependencies: [fs('A', 'B')],
    }));
    expect(r.warnings).toEqual([]);
  });

  it('does not warn when every activity feeds the finish milestone', () => {
    const r = calculateSchedule(schedule({
      activities: [act('A', 5), act('B', 2), act('END', 0)],
      dependencies: [fs('A', 'END'), fs('B', 'END')],
    }));
    expect(r.warnings).toEqual([]);
  });
});

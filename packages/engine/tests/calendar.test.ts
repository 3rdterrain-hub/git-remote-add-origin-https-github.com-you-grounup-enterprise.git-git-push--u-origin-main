/**
 * Work calendar arithmetic.
 *
 * Every date in these tests was worked out from a real 2026 calendar:
 * 2026-05-04 is a Monday, 2026-05-08 a Friday, 2026-05-09 a Saturday.
 */
import { describe, expect, it } from 'vitest';
import {
  CalendarError, STANDARD_WORK_WEEK, addWorkingDays, assertCalendar, epochDay,
  isWorkingDay, isoFromEpochDay, nextWorkingDay, nonWorkingDaysIn, previousWorkingDay,
  standardCalendar, weekdayOf, workingDayDelta, workingDaysBetween,
} from '../src/calendar.js';
import type { WorkCalendar } from '../src/calendar.js';

const FIVE_DAY = standardCalendar();

const WITH_HOLIDAY: WorkCalendar = {
  id: 'us-oh', name: 'Ohio field calendar',
  workingWeekdays: STANDARD_WORK_WEEK,
  holidays: ['2026-05-25'], // Memorial Day, a Monday
};

const SIX_DAY: WorkCalendar = {
  id: 'six', name: 'Six-day summer week',
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};

describe('dates are integers, not clock readings', () => {
  it('round-trips a date through the epoch without moving it', () => {
    // The schedule screen carried a comment about toISOString() turning a
    // 4 May start into 3 May. This is the arithmetic that cannot do that.
    for (const iso of ['2026-01-01', '2026-05-04', '2026-12-31', '2024-02-29']) {
      expect(isoFromEpochDay(epochDay(iso))).toBe(iso);
    }
  });

  it('counts a day as exactly one', () => {
    expect(epochDay('2026-05-05') - epochDay('2026-05-04')).toBe(1);
  });

  it('reads the weekday in UTC', () => {
    expect(weekdayOf('2026-05-04')).toBe(1);
    expect(weekdayOf('2026-05-09')).toBe(6);
  });

  it('refuses a date that is not a date', () => {
    expect(() => epochDay('2026-02-30')).toThrow(CalendarError);
    expect(() => epochDay('2026-13-01')).toThrow(CalendarError);
    expect(() => epochDay('5/4/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => epochDay('2026-05-4')).toThrow(/YYYY-MM-DD/);
  });

  it('refuses a fractional epoch day', () => {
    expect(() => isoFromEpochDay(20578.5)).toThrow(/whole number/);
  });
});

describe('a calendar has to be usable', () => {
  it('refuses a calendar nobody could ever work on', () => {
    expect(() => assertCalendar({ id: 'x', name: 'x', workingWeekdays: [] }))
      .toThrow(/no working weekdays/);
  });

  it('refuses a date that is both a holiday and a working exception', () => {
    // Preferring one silently would make the calendar mean different things
    // to different readers.
    expect(() => assertCalendar({
      id: 'x', name: 'x', workingWeekdays: STANDARD_WORK_WEEK,
      holidays: ['2026-07-03'], workingExceptions: ['2026-07-03'],
    })).toThrow(/both a holiday and a working exception/);
  });

  it('refuses a weekday outside 0 to 6', () => {
    expect(() => assertCalendar({ id: 'x', name: 'x', workingWeekdays: [7 as 0] }))
      .toThrow(/invalid weekday/);
  });
});

describe('which days are worked', () => {
  it('works weekdays and not weekends', () => {
    expect(isWorkingDay(FIVE_DAY, '2026-05-08')).toBe(true);
    expect(isWorkingDay(FIVE_DAY, '2026-05-09')).toBe(false);
  });

  it('does not work a holiday that falls on a weekday', () => {
    expect(isWorkingDay(WITH_HOLIDAY, '2026-05-25')).toBe(false);
    expect(isWorkingDay(FIVE_DAY, '2026-05-25')).toBe(true);
  });

  it('works a Saturday that is named as an exception', () => {
    const saturdayShift: WorkCalendar = { ...FIVE_DAY, workingExceptions: ['2026-05-09'] };
    expect(isWorkingDay(saturdayShift, '2026-05-09')).toBe(true);
    expect(isWorkingDay(saturdayShift, '2026-05-16')).toBe(false);
  });
});

describe('walking to a working day', () => {
  it('leaves a working day where it is', () => {
    expect(nextWorkingDay(FIVE_DAY, '2026-05-04')).toBe('2026-05-04');
    expect(previousWorkingDay(FIVE_DAY, '2026-05-04')).toBe('2026-05-04');
  });

  it('steps a Saturday forward to Monday and back to Friday', () => {
    expect(nextWorkingDay(FIVE_DAY, '2026-05-09')).toBe('2026-05-11');
    expect(previousWorkingDay(FIVE_DAY, '2026-05-09')).toBe('2026-05-08');
  });

  it('steps over a holiday as well as a weekend', () => {
    // Friday 22 May, then a weekend, then Memorial Day: the next working day
    // is Tuesday 26 May.
    expect(nextWorkingDay(WITH_HOLIDAY, '2026-05-23')).toBe('2026-05-26');
  });
});

describe('adding working days', () => {
  it('adds within a week', () => {
    expect(addWorkingDays(FIVE_DAY, '2026-05-04', 4)).toBe('2026-05-08');
  });

  it('skips the weekend', () => {
    expect(addWorkingDays(FIVE_DAY, '2026-05-04', 5)).toBe('2026-05-11');
  });

  it('skips a holiday too', () => {
    // Friday 22 May + 1 working day = Tuesday 26 May, because Monday is a holiday.
    expect(addWorkingDays(WITH_HOLIDAY, '2026-05-22', 1)).toBe('2026-05-26');
  });

  it('counts Saturday on a six-day week', () => {
    expect(addWorkingDays(SIX_DAY, '2026-05-04', 5)).toBe('2026-05-09');
  });

  it('goes backwards', () => {
    expect(addWorkingDays(FIVE_DAY, '2026-05-11', -1)).toBe('2026-05-08');
    expect(addWorkingDays(FIVE_DAY, '2026-05-11', -5)).toBe('2026-05-04');
  });

  it('returns the same day for zero', () => {
    expect(addWorkingDays(FIVE_DAY, '2026-05-04', 0)).toBe('2026-05-04');
  });

  it('refuses to start from a day nobody works', () => {
    // "Five working days after Sunday" has two defensible answers. Refusing
    // the question is better than picking one silently.
    expect(() => addWorkingDays(FIVE_DAY, '2026-05-09', 1))
      .toThrow(/not a working day .* snap it with nextWorkingDay/);
  });

  it('refuses a fractional count', () => {
    expect(() => addWorkingDays(FIVE_DAY, '2026-05-04', 1.5)).toThrow(/whole/);
  });
});

describe('measuring working days', () => {
  it('is zero between a day and itself', () => {
    expect(workingDayDelta(FIVE_DAY, '2026-05-04', '2026-05-04')).toBe(0);
  });

  it('counts steps, not calendar days, across a weekend', () => {
    expect(workingDayDelta(FIVE_DAY, '2026-05-08', '2026-05-11')).toBe(1);
  });

  it('is negative going backwards', () => {
    expect(workingDayDelta(FIVE_DAY, '2026-05-11', '2026-05-08')).toBe(-1);
  });

  it('is the inverse of adding', () => {
    const from = '2026-05-04';
    for (const n of [0, 1, 3, 7, 20, -1, -6]) {
      const to = addWorkingDays(FIVE_DAY, from, n);
      expect(workingDayDelta(FIVE_DAY, from, to), `${n}`).toBe(n);
    }
  });

  it('counts an inclusive span', () => {
    expect(workingDaysBetween(FIVE_DAY, '2026-05-04', '2026-05-08')).toBe(5);
    expect(workingDaysBetween(FIVE_DAY, '2026-05-04', '2026-05-10')).toBe(5);
    expect(workingDaysBetween(FIVE_DAY, '2026-05-04', '2026-05-11')).toBe(6);
  });

  it('is zero for a backwards span rather than a negative count', () => {
    expect(workingDaysBetween(FIVE_DAY, '2026-05-11', '2026-05-04')).toBe(0);
  });

  it('names the days that were not worked', () => {
    // The answer to "why does a ten-day activity take three weeks".
    expect(nonWorkingDaysIn(WITH_HOLIDAY, '2026-05-22', '2026-05-26'))
      .toEqual(['2026-05-23', '2026-05-24', '2026-05-25']);
  });
});

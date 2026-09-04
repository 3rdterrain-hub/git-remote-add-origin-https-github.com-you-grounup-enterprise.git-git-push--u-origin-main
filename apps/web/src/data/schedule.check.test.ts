/**
 * The schedule screen shows a calculation, not a picture of one.
 *
 * Before the critical path engine existed, `totalFloatDays` and `isCritical`
 * were typed into this file. An activity claimed four days of float because
 * somebody wrote 4, and the screen displayed it exactly the way it displays a
 * derived figure — the same defect as a settings toggle that switches nothing.
 *
 * These tests hold the derivation in place. They are deliberately not a
 * re-implementation of the engine (which has its own 47 tests); they assert the
 * properties that would break first if the screen ever went back to reading
 * numbers somebody typed.
 */
import { describe, expect, it } from 'vitest';
import { SCHEDULE, SCHEDULE_CALCULATION, FIELD_CALENDAR } from './fleet';
import { isWorkingDay, workingDaysBetween } from '@grounup/engine';

describe('every date on the schedule screen is computed', () => {
  it('covers every activity exactly once', () => {
    expect(SCHEDULE_CALCULATION.activities).toHaveLength(SCHEDULE.length);
    expect(new Set(SCHEDULE.map((a) => a.id)).size).toBe(SCHEDULE.length);
  });

  it('takes each activity date from the calculation, not from this file', () => {
    for (const a of SCHEDULE) {
      const computed = SCHEDULE_CALCULATION.activities.find((c) => c.id === a.id)!;
      expect(a.plannedStart, a.id).toBe(computed.earlyStart);
      expect(a.plannedFinish, a.id).toBe(computed.earlyFinish);
      expect(a.totalFloatDays, a.id).toBe(computed.totalFloatDays);
      expect(a.isCritical, a.id).toBe(computed.isCritical);
    }
  });

  it('starts and finishes every activity on a day the crews work', () => {
    // The old hand-authored dates ran a 30-day activity straight through
    // Memorial Day. Nothing typed would have caught that.
    for (const a of SCHEDULE) {
      expect(isWorkingDay(FIELD_CALENDAR, a.plannedStart), `${a.id} start`).toBe(true);
      expect(isWorkingDay(FIELD_CALENDAR, a.plannedFinish), `${a.id} finish`).toBe(true);
    }
  });

  it('spans exactly as many working days as the activity is long', () => {
    for (const a of SCHEDULE) {
      if (a.isMilestone) {
        expect(a.plannedStart, a.id).toBe(a.plannedFinish);
        continue;
      }
      expect(workingDaysBetween(FIELD_CALENDAR, a.plannedStart, a.plannedFinish), a.id)
        .toBe(a.durationDays);
    }
  });

  it('works around the three holidays inside the job rather than through them', () => {
    // Memorial Day, Independence Day observed, Labor Day.
    const inside = FIELD_CALENDAR.holidays!.filter(
      (h) => h >= SCHEDULE_CALCULATION.projectStart && h <= SCHEDULE_CALCULATION.projectFinish);
    expect(inside).toHaveLength(3);
    for (const holiday of inside) {
      expect(isWorkingDay(FIELD_CALENDAR, holiday), holiday).toBe(false);
    }
  });
});

describe('float means what the screen says it means', () => {
  it('marks an activity critical exactly when it has no float', () => {
    for (const a of SCHEDULE) {
      expect(a.isCritical, a.id).toBe(a.totalFloatDays <= 0);
    }
  });

  it('never shows free float larger than total float', () => {
    for (const a of SCHEDULE) {
      expect(a.freeFloatDays, a.id).toBeLessThanOrEqual(Math.max(a.totalFloatDays, 0));
    }
  });

  it('finds a critical path that is a connected chain ending at the milestone', () => {
    const path = SCHEDULE_CALCULATION.criticalPath;
    expect(path.length).toBeGreaterThan(1);
    const last = SCHEDULE.find((a) => a.id === path[path.length - 1]);
    expect(last?.isMilestone).toBe(true);
    for (const id of path) {
      expect(SCHEDULE.find((a) => a.id === id)?.isCritical, id).toBe(true);
    }
  });

  it('leaves at least one activity off the critical path', () => {
    // A schedule where everything is critical usually means the logic is
    // missing, not that the job is that tight.
    expect(SCHEDULE.filter((a) => !a.isCritical).length).toBeGreaterThan(0);
  });

  it('gives every activity a derivation a person could check', () => {
    for (const a of SCHEDULE) {
      expect(a.derivation, a.id).toContain(a.plannedStart);
      expect(a.derivation, a.id).toContain('total float');
    }
  });
});

describe('the calculation itself is sound', () => {
  it('produces no warnings for this job', () => {
    expect(SCHEDULE_CALCULATION.warnings).toEqual([]);
  });

  it('ends on the last activity to finish', () => {
    const latest = SCHEDULE.reduce((max, a) => (a.plannedFinish > max ? a.plannedFinish : max),
      SCHEDULE[0]!.plannedFinish);
    expect(SCHEDULE_CALCULATION.projectFinish).toBe(latest);
  });

  it('reports a working-day span that agrees with the calendar', () => {
    expect(SCHEDULE_CALCULATION.durationWorkingDays).toBe(
      workingDaysBetween(FIELD_CALENDAR, SCHEDULE_CALCULATION.projectStart, SCHEDULE_CALCULATION.projectFinish));
  });
});

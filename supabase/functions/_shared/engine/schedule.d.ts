/**
 * Critical path scheduling.
 *
 * Before this module the platform stored `total_float_days` and `is_critical`
 * as columns and stored dependencies in a table, and nothing computed either.
 * The schedule screen showed float a person had typed. A check constraint
 * enforced that the two numbers agreed with each other, which is a real
 * guarantee about two values nobody derived.
 *
 * This is the derivation. Given activities, their durations, the logic between
 * them and the calendars they work on, it produces early and late dates, total
 * and free float, and the critical path — deterministically, with no clock and
 * no I/O, so the same inputs give the same dates on any machine.
 *
 * ## The four relationships
 *
 * All four are supported, with lag, and lag may be negative (a lead):
 *
 * | Type | Meaning | Forward | Backward |
 * |---|---|---|---|
 * | `finish_to_start` | the usual one: B starts after A finishes | `ES(B) ≥ the first working day after EF(A), + lag` | `LF(A) ≤ the last working day before LS(B) − lag` |
 * | `start_to_start` | B starts once A has started | `ES(B) ≥ ES(A) + lag` | `LS(A) ≤ LS(B) − lag` |
 * | `finish_to_finish` | B cannot finish before A does | `EF(B) ≥ EF(A) + lag` | `LF(A) ≤ LF(B) − lag` |
 * | `start_to_finish` | B cannot finish until A starts | `EF(B) ≥ ES(A) + lag` | `LS(A) ≤ LF(B) − lag` |
 *
 * The `+ 1` on finish-to-start is the part people get wrong. Finishing Friday
 * does not mean the successor starts Friday; it starts the next working day.
 * All of this arithmetic is in working days on the relevant calendar, never in
 * calendar days.
 *
 * ## What it refuses
 *
 * A cycle in the logic — A before B before A — is refused by name rather than
 * recursed into. So is a dependency pointing at an activity that does not
 * exist, and a duplicate activity id. A schedule that computes half its dates
 * and stops is worse than one that says why it cannot.
 */
import { type WorkCalendar } from './calendar.js';
export type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
export declare const DEPENDENCY_TYPES: readonly DependencyType[];
export type ConstraintType = 'start_no_earlier' | 'finish_no_later' | 'must_start_on' | 'must_finish_on';
export declare const CONSTRAINT_TYPES: readonly ConstraintType[];
export interface ScheduleActivity {
    id: string;
    name: string;
    /** Working days. Zero is a milestone: an event with a date and no span. */
    durationDays: number;
    /** Defaults to the schedule's calendar when absent. */
    calendarId?: string;
    constraintType?: ConstraintType;
    constraintDate?: string;
}
export interface ScheduleDependency {
    predecessorId: string;
    successorId: string;
    type: DependencyType;
    /** Working days on the successor's calendar. Negative is a lead. */
    lagDays?: number;
}
export interface ScheduleInput {
    /** Where the forward pass starts: the project start, or the update's data date. */
    dataDate: string;
    activities: readonly ScheduleActivity[];
    dependencies: readonly ScheduleDependency[];
    calendars: readonly WorkCalendar[];
    defaultCalendarId: string;
    /**
     * Contract completion, if there is one. The backward pass runs from here
     * instead of from the computed finish, which is what produces negative float
     * on a job that is already late — the number a scheduler actually needs.
     */
    requiredFinish?: string;
}
export interface ScheduledActivity {
    id: string;
    name: string;
    calendarId: string;
    durationDays: number;
    earlyStart: string;
    earlyFinish: string;
    lateStart: string;
    lateFinish: string;
    totalFloatDays: number;
    freeFloatDays: number;
    isCritical: boolean;
    isMilestone: boolean;
    /** Why the early start landed where it did, in one line. */
    drivingPredecessorId: string | null;
    derivation: string;
}
export interface ScheduleResult {
    activities: readonly ScheduledActivity[];
    projectStart: string;
    projectFinish: string;
    /** The longest connected chain of critical activities, in order. */
    criticalPath: readonly string[];
    durationWorkingDays: number;
    /** Working days between the computed finish and the required one. Negative is late. */
    finishFloatDays: number | null;
    warnings: readonly string[];
}
export declare class ScheduleCycleError extends Error {
    readonly cycle: readonly string[];
    constructor(cycle: readonly string[]);
}
export declare class ScheduleInputError extends Error {
    constructor(message: string);
}
/**
 * Run the critical path method over a set of activities.
 *
 * Pure: no clock, no I/O, no mutation of the input. The same inputs produce
 * the same dates, which is what makes a schedule something two people can
 * argue about from the same evidence.
 */
export declare function calculateSchedule(input: ScheduleInput): ScheduleResult;
/**
 * A baseline is the schedule as it was approved, kept so today's dates can be
 * read against it. Without one, "we are three weeks late" is an assertion.
 */
export interface BaselineActivity {
    activityId: string;
    name: string;
    plannedStart: string;
    plannedFinish: string;
    durationDays: number;
}
export interface ScheduleBaseline {
    id: string;
    name: string;
    /** The date the baseline was taken, carried as data rather than read from a clock. */
    takenOn: string;
    activities: readonly BaselineActivity[];
}
export interface ActivityVariance {
    activityId: string;
    name: string;
    baselineStart: string | null;
    baselineFinish: string | null;
    currentStart: string;
    currentFinish: string;
    /** Working days later than the baseline. Negative is early. */
    startVarianceDays: number | null;
    finishVarianceDays: number | null;
    status: 'on_baseline' | 'ahead' | 'behind' | 'not_in_baseline' | 'removed';
}
export interface ScheduleVariance {
    baselineId: string;
    activities: readonly ActivityVariance[];
    /** Working days the project finish has moved against the baseline. */
    projectFinishVarianceDays: number | null;
    behindCount: number;
    aheadCount: number;
}
/**
 * Compare a computed schedule against a baseline.
 *
 * Activities the baseline does not know about, and baseline activities that
 * have since been deleted, are both reported rather than skipped: a schedule
 * that grew twenty activities since approval has not slipped, it has changed
 * scope, and those are different conversations.
 */
export declare function compareToBaseline(result: ScheduleResult, baseline: ScheduleBaseline, calendar: WorkCalendar): ScheduleVariance;

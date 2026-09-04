/**
 * Work calendars, and date arithmetic that counts working days.
 *
 * A schedule is not calendar days. An activity of five days starting Monday
 * finishes Friday; starting Thursday it finishes the following Wednesday. Every
 * date in a construction schedule is the answer to "how many working days from
 * here", and getting that wrong moves a contract completion date.
 *
 * Two decisions shape this module:
 *
 *   * **Dates are `YYYY-MM-DD` strings, and arithmetic runs on integer epoch
 *     days.** No `Date` object crosses a function boundary and no local
 *     timezone is ever consulted. The schedule screen already carried a comment
 *     about `toISOString()` turning a 4 May start into 3 May; that class of bug
 *     cannot occur here, because the conversion is `Date.UTC` in and integer
 *     division out.
 *   * **A calendar is data, not code.** Working weekdays, holidays and
 *     exception working days are all supplied. A company that works Saturdays
 *     in summer, or shuts down for two weeks at Christmas, is a different
 *     calendar and not a different code path.
 */
/** Sunday is 0, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export declare const WEEKDAY_NAMES: readonly string[];
/** Monday through Friday. The default for anyone who does not say otherwise. */
export declare const STANDARD_WORK_WEEK: readonly Weekday[];
export interface WorkCalendar {
    id: string;
    name: string;
    /** Days of the week normally worked. At least one, or nothing can be scheduled. */
    workingWeekdays: readonly Weekday[];
    /** Non-working dates that fall on a working weekday: holidays, shutdowns. */
    holidays?: readonly string[];
    /** Working dates that fall on a non-working weekday: a scheduled Saturday. */
    workingExceptions?: readonly string[];
}
export declare class CalendarError extends Error {
    constructor(message: string);
}
/** Integer days since 1970-01-01, computed in UTC so no timezone applies. */
export declare function epochDay(iso: string): number;
/** The inverse of `epochDay`. */
export declare function isoFromEpochDay(day: number): string;
export declare function weekdayOf(iso: string): Weekday;
export declare function assertIsoDate(value: string): void;
/**
 * A calendar that cannot answer "is this a working day" is refused here rather
 * than at the point a schedule silently produces no dates.
 */
export declare function assertCalendar(calendar: WorkCalendar): void;
export declare function isWorkingDay(calendar: WorkCalendar, iso: string): boolean;
/** The given day if it works, otherwise the next one that does. */
export declare function nextWorkingDay(calendar: WorkCalendar, iso: string): string;
/** The given day if it works, otherwise the previous one that does. */
export declare function previousWorkingDay(calendar: WorkCalendar, iso: string): string;
/**
 * `count` working days from `from`, which must itself be a working day.
 *
 * Requiring a working-day anchor is deliberate. "Five working days after
 * Sunday" has two defensible answers depending on whether Sunday counts as
 * day zero, and a scheduler that quietly picks one produces dates nobody can
 * check. Snap with `nextWorkingDay` first and the question does not arise.
 */
export declare function addWorkingDays(calendar: WorkCalendar, from: string, count: number): string;
/**
 * Signed working days from `from` to `to`, both of which must be working days.
 *
 * `delta(d, d)` is 0, and `delta(Friday, Monday)` on a five-day week is 1 — it
 * counts steps, not calendar days, which is what float is measured in.
 */
export declare function workingDayDelta(calendar: WorkCalendar, from: string, to: string): number;
/** Inclusive count of working days in `[from, to]`. Zero if the range is backwards. */
export declare function workingDaysBetween(calendar: WorkCalendar, from: string, to: string): number;
/**
 * The non-working days a span crosses, named.
 *
 * A superintendent asking why a ten-day activity takes three weeks wants the
 * list, not the arithmetic.
 */
export declare function nonWorkingDaysIn(calendar: WorkCalendar, from: string, to: string): readonly string[];
/** Monday to Friday, no holidays. Named so a test or a seed can say what it means. */
export declare function standardCalendar(id?: string, name?: string): WorkCalendar;

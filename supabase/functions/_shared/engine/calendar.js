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
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday through Friday. The default for anyone who does not say otherwise. */
export const STANDARD_WORK_WEEK = [1, 2, 3, 4, 5];
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/**
 * How far the day-by-day searches will walk before giving up.
 *
 * A calendar whose holidays swallow every working day for years would
 * otherwise spin forever. Fifty years is longer than any construction schedule
 * and short enough to fail in milliseconds.
 */
const MAX_SEARCH_DAYS = 365 * 50;
const MS_PER_DAY = 86_400_000;
export class CalendarError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CalendarError';
    }
}
/** Integer days since 1970-01-01, computed in UTC so no timezone applies. */
export function epochDay(iso) {
    assertIsoDate(iso);
    const [y, m, d] = iso.split('-').map(Number);
    const ms = Date.UTC(y, m - 1, d);
    // A date like 2026-02-30 parses but normalizes; refuse it rather than
    // silently scheduling against 2 March.
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
        throw new CalendarError(`${iso} is not a real date.`);
    }
    return ms / MS_PER_DAY;
}
/** The inverse of `epochDay`. */
export function isoFromEpochDay(day) {
    if (!Number.isInteger(day)) {
        throw new CalendarError(`An epoch day must be a whole number, received ${day}.`);
    }
    return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}
export function weekdayOf(iso) {
    return new Date(epochDay(iso) * MS_PER_DAY).getUTCDay();
}
export function assertIsoDate(value) {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) {
        throw new CalendarError(`Expected a YYYY-MM-DD date, received ${JSON.stringify(value)}.`);
    }
}
/**
 * A calendar that cannot answer "is this a working day" is refused here rather
 * than at the point a schedule silently produces no dates.
 */
export function assertCalendar(calendar) {
    if (!calendar.id)
        throw new CalendarError('A work calendar needs an id.');
    if (calendar.workingWeekdays.length === 0) {
        throw new CalendarError(`Calendar ${calendar.id} has no working weekdays; nothing could ever be scheduled on it.`);
    }
    for (const w of calendar.workingWeekdays) {
        if (!Number.isInteger(w) || w < 0 || w > 6) {
            throw new CalendarError(`Calendar ${calendar.id} has an invalid weekday ${w}; expected 0 (Sunday) through 6.`);
        }
    }
    const holidays = new Set(calendar.holidays ?? []);
    for (const h of holidays)
        assertIsoDate(h);
    for (const e of calendar.workingExceptions ?? []) {
        assertIsoDate(e);
        if (holidays.has(e)) {
            // Silently preferring one would make the calendar's meaning depend on
            // which list the reader looked at first.
            throw new CalendarError(`Calendar ${calendar.id} lists ${e} as both a holiday and a working exception.`);
        }
    }
}
export function isWorkingDay(calendar, iso) {
    assertIsoDate(iso);
    if (calendar.workingExceptions?.includes(iso))
        return true;
    if (calendar.holidays?.includes(iso))
        return false;
    return calendar.workingWeekdays.includes(weekdayOf(iso));
}
function step(calendar, iso, direction) {
    let day = epochDay(iso);
    for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
        day += direction;
        const candidate = isoFromEpochDay(day);
        if (isWorkingDay(calendar, candidate))
            return candidate;
    }
    throw new CalendarError(`Calendar ${calendar.id} has no working day within 50 years ${direction > 0 ? 'after' : 'before'} ${iso}.`);
}
/** The given day if it works, otherwise the next one that does. */
export function nextWorkingDay(calendar, iso) {
    return isWorkingDay(calendar, iso) ? iso : step(calendar, iso, 1);
}
/** The given day if it works, otherwise the previous one that does. */
export function previousWorkingDay(calendar, iso) {
    return isWorkingDay(calendar, iso) ? iso : step(calendar, iso, -1);
}
/**
 * `count` working days from `from`, which must itself be a working day.
 *
 * Requiring a working-day anchor is deliberate. "Five working days after
 * Sunday" has two defensible answers depending on whether Sunday counts as
 * day zero, and a scheduler that quietly picks one produces dates nobody can
 * check. Snap with `nextWorkingDay` first and the question does not arise.
 */
export function addWorkingDays(calendar, from, count) {
    if (!Number.isInteger(count)) {
        throw new CalendarError(`Working days must be whole, received ${count}.`);
    }
    if (!isWorkingDay(calendar, from)) {
        throw new CalendarError(`${from} is not a working day on calendar ${calendar.id}; snap it with nextWorkingDay first.`);
    }
    if (count === 0)
        return from;
    const direction = count > 0 ? 1 : -1;
    let current = from;
    for (let i = 0; i < Math.abs(count); i++)
        current = step(calendar, current, direction);
    return current;
}
/**
 * Signed working days from `from` to `to`, both of which must be working days.
 *
 * `delta(d, d)` is 0, and `delta(Friday, Monday)` on a five-day week is 1 — it
 * counts steps, not calendar days, which is what float is measured in.
 */
export function workingDayDelta(calendar, from, to) {
    if (!isWorkingDay(calendar, from)) {
        throw new CalendarError(`${from} is not a working day on calendar ${calendar.id}.`);
    }
    if (!isWorkingDay(calendar, to)) {
        throw new CalendarError(`${to} is not a working day on calendar ${calendar.id}.`);
    }
    const fromDay = epochDay(from);
    const toDay = epochDay(to);
    if (fromDay === toDay)
        return 0;
    const direction = toDay > fromDay ? 1 : -1;
    let current = from;
    for (let i = 1; i <= MAX_SEARCH_DAYS; i++) {
        current = step(calendar, current, direction);
        if (current === to)
            return i * direction;
        if (direction > 0 ? epochDay(current) > toDay : epochDay(current) < toDay)
            break;
    }
    throw new CalendarError(`Could not count working days from ${from} to ${to} on calendar ${calendar.id}.`);
}
/** Inclusive count of working days in `[from, to]`. Zero if the range is backwards. */
export function workingDaysBetween(calendar, from, to) {
    const fromDay = epochDay(from);
    const toDay = epochDay(to);
    if (toDay < fromDay)
        return 0;
    if (toDay - fromDay > MAX_SEARCH_DAYS) {
        throw new CalendarError(`The range ${from} to ${to} is longer than this module will count.`);
    }
    let count = 0;
    for (let day = fromDay; day <= toDay; day++) {
        if (isWorkingDay(calendar, isoFromEpochDay(day)))
            count++;
    }
    return count;
}
/**
 * The non-working days a span crosses, named.
 *
 * A superintendent asking why a ten-day activity takes three weeks wants the
 * list, not the arithmetic.
 */
export function nonWorkingDaysIn(calendar, from, to) {
    const fromDay = epochDay(from);
    const toDay = epochDay(to);
    if (toDay < fromDay)
        return [];
    if (toDay - fromDay > MAX_SEARCH_DAYS) {
        throw new CalendarError(`The range ${from} to ${to} is longer than this module will count.`);
    }
    const out = [];
    for (let day = fromDay; day <= toDay; day++) {
        const iso = isoFromEpochDay(day);
        if (!isWorkingDay(calendar, iso))
            out.push(iso);
    }
    return out;
}
/** Monday to Friday, no holidays. Named so a test or a seed can say what it means. */
export function standardCalendar(id = 'standard', name = 'Standard five-day week') {
    return { id, name, workingWeekdays: STANDARD_WORK_WEEK };
}

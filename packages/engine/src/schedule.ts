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

import {
  type WorkCalendar, addWorkingDays, assertCalendar, assertIsoDate, epochDay,
  isoFromEpochDay, isWorkingDay, nextWorkingDay, previousWorkingDay, workingDayDelta,
} from './calendar.js';

/**
 * The next and previous *calendar* days, used only by finish-to-start.
 *
 * Finish-to-start means "the day after the predecessor finishes", and that has
 * to be measured in calendar days before being snapped onto the successor's
 * calendar. Stepping a working day on the successor's calendar instead
 * overshoots whenever the two calendars differ: a predecessor finishing
 * Saturday on a six-day week snaps to Monday, and adding a working day on top
 * of that would start the successor on Tuesday for no reason.
 */
const dayAfter = (iso: string) => isoFromEpochDay(epochDay(iso) + 1);
const dayBefore = (iso: string) => isoFromEpochDay(epochDay(iso) - 1);

export type DependencyType =
  | 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';

export const DEPENDENCY_TYPES: readonly DependencyType[] =
  ['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'];

export type ConstraintType =
  | 'start_no_earlier' | 'finish_no_later' | 'must_start_on' | 'must_finish_on';

export const CONSTRAINT_TYPES: readonly ConstraintType[] =
  ['start_no_earlier', 'finish_no_later', 'must_start_on', 'must_finish_on'];

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

export class ScheduleCycleError extends Error {
  constructor(readonly cycle: readonly string[]) {
    super(
      `The schedule logic contains a cycle: ${cycle.join(' -> ')}. ` +
      'An activity cannot be its own predecessor, directly or through others.');
    this.name = 'ScheduleCycleError';
  }
}

export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}

/** Whole working days. A part day has no finish date on a working-day calendar. */
function wholeDays(activity: ScheduleActivity, warnings: string[]): number {
  const d = activity.durationDays;
  if (!Number.isFinite(d) || d < 0) {
    throw new ScheduleInputError(
      `Activity ${activity.id} has a duration of ${d}; a duration must be zero or more.`);
  }
  if (Number.isInteger(d)) return d;
  const rounded = Math.ceil(d);
  warnings.push(
    `${activity.id} has a duration of ${d} days, which has no finish date on a working-day ` +
    `calendar. Scheduled as ${rounded}.`);
  return rounded;
}

/**
 * The finish of an activity that starts on `start` and runs `duration` days.
 *
 * A one-day activity starts and finishes the same day, so the span is
 * `duration - 1` steps. A milestone is its own finish.
 */
function finishFrom(calendar: WorkCalendar, start: string, duration: number): string {
  return duration <= 1 ? start : addWorkingDays(calendar, start, duration - 1);
}

/** The inverse: the start of an activity of `duration` that finishes on `finish`. */
function startFrom(calendar: WorkCalendar, finish: string, duration: number): string {
  return duration <= 1 ? finish : addWorkingDays(calendar, finish, -(duration - 1));
}

const later = (a: string, b: string) => (epochDay(a) >= epochDay(b) ? a : b);
const earlier = (a: string, b: string) => (epochDay(a) <= epochDay(b) ? a : b);

interface Node {
  activity: ScheduleActivity;
  duration: number;
  calendar: WorkCalendar;
  incoming: ScheduleDependency[];
  outgoing: ScheduleDependency[];
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  drivingPredecessorId: string | null;
}

function validate(input: ScheduleInput, warnings: string[]): Map<string, Node> {
  assertIsoDate(input.dataDate);
  if (input.requiredFinish !== undefined) assertIsoDate(input.requiredFinish);
  if (input.activities.length === 0) {
    throw new ScheduleInputError('A schedule needs at least one activity.');
  }

  const calendars = new Map<string, WorkCalendar>();
  for (const c of input.calendars) {
    assertCalendar(c);
    if (calendars.has(c.id)) {
      throw new ScheduleInputError(`Two calendars share the id ${c.id}.`);
    }
    calendars.set(c.id, c);
  }
  const fallback = calendars.get(input.defaultCalendarId);
  if (!fallback) {
    throw new ScheduleInputError(
      `The default calendar ${input.defaultCalendarId} is not among the calendars supplied.`);
  }

  const nodes = new Map<string, Node>();
  for (const activity of input.activities) {
    if (!activity.id) throw new ScheduleInputError('Every activity needs an id.');
    if (nodes.has(activity.id)) {
      throw new ScheduleInputError(`Two activities share the id ${activity.id}.`);
    }
    const calendar = activity.calendarId ? calendars.get(activity.calendarId) : fallback;
    if (!calendar) {
      throw new ScheduleInputError(
        `Activity ${activity.id} names calendar ${activity.calendarId}, which was not supplied.`);
    }
    if (activity.constraintType && !activity.constraintDate) {
      throw new ScheduleInputError(
        `Activity ${activity.id} has a ${activity.constraintType} constraint with no date.`);
    }
    if (activity.constraintDate) {
      assertIsoDate(activity.constraintDate);
      if (!activity.constraintType) {
        throw new ScheduleInputError(
          `Activity ${activity.id} has a constraint date with no constraint type.`);
      }
      if (!CONSTRAINT_TYPES.includes(activity.constraintType)) {
        throw new ScheduleInputError(
          `Activity ${activity.id} has an unknown constraint type ${activity.constraintType}.`);
      }
    }
    nodes.set(activity.id, {
      activity,
      duration: wholeDays(activity, warnings),
      calendar,
      incoming: [], outgoing: [],
      earlyStart: '', earlyFinish: '', lateStart: '', lateFinish: '',
      drivingPredecessorId: null,
    });
  }

  const seen = new Set<string>();
  for (const dep of input.dependencies) {
    const pred = nodes.get(dep.predecessorId);
    const succ = nodes.get(dep.successorId);
    if (!pred) {
      throw new ScheduleInputError(
        `A dependency names predecessor ${dep.predecessorId}, which is not an activity here.`);
    }
    if (!succ) {
      throw new ScheduleInputError(
        `A dependency names successor ${dep.successorId}, which is not an activity here.`);
    }
    if (dep.predecessorId === dep.successorId) {
      throw new ScheduleInputError(`Activity ${dep.predecessorId} depends on itself.`);
    }
    if (!DEPENDENCY_TYPES.includes(dep.type)) {
      throw new ScheduleInputError(
        `The link ${dep.predecessorId} -> ${dep.successorId} has an unknown type ${dep.type}.`);
    }
    const lag = dep.lagDays ?? 0;
    if (!Number.isInteger(lag)) {
      throw new ScheduleInputError(
        `The link ${dep.predecessorId} -> ${dep.successorId} has a lag of ${lag}; lag is whole working days.`);
    }
    // Two links between the same pair with different types is a modeling
    // choice tools disagree about. Refusing it keeps the answer explainable.
    const key = `${dep.predecessorId}>${dep.successorId}`;
    if (seen.has(key)) {
      throw new ScheduleInputError(
        `${dep.predecessorId} -> ${dep.successorId} is linked more than once.`);
    }
    seen.add(key);
    pred.outgoing.push(dep);
    succ.incoming.push(dep);
  }
  return nodes;
}

/**
 * Topological order, refusing cycles by name.
 *
 * Kahn's algorithm with a deterministic queue: ties are broken by the order
 * the activities were supplied, so two runs order equal-ranked activities
 * identically and the derivation text does not move between runs.
 */
function topologicalOrder(nodes: Map<string, Node>): string[] {
  const indegree = new Map<string, number>();
  for (const [id, node] of nodes) indegree.set(id, node.incoming.length);

  const order: string[] = [];
  const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const dep of nodes.get(id)!.outgoing) {
      const left = indegree.get(dep.successorId)! - 1;
      indegree.set(dep.successorId, left);
      if (left === 0) ready.push(dep.successorId);
    }
  }
  if (order.length !== nodes.size) throw new ScheduleCycleError(findCycle(nodes));
  return order;
}

/** Name one cycle, so the error says which links to look at. */
function findCycle(nodes: Map<string, Node>): string[] {
  const state = new Map<string, 'open' | 'closed'>();
  const stack: string[] = [];
  let found: string[] | null = null;

  const walk = (id: string): void => {
    if (found) return;
    if (state.get(id) === 'open') {
      found = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    if (state.get(id) === 'closed') return;
    state.set(id, 'open');
    stack.push(id);
    for (const dep of nodes.get(id)!.outgoing) walk(dep.successorId);
    stack.pop();
    state.set(id, 'closed');
  };

  for (const id of nodes.keys()) { walk(id); if (found) break; }
  return found ?? [...nodes.keys()];
}

function forwardPass(nodes: Map<string, Node>, order: string[], input: ScheduleInput, warnings: string[]): void {
  for (const id of order) {
    const node = nodes.get(id)!;
    const cal = node.calendar;
    const open = nextWorkingDay(cal, input.dataDate);

    let startBound = open;
    let finishBound: string | null = null;
    let driver: string | null = null;

    for (const dep of node.incoming) {
      const pred = nodes.get(dep.predecessorId)!;
      const lag = dep.lagDays ?? 0;
      // Lag is counted on the successor's calendar: it is the successor that
      // waits, and it waits on the days it would otherwise be working.
      switch (dep.type) {
        case 'finish_to_start': {
          const from = nextWorkingDay(cal, dayAfter(pred.earlyFinish));
          const bound = addWorkingDays(cal, from, lag);
          if (epochDay(bound) > epochDay(startBound)) { startBound = bound; driver = pred.activity.id; }
          break;
        }
        case 'start_to_start': {
          const bound = addWorkingDays(cal, nextWorkingDay(cal, pred.earlyStart), lag);
          if (epochDay(bound) > epochDay(startBound)) { startBound = bound; driver = pred.activity.id; }
          break;
        }
        case 'finish_to_finish': {
          const bound = addWorkingDays(cal, nextWorkingDay(cal, pred.earlyFinish), lag);
          if (finishBound === null || epochDay(bound) > epochDay(finishBound)) {
            finishBound = bound; driver ??= pred.activity.id;
          }
          break;
        }
        case 'start_to_finish': {
          const bound = addWorkingDays(cal, nextWorkingDay(cal, pred.earlyStart), lag);
          if (finishBound === null || epochDay(bound) > epochDay(finishBound)) {
            finishBound = bound; driver ??= pred.activity.id;
          }
          break;
        }
      }
    }

    // A finish-driven bound is translated back to a start so both are compared
    // in the same dimension; the later of the two wins.
    if (finishBound !== null) {
      const impliedStart = startFrom(cal, finishBound, node.duration);
      if (epochDay(impliedStart) > epochDay(startBound)) startBound = impliedStart;
    }

    const { constraintType, constraintDate } = node.activity;
    if (constraintDate && constraintType) {
      switch (constraintType) {
        case 'start_no_earlier': {
          const c = nextWorkingDay(cal, constraintDate);
          if (epochDay(c) > epochDay(startBound)) { startBound = c; driver = null; }
          break;
        }
        case 'must_start_on': {
          const c = nextWorkingDay(cal, constraintDate);
          if (epochDay(c) < epochDay(startBound)) {
            warnings.push(
              `${id} must start on ${constraintDate}, but its predecessors do not release it until ` +
              `${startBound}. The constraint was honored and the logic broken.`);
          }
          startBound = c; driver = null;
          break;
        }
        case 'must_finish_on': {
          const c = previousWorkingDay(cal, constraintDate);
          const implied = startFrom(cal, c, node.duration);
          if (epochDay(implied) < epochDay(startBound)) {
            warnings.push(
              `${id} must finish on ${constraintDate}, which requires starting ${implied}, before its ` +
              `predecessors release it on ${startBound}. The constraint was honored and the logic broken.`);
          }
          startBound = implied; driver = null;
          break;
        }
        case 'finish_no_later':
          // A deadline does not pull work earlier; it shows up as float, and
          // as negative float when the work does not fit.
          break;
      }
    }

    node.earlyStart = startBound;
    node.earlyFinish = finishFrom(cal, startBound, node.duration);
    node.drivingPredecessorId = driver;
  }
}

function backwardPass(
  nodes: Map<string, Node>, order: string[], projectFinish: string, input: ScheduleInput,
): void {
  for (const id of [...order].reverse()) {
    const node = nodes.get(id)!;
    const cal = node.calendar;

    // A terminal activity is bounded by the contract date when there is one,
    // and by the computed finish when there is not.
    let finishBound = previousWorkingDay(cal, input.requiredFinish ?? projectFinish);
    let startBound: string | null = null;

    for (const dep of node.outgoing) {
      const succ = nodes.get(dep.successorId)!;
      const lag = dep.lagDays ?? 0;
      const sc = succ.calendar;
      switch (dep.type) {
        case 'finish_to_start': {
          const released = addWorkingDays(sc, previousWorkingDay(sc, succ.lateStart), -lag);
          const bound = previousWorkingDay(cal, dayBefore(released));
          finishBound = earlier(finishBound, bound);
          break;
        }
        case 'start_to_start': {
          const bound = previousWorkingDay(
            cal, addWorkingDays(sc, previousWorkingDay(sc, succ.lateStart), -lag));
          startBound = startBound === null ? bound : earlier(startBound, bound);
          break;
        }
        case 'finish_to_finish': {
          const bound = previousWorkingDay(
            cal, addWorkingDays(sc, previousWorkingDay(sc, succ.lateFinish), -lag));
          finishBound = earlier(finishBound, bound);
          break;
        }
        case 'start_to_finish': {
          const bound = previousWorkingDay(
            cal, addWorkingDays(sc, previousWorkingDay(sc, succ.lateFinish), -lag));
          startBound = startBound === null ? bound : earlier(startBound, bound);
          break;
        }
      }
    }

    if (startBound !== null) {
      const impliedFinish = finishFrom(cal, startBound, node.duration);
      finishBound = earlier(finishBound, impliedFinish);
    }

    const { constraintType, constraintDate } = node.activity;
    if (constraintDate && constraintType) {
      switch (constraintType) {
        case 'finish_no_later':
          finishBound = earlier(finishBound, previousWorkingDay(cal, constraintDate));
          break;
        case 'must_finish_on':
          finishBound = previousWorkingDay(cal, constraintDate);
          break;
        case 'must_start_on':
          finishBound = finishFrom(cal, nextWorkingDay(cal, constraintDate), node.duration);
          break;
        case 'start_no_earlier':
          break;
      }
    }

    node.lateFinish = finishBound;
    node.lateStart = startFrom(cal, finishBound, node.duration);
  }
}

/**
 * How far this activity can slip before it moves any successor's early dates.
 *
 * Measured per relationship in the dimension that relationship constrains, and
 * taken as the smallest. An activity with no successors is bounded only by the
 * project, so its free float is its total float.
 */
function freeFloat(node: Node, nodes: Map<string, Node>, totalFloat: number): number {
  if (node.outgoing.length === 0) return totalFloat;
  let smallest = Infinity;
  for (const dep of node.outgoing) {
    const succ = nodes.get(dep.successorId)!;
    const lag = dep.lagDays ?? 0;
    const cal = succ.calendar;
    let slack: number;
    switch (dep.type) {
      case 'finish_to_start': {
        const earliest = addWorkingDays(cal, nextWorkingDay(cal, dayAfter(node.earlyFinish)), lag);
        slack = workingDayDelta(cal, nextWorkingDay(cal, earliest), nextWorkingDay(cal, succ.earlyStart));
        break;
      }
      case 'start_to_start': {
        const earliest = addWorkingDays(cal, nextWorkingDay(cal, node.earlyStart), lag);
        slack = workingDayDelta(cal, nextWorkingDay(cal, earliest), nextWorkingDay(cal, succ.earlyStart));
        break;
      }
      case 'finish_to_finish': {
        const earliest = addWorkingDays(cal, nextWorkingDay(cal, node.earlyFinish), lag);
        slack = workingDayDelta(cal, nextWorkingDay(cal, earliest), nextWorkingDay(cal, succ.earlyFinish));
        break;
      }
      case 'start_to_finish': {
        const earliest = addWorkingDays(cal, nextWorkingDay(cal, node.earlyStart), lag);
        slack = workingDayDelta(cal, nextWorkingDay(cal, earliest), nextWorkingDay(cal, succ.earlyFinish));
        break;
      }
    }
    smallest = Math.min(smallest, slack);
  }
  // Free float is never more than total float, and never below zero.
  return Math.max(0, Math.min(smallest, totalFloat));
}

/**
 * The longest chain of critical activities that are actually linked.
 *
 * Returning every zero-float activity would be easier and would be wrong: on a
 * job with two parallel critical chains, "the critical path" is a path, and a
 * scheduler reading it needs to walk it. Ties go to the chain whose first
 * activity comes first in topological order, so the answer is stable.
 */
function longestCriticalChain(
  nodes: Map<string, Node>, order: string[], critical: Set<string>,
): string[] {
  const best = new Map<string, string[]>();
  for (const id of [...order].reverse()) {
    if (!critical.has(id)) continue;
    let tail: string[] = [];
    for (const dep of nodes.get(id)!.outgoing) {
      if (!critical.has(dep.successorId)) continue;
      const candidate = best.get(dep.successorId) ?? [];
      if (candidate.length > tail.length) tail = candidate;
    }
    best.set(id, [id, ...tail]);
  }
  let chain: string[] = [];
  for (const id of order) {
    const candidate = best.get(id);
    if (candidate && candidate.length > chain.length) chain = candidate;
  }
  return chain;
}

/**
 * Run the critical path method over a set of activities.
 *
 * Pure: no clock, no I/O, no mutation of the input. The same inputs produce
 * the same dates, which is what makes a schedule something two people can
 * argue about from the same evidence.
 */
export function calculateSchedule(input: ScheduleInput): ScheduleResult {
  const warnings: string[] = [];
  const nodes = validate(input, warnings);
  const order = topologicalOrder(nodes);

  forwardPass(nodes, order, input, warnings);

  const projectStart = [...nodes.values()]
    .reduce((min, n) => earlier(min, n.earlyStart), nodes.get(order[0]!)!.earlyStart);
  const projectFinish = [...nodes.values()]
    .reduce((max, n) => later(max, n.earlyFinish), nodes.get(order[0]!)!.earlyFinish);

  backwardPass(nodes, order, projectFinish, input);

  const critical = new Set<string>();
  const activities: ScheduledActivity[] = [];
  for (const id of order) {
    const node = nodes.get(id)!;
    const cal = node.calendar;
    const totalFloat = workingDayDelta(cal, node.earlyStart, node.lateStart);
    const isCritical = totalFloat <= 0;
    if (isCritical) critical.add(id);
    const free = freeFloat(node, nodes, totalFloat);

    const span = node.duration === 0
      ? 'milestone'
      : `${node.duration} working ${node.duration === 1 ? 'day' : 'days'}`;
    const because = node.drivingPredecessorId
      ? `driven by ${node.drivingPredecessorId}`
      : node.incoming.length === 0 ? 'starts at the data date' : 'driven by its constraint';
    activities.push({
      id,
      name: node.activity.name,
      calendarId: cal.id,
      durationDays: node.duration,
      earlyStart: node.earlyStart,
      earlyFinish: node.earlyFinish,
      lateStart: node.lateStart,
      lateFinish: node.lateFinish,
      totalFloatDays: totalFloat,
      freeFloatDays: free,
      isCritical,
      isMilestone: node.duration === 0,
      drivingPredecessorId: node.drivingPredecessorId,
      derivation:
        `${node.earlyStart} to ${node.earlyFinish} (${span}, calendar ${cal.id}, ${because}); ` +
        `late ${node.lateStart} to ${node.lateFinish}; ` +
        `total float ${totalFloat} ${Math.abs(totalFloat) === 1 ? 'day' : 'days'}, free float ${free}.`,
    });
  }

  /*
   * Open-ended activities.
   *
   * An activity with no successor is bounded only by the end of the project,
   * so it reports enormous float and can never be critical however important
   * it is. That is arithmetically right and almost always a modeling mistake —
   * somebody forgot the link. Naming it is the difference between a schedule
   * that is wrong and a schedule that says where it is wrong.
   */
  for (const id of order) {
    const node = nodes.get(id)!;
    if (node.outgoing.length > 0) continue;
    if (node.earlyFinish === projectFinish) continue; // The real end of the job.
    const float = activities.find((a) => a.id === id)!.totalFloatDays;
    warnings.push(
      `${id} has no successor, so its float of ${float} working days is bounded only by the ` +
      'project finish rather than by any work that waits on it. Usually a missing link.');
  }

  let finishFloat: number | null = null;
  if (input.requiredFinish) {
    const cal = nodes.get(order[0]!)!.calendar;
    finishFloat = workingDayDelta(
      cal, nextWorkingDay(cal, projectFinish), nextWorkingDay(cal, input.requiredFinish));
    if (finishFloat < 0) {
      warnings.push(
        `The schedule finishes ${projectFinish}, ${Math.abs(finishFloat)} working days after the ` +
        `required finish of ${input.requiredFinish}.`);
    }
  }

  const firstCal = nodes.get(order[0]!)!.calendar;
  return {
    activities,
    projectStart,
    projectFinish,
    criticalPath: longestCriticalChain(nodes, order, critical),
    durationWorkingDays: isWorkingDay(firstCal, projectStart) && isWorkingDay(firstCal, projectFinish)
      ? workingDayDelta(firstCal, projectStart, projectFinish) + 1
      : 0,
    finishFloatDays: finishFloat,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

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
export function compareToBaseline(
  result: ScheduleResult, baseline: ScheduleBaseline, calendar: WorkCalendar,
): ScheduleVariance {
  assertCalendar(calendar);
  const byId = new Map(baseline.activities.map((a) => [a.activityId, a]));
  const rows: ActivityVariance[] = [];
  let behind = 0, ahead = 0;

  for (const activity of result.activities) {
    const base = byId.get(activity.id);
    if (!base) {
      rows.push({
        activityId: activity.id, name: activity.name,
        baselineStart: null, baselineFinish: null,
        currentStart: activity.earlyStart, currentFinish: activity.earlyFinish,
        startVarianceDays: null, finishVarianceDays: null,
        status: 'not_in_baseline',
      });
      continue;
    }
    const startVariance = workingDayDelta(
      calendar, nextWorkingDay(calendar, base.plannedStart), nextWorkingDay(calendar, activity.earlyStart));
    const finishVariance = workingDayDelta(
      calendar, nextWorkingDay(calendar, base.plannedFinish), nextWorkingDay(calendar, activity.earlyFinish));
    const status = finishVariance > 0 ? 'behind' : finishVariance < 0 ? 'ahead' : 'on_baseline';
    if (status === 'behind') behind++;
    if (status === 'ahead') ahead++;
    rows.push({
      activityId: activity.id, name: activity.name,
      baselineStart: base.plannedStart, baselineFinish: base.plannedFinish,
      currentStart: activity.earlyStart, currentFinish: activity.earlyFinish,
      startVarianceDays: startVariance, finishVarianceDays: finishVariance,
      status,
    });
  }

  const current = new Set(result.activities.map((a) => a.id));
  for (const base of baseline.activities) {
    if (current.has(base.activityId)) continue;
    rows.push({
      activityId: base.activityId, name: base.name,
      baselineStart: base.plannedStart, baselineFinish: base.plannedFinish,
      currentStart: '', currentFinish: '',
      startVarianceDays: null, finishVarianceDays: null,
      status: 'removed',
    });
  }

  const baselineFinish = baseline.activities.length
    ? baseline.activities.reduce((max, a) => later(max, a.plannedFinish), baseline.activities[0]!.plannedFinish)
    : null;

  return {
    baselineId: baseline.id,
    activities: rows,
    projectFinishVarianceDays: baselineFinish === null ? null : workingDayDelta(
      calendar, nextWorkingDay(calendar, baselineFinish), nextWorkingDay(calendar, result.projectFinish)),
    behindCount: behind,
    aheadCount: ahead,
  };
}

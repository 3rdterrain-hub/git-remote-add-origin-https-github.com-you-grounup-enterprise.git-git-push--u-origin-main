/**
 * Pairing what is due with what the weather allows.
 *
 * The merge is the whole value of the strip, so it is tested as a function
 * rather than through the rendering — a bid landing on the wrong day would
 * still look like a calendar.
 */
import { describe, expect, it } from 'vitest';
import { buildWeek } from './week-ahead';
import type { DueBid, WeatherDay } from '@/lib/data/dashboard';

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString();

const bid = (over: Partial<DueBid> = {}): DueBid => ({
  id: 'e-1', versionId: 'v-1', number: 'E-1', name: 'Haul road',
  customerName: 'Maumee', dueAt: day(2), dueKind: 'bid', status: 'draft',
  bidPrice: 250_000, priced: true, blockedFromIssue: false, daysAway: 2, ...over,
});

const weather = (offset: number, over: Partial<WeatherDay> = {}): WeatherDay => ({
  day: day(offset).slice(0, 10), highF: 62, lowF: 44, precipInches: 0,
  precipChance: 10, summary: 'Partly cloudy', workable: true, lostReason: null, ...over,
});

describe('the week strip', () => {
  it('covers seven days beginning today', () => {
    const week = buildWeek([], []);
    expect(week).toHaveLength(7);
    expect(week[0]!.isToday).toBe(true);
    expect(week.filter((d) => d.isToday)).toHaveLength(1);
  });

  it('puts a bid on the day it is due', () => {
    const week = buildWeek([bid()], []);
    expect(week[2]!.due.map((b) => b.number)).toEqual(['E-1']);
    expect(week.filter((d) => d.due.length > 0)).toHaveLength(1);
  });

  it('puts two bids due the same day on the same day', () => {
    const week = buildWeek([bid(), bid({ id: 'e-2', number: 'E-2' })], []);
    expect(week[2]!.due).toHaveLength(2);
  });

  it('pairs the bid with that day\'s forecast', () => {
    // The reason the strip exists: a bid due on a day it rains is a different
    // problem than one due on a day it does not.
    const week = buildWeek([bid()], [weather(2, { workable: false, lostReason: 'Rain' })]);
    expect(week[2]!.due).toHaveLength(1);
    expect(week[2]!.weather?.workable).toBe(false);
    expect(week[2]!.weather?.lostReason).toBe('Rain');
  });

  it('leaves a day with no forecast empty rather than assuming fair weather', () => {
    // Assuming workable is the expensive way to be wrong: it is the assumption
    // that lets somebody promise a day the weather was always going to take.
    const week = buildWeek([], [weather(0)]);
    expect(week[0]!.weather).not.toBeNull();
    expect(week[3]!.weather).toBeNull();
  });

  it('ignores a bid due outside the week rather than piling it on the last day', () => {
    const week = buildWeek([bid({ dueAt: day(30), daysAway: 30 })], []);
    expect(week.every((d) => d.due.length === 0)).toBe(true);
  });

  it('ignores one that is already past', () => {
    // Overdue bids have their own alert at the top of the dashboard; putting
    // them on a future day would say they are still ahead.
    const week = buildWeek([bid({ dueAt: day(-3), daysAway: -3 })], []);
    expect(week.every((d) => d.due.length === 0)).toBe(true);
  });
});

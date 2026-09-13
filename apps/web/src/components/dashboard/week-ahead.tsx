/**
 * The calendar, with the weather on it.
 *
 * A calendar on its own would be a second place to read dates that are already
 * on the screen. What is worth having is the two together: a bid due Thursday
 * matters differently when Thursday is the day it rains, and a crew with three
 * workable days next week is a schedule commitment somebody should not make.
 *
 * This shipped as a fixed seven-day strip, on the reasoning that a month grid
 * would be mostly empty squares. That reasoning was mine and it was overruled:
 * a contractor plans in months. It now opens on the month and switches to a
 * week or a single day, and every view carries the same two facts per day.
 *
 * The forecast reaches about a fortnight, so the back half of a month has no
 * weather. Those days render as ordinary dates. Filling them with a guess would
 * be the one thing this must never do — a calendar that implies fair weather in
 * three weeks is worse than one that says nothing about it.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudRain, Sun, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { money } from '@/lib/format';
import type { DueBid, WeatherDay } from '@/lib/data/dashboard';

const DAY_MS = 86_400_000;
const iso = (d: Date) => {
  /* Local midnight, not UTC. `toISOString` on a Date built from a local clock
     shifts west of Greenwich into the previous day, which put a bid due on the
     1st into the 31st for every user in the Americas. */
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const at = (day: string) => new Date(`${day}T12:00:00`);

export interface WeekDay {
  day: string;
  isToday: boolean;
  weather: WeatherDay | null;
  due: DueBid[];
}

/** A day in a grid, which additionally knows whether it is in the month shown. */
export interface CalendarDay extends WeekDay { inMonth: boolean }

/**
 * `count` days from `start`, with whatever falls on each.
 *
 * Built here rather than inside the component so it can be tested without
 * rendering, and so the two lists are merged once rather than filtered per
 * cell — a filter inside a map over a month is forty-two passes over the bids.
 */
export function buildDays(
  start: string, count: number,
  bids: readonly DueBid[], weather: readonly WeatherDay[],
): WeekDay[] {
  const today = iso(new Date());
  const byDay = new Map<string, DueBid[]>();
  for (const b of bids) {
    /*
     * The local day, not the one in the timestamp.
     *
     * `dueAt` is an instant, and slicing its ISO text takes the UTC date — so a
     * bid due at nine in the evening in Toledo landed on tomorrow, on a grid
     * whose own squares are local days. The calendar and the thing it places
     * have to agree about what day it is.
     */
    const key = iso(new Date(b.dueAt));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(b);
    else byDay.set(key, [b]);
  }
  const forecast = new Map(weather.map((w) => [w.day, w]));
  const from = at(start).getTime();

  return Array.from({ length: count }, (_, i) => {
    const day = iso(new Date(from + i * DAY_MS));
    return {
      day,
      isToday: day === today,
      weather: forecast.get(day) ?? null,
      due: byDay.get(day) ?? [],
    };
  });
}

/** Seven days from today. The shape the dashboard has always had. */
export function buildWeek(bids: readonly DueBid[], weather: readonly WeatherDay[]): WeekDay[] {
  return buildDays(iso(new Date()), 7, bids, weather);
}

/**
 * The six-week grid a month is drawn on.
 *
 * Always six rows, so the calendar does not change height between a month that
 * starts on a Sunday and one that does not — a grid that resizes as you page
 * through it moves everything underneath it.
 */
export function buildMonth(
  anchor: Date, bids: readonly DueBid[], weather: readonly WeatherDay[],
): CalendarDay[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const month = anchor.getMonth();
  return buildDays(iso(start), 42, bids, weather).map((d) => ({
    ...d,
    inMonth: at(d.day).getMonth() === month,
  }));
}

type View = 'month' | 'week' | 'day' | 'list';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** One day's forecast, said in as few characters as the cell has room for. */
function Forecast({ weather, size = 'sm' }: { weather: WeatherDay | null; size?: 'sm' | 'lg' }) {
  if (!weather) return <p className={cn('text-charcoal-300', size === 'lg' ? 'text-sm' : 'text-xs')}>—</p>;
  const lost = !weather.workable;
  return (
    <div className="flex items-center gap-1.5">
      {weather.workable
        ? <Sun className={cn('shrink-0 text-yellow-500', size === 'lg' ? 'size-5' : 'size-3.5')} />
        : <CloudRain className={cn('shrink-0 text-charcoal-400', size === 'lg' ? 'size-5' : 'size-3.5')} />}
      <span className={cn('truncate', size === 'lg' ? 'text-sm' : 'text-xs',
        lost ? 'text-danger-600' : 'text-charcoal-600')}>
        {lost
          ? weather.lostReason
          : weather.highF === null
            ? weather.summary ?? ''
            : `${Math.round(weather.highF)}°${weather.lowF === null ? '' : ` / ${Math.round(weather.lowF)}°`}`}
      </span>
    </div>
  );
}

/** The bids due on a day, each a link to the version that is due. */
function DueList({ due, limit }: { due: DueBid[]; limit: number }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {due.slice(0, limit).map((b) => (
        <li key={b.id}>
          <Link to={`/app/estimates/${b.versionId ?? b.id}`}
            className={cn(
              'block truncate rounded px-1.5 py-0.5 text-xs',
              b.dueKind === 'expiry'
                ? 'bg-warn-100 text-warn-800 hover:bg-warn-200'
                : 'bg-charcoal-100 text-charcoal-700 hover:bg-charcoal-200')}
            title={`${b.number} — ${b.name}${b.priced ? ` — ${money(b.bidPrice)}` : ''}`}>
            {b.number}
          </Link>
        </li>
      ))}
      {due.length > limit ? (
        <li className="px-1.5 text-xs text-charcoal-400">+{due.length - limit} more</li>
      ) : null}
    </ul>
  );
}

export function WeekAhead({ bids, weather }: {
  bids: readonly DueBid[];
  weather: readonly WeatherDay[];
}) {
  const [view, setView] = useState<View>('month');
  /* The day the view is anchored on. Paging moves this rather than rebuilding
     from today, so paging forward and back returns to where you started. */
  const [anchor, setAnchor] = useState(() => new Date());

  const days = useMemo(() => {
    if (view === 'month') return buildMonth(anchor, bids, weather);
    if (view === 'day') return buildDays(iso(anchor), 1, bids, weather);
    /* A list runs the month rather than the week, so paging it matches the
       month view it is an alternative reading of. */
    if (view === 'list') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const length = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      return buildDays(iso(first), length, bids, weather);
    }
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - anchor.getDay());
    return buildDays(iso(start), 7, bids, weather);
  }, [view, anchor, bids, weather]);

  const shown = view === 'month'
    ? (days as CalendarDay[]).filter((d) => d.inMonth)
    : days;
  const known = shown.filter((d) => d.weather !== null);
  const workable = known.filter((d) => d.weather!.workable).length;

  /* Opening a day is two things at once — which day, and which view — so it is
     one function rather than two setters a caller has to remember to pair. */
  const openDay = (day: string) => { setAnchor(at(day)); setView('day'); };

  const step = (direction: 1 | -1) => {
    const next = new Date(anchor);
    if (view === 'month' || view === 'list') next.setMonth(anchor.getMonth() + direction);
    else next.setDate(anchor.getDate() + direction * (view === 'week' ? 7 : 1));
    setAnchor(next);
  };

  const heading = view === 'day'
    ? anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle>{heading}</CardTitle>
          <CardDescription>
            {known.length > 0
              ? `${workable} of ${known.length} forecast ${known.length === 1 ? 'day' : 'days'} workable. `
                + 'A bid due on a day it rains is a different problem than one due on a day it does not.'
              : 'What is due, and what the weather will allow.'}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="mr-1 flex rounded-md border border-charcoal-200 p-0.5">
            {(['month', 'week', 'day', 'list'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn('rounded px-2 py-1 text-xs font-medium capitalize transition-colors',
                  view === v ? 'bg-charcoal-900 text-white' : 'text-charcoal-600 hover:bg-charcoal-100')}>
                {v}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label={`Previous ${view}`}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label={`Next ${view}`}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {view === 'list' ? (
          /*
            * Only the days that carry something. A list of thirty rows saying
            * nothing is due is a list nobody reads to the bottom of, and the
            * whole point of this view is that it is short.
            */
          (() => {
            const rows = days.filter((d) => d.due.length > 0 || d.weather !== null);
            if (rows.length === 0) {
              return (
                <p className="p-4 text-sm text-charcoal-500">
                  Nothing is due this month, and the forecast does not reach into it yet.
                </p>
              );
            }
            return (
              <ol className="divide-y divide-charcoal-200">
                {rows.map((d) => (
                  <li key={d.day}
                    className={cn('flex flex-wrap items-baseline gap-x-4 gap-y-1.5 p-3',
                      d.isToday && 'bg-yellow-50/60')}>
                    <button type="button" onClick={() => openDay(d.day)}
                      className={cn('w-28 shrink-0 rounded px-1 py-0.5 text-left text-sm font-semibold',
                        'transition-colors hover:bg-charcoal-100',
                        d.isToday ? 'text-yellow-700' : 'text-charcoal-700')}>
                      {at(d.day).toLocaleDateString('en-US',
                        { weekday: 'short', month: 'short', day: 'numeric' })}
                    </button>
                    <span className="w-44 shrink-0"><Forecast weather={d.weather} /></span>
                    <span className="min-w-0 flex-1">
                      {d.due.length === 0
                        ? <span className="text-xs text-charcoal-400">Nothing due</span>
                        : <DueList due={d.due} limit={50} />}
                    </span>
                  </li>
                ))}
              </ol>
            );
          })()
        ) : view === 'day' ? (
          <div className="space-y-4 p-4">
            <Forecast weather={days[0]!.weather} size="lg" />
            {/*
              * A day is the one view with room to say why it is unworkable
              * rather than only that it is. Precipitation is the reason a crew
              * stands down, and it is the figure the calendar efficiency an
              * estimate is priced with comes from.
              */}
            {days[0]!.weather ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-charcoal-500">High</dt>
                  <dd className="font-medium text-charcoal-900">
                    {days[0]!.weather!.highF === null ? '—' : `${Math.round(days[0]!.weather!.highF!)}°F`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-charcoal-500">Low</dt>
                  <dd className="font-medium text-charcoal-900">
                    {days[0]!.weather!.lowF === null ? '—' : `${Math.round(days[0]!.weather!.lowF!)}°F`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-charcoal-500">Precipitation</dt>
                  <dd className="font-medium text-charcoal-900">
                    {days[0]!.weather!.precipInches === null
                      ? '—' : `${days[0]!.weather!.precipInches!.toFixed(2)}"`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-charcoal-500">Chance</dt>
                  <dd className="font-medium text-charcoal-900">
                    {days[0]!.weather!.precipChance === null
                      ? '—' : `${Math.round(days[0]!.weather!.precipChance!)}%`}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-charcoal-500">
                The forecast does not reach this day yet. It reaches about a fortnight out.
              </p>
            )}
            {days[0]!.due.length === 0 ? (
              <p className="text-sm text-charcoal-500">Nothing is due this day.</p>
            ) : (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                  Due this day
                </p>
                <DueList due={days[0]!.due} limit={50} />
              </div>
            )}
          </div>
        ) : (
          <>
            <ol className="grid grid-cols-7 border-b border-charcoal-200">
              {WEEKDAYS.map((w) => (
                <li key={w} className="px-2.5 py-1.5 text-center text-xs font-semibold
                                       uppercase tracking-wide text-charcoal-500">
                  {w}
                </li>
              ))}
            </ol>
            <ol className={cn('grid grid-cols-7',
              view === 'month' ? 'divide-x divide-y divide-charcoal-200' : 'divide-x divide-charcoal-200')}>
              {days.map((d) => {
                const outside = view === 'month' && !(d as CalendarDay).inMonth;
                return (
                  <li key={d.day}
                    className={cn('min-h-24 p-2', d.isToday && 'bg-yellow-50/60', outside && 'bg-charcoal-50/60')}>
                    {/*
                      * The date and the forecast are one control, because both
                      * answer the same question — what is this day like — and a
                      * day somebody clicks is a day they want to see in full.
                      * The bids below stay their own links: a button wrapped
                      * round a link is a control inside a control.
                      */}
                    <button type="button" onClick={() => openDay(d.day)}
                      aria-label={`Open ${at(d.day).toLocaleDateString('en-US',
                        { weekday: 'long', month: 'long', day: 'numeric' })}`}
                      className="-m-1 block w-[calc(100%+0.5rem)] rounded p-1 text-left
                                 transition-colors hover:bg-charcoal-100">
                      <span className={cn('text-xs font-semibold',
                        d.isToday ? 'text-yellow-700'
                          : outside ? 'text-charcoal-300' : 'text-charcoal-500')}>
                        {at(d.day).getDate()}
                      </span>
                      <span className="mt-1 block"><Forecast weather={d.weather} /></span>
                    </button>
                    <DueList due={d.due} limit={view === 'month' ? 2 : 3} />
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

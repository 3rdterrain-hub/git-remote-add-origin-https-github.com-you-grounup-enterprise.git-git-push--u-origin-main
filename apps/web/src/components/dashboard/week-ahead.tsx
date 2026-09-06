/**
 * The week, with the weather on it.
 *
 * A calendar on its own would be a second place to read dates that are already
 * on the screen. What is worth having is the two together: a bid due Thursday
 * matters differently when Thursday is the day it rains, and a crew with three
 * workable days next week is a schedule commitment somebody should not make.
 *
 * Seven days, starting today, because that is how far the forecast reaches. A
 * month grid would be mostly empty squares and would stop being about the
 * weather, which is the half nothing else in the platform shows.
 */
import { Link } from 'react-router-dom';
import { CloudRain, Sun } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { money } from '@/lib/format';
import type { DueBid, WeatherDay } from '@/lib/data/dashboard';

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface WeekDay {
  day: string;
  isToday: boolean;
  weather: WeatherDay | null;
  due: DueBid[];
}

/**
 * Seven days from today, with whatever falls on each.
 *
 * Built here rather than inside the component so it can be tested without
 * rendering, and so the two lists are merged once rather than filtered per
 * cell — a filter inside a map over seven days is seven passes over the bids.
 */
export function buildWeek(bids: readonly DueBid[], weather: readonly WeatherDay[]): WeekDay[] {
  const today = iso(new Date());
  const byDay = new Map<string, DueBid[]>();
  for (const b of bids) {
    const key = b.dueAt.slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(b);
    else byDay.set(key, [b]);
  }
  const forecast = new Map(weather.map((w) => [w.day, w]));

  return Array.from({ length: 7 }, (_, i) => {
    const day = iso(new Date(Date.now() + i * DAY_MS));
    return {
      day,
      isToday: day === today,
      weather: forecast.get(day) ?? null,
      due: byDay.get(day) ?? [],
    };
  });
}

export function WeekAhead({ bids, weather }: {
  bids: readonly DueBid[];
  weather: readonly WeatherDay[];
}) {
  const week = buildWeek(bids, weather);
  const known = week.filter((d) => d.weather !== null);
  const workable = known.filter((d) => d.weather!.workable).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week</CardTitle>
        <CardDescription>
          {known.length > 0
            ? `${workable} of ${known.length} days workable. A bid due on a day it rains is a `
              + 'different problem than one due on a day it does not.'
            : 'What is due, and what the weather will allow.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="grid grid-cols-1 divide-y divide-charcoal-200 sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {week.map((d) => {
            const when = new Date(`${d.day}T12:00:00`);
            const lost = d.weather !== null && !d.weather.workable;
            return (
              <li key={d.day}
                className={cn('min-h-28 p-2.5', d.isToday && 'bg-yellow-50/60')}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className={cn('text-xs font-semibold uppercase tracking-wide',
                    d.isToday ? 'text-yellow-700' : 'text-charcoal-500')}>
                    {when.toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span className="text-xs text-charcoal-400">{when.getDate()}</span>
                </div>

                {d.weather ? (
                  <div className="mt-1 flex items-center gap-1.5">
                    {d.weather.workable
                      ? <Sun className="size-3.5 shrink-0 text-yellow-500" />
                      : <CloudRain className="size-3.5 shrink-0 text-charcoal-400" />}
                    <span className={cn('truncate text-xs',
                      lost ? 'text-danger-600' : 'text-charcoal-600')}>
                      {lost ? d.weather.lostReason : (d.weather.highF === null
                        ? d.weather.summary ?? ''
                        : `${Math.round(d.weather.highF)}°`)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-charcoal-300">—</p>
                )}

                <ul className="mt-1.5 space-y-1">
                  {d.due.slice(0, 3).map((b) => (
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
                  {d.due.length > 3 ? (
                    <li className="px-1.5 text-xs text-charcoal-400">
                      +{d.due.length - 3} more
                    </li>
                  ) : null}
                </ul>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

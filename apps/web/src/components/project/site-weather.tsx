/**
 * Entity — the weather where the crew is standing.
 *
 * Migration 0105 is titled "Weather where the work is" and fetched it from the
 * company's own coordinates, which are the yard. `projects` has carried
 * `site_address`, `latitude` and `longitude` since 0007, and
 * `app.award_estimate` copies them forward from the estimate when a project is
 * created — so the coordinates of the actual site were already in the row, read
 * by nothing. A contractor in Toledo with a job in Sandusky is sixty miles and
 * one lake-effect band away from the number on their own daily log.
 *
 * Three decisions about what this card shows:
 *
 *   * **It says where the forecast is from.** A day counted from the yard is a
 *     different claim from one counted at the site, and a card that showed both
 *     the same way would make the distinction unobservable — which is the
 *     failure this card exists to correct.
 *   * **Current conditions sit apart from the week.** "Is it raining on us" and
 *     "what is Thursday's high" expire at different rates; migration 0143 keeps
 *     them in separate tables for the same reason.
 *   * **A day that cannot be worked says why.** The threshold that stopped it —
 *     rain, snow, freezing, wind — is stored with the day by the function that
 *     knows the thresholds, so every screen reading the row gives one answer.
 */
import { useState } from 'react';
import { CloudRain, CloudSnow, RefreshCw, Sun, Wind, Loader2, MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadSiteWeather, loadSiteWeatherNow, loadWorkableDays, refreshSiteWeather,
} from '@/lib/data/project';
import { date, percent, plural, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The icon for a day, chosen by what is actually falling on it. */
function DayIcon({ snow, precip, workable }: { snow: number; precip: number; workable: boolean }) {
  if (snow >= 0.1) return <CloudSnow className="size-4 text-info-600" />;
  if (precip >= 0.05) return <CloudRain className="size-4 text-info-600" />;
  if (!workable) return <Wind className="size-4 text-warn-600" />;
  return <Sun className="size-4 text-yellow-600" />;
}

export function SiteWeather({ companyId, projectId, siteNamed, canRefresh }: {
  companyId: string | null;
  projectId: string;
  /** Whether the project has coordinates or a site city of its own. */
  siteNamed: boolean;
  canRefresh: boolean;
}) {
  const daysQ = useQuery(loadSiteWeather(projectId), [projectId]);
  const nowQ = useQuery(loadSiteWeatherNow(projectId), [projectId]);
  /*
   * The count comes from the database rather than from the rows this card
   * happens to hold, because `app.workable_days_at` is also what decides which
   * forecast applies — and `source` is the only honest label for the number.
   */
  const windowQ = useQuery(loadWorkableDays(companyId, projectId), [companyId, projectId]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [from, setFrom] = useState<'site' | 'yard_for_site' | 'yard' | null>(null);

  const days = daysQ.status === 'ready' ? daysQ.data : [];
  const now = nowQ.status === 'ready' ? nowQ.data : null;
  const week = windowQ.status === 'ready' ? windowQ.data : null;
  /* The yard's forecast, shown on a project page, and the database says so. */
  const borrowed = week?.source === 'yard' && week.total > 0;

  async function refresh() {
    if (!companyId) return;
    setBusy(true); setFailure(null);
    try {
      const result = await refreshSiteWeather(companyId, projectId, true);
      setFrom(result.source ?? null);
      daysQ.refetch();
      nowQ.refetch();
      windowQ.refetch();
    } catch (err) { setFailure(messageFor(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CloudRain className="size-4 text-charcoal-500" />
            Weather at the site
          </CardTitle>
          <CardDescription>
            {week === null || week.total === 0
              ? 'No forecast has been fetched for this site yet.'
              : (
                <>
                  {plural(week.workable, 'workable day')} of {week.total}
                  {week.efficiency !== null
                    ? <> — {percent(week.efficiency, 0)} of the next seven</>
                    : null}
                  {days.length > 0 ? <>. Fetched {date(days[0]!.fetchedAt)}</> : null}.
                </>
              )}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}
          disabled={busy || !canRefresh || !companyId}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {failure ? <Alert tone="danger">{failure}</Alert> : null}

        {/*
          * Where the forecast came from. An efficiency taken from the yard is a
          * different claim from one taken from the site, and saying which is
          * the entire point of putting a forecast on a project page.
          */}
        {from === 'yard_for_site' || borrowed ? (
          <Alert tone="warn" icon={<MapPin className="size-4" />}
            title="This is the forecast at your yard, not at the site">
            This project has no forecast of its own, so the days below are counted at your yard.
            Add a site address or coordinates and refresh, and this becomes the weather where the
            crew is actually standing — which is a different number, and the one the schedule
            should be built on.
          </Alert>
        ) : null}

        {now ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-charcoal-200 bg-charcoal-50 px-3 py-2">
            <span className="text-sm font-medium text-charcoal-900">Right now</span>
            {now.temperatureF !== null ? (
              <span className="tabular text-sm">{qty(now.temperatureF, 0)}°F</span>
            ) : null}
            {now.summary ? <span className="text-sm text-charcoal-700">{now.summary}</span> : null}
            {now.windMph !== null ? (
              <span className="tabular text-sm text-charcoal-600">
                wind {qty(now.windMph, 0)} mph
              </span>
            ) : null}
            {now.precipInches > 0 ? (
              <span className="tabular text-sm text-info-700">
                {qty(now.precipInches, 2)}&quot; falling
              </span>
            ) : null}
            <span className="text-xs text-charcoal-500">observed {date(now.observedAt)}</span>
          </div>
        ) : null}

        {days.length === 0 ? (
          <EmptyState title="No forecast yet"
            hint={siteNamed
              ? 'Press Refresh and the forecast for this site is fetched and cached.'
              : 'Add a site address or coordinates to the project, then refresh.'} />
        ) : (
          <ul className="divide-y divide-charcoal-200 rounded-md border border-charcoal-200">
            {days.map((d) => (
              <li key={d.day}
                className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm',
                  d.workable ? null : 'bg-warn-50')}>
                <DayIcon snow={d.snowInches} precip={d.precipInches} workable={d.workable} />
                <span className="w-28 font-medium text-charcoal-900">{date(d.day)}</span>
                <span className="tabular w-20 text-charcoal-700">
                  {d.highF === null ? '—' : `${qty(d.highF, 0)}°`}
                  {d.lowF === null ? '' : ` / ${qty(d.lowF, 0)}°`}
                </span>
                <span className="flex-1 text-charcoal-600">{d.summary ?? '—'}</span>
                {d.precipInches > 0 ? (
                  <span className="tabular text-charcoal-600">{qty(d.precipInches, 2)}&quot;</span>
                ) : null}
                {d.windGustMph !== null && d.windGustMph >= 20 ? (
                  <span className="tabular text-charcoal-600">
                    gusts {qty(d.windGustMph, 0)} mph
                  </span>
                ) : null}
                {d.workable
                  ? <Badge variant="success">Workable</Badge>
                  : <Badge variant="warn">{d.lostReason ?? 'Not workable'}</Badge>}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-charcoal-500">
          A day is counted lost at a tenth of an inch of rain, an inch of snow, a high below
          freezing, or gusts of thirty miles an hour — the National Weather Service&apos;s own
          threshold for measurable precipitation, and roughly where earthwork, concrete and lifts
          stop. The verdict is stored with the day, so every screen reading it gives one answer.
        </p>
      </CardContent>
    </Card>
  );
}

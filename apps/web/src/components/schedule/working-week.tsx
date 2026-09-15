/**
 * The working week.
 *
 * `work_calendars` has existed since migration 0029 with a description, a
 * weekday set, hours per day and a one-default-per-company index — and no
 * writer anywhere, which is why `recalculate-schedule` refused every request it
 * ever received with `no_calendar`. The engine reads this to turn a duration in
 * working days into a span of dates, so the whole critical path stood on a row
 * that nothing could create.
 *
 * Changing the hours in a day changes what every duration on that calendar
 * means, so the count of activities riding on it is shown beside the field
 * rather than left to be discovered afterwards.
 */
import { useEffect, useState } from 'react';
import { CalendarRange, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadWorkCalendars, updateWorkCalendar, ensureWorkCalendar, type WorkCalendarRow,
} from '@/lib/data/schedule';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/* 0 is Sunday, matching the column and every date library anyone reads it beside. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarCard({ calendar, canWrite, onSaved }: {
  calendar: WorkCalendarRow; canWrite: boolean; onSaved: () => void;
}) {
  const [name, setName] = useState(calendar.name);
  const [hours, setHours] = useState(String(calendar.hoursPerDay));
  const [days, setDays] = useState<number[]>(calendar.workingWeekdays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * Keyed on the id, not the object. Keyed on the object this effect reruns on
   * every refetch and wipes whatever is half typed — the branding form taught
   * that the expensive way.
   */
  useEffect(() => {
    setName(calendar.name);
    setHours(String(calendar.hoursPerDay));
    setDays(calendar.workingWeekdays);
  }, [calendar.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const save = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await updateWorkCalendar(supabase, {
        calendarId: calendar.id,
        name,
        hoursPerDay: Number(hours) || 8,
        workingWeekdays: days,
      });
      setSaved(true);
      onSaved();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const dirty = name !== calendar.name
    || Number(hours) !== calendar.hoursPerDay
    || days.join(',') !== calendar.workingWeekdays.join(',');

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-charcoal-500">{calendar.code}</span>
        {calendar.isDefault ? <Badge variant="outline">Default</Badge> : null}
        <span className="text-xs text-charcoal-500">
          {calendar.activityCount === 0
            ? 'nothing scheduled on it yet'
            : `${plural(calendar.activityCount, 'activity', 'activities')} scheduled on it`}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`wc-name-${calendar.id}`}>What it is called</Label>
          <Input id={`wc-name-${calendar.id}`} value={name} disabled={!canWrite}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`wc-hours-${calendar.id}`}>Hours in a working day</Label>
          <Input id={`wc-hours-${calendar.id}`} type="number" min={1} max={24} step={0.5}
            value={hours} disabled={!canWrite}
            onChange={(e) => setHours(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Days worked</Label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((label, index) => {
            const on = days.includes(index);
            return (
              <button key={label} type="button" disabled={!canWrite}
                aria-pressed={on} onClick={() => toggle(index)}
                className={cn(
                  'h-9 w-14 rounded-md border text-sm font-medium transition-colors',
                  on ? 'border-charcoal-900 bg-charcoal-900 text-white'
                    : 'border-charcoal-200 bg-white text-charcoal-600 hover:bg-charcoal-50',
                  !canWrite && 'cursor-not-allowed opacity-60')}>
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-charcoal-500">
          The engine steps over the days nobody works. A calendar with none would send every
          schedule on it looking forever for the next working day, so at least one is required.
        </p>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={!canWrite || busy || !dirty}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the working week
        </Button>
        {saved && !dirty ? (
          <span className="flex items-center gap-1 text-sm text-success-700">
            <Check className="size-4" /> Saved. Calculate again to apply it to the dates.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function WorkingWeek({ companyId, canWrite }: {
  companyId: string | null; canWrite: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const calendarsQ = useQuery(loadWorkCalendars, [nonce]);
  const calendars = calendarsQ.status === 'ready' ? calendarsQ.data : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!supabase || !companyId || busy) return;
    setBusy(true); setError(null);
    try {
      await ensureWorkCalendar(supabase, companyId);
      setNonce((n) => n + 1);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarRange className="size-4" /> The working week
        </CardTitle>
        <CardDescription>
          A duration in days is not a span of dates until something says which days are
          worked and how many hours are in one. The engine reads this, and refuses to
          calculate a schedule without it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {calendarsQ.status === 'loading' ? <LoadingState label="Reading the calendars" /> : null}
        {calendarsQ.status === 'error'
          ? <ErrorState message={calendarsQ.message} onRetry={calendarsQ.refetch} /> : null}
        {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

        {calendarsQ.status === 'ready' && calendars.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-charcoal-600">
              This company has no working week, which is why a schedule cannot be calculated
              yet. Monday to Friday at eight hours is the starting point; change it here
              afterwards.
            </p>
            <Button onClick={() => void create()} disabled={!canWrite || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Set up the working week
            </Button>
          </div>
        ) : null}

        {calendars.map((c) => (
          <CalendarCard key={c.id} calendar={c} canWrite={canWrite}
            onSaved={() => setNonce((n) => n + 1)} />
        ))}
      </CardContent>
    </Card>
  );
}

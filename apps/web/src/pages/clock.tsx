/**
 * The clock, on a phone.
 *
 * The punch clock, the board, the overtime rules and the timecard posting were
 * all built and the only way in was a tab on the Workforce screen. The people
 * who punch a clock are standing at a job trailer at 6:41 in the morning
 * holding a phone in one hand. A desktop tab is the wrong door.
 *
 * So this is its own screen, outside the application shell: no sidebar, no
 * navigation, nothing to get lost in. What it shows is what somebody needs
 * while standing up — where they stand, how long they have been there, and the
 * one button that does the only thing they can do next.
 *
 * Three decisions.
 *
 * **One button, not four.** The database's state machine decides what may
 * follow what; this asks it and draws that. A screen offering "clock out" to
 * somebody who is not clocked in is a screen that teaches people to distrust
 * it.
 *
 * **The elapsed time counts up on its own.** A number that only moves when the
 * page is reloaded looks broken to somebody watching it, and this is a screen
 * people watch.
 *
 * **Location is attached, never required.** A clock that will not record
 * somebody's start because they denied location, or because they are inside a
 * building, is a clock that costs them the hour.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Coffee, LogIn, LogOut, MapPin, RotateCcw, Loader2 } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadMyClock, punch, duration, since, type PunchKind,
} from '@/lib/data/time-clock';
import { loadMyCompanyId } from '@/lib/data/estimates';
import { greeting, loadWhoAmI } from '@/lib/data/session';
import { nextPunches } from '@/components/workforce/time-clock';
import { cn } from '@/lib/utils';

const LABEL: Record<PunchKind, string> = {
  in: 'Clock in', out: 'Clock out', break_start: 'Start break', break_end: 'End break',
};
const ICON: Record<PunchKind, typeof LogIn> = {
  in: LogIn, out: LogOut, break_start: Coffee, break_end: RotateCcw,
};

const STANDING_TONE: Record<string, string> = {
  'On the clock': 'bg-ok-100 text-ok-900 border-ok-300',
  'On break': 'bg-warn-100 text-warn-900 border-warn-300',
  'Off the clock': 'bg-charcoal-100 text-charcoal-700 border-charcoal-300',
};

export function ClockPage() {
  const companyQ = useQuery(loadMyCompanyId, []);
  const companyId = companyQ.status === 'ready' ? companyQ.data : null;
  const whoQ = useQuery(loadWhoAmI, []);
  const mine = useQuery(loadMyClock, [companyId]);
  const [busy, setBusy] = useState<PunchKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * A ticking second, so the elapsed time moves. Cheap: one state change a
   * second on a screen showing one number.
   */
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const act = async (kind: PunchKind) => {
    if (!companyId) return;
    setBusy(kind); setProblem(null);
    try {
      await punch(kind, { companyId, withPosition: kind === 'in' || kind === 'out' });
      mine.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    } finally {
      setBusy(null);
    }
  };

  const who = whoQ.status === 'ready' ? whoQ.data : null;
  const row = mine.status === 'ready' ? mine.data : null;
  const offered = nextPunches(row?.state ?? null);

  return (
    <div className="min-h-dvh bg-charcoal-50">
      <header className="flex items-center justify-between border-b border-charcoal-200 bg-white px-4 py-3">
        <Logo />
        <Link to="/app" className="text-sm font-medium text-charcoal-500 hover:text-charcoal-900">
          Open the workspace
        </Link>
      </header>

      <main className="mx-auto w-full max-w-md space-y-5 p-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
            {who?.firstName ? `${greeting()}, ${who.firstName}` : greeting()}
          </h1>
          {who?.companyName ? (
            <p className="text-sm text-charcoal-500">{who.companyName}</p>
          ) : null}
        </div>

        {mine.status === 'loading' ? <LoadingState label="Reading the clock" /> : null}
        {mine.status === 'error'
          ? <ErrorState message={mine.message} onRetry={mine.refetch} /> : null}
        {mine.status === 'demonstration' ? (
          <EmptyState title="Connect a workspace to punch a clock" />
        ) : null}

        {mine.status === 'ready' && !row ? (
          <EmptyState
            title="You have no employee record here"
            hint="Time is recorded against an employee. An administrator can add you on the Workforce screen." />
        ) : null}

        {row ? (
          <>
            <section className={cn(
              'rounded-[--radius-card] border p-5 text-center', STANDING_TONE[row.standing])}>
              <p className="text-sm font-semibold uppercase tracking-wide">{row.standing}</p>
              <p className="mt-2 text-5xl font-bold tabular-nums">
                {duration(row.workedMinutes)}
              </p>
              <p className="mt-1 text-sm">
                worked today
                {row.breakMinutes > 0 ? ` · ${duration(row.breakMinutes)} on break` : ''}
              </p>
              {row.standing !== 'Off the clock' && since(row.since) ? (
                <p className="mt-3 text-sm opacity-80">
                  {row.standing === 'On break' ? 'On break for ' : 'Since you punched in: '}
                  {since(row.since)}
                </p>
              ) : null}
              {row.projectName && row.standing !== 'Off the clock' ? (
                <p className="mt-1 flex items-center justify-center gap-1 text-sm opacity-80">
                  <MapPin className="size-4" /> {row.projectName}
                </p>
              ) : null}
            </section>

            {/*
              * The buttons the database will actually accept, at the size of a
              * thumb. `min-h-16` is not decoration — this is pressed with a
              * glove on.
              */}
            <div className="space-y-3">
              {offered.map((kind) => {
                const Icon = ICON[kind];
                const primary = kind === 'in' || kind === 'break_end';
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(kind)}
                    className={cn(
                      'flex min-h-16 w-full items-center justify-center gap-3 rounded-[--radius-card]',
                      'text-lg font-semibold transition-colors disabled:opacity-60',
                      primary
                        ? 'bg-charcoal-900 text-white hover:bg-charcoal-800'
                        : 'border border-charcoal-300 bg-white text-charcoal-900 hover:bg-charcoal-50',
                    )}>
                    {busy === kind
                      ? <Loader2 className="size-6 animate-spin" />
                      : <Icon className="size-6" />}
                    {LABEL[kind]}
                  </button>
                );
              })}
            </div>

            {problem ? (
              <p role="alert"
                className="rounded-md border border-danger-200 bg-danger-50 p-3 text-sm
                           font-medium text-danger-800">
                {problem}
              </p>
            ) : null}

            <p className="flex items-start gap-2 text-xs text-charcoal-500">
              <AlarmClock className="mt-0.5 size-3.5 shrink-0" />
              Your punches are a record. A mistake is corrected by voiding the last one with a
              reason, on the Workforce screen — the original stays where it is.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

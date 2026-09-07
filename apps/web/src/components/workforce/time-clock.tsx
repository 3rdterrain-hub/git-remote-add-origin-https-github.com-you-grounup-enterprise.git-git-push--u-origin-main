/**
 * Clocking in, clocking out, and the board that shows who is on.
 *
 * Two audiences on one screen, and they want opposite things. A person punching
 * wants one button, the size of a thumb, that does the only thing they can do
 * right now. A superintendent wants a list they can read in four seconds from
 * a truck.
 *
 * So the punch card offers exactly the punches the database would accept. The
 * clock's state machine is in migration 0122 and it is the authority; this
 * mirrors it to decide which buttons to draw, and when a punch is refused
 * anyway — two devices, a stale screen — the database's own sentence is shown
 * unaltered. Reworded refusals are how two copies of a rule start disagreeing.
 *
 * Nothing here computes hours. The running total comes from the view, which
 * derives it the same way payroll will, so the number a person watches all day
 * is the number that gets posted.
 */
import { useState } from 'react';
import {
  AlarmClock, Coffee, FileClock, LogIn, LogOut, Loader2, MapPin, RotateCcw, Undo2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadMyClock, loadTimeClock, loadRecentPunches, loadUnpostedDays,
  punch, voidPunch, postDayToTimecard,
  duration, since, type ClockRow, type PunchKind,
} from '@/lib/data/time-clock';
import { OvertimePolicyCard } from './overtime-policy';
import { usePermissions } from '@/lib/data/session';
import { dateTime, date as formatDate, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Which punches the clock will accept next.
 *
 * This is `app.punch_refusal` read forwards: rather than listing what is
 * refused, list what is offered, so a person is never shown a button whose only
 * outcome is an error message.
 */
export function nextPunches(state: PunchKind | null): PunchKind[] {
  switch (state) {
    case 'in':
    case 'break_end':   return ['out', 'break_start'];
    case 'break_start': return ['break_end'];
    default:            return ['in'];
  }
}

const PUNCH_LABEL: Record<PunchKind, string> = {
  in: 'Clock in',
  out: 'Clock out',
  break_start: 'Start break',
  break_end: 'End break',
};

const PUNCH_ICON: Record<PunchKind, typeof LogIn> = {
  in: LogIn, out: LogOut, break_start: Coffee, break_end: RotateCcw,
};

const STANDING_TONE: Record<string, string> = {
  'On the clock': 'bg-ok-100 text-ok-800 border-ok-200',
  'On break': 'bg-warn-100 text-warn-800 border-warn-200',
  'Off the clock': 'bg-charcoal-100 text-charcoal-600 border-charcoal-200',
};

/** The card a person punches from. */
export function PunchCard({ companyId, compact = false }: { companyId: string; compact?: boolean }) {
  const mine = useQuery(loadMyClock, [companyId]);
  const [busy, setBusy] = useState<PunchKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const act = async (kind: PunchKind) => {
    setBusy(kind);
    setProblem(null);
    try {
      await punch(kind, { companyId, withPosition: kind === 'in' || kind === 'out' });
      mine.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    } finally {
      setBusy(null);
    }
  };

  if (mine.status === 'loading') return <LoadingState label="Reading the clock" />;
  if (mine.status === 'error') return <ErrorState message={mine.message} onRetry={mine.refetch} />;
  if (mine.status === 'demonstration') {
    return <EmptyState title="Connect a workspace to punch a clock"
      hint="The time clock records against your own company's employees." />;
  }

  const row = mine.data;

  /*
   * A person with a login but no employee record cannot punch, and saying so
   * plainly beats a button that fails. The database says the same thing; this
   * just says it before they press anything.
   */
  if (!row) {
    return (
      <EmptyState
        title="You have no employee record in this company"
        hint="Time is recorded against an employee. An administrator can add you on the Workforce screen, or you can punch at a kiosk." />
    );
  }

  const offered = nextPunches(row.state);
  const elapsed = since(row.since);

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className={cn('border', STANDING_TONE[row.standing])}>
          {row.standing}
        </Badge>
        {elapsed ? (
          <span className="text-sm text-charcoal-600">
            {row.standing === 'Off the clock' ? 'Since ' : 'For '}{elapsed}
          </span>
        ) : null}
        {row.projectName && row.standing !== 'Off the clock' ? (
          <span className="flex items-center gap-1 text-sm text-charcoal-600">
            <MapPin className="size-3.5" /> {row.projectName}
          </span>
        ) : null}
      </div>

      <div>
        <div className="text-2xl font-bold tabular-nums text-charcoal-900">
          {duration(row.workedMinutes)}
        </div>
        <div className="text-xs text-charcoal-500">
          worked today
          {row.breakMinutes > 0 ? ` · ${duration(row.breakMinutes)} on break` : ''}
          {row.stillOpen ? ' · still running' : ''}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {offered.map((kind) => {
          const Icon = PUNCH_ICON[kind];
          return (
            <Button
              key={kind}
              size={compact ? 'sm' : 'default'}
              variant={kind === 'in' || kind === 'break_end' ? 'default' : 'outline'}
              disabled={busy !== null}
              onClick={() => act(kind)}
            >
              {busy === kind
                ? <Loader2 className="size-4 animate-spin" />
                : <Icon className="size-4" />}
              {PUNCH_LABEL[kind]}
            </Button>
          );
        })}
      </div>

      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p>
      ) : null}
    </div>
  );
}

/** Who is on the clock right now. */
export function TimeClockBoard({ companyId }: { companyId: string }) {
  const board = useQuery(loadTimeClock, [companyId]);

  if (board.status === 'loading') return <LoadingState label="Reading the board" />;
  if (board.status === 'error') return <ErrorState message={board.message} onRetry={board.refetch} />;
  if (board.status === 'demonstration') {
    return <EmptyState title="Connect a workspace to see who is on the clock" />;
  }

  const rows: ClockRow[] = board.data;
  const on = rows.filter((r) => r.standing !== 'Off the clock');

  if (rows.length === 0) {
    return <EmptyState title="No employees yet"
      hint="Add employees on the Workforce screen and they can start punching." />;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-charcoal-600">
        {on.length === 0
          ? 'Nobody is on the clock.'
          : `${on.length} of ${rows.length} on the clock.`}
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Standing</TableHead>
              <TableHead>Since</TableHead>
              <TableHead>Job</TableHead>
              <TableHead className="text-right">Today</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell className="font-medium text-charcoal-900">
                  {r.employeeName}
                  <span className="ml-2 text-xs text-charcoal-500">{r.employeeNumber}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('border', STANDING_TONE[r.standing])}>
                    {r.standing}
                  </Badge>
                </TableCell>
                <TableCell className="text-charcoal-600">
                  {r.standing === 'Off the clock' ? '—' : (since(r.since) ?? '—')}
                </TableCell>
                <TableCell className="text-charcoal-600">{r.projectName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-charcoal-700">
                  {r.workedMinutes > 0 ? duration(r.workedMinutes) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * The last fifty punches, and the one way to take one back.
 *
 * Only the most recent punch offers an undo, because that is the only one the
 * database will void — voiding out of the middle of a day would leave a
 * sequence the clock would never have accepted. Older mistakes are corrected on
 * the timecard, which is what the message says.
 */
export function PunchHistory({ employeeId }: { employeeId?: string }) {
  const history = useQuery(loadRecentPunches(employeeId), [employeeId]);
  const [reason, setReason] = useState('');
  const [undoing, setUndoing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (history.status === 'loading') return <LoadingState label="Reading punches" />;
  if (history.status === 'error') return <ErrorState message={history.message} onRetry={history.refetch} />;
  if (history.status === 'demonstration') return null;
  if (history.data.length === 0) {
    return <EmptyState title="No punches yet" hint="They will appear here as they happen." />;
  }

  const live = history.data.filter((p) => !p.voided);
  const mostRecent = live[0]?.id ?? null;

  const undo = async (id: string) => {
    try {
      await voidPunch(id, reason);
      setReason('');
      setUndoing(null);
      setProblem(null);
      history.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>What</TableHead>
              {employeeId ? null : <TableHead>Who</TableHead>}
              <TableHead>Job</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.map((p) => (
              <TableRow key={p.id} className={cn(p.voided && 'opacity-60')}>
                <TableCell className="whitespace-nowrap text-charcoal-700">
                  {dateTime(p.punchedAt)}
                </TableCell>
                <TableCell>
                  {PUNCH_LABEL[p.kind]}
                  {p.voided ? (
                    <span className="ml-2 text-xs text-charcoal-500">
                      voided — {p.voidReason}
                    </span>
                  ) : null}
                  {p.punchedBySomebodyElse && !p.voided ? (
                    <span className="ml-2 text-xs text-charcoal-500">recorded by a supervisor</span>
                  ) : null}
                </TableCell>
                {employeeId ? null : (
                  <TableCell className="text-charcoal-600">{p.employeeName}</TableCell>
                )}
                <TableCell className="text-charcoal-600">{p.projectName ?? '—'}</TableCell>
                <TableCell className="text-right">
                  {p.id === mostRecent && !p.voided ? (
                    <Button variant="ghost" size="sm" onClick={() => setUndoing(p.id)}>
                      <Undo2 className="size-4" /> Undo
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {undoing ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
          <Label htmlFor="void-reason">Why is this punch being voided?</Label>
          <p className="text-xs text-charcoal-500">
            The punch stays on the record either way. The reason is what tells a payroll
            dispute apart from a typo.
          </p>
          <Input
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Clocked in on the wrong job" />
          <div className="flex gap-2">
            <Button size="sm" disabled={reason.trim().length === 0}
              onClick={() => undo(undoing)}>Void the punch</Button>
            <Button size="sm" variant="ghost" onClick={() => { setUndoing(null); setProblem(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {problem ? <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p> : null}
    </div>
  );
}

/**
 * Days that have punches on them and no timecard rows yet.
 *
 * This is the gap between "the crew worked" and "payroll knows", and before it
 * had a screen the only way to notice it was for somebody to be short on a
 * Friday. A day still running is listed but cannot be posted — the database
 * refuses an open day, and offering the button anyway would be a guess about
 * hours nobody has finished working.
 */
export function UnpostedDays() {
  const days = useQuery(loadUnpostedDays, []);
  const [posting, setPosting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (days.status === 'loading') return <LoadingState label="Looking for unposted days" />;
  if (days.status === 'error') return <ErrorState message={days.message} onRetry={days.refetch} />;
  if (days.status === 'demonstration') return null;
  if (days.data.length === 0) {
    return <EmptyState title="Every day with punches on it has been posted"
      hint="Posted hours appear on the Time & attendance tab, waiting for approval." />;
  }

  const post = async (employeeId: string, day: string) => {
    setPosting(`${employeeId}:${day}`);
    setProblem(null);
    try {
      await postDayToTimecard(employeeId, day);
      days.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    } finally {
      setPosting(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-charcoal-600">
        {plural(days.data.length, 'day')} of punches not yet on a timecard.
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Day</TableHead>
              <TableHead className="text-right">Punches</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.data.map((d) => {
              const key = `${d.employeeId}:${d.workDate}`;
              return (
                <TableRow key={key}>
                  <TableCell className="font-medium text-charcoal-900">{d.employeeName}</TableCell>
                  <TableCell className="text-charcoal-600">{formatDate(d.workDate)}</TableCell>
                  <TableCell className="text-right tabular-nums text-charcoal-700">{d.punches}</TableCell>
                  <TableCell className="text-right">
                    {d.hasAClockOut ? (
                      <Button size="sm" variant="outline" disabled={posting !== null}
                        onClick={() => post(d.employeeId, d.workDate)}>
                        {posting === key
                          ? <Loader2 className="size-4 animate-spin" />
                          : <FileClock className="size-4" />}
                        Post to timecard
                      </Button>
                    ) : (
                      <span className="text-xs text-charcoal-500">still on the clock</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {problem ? <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p> : null}
    </div>
  );
}

/** The whole thing, as it appears on the Workforce screen. */
export function TimeClockSection({ companyId }: { companyId: string }) {
  const { can } = usePermissions();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlarmClock className="size-4 text-charcoal-500" /> Your clock
          </CardTitle>
          <CardDescription>Punch in, take a break, punch out.</CardDescription>
        </CardHeader>
        <CardContent><PunchCard companyId={companyId} /></CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-charcoal-500" /> Who is on the clock
          </CardTitle>
          <CardDescription>Everybody active, whether or not they have punched today.</CardDescription>
        </CardHeader>
        <CardContent><TimeClockBoard companyId={companyId} /></CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Recent punches</CardTitle>
          <CardDescription>
            A punch is a fact and is never edited. The most recent one can be voided, with a reason.
          </CardDescription>
        </CardHeader>
        <CardContent><PunchHistory /></CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="size-4 text-charcoal-500" /> Waiting to be posted
          </CardTitle>
          <CardDescription>
            Punches become timecard hours here, split by the company's overtime rule.
            They arrive on the Time &amp; attendance tab still needing approval.
          </CardDescription>
        </CardHeader>
        <CardContent><UnpostedDays /></CardContent>
      </Card>

      <div className="lg:col-span-3">
        <OvertimePolicyCard companyId={companyId} canEdit={can('company.manage')} />
      </div>
    </div>
  );
}

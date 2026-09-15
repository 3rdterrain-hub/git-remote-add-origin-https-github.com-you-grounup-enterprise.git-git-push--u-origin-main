/**
 * The schedule as approved, and today read against it.
 *
 * Migration 0029 built `schedule_baselines`, `schedule_baseline_activities` and
 * `reporting_schedule_variance` — down to the deliberately missing foreign key
 * that lets a baseline outlive the activity it recorded, so work dropped from
 * the schedule shows as removed rather than quietly disappearing. Nothing could
 * take a baseline, so the variance report inner-joined one that never existed
 * and returned nothing on every project.
 *
 * Two things a schedule is for, and this is the second one. The first is
 * knowing when the work happens. The second is knowing how far it has moved
 * since somebody agreed to it — which is the number a claim is built from, and
 * the reason the reason field is required.
 */
import { useState, type ReactNode } from 'react';
import { Flag, Loader2, TrendingDown, TrendingUp, Minus, CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/misc';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadScheduleBaselines, loadScheduleVariance, takeScheduleBaseline,
  type ScheduleVarianceRow,
} from '@/lib/data/schedule';
import { date, qty, percent, plural } from '@/lib/format';

const MARK: Record<ScheduleVarianceRow['status'], { icon: ReactNode; label: string }> = {
  behind: { icon: <TrendingDown className="size-3.5 text-danger-700" />, label: 'Behind' },
  ahead: { icon: <TrendingUp className="size-3.5 text-success-700" />, label: 'Ahead' },
  on_baseline: { icon: <Minus className="size-3.5 text-charcoal-400" />, label: 'On baseline' },
  not_in_baseline: {
    icon: <CircleHelp className="size-3.5 text-yellow-600" />,
    label: 'Added since',
  },
};

export function Baselines({ projectId, canWrite, calculated }: {
  projectId: string;
  canWrite: boolean;
  /** A baseline of dates nobody computed is a guess to measure against. */
  calculated: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const baselinesQ = useQuery(loadScheduleBaselines(projectId), [projectId, nonce]);
  const varianceQ = useQuery(loadScheduleVariance(projectId), [projectId, nonce]);
  const baselines = baselinesQ.status === 'ready' ? baselinesQ.data : [];
  const variance = varianceQ.status === 'ready' ? varianceQ.data : [];

  const [taking, setTaking] = useState(false);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [takenOn, setTakenOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const behind = variance.filter((v) => v.status === 'behind');
  const criticalBehind = behind.filter((v) => v.isCritical);

  const take = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await takeScheduleBaseline(supabase, { projectId, name, reason, takenOn: takenOn || null });
      setTaking(false); setName(''); setReason(''); setTakenOn('');
      setNonce((n) => n + 1);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="size-4" /> Baselines
          </CardTitle>
          <CardDescription>
            The schedule as somebody approved it, kept so today can be read against it.
            A baseline is never edited — a second one supersedes the first, which is what a
            recovery schedule is, and why each one has to say why it was taken.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {baselinesQ.status === 'loading' ? <LoadingState label="Reading the baselines" /> : null}
          {baselinesQ.status === 'error'
            ? <ErrorState message={baselinesQ.message} onRetry={baselinesQ.refetch} /> : null}

          {baselinesQ.status === 'ready' && baselines.length === 0 && !taking ? (
            <EmptyState title="No baseline on this project"
              description="Until there is one, nothing can say how far the schedule has moved since it was agreed. Variance is measured against a baseline, not against the last version of the plan." />
          ) : null}

          {baselines.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Baseline</TableHead>
                  <TableHead>Taken</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Approved by</TableHead>
                  <TableHead className="text-right">Activities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baselines.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <span className="font-medium text-charcoal-900">{b.name}</span>
                      {b.isCurrent ? <Badge variant="outline" className="ml-2">Current</Badge> : null}
                    </TableCell>
                    <TableCell className="text-charcoal-600">{date(b.takenOn)}</TableCell>
                    <TableCell className="text-charcoal-700">{b.reason}</TableCell>
                    <TableCell className="text-charcoal-600">{b.approvedBy ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">{b.activityCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

          {taking ? (
            <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="bl-name">Call it</Label>
                  <Input id="bl-name" value={name} autoFocus
                    placeholder="Original, Recovery, CO-3 revised"
                    onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="bl-reason">Why it is being taken</Label>
                  <Input id="bl-reason" value={reason}
                    placeholder="Contract award baseline; recovery after the March high water"
                    onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bl-date">Approved on</Label>
                  <Input id="bl-date" type="date" value={takenOn}
                    onChange={(e) => setTakenOn(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-charcoal-500">
                The date is carried as data rather than read from a clock, so a baseline
                approved last March is recorded as last March.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void take()}
                  disabled={busy || !name.trim() || reason.trim().length < 8}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null} Take the baseline
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTaking(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setTaking(true)}
              disabled={!canWrite || !calculated}
              title={!canWrite ? 'Needs permission to change the project'
                : !calculated
                  ? 'Calculate the schedule first — a baseline of dates nobody computed is a guess to measure against'
                  : undefined}>
              <Flag className="size-4" /> Take a baseline
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Against the baseline</CardTitle>
          <CardDescription>
            Every activity as it stands now against the current baseline, in calendar days.
            Working-day variance is the engine&rsquo;s, because it knows the calendar.
            {criticalBehind.length > 0 ? (
              <> {plural(criticalBehind.length, 'critical-path activity', 'critical-path activities')} behind
                the baseline — that slip is the finish date moving.</>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {varianceQ.status === 'error'
            ? <ErrorState message={varianceQ.message} onRetry={varianceQ.refetch} /> : null}
          {varianceQ.status === 'ready' && variance.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nothing to compare yet"
                description="Variance needs a baseline to measure against. Take one and every activity appears here, including any added since." />
            </div>
          ) : null}
          {variance.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Baseline finish</TableHead>
                  <TableHead>Now</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Complete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.map((v) => (
                  <TableRow key={v.activityId}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-medium text-charcoal-900">
                        {MARK[v.status].icon}
                        {v.wbsCode ? <span className="font-mono text-xs text-charcoal-500">{v.wbsCode}</span> : null}
                        {v.activityName}
                      </span>
                      <span className="text-xs text-charcoal-500">{MARK[v.status].label}</span>
                    </TableCell>
                    <TableCell className="text-charcoal-600">
                      {v.baselineFinish ? date(v.baselineFinish) : '—'}
                    </TableCell>
                    <TableCell className="text-charcoal-600">{date(v.currentFinish)}</TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {v.finishVarianceDays === null ? '—' : (
                        <span className={v.finishVarianceDays > 0 ? 'text-danger-700'
                          : v.finishVarianceDays < 0 ? 'text-success-700' : 'text-charcoal-500'}>
                          {v.finishVarianceDays > 0 ? '+' : ''}{qty(v.finishVarianceDays, 0)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {percent(v.percentComplete, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

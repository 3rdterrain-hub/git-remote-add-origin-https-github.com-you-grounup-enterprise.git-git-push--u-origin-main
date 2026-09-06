/**
 * The panels an advanced dashboard is built from.
 *
 * Every one of these reads a reporting view that already existed and that
 * nothing rendered. The semantic layer has held nineteen of them since
 * migration 0025; the dashboard showed four figures and three panels. So a
 * company could be under-billed on a project, have a foreman's certification
 * lapsing in nine days and an investigation still open, and the first screen
 * they saw every morning said none of it.
 *
 * Each panel says what it is counting and what it leaves out, because a figure
 * on a dashboard is quoted in meetings and a figure nobody can check is worse
 * than one nobody has.
 */
import { AlertTriangle, CalendarClock, HardHat, ShieldAlert, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, type QueryState } from '@/lib/data/query';
import {
  loadCredentialExpiries, loadProjectBilling, loadScheduleSlips,
  loadSafetyStanding, loadBidPerformance,
} from '@/lib/data/dashboard';
import { money, moneyCompact, percent, date, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/** One shape for every panel body, so a panel cannot forget a state. */
function Body<T>({ state, label, empty, children }: {
  state: QueryState<T>;
  label: string;
  empty: { title: string; hint: string };
  children: (data: T) => React.ReactNode;
}) {
  if (state.status === 'demonstration') return null;
  if (state.status === 'loading') return <LoadingState label={label} />;
  if (state.status === 'error') return <ErrorState message={state.message} />;
  const data = state.data;
  if (Array.isArray(data) && data.length === 0) {
    return <EmptyState title={empty.title} hint={empty.hint} />;
  }
  return <>{children(data)}</>;
}

// ---------------------------------------------------------------------------

export function CredentialsPanel() {
  const q = useQuery(loadCredentialExpiries, []);
  return (
    <Body state={q} label="Reading credentials"
      empty={{ title: 'Every certification is current',
               hint: 'Anything expiring or expired appears here, soonest first.' }}>
      {(rows) => (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.credentialId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-charcoal-900">
                  {c.employeeName} — {c.credentialName}
                </p>
                {c.blocksWorkTypes.length > 0 ? (
                  <p className="truncate text-xs text-charcoal-500">
                    Stops: {c.blocksWorkTypes.join(', ')}
                  </p>
                ) : null}
              </div>
              <Badge variant={
                c.daysRemaining == null ? 'default'
                : c.daysRemaining < 0 ? 'danger'
                : c.daysRemaining <= 30 ? 'warn' : 'default'}>
                {c.daysRemaining == null ? c.standing
                  : c.daysRemaining < 0 ? `${Math.abs(c.daysRemaining)}d expired`
                  : `${c.daysRemaining}d left`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Body>
  );
}

export function BillingPanel() {
  const q = useQuery(loadProjectBilling, []);
  return (
    <Body state={q} label="Reading project billing"
      empty={{ title: 'No project has been billed yet',
               hint: 'Earned against billed appears here once a project has costs and an invoice.' }}>
      {(rows) => (
        <div className="space-y-2">
          {rows.map((p) => (
            <div key={p.projectId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-charcoal-900">
                  {p.projectNumber} · {p.projectName}
                </p>
                <p className="text-xs text-charcoal-500">
                  {percent(p.percentComplete, 0)} complete · earned {moneyCompact(p.earnedRevenue)},
                  billed {moneyCompact(p.billedToDate)}
                  {p.retainageHeld > 0 ? ` · ${moneyCompact(p.retainageHeld)} retained` : ''}
                </p>
              </div>
              <span className={cn('tabular shrink-0 text-sm font-medium',
                p.overUnderBilled < 0 ? 'text-danger-700' : 'text-charcoal-900')}>
                {p.overUnderBilled < 0 ? '−' : '+'}{money(Math.abs(p.overUnderBilled))}
              </span>
            </div>
          ))}
          <p className="pt-1 text-xs text-charcoal-500">
            Under-billed is money already spent and not yet invoiced. Over-billed is cash held
            against work not yet earned — neither is profit.
          </p>
        </div>
      )}
    </Body>
  );
}

export function SchedulePanel() {
  const q = useQuery(loadScheduleSlips, []);
  return (
    <Body state={q} label="Reading the schedule"
      empty={{ title: 'Nothing is finishing later than the baseline',
               hint: 'An activity that moves past its baseline finish appears here, worst first.' }}>
      {(rows) => (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.activityId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-charcoal-900">{a.activityName}</p>
                <p className="text-xs text-charcoal-500">
                  baseline {a.baselineFinish ? date(a.baselineFinish) : '—'} · now{' '}
                  {a.currentFinish ? date(a.currentFinish) : '—'}
                  {a.status ? ` · ${a.status}` : ''}
                </p>
              </div>
              <Badge variant={a.finishVarianceDays > 14 ? 'danger' : 'warn'}>
                {plural(a.finishVarianceDays, 'day')} late
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Body>
  );
}

export function SafetyPanel() {
  const q = useQuery(loadSafetyStanding, []);
  return (
    <Body state={q} label="Reading safety records"
      empty={{ title: 'No incidents recorded',
               hint: 'Incidents and recordables by month appear here once one is logged.' }}>
      {(rows) => (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.monthOf} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-charcoal-600">{date(m.monthOf)}</span>
              <span className="tabular flex items-center gap-3 text-charcoal-900">
                <span>{m.incidents} incident{m.incidents === 1 ? '' : 's'}</span>
                <span className={m.recordables > 0 ? 'text-danger-700' : 'text-charcoal-400'}>
                  {m.recordables} recordable
                </span>
                {m.openInvestigations > 0 ? (
                  <Badge variant="warn">{m.openInvestigations} open</Badge>
                ) : null}
              </span>
            </div>
          ))}
          <p className="pt-1 text-xs text-charcoal-500">
            Counts, not rates. TRIR and DART divide these by approved hours and appear on Reports,
            where the denominator can be seen.
          </p>
        </div>
      )}
    </Body>
  );
}

export function BidPerformancePanel() {
  const q = useQuery(loadBidPerformance, []);
  return (
    <Body state={q} label="Reading bid performance"
      empty={{ title: 'Nothing has been bid yet',
               hint: 'Estimates, submissions, wins and losses appear here by month.' }}>
      {(rows) => (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.monthOf} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-charcoal-600">{date(m.monthOf)}</span>
              <span className="tabular flex items-center gap-3">
                <span className="text-charcoal-500">{m.submitted} submitted</span>
                <span className="text-success-700">{m.won} won</span>
                <span className="text-charcoal-500">{m.lost} lost</span>
                <span className="font-medium text-charcoal-900">
                  {m.hitRate == null ? '—' : percent(m.hitRate, 0)}
                </span>
              </span>
            </div>
          ))}
          <p className="pt-1 text-xs text-charcoal-500">
            The hit rate counts decided bids only. One still with a customer has not been won or
            lost, and counting it either way would move the figure without anything happening.
          </p>
        </div>
      )}
    </Body>
  );
}

/** The icon each panel carries, kept beside the panels rather than in the catalog. */
export const PANEL_ICON: Record<string, React.ReactNode> = {
  due: <CalendarClock className="size-4" />,
  weather: <CalendarClock className="size-4" />,
  awaiting: <TrendingUp className="size-4" />,
  bids: <TrendingUp className="size-4" />,
  production: <HardHat className="size-4" />,
  schedule: <AlertTriangle className="size-4" />,
  billing: <TrendingUp className="size-4" />,
  credentials: <ShieldAlert className="size-4" />,
  safety: <ShieldAlert className="size-4" />,
};

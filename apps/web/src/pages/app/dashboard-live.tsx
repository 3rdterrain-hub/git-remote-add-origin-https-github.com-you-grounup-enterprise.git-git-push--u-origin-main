/**
 * The first screen, on real data.
 *
 * What it shows is chosen by one test: five things that cost a contractor money
 * when nobody looks at them. A bid due this week nobody has started. A proposal
 * sitting with a customer nobody has chased. An estimate the engine has blocked,
 * found on the day it is due rather than the day after. Days the weather is
 * about to take, before the schedule promises them. Work billed and not paid.
 *
 * Two figures the old fixture carried are deliberately gone. "Percent complete"
 * had nothing behind it — there is no progress measurement in the platform to
 * derive one from. "Win rate 62%" was a constant. Where something cannot be
 * measured this says so, which is worth more than filling the space.
 */
import { Link } from 'react-router-dom';
import {
  AlarmClock, AlertTriangle, ArrowRight, CalendarClock, Calculator, CircleDollarSign,
  CloudRain, HardHat, LayoutGrid, Loader2, RefreshCw, Send, Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader, StatTile, useAnswerBelow } from '@/components/layout/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { callFunction } from '@/lib/supabase';
import { usePermissions, loadWhoAmI, greeting } from '@/lib/data/session';
import {
  loadDueBids, loadAwaitingAnswer, loadWeather, loadMoney, refreshWeather,
  type DueBid, type WeatherDay, type AwaitingAnswer,
} from '@/lib/data/dashboard';
import { loadMyCompanyId } from '@/lib/data/estimates';
import { loadRateVariance, type RateVarianceView } from '@/lib/data/project-view';
import { WeekAhead } from '@/components/dashboard/week-ahead';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CustomizeDashboard } from '@/components/dashboard/customize';
import {
  BidPerformancePanel, BillingPanel, CredentialsPanel, SafetyPanel, SchedulePanel,
} from '@/components/dashboard/panels';
import {
  DASHBOARD_TABS, DEFAULT_DASHBOARD, visiblePanels, type DashboardPreference,
} from '@/lib/dashboard-panels';
import { loadDashboardPreference } from '@/lib/data/preferences';
import { PunchCard } from '@/components/workforce/time-clock';
import { money, moneyCompact, date, integer, percent, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DashboardLivePage() {
  const bids = useQuery(loadDueBids, []);
  const awaiting = useQuery(loadAwaitingAnswer, []);
  const weather = useQuery(loadWeather, []);
  const moneyQ = useQuery(loadMoney, []);
  const variance = useQuery(loadRateVariance, []);
  const { can } = usePermissions();

  /*
   * The arrangement is this person's, read once and held locally so saving it
   * does not make the whole dashboard flicker while every panel refetches.
   */
  const whoQ = useQuery(loadWhoAmI, []);
  const myCompany = useQuery(loadMyCompanyId, []);
  const companyId = myCompany.status === 'ready' ? myCompany.data : null;
  const who = whoQ.status === 'ready' ? whoQ.data : null;

  const prefQ = useQuery(loadDashboardPreference, []);
  const [preference, setPreference] = useState<DashboardPreference>(DEFAULT_DASHBOARD);
  const [arranging, setArranging] = useState(false);
  useEffect(() => {
    if (prefQ.status === 'ready') setPreference(prefQ.data);
  }, [prefQ.status, prefQ.status === 'ready' ? prefQ.data : null]);

  const dueBids = bids.status === 'ready' ? bids.data : [];
  const proposals = awaiting.status === 'ready' ? awaiting.data : [];
  const forecast = weather.status === 'ready' ? weather.data : [];
  const cash = moneyQ.status === 'ready' ? moneyQ.data : null;
  const rates = variance.status === 'ready' ? variance.data : [];

  const today = forecast.find((d) => d.day === new Date().toISOString().slice(0, 10))
    ?? forecast[0] ?? null;
  const { showing, show } = useAnswerBelow();
  const thisWeek = dueBids.filter((b) => b.daysAway <= 7);
  const overdue = dueBids.filter((b) => b.daysAway < 0);
  const blocked = dueBids.filter((b) => b.blockedFromIssue && b.priced);
  const unanswered = proposals.reduce((a, p) => a + p.totalPrice, 0);
  const lapsed = proposals.filter((p) => p.lapsed);

  const loading = [bids, awaiting, moneyQ].some((q) => q.status === 'loading');

  /*
   * The forecast fetches itself. Asking somebody to press a button for their
   * own weather every morning is asking them to do the platform's work — and
   * the function caches for three hours, so a page load is not an external
   * request. It only tries once per visit, and only when there is nothing
   * cached: a company with no address configured should see the reason, not a
   * request retrying forever.
   */
  const fetchedOnce = useRef(false);
  useEffect(() => {
    if (fetchedOnce.current) return;
    if (weather.status !== 'ready' || weather.data.length > 0) return;
    if (!companyId) return;
    fetchedOnce.current = true;
    refreshWeather(callFunction, companyId).then(() => weather.refetch()).catch(() => {});
  }, [weather.status, weather.status === 'ready' ? weather.data.length : 0, companyId]);

  const panels = visiblePanels(preference, can);
  const tabsInUse = DASHBOARD_TABS.filter((t) => panels.some((p) => p.tab === t));

  /*
   * One place that maps a panel key to what it draws. A key with no case here
   * would render nothing at all, so the default returns null loudly rather than
   * an empty card that looks like a panel with no data.
   */
  const renderPanel = (key: string) => {
    switch (key) {
      case 'due': return <DuePanel bids={dueBids} state={bids.status} />;
      case 'clock': return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlarmClock className="size-4 text-charcoal-500" /> Your clock
            </CardTitle>
            <CardDescription>
              <Link to="/app/workforce" className="hover:text-charcoal-900">
                Who is on the clock →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {companyId
              ? <PunchCard companyId={companyId} compact />
              : <LoadingState label="Finding your company" />}
          </CardContent>
        </Card>
      );
      case 'weather': return (
        <div className="space-y-6">
          <WeatherCard days={forecast} state={weather.status}
            readError={weather.status === 'error' ? weather.message : null}
            onRefreshed={() => weather.refetch()} />
          <WeekAhead bids={dueBids} weather={forecast} />
        </div>
      );
      case 'awaiting': return <AwaitingPanel proposals={proposals} />;
      case 'bids': return <BidPerformancePanel />;
      case 'production': return <RateVariancePanel rates={rates} />;
      case 'schedule': return <SchedulePanel />;
      case 'billing': return <BillingPanel />;
      case 'credentials': return <CredentialsPanel />;
      case 'safety': return <SafetyPanel />;
      default: return null;
    }
  };
  const failure = [bids, awaiting, moneyQ].find((q) => q.status === 'error');

  return (
    <div className="space-y-6">
      {/*
        * Named for the thing in the navigation that leads here. A person who
        * clicks "Dashboard" and arrives at a page called "Today" has to work
        * out whether they are in the right place, which is a small tax charged
        * on every single visit. The greeting is still worth saying — it just is
        * not the name of the screen, so it moves down a line.
        */}
      <PageHeader
        title="Dashboard"
        description={
          <span className="space-y-1">
            <span className="block font-medium text-charcoal-800">
              {who?.firstName ? `${greeting()}, ${who.firstName}` : greeting()}
              {who?.companyName ? ` · ${who.companyName}` : ''}
            </span>
            <span className="block">
              {loading ? 'Reading your workspace…'
                : `${plural(thisWeek.length, 'bid')} due inside a week, `
                  + `${plural(proposals.length, 'proposal')} waiting on a customer, `
                  + `${plural(cash?.activeProjects ?? 0, 'active project')}.`}
            </span>
            {/*
              * Today's weather, in the sentence rather than behind a tab. It is
              * the first thing a contractor checks and the platform already
              * knows it — a forecast filed under a heading somebody has to find
              * is a forecast they will keep reading on their phone instead.
              */}
            {today ? (
              <span className="block text-charcoal-600">
                {today.workable
                  ? <><Sun className="mr-1 inline size-3.5 text-warn-600" />
                      {today.summary}, {Math.round(today.highF ?? 0)}°/{Math.round(today.lowF ?? 0)}° — workable</>
                  : <><CloudRain className="mr-1 inline size-3.5 text-info-600" />
                      {today.summary}, {Math.round(today.highF ?? 0)}°/{Math.round(today.lowF ?? 0)}° — {today.lostReason ?? 'not workable'}</>}
                {forecast.length > 0 ? (
                  <span className="text-charcoal-500">
                    {' '}· {forecast.filter((d) => d.workable).length} of {forecast.length}{' '}
                    days workable this week
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setArranging(true)}>
              <LayoutGrid className="size-4" /> Arrange
            </Button>
            <Button asChild disabled={!can('estimates.write')}>
              <Link to="/app/estimates"><Calculator className="size-4" /> New estimate</Link>
            </Button>
          </>
        }
      />

      {failure && failure.status === 'error'
        ? <ErrorState message={failure.message} onRetry={failure.refetch} /> : null}
      {loading ? <LoadingState label="Loading your workspace" /> : null}

      {overdue.length > 0 ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${plural(overdue.length, 'bid is', 'bids are')} past the date`}>
          {overdue.slice(0, 3).map((b) => `${b.number} (${b.dueKind === 'bid' ? 'due' : 'expired'} ${date(b.dueAt)})`).join(', ')}
          {overdue.length > 3 ? ` and ${overdue.length - 3} more` : ''}.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Due this week" value={thisWeek.length}
          tone={overdue.length ? 'danger' : thisWeek.length ? 'warn' : undefined}
          icon={<CalendarClock className="size-4" />}
          hint={overdue.length ? `${overdue.length} already past` : 'bids and expiries'}
          active={showing === 'what-is-due'}
          actionLabel="Show what is due"
          onClick={() => show('what-is-due')} />
        <StatTile label="Waiting on a customer" value={moneyCompact(unanswered)}
          icon={<Send className="size-4" />}
          hint={lapsed.length
            ? `${lapsed.length} past its validity`
            : `${plural(proposals.length, 'proposal')} issued`}
          active={showing === 'waiting-on-a-customer'}
          actionLabel="Show the proposals waiting on an answer"
          onClick={() => show('waiting-on-a-customer')} />
        <StatTile label="Blocked from issue" value={blocked.length}
          tone={blocked.length ? 'danger' : 'success'}
          hint="the engine has not cleared these to bid"
          detail={blocked.length === 0
            ? 'Every estimate with a date on it has been priced and cleared to bid.'
            : (
              <>
                Priced, and the engine will not clear them: a line carrying a quantity and no
                price, a rate nobody sourced, or a question still open on the drawings. Each
                one says which in <strong>What is due</strong> below.
              </>
            )} />
        <StatTile label="Billed, not collected"
          value={cash ? moneyCompact(cash.billedToDate - cash.actualCost) : '—'}
          icon={<CircleDollarSign className="size-4" />}
          hint={cash ? `across ${plural(cash.activeProjects, 'active project')}` : 'no projects yet'}
          detail={cash ? (
            <>
              {moneyCompact(cash.billedToDate)} billed against {moneyCompact(cash.actualCost)}
              {' '}of actual cost, across {plural(cash.activeProjects, 'active project')}.
              <br />
              It is invoiced minus incurred, not cash in the bank: what a customer has actually
              paid is not recorded here, so a project that billed and was paid reads the same
              as one that billed and was not.
            </>
          ) : 'No active projects, so nothing has been billed.'} />
      </div>

      {/*
        * The panels a person has arranged, in their order. What is offered is
        * decided by the catalog in `lib/dashboard-panels.ts` — the same list the
        * customizer reads — so a panel cannot be rendered that cannot be turned
        * off, offered that nothing renders, or shown to somebody whose role does
        * not permit it.
        */}
      {panels.length === 0 ? (
        <EmptyState title="Every panel is switched off"
          hint={<Button variant="outline" size="sm" onClick={() => setArranging(true)}>
            Arrange your dashboard
          </Button>} />
      ) : preference.layout === 'single' ? (
        <PanelGrid panels={panels} render={renderPanel} />
      ) : (
        <Tabs defaultValue={tabsInUse[0] ?? 'Today'}>
          <TabsList>
            {tabsInUse.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
          </TabsList>
          {tabsInUse.map((t) => (
            <TabsContent key={t} value={t} className="space-y-6">
              <PanelGrid panels={panels.filter((p) => p.tab === t)} render={renderPanel} />
            </TabsContent>
          ))}
        </Tabs>
      )}

      <CustomizeDashboard open={arranging} onOpenChange={setArranging}
        preference={preference} can={can}
        onSaved={(next) => { setPreference(next); prefQ.refetch(); }} />
    </div>
  );
}

/** A card that lays panels out two-up, letting a full-width one take the row. */
function PanelGrid({ panels, render }: {
  panels: readonly { key: string; width: 'half' | 'full' }[];
  render: (key: string) => React.ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {panels.map((p) => (
        <div key={p.key} className={p.width === 'full' ? 'lg:col-span-2' : undefined}>
          {render(p.key)}
        </div>
      ))}
    </div>
  );
}

function DuePanel({ bids, state }: { bids: DueBid[]; state: string }) {
  return (
    <Card id="what-is-due">
      <CardHeader>
        <CardTitle>What is due</CardTitle>
        <CardDescription>
          A bid deadline and an expiry are the same kind of fact — a date after which doing
          nothing costs you the job. Which one it is decides what to do about it.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {state === 'ready' && bids.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing has a date on it"
              hint="Give an estimate a bid date or an expiry and it will appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-charcoal-200">
            {bids.slice(0, 8).map((b) => <DueRow key={b.id} bid={b} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AwaitingPanel({ proposals }: { proposals: AwaitingAnswer[] }) {
  return (
    <Card id="waiting-on-a-customer">
      <CardHeader>
        <CardTitle>Waiting on a customer</CardTitle>
        <CardDescription>
          Issued, and no answer recorded. Until migration 0101 nothing could record one, so
          every proposal ever sent sat here forever.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {proposals.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing is out with a customer"
              hint={<Link to="/app/proposals" className="text-yellow-700 underline">
                See every proposal
              </Link>} />
          </div>
        ) : (
          <ul className="divide-y divide-charcoal-200">
            {proposals.slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link to="/app/proposals"
                    className="font-medium text-charcoal-900 hover:text-yellow-700">
                    {p.number}
                  </Link>
                  <p className="truncate text-xs text-charcoal-500">
                    {p.customerName ?? 'No customer'} · {p.title}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular font-medium text-charcoal-900">{money(p.totalPrice)}</p>
                  <p className={cn('text-xs', p.lapsed ? 'text-danger-600' : 'text-charcoal-500')}>
                    {p.lapsed ? 'past its validity' : `out ${plural(p.daysOut, 'day')}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RateVariancePanel({ rates }: { rates: RateVarianceView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Against the rate it was bid at</CardTitle>
        <CardDescription>
          Field production measured against the library rate the work was priced with. It
          reports and does not propose — a library rate changes through approval, never by a
          silent edit (RULE-008).
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rates.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No production recorded against a rate yet"
              hint="Daily production entered against an estimated rate appears here." />
          </div>
        ) : (
          <ul className="divide-y divide-charcoal-200">
            {rates.slice(0, 6).map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-900">{r.rateCode}</p>
                  <p className="text-xs text-charcoal-500">
                    {integer(r.hoursObserved)} hours across {plural(r.observations, 'job')}
                  </p>
                </div>
                <Badge variant={r.variancePercent < -0.05 ? 'danger'
                  : r.variancePercent > 0.05 ? 'success' : 'default'}>
                  {percent(r.variancePercent, 1)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DueRow({ bid }: { bid: DueBid }) {
  const late = bid.daysAway < 0;
  const soon = bid.daysAway >= 0 && bid.daysAway <= 3;
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <Link to={`/app/estimates/${bid.versionId ?? bid.id}`}
          className="font-medium text-charcoal-900 hover:text-yellow-700">
          {bid.number}
        </Link>
        <p className="truncate text-xs text-charcoal-500">
          {bid.customerName ?? 'No client'} · {bid.name}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
          {!bid.priced ? (
            <span className="text-charcoal-500">not priced yet</span>
          ) : bid.blockedFromIssue ? (
            <span className="flex items-center gap-1 text-danger-600">
              <AlertTriangle className="size-3" /> not cleared to issue
            </span>
          ) : (
            <span className="tabular text-charcoal-600">{money(bid.bidPrice)}</span>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('text-sm font-medium',
          late ? 'text-danger-700' : soon ? 'text-warn-700' : 'text-charcoal-700')}>
          {late ? `${Math.abs(bid.daysAway)}d late`
            : bid.daysAway === 0 ? 'today'
            : `in ${bid.daysAway}d`}
        </p>
        <p className="text-xs text-charcoal-500">
          {bid.dueKind === 'bid' ? 'bid due' : 'price expires'} {date(bid.dueAt)}
        </p>
      </div>
    </li>
  );
}

/**
 * The forecast, and what it is going to cost.
 *
 * Weather earns a place here because it is an input to a number the platform
 * already carries: `calendar_efficiency` on every estimate version, and the
 * weather days the schedule engine models. Both have always taken a figure
 * somebody guessed. This is the first thing that can say what it actually is.
 */
function WeatherCard({ days, state, readError, onRefreshed }: {
  days: WeatherDay[];
  state: 'demonstration' | 'loading' | 'error' | 'ready';
  /** Why the forecast could not be read, when that is what happened. */
  readError: string | null;
  onRefreshed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyQ = useQuery(loadMyCompanyId, []);
  const companyId = companyQ.status === 'ready' ? companyQ.data : null;

  const today = new Date().toISOString().slice(0, 10);
  const ahead = days.filter((d) => d.day >= today);
  const workable = ahead.filter((d) => d.workable).length;

  const refresh = async () => {
    if (!companyId) return;
    setBusy(true); setError(null);
    try {
      await refreshWeather((n, b) => callFunction(n, b), companyId);
      onRefreshed();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>The week ahead</CardTitle>
          <CardDescription>
            {ahead.length > 0
              ? `${workable} of ${ahead.length} days workable — ${percent(workable / ahead.length, 0)} calendar efficiency.`
              : 'What the weather is about to take.'}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh}
          disabled={busy || !companyId} aria-label="Refresh the forecast">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {state === 'loading' ? <LoadingState label="Loading the forecast" /> : null}
        {error ? <ErrorState message={error} /> : null}
        {/*
          * A read that failed says so. Showing an empty card instead would read
          * as "no weather coming", which is the one thing it does not mean.
          */}
        {state === 'error' && readError && !error ? <ErrorState message={readError} /> : null}

        {state === 'ready' && ahead.length === 0 && !error ? (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-600">
              No forecast yet for your yard.
            </p>
            <p className="text-xs text-charcoal-500">
              It is fetched from your company's city, and it feeds the calendar efficiency an
              estimate is priced with — which has always been a number somebody guessed at.
            </p>
            <Button size="sm" variant="outline" onClick={refresh} disabled={busy || !companyId}>
              <RefreshCw className="size-4" /> Fetch it
            </Button>
          </div>
        ) : null}

        {ahead.length > 0 ? (
          <ul className="space-y-1.5">
            {ahead.slice(0, 7).map((d) => (
              <li key={d.day} className="flex items-center gap-3">
                <span className="w-9 shrink-0 text-xs font-medium text-charcoal-600">
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
                {d.workable
                  ? <Sun className="size-4 shrink-0 text-yellow-500" />
                  : <CloudRain className="size-4 shrink-0 text-charcoal-400" />}
                <span className="min-w-0 flex-1 truncate text-sm text-charcoal-700">
                  {d.summary ?? '—'}
                  {d.lostReason ? (
                    <span className="ml-1 text-xs text-danger-600">· {d.lostReason}</span>
                  ) : null}
                </span>
                <span className="tabular shrink-0 text-xs text-charcoal-500">
                  {d.highF == null ? '—' : `${Math.round(d.highF)}°`}
                  {d.lowF == null ? '' : ` / ${Math.round(d.lowF)}°`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Kept beside the dashboard so a project link has somewhere obvious to go. */
export function ProjectsShortcut() {
  return (
    <Button asChild variant="outline">
      <Link to="/app/projects"><HardHat className="size-4" /> Projects <ArrowRight className="size-3.5" /></Link>
    </Button>
  );
}

/**
 * Entity — one project, on its own data.
 *
 * This screen read `PROJECTS` from `@/data/operations` and showed invented
 * daily reports, invented change orders, invented RFIs and invented submittals
 * under a real project number, reached by clicking a real row on a live
 * projects list. It is the billing-page defect one screen over, and worse in
 * one respect: a daily report is the contemporaneous record of a day on site
 * and is evidence in a claim, so an invented one filed under a real job is not
 * merely wrong, it is the kind of wrong that gets read out in a deposition.
 *
 * Two figures changed meaning in the move, and both changes are deliberate.
 *
 *   * **Percent complete** is earned value over budget — each task's own budget
 *     weighted by that task's own progress. Ten pipe fittings and one lift
 *     station are not one eleventh of the job each.
 *   * **Cost performance index** is earned value over actual cost. The fixture
 *     computed (budget x percent complete) / actual cost; fed the live
 *     cost-to-cost percent complete, that reduces to actual cost over actual
 *     cost and prints 1.00 on every project in the platform forever while
 *     looking like a measurement.
 *
 * Both are null where no task carries a budget, and the screen says so in
 * words. A project nobody has broken down has not earned nothing — it has
 * earned an amount nobody can compute, and those are different answers.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  HardHat, CloudRain, Users2, TrendingUp, TrendingDown,
  HelpCircle, Package, Gauge, AlertTriangle, CheckCircle2, Clock,
  MapPin,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { SiteWeather } from '@/components/project/site-weather';
import { useQuery } from '@/lib/data/query';
import { usePermissions, useCompanyId } from '@/lib/data/session';
import { ProjectActions } from '@/components/project/project-actions';
import {
  loadProject, loadProjectMoney, loadProjectProgress, loadDailyReports,
  loadChangeOrders, loadProjectRfis, loadProjectSubmittals,
  SUBMITTAL_SETTLED, CHANGE_UNDECIDED, CHANGE_APPROVED,
} from '@/lib/data/project';
import {
  money, moneyCompact, percent, qty, integer, date, titleCase, relativeDays, plural,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, 'default' | 'info' | 'warn' | 'success' | 'danger'> = {
  preconstruction: 'default', active: 'info', on_hold: 'warn',
  substantially_complete: 'success', closed: 'success', canceled: 'danger',
};

export function ProjectDetailPage() {
  /*
   * The boxes across the top each summarize something one of the five tabs
   * below already shows in full. The change-order boxes further down do the
   * same to the list directly beneath them, so they filter it.
   */
  const [tab, setTab] = useState('field');
  const [coFilter, setCoFilter] = useState<'all' | 'approved' | 'pending'>('all');
  const { projectId } = useParams();
  const id = projectId ?? '';
  const { companyId } = useCompanyId();
  const { can } = usePermissions();

  const projectQ = useQuery(loadProject(id), [id]);
  const moneyQ = useQuery(loadProjectMoney(id), [id]);
  const progressQ = useQuery(loadProjectProgress(id), [id]);
  const reportsQ = useQuery(loadDailyReports(id), [id]);
  const changesQ = useQuery(loadChangeOrders(id), [id]);
  const rfisQ = useQuery(loadProjectRfis(id), [id]);
  const submittalsQ = useQuery(loadProjectSubmittals(id), [id]);

  const project = projectQ.status === 'ready' ? projectQ.data : null;
  const finances = moneyQ.status === 'ready' ? moneyQ.data : null;
  const progress = progressQ.status === 'ready' ? progressQ.data : null;
  const reports = reportsQ.status === 'ready' ? reportsQ.data : [];
  const changeOrders = changesQ.status === 'ready' ? changesQ.data : [];
  const rfis = rfisQ.status === 'ready' ? rfisQ.data : [];
  const submittals = submittalsQ.status === 'ready' ? submittalsQ.data : [];

  const openRfis = rfis.filter((r) => ['draft', 'open'].includes(r.status));
  const openSubmittals = submittals.filter((s) => !SUBMITTAL_SETTLED.includes(s.status));
  const approvedCo = changeOrders.filter((c) => CHANGE_APPROVED.includes(c.status));
  const pendingCo = changeOrders.filter((c) => CHANGE_UNDECIDED.includes(c.status));
  const shownCo = coFilter === 'approved' ? approvedCo
    : coFilter === 'pending' ? pendingCo : changeOrders;

  /*
   * Earned value against spend. Both come from the database — the first from
   * the tasks, the second from `project_costs` — so a screen cannot show one
   * that disagrees with the other.
   */
  const cpi = progress?.costPerformanceIndex ?? null;
  const earned = progress?.earnedValue ?? null;
  const variance = earned !== null && finances ? earned - finances.actualCost : null;

  const production = useMemo(
    () => reports.flatMap((r) => r.production.map((p) => ({ ...p, reportDate: r.reportDate }))),
    [reports],
  );

  const showTab = (next: string) => {
    setTab(next);
    if (next !== 'changes') setCoFilter('all');
  };

  if (projectQ.status === 'loading') return <LoadingState label="Opening the project" />;
  if (projectQ.status === 'error') {
    return <ErrorState message={projectQ.message} onRetry={projectQ.refetch} />;
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <PageHeader
          breadcrumb={<Link to="/app/projects" className="hover:text-charcoal-900">Projects</Link>}
          title="Project not found" />
        <EmptyState title="No project with that address"
          hint="It may belong to another company, or it may have been deleted." />
      </div>
    );
  }

  const siteLine = [project.siteAddress, project.siteCity, project.siteState]
    .filter(Boolean).join(', ');

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<Link to="/app/projects" className="hover:text-charcoal-900">Projects</Link>}
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {project.number}
              {project.customerName ? ` · ${project.customerName}` : ''}
            </span>
            <Badge variant={STATUS_TONE[project.status] ?? 'default'}>
              {titleCase(project.status)}
            </Badge>
            {pendingCo.length
              ? <Badge variant="warn">{plural(pendingCo.length, 'change order')} pending</Badge>
              : null}
            {siteLine
              ? (
                <span className="flex items-center gap-1 text-charcoal-500">
                  <MapPin className="size-3.5" />{siteLine}
                </span>
              )
              : null}
          </span>
        }
        actions={
          /*
           * Three buttons that did nothing until migration 0157. Each opens the
           * tab its new record landed on and refetches it, so the thing that
           * was just made is on screen rather than somewhere to go and find.
           */
          <ProjectActions
            projectId={id}
            canWrite={can('projects.write')}
            canRaiseRfi={can('estimates.write')}
            onCreated={(what) => {
              if (what === 'daily') { setTab('field'); reportsQ.refetch(); }
              if (what === 'change') { setTab('changes'); changesQ.refetch(); }
              if (what === 'rfi') { setTab('rfis'); rfisQ.refetch(); }
            }} />
        }
      />

      {cpi !== null && cpi < 1 && earned !== null && finances ? (
        <Alert tone="danger" icon={<TrendingDown className="size-4" />}
          title={`Cost performance index ${cpi.toFixed(2)} — spending faster than the work is earning`}>
          {money(earned)} of budgeted work finished against {money(finances.actualCost)} spent to do
          it. That gap is margin fade, and it shows up here before it shows up in the month-end
          close.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Contract value"
          value={finances ? moneyCompact(finances.revisedContractValue) : '—'}
          icon={<HardHat className="size-4" />}
          hint={finances && finances.approvedChangeOrders !== 0
            ? `${moneyCompact(finances.approvedChangeOrders)} in executed changes`
            : 'no executed changes'}
          onClick={() => { setTab('changes'); setCoFilter('approved'); }}
          active={tab === 'changes' && coFilter === 'approved'}
          actionLabel="Show the approved changes that moved the contract value" />

        <StatTile label="Percent complete"
          value={progress?.percentComplete != null ? percent(progress.percentComplete, 0) : '—'}
          icon={<Gauge className="size-4" />}
          hint={project.plannedStart && project.plannedFinish
            ? `${date(project.plannedStart)} → ${date(project.plannedFinish)}`
            : 'no planned dates recorded'}
          onClick={() => showTab('production')} active={tab === 'production'}
          actionLabel="Show the installed production behind this" />

        <StatTile label="Actual cost"
          value={finances ? moneyCompact(finances.actualCost) : '—'}
          hint={finances ? `${moneyCompact(finances.committedCost)} more committed` : undefined}
          detail={
            <div className="space-y-2">
              <p>
                What the job has cost so far
                {earned !== null ? <> against the {money(earned)} of budgeted work actually finished</> : null}.
              </p>
              <p>
                It is spend, not commitment: money already promised on a purchase order and not yet
                invoiced sits in the committed figure instead, which is why a job can look on budget
                here and still have no room left.
              </p>
              {finances ? (
                <ul className="space-y-1 pt-1">
                  <li className="flex justify-between gap-3">
                    <span className="text-charcoal-600">Labor and burden</span>
                    <span className="tabular">{money(finances.laborCost)}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-charcoal-600">Equipment and fuel</span>
                    <span className="tabular">{money(finances.equipmentCost)}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-charcoal-600">Material</span>
                    <span className="tabular">{money(finances.materialCost)}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-charcoal-600">Subcontract, trucking, disposal</span>
                    <span className="tabular">{money(finances.subcontractCost)}</span>
                  </li>
                </ul>
              ) : null}
            </div>
          } />

        <StatTile label="Cost variance"
          value={variance === null ? '—' : moneyCompact(Math.abs(variance))}
          tone={variance === null ? undefined : variance >= 0 ? 'success' : 'danger'}
          icon={variance !== null && variance >= 0
            ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          hint={variance === null
            ? 'no task budgets to earn against'
            : variance >= 0 ? 'earning more than it is spending' : 'spending more than it is earning'}
          onClick={() => showTab('overview')} active={tab === 'overview'}
          actionLabel="Show the cost performance behind the variance" />

        <StatTile label="Open items"
          value={openRfis.length + openSubmittals.length + pendingCo.length}
          tone={openRfis.length + openSubmittals.length + pendingCo.length > 0 ? 'warn' : undefined}
          icon={<AlertTriangle className="size-4" />}
          hint={`${plural(openRfis.length, 'RFI')} · ${plural(openSubmittals.length, 'submittal')} · ${plural(pendingCo.length, 'change')}`}
          onClick={() => showTab('rfis')} active={tab === 'rfis'}
          actionLabel="List the open RFIs and submittals" />
      </div>

      <Tabs value={tab} onValueChange={showTab}>
        <TabsList>
          <TabsTrigger value="field">Field reports ({reports.length})</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="weather">Weather</TabsTrigger>
          <TabsTrigger value="changes">Change orders ({changeOrders.length})</TabsTrigger>
          <TabsTrigger value="rfis">RFIs &amp; submittals ({openRfis.length + openSubmittals.length})</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        {/* ==================================================== field reports */}
        <TabsContent value="field" className="space-y-4">
          {reportsQ.status === 'loading' ? <LoadingState label="Reading the field reports" /> : null}
          {reportsQ.status === 'error'
            ? <ErrorState message={reportsQ.message} onRetry={reportsQ.refetch} /> : null}
          {reportsQ.status === 'ready' && reports.length === 0 ? (
            <EmptyState title="No daily reports yet"
              hint="A daily report is the contemporaneous record of a day on site. Once submitted its date cannot be changed." />
          ) : null}

          {reports.map((r) => {
            const manHours = r.labor.reduce(
              (a, l) => a + l.headcount * (l.straightHours + l.overtimeHours), 0);
            return (
              <Card key={r.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {date(r.reportDate)}
                      {r.delayHours > 0
                        ? <Badge variant="warn">{qty(r.delayHours, 1)} delay hr</Badge> : null}
                    </CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-3">
                      {r.weatherSummary || r.temperatureF !== null ? (
                        <span className="flex items-center gap-1">
                          <CloudRain className="size-3.5" />
                          {[r.weatherSummary,
                            r.temperatureF !== null ? `${r.temperatureF}°F` : null,
                            r.precipitationIn ? `${r.precipitationIn}"` : null]
                            .filter(Boolean).join(', ')}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1">
                        <Users2 className="size-3.5" /> {r.crewCount} on site
                      </span>
                    </CardDescription>
                  </div>
                  {r.submittedAt ? (
                    <Badge variant="success"><CheckCircle2 className="size-3" /> Submitted</Badge>
                  ) : (
                    <Badge variant="warn">Draft</Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {r.workPerformed ? (
                    <p className="text-sm leading-relaxed text-charcoal-700">{r.workPerformed}</p>
                  ) : null}

                  {r.delays ? (
                    <Alert tone="warn" icon={<Clock className="size-4" />} title="Delay recorded">
                      {r.delays}
                    </Alert>
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Labor</p>
                      <div className="space-y-1 text-sm">
                        {r.labor.length === 0
                          ? <p className="text-charcoal-400">None recorded</p>
                          : r.labor.map((l) => (
                            <div key={l.classification} className="flex justify-between gap-2">
                              <span className="text-charcoal-600">
                                {l.headcount} × {l.classification}
                              </span>
                              <span className="tabular text-charcoal-900">
                                {qty(l.straightHours, 1)}h
                                {l.overtimeHours ? ` + ${qty(l.overtimeHours, 1)} OT` : ''}
                              </span>
                            </div>
                          ))}
                        {r.labor.length > 0 ? (
                          <div className="flex justify-between gap-2 border-t border-charcoal-200 pt-1 font-medium">
                            <span>Total man-hours</span>
                            <span className="tabular">{qty(manHours, 1)}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Equipment</p>
                      <div className="space-y-1 text-sm">
                        {r.equipment.length === 0
                          ? <p className="text-charcoal-400">None recorded</p>
                          : r.equipment.map((e) => (
                            <div key={e.description} className="flex justify-between gap-2">
                              <span className="truncate text-charcoal-600">
                                {e.units} × {e.description}
                              </span>
                              <span className="tabular shrink-0 text-charcoal-900">
                                {qty(e.operatingHours, 1)}h · {qty(e.fuelGallons, 0)} gal
                              </span>
                            </div>
                          ))}
                        {r.equipment.length > 0 ? (
                          <div className="flex justify-between gap-2 border-t border-charcoal-200 pt-1 font-medium">
                            <span>Idle</span>
                            <span className="tabular">
                              {qty(r.equipment.reduce((a, e) => a + e.idleHours, 0), 1)} h
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Installed quantity</p>
                      <div className="space-y-1 text-sm">
                        {r.production.length === 0
                          ? <p className="text-charcoal-400">None recorded</p>
                          : r.production.map((p) => {
                            const delta = p.estimatedPerHour && p.actualPerHour !== null
                              ? (p.actualPerHour - p.estimatedPerHour) / p.estimatedPerHour
                              : null;
                            return (
                              <div key={p.id}>
                                <div className="flex justify-between gap-2">
                                  <span className="truncate text-charcoal-600">
                                    {p.task ?? p.estimatedRateCode ?? 'Installed'}
                                  </span>
                                  <span className="tabular shrink-0 font-medium text-charcoal-900">
                                    {integer(p.quantity)} {p.unit}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-2 text-xs">
                                  <span className="text-charcoal-400">
                                    {qty(p.crewHours, 1)} crew-hr
                                    {p.estimatedRateCode ? ` · ${p.estimatedRateCode}` : ''}
                                  </span>
                                  <span className={cn('tabular', delta === null ? 'text-charcoal-400'
                                    : delta < 0 ? 'text-danger-700' : 'text-success-700')}>
                                    {p.actualPerHour === null ? '—' : `${qty(p.actualPerHour, 1)} ${p.unit}/hr`}
                                    {delta !== null ? ` (${delta > 0 ? '+' : ''}${percent(delta, 1)})` : ''}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>

                  {r.safetyNotes || r.visitors ? (
                    <>
                      <Separator />
                      <div className="grid gap-3 text-xs text-charcoal-500 sm:grid-cols-2">
                        {r.safetyNotes ? (
                          <p><span className="font-semibold text-charcoal-700">Safety: </span>{r.safetyNotes}</p>
                        ) : null}
                        {r.visitors ? (
                          <p><span className="font-semibold text-charcoal-700">Visitors: </span>{r.visitors}</p>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {r.submittedAt ? (
                    <p className="text-xs text-charcoal-400">
                      Submitted {date(r.submittedAt)}. A submitted daily report is the
                      contemporaneous record of the day and cannot have its date changed.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ====================================================== production */}
        <TabsContent value="production">
          <Card>
            <CardHeader>
              <CardTitle>Installed production against estimate</CardTitle>
              <CardDescription>
                Every quantity the field records is compared against the catalog rate the work was
                priced at, adjusted by that rate&apos;s own utilization factor — the figure the
                estimate used. A consistent gap under the same conditions becomes a calibration
                proposal, never a silent edit. A row with no rate recorded shows an em dash rather
                than a variance against a rate nobody chose.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {production.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="Nothing installed has been recorded yet"
                    hint="Production is logged against a daily report, and each entry carries the crew hours it took." />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead className="text-right">Installed</TableHead>
                      <TableHead className="text-right">Crew hours</TableHead>
                      <TableHead className="text-right">Actual rate</TableHead>
                      <TableHead className="text-right">Estimated rate</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {production.map((p) => {
                      const delta = p.estimatedPerHour && p.actualPerHour !== null
                        ? (p.actualPerHour - p.estimatedPerHour) / p.estimatedPerHour
                        : null;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap text-charcoal-600">
                            {date(p.workDate)}
                          </TableCell>
                          <TableCell className="font-medium text-charcoal-900">
                            {p.task ?? p.estimatedRateCode ?? '—'}
                            {p.estimatedMethod ? (
                              <span className="block text-xs font-normal text-charcoal-500">
                                {p.estimatedMethod}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {integer(p.quantity)} {p.unit}
                          </TableCell>
                          <TableCell className="tabular text-right text-charcoal-600">
                            {qty(p.crewHours, 1)}
                          </TableCell>
                          <TableCell className="tabular text-right font-medium">
                            {p.actualPerHour === null ? '—' : `${qty(p.actualPerHour, 2)} ${p.unit}/hr`}
                          </TableCell>
                          <TableCell className="tabular text-right text-charcoal-600">
                            {p.estimatedPerHour === null ? '—' : `${qty(p.estimatedPerHour, 2)} ${p.unit}/hr`}
                          </TableCell>
                          <TableCell className={cn('tabular text-right font-medium',
                            delta === null ? 'text-charcoal-400'
                              : delta < 0 ? 'text-danger-700' : 'text-success-700')}>
                            {delta === null ? '—' : `${delta > 0 ? '+' : ''}${percent(delta, 1)}`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================= weather */}
        {/*
          * The forecast at this site, which until migration 0143 the platform
          * could not hold: 0105 keyed the cache to the company and fetched it
          * from the company's own coordinates, and those are the yard.
          */}
        <TabsContent value="weather">
          <SiteWeather companyId={companyId} projectId={id}
            siteNamed={project.latitude !== null || Boolean(project.siteCity)}
            canRefresh={can('projects.write')} />
        </TabsContent>

        {/* ==================================================== change orders */}
        <TabsContent value="changes" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Approved changes"
              value={moneyCompact(approvedCo.reduce((a, c) => a + c.priceImpact, 0))}
              tone="success" hint={`${plural(approvedCo.length, 'change')} executed or approved`}
              onClick={() => setCoFilter((c) => (c === 'approved' ? 'all' : 'approved'))}
              active={coFilter === 'approved'}
              actionLabel="List the approved and executed change orders" />
            <StatTile label="Pending changes"
              value={moneyCompact(pendingCo.reduce((a, c) => a + c.priceImpact, 0))}
              tone="warn" hint={`${plural(pendingCo.length, 'change')} awaiting a decision`}
              onClick={() => setCoFilter((c) => (c === 'pending' ? 'all' : 'pending'))}
              active={coFilter === 'pending'}
              actionLabel="List the change orders awaiting a decision" />
            <StatTile label="Schedule impact"
              value={`${qty(changeOrders.reduce((a, c) => a + c.scheduleImpactDays, 0), 0)} days`}
              hint="across all change orders"
              detail={
                <div className="space-y-2">
                  <p>
                    Days claimed across every change order on this project, approved and pending
                    together — {qty(approvedCo.reduce((a, c) => a + c.scheduleImpactDays, 0), 0)} of
                    them on changes that have been approved.
                  </p>
                  <p>
                    It is the sum of what each change asked for, not a new completion date. Two
                    changes delaying the same week of work both count here and cost the schedule one
                    week, so the contract date moves only where the change order says it does.
                  </p>
                </div>
              } />
          </div>

          {changesQ.status === 'loading' ? <LoadingState label="Reading the change orders" /> : null}
          {changesQ.status === 'error'
            ? <ErrorState message={changesQ.message} onRetry={changesQ.refetch} /> : null}
          {changesQ.status === 'ready' && changeOrders.length === 0 ? (
            <EmptyState title="No change orders on this project" />
          ) : null}

          {coFilter !== 'all' ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-charcoal-600">
              <span>
                Showing the {coFilter === 'approved' ? 'approved and executed' : 'pending'} change
                orders.
              </span>
              <Button variant="outline" size="sm" onClick={() => setCoFilter('all')}>
                Show all {changeOrders.length}
              </Button>
            </div>
          ) : null}

          {shownCo.map((c) => {
            const margin = c.priceImpact ? (c.priceImpact - c.costImpact) / c.priceImpact : 0;
            return (
              <Card key={c.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle>{c.number} — {c.title}</CardTitle>
                    <CardDescription>
                      {titleCase(c.origin)}
                      {c.submittedAt ? ` · submitted ${date(c.submittedAt)}` : ' · not submitted'}
                    </CardDescription>
                  </div>
                  <Badge variant={CHANGE_APPROVED.includes(c.status) ? 'success'
                    : ['rejected', 'withdrawn'].includes(c.status) ? 'danger' : 'warn'}>
                    {titleCase(c.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert tone="neutral" title="Reason">{c.reason}</Alert>

                  {c.items.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Unit price</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {c.items.map((i) => (
                          <TableRow key={i.description}>
                            <TableCell className="font-medium text-charcoal-900">
                              {i.description}
                            </TableCell>
                            <TableCell className="tabular text-right">
                              {qty(i.quantity, 0)} {i.unit ?? ''}
                            </TableCell>
                            <TableCell className="tabular text-right text-charcoal-600">
                              {money(i.unitPrice)}
                            </TableCell>
                            <TableCell className="tabular text-right text-charcoal-600">
                              {money(i.costAmount)}
                            </TableCell>
                            <TableCell className="tabular text-right font-medium">
                              {money(i.priceAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow className="hover:bg-charcoal-50">
                          <TableCell colSpan={3}>
                            Total · {qty(c.scheduleImpactDays, 0)} day schedule impact ·{' '}
                            {percent(margin)} margin
                          </TableCell>
                          <TableCell className="tabular text-right">{money(c.costImpact)}</TableCell>
                          <TableCell className="tabular text-right">{money(c.priceImpact)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  ) : (
                    <div className="flex flex-wrap justify-between gap-3 text-sm">
                      <span className="text-charcoal-600">
                        Priced in total, with no line detail recorded ·{' '}
                        {qty(c.scheduleImpactDays, 0)} day schedule impact
                      </span>
                      <span className="tabular">
                        {money(c.costImpact)} cost · {money(c.priceImpact)} price
                      </span>
                    </div>
                  )}

                  {c.decidedAt ? (
                    <p className="text-xs text-charcoal-500">Decided {date(c.decidedAt)}.</p>
                  ) : (
                    <p className="text-xs text-warn-700">
                      Awaiting an owner decision. Cost is being incurred against an unapproved
                      change.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ================================================ RFIs & submittals */}
        <TabsContent value="rfis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HelpCircle className="size-4" /> RFIs</CardTitle>
              <CardDescription>
                An item the documents cannot resolve routes here, not to a guess.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rfis.length === 0 ? (
                <div className="p-6"><EmptyState title="No RFIs on this project" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>RFI</TableHead>
                      <TableHead>Discipline</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Cost impact</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rfis.map((r) => {
                      const open = ['draft', 'open'].includes(r.status);
                      const days = r.dueAt
                        ? Math.round((new Date(r.dueAt).getTime() - Date.now()) / 86_400_000)
                        : null;
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <p className="font-medium text-charcoal-900">{r.number}</p>
                            <p className="max-w-72 text-xs text-charcoal-500">{r.title}</p>
                          </TableCell>
                          <TableCell className="text-charcoal-600">{r.discipline ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={r.priority === 'critical' ? 'danger'
                              : r.priority === 'high' ? 'warn' : 'default'}>
                              {titleCase(r.priority)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={open ? 'warn' : 'success'}>{titleCase(r.status)}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {r.dueAt ? (
                              <>
                                <span className={cn('text-sm', open && days !== null && days <= 5
                                  ? 'font-semibold text-danger-700' : 'text-charcoal-600')}>
                                  {date(r.dueAt)}
                                </span>
                                {open ? (
                                  <p className="text-xs text-charcoal-400">{relativeDays(r.dueAt)}</p>
                                ) : null}
                              </>
                            ) : <span className="text-charcoal-400">—</span>}
                          </TableCell>
                          <TableCell className="max-w-64 text-xs text-charcoal-600">
                            {r.costImpact ?? '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Package className="size-4" /> Submittals</CardTitle>
              <CardDescription>
                The submit-by date is the required-on-site date backed off by the lead time — a
                submittal approved after that is late however fast it was reviewed.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {submittals.length === 0 ? (
                <div className="p-6"><EmptyState title="No submittals on this project" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submittal</TableHead>
                      <TableHead>Spec</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Ball in court</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>On site by</TableHead>
                      <TableHead>Lead</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submittals.map((s) => {
                      const settled = SUBMITTAL_SETTLED.includes(s.status);
                      const submitBy = s.requiredOnSite && s.leadTimeDays !== null
                        ? new Date(new Date(s.requiredOnSite).getTime() - s.leadTimeDays * 86_400_000)
                        : null;
                      const late = !settled && submitBy !== null && submitBy < new Date();
                      return (
                        <TableRow key={s.id}>
                          <TableCell>
                            <p className="font-medium text-charcoal-900">
                              {s.number}
                              {s.revision ? <span className="text-charcoal-400"> rev {s.revision}</span> : null}
                            </p>
                            <p className="max-w-72 text-xs text-charcoal-500">{s.title}</p>
                            {s.reviewerComment ? (
                              <p className="mt-1 max-w-72 text-xs italic text-charcoal-500">
                                &ldquo;{s.reviewerComment}&rdquo;
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs text-charcoal-600">
                            {s.specSection ?? '—'}
                          </TableCell>
                          <TableCell className="text-charcoal-600">{s.vendorName ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={s.ballInCourt === 'contractor' ? 'warn'
                              : s.ballInCourt === 'closed' ? 'success' : 'info'}>
                              {titleCase(s.ballInCourt)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              ['approved', 'approved_as_noted'].includes(s.status) ? 'success'
                                : ['revise_resubmit', 'rejected'].includes(s.status) ? 'danger'
                                  : 'default'
                            }>
                              {titleCase(s.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="text-sm text-charcoal-700">
                              {s.requiredOnSite ? date(s.requiredOnSite) : '—'}
                            </span>
                            {submitBy ? (
                              <p className={cn('text-xs',
                                late ? 'font-semibold text-danger-700' : 'text-charcoal-400')}>
                                submit by {date(submitBy.toISOString())}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="tabular text-charcoal-600">
                            {s.leadTimeDays === null ? '—' : `${s.leadTimeDays}d`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================================================== overview */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Project detail</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4">
                  <Field label="Number">{project.number}</Field>
                  <Field label="Customer">{project.customerName ?? '—'}</Field>
                  <Field label="Contract type">
                    {project.contractType ? titleCase(project.contractType) : '—'}
                  </Field>
                  <Field label="Contract value">
                    {finances ? money(finances.revisedContractValue) : money(project.contractValue)}
                  </Field>
                  <Field label="Approved budget">{money(project.approvedBudget)}</Field>
                  <Field label="Retainage">{percent(project.retainagePercent, 2)}</Field>
                  <Field label="Planned start">
                    {project.plannedStart ? date(project.plannedStart) : '—'}
                  </Field>
                  <Field label="Planned finish">
                    {project.plannedFinish ? date(project.plannedFinish) : '—'}
                  </Field>
                  <Field label="Project manager">{project.projectManager ?? '—'}</Field>
                  <Field label="Superintendent">{project.superintendent ?? '—'}</Field>
                  <Field label="Site" className="col-span-2">{siteLine || '—'}</Field>
                  {project.sourceEstimateNumber ? (
                    <Field label="Awarded from" className="col-span-2">
                      {project.sourceEstimateNumber}
                      {project.sourceVersionNumber !== null
                        ? ` rev ${project.sourceVersionNumber}` : ''}
                    </Field>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cost performance</CardTitle>
                <CardDescription>
                  Earned value: each task&apos;s budget weighted by that task&apos;s own progress,
                  against what has actually been spent.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {progress === null || progress.percentComplete === null ? (
                  <EmptyState title="No task budgets to earn against"
                    hint="Break the work down into tasks with budgeted cost and record progress on each, and percent complete, earned value and CPI all become computable. Until then the honest answer is that nobody can say." />
                ) : (
                  <>
                    <div>
                      <div className="flex justify-between text-sm">
                        <span className="text-charcoal-600">Percent complete</span>
                        <span className="tabular font-medium">
                          {percent(progress.percentComplete, 0)}
                        </span>
                      </div>
                      <Progress value={progress.percentComplete * 100} className="mt-1.5"
                        indicatorClassName="bg-success-600" />
                    </div>
                    {finances && finances.approvedBudget > 0 ? (
                      <div>
                        <div className="flex justify-between text-sm">
                          <span className="text-charcoal-600">Budget consumed</span>
                          <span className="tabular font-medium">
                            {percent(finances.actualCost / finances.approvedBudget, 0)}
                          </span>
                        </div>
                        <Progress
                          value={(finances.actualCost / finances.approvedBudget) * 100}
                          className="mt-1.5"
                          indicatorClassName={cpi !== null && cpi < 1 ? 'bg-danger-500' : 'bg-success-600'} />
                      </div>
                    ) : null}
                    <Separator />
                    <dl className="grid grid-cols-2 gap-4">
                      <Field label="Earned value">{money(progress.earnedValue)}</Field>
                      <Field label="Actual cost">
                        {finances ? money(finances.actualCost) : '—'}
                      </Field>
                      <Field label="Variance">
                        {variance === null ? '—' : (
                          <span className={variance >= 0 ? 'text-success-700' : 'text-danger-700'}>
                            {variance >= 0 ? '+' : '−'}{money(Math.abs(variance))}
                          </span>
                        )}
                      </Field>
                      <Field label="CPI">
                        {cpi === null ? '—' : (
                          <Badge variant={cpi >= 1 ? 'success' : cpi >= 0.95 ? 'warn' : 'danger'}>
                            {cpi.toFixed(2)}
                          </Badge>
                        )}
                      </Field>
                      <Field label="Hours performance">
                        {progress.hoursPerformanceIndex === null ? '—' : (
                          <Badge variant={progress.hoursPerformanceIndex >= 1 ? 'success'
                            : progress.hoursPerformanceIndex >= 0.95 ? 'warn' : 'danger'}>
                            {progress.hoursPerformanceIndex.toFixed(2)}
                          </Badge>
                        )}
                      </Field>
                      <Field label="Tasks complete">
                        {progress.tasksComplete} of {progress.tasks}
                      </Field>
                    </dl>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

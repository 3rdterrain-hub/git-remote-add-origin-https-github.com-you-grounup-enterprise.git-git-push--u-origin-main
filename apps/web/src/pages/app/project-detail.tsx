import { Link, useParams } from 'react-router-dom';
import {
  HardHat, CloudRain, Users2, TrendingUp, TrendingDown, FileWarning,
  HelpCircle, Package, Gauge, CalendarDays, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PROJECTS, RFIS } from '@/data/operations';
import { DAILY_REPORTS, SUBMITTALS, CHANGE_ORDERS } from '@/data/field';
import { PRODUCTION_RATES } from '@/data/catalog';
import { money, moneyCompact, percent, qty, integer, date, titleCase, relativeDays, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Catalog rate a task was estimated at, for the production variance column. */
const ESTIMATED_RATE: Record<string, { rate: number; code: string }> = {
  '8" PVC sanitary sewer, 8–12 ft': { rate: PRODUCTION_RATES['PR-UTL-SAN']!.ratePerHour * PRODUCTION_RATES['PR-UTL-SAN']!.utilizationFactor, code: 'PR-UTL-SAN' },
  '12" RCP storm sewer, 6–8 ft': { rate: PRODUCTION_RATES['PR-UTL-STORM']!.ratePerHour * PRODUCTION_RATES['PR-UTL-STORM']!.utilizationFactor, code: 'PR-UTL-STORM' },
};

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0]!;

  const reports = DAILY_REPORTS.filter((r) => r.projectId === project.id);
  const changeOrders = CHANGE_ORDERS.filter((c) => c.projectId === project.id);
  const openRfis = RFIS.filter((r) => r.status === 'open');
  const openSubmittals = SUBMITTALS.filter((s) => !['approved', 'approved_as_noted', 'closed'].includes(s.status));

  const budgetToDate = project.budget * project.percentComplete;
  const variance = budgetToDate - project.actualCost;
  const cpi = project.actualCost ? budgetToDate / project.actualCost : 1;

  const approvedCo = changeOrders.filter((c) => ['approved', 'executed'].includes(c.status));
  const pendingCo = changeOrders.filter((c) => ['potential', 'submitted'].includes(c.status));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<Link to="/app/projects" className="hover:text-charcoal-900">Projects</Link>}
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{project.number} · {project.customer}</span>
            <Badge variant={project.status === 'active' ? 'info' : 'success'}>{titleCase(project.status)}</Badge>
            {pendingCo.length ? <Badge variant="warn">{plural(pendingCo.length, 'change order')} pending</Badge> : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline"><CalendarDays className="size-4" /> Daily report</Button>
            <Button variant="outline"><FileWarning className="size-4" /> Change order</Button>
            <Button><HelpCircle className="size-4" /> New RFI</Button>
          </>
        }
      />

      {cpi < 1 ? (
        <Alert tone="danger" icon={<TrendingDown className="size-4" />}
          title={`Cost performance index ${cpi.toFixed(2)} — spending faster than the work is progressing`}>
          {percent(project.percentComplete, 0)} complete against {percent(project.actualCost / project.budget, 0)} of
          budget consumed. That gap is margin fade, and it shows up here before it shows up in the month-end close.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Contract value" value={moneyCompact(project.contractValue)} icon={<HardHat className="size-4" />}
          hint={approvedCo.length ? `+${moneyCompact(approvedCo.reduce((a, c) => a + c.priceImpact, 0))} in approved changes` : 'no approved changes'} />
        <StatTile label="Percent complete" value={percent(project.percentComplete, 0)} icon={<Gauge className="size-4" />}
          hint={`${date(project.plannedStart)} → ${date(project.plannedFinish)}`} />
        <StatTile label="Actual cost" value={moneyCompact(project.actualCost)}
          hint={`${moneyCompact(budgetToDate)} budgeted to date`} />
        <StatTile label="Cost variance" value={moneyCompact(Math.abs(variance))}
          tone={variance >= 0 ? 'success' : 'danger'}
          icon={variance >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          hint={variance >= 0 ? 'under budget for work performed' : 'over budget for work performed'} />
        <StatTile label="Open items" value={openRfis.length + openSubmittals.length + pendingCo.length}
          tone="warn" icon={<AlertTriangle className="size-4" />}
          hint={`${plural(openRfis.length, 'RFI')} · ${plural(openSubmittals.length, 'submittal')} · ${plural(pendingCo.length, 'change')}`} />
      </div>

      <Tabs defaultValue="field">
        <TabsList>
          <TabsTrigger value="field">Field reports ({reports.length})</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="changes">Change orders ({changeOrders.length})</TabsTrigger>
          <TabsTrigger value="rfis">RFIs &amp; submittals ({openRfis.length + openSubmittals.length})</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        {/* ==================================================== field reports */}
        <TabsContent value="field" className="space-y-4">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {date(r.date)}
                    {r.delayHours > 0 ? <Badge variant="warn">{r.delayHours} delay hr</Badge> : null}
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1"><CloudRain className="size-3.5" /> {r.weather}, {r.temperatureF}°F{r.precipitationIn ? `, ${r.precipitationIn}"` : ''}</span>
                    <span className="flex items-center gap-1"><Users2 className="size-3.5" /> {r.crewCount} on site</span>
                  </CardDescription>
                </div>
                <Badge variant="success"><CheckCircle2 className="size-3" /> Submitted</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-charcoal-700">{r.workPerformed}</p>

                {r.delays ? (
                  <Alert tone="warn" icon={<Clock className="size-4" />} title="Delay recorded">{r.delays}</Alert>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Labor</p>
                    <div className="space-y-1 text-sm">
                      {r.labor.map((l) => (
                        <div key={l.classification} className="flex justify-between gap-2">
                          <span className="text-charcoal-600">{l.headcount} × {l.classification}</span>
                          <span className="tabular text-charcoal-900">
                            {l.straightHours}h{l.overtimeHours ? ` + ${l.overtimeHours} OT` : ''}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-2 border-t border-charcoal-200 pt-1 font-medium">
                        <span>Total man-hours</span>
                        <span className="tabular">
                          {qty(r.labor.reduce((a, l) => a + l.headcount * (l.straightHours + l.overtimeHours), 0), 1)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Equipment</p>
                    <div className="space-y-1 text-sm">
                      {r.equipment.map((e) => (
                        <div key={e.description} className="flex justify-between gap-2">
                          <span className="truncate text-charcoal-600">{e.units} × {e.description}</span>
                          <span className="tabular shrink-0 text-charcoal-900">{e.operatingHours}h · {e.fuelGallons} gal</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-2 border-t border-charcoal-200 pt-1 font-medium">
                        <span>Idle</span>
                        <span className="tabular">{qty(r.equipment.reduce((a, e) => a + e.idleHours, 0), 1)} h</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Installed quantity</p>
                    <div className="space-y-1 text-sm">
                      {r.production.map((p) => {
                        const est = ESTIMATED_RATE[p.task];
                        const actual = p.quantity / p.crewHours;
                        const delta = est ? (actual - est.rate) / est.rate : null;
                        return (
                          <div key={p.task}>
                            <div className="flex justify-between gap-2">
                              <span className="truncate text-charcoal-600">{p.task}</span>
                              <span className="tabular shrink-0 font-medium text-charcoal-900">
                                {integer(p.quantity)} {p.unit}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2 text-xs">
                              <span className="text-charcoal-400">{p.crewHours} crew-hr · {p.costCode}</span>
                              <span className={cn('tabular', delta === null ? 'text-charcoal-400' : delta < 0 ? 'text-danger-700' : 'text-success-700')}>
                                {qty(actual, 1)} {p.unit}/hr
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
                      {r.safetyNotes ? <p><span className="font-semibold text-charcoal-700">Safety: </span>{r.safetyNotes}</p> : null}
                      {r.visitors ? <p><span className="font-semibold text-charcoal-700">Visitors: </span>{r.visitors}</p> : null}
                    </div>
                  </>
                ) : null}

                <p className="text-xs text-charcoal-400">
                  Submitted by {r.submittedBy}. A submitted daily report is the contemporaneous record of the day and
                  cannot have its date changed.
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ====================================================== production */}
        <TabsContent value="production">
          <Card>
            <CardHeader>
              <CardTitle>Installed production against estimate</CardTitle>
              <CardDescription>
                Every quantity the field records is compared against the catalog rate the work was priced at.
                A consistent gap under the same conditions becomes a calibration proposal — never a silent edit.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
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
                  {reports.flatMap((r) => r.production.map((p) => {
                    const est = ESTIMATED_RATE[p.task];
                    const actual = p.quantity / p.crewHours;
                    const delta = est ? (actual - est.rate) / est.rate : null;
                    return (
                      <TableRow key={`${r.id}-${p.task}`}>
                        <TableCell className="whitespace-nowrap text-charcoal-600">{date(r.date)}</TableCell>
                        <TableCell className="font-medium text-charcoal-900">{p.task}</TableCell>
                        <TableCell className="tabular text-right">{integer(p.quantity)} {p.unit}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{qty(p.crewHours, 1)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{qty(actual, 2)} {p.unit}/hr</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {est ? `${qty(est.rate, 2)} ${p.unit}/hr` : '—'}
                        </TableCell>
                        <TableCell className={cn('tabular text-right font-medium',
                          delta === null ? 'text-charcoal-400' : delta < 0 ? 'text-danger-700' : 'text-success-700')}>
                          {delta === null ? '—' : `${delta > 0 ? '+' : ''}${percent(delta, 1)}`}
                        </TableCell>
                      </TableRow>
                    );
                  }))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================================================== change orders */}
        <TabsContent value="changes" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Approved changes" value={moneyCompact(approvedCo.reduce((a, c) => a + c.priceImpact, 0))}
              tone="success" hint={plural(approvedCo.length, 'change') + ' executed or approved'} />
            <StatTile label="Pending changes" value={moneyCompact(pendingCo.reduce((a, c) => a + c.priceImpact, 0))}
              tone="warn" hint={plural(pendingCo.length, 'change') + ' awaiting a decision'} />
            <StatTile label="Schedule impact" value={`${changeOrders.reduce((a, c) => a + c.scheduleImpactDays, 0)} days`}
              hint="across all change orders" />
          </div>

          {changeOrders.map((c) => {
            const margin = c.priceImpact ? (c.priceImpact - c.costImpact) / c.priceImpact : 0;
            return (
              <Card key={c.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle>{c.number} — {c.title}</CardTitle>
                    <CardDescription>{titleCase(c.origin)} · submitted {date(c.submittedAt)}</CardDescription>
                  </div>
                  <Badge variant={c.status === 'executed' ? 'success' : c.status === 'approved' ? 'success' : 'warn'}>
                    {titleCase(c.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert tone="neutral" title="Reason">{c.reason}</Alert>

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
                          <TableCell className="font-medium text-charcoal-900">{i.description}</TableCell>
                          <TableCell className="tabular text-right">{qty(i.quantity, 0)} {i.unit}</TableCell>
                          <TableCell className="tabular text-right text-charcoal-600">{money(i.unitPrice)}</TableCell>
                          <TableCell className="tabular text-right text-charcoal-600">{money(i.costAmount)}</TableCell>
                          <TableCell className="tabular text-right font-medium">{money(i.priceAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="hover:bg-charcoal-50">
                        <TableCell colSpan={3}>
                          Total · {c.scheduleImpactDays} day schedule impact · {percent(margin)} margin
                        </TableCell>
                        <TableCell className="tabular text-right">{money(c.costImpact)}</TableCell>
                        <TableCell className="tabular text-right">{money(c.priceImpact)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>

                  {c.decidedAt ? (
                    <p className="text-xs text-charcoal-500">
                      Decided {date(c.decidedAt)} by {c.decidedBy}.
                    </p>
                  ) : (
                    <p className="text-xs text-warn-700">Awaiting an owner decision. Cost is being incurred against an unapproved change.</p>
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
              <CardDescription>An item the documents cannot resolve routes here, not to a guess.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RFI</TableHead>
                    <TableHead>Discipline</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="min-w-64">Cost impact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {RFIS.map((r) => {
                    const days = Math.round((new Date(r.dueAt).getTime() - Date.now()) / 86_400_000);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{r.number}</p>
                          <p className="max-w-72 text-xs text-charcoal-500">{r.title}</p>
                        </TableCell>
                        <TableCell className="text-charcoal-600">{r.discipline}</TableCell>
                        <TableCell>
                          <Badge variant={r.priority === 'critical' ? 'danger' : r.priority === 'high' ? 'warn' : 'default'}>
                            {titleCase(r.priority)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'open' ? 'warn' : 'success'}>{titleCase(r.status)}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={cn('text-sm', r.status === 'open' && days <= 5 ? 'font-semibold text-danger-700' : 'text-charcoal-600')}>
                            {date(r.dueAt)}
                          </span>
                          {r.status === 'open' ? <p className="text-xs text-charcoal-400">{relativeDays(r.dueAt)}</p> : null}
                        </TableCell>
                        <TableCell className="text-xs text-charcoal-600">{r.costImpact}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Package className="size-4" /> Submittals</CardTitle>
              <CardDescription>
                Sorted by who owes the next action. The submit-by date is the required-on-site date backed off by
                the lead time — a submittal approved after that is late however fast it was reviewed.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
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
                  {SUBMITTALS.map((s) => {
                    const submitBy = new Date(new Date(s.requiredOnSite).getTime() - s.leadTimeDays * 86_400_000);
                    const late = !['approved', 'approved_as_noted', 'closed'].includes(s.status) && submitBy < new Date();
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">
                            {s.number}{s.revision ? <span className="text-charcoal-400"> rev {s.revision}</span> : null}
                          </p>
                          <p className="max-w-72 text-xs text-charcoal-500">{s.title}</p>
                          {s.reviewerComment ? (
                            <p className="mt-1 max-w-72 text-xs italic text-charcoal-500">“{s.reviewerComment}”</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-charcoal-600">{s.specSection}</TableCell>
                        <TableCell className="text-charcoal-600">{s.vendor}</TableCell>
                        <TableCell>
                          <Badge variant={s.ballInCourt === 'contractor' ? 'warn' : s.ballInCourt === 'closed' ? 'success' : 'info'}>
                            {titleCase(s.ballInCourt)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            ['approved', 'approved_as_noted'].includes(s.status) ? 'success'
                            : ['revise_resubmit', 'rejected'].includes(s.status) ? 'danger' : 'default'
                          }>
                            {titleCase(s.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-charcoal-700">{date(s.requiredOnSite)}</span>
                          <p className={cn('text-xs', late ? 'font-semibold text-danger-700' : 'text-charcoal-400')}>
                            submit by {date(submitBy.toISOString())}
                          </p>
                        </TableCell>
                        <TableCell className="tabular text-charcoal-600">{s.leadTimeDays}d</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
                  <Field label="Customer">{project.customer}</Field>
                  <Field label="Contract value">{money(project.contractValue)}</Field>
                  <Field label="Approved budget">{money(project.budget)}</Field>
                  <Field label="Planned start">{date(project.plannedStart)}</Field>
                  <Field label="Planned finish">{date(project.plannedFinish)}</Field>
                  <Field label="Project manager">{project.pm}</Field>
                  <Field label="Superintendent">{project.superintendent}</Field>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cost performance</CardTitle>
                <CardDescription>Budget consumed for the work actually performed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-charcoal-600">Percent complete</span>
                    <span className="tabular font-medium">{percent(project.percentComplete, 0)}</span>
                  </div>
                  <Progress value={project.percentComplete * 100} className="mt-1.5" indicatorClassName="bg-success-600" />
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-charcoal-600">Budget consumed</span>
                    <span className="tabular font-medium">{percent(project.actualCost / project.budget, 0)}</span>
                  </div>
                  <Progress value={(project.actualCost / project.budget) * 100} className="mt-1.5"
                    indicatorClassName={cpi < 1 ? 'bg-danger-500' : 'bg-success-600'} />
                </div>
                <Separator />
                <dl className="grid grid-cols-2 gap-4">
                  <Field label="Budget to date">{money(budgetToDate)}</Field>
                  <Field label="Actual cost">{money(project.actualCost)}</Field>
                  <Field label="Variance">
                    <span className={variance >= 0 ? 'text-success-700' : 'text-danger-700'}>
                      {variance >= 0 ? '+' : '−'}{money(Math.abs(variance))}
                    </span>
                  </Field>
                  <Field label="CPI">
                    <Badge variant={cpi >= 1 ? 'success' : cpi >= 0.95 ? 'warn' : 'danger'}>{cpi.toFixed(2)}</Badge>
                  </Field>
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

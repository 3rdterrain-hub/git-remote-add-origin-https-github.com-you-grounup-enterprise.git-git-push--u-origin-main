import {
  HardHat, ShieldAlert, ClipboardCheck, Eye, AlertTriangle, CheckCircle2, Plus, FileWarning,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadIncidents, loadObservations, loadToolboxTalks, loadInspections, loadDeficiencies,
  loadSafetyRates, loadLapsedCredentials,
  demonstrationIncidents, demonstrationObservations, demonstrationTalks,
  demonstrationInspections, demonstrationDeficiencies, demonstrationRates,
} from '@/lib/data/safety';
import { date, dateTime, qty, titleCase, plural, percent } from '@/lib/format';
import { cn } from '@/lib/utils';

const SEVERITY: Record<string, 'default' | 'warn' | 'danger'> = {
  low: 'default', moderate: 'warn', high: 'danger', critical: 'danger',
};

export function SafetyPage() {
  const incidentsQ = useQuery(loadIncidents, []);
  const observationsQ = useQuery(loadObservations, []);
  const talksQ = useQuery(loadToolboxTalks, []);
  const inspectionsQ = useQuery(loadInspections, []);
  const deficienciesQ = useQuery(loadDeficiencies, []);
  const ratesQ = useQuery(loadSafetyRates, []);
  const credentialsQ = useQuery(loadLapsedCredentials, []);

  const demo = incidentsQ.status === 'demonstration';
  const pick = <T,>(q: { status: string; data?: T[] }, fallback: () => T[]): T[] =>
    q.status === 'ready' ? (q.data as T[]) : demo ? fallback() : [];

  const INCIDENTS = pick(incidentsQ, demonstrationIncidents);
  const OBSERVATIONS = pick(observationsQ, demonstrationObservations);
  const TOOLBOX_TALKS = pick(talksQ, demonstrationTalks);
  const INSPECTIONS = pick(inspectionsQ, demonstrationInspections);
  const DEFICIENCIES = pick(deficienciesQ, demonstrationDeficiencies);
  const rates = ratesQ.status === 'ready' ? ratesQ.data : demo ? demonstrationRates : null;
  const lapsed = credentialsQ.status === 'ready' ? credentialsQ.data : [];

  const open = INCIDENTS.filter((i) => i.investigationState !== 'closed');
  const recordable = INCIDENTS.filter((i) => i.isOshaRecordable);
  const daysAway = INCIDENTS.reduce((a, i) => a + i.daysAway, 0);
  const unsafeOpen = OBSERVATIONS.filter((o) => !o.isPositive && !o.correctedOnSite);

  const failed = INSPECTIONS.filter((i) => i.result === 'fail');
  const pending = INSPECTIONS.filter((i) => i.result === 'pending');
  const tested = INSPECTIONS.filter((i) => i.result === 'pass' || i.result === 'fail');
  const passRate = tested.length ? tested.filter((i) => i.result === 'pass').length / tested.length : 1;
  const openDeficiencies = DEFICIENCIES.filter((d) => d.status !== 'closed');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Safety & Quality"
        description="Incidents, observations, tests and punch items. These are the records produced in an inspection or a defect claim, so the database insists they are complete rather than merely present."
        actions={
          <>
            <Button variant="outline"><ClipboardCheck className="size-4" /> Toolbox talk</Button>
            <Button><Plus className="size-4" /> Report incident</Button>
          </>
        }
      />

      {demo ? <DemonstrationNotice what="this page" /> : null}
      {incidentsQ.status === 'loading' ? <LoadingState label="Loading safety records" /> : null}
      {incidentsQ.status === 'error'
        ? <ErrorState message={incidentsQ.message} onRetry={incidentsQ.refetch} /> : null}

      {/*
        * TRIR and DART, which this page never showed.
        *
        * P29 found both defined against a view that could not produce them, and
        * DART adding restricted *days* into a rate that counts *cases*. They are
        * the two numbers a contractor is prequalified on and an insurer rates.
        */}
      {rates ? <SafetyRatesCard rates={rates} /> : null}

      {lapsed.length > 0 ? <LapsedCredentialsCard rows={lapsed} /> : null}

      {open.some((i) => i.severity === 'critical') ? (
        <Alert tone="danger" icon={<ShieldAlert className="size-4" />}
          title="A critical incident investigation is still open">
          {open.filter((i) => i.severity === 'critical').map((i) => `${i.number}: ${i.description}`).join(' ')}{' '}
          An investigation cannot be closed without a root cause and a corrective action — the database refuses it,
          because an incident filed without either has been recorded, not prevented from recurring.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Open investigations" value={open.length} tone={open.length ? 'warn' : 'success'}
          icon={<ShieldAlert className="size-4" />} hint={`${INCIDENTS.length} incidents recorded`} />
        <StatTile label="OSHA recordable" value={recordable.length} tone={recordable.length ? 'danger' : 'success'}
          hint={`${daysAway} days away, ${INCIDENTS.reduce((a, i) => a + i.daysRestricted, 0)} restricted`} />
        <StatTile label="Toolbox talks" value={TOOLBOX_TALKS.length} icon={<HardHat className="size-4" />}
          hint={`${TOOLBOX_TALKS.reduce((a, t) => a + t.attendees, 0)} attendances logged`} />
        <StatTile label="Test pass rate" value={percent(passRate, 0)}
          tone={passRate >= 0.9 ? 'success' : 'warn'} icon={<CheckCircle2 className="size-4" />}
          hint={`${failed.length} failed, ${pending.length} pending`} />
        <StatTile label="Open punch items" value={openDeficiencies.length}
          tone={openDeficiencies.length ? 'warn' : 'success'} icon={<FileWarning className="size-4" />}
          hint={`${DEFICIENCIES.length} identified`} />
      </div>

      <Tabs defaultValue="incidents">
        <TabsList>
          <TabsTrigger value="incidents">Incidents ({INCIDENTS.length})</TabsTrigger>
          <TabsTrigger value="observations">Observations ({OBSERVATIONS.length})</TabsTrigger>
          <TabsTrigger value="talks">Toolbox talks ({TOOLBOX_TALKS.length})</TabsTrigger>
          <TabsTrigger value="inspections">Tests ({INSPECTIONS.length})</TabsTrigger>
          <TabsTrigger value="punch">Punch list ({openDeficiencies.length} open)</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- incidents */}
        <TabsContent value="incidents" className="space-y-4">
          {INCIDENTS.map((i) => (
            <Card key={i.id} className={cn(i.investigationState !== 'closed' && i.severity === 'critical' && 'border-danger-500/30')}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {i.number}
                    <Badge variant={SEVERITY[i.severity] ?? 'default'}>{titleCase(i.severity)}</Badge>
                    <Badge variant="outline">{titleCase(i.type)}</Badge>
                    {i.isOshaRecordable ? <Badge variant="danger">OSHA {i.oshaCaseNumber}</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {dateTime(i.occurredAt)} · {i.project}{i.employee ? ` · ${i.employee}` : ''}
                  </CardDescription>
                </div>
                <Badge variant={i.investigationState === 'closed' ? 'success' : 'warn'}>
                  {titleCase(i.investigationState)}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed text-charcoal-700">{i.description}</p>

                {i.daysAway || i.daysRestricted ? (
                  <div className="flex gap-4 text-sm">
                    <span className="text-charcoal-600">Days away: <span className="tabular font-medium text-charcoal-900">{i.daysAway}</span></span>
                    <span className="text-charcoal-600">Days restricted: <span className="tabular font-medium text-charcoal-900">{i.daysRestricted}</span></span>
                  </div>
                ) : null}

                {i.rootCause ? (
                  <div className="rounded-md border border-charcoal-200 bg-charcoal-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Root cause</p>
                    <p className="mt-1 text-sm text-charcoal-700">{i.rootCause}</p>
                    <p className="mt-2.5 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Corrective action</p>
                    <p className="mt-1 text-sm text-charcoal-700">{i.correctiveAction}</p>
                  </div>
                ) : (
                  <Alert tone="warn" icon={<AlertTriangle className="size-4" />}>
                    Investigation still open. A root cause and a corrective action are required before it can close.
                  </Alert>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ---------------------------------------------------- observations */}
        <TabsContent value="observations" className="space-y-4">
          {unsafeOpen.length ? (
            <Alert tone="warn" icon={<Eye className="size-4" />}
              title={`${plural(unsafeOpen.length, 'unsafe condition')} not corrected on site`}>
              An unsafe observation must either be fixed on the spot or carry a corrective action. Recording one and
              walking away is worse than not looking.
            </Alert>
          ) : null}
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Observer</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="min-w-72">Observation</TableHead>
                  <TableHead>Resolution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {OBSERVATIONS.map((o) => (
                  <TableRow key={o.id} className={cn(!o.isPositive && !o.correctedOnSite && 'bg-warn-50/40')}>
                    <TableCell className="whitespace-nowrap text-xs text-charcoal-600">{dateTime(o.observedAt)}</TableCell>
                    <TableCell className="text-charcoal-700">{o.observer}</TableCell>
                    <TableCell>
                      <Badge variant={o.isPositive ? 'success' : 'warn'}>{titleCase(o.category)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-charcoal-700">{o.description}</TableCell>
                    <TableCell className="text-xs text-charcoal-600">
                      {o.correctedOnSite ? <Badge variant="success">Corrected on site</Badge>
                        : o.correctiveAction ? o.correctiveAction
                        : o.isPositive ? <span className="text-charcoal-400">—</span>
                        : <Badge variant="danger">Outstanding</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* ----------------------------------------------------------- talks */}
        <TabsContent value="talks">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Presenter</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Attendees</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TOOLBOX_TALKS.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-charcoal-600">{date(t.heldOn)}</TableCell>
                    <TableCell className="font-medium text-charcoal-900">{t.topic}</TableCell>
                    <TableCell className="text-charcoal-600">{t.presenter}</TableCell>
                    <TableCell className="font-mono text-xs text-charcoal-600">{t.project}</TableCell>
                    <TableCell className="tabular text-right">{t.attendees}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* ----------------------------------------------------- inspections */}
        <TabsContent value="inspections">
          <Card>
            <CardHeader>
              <CardTitle>Tests and inspections</CardTitle>
              <CardDescription>
                A failed test must record what happened next. A failure with no note is a number nobody can act on,
                and the work stays unaccepted either way.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Test</TableHead>
                    <TableHead>Spec</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">Achieved</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Agency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {INSPECTIONS.map((i) => (
                    <TableRow key={i.id} className={cn(i.result === 'fail' && 'bg-danger-50/40')}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">
                          {i.number}{i.isRetest ? <Badge variant="info" className="ml-1.5 text-[10px]">Retest</Badge> : null}
                        </p>
                        <p className="max-w-64 text-xs text-charcoal-500">{i.title}</p>
                        {i.notes ? <p className="mt-1 max-w-64 text-xs italic text-charcoal-500">{i.notes}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-charcoal-600">{i.specReference}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-charcoal-600">{i.station}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {i.required !== null ? `${qty(i.required, 1)}` : '—'}
                      </TableCell>
                      <TableCell className={cn('tabular text-right font-medium',
                        i.result === 'fail' ? 'text-danger-700' : i.result === 'pass' ? 'text-success-700' : 'text-charcoal-400')}>
                        {i.achieved !== null ? `${qty(i.achieved, 1)}` : '—'}
                        {i.unit ? <span className="block text-[10px] font-normal text-charcoal-400">{i.unit}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          i.result === 'pass' ? 'success' : i.result === 'fail' ? 'danger'
                          : i.result === 'conditional' ? 'warn' : 'default'
                        }>{titleCase(i.result)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">{i.agency}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ punch */}
        <TabsContent value="punch">
          <Card>
            <CardHeader>
              <CardTitle>Punch list</CardTitle>
              <CardDescription>
                Closing an item requires a named verifier and a note. A checkbox with no evidence is not an acceptance.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>Responsible</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DEFICIENCIES.map((d) => {
                    // A deficiency with no due date cannot be overdue.
                    const overdue = d.status !== 'closed' && d.dueOn != null
                      && new Date(d.dueOn) < new Date();
                    return (
                      <TableRow key={d.id} className={cn(overdue && 'bg-warn-50/40')}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{d.number}</p>
                          <p className="max-w-72 text-xs text-charcoal-500">{d.description}</p>
                          {d.verificationNote ? (
                            <p className="mt-1 max-w-72 text-xs italic text-success-700">{d.verificationNote}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs text-charcoal-600">{d.location}</TableCell>
                        <TableCell className="text-charcoal-600">{d.trade}</TableCell>
                        <TableCell className="text-charcoal-600">{d.responsible}</TableCell>
                        <TableCell className={cn('whitespace-nowrap text-sm', overdue ? 'font-semibold text-warn-700' : 'text-charcoal-600')}>
                          {date(d.dueOn)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            d.status === 'closed' ? 'success'
                            : d.status === 'ready_for_review' ? 'info' : 'warn'
                          }>{titleCase(d.status)}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * The recordable rates, and what they are computed from.
 *
 * Published with the hours behind them rather than alone: a rate over two weeks
 * of timesheets is not the same claim as a rate over a year, and the
 * denominator is the part somebody checking the number will ask for first.
 */
function SafetyRatesCard({ rates }: { rates: { trir: number | null; dart: number | null; recordables: number; hoursObserved: number; lostTimeCases: number } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recordable rates</CardTitle>
        <CardDescription>
          OSHA TRIR and DART per 100 full-time workers per year, computed from recordable incidents
          against approved hours. DART counts cases, not days: a case costing sixty restricted days
          counts once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rates.hoursObserved === 0 ? (
          <EmptyState
            title="No approved hours to compute a rate against"
            hint="A rate needs a denominator. Recordable incidents are counted below; TRIR and DART appear once approved time exists for the same period — an invented denominator would publish a confident and unfounded safety figure."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="TRIR" value={rates.trir == null ? '—' : rates.trir.toFixed(2)}
              tone={rates.trir != null && rates.trir > 3 ? 'danger' : 'success'}
              icon={<ShieldAlert className="size-4" />}
              hint="recordables x 200,000 / hours" />
            <StatTile label="DART" value={rates.dart == null ? '—' : rates.dart.toFixed(2)}
              tone={rates.dart != null && rates.dart > 2 ? 'danger' : 'success'}
              icon={<ShieldAlert className="size-4" />}
              hint="days away, restricted or transferred — cases, not days" />
            <StatTile label="Recordables" value={rates.recordables}
              hint={`${rates.lostTimeCases} with days away`} />
            <StatTile label="Hours behind the rate"
              value={Math.round(rates.hoursObserved).toLocaleString('en-US')}
              hint="approved time only" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What has lapsed, and what it stops somebody doing.
 *
 * Derived on read rather than stored, so it is correct on the day it is read
 * rather than on the day somebody last edited the record — the defect P09
 * found, where an expired license still read valid and passed the assignment
 * gate that exists to catch it.
 */
function LapsedCredentialsCard({ rows }: { rows: Array<{ credentialId: string; employeeName: string; credentialName: string; standing: string; expiresOn: string | null; daysRemaining: number | null; blocksWorkTypes: string[] }> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4" /> Credentials lapsed or lapsing
        </CardTitle>
        <CardDescription>
          An assignment to work requiring one of these is refused by the database, naming the person
          and what is missing.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Standing</TableHead>
              <TableHead className="text-right">Expires</TableHead>
              <TableHead>Blocks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.credentialId}>
                <TableCell className="font-medium text-charcoal-900">{c.employeeName}</TableCell>
                <TableCell>{c.credentialName}</TableCell>
                <TableCell>
                  <Badge variant={c.standing === 'expiring' ? 'warn' : 'danger'}>
                    {titleCase(c.standing)}
                  </Badge>
                </TableCell>
                <TableCell className="tabular text-right text-xs text-charcoal-600">
                  {c.expiresOn ? date(c.expiresOn) : '—'}
                  {c.daysRemaining != null ? (
                    <span className="ml-1 text-charcoal-400">
                      ({c.daysRemaining < 0 ? `${Math.abs(c.daysRemaining)} days ago` : `${c.daysRemaining} days`})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs text-charcoal-600">
                  {c.blocksWorkTypes.length ? c.blocksWorkTypes.join(', ') : 'nothing configured'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import {
  Receipt, TrendingUp, TrendingDown, Banknote, AlertTriangle, Lock, FileCheck, Plus, CircleDollarSign,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  loadPayApplications, loadWip, loadPayables, loadCashForecast,
  demonstrationPayApplications, demonstrationWip, demonstrationPayables, demonstrationCashForecast,
} from '@/lib/data/finance';
import { useQuery } from '@/lib/data/query';
import { DemonstrationNotice, ErrorState, LoadingState, EmptyState } from '@/components/data-state';
import { money, moneyCompact, percent, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

export function FinancePage() {
  /*
   * Which tab the five boxes above it open. Three of them are totals of a
   * table on one of these tabs; the other two are accounting definitions with
   * nothing below to point at, so they explain themselves in place.
   */
  const [tab, setTab] = useState('payapp');
  const payAppsQ = useQuery(loadPayApplications, []);
  const wipQ = useQuery(loadWip, []);
  const payablesQ = useQuery(loadPayables, []);
  const cashQ = useQuery(loadCashForecast, []);

  const demonstration = payAppsQ.status === 'demonstration';
  const loading = [payAppsQ, wipQ, payablesQ, cashQ].some((q) => q.status === 'loading');
  const failure = [payAppsQ, wipQ, payablesQ, cashQ].find((q) => q.status === 'error');

  const PAY_APPS = payAppsQ.status === 'ready' ? payAppsQ.data
    : demonstration ? demonstrationPayApplications() : [];
  const WIP = wipQ.status === 'ready' ? wipQ.data : demonstration ? demonstrationWip() : [];
  const AP = payablesQ.status === 'ready' ? payablesQ.data
    : demonstration ? demonstrationPayables() : [];
  const CASH = cashQ.status === 'ready' ? cashQ.data
    : demonstration ? demonstrationCashForecast() : [];

  const draft = PAY_APPS.find((p) => p.status === 'draft') ?? PAY_APPS[0];
  const openAp = AP.filter((i) => !['paid', 'void'].includes(i.status));
  const blockedAp = AP.filter((i) => i.blocked);

  /*
   * Portfolio totals skip a project the view could not compute — a job with no
   * approved budget has no earned revenue, and folding it in as a zero would
   * report the whole portfolio as more under billed than it is. The count of
   * what was skipped is shown rather than silently dropped.
   */
  const measurable = WIP.filter((w) => w.earnedRevenue != null);
  const unmeasured = WIP.length - measurable.length;
  const wipTotals = measurable.reduce((acc, w) => {
    acc.earned += w.earnedRevenue ?? 0;
    acc.billed += w.billedToDate;
    acc.cost += w.actualCost;
    acc.contract += w.contractValue;
    return acc;
  }, { earned: 0, billed: 0, cost: 0, contract: 0 });
  const underBilled = wipTotals.earned - wipTotals.billed;

  // Retainage the owner is holding, taken from the latest application on each
  // project rather than summed across periods — every figure is cumulative.
  const retainageHeld = PAY_APPS.length
    ? [...new Map(PAY_APPS.map((p) => [p.projectNumber, p])).values()]
        .reduce((a, p) => a + p.retainageToDate, 0)
    : 0;
  const retainagePercent = draft?.retainagePercent ?? 0;

  /*
   * The certificate's own lines, and their totals. Summed from the lines rather
   * than read off the header so the table and its footer cannot disagree — and
   * where they disagree with the header, that is a real discrepancy on a
   * certified document and the reader should be able to see it.
   */
  /*
   * Cash. The scheduled months are what the database can date; `unscheduled` is
   * the bucket the view keeps for real amounts whose timing is unknown, and it
   * is reported to the reader rather than folded into a month. The two invented
   * months this chart used to carry are the reason that bucket exists.
   */
  const scheduled = CASH.filter((m) => m.month != null) as Array<typeof CASH[number] & { month: string }>;
  const unscheduled = CASH.find((m) => m.month == null);
  const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const next30 = CASH.reduce((a, m) => {
    // A month bucket is dated at its first day, so a month that has started
    // counts toward the next thirty days only up to the horizon. Bucketing by
    // month is as fine as the view goes; a tighter window would need the item
    // grain, and claiming more precision than that would be the old defect.
    if (m.month == null || m.month > horizon) return a;
    return { inflow: a.inflow + m.inflow, outflow: a.outflow + m.outflow };
  }, { inflow: 0, outflow: 0 });

  const lines = draft?.lines ?? [];
  const lineTotals = lines.reduce((a, l) => ({
    scheduled: a.scheduled + l.scheduledValue,
    previous: a.previous + l.previousCompleted,
    thisPeriod: a.thisPeriod + l.thisPeriod,
    stored: a.stored + l.storedMaterials,
    toDate: a.toDate + l.completedToDate,
  }), { scheduled: 0, previous: 0, thisPeriod: 0, stored: 0, toDate: 0 });

  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Billing, cash and work-in-progress. The schedule of values comes from the awarded estimate, so what you bill traces back to what you priced."
        actions={
          <>
            <Button variant="outline"><FileCheck className="size-4" /> Export to accounting</Button>
            <Button><Plus className="size-4" /> Pay application</Button>
          </>
        }
      />

      {demonstration ? <DemonstrationNotice /> : null}
      {loading ? <LoadingState label="Reading billing, cost and payables" /> : null}

      {blockedAp.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${plural(blockedAp.length, 'invoice')} cannot be paid — three-way match failed`}>
          {blockedAp.map((i) => `${i.vendor} ${i.invoiceNumber} (${titleCase(i.matchStatus)})`).join('; ')}.
          The database refuses payment while an invoice fails its match, which is the control that stops a
          company paying for materials it never received.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Contract value" value={moneyCompact(wipTotals.contract)} icon={<CircleDollarSign className="size-4" />}
          hint={unmeasured
            ? `${plural(measurable.length, 'measurable project')}, ${unmeasured} without a budget`
            : plural(measurable.length, 'project')}
          onClick={() => setTab('wip')} active={tab === 'wip'}
          actionLabel="Show the work in progress this is summed from" />
        <StatTile label="Earned to date" value={moneyCompact(wipTotals.earned)} icon={<TrendingUp className="size-4" />}
          hint={wipTotals.contract
            ? `${percent(wipTotals.earned / wipTotals.contract, 0)} of contract, cost-to-cost`
            : 'no measurable contract value'}
          detail={
            <div className="space-y-2">
              <p>
                Revenue the work has earned, measured cost-to-cost: cost incurred divided by cost
                forecast, applied to the contract. It is not what has been billed, and the difference
                between the two is the box beside this one.
              </p>
              <p>
                Only projects carrying a budget can be measured this way —{' '}
                {unmeasured
                  ? `${unmeasured} ${unmeasured === 1 ? 'project has' : 'projects have'} none and ${unmeasured === 1 ? 'is' : 'are'} left out rather than assumed complete.`
                  : 'every project on this page carries one.'}
              </p>
            </div>
          } />
        <StatTile label={underBilled >= 0 ? 'Under billed' : 'Over billed'} value={moneyCompact(Math.abs(underBilled))}
          tone={underBilled > 0 ? 'warn' : 'success'}
          icon={underBilled >= 0 ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
          hint={underBilled > 0 ? 'work performed but not yet invoiced' : 'billed ahead of work performed'}
          onClick={() => setTab('wip')} active={tab === 'wip'}
          actionLabel="Show which projects are under or over billed" />
        <StatTile label="Retainage held" value={moneyCompact(retainageHeld)} icon={<Lock className="size-4" />}
          hint={retainagePercent ? `${percent(retainagePercent, 0)} withheld until closeout` : 'withheld until closeout'}
          detail={
            <div className="space-y-2">
              <p>
                Money earned, certified and deliberately not paid — held back against completion and
                released at closeout. It is an asset the company owns and cannot spend, which is why
                it is shown apart from what is merely unbilled.
              </p>
              <p>
                It comes off each application for payment at the contract's own rate, so it is
                already deducted from every certified amount on the pay application tab.
              </p>
            </div>
          } />
        <StatTile label="Open payables" value={moneyCompact(openAp.reduce((a, i) => a + i.amount - i.amountPaid, 0))}
          tone={blockedAp.length ? 'danger' : 'neutral'} icon={<Receipt className="size-4" />}
          hint={`${plural(openAp.length, 'invoice')}, ${blockedAp.length} blocked`}
          onClick={() => setTab('payables')} active={tab === 'payables'}
          actionLabel="List the open invoices, including the blocked ones" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="payapp">Pay application</TabsTrigger>
          <TabsTrigger value="wip">Work in progress</TabsTrigger>
          <TabsTrigger value="payables">Payables ({openAp.length})</TabsTrigger>
          <TabsTrigger value="cash">Cash forecast</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ pay application */}
        <TabsContent value="payapp" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Application for payment no. {draft?.number ?? '—'}</CardTitle>
                <CardDescription>
                  {draft ? `${draft.projectNumber} · ${date(draft.periodStart)} to ${date(draft.periodEnd)} · ${titleCase(draft.status)}`
                    : 'No application on file'}
                </CardDescription>
              </div>
              <Button><FileCheck className="size-4" /> Submit</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Item</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Scheduled value</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                    <TableHead className="text-right">This period</TableHead>
                    <TableHead className="text-right">Stored</TableHead>
                    <TableHead className="text-right">To date</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs text-charcoal-500">{l.itemNumber}</TableCell>
                      <TableCell className="font-medium text-charcoal-900">{l.description}</TableCell>
                      <TableCell className="tabular text-right">{money(l.scheduledValue)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{money(l.previousCompleted)}</TableCell>
                      <TableCell className={cn('tabular text-right', l.thisPeriod > 0 && 'font-medium text-charcoal-900')}>
                        {l.thisPeriod ? money(l.thisPeriod) : '—'}
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {l.storedMaterials ? money(l.storedMaterials) : '—'}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">{money(l.completedToDate)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {l.scheduledValue ? percent(l.completedToDate / l.scheduledValue, 0) : '—'}
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {money(l.scheduledValue - l.completedToDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={2}>Totals</TableCell>
                    <TableCell className="tabular text-right">{money(lineTotals.scheduled)}</TableCell>
                    <TableCell className="tabular text-right">{money(lineTotals.previous)}</TableCell>
                    <TableCell className="tabular text-right">{money(lineTotals.thisPeriod)}</TableCell>
                    <TableCell className="tabular text-right">{money(lineTotals.stored)}</TableCell>
                    <TableCell className="tabular text-right">{money(lineTotals.toDate)}</TableCell>
                    <TableCell className="tabular text-right">
                      {lineTotals.scheduled ? percent(lineTotals.toDate / lineTotals.scheduled, 0) : '—'}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {money(lineTotals.scheduled - lineTotals.toDate)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              {!lines.length && !loading ? (
                <EmptyState title="No lines on this application"
                  hint="A pay application bills against the schedule of values. Add the schedule to the project and the lines appear here." />
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Certificate summary</CardTitle>
                <CardDescription>
                  The AIA G702 arithmetic. Every figure is a stored column on the certificate — the
                  contract sum to date and the total earned are generated by the database from their
                  parts, so a certificate cannot disagree with itself.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Original contract sum" value={money(draft?.contractSum ?? 0)} />
                <Row label="Net change by approved change orders" value={money(draft?.approvedChanges ?? 0)} />
                <Row label="Contract sum to date" value={money(draft?.contractSumToDate ?? 0)} strong />
                <Separator />
                <Row label="Total completed and stored to date" value={money(draft?.totalEarned ?? 0)} />
                <Row label={`Retainage at ${percent(retainagePercent, 0)}`}
                  value={`(${money(draft?.retainageToDate ?? 0)})`} />
                <Row label="Total earned less retainage"
                  value={money((draft?.totalEarned ?? 0) - (draft?.retainageToDate ?? 0))} strong />
                <Row label="Less previous certificates for payment"
                  value={`(${money(draft?.previousPayments ?? 0)})`} />
                <Separator />
                <Row label="Current payment due" value={money(draft?.currentDue ?? 0)} strong emphasis />
                <Row label="Balance to finish, plus retainage"
                  value={money((draft?.contractSumToDate ?? 0) - (draft?.totalEarned ?? 0) + (draft?.retainageToDate ?? 0))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Application history</CardTitle>
                <CardDescription>
                  A submitted application is a certified figure and is frozen. Corrections are billed on the
                  next application rather than by rewriting a certificate the owner already approved.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No.</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PAY_APPS.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="tabular font-medium text-charcoal-900">{p.number}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                          {date(p.periodStart)} – {date(p.periodEnd)}
                        </TableCell>
                        <TableCell className="tabular text-right">{money(p.totalEarned)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{money(p.currentDue)}</TableCell>
                        <TableCell>
                          <Badge variant={p.status === 'paid' ? 'success' : p.status === 'draft' ? 'default' : 'warn'}>
                            {titleCase(p.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-charcoal-500">{p.paidAt ? date(p.paidAt) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ------------------------------------------------------------- WIP */}
        <TabsContent value="wip">
          <Card>
            <CardHeader>
              <CardTitle>Work in progress</CardTitle>
              <CardDescription>
                Earned revenue against billing. Under billing is cash sitting in the ground; over billing is
                borrowing against work not yet done, and it reverses.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="min-w-32">Complete</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead className="text-right">Cost to date</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Over / (under)</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {WIP.map((w) => {
                    /*
                     * A project with no approved budget has no percent complete
                     * and therefore no earned revenue, no over/under billing
                     * and no margin. The view returns null for all four and the
                     * row says so — showing 0% would read as "no work done",
                     * and pairing that with a contract value would report the
                     * entire contract as under-billed cash.
                     */
                    const unmeasurable = w.percentComplete == null;
                    const delta = w.overUnderBilled;
                    const margin = w.earnedMargin;
                    return (
                      <TableRow key={w.projectId}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{w.projectNumber}</p>
                          <p className="max-w-56 truncate text-xs text-charcoal-500">{w.projectName}</p>
                        </TableCell>
                        <TableCell>
                          {unmeasurable ? (
                            <p className="text-xs text-charcoal-500">No approved budget</p>
                          ) : (
                            <>
                              <Progress value={(w.percentComplete ?? 0) * 100}
                                indicatorClassName={(w.costRatio ?? 0) > 1 ? 'bg-danger-500' : 'bg-charcoal-700'} />
                              <p className="tabular mt-1 text-xs text-charcoal-500">
                                {percent(w.percentComplete ?? 0, 0)}
                                {(w.costRatio ?? 0) > 1
                                  ? ` · ${percent(w.costRatio ?? 0, 0)} of budget spent` : ''}
                              </p>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right">{money(w.contractValue)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(w.actualCost)}</TableCell>
                        <TableCell className="tabular text-right">
                          {w.earnedRevenue == null ? '—' : money(w.earnedRevenue)}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(w.billedToDate)}</TableCell>
                        <TableCell className={cn('tabular text-right font-medium',
                          delta == null ? 'text-charcoal-400' : delta >= 0 ? 'text-success-700' : 'text-warn-700')}>
                          {delta == null ? '—'
                            : `${delta >= 0 ? '' : '('}${money(Math.abs(delta))}${delta >= 0 ? '' : ')'}`}
                        </TableCell>
                        <TableCell className={cn('tabular text-right font-medium',
                          margin == null ? 'text-charcoal-400'
                            : margin >= 0.15 ? 'text-success-700'
                            : margin >= 0.08 ? 'text-warn-700' : 'text-danger-700')}>
                          {margin == null ? '—' : percent(margin, 1)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={2}>
                      Portfolio
                      {unmeasured ? (
                        <span className="ml-2 text-xs font-normal text-charcoal-500">
                          excludes {plural(unmeasured, 'project')} with no approved budget
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.contract)}</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.cost)}</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.earned)}</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.billed)}</TableCell>
                    <TableCell className="tabular text-right">
                      {underBilled >= 0 ? `(${money(underBilled)})` : money(-underBilled)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {wipTotals.earned
                        ? percent((wipTotals.earned - wipTotals.cost) / wipTotals.earned, 1) : '—'}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- payables */}
        <TabsContent value="payables">
          <Card>
            <CardHeader>
              <CardTitle>Accounts payable</CardTitle>
              <CardDescription>
                Three-way match: purchase order, delivery receipt and invoice must agree before an invoice
                can be paid.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Retainage</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AP.map((i) => {
                    const blocked = i.blocked;
                    return (
                      <TableRow key={i.id} className={cn(blocked && 'bg-danger-50/40')}>
                        <TableCell className="font-medium text-charcoal-900">{i.vendor}</TableCell>
                        <TableCell>
                          <p className="font-mono text-xs text-charcoal-700">{i.invoiceNumber}</p>
                          <p className="text-xs text-charcoal-400">{date(i.invoiceDate)}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-charcoal-600">{i.po ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-charcoal-600">
                          {i.dueDate ? date(i.dueDate) : <span className="text-charcoal-400">no terms</span>}
                        </TableCell>
                        <TableCell className="tabular text-right font-medium">{money(i.amount)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {i.retainageWithheld ? `(${money(i.retainageWithheld)})` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            i.matchStatus === 'matched' ? 'success'
                            : i.matchStatus === 'no_po' ? 'warn' : 'danger'
                          }>{titleCase(i.matchStatus)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            i.status === 'paid' ? 'success'
                            : i.status === 'disputed' || i.status === 'on_hold' ? 'danger' : 'default'
                          }>{titleCase(i.status)}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!AP.length && !loading ? (
                <EmptyState title="No payables on file"
                  hint="Vendor invoices appear here once they are received against a purchase order." />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ cash */}
        <TabsContent value="cash">
          <Card>
            <CardHeader>
              <CardTitle>Cash forecast</CardTitle>
              <CardDescription>
                Receivables from certified pay applications against payables coming due. Retainage is shown
                separately because it is not collectable until closeout.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Expected in, next 30 days">
                  <span className="text-lg font-bold text-success-700">{money(next30.inflow)}</span>
                </Field>
                <Field label="Payables due, next 30 days">
                  <span className="text-lg font-bold text-danger-700">{money(next30.outflow)}</span>
                </Field>
                <Field label="Retainage receivable at closeout">
                  <span className="text-lg font-bold text-charcoal-900">{money(retainageHeld)}</span>
                </Field>
              </div>

              <Separator />

              <div className="space-y-3">
                {scheduled.length ? scheduled.map((m) => {
                  const scale = Math.max(m.inflow, m.outflow + m.outflowBlocked, 1);
                  return (
                    <div key={m.month}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-charcoal-900">{monthLabel(m.month)}</span>
                        <span className={cn('tabular font-semibold', m.net >= 0 ? 'text-success-700' : 'text-danger-700')}>
                          {m.net >= 0 ? '+' : '\u2212'}{money(Math.abs(m.net))} net
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-14 text-xs text-charcoal-500">In</span>
                          <div className="h-3 flex-1 overflow-hidden rounded bg-charcoal-100">
                            <div className="h-full rounded bg-success-600" style={{ width: `${(m.inflow / scale) * 100}%` }} />
                          </div>
                          <span className="tabular w-24 text-right text-xs text-charcoal-600">{money(m.inflow)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-14 text-xs text-charcoal-500">Out</span>
                          <div className="flex h-3 flex-1 overflow-hidden rounded bg-charcoal-100">
                            <div className="h-full bg-danger-500" style={{ width: `${(m.outflow / scale) * 100}%` }} />
                            {/*
                              * Blocked money is owed and is not leaving on this
                              * date. Drawn in the same bar so the total owed is
                              * visible, hatched apart so it is not read as cash
                              * that will actually move.
                              */}
                            <div className="h-full bg-danger-500/30" style={{ width: `${(m.outflowBlocked / scale) * 100}%` }} />
                          </div>
                          <span className="tabular w-24 text-right text-xs text-charcoal-600">
                            {money(m.outflow)}
                            {m.outflowBlocked ? <span className="text-charcoal-400"> +{moneyCompact(m.outflowBlocked)}</span> : null}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }) : !loading ? (
                  <EmptyState title="Nothing scheduled"
                    hint="A month appears once there is a certified pay application on a contract with recorded payment terms, or an invoice with a due date." />
                ) : null}
              </div>

              {unscheduled ? (
                <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
                  title="Money with no date on it">
                  {unscheduled.inflow ? `${money(unscheduled.inflow)} receivable ` : ''}
                  {unscheduled.inflow && (unscheduled.outflow || unscheduled.outflowBlocked) ? 'and ' : ''}
                  {unscheduled.outflow + unscheduled.outflowBlocked
                    ? `${money(unscheduled.outflow + unscheduled.outflowBlocked)} payable ` : ''}
                  has no expected date. A receivable is undated until its contract records payment
                  terms in days; a payable is undated until the invoice carries a due date. These
                  amounts are real and are deliberately left out of the months above rather than
                  assumed into one.
                </Alert>
              ) : null}

              {underBilled < 0 ? (
                <Alert tone="warn" icon={<Banknote className="size-4" />}
                  title="Under billing is a cash problem before it is an accounting one">
                  {money(Math.abs(underBilled))} of work has been performed but not yet invoiced. That is payroll
                  and material already spent, sitting in the ground until it is billed.
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** A bucket's first-of-month date, as a month. */
function monthLabel(month: string) {
  return new Date(`${month}T00:00:00Z`).toLocaleDateString('en-US',
    { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function Row({ label, value, strong, emphasis }: { label: string; value: string; strong?: boolean; emphasis?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', strong && 'border-t border-charcoal-200 pt-2')}>
      <span className={cn(strong ? 'font-medium text-charcoal-900' : 'text-charcoal-600')}>{label}</span>
      <span className={cn('tabular', emphasis ? 'text-lg font-bold text-charcoal-900' : strong ? 'font-semibold text-charcoal-900' : 'text-charcoal-700')}>
        {value}
      </span>
    </div>
  );
}

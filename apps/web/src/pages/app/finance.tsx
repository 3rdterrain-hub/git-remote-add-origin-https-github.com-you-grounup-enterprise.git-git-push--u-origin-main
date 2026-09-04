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
  SCHEDULE_OF_VALUES, PAY_APPLICATIONS, WIP, AP_INVOICES, RETAINAGE_PERCENT, payApplicationTotals, PROJECT,
} from '@/data/finance';
import { money, moneyCompact, percent, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

export function FinancePage() {
  const t = payApplicationTotals();
  const draft = PAY_APPLICATIONS.find((p) => p.status === 'draft');
  const paid = PAY_APPLICATIONS.filter((p) => p.status === 'paid');

  const retainageHeld = paid.reduce((a, p) => a + p.retainage, 0) + t.retainage;
  const openAp = AP_INVOICES.filter((i) => !['paid', 'void'].includes(i.status));
  const blockedAp = AP_INVOICES.filter((i) => !['matched', 'no_po'].includes(i.matchStatus) && i.status !== 'paid');

  // Over/under billing across the portfolio: the WIP question that matters.
  const wipTotals = WIP.reduce((acc, w) => {
    const earned = w.contract * w.percentComplete;
    acc.earned += earned;
    acc.billed += w.billedToDate;
    acc.cost += w.actualCost;
    acc.contract += w.contract;
    return acc;
  }, { earned: 0, billed: 0, cost: 0, contract: 0 });
  const underBilled = wipTotals.earned - wipTotals.billed;

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
          hint={`${WIP.length} projects`} />
        <StatTile label="Earned to date" value={moneyCompact(wipTotals.earned)} icon={<TrendingUp className="size-4" />}
          hint={`${percent(wipTotals.earned / wipTotals.contract, 0)} of contract`} />
        <StatTile label={underBilled >= 0 ? 'Under billed' : 'Over billed'} value={moneyCompact(Math.abs(underBilled))}
          tone={underBilled > 0 ? 'warn' : 'success'}
          icon={underBilled >= 0 ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
          hint={underBilled > 0 ? 'work performed but not yet invoiced' : 'billed ahead of work performed'} />
        <StatTile label="Retainage held" value={moneyCompact(retainageHeld)} icon={<Lock className="size-4" />}
          hint={`${percent(RETAINAGE_PERCENT, 0)} withheld until closeout`} />
        <StatTile label="Open payables" value={moneyCompact(openAp.reduce((a, i) => a + i.amount - i.amountPaid, 0))}
          tone={blockedAp.length ? 'danger' : 'neutral'} icon={<Receipt className="size-4" />}
          hint={`${plural(openAp.length, 'invoice')}, ${blockedAp.length} blocked`} />
      </div>

      <Tabs defaultValue="payapp">
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
                <CardTitle>Application for payment no. {draft?.number}</CardTitle>
                <CardDescription>
                  {PROJECT.number} · {date(draft?.periodStart)} to {date(draft?.periodEnd)} · draft
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
                  {SCHEDULE_OF_VALUES.map((s) => {
                    const toDate = s.previousCompleted + s.thisPeriod + s.storedMaterials;
                    const pct = toDate / s.scheduledValue;
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs text-charcoal-500">{s.itemNumber}</TableCell>
                        <TableCell className="font-medium text-charcoal-900">{s.description}</TableCell>
                        <TableCell className="tabular text-right">{money(s.scheduledValue)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(s.previousCompleted)}</TableCell>
                        <TableCell className={cn('tabular text-right', s.thisPeriod > 0 && 'font-medium text-charcoal-900')}>
                          {s.thisPeriod ? money(s.thisPeriod) : '—'}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {s.storedMaterials ? money(s.storedMaterials) : '—'}
                        </TableCell>
                        <TableCell className="tabular text-right font-medium">{money(toDate)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{percent(pct, 0)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(s.scheduledValue - toDate)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={2}>Totals</TableCell>
                    <TableCell className="tabular text-right">{money(t.scheduled)}</TableCell>
                    <TableCell className="tabular text-right">{money(t.previous)}</TableCell>
                    <TableCell className="tabular text-right">{money(t.thisPeriod)}</TableCell>
                    <TableCell className="tabular text-right">{money(t.stored)}</TableCell>
                    <TableCell className="tabular text-right">{money(t.totalEarned)}</TableCell>
                    <TableCell className="tabular text-right">{percent(t.totalEarned / t.scheduled, 0)}</TableCell>
                    <TableCell className="tabular text-right">{money(t.scheduled - t.totalEarned)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Certificate summary</CardTitle>
                <CardDescription>The AIA G702 arithmetic, computed rather than typed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Original contract sum" value={money(t.scheduled)} />
                <Row label="Net change by approved change orders" value={money(t.approvedChanges)} />
                <Row label="Contract sum to date" value={money(t.scheduled + t.approvedChanges)} strong />
                <Separator />
                <Row label="Total completed and stored to date" value={money(t.totalEarned)} />
                <Row label={`Retainage at ${percent(RETAINAGE_PERCENT, 0)}`} value={`(${money(t.retainage)})`} />
                <Row label="Total earned less retainage" value={money(t.totalEarned - t.retainage)} strong />
                <Row label="Less previous certificates for payment" value={`(${money(t.previousPayments)})`} />
                <Separator />
                <Row label="Current payment due" value={money(t.currentDue)} strong emphasis />
                <Row label="Balance to finish, plus retainage"
                  value={money(t.scheduled + t.approvedChanges - t.totalEarned + t.retainage)} />
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
                    {PAY_APPLICATIONS.map((p) => (
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
                    const earned = w.contract * w.percentComplete;
                    const delta = w.billedToDate - earned;
                    const margin = earned ? (earned - w.actualCost) / earned : 0;
                    return (
                      <TableRow key={w.project}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{w.project}</p>
                          <p className="max-w-56 truncate text-xs text-charcoal-500">{w.name}</p>
                        </TableCell>
                        <TableCell>
                          <Progress value={w.percentComplete * 100} indicatorClassName="bg-charcoal-700" />
                          <p className="tabular mt-1 text-xs text-charcoal-500">{percent(w.percentComplete, 0)}</p>
                        </TableCell>
                        <TableCell className="tabular text-right">{money(w.contract)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(w.actualCost)}</TableCell>
                        <TableCell className="tabular text-right">{money(earned)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(w.billedToDate)}</TableCell>
                        <TableCell className={cn('tabular text-right font-medium', delta >= 0 ? 'text-success-700' : 'text-warn-700')}>
                          {delta >= 0 ? '' : '('}{money(Math.abs(delta))}{delta >= 0 ? '' : ')'}
                        </TableCell>
                        <TableCell className={cn('tabular text-right font-medium', margin >= 0.15 ? 'text-success-700' : margin >= 0.08 ? 'text-warn-700' : 'text-danger-700')}>
                          {percent(margin, 1)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={2}>Portfolio</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.contract)}</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.cost)}</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.earned)}</TableCell>
                    <TableCell className="tabular text-right">{money(wipTotals.billed)}</TableCell>
                    <TableCell className="tabular text-right">({money(Math.abs(underBilled))})</TableCell>
                    <TableCell className="tabular text-right">
                      {percent((wipTotals.earned - wipTotals.cost) / wipTotals.earned, 1)}
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
                  {AP_INVOICES.map((i) => {
                    const blocked = !['matched', 'no_po'].includes(i.matchStatus) && i.status !== 'paid';
                    return (
                      <TableRow key={i.id} className={cn(blocked && 'bg-danger-50/40')}>
                        <TableCell className="font-medium text-charcoal-900">{i.vendor}</TableCell>
                        <TableCell>
                          <p className="font-mono text-xs text-charcoal-700">{i.invoiceNumber}</p>
                          <p className="text-xs text-charcoal-400">{date(i.invoiceDate)}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-charcoal-600">{i.po ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-charcoal-600">{date(i.dueDate)}</TableCell>
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
                  <span className="text-lg font-bold text-success-700">{money(t.currentDue)}</span>
                </Field>
                <Field label="Payables due, next 30 days">
                  <span className="text-lg font-bold text-danger-700">
                    {money(openAp.filter((i) => i.status !== 'on_hold' && i.status !== 'disputed')
                      .reduce((a, i) => a + i.amount - i.amountPaid, 0))}
                  </span>
                </Field>
                <Field label="Retainage receivable at closeout">
                  <span className="text-lg font-bold text-charcoal-900">{money(retainageHeld)}</span>
                </Field>
              </div>

              <Separator />

              <div className="space-y-3">
                {[
                  ['September', t.currentDue, 42_920],
                  ['October', 286_400, 118_600],
                  ['November', 198_200, 94_300],
                ].map(([month, inflow, outflow]) => {
                  const net = (inflow as number) - (outflow as number);
                  const scale = Math.max(inflow as number, outflow as number, 1);
                  return (
                    <div key={String(month)}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-charcoal-900">{month}</span>
                        <span className={cn('tabular font-semibold', net >= 0 ? 'text-success-700' : 'text-danger-700')}>
                          {net >= 0 ? '+' : '−'}{money(Math.abs(net))} net
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-14 text-xs text-charcoal-500">In</span>
                          <div className="h-3 flex-1 overflow-hidden rounded bg-charcoal-100">
                            <div className="h-full rounded bg-success-600" style={{ width: `${((inflow as number) / scale) * 100}%` }} />
                          </div>
                          <span className="tabular w-24 text-right text-xs text-charcoal-600">{money(inflow as number)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-14 text-xs text-charcoal-500">Out</span>
                          <div className="h-3 flex-1 overflow-hidden rounded bg-charcoal-100">
                            <div className="h-full rounded bg-danger-500" style={{ width: `${((outflow as number) / scale) * 100}%` }} />
                          </div>
                          <span className="tabular w-24 text-right text-xs text-charcoal-600">{money(outflow as number)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Alert tone="warn" icon={<Banknote className="size-4" />} title="Under billing is a cash problem before it is an accounting one">
                {money(Math.abs(underBilled))} of work has been performed but not yet invoiced. That is payroll
                and material already spent, sitting in the ground until it is billed.
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
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

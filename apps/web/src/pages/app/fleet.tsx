import { useState } from 'react';
import {
  Truck, Wrench, Fuel, Gauge, AlertTriangle, Radio, CircleDollarSign, Plus, TrendingDown,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadAssets, loadMaintenanceDue, loadWorkOrders, loadFuel,
  demonstrationAssets, demonstrationMaintenance, demonstrationWorkOrders, demonstrationFuel,
} from '@/lib/data/fleet';
import { money, moneyCompact, qty, integer, dateTime, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, 'success' | 'info' | 'warn' | 'danger'> = {
  available: 'success', assigned: 'info', in_maintenance: 'warn', down: 'danger',
};

export function FleetPage() {
  /*
   * The five boxes across the top each counted something one of the five tabs
   * below already lists, and none of them went there. The tabs are driven from
   * here now so a tile can open the one that accounts for its number — and the
   * machines that are down are a filter on the asset list rather than a count
   * an operator has to find by reading every status badge.
   */
  const [tab, setTab] = useState('assets');
  const [downOnly, setDownOnly] = useState(false);
  const assetsQ = useQuery(loadAssets, []);
  const maintenanceQ = useQuery(loadMaintenanceDue, []);
  const workOrdersQ = useQuery(loadWorkOrders, []);
  const fuelQ = useQuery(loadFuel, []);

  const demo = assetsQ.status === 'demonstration';
  const ASSETS = assetsQ.status === 'ready' ? assetsQ.data : demo ? demonstrationAssets() : [];
  const MAINTENANCE_DUE = maintenanceQ.status === 'ready' ? maintenanceQ.data
    : demo ? demonstrationMaintenance() : [];
  const WORK_ORDERS = workOrdersQ.status === 'ready' ? workOrdersQ.data
    : demo ? demonstrationWorkOrders() : [];
  const FUEL_TRANSACTIONS = fuelQ.status === 'ready' ? fuelQ.data : demo ? demonstrationFuel() : [];

  const active = ASSETS.filter((a) => a.status !== 'down');
  const down = ASSETS.filter((a) => a.status === 'down');
  const overdue = MAINTENANCE_DUE.filter((m) => m.hoursRemaining != null && m.hoursRemaining < 0);
  const dueSoon = MAINTENANCE_DUE.filter(
    (m) => m.hoursRemaining != null && m.hoursRemaining >= 0 && m.hoursRemaining <= 50);
  const openWo = WORK_ORDERS.filter((w) => !['complete', 'canceled'].includes(w.status));
  const fuelGallons = FUEL_TRANSACTIONS.reduce((a, f) => a + f.gallons, 0);
  const fuelCost = FUEL_TRANSACTIONS.reduce((a, f) => a + f.totalCost, 0);
  const fuelExceptions = FUEL_TRANSACTIONS.filter((f) => f.exception);
  const ownedValue = ASSETS.reduce((a, x) => a + (x.acquisitionCost ?? 0), 0);

  /*
   * Hours run, not a utilization percentage.
   *
   * A percentage needs an assumed denominator — hours available per day,
   * working days per month — and the platform has neither. Below roughly one
   * shift a week over thirty days is where owning gets hard to justify, and
   * that is a threshold on a measured number rather than on an invented ratio.
   */
  const LOW_HOURS_30D = 40;
  const metered = ASSETS.filter((a) => a.hoursLast30 != null);
  const totalHours30 = metered.reduce((a, x) => a + (x.hoursLast30 ?? 0), 0);
  const idle = metered.filter(
    (a) => (a.hoursLast30 ?? 0) < LOW_HOURS_30D && (a.acquisitionCost ?? 0) > 0);

  const outOfService = ASSETS.filter(
    (a) => a.status === 'down' || a.status === 'in_maintenance');
  const shownAssets = downOnly ? outOfService : ASSETS;
  const owned = ASSETS.filter((a) => (a.acquisitionCost ?? 0) > 0);

  const showTab = (next: string) => {
    setTab(next);
    if (next !== 'assets') setDownOnly(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet & Equipment"
        description="Every machine is tied to the catalog rate it is estimated at, so utilization, fuel and maintenance can be read against the rate that priced the work."
        actions={
          <>
            <Button variant="outline"><Wrench className="size-4" /> Work order</Button>
            <Button><Plus className="size-4" /> Add asset</Button>
          </>
        }
      />

      {demo ? <DemonstrationNotice what="this page" /> : null}
      {assetsQ.status === 'loading' ? <LoadingState label="Loading the fleet" /> : null}
      {assetsQ.status === 'error'
        ? <ErrorState message={assetsQ.message} onRetry={assetsQ.refetch} /> : null}

      {overdue.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${plural(overdue.length, 'machine')} past ${overdue.length === 1 ? 'its' : 'their'} service interval`}>
          {overdue.map((m) => `${m.assetNumber} (${Math.abs(m.hoursRemaining ?? 0)}h over)`).join(', ')}. Running past a
          service interval is how a $1,200 oil change becomes a $28,000 engine.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Fleet size" value={ASSETS.length} icon={<Truck className="size-4" />}
          hint={`${active.length} available or assigned`}
          onClick={() => { showTab('assets'); setDownOnly(false); }}
          active={tab === 'assets' && !downOnly}
          actionLabel="List every machine" />
        <StatTile label="Hours run (30 days)"
          value={metered.length ? integer(totalHours30) : '—'}
          tone={metered.length && totalHours30 / metered.length >= 100 ? 'success' : 'warn'}
          icon={<Gauge className="size-4" />}
          hint={metered.length
            ? `across ${metered.length} ${metered.length === 1 ? 'machine' : 'machines'} with meter readings`
            : 'no meter readings in the window'}
          onClick={() => showTab('utilization')} active={tab === 'utilization'}
          actionLabel="Show the hours each machine ran" />
        <StatTile label="Down or in shop" value={outOfService.length}
          tone={down.length ? 'danger' : 'warn'} icon={<Wrench className="size-4" />}
          hint={`${plural(openWo.length, 'open work order')}`}
          onClick={() => { setTab('assets'); setDownOnly((v) => !v); }}
          active={downOnly}
          actionLabel="List the machines that are down or in the shop" />
        <StatTile label="Fuel this week" value={`${integer(fuelGallons)} gal`} icon={<Fuel className="size-4" />}
          hint={`${money(fuelCost)} · ${plural(fuelExceptions.length, 'exception')}`}
          onClick={() => showTab('fuel')} active={tab === 'fuel'}
          actionLabel="Show every fuel transaction in the window" />
        <StatTile label="Owned fleet value" value={moneyCompact(ownedValue)} icon={<CircleDollarSign className="size-4" />}
          hint="at acquisition cost"
          detail={
            <div className="space-y-2">
              <p>
                What {plural(owned.length, 'machine')} cost to buy, added up. It is what was paid,
                not what the fleet is worth today: nothing here depreciates a machine, because a
                book value that nobody entered would be a number the platform invented.
              </p>
              <p>
                Rented and leased machines are not in it — {plural(ASSETS.length - owned.length,
                  'machine')} on this page {ASSETS.length - owned.length === 1 ? 'is' : 'are'} not
                owned, and a rental has a rate rather than a purchase price.
              </p>
            </div>
          } />
      </div>

      <Tabs value={tab} onValueChange={showTab}>
        <TabsList>
          <TabsTrigger value="assets">Assets ({ASSETS.length})</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance ({overdue.length + dueSoon.length} due)</TabsTrigger>
          <TabsTrigger value="workorders">Work orders ({openWo.length} open)</TabsTrigger>
          <TabsTrigger value="fuel">Fuel ({fuelExceptions.length} exceptions)</TabsTrigger>
          <TabsTrigger value="utilization">Utilization</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- assets */}
        <TabsContent value="assets">
          <Card><CardContent className="p-0">
            {downOnly ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-charcoal-200 px-4 py-2">
                <p className="text-sm text-charcoal-600">
                  {outOfService.length === 1
                    ? 'The 1 machine that is down or in the shop.'
                    : `The ${outOfService.length} machines that are down or in the shop.`}
                </p>
                <Button variant="outline" size="sm" onClick={() => setDownOnly(false)}>
                  Show all {ASSETS.length}
                </Button>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Make / model</TableHead>
                  <TableHead>Ownership</TableHead>
                  <TableHead className="text-right">Meter</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-32">Utilization</TableHead>
                  <TableHead>Telemetry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownAssets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{a.assetNumber}</p>
                      <p className="text-xs text-charcoal-500">{a.name}</p>
                      {a.equipmentCode ? (
                        <p className="font-mono text-[10px] text-charcoal-400">rate {a.equipmentCode}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-charcoal-600">
                      {a.make} {a.model}<br /><span className="text-xs text-charcoal-400">{a.modelYear}</span>
                    </TableCell>
                    <TableCell><Badge variant="outline">{titleCase(a.ownership)}</Badge></TableCell>
                    <TableCell className="tabular text-right">{integer(a.currentHours)} h</TableCell>
                    <TableCell className="text-sm">
                      {a.assignedProject ? (
                        <>
                          <p className="text-charcoal-700">{a.assignedProject}</p>
                          <p className="text-xs text-charcoal-400">{a.assignedOperator ?? 'no operator assigned'}</p>
                        </>
                      ) : <span className="text-charcoal-400">{a.location}</span>}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONE[a.status]}>{titleCase(a.status)}</Badge></TableCell>
                    <TableCell>
                      <Progress value={Math.min(((a.hoursLast30 ?? 0) / 200) * 100, 100)}
                        indicatorClassName={(a.hoursLast30 ?? 0) < LOW_HOURS_30D ? 'bg-danger-500' : (a.hoursLast30 ?? 0) < 100 ? 'bg-warn-600' : 'bg-success-600'} />
                      <p className="tabular mt-1 text-xs text-charcoal-500">
                        {a.hoursLast30 == null ? 'no meter readings' : `${integer(a.hoursLast30)} hr in 30 days`}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-500">
                      {a.lastTelemetryAt ? (
                        <span className="flex items-center gap-1"><Radio className="size-3 text-success-600" /> {dateTime(a.lastTelemetryAt)}</span>
                      ) : <span className="text-charcoal-400">no device</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* ----------------------------------------------------- maintenance */}
        <TabsContent value="maintenance">
          <Card>
            <CardHeader>
              <CardTitle>Service due</CardTitle>
              <CardDescription>
                Computed from each machine's actual meter against its interval — not from a calendar. A machine that
                sat idle for a month is not due; one that ran double shifts is.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Interval</TableHead>
                    <TableHead className="text-right">Last done</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Hours to go</TableHead>
                    <TableHead className="min-w-32">Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MAINTENANCE_DUE.map((m) => {
                    // A schedule with no hour interval runs on miles or on a
                    // calendar, so it has no hour progress to show.
                    const used = m.currentHours - (m.lastPerformedHours ?? 0);
                    const pct = m.intervalHours
                      ? Math.min((used / m.intervalHours) * 100, 100) : 0;
                    const remaining = m.hoursRemaining;
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{m.assetNumber}</p>
                          <p className="text-xs text-charcoal-500">{m.assetName}</p>
                        </TableCell>
                        <TableCell className="text-charcoal-600">{m.scheduleName}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {m.intervalHours == null ? 'n/a' : `${m.intervalHours} h`}
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{integer(m.lastPerformedHours ?? 0)}</TableCell>
                        <TableCell className="tabular text-right">{integer(m.currentHours)}</TableCell>
                        <TableCell className={cn('tabular text-right font-semibold',
                          remaining == null ? 'text-charcoal-500'
                            : remaining < 0 ? 'text-danger-700'
                            : remaining <= 50 ? 'text-warn-700' : 'text-success-700')}>
                          {remaining == null ? 'not hour-based'
                            : remaining < 0 ? `${Math.abs(remaining)} over` : `${remaining} h`}
                        </TableCell>
                        <TableCell>
                          <Progress value={pct}
                            indicatorClassName={remaining == null ? 'bg-charcoal-300'
                              : remaining < 0 ? 'bg-danger-500'
                              : remaining <= 50 ? 'bg-warn-600' : 'bg-success-600'} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------- work orders */}
        <TabsContent value="workorders">
          <Card>
            <CardHeader>
              <CardTitle>Work orders</CardTitle>
              <CardDescription>
                A completed work order must record what was actually done — the database refuses to close one
                without a resolution, because "complete" with no detail tells the next mechanic nothing.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work order</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Downtime</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {WORK_ORDERS.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{w.number}</p>
                        <p className="max-w-64 text-xs text-charcoal-500">{w.title}</p>
                        {w.resolution ? (
                          <p className="mt-1 max-w-64 text-xs italic text-charcoal-500">“{w.resolution}”</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-charcoal-700">{w.assetNumber}</p>
                        <p className="text-xs text-charcoal-400">{w.assetName}</p>
                      </TableCell>
                      <TableCell><Badge variant="outline">{titleCase(w.type)}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={w.priority === 'critical' ? 'danger' : w.priority === 'high' ? 'warn' : 'default'}>
                          {titleCase(w.priority)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={w.status === 'complete' ? 'success' : w.status === 'awaiting_parts' ? 'danger' : 'warn'}>
                          {titleCase(w.status)}
                        </Badge>
                        <p className="mt-0.5 text-xs text-charcoal-400">opened {date(w.openedAt)}</p>
                      </TableCell>
                      <TableCell className={cn('tabular text-right', w.downtimeHours > 24 ? 'font-semibold text-danger-700' : 'text-charcoal-600')}>
                        {integer(w.downtimeHours)} h
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {money(w.laborCost + w.partsCost + w.outsideCost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={5}>Total maintenance cost</TableCell>
                    <TableCell className="tabular text-right">
                      {integer(WORK_ORDERS.reduce((a, w) => a + w.downtimeHours, 0))} h
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {money(WORK_ORDERS.reduce((a, w) => a + w.laborCost + w.partsCost + w.outsideCost, 0))}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ fuel */}
        <TabsContent value="fuel" className="space-y-4">
          {fuelExceptions.length ? (
            <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
              title={`${plural(fuelExceptions.length, 'transaction')} needs reconciling`}>
              A card transaction with no matching asset, or a volume well outside the machine's tank capacity, is
              flagged rather than silently posted to job cost.
            </Alert>
          ) : null}
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-right">Gallons</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Exception</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FUEL_TRANSACTIONS.map((f) => (
                  <TableRow key={f.id} className={cn(f.exception && 'bg-warn-50/50')}>
                    <TableCell className="whitespace-nowrap text-sm text-charcoal-600">{dateTime(f.transactedAt)}</TableCell>
                    <TableCell>
                      {f.assetNumber ? (
                        <>
                          <p className="text-sm font-medium text-charcoal-900">{f.assetNumber}</p>
                          <p className="text-xs text-charcoal-400">{f.assetName}</p>
                        </>
                      ) : <span className="text-sm text-danger-700">{f.assetName}</span>}
                    </TableCell>
                    <TableCell className="text-sm text-charcoal-600">{f.operator ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">{qty(f.gallons, 1)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(f.pricePerGallon)}</TableCell>
                    <TableCell className="tabular text-right font-medium">{money(f.gallons * f.pricePerGallon)}</TableCell>
                    <TableCell className="text-xs text-charcoal-500">{titleCase(f.source)}</TableCell>
                    <TableCell>
                      {f.exception ? <Badge variant="warn">{titleCase(f.exception)}</Badge> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-charcoal-50">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="tabular text-right">{qty(fuelGallons, 1)}</TableCell>
                  <TableCell />
                  <TableCell className="tabular text-right">{money(fuelCost)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* ----------------------------------------------------- utilization */}
        <TabsContent value="utilization" className="space-y-6">
          {idle.length ? (
            <Alert tone="warn" icon={<TrendingDown className="size-4" />}
              title={`${plural(idle.length, 'owned machine')} ran under ${LOW_HOURS_30D} hours in 30 days`}>
              {idle.map((a) => `${a.assetNumber} (${integer(a.hoursLast30 ?? 0)} hr)`).join(', ')}. Ownership cost
              is spread over the hours a machine runs, so at this rate the cost per operating hour climbs above
              the catalog rate the work was priced at — worth a rent-versus-own review.
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Utilization against the estimating rate</CardTitle>
              <CardDescription>
                Ownership cost per operating hour, compared with the hourly rate the catalog prices this class at.
                A machine costing more per hour than it bills is losing money on every job it goes to.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="min-w-36">Utilization</TableHead>
                    <TableHead className="text-right">Meter</TableHead>
                    <TableHead className="text-right">Acquisition</TableHead>
                    <TableHead className="text-right">Cost / hour</TableHead>
                    <TableHead className="text-right">Catalog rate</TableHead>
                    <TableHead className="text-right">Spread</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ASSETS.filter((a) => (a.acquisitionCost ?? 0) > 0 && a.equipmentCode).map((a) => {
                    /*
                      * The rate this machine bills at, from the equipment
                      * library by RULE-003 — not from `EQUIPMENT_SPECS`, which
                      * is eight demo machines with invented rates. Real
                      * equipment codes never appeared in that constant, so the
                      * lookup fell through to zero and this "spread" was the
                      * ownership cost with a minus sign in front of it.
                      */
                    const billingRate = a.hourlyRate;
                    // Straight-line ownership cost per hour run to date. The filter
                    // above guarantees an acquisition cost, so the fallback never runs.
                    const costPerHour = (a.acquisitionCost ?? 0) / Math.max(a.currentHours, 1);
                    const spread = billingRate === null ? null : billingRate - costPerHour;
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{a.assetNumber}</p>
                          <p className="text-xs text-charcoal-500">{a.name}</p>
                        </TableCell>
                        <TableCell>
                          <Progress value={Math.min(((a.hoursLast30 ?? 0) / 200) * 100, 100)}
                            indicatorClassName={(a.hoursLast30 ?? 0) < LOW_HOURS_30D ? 'bg-danger-500' : 'bg-success-600'} />
                          <p className="tabular mt-1 text-xs text-charcoal-500">
                            {integer(a.hoursLast30 ?? 0)} hr in 30 days
                          </p>
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{integer(a.currentHours)} h</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{moneyCompact(a.acquisitionCost)}</TableCell>
                        <TableCell className="tabular text-right">{money(costPerHour)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {billingRate === null
                            ? <span className="text-warn-700">No rate yet</span>
                            : money(billingRate)}
                        </TableCell>
                        {/*
                          * No rate, no spread. Subtracting an ownership cost
                          * from a zero and calling the answer a spread is how a
                          * machine nobody has priced reads as the worst asset
                          * in the fleet.
                          */}
                        <TableCell className={cn('tabular text-right font-medium',
                          spread === null ? 'text-charcoal-300'
                            : spread >= 0 ? 'text-success-700' : 'text-danger-700')}>
                          {spread === null
                            ? '—'
                            : `${spread >= 0 ? '+' : '−'}${money(Math.abs(spread))}`}
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

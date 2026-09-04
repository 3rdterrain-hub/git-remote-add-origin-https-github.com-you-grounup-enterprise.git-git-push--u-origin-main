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
import { ASSETS, MAINTENANCE_DUE, WORK_ORDERS, FUEL_TRANSACTIONS } from '@/data/fleet';
import { EQUIPMENT_SPECS } from '@/data/catalog';
import { money, moneyCompact, percent, qty, integer, dateTime, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, 'success' | 'info' | 'warn' | 'danger'> = {
  available: 'success', assigned: 'info', in_maintenance: 'warn', down: 'danger',
};

export function FleetPage() {
  const active = ASSETS.filter((a) => a.status !== 'down');
  const down = ASSETS.filter((a) => a.status === 'down');
  const overdue = MAINTENANCE_DUE.filter((m) => m.hoursRemaining < 0);
  const dueSoon = MAINTENANCE_DUE.filter((m) => m.hoursRemaining >= 0 && m.hoursRemaining <= 50);
  const openWo = WORK_ORDERS.filter((w) => !['complete', 'canceled'].includes(w.status));
  const fuelGallons = FUEL_TRANSACTIONS.reduce((a, f) => a + f.gallons, 0);
  const fuelCost = FUEL_TRANSACTIONS.reduce((a, f) => a + f.gallons * f.pricePerGallon, 0);
  const fuelExceptions = FUEL_TRANSACTIONS.filter((f) => f.exception);
  const avgUtilization = ASSETS.reduce((a, x) => a + x.utilization30d, 0) / ASSETS.length;
  const ownedValue = ASSETS.reduce((a, x) => a + x.acquisitionCost, 0);

  // Utilization below this is the threshold at which owning is hard to justify.
  const UNDER_UTILISED = 0.35;
  const idle = ASSETS.filter((a) => a.utilization30d < UNDER_UTILISED && a.acquisitionCost > 0);

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

      {overdue.length ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${plural(overdue.length, 'machine')} past ${overdue.length === 1 ? 'its' : 'their'} service interval`}>
          {overdue.map((m) => `${m.assetNumber} (${Math.abs(m.hoursRemaining)}h over)`).join(', ')}. Running past a
          service interval is how a $1,200 oil change becomes a $28,000 engine.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Fleet size" value={ASSETS.length} icon={<Truck className="size-4" />}
          hint={`${active.length} available or assigned`} />
        <StatTile label="Average utilization" value={percent(avgUtilization, 0)}
          tone={avgUtilization >= 0.6 ? 'success' : 'warn'} icon={<Gauge className="size-4" />}
          hint="operating hours ÷ available, last 30 days" />
        <StatTile label="Down or in shop" value={down.length + ASSETS.filter((a) => a.status === 'in_maintenance').length}
          tone={down.length ? 'danger' : 'warn'} icon={<Wrench className="size-4" />}
          hint={`${plural(openWo.length, 'open work order')}`} />
        <StatTile label="Fuel this week" value={`${integer(fuelGallons)} gal`} icon={<Fuel className="size-4" />}
          hint={`${money(fuelCost)} · ${fuelExceptions.length} exception(s)`} />
        <StatTile label="Owned fleet value" value={moneyCompact(ownedValue)} icon={<CircleDollarSign className="size-4" />}
          hint="at acquisition cost" />
      </div>

      <Tabs defaultValue="assets">
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
                {ASSETS.map((a) => (
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
                      <Progress value={a.utilization30d * 100}
                        indicatorClassName={a.utilization30d < UNDER_UTILISED ? 'bg-danger-500' : a.utilization30d < 0.6 ? 'bg-warn-600' : 'bg-success-600'} />
                      <p className="tabular mt-1 text-xs text-charcoal-500">{percent(a.utilization30d, 0)}</p>
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
                    const used = m.currentHours - m.lastPerformedHours;
                    const pct = Math.min((used / m.intervalHours) * 100, 100);
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{m.assetNumber}</p>
                          <p className="text-xs text-charcoal-500">{m.assetName}</p>
                        </TableCell>
                        <TableCell className="text-charcoal-600">{m.scheduleName}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{m.intervalHours} h</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{integer(m.lastPerformedHours)}</TableCell>
                        <TableCell className="tabular text-right">{integer(m.currentHours)}</TableCell>
                        <TableCell className={cn('tabular text-right font-semibold',
                          m.hoursRemaining < 0 ? 'text-danger-700' : m.hoursRemaining <= 50 ? 'text-warn-700' : 'text-success-700')}>
                          {m.hoursRemaining < 0 ? `${Math.abs(m.hoursRemaining)} over` : `${m.hoursRemaining} h`}
                        </TableCell>
                        <TableCell>
                          <Progress value={pct}
                            indicatorClassName={m.hoursRemaining < 0 ? 'bg-danger-500' : m.hoursRemaining <= 50 ? 'bg-warn-600' : 'bg-success-600'} />
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
              title={`${plural(idle.length, 'owned machine')} under ${percent(UNDER_UTILISED, 0)} utilization`}>
              {idle.map((a) => `${a.assetNumber} (${percent(a.utilization30d, 0)})`).join(', ')}. At this rate the
              ownership cost per operating hour exceeds the rental rate — worth a rent-versus-own review.
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
                  {ASSETS.filter((a) => a.acquisitionCost > 0 && a.equipmentCode).map((a) => {
                    const catalogRate = EQUIPMENT_SPECS[a.equipmentCode as keyof typeof EQUIPMENT_SPECS]?.hourlyRate ?? 0;
                    // Straight-line ownership cost per hour run to date.
                    const costPerHour = a.acquisitionCost / Math.max(a.currentHours, 1);
                    const spread = catalogRate - costPerHour;
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{a.assetNumber}</p>
                          <p className="text-xs text-charcoal-500">{a.name}</p>
                        </TableCell>
                        <TableCell>
                          <Progress value={a.utilization30d * 100}
                            indicatorClassName={a.utilization30d < UNDER_UTILISED ? 'bg-danger-500' : 'bg-success-600'} />
                          <p className="tabular mt-1 text-xs text-charcoal-500">{percent(a.utilization30d, 0)}</p>
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{integer(a.currentHours)} h</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{moneyCompact(a.acquisitionCost)}</TableCell>
                        <TableCell className="tabular text-right">{money(costPerHour)}</TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">{money(catalogRate)}</TableCell>
                        <TableCell className={cn('tabular text-right font-medium', spread >= 0 ? 'text-success-700' : 'text-danger-700')}>
                          {spread >= 0 ? '+' : '−'}{money(Math.abs(spread))}
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

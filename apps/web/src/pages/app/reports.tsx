import { BarChart3, TrendingUp, Gauge, Fuel, Users2, Download } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress, Separator } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ESTIMATE } from '@/data/demo';
import { PROJECTS, OPPORTUNITIES } from '@/data/operations';
import { money, moneyCompact, percent, integer, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ReportsPage() {
  // Discipline rollup computed from the live engine result, not tabulated by hand.
  const byDiscipline = Object.entries(
    ESTIMATE.lines.reduce<Record<string, { cost: number; hours: number; days: number; lines: number }>>((acc, l) => {
      const key = l.discipline ?? 'Other';
      const entry = (acc[key] ??= { cost: 0, hours: 0, days: 0, lines: 0 });
      entry.cost += l.totalDirectCost;
      entry.hours += l.laborHours;
      entry.days += l.duration?.practicalDays ?? 0;
      entry.lines += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1].cost - a[1].cost);

  const maxCost = Math.max(...byDiscipline.map(([, v]) => v.cost), 1);

  const equipmentHours = ESTIMATE.lines.flatMap((l) => l.equipment?.lines ?? []);
  const byMachine = Object.entries(
    equipmentHours.reduce<Record<string, { hours: number; cost: number; fuel: number }>>((acc, e) => {
      const entry = (acc[e.name] ??= { hours: 0, cost: 0, fuel: 0 });
      entry.hours += e.operatingHours;
      entry.cost += e.ownershipCost;
      entry.fuel += e.fuelGallons;
      return acc;
    }, {}),
  ).sort((a, b) => b[1].hours - a[1].hours);

  const pipeline = OPPORTUNITIES.filter((o) => !['won', 'lost'].includes(o.stage));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description="Every figure below is derived from the same governed records the estimate and the job cost are built on. Nothing is re-keyed, so the report and the estimate cannot disagree."
        actions={<Button variant="outline"><Download className="size-4" /> Export</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Estimated direct cost" value={moneyCompact(ESTIMATE.totalDirectCost)} icon={<BarChart3 className="size-4" />}
          hint={`${ESTIMATE.lines.length} lines across ${byDiscipline.length} disciplines`} />
        <StatTile label="Labor hours" value={integer(ESTIMATE.totalLaborHours)} icon={<Users2 className="size-4" />}
          hint={`${integer(ESTIMATE.totalEquipmentHours)} equipment hours`} />
        <StatTile label="Fuel forecast" value={`${integer(ESTIMATE.totalFuelGallons)} gal`} icon={<Fuel className="size-4" />}
          hint="operating hours × machine burn rate" />
        <StatTile label="Weighted pipeline" value={moneyCompact(pipeline.reduce((a, o) => a + o.value * o.probability, 0))}
          icon={<TrendingUp className="size-4" />} hint={`${pipeline.length} live opportunities`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost by discipline</CardTitle>
            <CardDescription>{ESTIMATE.number} — where the money actually is.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {byDiscipline.map(([name, v]) => (
              <div key={name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-charcoal-900">{name}</span>
                  <span className="tabular text-sm text-charcoal-700">
                    {money(v.cost)} <span className="text-xs text-charcoal-400">{percent(v.cost / ESTIMATE.totalDirectCost, 1)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-charcoal-100">
                  <div className="h-full rounded-full bg-charcoal-800" style={{ width: `${(v.cost / maxCost) * 100}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-charcoal-500">
                  {v.lines} lines · {integer(v.hours)} labor hr · {qty(v.days, 1)} crew-days
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipment utilization</CardTitle>
            <CardDescription>Operating hours and fuel by machine, derived from production duration.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Ownership</TableHead>
                  <TableHead className="text-right">Fuel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMachine.map(([name, v]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium text-charcoal-900">{name}</TableCell>
                    <TableCell className="tabular text-right">{qty(v.hours, 0)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(v.cost)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{qty(v.fuel, 0)} gal</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-charcoal-50">
                  <TableCell>Total</TableCell>
                  <TableCell className="tabular text-right">{integer(ESTIMATE.totalEquipmentHours)}</TableCell>
                  <TableCell className="tabular text-right">{money(ESTIMATE.directCost.equipmentOwnership)}</TableCell>
                  <TableCell className="tabular text-right">{integer(ESTIMATE.totalFuelGallons)} gal</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Project cost performance</CardTitle>
          <CardDescription>
            Budget consumed for the work actually performed. A project spending faster than it is
            progressing is fading, whether or not it is still under total budget.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="min-w-40">Complete</TableHead>
                <TableHead className="text-right">Budget to date</TableHead>
                <TableHead className="text-right">Actual cost</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Cost performance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PROJECTS.filter((p) => p.percentComplete > 0).map((p) => {
                const budgetToDate = p.budget * p.percentComplete;
                const v = budgetToDate - p.actualCost;
                // CPI > 1 means earning more value than it is costing.
                const cpi = p.actualCost ? budgetToDate / p.actualCost : 1;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{p.number}</p>
                      <p className="max-w-64 truncate text-xs text-charcoal-500">{p.name}</p>
                    </TableCell>
                    <TableCell>
                      <Progress value={p.percentComplete * 100} indicatorClassName={cpi < 1 ? 'bg-danger-500' : 'bg-success-600'} />
                      <p className="tabular mt-1 text-xs text-charcoal-500">{percent(p.percentComplete, 0)}</p>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(budgetToDate)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(p.actualCost)}</TableCell>
                    <TableCell className={cn('tabular text-right font-medium', v < 0 ? 'text-danger-700' : 'text-success-700')}>
                      {v < 0 ? '−' : '+'}{money(Math.abs(v))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={cpi >= 1 ? 'success' : cpi >= 0.95 ? 'warn' : 'danger'}>
                        CPI {cpi.toFixed(2)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Estimating quality</CardTitle>
            <CardDescription>Confidence distribution across the active estimate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['Verified (95+)', ESTIMATE.lines.filter((l) => l.confidence.score >= 95).length, 'bg-success-600'],
              ['Strong (90–94)', ESTIMATE.lines.filter((l) => l.confidence.score >= 90 && l.confidence.score < 95).length, 'bg-info-600'],
              ['Reliable (80–89)', ESTIMATE.lines.filter((l) => l.confidence.score >= 80 && l.confidence.score < 90).length, 'bg-warn-600'],
              ['Assumption (70–79)', ESTIMATE.lines.filter((l) => l.confidence.score >= 70 && l.confidence.score < 80).length, 'bg-warn-700'],
              ['Uncertain (under 70)', ESTIMATE.lines.filter((l) => l.confidence.score < 70).length, 'bg-danger-500'],
            ].map(([label, count, color]) => (
              <div key={String(label)}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-charcoal-600">{label}</span>
                  <span className="tabular font-medium text-charcoal-900">{count as number} lines</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-charcoal-100">
                  <div className={cn('h-full rounded-full', color as string)}
                    style={{ width: `${((count as number) / ESTIMATE.lines.length) * 100}%` }} />
                </div>
              </div>
            ))}
            <Separator />
            <p className="text-xs leading-relaxed text-charcoal-500">
              Weighted confidence is {ESTIMATE.weightedConfidence}, computed by cost rather than by line
              count — a low-confidence item worth $2,000 should not drag the estimate down, and one
              worth $800,000 absolutely should.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline forecast</CardTitle>
            <CardDescription>Open opportunities by stage, weighted by probability.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opportunity</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Prob.</TableHead>
                  <TableHead className="text-right">Weighted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipeline.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="max-w-56">
                      <p className="truncate font-medium text-charcoal-900">{o.name}</p>
                      <p className="text-xs text-charcoal-500">{o.customerName}</p>
                    </TableCell>
                    <TableCell className="tabular text-right">{moneyCompact(o.value)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{percent(o.probability, 0)}</TableCell>
                    <TableCell className="tabular text-right font-medium">{moneyCompact(o.value * o.probability)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-charcoal-50">
                  <TableCell>Total</TableCell>
                  <TableCell className="tabular text-right">{moneyCompact(pipeline.reduce((a, o) => a + o.value, 0))}</TableCell>
                  <TableCell />
                  <TableCell className="tabular text-right">{moneyCompact(pipeline.reduce((a, o) => a + o.value * o.probability, 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

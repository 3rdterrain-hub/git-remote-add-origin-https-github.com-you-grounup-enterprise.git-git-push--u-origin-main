import { HardHat, TrendingDown, TrendingUp, FileWarning, Plus, CircleDollarSign } from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress, Alert, Separator } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PROJECTS, CALIBRATIONS } from '@/data/operations';
import { money, moneyCompact, percent, date, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, 'default' | 'success' | 'warn' | 'info'> = {
  preconstruction: 'default', active: 'info', on_hold: 'warn',
  substantially_complete: 'success', closed: 'success', canceled: 'default',
};

export function ProjectsPage() {
  const active = PROJECTS.filter((p) => p.status === 'active');
  const contractValue = PROJECTS.reduce((a, p) => a + p.contractValue, 0);
  const earned = PROJECTS.reduce((a, p) => a + p.contractValue * p.percentComplete, 0);
  const actualCost = PROJECTS.reduce((a, p) => a + p.actualCost, 0);
  const budgetToDate = PROJECTS.reduce((a, p) => a + p.budget * p.percentComplete, 0);
  const variance = budgetToDate - actualCost;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects & Operations"
        description="Awarded estimates become projects without re-entry. The budget baseline traces back to the estimate line it was priced from, so a cost overrun can always be read against how it was bid."
        actions={<Button><Plus className="size-4" /> Create project</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Contract value" value={moneyCompact(contractValue)} icon={<HardHat className="size-4" />}
          hint={`${PROJECTS.length} projects, ${active.length} active`} />
        <StatTile label="Earned to date" value={moneyCompact(earned)} icon={<CircleDollarSign className="size-4" />}
          hint={`${percent(earned / contractValue, 0)} of contract value`} />
        <StatTile label="Cost variance" value={moneyCompact(Math.abs(variance))}
          tone={variance >= 0 ? 'success' : 'danger'}
          icon={variance >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          hint={variance >= 0 ? 'under budget for work performed' : 'over budget for work performed'} />
        <StatTile label="Open change orders" value={PROJECTS.reduce((a, p) => a + p.openChangeOrders, 0)}
          tone="warn" icon={<FileWarning className="size-4" />}
          hint={`${PROJECTS.reduce((a, p) => a + p.openRfis, 0)} open RFIs`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active and upcoming projects</CardTitle>
          <CardDescription>Cost spent against percent complete is the earliest reliable signal of margin fade.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-44">Progress</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual cost</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Team</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PROJECTS.map((p) => {
                const budgetToDate = p.budget * p.percentComplete;
                const v = budgetToDate - p.actualCost;
                const overrun = v < 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-72">
                      <p className="font-medium text-charcoal-900">{p.number}</p>
                      <p className="truncate text-xs text-charcoal-500">{p.name}</p>
                      <p className="text-xs text-charcoal-400">{p.customer}</p>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONE[p.status] ?? 'default'}>{titleCase(p.status)}</Badge></TableCell>
                    <TableCell>
                      <Progress value={p.percentComplete * 100} indicatorClassName={overrun ? 'bg-danger-500' : 'bg-success-600'} />
                      <p className="tabular mt-1 text-xs text-charcoal-500">
                        {percent(p.percentComplete, 0)} complete · {percent(p.actualCost / p.budget, 0)} spent
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">{money(p.contractValue)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(p.budget)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(p.actualCost)}</TableCell>
                    <TableCell className={cn('tabular text-right font-medium', overrun ? 'text-danger-700' : 'text-success-700')}>
                      {overrun ? '−' : '+'}{money(Math.abs(v))}
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-600">
                      <p>{p.pm}</p>
                      <p className="text-charcoal-400">{p.superintendent}</p>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>The learning loop</CardTitle>
            <CardDescription>
              Field production is measured against the rate the work was estimated at. When actuals
              diverge consistently under the same conditions, the platform proposes a revised catalog
              rate — as a candidate for human approval, never as a silent edit (RULE-008).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Production rate</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Proposed</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {CALIBRATIONS.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-64">
                      <p className="font-medium text-charcoal-900">{c.rateName}</p>
                      <p className="font-mono text-xs text-charcoal-400">{c.rateCode}</p>
                      <p className="mt-0.5 text-xs text-charcoal-500">{c.conditions}</p>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{c.currentRate}</TableCell>
                    <TableCell className="tabular text-right font-medium">{c.proposedRate}</TableCell>
                    <TableCell className={cn('tabular text-right font-medium', c.variancePercent < 0 ? 'text-danger-700' : 'text-success-700')}>
                      {percent(c.variancePercent, 1)}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{c.sampleSize} jobs</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline">Review</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Project detail — PRJ-2026-011</CardTitle>
            <CardDescription>Maumee Commerce Park — Phase 2 utilities</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Customer">Maumee Development Partners</Field>
              <Field label="Contract type">Unit price</Field>
              <Field label="Contract value">{money(1_482_000)}</Field>
              <Field label="Approved budget">{money(1_186_000)}</Field>
              <Field label="Planned start">{date('2026-05-04')}</Field>
              <Field label="Planned finish">{date('2026-10-16')}</Field>
            </dl>
            <Separator />
            <Alert tone="info">
              This project was awarded from <span className="font-medium">EST-2026-0171 version 4</span>.
              Every budgeted activity carries the estimate line it was priced from, so a variance can be
              traced to the specific production rate, crew and equipment assumption behind it.
            </Alert>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Open items</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal-600">Change orders</span>
                <Badge variant="warn">2 pending</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal-600">RFIs</span>
                <Badge variant="warn">3 open</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal-600">Daily reports this week</span>
                <Badge variant="success">5 of 5 submitted</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

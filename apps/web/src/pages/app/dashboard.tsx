import { Link } from 'react-router-dom';
import {
  Calculator, FileUp, HardHat, UserPlus, AlertTriangle, TrendingUp,
  Clock, Bot, ArrowRight, CircleDollarSign, Gauge, Users, Truck,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ESTIMATE, USER, HAUL, CUT_FILL } from '@/data/demo';
import { ACTIVITY, AI_FINDINGS, ESTIMATES, OPPORTUNITIES, PROJECTS, RFIS } from '@/data/operations';
import { money, moneyCompact, percent, integer, dateTime, relativeDays, qty, plural, titleCase } from '@/lib/format';
import { GateBadge, ConfidencePill } from '@/components/estimating';

export function DashboardPage() {
  const pipeline = OPPORTUNITIES
    .filter((o) => !['won', 'lost'].includes(o.stage))
    .reduce((a, o) => a + o.value, 0);
  const weighted = OPPORTUNITIES
    .filter((o) => !['won', 'lost'].includes(o.stage))
    .reduce((a, o) => a + o.value * o.probability, 0);
  const activeProjects = PROJECTS.filter((p) => p.status === 'active');
  const backlog = activeProjects.reduce((a, p) => a + p.contractValue - p.contractValue * p.percentComplete, 0);
  const pendingFindings = AI_FINDINGS.filter((f) => f.state === 'proposed');
  const openRfis = RFIS.filter((r) => r.status === 'open');

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good morning, ${USER.name.split(' ')[0]}`}
        description={
          `${plural(activeProjects.length, 'active project')}, ` +
          `${plural(OPPORTUNITIES.filter((o) => o.stage === 'estimating').length, 'estimate')} in progress, and ` +
          `${plural(openRfis.length, 'unanswered RFI')} holding up pricing.`
        }
        actions={
          <>
            <Button asChild variant="outline"><Link to="/app/plans"><FileUp className="size-4" /> Upload Plans</Link></Button>
            <Button asChild variant="outline"><Link to="/app/crm"><UserPlus className="size-4" /> Add Customer</Link></Button>
            <Button asChild variant="outline"><Link to="/app/projects"><HardHat className="size-4" /> Create Project</Link></Button>
            <Button asChild><Link to="/app/estimates"><Calculator className="size-4" /> New Estimate</Link></Button>
          </>
        }
      />

      {ESTIMATE.blockedFromIssue ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`${ESTIMATE.number} cannot be issued — ${titleCase(ESTIMATE.executiveDecision)}`}>
          {ESTIMATE.executiveDecisionReason}{' '}
          <Link to={`/app/estimates/${ESTIMATE.id}`} className="font-semibold underline underline-offset-2">
            Open the estimate
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open pipeline" value={moneyCompact(pipeline)} tone="neutral" icon={<TrendingUp className="size-4" />}
          hint={`${moneyCompact(weighted)} weighted by probability`} />
        <StatTile label="Estimates in progress" value={OPPORTUNITIES.filter((o) => o.stage === 'estimating').length} icon={<Calculator className="size-4" />}
          hint={`${ESTIMATES.filter((e) => e.blocked).length} blocked from issue`} />
        <StatTile label="Backlog remaining" value={moneyCompact(backlog)} icon={<HardHat className="size-4" />}
          hint={`across ${activeProjects.length} active projects`} />
        <StatTile label="AI findings awaiting review" value={pendingFindings.length} tone={pendingFindings.length ? 'warn' : 'success'}
          icon={<Bot className="size-4" />} hint="nothing enters an estimate unapproved" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ------------------------------------------------ active estimate */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Active estimate</CardTitle>
              <CardDescription>{ESTIMATE.number} · version {ESTIMATE.version} · {ESTIMATE.name}</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to={`/app/estimates/${ESTIMATE.id}`}>Open <ArrowRight className="size-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-4">
              <Metric label="Bid price" value={money(ESTIMATE.bidPrice)} />
              <Metric label="Direct cost" value={money(ESTIMATE.totalDirectCost)} />
              <Metric label="Gross margin" value={percent(ESTIMATE.price.grossMarginPercent)} />
              <Metric label="Confidence" value={`${ESTIMATE.weightedConfidence}`} sub={titleCase(ESTIMATE.confidenceBand)} />
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                Approval routing — {ESTIMATE.lines.length} lines
              </p>
              <div className="grid gap-2 sm:grid-cols-4">
                {(['auto_accept', 'estimator_review', 'senior_review', 'rfi_required'] as const).map((gate) => (
                  <div key={gate} className="rounded-md border border-charcoal-200 p-2.5">
                    <p className="tabular text-lg font-bold text-charcoal-900">{ESTIMATE.approvalSummary[gate].length}</p>
                    <GateBadge gate={gate} />
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Direct cost</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead>Gate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ESTIMATE.lines.slice(0, 6).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-72">
                      <p className="truncate font-medium text-charcoal-900">{l.description}</p>
                      <p className="text-xs text-charcoal-500">{l.discipline} · {l.id}</p>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-700">
                      {qty(l.quantity.adjusted, 0)} <span className="text-charcoal-400">{l.quantity.unit}</span>
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">{money(l.totalDirectCost)}</TableCell>
                    <TableCell className="text-right"><ConfidencePill score={l.confidence.score} /></TableCell>
                    <TableCell><GateBadge gate={l.approval.gate} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------- AI queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="size-4 text-yellow-600" /> AI review queue</CardTitle>
            <CardDescription>Agents draft and cite. A human decides.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingFindings.map((f) => (
              <div key={f.id} className="rounded-md border border-charcoal-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug text-charcoal-900">{f.title}</p>
                  <Badge variant={f.severity === 'critical' || f.severity === 'high' ? 'danger' : 'warn'} className="shrink-0">
                    {f.confidence}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-charcoal-500">{f.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {f.citations.slice(0, 2).map((c) => (
                    <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                  ))}
                  <span className="text-[10px] text-charcoal-400">{f.agent}</span>
                </div>
              </div>
            ))}
            <Button asChild variant="outline" className="w-full">
              <Link to="/app/plans">Review all findings <ArrowRight className="size-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* --------------------------------------------------- bids & tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="size-4" /> Bids due</CardTitle>
            <CardDescription>Sorted by deadline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...OPPORTUNITIES]
              .filter((o) => !['won', 'lost'].includes(o.stage))
              .sort((a, b) => a.bidDueAt.localeCompare(b.bidDueAt))
              .slice(0, 4)
              .map((o) => {
                const days = Math.round((new Date(o.bidDueAt).getTime() - Date.now()) / 86_400_000);
                return (
                  <div key={o.id} className="flex items-start justify-between gap-3 border-b border-charcoal-200 pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-charcoal-900">{o.name}</p>
                      <p className="text-xs text-charcoal-500">{o.customerName}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold text-charcoal-900">{moneyCompact(o.value)}</p>
                      <Badge variant={days <= 7 ? 'danger' : days <= 14 ? 'warn' : 'default'} className="mt-0.5">
                        {relativeDays(o.bidDueAt)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>

        {/* ------------------------------------------------- project health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Project health</CardTitle>
            <CardDescription>Cost spent against percent complete.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeProjects.map((p) => {
              const spent = p.actualCost / p.budget;
              // Burning budget faster than progress is the early signal of fade.
              const overrun = spent > p.percentComplete + 0.03;
              return (
                <div key={p.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium text-charcoal-900">{p.number}</p>
                    <p className={`tabular text-xs font-semibold ${overrun ? 'text-danger-700' : 'text-success-700'}`}>
                      {percent(spent, 0)} spent / {percent(p.percentComplete, 0)} complete
                    </p>
                  </div>
                  <Progress value={p.percentComplete * 100} className="mt-1.5"
                    indicatorClassName={overrun ? 'bg-danger-500' : 'bg-success-600'} />
                  <p className="mt-1 truncate text-xs text-charcoal-500">{p.name}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ---------------------------------------------- earthwork snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="size-4" /> Earthwork &amp; haul</CardTitle>
            <CardDescription>{ESTIMATE.number} cut/fill balance and fleet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Balance condition" value={<Badge variant={CUT_FILL.condition === 'balanced' ? 'success' : 'warn'}>{titleCase(CUT_FILL.condition)}</Badge>} />
            <Row label="Reusable cut" value={`${qty(CUT_FILL.reusableAsCompactedCcy, 0)} CCY`} />
            <Row label="Fill required" value={`${qty(CUT_FILL.fillCcy, 0)} CCY`} />
            <Row label="Export" value={`${qty(CUT_FILL.exportBcy, 0)} BCY / ${qty(CUT_FILL.exportLcy, 0)} LCY`} />
            <Separator />
            <Row label="Haul cycle" value={`${qty(HAUL.cycleMinutes, 1)} min`} />
            <Row label="Trucks required" value={`${HAUL.trucksRequired}`} />
            <Row label="Fleet balance" value={<Badge variant={HAUL.balance === 'balanced' ? 'success' : 'warn'}>{titleCase(HAUL.balance)}</Badge>} />
            <Row label="Haul + disposal" value={money(HAUL.truckingCost + HAUL.disposalCost)} />
          </CardContent>
        </Card>
      </div>

      {/* -------------------------------------------------------- activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Every governed change is recorded with who made it and what it replaced.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {ACTIVITY.map((a) => (
              <li key={a.id} className="flex gap-3 border-b border-charcoal-200 pb-3 last:border-0 last:pb-0">
                <span className={[
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  a.tone === 'success' ? 'bg-success-600' : a.tone === 'warn' ? 'bg-warn-600'
                    : a.tone === 'danger' ? 'bg-danger-500' : 'bg-charcoal-300',
                ].join(' ')} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-charcoal-900">
                    <span className="font-semibold">{a.actor}</span> · {a.action}
                  </p>
                  <p className="text-sm text-charcoal-500">{a.detail}</p>
                </div>
                <span className="shrink-0 text-xs text-charcoal-400">{dateTime(a.at)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Labor hours estimated" value={integer(ESTIMATE.totalLaborHours)} icon={<Users className="size-4" />}
          hint={`${integer(ESTIMATE.totalEquipmentHours)} equipment hours`} />
        <StatTile label="Fuel forecast" value={`${integer(ESTIMATE.totalFuelGallons)} gal`} icon={<CircleDollarSign className="size-4" />}
          hint="from operating hours and machine burn rates" />
        <StatTile label="Estimated duration" value={`${integer(ESTIMATE.totalDurationDays)} days`} icon={<Clock className="size-4" />}
          hint="crew-days across all lines, before overlap" />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className="tabular mt-1 text-xl font-bold text-charcoal-900">{value}</p>
      {sub ? <p className="text-xs text-charcoal-500">{sub}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-charcoal-500">{label}</span>
      <span className="tabular font-medium text-charcoal-900">{value}</span>
    </div>
  );
}

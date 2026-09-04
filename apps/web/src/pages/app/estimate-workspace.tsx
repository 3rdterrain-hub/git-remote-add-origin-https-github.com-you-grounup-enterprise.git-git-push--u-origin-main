import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight, ChevronDown, FileText, Send, Copy, AlertTriangle, Truck,
  Layers, Scale, ClipboardList, Ban, HelpCircle, Info, Wrench, Users2,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfidencePill, CostBreakdown, DecisionBadge, GateBadge } from '@/components/estimating';
import { ESTIMATE, CUT_FILL, HAUL, BID_RECONCILIATION } from '@/data/demo';
import { RFIS } from '@/data/operations';
import { money, percent, qty, integer, unitRate, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

export function EstimateWorkspacePage() {
  const e = ESTIMATE;

  // Discipline and machine rollups computed from the engine result, not
  // tabulated by hand.
  const byDiscipline = Object.entries(
    e.lines.reduce<Record<string, { cost: number; hours: number; days: number; lines: number }>>(
      (acc, l) => {
        const key = l.discipline ?? 'Other';
        const entry = (acc[key] ??= { cost: 0, hours: 0, days: 0, lines: 0 });
        entry.cost += l.totalDirectCost;
        entry.hours += l.laborHours;
        entry.days += l.duration?.practicalDays ?? 0;
        entry.lines += 1;
        return acc;
      }, {}),
  ).sort((a, b) => b[1].cost - a[1].cost);
  const maxDisciplineCost = Math.max(...byDiscipline.map(([, v]) => v.cost), 1);
  const byMachine = Object.entries(
    e.lines.flatMap((l) => l.equipment?.lines ?? []).reduce<
      Record<string, { hours: number; cost: number; fuel: number }>
    >((acc, eq) => {
      const entry = (acc[eq.name] ??= { hours: 0, cost: 0, fuel: 0 });
      entry.hours += eq.operatingHours;
      entry.cost += eq.ownershipCost;
      entry.fuel += eq.fuelGallons;
      return acc;
    }, {}),
  ).sort((a, b) => b[1].hours - a[1].hours);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<Link to="/app/estimates" className="hover:text-charcoal-900">Estimating</Link>}
        title={e.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{e.number} · version {e.version}</span>
            <Badge variant="warn">{titleCase(e.status)}</Badge>
            <DecisionBadge decision={e.executiveDecision} />
          </span>
        }
        actions={
          <>
            <Button variant="outline"><Copy className="size-4" /> New version</Button>
            <Button variant="outline"><FileText className="size-4" /> Proposal preview</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled={e.blockedFromIssue}><Send className="size-4" /> Issue estimate</Button>
                </span>
              </TooltipTrigger>
              {e.blockedFromIssue ? (
                <TooltipContent>{e.executiveDecisionReason}</TooltipContent>
              ) : null}
            </Tooltip>
          </>
        }
      />

      {e.blockedFromIssue ? (
        <Alert tone="danger" icon={<AlertTriangle className="size-4" />}
          title={`Blocked from issue — ${titleCase(e.executiveDecision)}`}>
          {e.executiveDecisionReason}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Bid price" value={money(e.bidPrice)} hint={`rounded up ${money(e.bidRoundingAdjustment)}`} />
        <StatTile label="Direct cost" value={money(e.totalDirectCost)} hint={`+ ${money(e.indirectCost)} indirect`} />
        <StatTile label="Gross margin" value={percent(e.price.grossMarginPercent)} tone="success"
          hint={`${percent(e.price.effectiveMarkupPercent)} markup on cost`} />
        <StatTile label="Weighted confidence" value={e.weightedConfidence}
          tone={e.weightedConfidence >= 90 ? 'success' : e.weightedConfidence >= 80 ? 'warn' : 'danger'}
          hint={titleCase(e.confidenceBand)} />
        <StatTile label="Contingency" value={percent(e.appliedContingency, 0)}
          tone={e.contingencySource === 'confidence_band' ? 'warn' : 'neutral'}
          hint={`from the ${e.contingencySource.replace(/_/g, ' ')}`} />
      </div>

      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">Scope &amp; lines</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="composition">Composition</TabsTrigger>
          <TabsTrigger value="earthwork">Earthwork &amp; haul</TabsTrigger>
          <TabsTrigger value="reconciliation">Bid reconciliation</TabsTrigger>
          <TabsTrigger value="governance">Assumptions &amp; RFIs</TabsTrigger>
          <TabsTrigger value="warnings">Engine notices ({e.warnings.length})</TabsTrigger>
        </TabsList>

        {/* ============================================================ lines */}
        <TabsContent value="lines" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Production</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Direct cost</TableHead>
                    <TableHead className="text-right">Conf.</TableHead>
                    <TableHead>Gate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.lines.map((l) => <LineRow key={l.id} line={l} />)}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={6}>Total direct cost</TableCell>
                    <TableCell className="tabular text-right">{money(e.totalDirectCost)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================== pricing */}
        <TabsContent value="pricing" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Direct cost by bucket</CardTitle>
                <CardDescription>RULE-001 — labor, burden, equipment, fuel, material, trucking and disposal stay separately visible. Nothing is blended into a rate.</CardDescription>
              </CardHeader>
              <CardContent>
                <CostBreakdown breakdown={e.directCost} total={e.totalDirectCost} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Indirect cost</CardTitle>
                <CardDescription>General conditions and project overhead, each with its calculation basis.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Item</TableHead><TableHead>Basis</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.indirectDetail.map((i) => (
                      <TableRow key={i.code}>
                        <TableCell className="font-medium text-charcoal-900">{i.label}</TableCell>
                        <TableCell className="text-xs text-charcoal-500">{i.basis}</TableCell>
                        <TableCell className="tabular text-right font-medium">{money(i.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="hover:bg-charcoal-50">
                      <TableCell colSpan={2}>Total indirect</TableCell>
                      <TableCell className="tabular text-right">{money(e.indirectCost)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Markup — {titleCase(e.price.method)} method</CardTitle>
              <CardDescription>
                RULE-007 requires the basis, the sequence and the dollar effect of every component to be
                visible. In the parallel method each component is calculated on the same cost basis;
                switching to stacked would compound them.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Seq</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Applied to</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Running total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-charcoal-50 hover:bg-charcoal-50">
                    <TableCell />
                    <TableCell className="font-medium text-charcoal-900">Adjusted cost basis</TableCell>
                    <TableCell className="text-xs text-charcoal-500">direct + indirect</TableCell>
                    <TableCell colSpan={3} />
                    <TableCell className="tabular text-right font-semibold">{money(e.price.adjustedCost)}</TableCell>
                  </TableRow>
                  {e.price.appliedMarkups.map((m) => (
                    <TableRow key={m.code}>
                      <TableCell className="tabular text-charcoal-400">{m.sequence}</TableCell>
                      <TableCell className="font-medium text-charcoal-900">{m.label}</TableCell>
                      <TableCell className="text-xs text-charcoal-500">{m.basis.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="tabular text-right">{percent(m.percent)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{money(m.appliedTo)}</TableCell>
                      <TableCell className="tabular text-right font-medium">{money(m.amount)}</TableCell>
                      <TableCell className="tabular text-right">{money(m.runningTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={5}>Total price</TableCell>
                    <TableCell className="tabular text-right">{money(e.price.totalMarkup)}</TableCell>
                    <TableCell className="tabular text-right">{money(e.price.totalPrice)}</TableCell>
                  </TableRow>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell colSpan={6}>Bid price, rounded up to the nearest $500</TableCell>
                    <TableCell className="tabular text-right">{money(e.bidPrice)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          {e.contingencySource === 'confidence_band' ? (
            <Alert tone="warn" icon={<Info className="size-4" />}
              title={`Contingency raised to ${percent(e.appliedContingency, 0)} by the confidence band`}>
              A weighted confidence of {e.weightedConfidence} justifies {percent(e.recommendedContingency, 0)} contingency
              under Section 7.2. The pricing profile carries less, so the higher figure was applied — the
              engine will not price an uncertain estimate as though it were a certain one.
            </Alert>
          ) : null}
        </TabsContent>

        {/* ======================================================= earthwork */}
        <TabsContent value="earthwork" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Scale className="size-4" /> Cut / fill balance</CardTitle>
                <CardDescription>
                  Cut is bank, fill is compacted. The engine converts before it compares — comparing raw
                  cut to raw fill is the single most common earthwork error.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-4">
                  <Field label="Total cut">{qty(CUT_FILL.cutBcy, 0)} BCY</Field>
                  <Field label="Unsuitable">{qty(CUT_FILL.unsuitableBcy, 0)} BCY</Field>
                  <Field label="Reusable cut">{qty(CUT_FILL.reusableCutBcy, 0)} BCY</Field>
                  <Field label="Makes compacted">{qty(CUT_FILL.reusableAsCompactedCcy, 0)} CCY</Field>
                  <Field label="Fill required">{qty(CUT_FILL.fillCcy, 0)} CCY</Field>
                  <Field label="Condition">
                    <Badge variant={CUT_FILL.condition === 'balanced' ? 'success' : 'warn'}>
                      {titleCase(CUT_FILL.condition)}
                    </Badge>
                  </Field>
                  <Field label="Export">{qty(CUT_FILL.exportBcy, 0)} BCY</Field>
                  <Field label="To truck">{qty(CUT_FILL.exportLcy, 0)} LCY</Field>
                </dl>
                <Separator />
                <p className="rounded-md bg-charcoal-50 p-3 font-mono text-[11px] leading-relaxed text-charcoal-600">
                  {CUT_FILL.derivation}
                </p>
                {CUT_FILL.warnings.map((w) => (
                  <Alert key={w} tone="warn" icon={<AlertTriangle className="size-4" />}>{w}</Alert>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Truck className="size-4" /> Haul cycle</CardTitle>
                <CardDescription>
                  RULE-004 — cycle-based hauling is authoritative. The fleet is sized against loader
                  production, and the imbalance is costed in whichever direction it falls.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    ['Load', HAUL.loadMinutes], ['Haul', HAUL.haulMinutes], ['Dump', HAUL.dumpMinutes],
                    ['Return', HAUL.returnMinutes], ['Delay', HAUL.delayMinutes],
                  ].map(([label, mins]) => (
                    <div key={String(label)} className="rounded-md bg-charcoal-50 p-2 text-center">
                      <p className="text-[10px] font-semibold uppercase text-charcoal-500">{label}</p>
                      <p className="tabular text-sm font-bold text-charcoal-900">{qty(Number(mins), 1)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-center text-xs text-charcoal-500">
                  Total cycle <span className="tabular font-semibold text-charcoal-900">{qty(HAUL.cycleMinutes, 2)} min</span>
                </p>
                <Separator />
                <dl className="grid grid-cols-2 gap-4">
                  <Field label="Per truck">{qty(HAUL.productionPerTruckPerHour, 1)} LCY/hr</Field>
                  <Field label="Loads">{integer(HAUL.wholeLoads)}</Field>
                  <Field label="To balance loader">{qty(HAUL.trucksToBalanceLoader, 2)} trucks</Field>
                  <Field label="Fleet used">{HAUL.trucksUsed} trucks</Field>
                  <Field label="Truck hours">{qty(HAUL.totalTruckHours, 0)}</Field>
                  <Field label="Cost per LCY">{unitRate(HAUL.costPerUnit)}</Field>
                </dl>
                <Alert tone={HAUL.balance === 'balanced' ? 'success' : 'warn'} title={titleCase(HAUL.balance)}>
                  {HAUL.balanceNote}
                </Alert>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================================================== reconciliation */}
        <TabsContent value="reconciliation">
          <Card>
            <CardHeader>
              <CardTitle>Bid quantity reconciliation</CardTitle>
              <CardDescription>
                Section 24 — the independent takeoff is compared against the owner's bid quantity.
                A quantity is never changed simply to match the bid schedule.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bid item</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Owner quantity</TableHead>
                    <TableHead className="text-right">GrounUp takeoff</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="min-w-72">Recommendation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BID_RECONCILIATION.map((r) => (
                    <TableRow key={r.bidItem}>
                      <TableCell className="font-medium text-charcoal-900">{r.bidItem}</TableCell>
                      <TableCell className="text-charcoal-500">{r.unit}</TableCell>
                      <TableCell className="tabular text-right">{qty(r.ownerQuantity, 0)}</TableCell>
                      <TableCell className="tabular text-right">{qty(r.calculatedQuantity, 0)}</TableCell>
                      <TableCell className={cn('tabular text-right font-medium',
                        r.severity === 'material' ? 'text-danger-700' : r.severity === 'review' ? 'text-warn-700' : 'text-charcoal-600')}>
                        {r.variance > 0 ? '+' : ''}{qty(r.variance, 0)} ({percent(r.variancePercent, 1)})
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.severity === 'material' ? 'danger' : r.severity === 'review' ? 'warn' : 'success'}>
                          {titleCase(r.severity)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs leading-relaxed text-charcoal-500">{r.recommendation}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ====================================================== governance */}
        <TabsContent value="governance" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ClipboardList className="size-4" /> Assumption register</CardTitle>
                <CardDescription>No hidden assumptions — each one is recorded on the line it affects and disclosed on the proposal.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {e.lines.flatMap((l) => l.assumptions.map((a) => ({ line: l.id, desc: l.description, a })))
                  .map((x, i) => (
                    <div key={i} className="rounded-md border border-charcoal-200 p-3">
                      <p className="text-sm text-charcoal-900">{x.a}</p>
                      <p className="mt-1 text-xs text-charcoal-500">{x.line} · {x.desc}</p>
                    </div>
                  ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><HelpCircle className="size-4" /> Open RFIs</CardTitle>
                <CardDescription>An item the documents cannot resolve routes to an RFI, not to a guess.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {RFIS.map((r) => (
                  <div key={r.id} className="rounded-md border border-charcoal-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-charcoal-900">{r.number} — {r.title}</p>
                      <Badge variant={r.status === 'open' ? (r.priority === 'critical' ? 'danger' : 'warn') : 'success'}>
                        {titleCase(r.status)}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-charcoal-600">{r.question}</p>
                    <p className="mt-1.5 text-xs font-medium text-danger-700">{r.costImpact}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Ban className="size-4" /> Exclusions</CardTitle>
              <CardDescription>
                Section 49 — nothing is excluded merely because it is inconvenient to estimate.
                Each exclusion carries its reason.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {[
                  ['Dewatering beyond routine sump pumping', 'Extent depends on RFI-004 and the undercut limits.'],
                  ['Rock excavation', 'No rock is indicated in the geotechnical borings.'],
                  ['Permit fees and impact fees', 'By owner, per Division 01 of the project manual.'],
                  ['Contaminated soil handling or disposal', 'No environmental assessment was provided with the bid documents.'],
                  ['Winter protection and heating', 'Schedule shows completion before 1 December.'],
                ].map(([item, reason]) => (
                  <li key={item} className="flex gap-3 border-b border-charcoal-200 pb-2 last:border-0">
                    <Ban className="mt-0.5 size-4 shrink-0 text-charcoal-400" />
                    <div>
                      <p className="font-medium text-charcoal-900">{item}</p>
                      <p className="text-xs text-charcoal-500">{reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================================================== warnings */}
        <TabsContent value="warnings">
          <Card>
            <CardHeader>
              <CardTitle>Engine notices</CardTitle>
              <CardDescription>
                Raised by the calculation itself. These are not suppressed or rolled up — an estimator
                should see every place the engine was not fully satisfied.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {e.warnings.length === 0 ? (
                <Alert tone="success">The engine raised no notices on this estimate.</Alert>
              ) : (
                e.warnings.map((w, i) => (
                  <Alert key={i} tone="warn" icon={<AlertTriangle className="size-4" />}>{w}</Alert>
                ))
              )}
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Per line</p>
                {e.lines.filter((l) => l.warnings.length > 0).map((l) => (
                  <div key={l.id} className="rounded-md border border-charcoal-200 p-3">
                    <p className="text-sm font-medium text-charcoal-900">{l.id} — {l.description}</p>
                    <ul className="mt-1.5 space-y-1">
                      {l.warnings.map((w, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed text-charcoal-600">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-warn-600" />{w}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {/*
          * Where this estimate's money is, by discipline and by machine.
          *
          * These two views used to sit on the company Reports page, computing
          * from one demonstration estimate while eleven governed reporting
          * views went unread. They describe an estimate rather than a company,
          * so they belong here — and Reports now reads the semantic layer.
          */}
        <TabsContent value="composition" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cost by discipline</CardTitle>
                <CardDescription>{e.number} — where the money actually is.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {byDiscipline.map(([name, v]) => (
                  <div key={name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-charcoal-900">{name}</span>
                      <span className="tabular text-sm text-charcoal-700">
                        {money(v.cost)}{' '}
                        <span className="text-xs text-charcoal-400">
                          {percent(v.cost / e.totalDirectCost, 1)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-charcoal-100">
                      <div className="h-full rounded-full bg-charcoal-800"
                        style={{ width: `${(v.cost / maxDisciplineCost) * 100}%` }} />
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
                <CardDescription>
                  Operating hours and fuel by machine, derived from production duration.
                </CardDescription>
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
                      <TableCell className="tabular text-right">{integer(e.totalEquipmentHours)}</TableCell>
                      <TableCell className="tabular text-right">{money(e.directCost.equipmentOwnership)}</TableCell>
                      <TableCell className="tabular text-right">{integer(e.totalFuelGallons)} gal</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ----------------------------------------------------------------- line row */

function LineRow({ line }: { line: (typeof ESTIMATE)['lines'][number] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow className={cn(open && 'bg-charcoal-50')}>
        <TableCell className="pr-0">
          <button onClick={() => setOpen((v) => !v)} className="rounded p-1 text-charcoal-400 hover:bg-charcoal-200 hover:text-charcoal-900"
            aria-label={open ? 'Collapse line detail' : 'Expand line detail'} aria-expanded={open}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </TableCell>
        <TableCell className="max-w-80">
          <p className="truncate font-medium text-charcoal-900">{line.description}</p>
          <p className="text-xs text-charcoal-500">
            {line.id} · {line.discipline}
            {line.modifiers.applied.length ? ` · ${line.modifiers.applied.length} modifier(s)` : ''}
          </p>
        </TableCell>
        <TableCell className="tabular whitespace-nowrap text-right">
          {qty(line.quantity.adjusted, 0)} <span className="text-charcoal-400">{line.quantity.unit}</span>
        </TableCell>
        <TableCell className="tabular whitespace-nowrap text-right text-charcoal-600">
          {line.production ? `${qty(line.production.recommendedPerHour, 1)}/hr` : '—'}
        </TableCell>
        <TableCell className="tabular text-right text-charcoal-600">
          {line.duration ? qty(line.duration.practicalDays, 1) : '—'}
        </TableCell>
        <TableCell className="tabular text-right text-charcoal-600">{unitRate(line.unitCost)}</TableCell>
        <TableCell className="tabular text-right font-semibold">{money(line.totalDirectCost)}</TableCell>
        <TableCell className="text-right"><ConfidencePill score={line.confidence.score} /></TableCell>
        <TableCell><GateBadge gate={line.approval.gate} /></TableCell>
      </TableRow>

      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={9} className="bg-charcoal-50 p-0">
            <div className="grid gap-5 p-5 lg:grid-cols-3">
              {/* --------------------------------------------- cost & resources */}
              <div className="space-y-4">
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                    <Layers className="size-3.5" /> Direct cost
                  </h4>
                  <CostBreakdown breakdown={line.directCost} total={line.totalDirectCost} />
                </section>

                {line.crew ? (
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      <Users2 className="size-3.5" /> Crew — {line.crew.crewName}
                    </h4>
                    <div className="space-y-1 text-xs">
                      {line.crew.lines.map((c) => (
                        <div key={c.classificationId} className="flex justify-between gap-2">
                          <span className="text-charcoal-600">{c.count} × {c.classification}</span>
                          <span className="tabular text-charcoal-900">{qty(c.totalHours, 0)} hr · {money(c.totalCost)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {line.equipment ? (
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                      <Wrench className="size-3.5" /> Equipment
                    </h4>
                    <div className="space-y-1 text-xs">
                      {line.equipment.lines.map((eq) => (
                        <div key={eq.equipmentId} className="flex justify-between gap-2">
                          <span className="text-charcoal-600">
                            {eq.count} × {eq.name}
                            <Badge variant="outline" className="ml-1.5 text-[9px]">{eq.rateSource.replace(/_/g, ' ')}</Badge>
                          </span>
                          <span className="tabular text-charcoal-900">{qty(eq.operatingHours, 0)} hr · {money(eq.ownershipCost)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-2 border-t border-charcoal-200 pt-1 font-medium">
                        <span className="text-charcoal-600">Fuel</span>
                        <span className="tabular text-charcoal-900">{qty(line.equipment.fuelGallons, 0)} gal · {money(line.equipment.fuelCost)}</span>
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>

              {/* ------------------------------------------ quantity & production */}
              <div className="space-y-4">
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Quantity chain</h4>
                  <dl className="space-y-1.5 text-xs">
                    <DetailRow label="Measured" value={`${qty(line.quantity.measured, 2)} ${line.quantity.unit}`} />
                    {line.quantity.appliedAdjustments.map((a) => (
                      <DetailRow key={a.code} label={a.label} value={`${a.effect > 0 ? '+' : ''}${qty(a.effect, 2)}`} hint={a.reason} />
                    ))}
                    <DetailRow label="Adjusted (produced)" value={`${qty(line.quantity.adjusted, 2)} ${line.quantity.unit}`} strong />
                    {line.quantity.wasteQuantity ? (
                      <DetailRow label={`Waste ${percent(line.quantity.wastePercent, 0)}`} value={`+${qty(line.quantity.wasteQuantity, 2)}`} hint={line.quantity.sources.join(', ')} />
                    ) : null}
                    <DetailRow label="Gross (purchased)" value={`${qty(line.quantity.gross, 2)} ${line.quantity.unit}`} strong />
                    <DetailRow label="Method" value={titleCase(line.quantity.method)} />
                    <DetailRow label="Sources" value={line.quantity.sources.join(', ') || 'none recorded'} />
                  </dl>
                </section>

                {line.production ? (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Production (Section 25)</h4>
                    <dl className="space-y-1.5 text-xs">
                      <DetailRow label="Theoretical" value={`${qty(line.production.theoreticalPerHour, 2)} /hr`} />
                      <DetailRow label={`× ${qty(line.production.utilizationFactor, 2)} utilization`} value={`${qty(line.production.practicalPerHour, 2)} /hr practical`} />
                      <DetailRow label={`× ${qty(line.production.productionModifier, 3)} conditions`} value={`${qty(line.production.recommendedPerHour, 2)} /hr recommended`} strong />
                      <DetailRow label="Data source" value={titleCase(line.production.sourceType)} />
                      {line.duration ? (
                        <>
                          <DetailRow label="Productive hours" value={qty(line.duration.productiveHours, 1)} />
                          <DetailRow label="Practical days" value={`${qty(line.duration.practicalDays, 2)} (range ${qty(line.duration.rangeDays.low, 1)}–${qty(line.duration.rangeDays.high, 1)})`} />
                        </>
                      ) : null}
                    </dl>
                  </section>
                ) : null}

                {line.modifiers.applied.length ? (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Condition modifiers</h4>
                    <div className="space-y-2">
                      {line.modifiers.applied.map((m, i) => (
                        <div key={`${m.id}-${m.target}-${i}`} className="rounded-md border border-charcoal-200 bg-white p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-charcoal-900">{m.name}</span>
                            <Badge variant="outline" className="text-[10px]">{m.target.replace(/_/g, ' ')} × {m.factor}</Badge>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-charcoal-500">{m.justification}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>

              {/* ----------------------------------------------- governance */}
              <div className="space-y-4">
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Confidence</h4>
                  <div className="rounded-md border border-charcoal-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <ConfidencePill score={line.confidence.score} />
                      <span className="text-xs font-medium text-charcoal-700">{titleCase(line.confidence.band)}</span>
                      <Badge variant="outline" className="ml-auto text-[10px]">{titleCase(line.confidence.verificationStatus)}</Badge>
                    </div>
                    <ul className="mt-2.5 space-y-1">
                      {line.confidence.factors.map((f, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                          <span className="text-charcoal-500">{f.label}<span className="block text-charcoal-400">{f.detail}</span></span>
                          <span className={cn('tabular shrink-0 font-semibold', f.effect < 0 ? 'text-danger-700' : 'text-success-700')}>
                            {f.effect > 0 ? '+' : ''}{f.effect}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Approval routing</h4>
                  <div className="rounded-md border border-charcoal-200 bg-white p-3">
                    <GateBadge gate={line.approval.gate} />
                    <ul className="mt-2 space-y-1">
                      {line.approval.reasons.map((r, i) => (
                        <li key={i} className="text-[11px] leading-relaxed text-charcoal-600">· {r}</li>
                      ))}
                    </ul>
                    <p className="mt-2 border-t border-charcoal-200 pt-2 text-[11px] text-charcoal-500">
                      Required role: <span className="font-medium text-charcoal-900">{titleCase(line.approval.requiredRole)}</span>
                    </p>
                  </div>
                </section>

                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Full derivation</h4>
                  <div className="max-h-64 overflow-y-auto rounded-md bg-charcoal-900 p-3">
                    <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-charcoal-300">
                      {line.derivation.join('\n\n')}
                    </pre>
                  </div>
                </section>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function DetailRow({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-charcoal-500">
        {label}
        {hint ? <span className="block text-[10px] text-charcoal-400">{hint}</span> : null}
      </dt>
      <dd className={cn('tabular shrink-0 text-right', strong ? 'font-semibold text-charcoal-900' : 'text-charcoal-700')}>{value}</dd>
    </div>
  );
}

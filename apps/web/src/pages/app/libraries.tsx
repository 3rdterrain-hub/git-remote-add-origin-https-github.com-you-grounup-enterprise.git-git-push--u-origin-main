import { useState } from 'react';
import { Library, Search, Lock, Copy, ShieldCheck, Info } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LABOR, EQUIPMENT_SPECS, CREWS, PRODUCTION_RATES, MODIFIERS, PRICING_PROFILES } from '@/data/catalog';
import { loadedLaborRate, calculatePrice } from '@grounup/engine';
import { money, unitRate, percent, qty, titleCase } from '@/lib/format';

/** Counts shipped by the global seed, mirrored from the generated seed SQL. */
const SEED_COUNTS = {
  services: 188, tasks: 2783, assemblies: 188, productionRates: 1452,
  labor: 12, equipment: 17, modifiers: 20, profiles: 3, crews: 8,
};

export function LibrariesPage() {
  const [q, setQ] = useState('');
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Libraries"
        description="The catalog every estimate prices from. GrounUp ships it seeded so the first estimate is a workflow question rather than a data-entry project."
        actions={<Button variant="outline"><Copy className="size-4" /> Copy to company scope</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Services" value={SEED_COUNTS.services} icon={<Library className="size-4" />}
          hint="across 13 construction industries" />
        <StatTile label="Tasks" value={SEED_COUNTS.tasks.toLocaleString()} hint={`${SEED_COUNTS.assemblies} assemblies`} />
        <StatTile label="Production rates" value={SEED_COUNTS.productionRates.toLocaleString()}
          hint="seed benchmarks, replaceable with company actuals" />
        <StatTile label="Resources" value={SEED_COUNTS.labor + SEED_COUNTS.equipment + SEED_COUNTS.crews}
          hint={`${SEED_COUNTS.labor} labor, ${SEED_COUNTS.equipment} equipment, ${SEED_COUNTS.crews} crews`} />
      </div>

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="Three library scopes, one governed catalog">
        The <span className="font-medium">GrounUp global seed</span> is readable by every tenant and
        writable by none, so it stays a stable benchmark. An{' '}
        <span className="font-medium">enterprise group</span> can publish a corporate standard above it.
        Your <span className="font-medium">company scope</span> sits on top: copy any record, edit the
        copy, and GrounUp records who changed it, when, from what, and which estimates use which version.
      </Alert>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
        <Input className="pl-9" placeholder="Search the library…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Tabs defaultValue="labor">
        <TabsList>
          <TabsTrigger value="labor">Labor</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="crews">Crews</TabsTrigger>
          <TabsTrigger value="production">Production rates</TabsTrigger>
          <TabsTrigger value="modifiers">Condition modifiers</TabsTrigger>
          <TabsTrigger value="pricing">Pricing profiles</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- labor */}
        <TabsContent value="labor">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Classification</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Base wage</TableHead>
                  <TableHead className="text-right">Burden</TableHead>
                  <TableHead className="text-right">Loaded rate</TableHead>
                  <TableHead className="text-right">OT / DT</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.values(LABOR).filter((l) => match(`${l.classification} ${l.group}`)).map((l) => {
                  const loaded = loadedLaborRate(l);
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{l.classification}</p>
                        <p className="font-mono text-xs text-charcoal-400">{l.id}</p>
                      </TableCell>
                      <TableCell className="text-charcoal-600">{l.group}</TableCell>
                      <TableCell className="tabular text-right">{unitRate(l.baseWagePerHour)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {percent(l.burdenPercent, 0)}
                        <span className="ml-1 text-xs text-charcoal-400">({unitRate(loaded.burdenPerHour)})</span>
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">{unitRate(loaded.loadedPerHour)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {l.overtimeMultiplier}× / {l.doubletimeMultiplier}×
                      </TableCell>
                      <TableCell><ScopeBadge scope="global" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* ------------------------------------------------------- equipment */}
        <TabsContent value="equipment">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Hourly</TableHead>
                  <TableHead className="text-right">Fuel</TableHead>
                  <TableHead className="text-right">DEF</TableHead>
                  <TableHead className="text-right">Mobilization</TableHead>
                  <TableHead>Rate source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.values(EQUIPMENT_SPECS).filter((e) => match(`${e.name} ${e.equipmentClass}`)).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{e.name}</p>
                      <p className="font-mono text-xs text-charcoal-400">{e.id}</p>
                    </TableCell>
                    <TableCell className="text-charcoal-600">{e.equipmentClass}</TableCell>
                    <TableCell className="tabular text-right font-semibold">{unitRate(e.hourlyRate)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{e.fuelGallonsPerHour} gal/hr</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{percent(e.defPercentOfFuel, 0)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{money(e.mobilizationCost)}</TableCell>
                    <TableCell><Badge variant="info">Tenant approved</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
          <Alert tone="info" className="mt-4" icon={<Info className="size-4" />} title="RULE-003 — equipment rate hierarchy">
            A project quote beats an approved company rate, which beats a regional rate, which beats
            the GrounUp seed. The estimate records which source won, what it overrode, and the date it
            was effective — so reopening a historical estimate reprices against the rate that was
            actually in force, not today's.
          </Alert>
        </TabsContent>

        {/* ----------------------------------------------------------- crews */}
        <TabsContent value="crews">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Object.values(CREWS).filter((c) => match(c.name)).map((c) => {
              const headcount = c.members.reduce((a, m) => a + m.count, 0);
              const hourly = c.members.reduce((a, m) => a + loadedLaborRate(m.classification).loadedPerHour * m.count, 0);
              return (
                <Card key={c.id}>
                  <CardHeader>
                    <CardTitle className="text-sm">{c.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{c.id} · {headcount} workers · {c.shiftHours} hr shift</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {c.members.map((m) => (
                      <div key={m.classification.id} className="flex justify-between text-sm">
                        <span className="text-charcoal-600">{m.count} × {m.classification.classification}</span>
                        <span className="tabular text-charcoal-900">{unitRate(loadedLaborRate(m.classification).loadedPerHour)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-charcoal-200 pt-2 text-sm font-semibold">
                      <span>Crew cost per hour</span>
                      <span className="tabular">{unitRate(hourly)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ------------------------------------------------------ production */}
        <TabsContent value="production">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Theoretical</TableHead>
                  <TableHead className="text-right">Utilization</TableHead>
                  <TableHead className="text-right">Practical / shift</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.values(PRODUCTION_RATES).filter((r) => match(r.id)).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-charcoal-700">{r.id}</TableCell>
                    <TableCell className="tabular text-right">{qty(r.ratePerHour, 1)} {r.unit}/hr</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{percent(r.utilizationFactor, 0)}</TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {qty(r.ratePerHour * r.utilizationFactor * r.shiftHours, 0)} {r.unit}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.sourceType === 'company_actual' ? 'success' : r.sourceType === 'company_historical' ? 'info' : 'warn'}>
                        {titleCase(r.sourceType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{r.sampleSize || '—'}</TableCell>
                    <TableCell className="tabular text-right">{percent(r.confidence, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
          <Alert tone="warn" className="mt-4" icon={<Info className="size-4" />} title="RULE-010 — source confidence">
            Every rate that is not a company actual carries its source, its confidence and its review
            state. A seed benchmark is a starting point, not a company production standard, and the
            engine says so on every estimate that uses one.
          </Alert>
        </TabsContent>

        {/* ------------------------------------------------------- modifiers */}
        <TabsContent value="modifiers">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modifier</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Targets and factors</TableHead>
                  <TableHead className="min-w-72">Application rule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.values(MODIFIERS).filter((m) => match(m.name)).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{m.name}</p>
                      <p className="font-mono text-xs text-charcoal-400">{m.id}</p>
                    </TableCell>
                    <TableCell className="text-charcoal-600">{m.category}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(m.factors).map(([target, factor]) => (
                          <Badge key={target} variant={target === 'production' ? 'warn' : 'info'} className="text-[10px]">
                            {target.replace(/_/g, ' ')} × {factor}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-500">{m.applicationRule}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
          <Alert tone="info" className="mt-4" icon={<Info className="size-4" />} title="RULE-006 — modifiers apply only to their declared targets">
            A production factor multiplies the rate, so 0.75 means the crew produces 75% of base and
            the work takes longer. A cost factor multiplies that bucket, so 1.15 means it costs 15%
            more. Production impediments compound; independent cost causes add.
          </Alert>
        </TabsContent>

        {/* --------------------------------------------------------- pricing */}
        <TabsContent value="pricing">
          <div className="grid gap-4 lg:grid-cols-3">
            {Object.values(PRICING_PROFILES).map((p) => {
              // Priced live so the comparison is real, not illustrative.
              const example = calculatePrice(100_000, 0, p);
              return (
                <Card key={p.id}>
                  <CardHeader>
                    <CardTitle className="text-sm">{p.name}</CardTitle>
                    <CardDescription>
                      {titleCase(p.method)} method{p.regionalFactor && p.regionalFactor !== 1 ? ` · regional × ${p.regionalFactor}` : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {p.components.map((c) => (
                      <div key={c.code} className="flex justify-between text-sm">
                        <span className="text-charcoal-600">{c.label}</span>
                        <span className="tabular font-medium">{percent(c.percent, 1)}</span>
                      </div>
                    ))}
                    <div className="mt-3 rounded-md bg-charcoal-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">On {money(100_000)} of cost</p>
                      <p className="tabular mt-1 text-lg font-bold text-charcoal-900">{money(example.totalPrice)}</p>
                      <p className="text-xs text-charcoal-500">
                        {money(example.totalMarkup)} markup · {percent(example.grossMarginPercent)} gross margin
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScopeBadge({ scope }: { scope: 'global' | 'group' | 'company' }) {
  if (scope === 'global') {
    return <Badge variant="default"><Lock className="size-3" /> GrounUp seed</Badge>;
  }
  if (scope === 'group') return <Badge variant="info">Corporate standard</Badge>;
  return <Badge variant="success">Company</Badge>;
}

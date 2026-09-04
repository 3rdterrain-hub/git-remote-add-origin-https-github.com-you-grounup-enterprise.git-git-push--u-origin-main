import { useMemo, useState } from 'react';
import { Library, Search, Lock, Copy, ShieldCheck, Info, Plus, Archive } from 'lucide-react';
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
import { useQuery } from '@/lib/data/query';
import {
  loadServices, loadTasks, createService, createTask, retireRow,
  loadTruckingRates, loadDisposalSites, loadVendors,
} from '@/lib/data/library';
import { loadMemberships } from '@/lib/data/session';
import { ServiceForm, TaskForm } from '@/components/library/editor';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { usePermissions } from '@/lib/data/session';

/** Counts shipped by the global seed, mirrored from the generated seed SQL. */
const SEED_COUNTS = {
  services: 188, tasks: 2783, assemblies: 188, productionRates: 1452,
  labor: 12, equipment: 17, modifiers: 20, profiles: 3, crews: 8,
};

export function LibrariesPage() {
  const [q, setQ] = useState('');
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  /*
   * Services and tasks are read live, because they are the two the user is
   * expected to add to. The resource tabs below still render the sample
   * catalog; converting them is the same work again and is queued rather than
   * half-done here.
   */
  const servicesQ = useQuery(loadServices, []);
  const tasksQ = useQuery(loadTasks, []);
  const truckingQ = useQuery(loadTruckingRates, []);
  const disposalQ = useQuery(loadDisposalSites, []);
  const vendorsQ = useQuery(loadVendors, []);
  const membershipsQ = useQuery(loadMemberships, []);
  const { can } = usePermissions();
  const canWrite = can('libraries.write');

  const [adding, setAdding] = useState<'service' | 'task' | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const services = servicesQ.status === 'ready' ? servicesQ.data : [];
  const tasks = tasksQ.status === 'ready' ? tasksQ.data : [];
  const companyId = membershipsQ.status === 'ready' ? membershipsQ.data[0]?.companyId ?? null : null;
  const trucking = truckingQ.status === 'ready' ? truckingQ.data : [];
  const disposal = disposalQ.status === 'ready' ? disposalQ.data : [];
  const vendors = vendorsQ.status === 'ready' ? vendorsQ.data : [];
  const subs = vendors.filter((v) => v.vendorType === 'subcontractor');

  const shownServices = useMemo(
    () => services.filter((x) => match(`${x.code} ${x.name} ${x.category ?? ''}`)),
    [services, q]);
  const shownTasks = useMemo(
    () => tasks.filter((x) => match(`${x.code} ${x.name} ${x.category ?? ''}`)),
    [tasks, q]);

  async function addService(v: Parameters<typeof ServiceForm>[0] extends never ? never
    : { code: string; name: string; description: string; category: string;
        subcategory: string; defaultUnit: string; supportedUnits: string[] }) {
    if (!supabase || !companyId) return;
    setBusy(true); setWriteError(null);
    try {
      await createService(supabase, { companyId, ...v });
      setAdding(null);
      servicesQ.refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'That service could not be saved.');
    } finally { setBusy(false); }
  }

  async function addTask(v: {
    code: string; name: string; defaultUnit: string; category: string;
    productionRequired: boolean; crewRequired: boolean; equipmentRequired: boolean;
    materialRequired: boolean; safetyReviewRequired: boolean;
  }) {
    if (!supabase || !companyId) return;
    setBusy(true); setWriteError(null);
    try {
      await createTask(supabase, { companyId, ...v });
      setAdding(null);
      tasksQ.refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'That task could not be saved.');
    } finally { setBusy(false); }
  }

  async function retire(table: 'services' | 'tasks', id: string) {
    if (!supabase) return;
    setBusy(true); setWriteError(null);
    try {
      await retireRow(supabase, table, id);
      (table === 'services' ? servicesQ : tasksQ).refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'That row could not be retired.');
    } finally { setBusy(false); }
  }

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
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="hauling">Hauling</TabsTrigger>
          <TabsTrigger value="subs">Subcontractors</TabsTrigger>
          <TabsTrigger value="labor">Labor</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="crews">Crews</TabsTrigger>
          <TabsTrigger value="production">Production rates</TabsTrigger>
          <TabsTrigger value="modifiers">Condition modifiers</TabsTrigger>
          <TabsTrigger value="pricing">Pricing profiles</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- labor */}
        {/* ------------------------------------------------------- services */}
        <TabsContent value="services" className="space-y-4">
          {servicesQ.status === 'demonstration' ? <DemonstrationNotice /> : null}
          {servicesQ.status === 'loading' ? <LoadingState label="Reading the service catalog" /> : null}
          {servicesQ.status === 'error'
            ? <ErrorState message={servicesQ.message} onRetry={servicesQ.refetch} /> : null}
          {writeError ? <Alert tone="danger">{writeError}</Alert> : null}

          {adding === 'service' ? (
            <ServiceForm title="New service" busy={busy} error={null}
              onSubmit={addService} onCancel={() => setAdding(null)} />
          ) : null}

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Services</CardTitle>
                <CardDescription>
                  What you sell, and what an estimate line is built from. Yours sit on top of
                  the catalog; the catalog itself is read-only for every company.
                </CardDescription>
              </div>
              {isSupabaseConfigured && adding !== 'service' ? (
                <Button size="sm" disabled={!canWrite || !companyId}
                  onClick={() => { setAdding('service'); setWriteError(null); }}>
                  <Plus className="size-4" /> Add service
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownServices.slice(0, 300).map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="font-mono text-xs text-charcoal-600">{x.code}</TableCell>
                      <TableCell className="font-medium text-charcoal-900">{x.name}</TableCell>
                      <TableCell className="text-charcoal-600">{x.category ?? '—'}</TableCell>
                      <TableCell className="text-charcoal-600">{x.defaultUnit}</TableCell>
                      <TableCell><ScopeBadge scope={x.scope} /></TableCell>
                      <TableCell>
                        {x.editable && x.status === 'active' ? (
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => retire('services', x.id)}>
                            <Archive className="size-4" /> Retire
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!shownServices.length && servicesQ.status === 'ready' ? (
                <EmptyState title={q ? 'Nothing matches that' : 'No services yet'}
                  hint="Add one, or connect a workspace to load the shipped catalog." />
              ) : null}
              {shownServices.length > 300 ? (
                <p className="border-t border-charcoal-200 p-3 text-xs text-charcoal-500">
                  Showing the first 300 of {shownServices.length}. Narrow the search to see the rest.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- tasks */}
        <TabsContent value="tasks" className="space-y-4">
          {tasksQ.status === 'loading' ? <LoadingState label="Reading tasks" /> : null}
          {tasksQ.status === 'error'
            ? <ErrorState message={tasksQ.message} onRetry={tasksQ.refetch} /> : null}
          {writeError ? <Alert tone="danger">{writeError}</Alert> : null}

          {adding === 'task' ? (
            <TaskForm busy={busy} error={null}
              onSubmit={addTask} onCancel={() => setAdding(null)} />
          ) : null}

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Tasks</CardTitle>
                <CardDescription>
                  The units of work a service is built from. What a task requires decides what
                  the estimating engine insists on before it will price a line using it.
                </CardDescription>
              </div>
              {isSupabaseConfigured && adding !== 'task' ? (
                <Button size="sm" disabled={!canWrite || !companyId}
                  onClick={() => { setAdding('task'); setWriteError(null); }}>
                  <Plus className="size-4" /> Add task
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Trade</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Requires</TableHead>
                    <TableHead>Scope</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownTasks.slice(0, 300).map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="font-mono text-xs text-charcoal-600">{x.code}</TableCell>
                      <TableCell className="font-medium text-charcoal-900">{x.name}</TableCell>
                      <TableCell className="text-charcoal-600">{x.category ?? '—'}</TableCell>
                      <TableCell className="text-charcoal-600">{x.defaultUnit}</TableCell>
                      <TableCell className="text-xs text-charcoal-500">
                        {[x.productionRequired && 'production', x.crewRequired && 'crew',
                          x.equipmentRequired && 'equipment', x.materialRequired && 'material',
                          x.safetyReviewRequired && 'safety review']
                          .filter(Boolean).join(', ') || 'nothing'}
                      </TableCell>
                      <TableCell><ScopeBadge scope={x.scope} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!shownTasks.length && tasksQ.status === 'ready' ? (
                <EmptyState title={q ? 'Nothing matches that' : 'No tasks yet'} />
              ) : null}
              {shownTasks.length > 300 ? (
                <p className="border-t border-charcoal-200 p-3 text-xs text-charcoal-500">
                  Showing the first 300 of {shownTasks.length}.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- hauling */}
        <TabsContent value="hauling" className="space-y-4">
          {truckingQ.status === 'loading' ? <LoadingState label="Reading haul rates" /> : null}
          {truckingQ.status === 'error'
            ? <ErrorState message={truckingQ.message} onRetry={truckingQ.refetch} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Haul rates</CardTitle>
              <CardDescription>
                Cycle time is computed from these, not guessed: capacity, load and dump
                minutes, and loaded and empty speeds give the engine a real haul cycle
                rather than a rate per ton somebody remembered.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Truck</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right">Hourly</TableHead>
                    <TableHead className="text-right">Load / dump</TableHead>
                    <TableHead className="text-right">Loaded / empty</TableHead>
                    <TableHead>Vendor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trucking.filter((t) => match(`${t.code} ${t.name} ${t.truckType}`)).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs text-charcoal-600">{t.code}</TableCell>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{t.name}</p>
                        <p className="text-xs text-charcoal-500">{titleCase(t.truckType)}</p>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {qty(t.capacity, 1)} {t.capacityUnit}
                      </TableCell>
                      <TableCell className="tabular text-right">{money(t.hourlyRate)}</TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {t.loadMinutes} / {t.dumpMinutes} min
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {t.loadedSpeedMph} / {t.emptySpeedMph} mph
                      </TableCell>
                      <TableCell className="text-charcoal-600">{t.vendorName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!trucking.length && truckingQ.status === 'ready' ? (
                <EmptyState title="No haul rates yet"
                  hint="A haul rate is a negotiated position with a specific trucker, so there is no catalog default for one." />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Disposal sites</CardTitle>
              <CardDescription>
                Where spoil goes, what it costs to tip, and whether the site will take
                contaminated material — which decides the answer long before price does.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Accepts</TableHead>
                    <TableHead className="text-right">Tipping fee</TableHead>
                    <TableHead>Contaminated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disposal.filter((d) => match(`${d.code} ${d.name}`)).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs text-charcoal-600">{d.code}</TableCell>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{d.name}</p>
                        <p className="text-xs text-charcoal-500">
                          {[d.city, d.stateProvince].filter(Boolean).join(', ') || '—'}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">
                        {d.materialTypes.join(', ') || '—'}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {money(d.tippingFee)} / {d.feeUnit}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.acceptsContaminated ? 'warn' : 'default'}>
                          {d.acceptsContaminated ? 'Accepted' : 'Not accepted'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!disposal.length && disposalQ.status === 'ready' ? (
                <EmptyState title="No disposal sites yet" />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --------------------------------------------------- subcontractors */}
        <TabsContent value="subs" className="space-y-4">
          {vendorsQ.status === 'loading' ? <LoadingState label="Reading subcontractors" /> : null}
          {vendorsQ.status === 'error'
            ? <ErrorState message={vendorsQ.message} onRetry={vendorsQ.refetch} /> : null}

          {subs.some((v) => v.insuranceLapsed && v.status === 'active') ? (
            <Alert tone="danger" title="Insurance has lapsed on an active subcontractor">
              A lapsed certificate is the exposure that lands on you, not on them. The date is
              stored and the lapse is worked out from today, so this cannot go stale.
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Subcontractors</CardTitle>
              <CardDescription>
                Who a subcontract line can be priced against. Qualification is a decision
                somebody records after checking rather than a default.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Insurance</TableHead>
                    <TableHead>Qualified</TableHead>
                    <TableHead className="text-right">Performance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.filter((v) => match(`${v.code} ${v.name}`)).map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs text-charcoal-600">{v.code}</TableCell>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{v.name}</p>
                        <p className="text-xs text-charcoal-500">
                          {[v.city, v.stateProvince].filter(Boolean).join(', ') || '—'}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">
                        {v.contactName ?? '—'}
                        {v.email ? <span className="block text-charcoal-400">{v.email}</span> : null}
                      </TableCell>
                      <TableCell>
                        {v.insuranceExpiresOn ? (
                          <Badge variant={v.insuranceLapsed ? 'danger' : 'success'}>
                            {v.insuranceLapsed ? 'Lapsed' : 'Current'}
                          </Badge>
                        ) : <span className="text-xs text-charcoal-400">not recorded</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={v.isQualified ? 'success' : 'warn'}>
                          {v.isQualified ? 'Qualified' : 'Not yet'}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {v.performanceScore == null ? '—' : v.performanceScore.toFixed(1)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!subs.length && vendorsQ.status === 'ready' ? (
                <EmptyState title="No subcontractors yet"
                  hint="Add them under Procurement, or import your vendor list." />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

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

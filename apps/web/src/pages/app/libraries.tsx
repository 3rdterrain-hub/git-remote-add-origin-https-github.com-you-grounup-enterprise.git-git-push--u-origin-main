import { useMemo, useState } from 'react';
import { Library, Search, Lock, Copy, ShieldCheck, Info, Plus, Archive } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { AssemblyLibrary } from '@/components/library/assemblies';
import { ServicesWithoutABreakdown } from '@/components/library/services-without-a-breakdown';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategorySelect } from '@/components/ui/category-select';
import { loadProductionRates, SOURCE_LABEL } from '@/lib/data/production';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { calculatePrice } from '@grounup/engine';
import { money, unitRate, percent, qty, titleCase } from '@/lib/format';
import { useQuery } from '@/lib/data/query';
import {
  loadServices, loadTasks, createService, createTask, retireRow,
  loadTruckingRates, loadDisposalSites, loadVendors,
  loadMaterials, loadLaborRates, loadEquipmentOptions, loadCrews,
  loadConditionModifiers, loadPricingProfiles, loadLibraryCounts,
  updateCost, setMaterialCost,
} from '@/lib/data/library';
import { CostCell } from '@/components/library/cost-cell';
import { ImportPriceList } from '@/components/library/import-price-list';
import { MaterialsWithNoPrice } from '@/components/library/materials-with-no-price';
import { ImportRateSheet } from '@/components/library/import-rate-sheet';
import { WhatAHaulCosts } from '@/components/library/what-a-haul-costs';
import { loadMemberships } from '@/lib/data/session';
import { ServiceForm, TaskForm } from '@/components/library/editor';
import { LoadingState, ErrorState, EmptyState, DemonstrationNotice } from '@/components/data-state';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { usePermissions } from '@/lib/data/session';
import { CategoryManager } from '@/components/library/category-manager';

export function LibrariesPage() {
  const [q, setQ] = useState('');
  /*
   * Which tab is open, so the four boxes across the top can open the one that
   * holds what they counted. Labor to start, because it is the tab a first-time
   * visitor has something to change on.
   */
  const [tab, setTab] = useState('labor');
  const [category, setCategory] = useState('');
  const [taskCategory, setTaskCategory] = useState('');
  const [rateCategory, setRateCategory] = useState('');
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  /*
   * Services and tasks are read live, because they are the two the user is
   * expected to add to. The resource tabs below still render the sample
   * catalog; converting them is the same work again and is queued rather than
   * half-done here.
   */
  const servicesQ = useQuery(loadServices, []);
  const tasksQ = useQuery(loadTasks, []);
  const ratesQ = useQuery(loadProductionRates(q, rateCategory || null), [q, rateCategory]);
  const truckingQ = useQuery(loadTruckingRates, []);
  const disposalQ = useQuery(loadDisposalSites, []);
  const vendorsQ = useQuery(loadVendors, []);
  const materialsQ = useQuery(loadMaterials, []);
  const equipmentQ = useQuery(loadEquipmentOptions, []);
  const crewsQ = useQuery(loadCrews, []);
  const modifiersQ = useQuery(loadConditionModifiers, []);
  const profilesQ = useQuery(loadPricingProfiles, []);
  const laborQ = useQuery(loadLaborRates, []);
  const countsQ = useQuery(loadLibraryCounts, []);
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
  const materials = materialsQ.status === 'ready' ? materialsQ.data : [];
  const equipment = equipmentQ.status === 'ready' ? equipmentQ.data : [];
  const crews = crewsQ.status === 'ready' ? crewsQ.data : [];
  const modifiers = modifiersQ.status === 'ready' ? modifiersQ.data : [];
  const profiles = profilesQ.status === 'ready' ? profilesQ.data : [];
  const laborRates = laborQ.status === 'ready' ? laborQ.data : [];
  const counts = countsQ.status === 'ready' ? countsQ.data : null;
  /* A count that has not arrived is an em dash, never a remembered number. */
  const count = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());

  /**
   * Change a cost in the company's library.
   *
   * The write is the same three lines whichever table it lands on; what differs
   * is only which column holds the money. Row level security decides whether it
   * is permitted, so a catalog row is refused by the database rather than by
   * this function remembering to check.
   */
  async function saveCost(
    table: Parameters<typeof updateCost>[1], id: string,
    patch: Record<string, number>, refetch: () => void,
  ) {
    if (!supabase) return;
    setBusy(true); setWriteError(null);
    try {
      await updateCost(supabase, table, id, patch);
      refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'That cost could not be saved.');
    } finally { setBusy(false); }
  }

  /**
   * Price a material, whichever tier it sits in.
   *
   * The company's own rows update in place. A catalog row cannot be updated by
   * anybody — it is the row every tenant reads — so the database copies it into
   * this company's library and prices the copy. Both go through the one
   * function, because from the estimator's side it is one gesture: they clicked
   * a price and typed a number.
   */
  async function priceMaterial(id: string, cost: number, source: string) {
    if (!supabase || !companyId) return;
    setBusy(true); setWriteError(null);
    try {
      await setMaterialCost(supabase, { materialId: id, companyId, cost, source });
      materialsQ.refetch();
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : 'That cost could not be saved.');
    } finally { setBusy(false); }
  }

  /*
   * A shipped catalog of 860 services in 82 categories is a list nobody scrolls.
   * The category comes from the same governed set the rows were filed under, so
   * the filter cannot offer a category nothing carries — and cannot miss one.
   */
  const shownServices = useMemo(
    () => services
      .filter((x) => !category || x.category === category)
      .filter((x) => match(`${x.code} ${x.name} ${x.category ?? ''}`)),
    [services, q, category]);
  const shownTasks = useMemo(
    () => tasks
      .filter((x) => !taskCategory || x.category === taskCategory)
      .filter((x) => match(`${x.code} ${x.name} ${x.category ?? ''}`)),
    [tasks, q, taskCategory]);

  async function addService(v: Parameters<typeof ServiceForm>[0] extends never ? never
    : { code: string; name: string; description: string; category: string;
        subcategory: string; industry: string; defaultUnit: string;
        supportedUnits: string[] }) {
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
        <StatTile label="Services" value={count(counts?.services)} icon={<Library className="size-4" />}
          hint="the catalog and your own, together"
          onClick={() => setTab('services')} active={tab === 'services'}
          actionLabel="Open the services tab" />
        <StatTile label="Tasks" value={count(counts?.tasks)}
          hint={`in ${count(counts?.assemblies)} work sequences`}
          onClick={() => setTab('tasks')} active={tab === 'tasks'}
          actionLabel="Open the tasks tab" />
        <StatTile label="Production rates" value={count(counts?.productionRates)}
          hint="benchmarks, replaceable with company actuals"
          onClick={() => setTab('production')} active={tab === 'production'}
          actionLabel="Open the production rates tab" />
        <StatTile label="Resources"
          value={counts ? (counts.labor + counts.equipment + counts.crews).toLocaleString() : '—'}
          hint={`${count(counts?.labor)} labor, ${count(counts?.equipment)} equipment, ${count(counts?.crews)} crews`}
          onClick={() => setTab('labor')}
          active={tab === 'labor' || tab === 'equipment' || tab === 'crews'}
          actionLabel="Open the labor, equipment and crew tabs" />
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="assemblies">Work sequences</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="hauling">Hauling</TabsTrigger>
          <TabsTrigger value="subs">Subcontractors</TabsTrigger>
          <TabsTrigger value="labor">Labor</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="crews">Crews</TabsTrigger>
          <TabsTrigger value="production">Production rates</TabsTrigger>
          <TabsTrigger value="modifiers">Condition modifiers</TabsTrigger>
          <TabsTrigger value="pricing">Pricing profiles</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        {/* ----------------------------------------------------- categories */}
        <TabsContent value="categories" className="space-y-4">
          {/*
            * The lists every tab above groups by. They were addable and nothing
            * else until migration 0150 — which is how the shipped catalog ended
            * up with `COMPACTION` beside `Compactors` and no screen to fix it.
            */}
          <CategoryManager companyId={companyId} canEdit={canWrite} />
        </TabsContent>

        {/* ---------------------------------------------------------- labor */}
        {/* ------------------------------------------------------- services */}
        <TabsContent value="services" className="space-y-4">
          {/*
            * Only when there is something wrong with the library, and on the
            * tab where somebody would pick one of these services and find it
            * had nothing to build up from.
            */}
          <ServicesWithoutABreakdown companyId={companyId} canEdit={canWrite}
            onStarted={() => setTab('assemblies')} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-72">
              <Label htmlFor="lib-svc-cat">Filter by category</Label>
              <CategorySelect id="lib-svc-cat" kind="service_category"
                label="service category to filter by" canAdd={false}
                value={category} onChange={setCategory} />
            </div>
            <p className="pb-1.5 text-xs text-charcoal-500">
              {shownServices.length} of {services.length}
            </p>
          </div>
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
        {/*
          * The order the work happens in. Fifty-four sequences shipped with no
          * screen at all — the functions to copy and edit them existed, were
          * tested, and nothing called them.
          */}
        <TabsContent value="assemblies">
          <AssemblyLibrary companyId={companyId} canEdit={can('libraries.write')} />
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-72">
              <Label htmlFor="lib-tsk-cat">Filter by category</Label>
              <CategorySelect id="lib-tsk-cat" kind="task_category"
                label="task category to filter by" canAdd={false}
                value={taskCategory} onChange={setTaskCategory} />
            </div>
            <p className="pb-1.5 text-xs text-charcoal-500">
              {shownTasks.length} of {tasks.length}
            </p>
          </div>
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

        {/* ------------------------------------------------------ materials */}
        <TabsContent value="materials" className="space-y-4">
          {materialsQ.status === 'loading' ? <LoadingState label="Reading materials" /> : null}
          {materialsQ.status === 'error'
            ? <ErrorState message={materialsQ.message} onRetry={materialsQ.refetch} /> : null}
          {writeError ? <Alert tone="danger">{writeError}</Alert> : null}

          <Alert tone="neutral" icon={<Info className="size-4" />}
            title="Set a cost once, and every estimate built after it uses it">
            A change here applies to estimates priced from now on and to nothing already
            issued — a library snapshot copies the rows that priced an estimate at the moment
            it went out, so a bid sent in March still reproduces at March&apos;s costs. That is
            what makes editing a rate safe rather than retroactive.
          </Alert>

          {/*
            * Materials priced at nothing, worst first. `my_uncosted_materials`
            * counted the lines and the estimates each one was already sitting
            * on from the day it was written, and nothing read it — so the
            * number that says *this one is on four live estimates* was never
            * shown to anybody who could act on it. Silent on a healthy library.
            */}
          <MaterialsWithNoPrice companyId={companyId} canEdit={canWrite}
            onPriced={materialsQ.refetch} />

          <Card>
            <CardHeader>
              <CardTitle>Materials</CardTitle>
              <CardDescription>
                Unit cost and the waste factor that grosses a measured quantity up to a
                purchased one. A waste factor must state its basis; the database refuses one
                that does not. The catalog ships the names, the categories and the units;
                the costs are yours, and clicking one on a catalog material makes your own
                copy of it rather than changing what every company reads.
              </CardDescription>
            </CardHeader>
            <CardContent className="border-b border-charcoal-100 pb-4">
              <ImportPriceList companyId={companyId} canWrite={canWrite}
                onImported={materialsQ.refetch} />
            </CardContent>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Waste</TableHead>
                    <TableHead>Scope</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {materials.filter((m) => match(`${m.code} ${m.name} ${m.category ?? ''}`))
                    .slice(0, 300).map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs text-charcoal-600">{m.code}</TableCell>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{m.name}</p>
                        {m.category ? (
                          <p className="text-xs text-charcoal-500">{m.category}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-charcoal-600">{m.unit}</TableCell>
                      <TableCell className="text-right">
                        <CostCell value={m.unitCost} editable={canWrite} busy={busy}
                          label={`unit cost for ${m.name}`} suffix={` / ${m.unit}`}
                          unset={m.costState === 'not_costed'}
                          hint={m.editable
                            ? m.quoteReference ?? undefined
                            : m.costState === 'free' ? m.freeReason ?? undefined : undefined}
                          note={m.editable ? undefined : (
                            <>
                              This is a catalog material, and the catalog is the same for
                              every company. Saving a cost makes <strong>your</strong> copy of
                              it and prices that; the catalog row is left alone.
                            </>
                          )}
                          sourcePrompt="Where this price came from"
                          onSave={(v, src) => priceMaterial(m.id, v, src)} />
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {percent(m.defaultWastePercent, 1)}
                      </TableCell>
                      <TableCell><ScopeBadge scope={m.scope} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!materials.length && materialsQ.status === 'ready' ? (
                <EmptyState title={q ? 'Nothing matches that' : 'No materials yet'} />
              ) : null}
            </CardContent>
          </Card>

        </TabsContent>

        {/* -------------------------------------------------------- hauling */}
        <TabsContent value="hauling" className="space-y-4">
          {truckingQ.status === 'loading' ? <LoadingState label="Reading haul rates" /> : null}
          {truckingQ.status === 'error'
            ? <ErrorState message={truckingQ.message} onRetry={truckingQ.refetch} /> : null}

          {/*
            * The comparison `app.haul_cost` was written for in 0067 and never
            * got a screen: "a company comparing quotes on a screen should not
            * need an Edge Function round trip per row".
            */}
          <WhatAHaulCosts rates={trucking} />

          <Card>
            <CardHeader>
              <CardTitle>Haul rates</CardTitle>
              <CardDescription>
                Three ways a haul is bought, and they are not interchangeable. A cycle rate
                gives a cost, a duration and a truck count. A trip rate pays for the truck
                that arrives rather than the dirt in it, so a partial load is a whole trip.
                A unit rate is a number with no schedule in it, which RULE-004 treats as
                preliminary.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Truck</TableHead>
                    <TableHead>Priced by</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
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
                      <TableCell>
                        <Badge variant={t.pricingBasis === 'cycle' ? 'success'
                          : t.pricingBasis === 'per_trip' ? 'default' : 'warn'}>
                          {t.pricingBasis === 'cycle' ? 'Cycle'
                            : t.pricingBasis === 'per_trip' ? 'Per trip' : 'Per unit'}
                        </Badge>
                        {t.pricingBasis === 'per_trip' && !t.chargesWholeTrips ? (
                          <p className="text-[11px] text-charcoal-500">prorated</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {qty(t.capacity, 1)} {t.capacityUnit}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {t.pricingBasis === 'per_trip' && t.ratePerTrip != null
                          ? `${money(t.ratePerTrip)} / trip`
                          : t.pricingBasis === 'per_unit' && t.preliminaryUnitRate != null
                            ? `${money(t.preliminaryUnitRate)} / ${t.capacityUnit}`
                            : `${money(t.hourlyRate)} / hr`}
                      </TableCell>
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

        {/*
          * The Labor tab shows the labor library.
          *
          * It rendered `LABOR` — a handful of sample classifications with
          * invented wages — while the live table, reading the company's own
          * rates, sat inside the *Materials* tab where nobody would look for
          * it. Two defects in one place: the right data in the wrong tab, and
          * the wrong data in the right one.
          */}
        <TabsContent value="labor" className="space-y-4">
          {laborQ.status === 'loading' ? <LoadingState label="Reading labor rates" /> : null}
          {laborQ.status === 'error'
            ? <ErrorState message={laborQ.message} onRetry={laborQ.refetch} /> : null}
          {writeError ? <Alert tone="danger">{writeError}</Alert> : null}
          <Card>
            <CardHeader>
              <CardTitle>Labor rates</CardTitle>
              <CardDescription>
                Base wage and burden. The loaded rate the engine multiplies hours by is
                generated by the database from those two, so it cannot be edited into
                disagreeing with them.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead className="text-right">Base wage</TableHead>
                    <TableHead className="text-right">Burden</TableHead>
                    <TableHead className="text-right">Loaded</TableHead>
                    <TableHead>Scope</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {laborRates.filter((l) => match(`${l.code} ${l.classification}`)).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{l.classification}</p>
                        <p className="text-xs text-charcoal-500">
                          {l.laborGroup ?? l.code}{l.isUnion ? ' · union' : ''}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <CostCell value={l.baseWagePerHour} editable={l.editable} busy={busy}
                          label={`base wage for ${l.classification}`} suffix=" / hr"
                          hint={`from ${l.effectiveDate}`}
                          onSave={(v) => saveCost('labor_rates', l.id,
                            { base_wage_per_hour: v }, laborQ.refetch)} />
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {percent(l.burdenPercent, 1)}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium text-charcoal-900">
                        {money(l.burdenedCostPerHour)}
                        <span className="text-charcoal-400"> / hr</span>
                      </TableCell>
                      <TableCell><ScopeBadge scope={l.scope} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!laborRates.length && laborQ.status === 'ready' ? (
                <EmptyState title="No labor rates yet" />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipment" className="space-y-4">
          {equipmentQ.status === 'loading' ? <LoadingState label="Reading equipment" /> : null}
          {equipmentQ.status === 'error'
            ? <ErrorState message={equipmentQ.message} onRetry={equipmentQ.refetch} /> : null}
          {writeError ? <Alert tone="danger">{writeError}</Alert> : null}

          <Card>
            <CardHeader>
              <CardTitle>Equipment</CardTitle>
              <CardDescription>
                Every machine the library holds, carrying whichever rate wins under
                RULE-003. The platform ships a published hourly figure on each so nothing
                prices at nothing; your dealer&apos;s sheet beats it the moment it is loaded.
              </CardDescription>
            </CardHeader>
            <CardContent className="border-b border-charcoal-100 pb-4">
              <ImportRateSheet companyId={companyId} canWrite={canWrite}
                onImported={equipmentQ.refetch} />
            </CardContent>
            <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Hourly</TableHead>
                  <TableHead className="text-right">Daily</TableHead>
                  <TableHead className="text-right">Fuel</TableHead>
                  <TableHead className="text-right">Mobilization</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipment.filter((e) => match(`${e.name} ${e.equipmentClass}`))
                  .slice(0, 300).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{e.name}</p>
                    </TableCell>
                    <TableCell className="text-charcoal-600">{e.equipmentClass}</TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {/*
                        * A machine with no rate says so. Showing $0.00 for one
                        * nobody has priced is the silence migration 0128 exists
                        * to break — the line totals and the machine was on the job.
                        */}
                      {e.hourlyRate > 0
                        ? unitRate(e.hourlyRate)
                        : <span className="font-normal text-warn-700">No rate yet</span>}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {e.dailyRate ? money(e.dailyRate) : <span className="text-charcoal-300">—</span>}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {e.fuelGallonsPerHour ? `${e.fuelGallonsPerHour} gal/hr`
                        : <span className="text-charcoal-300">—</span>}
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {e.mobilizationCost ? money(e.mobilizationCost)
                        : <span className="text-charcoal-300">—</span>}
                    </TableCell>
                    <TableCell><ScopeBadge scope={e.scope} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!equipment.length && equipmentQ.status === 'ready' ? (
              <EmptyState title={q ? 'Nothing matches that' : 'No equipment yet'} />
            ) : null}
          </CardContent></Card>
          <Alert tone="info" className="mt-4" icon={<Info className="size-4" />} title="RULE-003 — equipment rate hierarchy">
            A project quote beats an approved company rate, which beats a regional rate, which beats
            the GrounUp seed. The estimate records which source won, what it overrode, and the date it
            was effective — so reopening a historical estimate reprices against the rate that was
            actually in force, not today's.
          </Alert>
        </TabsContent>

        {/* ----------------------------------------------------------- crews */}
        {/*
          * The crews the company actually has.
          *
          * `loadCrews` has been in the data layer since crews were built, and
          * this tab rendered `CREWS` — a handful of sample crews with invented
          * wages — instead of calling it. The loader was written, exported and
          * never used, which is the same defect as a database function with no
          * screen, one layer up.
          */}
        <TabsContent value="crews" className="space-y-4">
          {crewsQ.status === 'loading' ? <LoadingState label="Reading crews" /> : null}
          {crewsQ.status === 'error'
            ? <ErrorState message={crewsQ.message} onRetry={crewsQ.refetch} /> : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {crews.filter((c) => match(`${c.code} ${c.name}`)).map((c) => {
              const headcount = c.members.reduce((a, m) => a + m.headcount, 0);
              /*
               * The burdened rate is a generated column on `labor_rates`, so
               * this cannot disagree with what the engine multiplies hours by —
               * the sample version recomputed it in the browser and could.
               */
              const hourly = c.members.reduce(
                (a, m) => a + m.burdenedCostPerHour * m.headcount, 0);
              return (
                <Card key={c.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm">{c.name}</CardTitle>
                        <CardDescription className="font-mono text-xs">
                          {c.code} · {headcount} {headcount === 1 ? 'worker' : 'workers'}
                          {' '}· {c.shiftHours} hr shift
                        </CardDescription>
                      </div>
                      <ScopeBadge scope={c.scope} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {c.members.length === 0 ? (
                      <p className="text-sm text-warn-700">
                        No members yet, so this crew prices at nothing.
                      </p>
                    ) : null}
                    {c.members.map((m) => (
                      <div key={`${c.id}-${m.laborRateId}`} className="flex justify-between text-sm">
                        <span className="text-charcoal-600">
                          {m.headcount} × {m.classification}
                        </span>
                        <span className="tabular text-charcoal-900">
                          {m.burdenedCostPerHour
                            ? unitRate(m.burdenedCostPerHour)
                            : <span className="text-warn-700">no rate</span>}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-charcoal-200 pt-2 text-sm font-semibold">
                      <span>Crew cost per hour</span>
                      <span className="tabular">{hourly ? unitRate(hourly) : '—'}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {!crews.length && crewsQ.status === 'ready' ? (
            <EmptyState title={q ? 'Nothing matches that' : 'No crews yet'} />
          ) : null}
        </TabsContent>

        {/* ------------------------------------------------------ production */}
        <TabsContent value="production" className="space-y-4">
          {/*
            * This tab rendered a fixture of eight rates while the database held
            * 2,124 — so the screen that is supposed to show a company what its
            * work goes at showed it a demonstration instead. It reads the real
            * library now, the company's own rates first.
            */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-72">
              <Label htmlFor="pr-cat">Filter by task category</Label>
              <CategorySelect id="pr-cat" kind="task_category"
                label="task category to filter by" canAdd={false}
                value={rateCategory} onChange={setRateCategory} />
            </div>
            <p className="pb-1.5 text-xs text-charcoal-500">
              {ratesQ.status === 'ready'
                ? `${ratesQ.data.length} shown${ratesQ.data.length === 400 ? ' (narrow the search for more)' : ''}`
                : ''}
            </p>
          </div>

          {ratesQ.status === 'loading' ? <LoadingState label="Reading the production rates" /> : null}
          {ratesQ.status === 'error'
            ? <ErrorState message={ratesQ.message} onRetry={ratesQ.refetch} /> : null}

          {ratesQ.status === 'ready' ? (
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Utilization</TableHead>
                    <TableHead className="text-right">Practical / shift</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Sample</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead>Scope</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ratesQ.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="p-6">
                        <EmptyState title="No production rates match"
                          hint="Clear the search, or record one your company has measured." />
                      </TableCell>
                    </TableRow>
                  ) : ratesQ.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="text-sm text-charcoal-900">{r.taskName ?? r.code}</p>
                        <p className="text-xs text-charcoal-400">
                          {r.taskCategory ?? '—'}{r.note ? ` · ${r.note}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {qty(r.ratePerHour, 1)} {r.rateUnit}/hr
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {percent(r.utilizationFactor, 0)}
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">
                        {qty(r.ratePerHour * r.utilizationFactor * r.shiftHours, 0)} {r.rateUnit}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.sourceType === 'company_actual' ? 'success'
                          : r.sourceType === 'company_historical' ? 'info'
                          : r.sourceType === 'estimator_judgment' ? 'warn' : 'warn'}>
                          {SOURCE_LABEL[r.sourceType]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {r.sampleSize || '—'}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {percent(r.confidenceScore, 0)}
                      </TableCell>
                      <TableCell><ScopeBadge scope={r.isOwn ? 'company' : 'global'} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          ) : null}

          <Alert tone="warn" icon={<Info className="size-4" />} title="RULE-010 — source confidence">
            Every rate that is not a company actual carries its source, its confidence and its review
            state. A seed benchmark is a starting point, not a company production standard, and the
            engine says so on every estimate that uses one. Record what your crews actually do and
            it will outrank the benchmark everywhere.
          </Alert>
        </TabsContent>

        {/* ------------------------------------------------------- modifiers */}
        {/*
          * The condition modifiers the engine will actually apply.
          *
          * This rendered `MODIFIERS`, a sample set, so the factors on screen
          * were not the factors a line would be priced with. Migration 0004
          * refuses a factor naming a target the engine does not have, so what
          * is in the table is enforceable and what was in the constant was
          * decoration.
          */}
        <TabsContent value="modifiers" className="space-y-4">
          {modifiersQ.status === 'loading' ? <LoadingState label="Reading modifiers" /> : null}
          {modifiersQ.status === 'error'
            ? <ErrorState message={modifiersQ.message} onRetry={modifiersQ.refetch} /> : null}
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
                {modifiers.filter((m) => match(`${m.code} ${m.name} ${m.category ?? ''}`))
                  .map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{m.name}</p>
                      <p className="font-mono text-xs text-charcoal-400">{m.code}</p>
                    </TableCell>
                    <TableCell className="text-charcoal-600">
                      {m.category ?? <span className="text-charcoal-300">—</span>}
                    </TableCell>
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
            {!modifiers.length && modifiersQ.status === 'ready' ? (
              <EmptyState title={q ? 'Nothing matches that' : 'No condition modifiers yet'} />
            ) : null}
          </CardContent></Card>
          <Alert tone="info" className="mt-4" icon={<Info className="size-4" />} title="RULE-006 — modifiers apply only to their declared targets">
            A production factor multiplies the rate, so 0.75 means the crew produces 75% of base and
            the work takes longer. A cost factor multiplies that bucket, so 1.15 means it costs 15%
            more. Production impediments compound; independent cost causes add.
          </Alert>
        </TabsContent>

        {/* --------------------------------------------------------- pricing */}
        {/*
          * The company's own pricing profiles, priced through the real engine.
          *
          * This rendered `PRICING_PROFILES` — sample profiles with invented
          * components — and then ran them through `calculatePrice` for the
          * worked example. The arithmetic was real and the inputs were not,
          * which is the most convincing way to be wrong: an estimator reading
          * "18% gross margin" had no way to tell it was nobody's margin.
          */}
        <TabsContent value="pricing" className="space-y-4">
          {profilesQ.status === 'loading' ? <LoadingState label="Reading pricing profiles" /> : null}
          {profilesQ.status === 'error'
            ? <ErrorState message={profilesQ.message} onRetry={profilesQ.refetch} /> : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {profiles.filter((p) => match(`${p.code} ${p.name}`)).map((p) => {
              /*
               * Priced through the engine the estimates use, on the profile as
               * it is stored — so the worked example below is what this profile
               * would actually do to a hundred thousand dollars of cost.
               */
              const example = calculatePrice(100_000, 0, {
                id: p.id, name: p.name, method: p.method,
                region: p.region ?? undefined,
                regionalFactor: p.regionalFactor,
                escalationPercent: p.escalationPercent,
                escalationYears: p.escalationYears,
                components: p.components.map((c) => ({
                  code: c.code, label: c.label, percent: c.percent,
                  basis: c.basis,
                  sequence: c.sequence, disclosed: c.disclosed,
                })),
              });
              return (
                <Card key={p.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm">
                          {p.name}
                          {p.isDefault ? (
                            <Badge variant="success" className="ml-2">Default</Badge>
                          ) : null}
                        </CardTitle>
                        <CardDescription>
                          {titleCase(p.method)} method
                          {p.regionalFactor !== 1 ? ` · regional × ${p.regionalFactor}` : ''}
                          {p.escalationPercent > 0
                            ? ` · ${percent(p.escalationPercent, 1)} for ${p.escalationYears} yr`
                            : ''}
                        </CardDescription>
                      </div>
                      <ScopeBadge scope={p.scope} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {p.components.length === 0 ? (
                      <p className="text-sm text-warn-700">
                        No markup on this profile, so it prices at cost.
                      </p>
                    ) : null}
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
          {!profiles.length && profilesQ.status === 'ready' ? (
            <EmptyState title={q ? 'Nothing matches that' : 'No pricing profiles yet'} />
          ) : null}
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

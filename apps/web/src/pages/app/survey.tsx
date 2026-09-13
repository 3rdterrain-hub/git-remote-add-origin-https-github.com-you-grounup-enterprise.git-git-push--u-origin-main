/**
 * Survey and earthwork, live.
 *
 * This page read `SURVEYS`, `MC_FILES`, `SURFACE_COMPARISON` and two elevation
 * grids from `@/data/survey`, and ran the real cut/fill analysis over them —
 * the same shape as the Schedule page before it: a correct calculation of a job
 * that does not exist.
 *
 * Five governed tables sat behind it with no reader: `surveys`, `surfaces`,
 * `surface_comparisons`, `machine_control_files`, `machine_assignments`.
 *
 * Three things this page is careful about.
 *
 * **The volumes are the record's, not the browser's.** `surface_comparisons`
 * stores the cut, the fill, the net and the areas as they were computed. The
 * page reads them. Behind that record stands `enforce_surface_datum_match`,
 * strengthened by migration 0047, which refuses a comparison whose two surfaces
 * do not belong to the same project, or differ in vertical datum, horizontal
 * datum, coordinate system, units or grid. The vertical datum alone would put
 * the volume out by the offset between them; the horizontal one is worse,
 * because NAD27 and NAD83 differ by tens of meters and two grids on different
 * horizontal datums do not cover the same ground even when their origins read
 * the same.
 *
 * **The soil properties are the company's, and the one nobody recorded is not
 * invented.** Swell and shrink come from `companies`. No column holds an
 * unsuitable fraction; it is a judgment about a particular site, so the balance
 * assumes none and says so. The fixture assumed six percent, which on a real
 * job moves thousands of yards of import on a number nobody chose.
 *
 * **The cross-sections tab is gone.** It ran the engine's average-end-area and
 * prismoidal comparison over invented road sections, and there is no alignment
 * or cross-section table anywhere in the schema. The engine capability is real
 * and tested; the storage does not exist, so the tab was a picture. Building the
 * alignment model is a feature, and it is recorded as one rather than faked.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mountain, Layers, Radio, MapPin, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, Separator, EmptyState } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, DemonstrationNotice } from '@/components/data-state';
import { useQuery } from '@/lib/data/query';
import {
  loadSurveys, loadSurfaceComparisons, loadSurfaceGrid, loadMachineFiles, loadSoilDefaults,
  loadAsBuiltSurfaceId,
} from '@/lib/data/survey';
import { analyzeCutFill, progressAgainstDesign } from '@grounup/engine';
import { qty, integer, percent, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-charcoal-600">{label}</span>
      <span className={cn('tabular', strong ? 'font-medium text-charcoal-900' : 'text-charcoal-700')}>
        {value}
      </span>
    </div>
  );
}

/** A coarse heat map of the cut and fill depths, drawn from the two real grids. */
function DepthMap({ existingId, designId }: { existingId: string; designId: string }) {
  const a = useQuery(loadSurfaceGrid(existingId), [existingId]);
  const b = useQuery(loadSurfaceGrid(designId), [designId]);

  if (a.status === 'error') return <ErrorState message={a.message} onRetry={a.refetch} />;
  if (b.status === 'error') return <ErrorState message={b.message} onRetry={b.refetch} />;
  if (a.status !== 'ready' || b.status !== 'ready') {
    return <LoadingState label="Reading the surfaces" />;
  }
  const existing = a.data;
  const design = b.data;
  if (!existing || !design || existing.elevations.length === 0) {
    return (
      <p className="text-sm text-charcoal-500">
        The surfaces behind this comparison carry no elevation grid, so there is no depth map
        to draw. The volumes above still stand — they were computed when the comparison was made.
      </p>
    );
  }

  const depths = existing.elevations.map((e, i) => {
    const d = design.elevations[i];
    if (e === null || d === null || d === undefined) return null;
    return e - d;
  });
  const cuts = depths.filter((d): d is number => d !== null && d > 0);
  const fills = depths.filter((d): d is number => d !== null && d < 0);
  const maxCut = cuts.length ? Math.max(...cuts) : 1;
  const maxFill = fills.length ? Math.max(...fills.map((d) => -d)) : 1;

  return (
    <div>
      <div
        className="grid w-full max-w-md gap-px rounded-md bg-charcoal-200 p-px"
        style={{ gridTemplateColumns: `repeat(${existing.cols}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`Cut and fill depth map, ${existing.rows} by ${existing.cols} cells at ${existing.cellSizeFt} ft`}
      >
        {depths.map((d, i) => {
          if (d === null) {
            return <span key={i} className="aspect-square bg-charcoal-100" title="No survey data" />;
          }
          // Cut warms toward the brand gold; fill cools toward blue. Zero is
          // near-white so the daylight line between cut and fill is visible.
          const t = d > 0 ? Math.min(d / maxCut, 1) : Math.min(-d / maxFill, 1);
          const color = d > 0
            ? `rgba(246, 193, 1, ${0.15 + t * 0.85})`
            : `rgba(37, 99, 235, ${0.15 + t * 0.85})`;
          return (
            <span key={i} className="aspect-square" style={{ backgroundColor: color }}
              title={`${d > 0 ? 'Cut' : 'Fill'} ${Math.abs(d).toFixed(2)} ft`} />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-charcoal-500">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ backgroundColor: 'rgba(246,193,1,1)' }} />
          Cut, to {qty(maxCut, 2)} ft
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ backgroundColor: 'rgba(37,99,235,1)' }} />
          Fill, to {qty(maxFill, 2)} ft
        </span>
        <span>{existing.rows} × {existing.cols} at {qty(existing.cellSizeFt, 0)} ft</span>
      </div>
      {/*
        * What the database guarantees about these two grids, and what it does
        * not. `enforce_surface_datum_match` refuses a comparison across
        * different vertical datums, units or grid shapes, so the cells line up
        * one for one. It does not hold a georeference — no easting or northing
        * is stored — so the engine reports that alignment is unverified on any
        * calculation over them, and that warning is shown rather than swallowed.
        * Two grids of equal shape over different ground produce a volume that is
        * entirely fictitious and entirely plausible.
        */}
      <p className="mt-1 text-[11px] text-charcoal-400">
        Same project, datums, coordinate system, units and grid — the database refuses a
        comparison otherwise.
        {existing.origin && design.origin
          ? ' Both surfaces carry a georeference, so the engine can tell whether they cover the same ground.'
          : ' Neither surface carries a georeference, so alignment is not verified: two grids of the same shape over different ground would look identical here.'}
      </p>
    </div>
  );
}

/**
 * Progress against design, with over-excavation kept out of it.
 *
 * A cell cut below design grade is not a hundred and ten percent finished. It is
 * fill that has to be brought back and recompacted, and counting it as progress
 * is how a job reports ninety-five percent complete and then loses a week. The
 * engine separates the two; this shows both.
 */
function ProgressPanel({ existingId, designId, asBuiltId }: {
  existingId: string; designId: string; asBuiltId: string;
}) {
  const a = useQuery(loadSurfaceGrid(existingId), [existingId]);
  const d = useQuery(loadSurfaceGrid(designId), [designId]);
  const b = useQuery(loadSurfaceGrid(asBuiltId), [asBuiltId]);

  if ([a, d, b].some((q) => q.status === 'error')) {
    return <ErrorState message="A surface could not be read." />;
  }
  if (a.status !== 'ready' || d.status !== 'ready' || b.status !== 'ready') {
    return <LoadingState label="Reading the as-built" />;
  }
  if (!a.data || !d.data || !b.data) {
    return (
      <p className="text-sm text-charcoal-500">
        Progress compares the original ground, the design and the as-built. One of the three
        carries no grid, so there is nothing to compare.
      </p>
    );
  }

  /*
   * The georeference goes with the grid. Migration 0047 added it precisely so
   * two grids of the same shape over different ground can be told apart — the
   * engine refuses that comparison instead of returning a volume that is,
   * in 0047's words, entirely fictitious and entirely plausible.
   */
  const asGrid = (g: NonNullable<typeof a.data>) => ({
    rows: g.rows, cols: g.cols, cellSize: g.cellSizeFt, elevations: g.elevations,
    ...(g.origin ? { origin: g.origin } : {}),
  });

  let progress;
  try {
    progress = progressAgainstDesign(asGrid(a.data), asGrid(b.data), asGrid(d.data));
  } catch (err) {
    return (
      <p className="text-sm text-charcoal-500">
        {err instanceof Error ? err.message : 'The surfaces could not be compared.'}
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <Row label="Complete" value={percent(progress.percentComplete, 1)} strong />
      <Row label="Cells at grade" value={`${integer(progress.cellsAtGrade)}`} />
      <Separator />
      <Row label="Cut past design grade" value={`${integer(progress.cellsOverExcavated)} cells`} />
      <Row label="To bring back and recompact"
        value={`${qty(progress.overExcavationBcy, 0)} BCY`} strong />
      <p className="rounded-md bg-charcoal-50 p-3 text-[11px] leading-relaxed text-charcoal-600">
        Over-excavation is not progress. A cell cut below design grade is fill that has to come
        back, and counting it would report a job further along than it is.
      </p>
      {progress.warnings.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-warn-700">
          {progress.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function SurveyPage() {
  const [tab, setTab] = useState('volumes');
  /* Which card on the volumes tab a tile is pointing at, carried over from the
     page this replaces: a number on a tile answers the question it raises. */
  const [showing, setShowing] = useState<string | null>(null);
  /* Machine control files that are live, versus every version ever published —
     the superseded ones stay visible because a machine may still be on one. */
  const [publishedOnly, setPublishedOnly] = useState(false);
  const surveysQ = useQuery(loadSurveys, []);
  const comparisonsQ = useQuery(loadSurfaceComparisons, []);
  const filesQ = useQuery(loadMachineFiles, []);
  const soilQ = useQuery(loadSoilDefaults, []);

  const surveys = surveysQ.status === 'ready' ? surveysQ.data : [];
  const comparisons = comparisonsQ.status === 'ready' ? comparisonsQ.data : [];
  const files = filesQ.status === 'ready' ? filesQ.data : [];
  const soil = soilQ.status === 'ready' ? soilQ.data : null;

  const [chosen, setChosen] = useState<string | null>(null);
  const comparison = comparisons.find((c) => c.id === chosen) ?? comparisons[0] ?? null;
  const asBuiltQ = useQuery(loadAsBuiltSurfaceId(comparison?.projectId ?? ''),
    [comparison?.projectId]);
  const asBuiltId = asBuiltQ.status === 'ready' ? asBuiltQ.data : null;

  const published = files.filter((f) => f.status === 'published' && f.supersededById === null);
  const unacknowledged = files.flatMap((f) =>
    f.assignedTo.filter((m) => !m.acknowledged).map((m) => ({ file: f.name, asset: m.assetCode })));

  /*
   * The balance, from the stored volumes and the company's own soil. Swell and
   * shrink are read; the unsuitable fraction is left at zero because no column
   * holds one and assuming a number here buys dirt nobody asked for.
   */
  const balance = comparison && soil
    ? analyzeCutFill({
      cutBcy: comparison.cutBcy,
      fillCcy: comparison.fillCcy,
      swellPercent: soil.swellPercent,
      shrinkPercent: soil.shrinkPercent,
    })
    : null;

  if (surveysQ.status === 'demonstration') {
    return (
      <div className="space-y-6">
        <PageHeader title="Survey & Grade"
          description="What was measured on the ground, and what it means for moving dirt." />
        <DemonstrationNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Survey & Grade"
        description="What was measured on the ground, and what it means for moving dirt. A surface produces bank cut and compacted fill from geometry; the soil properties are applied after, because a surface knows nothing about them."
      />

      {unacknowledged.length ? (
        <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
          title={`${plural(unacknowledged.length, 'machine')} has not acknowledged its file`}>
          {unacknowledged.map((u) => `${u.asset} (${u.file})`).join('; ')}. Sent and acknowledged are
          different facts — a file the machine has not confirmed is a file the operator may not be
          cutting to.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Cut" value={comparison ? `${integer(comparison.cutBcy)} BCY` : '—'}
          icon={<Mountain className="size-4" />}
          hint={comparison ? `bank yards over ${integer(comparison.cutAreaSf)} sf` : 'no comparison yet'}
          onClick={() => { setTab('volumes'); setShowing('measured-to-priced'); }}
          active={tab === 'volumes' && showing === 'measured-to-priced'}
          actionLabel="Show how the measured cut becomes a priced quantity" />
        {/*
          * Carried over from the page this replaces, and the most useful thing
          * on it: bank, compacted and loose yards are three units of the same
          * dirt, which is why a job with equal cut and fill is not balanced.
          */}
        <StatTile label="Fill" value={comparison ? `${integer(comparison.fillCcy)} CCY` : '—'}
          icon={<Layers className="size-4" />}
          hint={comparison ? `over ${integer(comparison.fillAreaSf)} sf` : 'no comparison yet'}
          detail={comparison ? (
            <div className="space-y-2">
              <p>
                Compacted cubic yards — the hole the fill has to fill, measured in place after
                compaction. The cut beside it is <em>bank</em> yards, the ground as it sits, and
                the two are different units of the same dirt.
              </p>
              <p>
                That is why a job with equal cut and fill is not balanced.
                {' '}{integer(comparison.cutBcy)} BCY of cut shrinks
                to {balance ? qty(balance.reusableAsCompactedCcy, 0) : '—'} CCY once it is placed
                and rolled — and it is that number, not the cut, that is set against this one.
              </p>
            </div>
          ) : undefined} />
        <StatTile label="Balance" value={balance ? titleCase(balance.condition) : '—'}
          tone={balance?.condition === 'balanced' ? 'success' : 'warn'}
          icon={<Mountain className="size-4" />}
          hint={balance
            ? (balance.exportBcy > 0 ? `${integer(balance.exportBcy)} BCY to export`
              : balance.importCcy > 0 ? `${integer(balance.importCcy)} CCY to import`
                : 'the reusable cut makes the fill')
            : 'no comparison yet'}
          detail={balance && soil ? (
            <div className="space-y-2">
              <p>
                Whether the site&apos;s own dirt makes its own fill, after the adjustment that
                decides it: what is cut shrinks when it is compacted, at this
                company&apos;s {percent(soil.shrinkPercent, 0)}.
              </p>
              <p>
                {balance.exportBcy > 0
                  ? `The surplus is ${qty(balance.exportBcy, 0)} BCY, which trucks as ${qty(balance.exportLcy, 0)} LCY once it is loose in the bed — a third unit again, and the one the haul is actually priced in.`
                  : balance.importCcy > 0
                    ? `The shortfall is ${qty(balance.importCcy, 0)} CCY placed, which is ${qty(balance.importBcy, 0)} BCY to buy, because a supplier sells bank yards and the job needs compacted ones.`
                    : 'Neither export nor import is needed: the reusable cut makes the fill.'}
              </p>
              <p>
                No unsuitable fraction is subtracted first. Nothing records one for this site, and
                a number chosen here would import or export dirt nobody decided on.
              </p>
            </div>
          ) : undefined} />
        <StatTile label="Surveys" value={surveys.length} icon={<MapPin className="size-4" />}
          hint={`${plural(published.length, 'live machine file')}`}
          onClick={() => setTab('surveys')} active={tab === 'surveys'}
          actionLabel="Show the survey captures" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="volumes">Surface volumes</TabsTrigger>
          <TabsTrigger value="surveys">Surveys ({surveys.length})</TabsTrigger>
          <TabsTrigger value="machine">Machine control ({published.length} live)</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- volumes */}
        <TabsContent value="volumes" className="space-y-6">
          {comparisonsQ.status === 'loading' ? <LoadingState label="Reading the comparisons" /> : null}
          {comparisonsQ.status === 'error'
            ? <ErrorState message={comparisonsQ.message} onRetry={comparisonsQ.refetch} /> : null}
          {comparisonsQ.status === 'ready' && comparisons.length === 0 ? (
            <EmptyState title="No surface comparison yet"
              description="A comparison is an existing surface measured against a design one, and the database refuses the ones that would be wrong: surfaces from different projects, different datums, a different coordinate system, different units or a different grid." />
          ) : null}

          {comparisons.length > 1 ? (
            <select aria-label="Which comparison"
              value={comparison?.id ?? ''}
              onChange={(e) => setChosen(e.target.value)}
              className="h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm">
              {comparisons.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.projectNumber ? ` — ${c.projectNumber}` : ''}
                </option>
              ))}
            </select>
          ) : null}

          {comparison ? (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <Card id="cut-and-fill-depth">
                <CardHeader>
                  <CardTitle>Cut and fill depth</CardTitle>
                  <CardDescription>
                    {comparison.existingSurfaceName ?? 'Existing'} against{' '}
                    {comparison.designSurfaceName ?? 'design'}. Hover any cell for its depth.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DepthMap existingId={comparison.existingSurfaceId}
                    designId={comparison.designSurfaceId} />
                </CardContent>
              </Card>

              <Card id="measured-to-priced">
                <CardHeader>
                  <CardTitle>Measured to priced</CardTitle>
                  <CardDescription>
                    The volumes are as computed when the comparison was made, on{' '}
                    {date(comparison.computedAt)}. The soil properties are applied after, because a
                    surface knows nothing about them.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Row label="Measured cut" value={`${qty(comparison.cutBcy, 0)} BCY`} />
                  <Row label="Measured fill" value={`${qty(comparison.fillCcy, 0)} CCY`} />
                  {comparison.maxCutDepthFt !== null ? (
                    <Row label="Deepest cut" value={`${qty(comparison.maxCutDepthFt, 2)} ft`} />
                  ) : null}
                  {comparison.maxFillDepthFt !== null ? (
                    <Row label="Deepest fill" value={`${qty(comparison.maxFillDepthFt, 2)} ft`} />
                  ) : null}
                  {/*
                    * Said out loud, because a volume over four fifths of a site
                    * is not a volume for the site and nothing else on the page
                    * would reveal it.
                    */}
                  <Row label="Survey coverage" value={percent(comparison.coverage, 1)}
                    strong={comparison.coverage < 1} />
                  <Separator />
                  {balance && soil ? (
                    <>
                      <Row label={`Makes compacted at ${percent(soil.shrinkPercent, 0)} shrink`}
                        value={`${qty(balance.reusableAsCompactedCcy, 0)} CCY`} strong />
                      <Row label="Condition" value={titleCase(balance.condition)} strong />
                      {balance.exportBcy > 0 ? (
                        <>
                          <Row label="Export" value={`${qty(balance.exportBcy, 0)} BCY`} />
                          <Row label={`To truck at ${percent(soil.swellPercent, 0)} swell`}
                            value={`${qty(balance.exportLcy, 0)} LCY`} strong />
                        </>
                      ) : null}
                      {balance.importCcy > 0 ? (
                        <Row label="Import"
                          value={`${qty(balance.importCcy, 0)} CCY (${qty(balance.importBcy, 0)} BCY to buy)`}
                          strong />
                      ) : null}
                      <p className="rounded-md bg-charcoal-50 p-3 text-[11px] leading-relaxed text-charcoal-600">
                        Swell and shrink are this company&apos;s own figures. No unsuitable fraction
                        is assumed: nothing records one for this site, and a number chosen here
                        would import or export dirt nobody decided on.
                      </p>
                      {/*
                        * The engine publishes how it got there. Shown because a
                        * balance figure somebody cannot reproduce is a number to
                        * argue with rather than a number to act on.
                        */}
                      <p className="rounded-md bg-charcoal-50 p-3 font-mono text-[11px] leading-relaxed text-charcoal-600">
                        {balance.derivation}
                      </p>
                    </>
                  ) : (
                    <p className="text-charcoal-500">
                      The balance needs the company&apos;s swell and shrink figures, which have not
                      been read.
                    </p>
                  )}
                </CardContent>
              </Card>

              {asBuiltId ? (
                <Card id="progress-to-grade" className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Progress to grade</CardTitle>
                    <CardDescription>
                      The as-built against the design, with what was cut too deep kept separate
                      from what is finished.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ProgressPanel existingId={comparison.existingSurfaceId}
                      designId={comparison.designSurfaceId} asBuiltId={asBuiltId} />
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </TabsContent>

        {/* ---------------------------------------------------------- surveys */}
        <TabsContent value="surveys">
          <Card>
            <CardHeader>
              <CardTitle>Survey captures</CardTitle>
              <CardDescription>
                Every capture carries its horizontal and vertical datum, its coordinate system and
                its units, because a comparison across any mismatch is wrong rather than
                approximate — and the database refuses it rather than reporting a number. Earthwork
                quantity is what a heavy civil bid is won or lost on.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {surveysQ.status === 'loading' ? <LoadingState label="Reading the captures" /> : null}
              {surveysQ.status === 'error'
                ? <ErrorState message={surveysQ.message} onRetry={surveysQ.refetch} /> : null}
              {surveysQ.status === 'ready' && surveys.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No surveys yet"
                    description="A survey is a capture of the ground on a date, by a method, on a stated datum." />
                </div>
              ) : null}
              {surveys.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Survey</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Captured</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead>Surfaces</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {surveys.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium text-charcoal-900">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs text-charcoal-600">
                          {s.projectId && s.projectNumber ? (
                            <Link to={`/app/projects/${s.projectId}`} className="hover:underline">
                              {s.projectNumber}
                            </Link>
                          ) : (s.projectNumber ?? '—')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-charcoal-600">
                          {date(s.capturedOn)}
                          {s.capturedBy ? <span className="block text-xs">{s.capturedBy}</span> : null}
                        </TableCell>
                        <TableCell><Badge variant="outline">{titleCase(s.captureMethod)}</Badge></TableCell>
                        <TableCell className="text-xs text-charcoal-600">
                          {s.horizontalDatum} / {s.verticalDatum}
                          <span className="block text-charcoal-400">{titleCase(s.units)}</span>
                        </TableCell>
                        <TableCell className="tabular text-right text-charcoal-600">
                          {s.pointCount === null ? '—' : integer(s.pointCount)}
                        </TableCell>
                        <TableCell className="text-xs text-charcoal-600">
                          {s.surfaces.length === 0 ? '—'
                            : s.surfaces.map((f) => `${f.name} (${titleCase(f.role)})`).join(', ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- machine control */}
        <TabsContent value="machine">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Radio className="size-4" /> Machine control files
              </CardTitle>
              <CardDescription>
                What each machine is cutting to. A published file supersedes the one before it, and
                a machine that has not acknowledged the current version may still be working to the
                old one.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {filesQ.status === 'loading' ? <LoadingState label="Reading the files" /> : null}
              {filesQ.status === 'error'
                ? <ErrorState message={filesQ.message} onRetry={filesQ.refetch} /> : null}
              {filesQ.status === 'ready' && files.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No machine control files"
                    description="A machine control file is a design surface in a format a grader or dozer can read." />
                </div>
              ) : null}
              {files.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 px-6 pb-3 text-sm text-charcoal-600">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={publishedOnly}
                        onChange={(e) => setPublishedOnly(e.target.checked)} />
                      Only the files a machine could be cutting to
                    </label>
                    <span className="text-xs text-charcoal-500">
                      {published.length} of {files.length} published and not superseded
                    </span>
                  </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Surface</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>On machines</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(publishedOnly ? published : files).map((f) => (
                      <TableRow key={f.id} className={cn(f.supersededById && 'opacity-60')}>
                        <TableCell>
                          <p className="font-medium text-charcoal-900">{f.name}</p>
                          <Badge variant={f.status === 'published' ? 'success'
                            : f.status === 'draft' ? 'outline' : 'warn'}>
                            {titleCase(f.status)}
                          </Badge>
                          {f.supersededById ? (
                            <Badge variant="outline" className="ml-1">Superseded</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-charcoal-600">
                          {f.projectNumber ?? '—'}
                        </TableCell>
                        <TableCell className="text-charcoal-600">{f.surfaceName ?? '—'}</TableCell>
                        <TableCell className="text-xs text-charcoal-600">
                          {f.fileFormat.toUpperCase()}
                          {f.vendor ? <span className="block">{titleCase(f.vendor)}</span> : null}
                        </TableCell>
                        <TableCell className="tabular text-charcoal-600">
                          v{f.version}
                          {f.publishedAt ? (
                            <span className="block text-xs">{date(f.publishedAt)}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {f.assignedTo.length === 0
                            ? <span className="text-xs text-charcoal-400">not sent</span>
                            : (
                              <ul className="space-y-0.5 text-xs">
                                {f.assignedTo.map((m) => (
                                  <li key={m.assetId} className="flex items-center gap-1.5">
                                    {m.acknowledged
                                      ? <CheckCircle2 className="size-3 text-success-600" />
                                      : <AlertTriangle className="size-3 text-warn-600" />}
                                    {m.assetId ? (
                                      <Link to={`/app/fleet?asset=${m.assetId}`}
                                        className="font-mono hover:underline">{m.assetCode}</Link>
                                    ) : <span className="font-mono">{m.assetCode}</span>}
                                    <span className="text-charcoal-400">
                                      {m.acknowledged ? 'acknowledged' : 'not acknowledged'}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import {
  Mountain, Plane, Radio, Upload, AlertTriangle, CheckCircle2, Layers, Ruler, TriangleAlert,
} from 'lucide-react';
import { PageHeader, StatTile, Field } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Progress, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  SURVEYS, MC_FILES, SURFACE_COMPARISON, SURFACE_PROGRESS, ROAD_AEA, ROAD_PRISMOIDAL,
  EXISTING_SURFACE, DESIGN_SURFACE,
} from '@/data/survey';
import { analyzeCutFill } from '@grounup/engine';
import { qty, integer, percent, date, titleCase, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The measured volume converted into the states an estimate prices in.
 *
 * The surface produces bank cut and compacted fill from geometry; this applies
 * the soil properties the surface knows nothing about. Keeping the two steps
 * separate is the whole reason a surveyor's number and an estimator's number
 * can both be right.
 */
const BALANCE = analyzeCutFill({
  cutBcy: SURFACE_COMPARISON.cutBcy,
  fillCcy: SURFACE_COMPARISON.fillCcy,
  unsuitablePercent: 0.06,
  swellPercent: 0.25,
  shrinkPercent: 0.1,
});

/** A coarse heat map of the cut/fill depths, drawn from the actual grids. */
function DepthMap() {
  const { rows, cols } = EXISTING_SURFACE;
  const depths: (number | null)[] = EXISTING_SURFACE.elevations.map((e, i) => {
    const d = DESIGN_SURFACE.elevations[i];
    if (e === null || d === null || d === undefined) return null;
    return e - d;
  });
  const maxCut = SURFACE_COMPARISON.maxCutDepth || 1;
  const maxFill = SURFACE_COMPARISON.maxFillDepth || 1;

  return (
    <div>
      <div
        className="grid w-full max-w-md gap-px rounded-md bg-charcoal-200 p-px"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`Cut and fill depth map, ${rows} by ${cols} cells at ${EXISTING_SURFACE.cellSize} ft`}
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
            <span
              key={i}
              className="aspect-square"
              style={{ backgroundColor: color }}
              title={`${d > 0 ? 'Cut' : 'Fill'} ${Math.abs(d).toFixed(2)} ft`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-charcoal-500">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ backgroundColor: 'rgba(246,193,1,1)' }} />
          Cut, to {SURFACE_COMPARISON.maxCutDepth} ft
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ backgroundColor: 'rgba(37,99,235,1)' }} />
          Fill, to {SURFACE_COMPARISON.maxFillDepth} ft
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-charcoal-100" />
          No data
        </span>
      </div>
    </div>
  );
}

export function SurveyPage() {
  const published = MC_FILES.filter((f) => f.status === 'published');
  const superseded = MC_FILES.filter((f) => f.status === 'superseded');
  const assigned = MC_FILES.flatMap((f) => f.assignedTo);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Survey & Machine Control"
        description="A drone flight or a rover survey becomes a quantity here. The volume comes from the same deterministic engine that prices the work, so a measured yard and an estimated yard are the same yard."
        actions={
          <>
            <Button variant="outline"><Upload className="size-4" /> Import surface</Button>
            <Button><Plane className="size-4" /> New survey</Button>
          </>
        }
      />

      {SURFACE_PROGRESS.overExcavationBcy > 0 ? (
        <Alert tone="warn" icon={<TriangleAlert className="size-4" />}
          title={`${qty(SURFACE_PROGRESS.overExcavationBcy, 0)} BCY cut below design grade`}>
          {plural(SURFACE_PROGRESS.cellsOverExcavated, 'cell')} on the latest flight sit more than
          {' '}{SURFACE_PROGRESS.toleranceFt} ft below subgrade. That is material to bring back and recompact — it is
          excluded from progress rather than counted as being ahead.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Cut" value={`${integer(SURFACE_COMPARISON.cutBcy)} BCY`} icon={<Mountain className="size-4" />}
          hint={`avg ${SURFACE_COMPARISON.averageCutDepth} ft over ${integer(SURFACE_COMPARISON.cutAreaSf / 43_560)} acres`} />
        <StatTile label="Fill" value={`${integer(SURFACE_COMPARISON.fillCcy)} CCY`}
          hint={`avg ${SURFACE_COMPARISON.averageFillDepth} ft over ${integer(SURFACE_COMPARISON.fillAreaSf / 43_560)} acres`} />
        <StatTile label="Balance" value={titleCase(BALANCE.condition)}
          tone={BALANCE.condition === 'balanced' ? 'success' : 'warn'}
          hint={BALANCE.exportBcy ? `${integer(BALANCE.exportBcy)} BCY to export` : `${integer(BALANCE.importCcy)} CCY to import`} />
        <StatTile label="Progress to grade" value={percent(SURFACE_PROGRESS.percentComplete, 1)}
          icon={<Ruler className="size-4" />}
          hint={`${integer(SURFACE_PROGRESS.cellsAtGrade)} cells at grade ±${SURFACE_PROGRESS.toleranceFt} ft`} />
        <StatTile label="Survey coverage" value={percent(SURFACE_COMPARISON.coverage, 1)}
          tone={SURFACE_COMPARISON.coverage >= 0.85 ? 'success' : 'danger'}
          icon={<Layers className="size-4" />}
          hint={`${integer(SURFACE_COMPARISON.cellsSkipped)} cells outside the boundary`} />
      </div>

      <Tabs defaultValue="volumes">
        <TabsList>
          <TabsTrigger value="volumes">Surface volumes</TabsTrigger>
          <TabsTrigger value="sections">Cross sections</TabsTrigger>
          <TabsTrigger value="surveys">Surveys ({SURVEYS.length})</TabsTrigger>
          <TabsTrigger value="machine">Machine control ({published.length} live)</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- volumes */}
        <TabsContent value="volumes" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Cut and fill depth</CardTitle>
                <CardDescription>
                  Existing ground against design subgrade, {EXISTING_SURFACE.rows} × {EXISTING_SURFACE.cols} cells
                  at {EXISTING_SURFACE.cellSize} ft. Hover any cell for its depth.
                </CardDescription>
              </CardHeader>
              <CardContent><DepthMap /></CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Measured to priced</CardTitle>
                <CardDescription>
                  The surface produces bank cut and compacted fill from geometry. The soil properties — swell,
                  shrink, what is unsuitable — are applied after, because a surface knows nothing about them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Measured cut" value={`${qty(SURFACE_COMPARISON.cutBcy, 0)} BCY`} />
                <Row label="Measured fill" value={`${qty(SURFACE_COMPARISON.fillCcy, 0)} CCY`} />
                <Separator />
                <Row label="Unsuitable at 6%" value={`${qty(BALANCE.unsuitableBcy, 0)} BCY`} />
                <Row label="Reusable cut" value={`${qty(BALANCE.reusableCutBcy, 0)} BCY`} />
                <Row label="Makes compacted at 10% shrink" value={`${qty(BALANCE.reusableAsCompactedCcy, 0)} CCY`} strong />
                <Separator />
                <Row label="Condition" value={titleCase(BALANCE.condition)} strong />
                {BALANCE.exportBcy > 0 ? (
                  <>
                    <Row label="Export" value={`${qty(BALANCE.exportBcy, 0)} BCY`} />
                    <Row label="To truck at 25% swell" value={`${qty(BALANCE.exportLcy, 0)} LCY`} strong />
                  </>
                ) : null}
                {BALANCE.importCcy > 0 ? (
                  <Row label="Import" value={`${qty(BALANCE.importCcy, 0)} CCY (${qty(BALANCE.importBcy, 0)} BCY to buy)`} strong />
                ) : null}
                <p className="rounded-md bg-charcoal-50 p-3 font-mono text-[11px] leading-relaxed text-charcoal-600">
                  {BALANCE.derivation}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Progress against design</CardTitle>
              <CardDescription>
                The latest flight compared against subgrade. Cutting below design is rework, not progress — it is
                separated out rather than counted toward completion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-charcoal-600">Earthwork complete</span>
                  <span className="tabular font-semibold">{percent(SURFACE_PROGRESS.percentComplete, 1)}</span>
                </div>
                <Progress value={SURFACE_PROGRESS.percentComplete * 100} className="mt-1.5"
                  indicatorClassName="bg-success-600" />
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Completed cut">{qty(SURFACE_PROGRESS.completedCutBcy, 0)} BCY</Field>
                <Field label="Remaining cut">{qty(SURFACE_PROGRESS.remainingCutBcy, 0)} BCY</Field>
                <Field label="Cells at grade">{integer(SURFACE_PROGRESS.cellsAtGrade)}</Field>
                <Field label="Over-excavated">
                  <span className={SURFACE_PROGRESS.overExcavationBcy > 0 ? 'text-warn-700' : ''}>
                    {qty(SURFACE_PROGRESS.overExcavationBcy, 0)} BCY
                  </span>
                </Field>
              </dl>
              <p className="rounded-md bg-charcoal-50 p-3 font-mono text-[11px] leading-relaxed text-charcoal-600">
                {SURFACE_PROGRESS.derivation}
              </p>
            </CardContent>
          </Card>

          {SURFACE_COMPARISON.warnings.length ? (
            <div className="space-y-2">
              {SURFACE_COMPARISON.warnings.slice(0, 5).map((w, i) => (
                <Alert key={i} tone="warn" icon={<AlertTriangle className="size-4" />}>{w}</Alert>
              ))}
            </div>
          ) : null}
        </TabsContent>

        {/* --------------------------------------------------------- sections */}
        <TabsContent value="sections">
          <Card>
            <CardHeader>
              <CardTitle>Entrance drive — cross-section volumes</CardTitle>
              <CardDescription>
                Average end area is the default because it is what a DOT earthwork summary uses, so the number
                reconciles against the engineer's. Prismoidal only differs where a mid-section was actually
                surveyed — substituting the mean of the two ends reduces the formula back to average end area.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Segment</TableHead>
                    <TableHead className="text-right">Length</TableHead>
                    <TableHead className="text-right">Cut</TableHead>
                    <TableHead className="text-right">Fill</TableHead>
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ROAD_PRISMOIDAL.segments.map((s) => (
                    <TableRow key={`${s.fromStation}-${s.toStation}`}>
                      <TableCell className="font-mono text-xs text-charcoal-700">
                        {(s.fromStation / 100).toFixed(2).replace('.', '+')} – {(s.toStation / 100).toFixed(2).replace('.', '+')}
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{integer(s.lengthFt)} ft</TableCell>
                      <TableCell className="tabular text-right">{s.cutBcy ? `${qty(s.cutBcy, 1)} BCY` : '—'}</TableCell>
                      <TableCell className="tabular text-right">{s.fillCcy ? `${qty(s.fillCcy, 1)} CCY` : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={s.method === 'prismoidal' ? 'success' : 'default'}>
                          {s.method === 'prismoidal' ? 'Prismoidal' : 'Average end area'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-charcoal-50">
                    <TableCell>Total ({ROAD_PRISMOIDAL.stations} sections)</TableCell>
                    <TableCell className="tabular text-right">{integer(ROAD_PRISMOIDAL.lengthFt)} ft</TableCell>
                    <TableCell className="tabular text-right">{qty(ROAD_PRISMOIDAL.cutBcy, 1)} BCY</TableCell>
                    <TableCell className="tabular text-right">{qty(ROAD_PRISMOIDAL.fillCcy, 1)} CCY</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          <Alert tone="info" className="mt-4" icon={<Ruler className="size-4" />}
            title="What the mid-section is worth">
            Average end area gives {qty(ROAD_AEA.fillCcy, 1)} CCY of fill across this run; with the one surveyed
            mid-section the prismoidal method gives {qty(ROAD_PRISMOIDAL.fillCcy, 1)} CCY. The difference is real —
            average end area overstates wherever a section changes shape between stations, and understates where it
            pinches. {plural(ROAD_PRISMOIDAL.segmentsWithoutMidSection, 'segment')} here still lack a mid-section
            and fall back to average end area.
          </Alert>
        </TabsContent>

        {/* ---------------------------------------------------------- surveys */}
        <TabsContent value="surveys">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Survey</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Area</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SURVEYS.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{s.name}</p>
                      <p className="text-xs text-charcoal-500">{s.surfaces.join(', ')}</p>
                    </TableCell>
                    <TableCell><Badge variant="outline">{titleCase(s.method)}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-charcoal-600">{date(s.capturedOn)}</TableCell>
                    <TableCell className="text-charcoal-600">{s.capturedBy}</TableCell>
                    <TableCell className="font-mono text-xs text-charcoal-700">{s.verticalDatum}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{integer(s.pointCount)}</TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">{qty(s.areaSf / 43_560, 1)} ac</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>

          <Alert tone="neutral" className="mt-4" icon={<CheckCircle2 className="size-4" />}
            title="Why the datum column matters">
            A volume computed between two surfaces on different vertical datums is wrong by the offset between
            them, and looks entirely plausible. The database refuses the comparison rather than returning a
            confident wrong number.
          </Alert>
        </TabsContent>

        {/* ---------------------------------------------------- machine control */}
        <TabsContent value="machine">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Radio className="size-4" /> Machine control files</CardTitle>
              <CardDescription>
                A superseded design must name its replacement, so an operator can always be told which file is
                current. A stale file left live on a dozer is how a crew builds last week's grade.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Design</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="text-right">Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead>On machines</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MC_FILES.map((f) => (
                    <TableRow key={f.id} className={cn(f.status === 'superseded' && 'opacity-55')}>
                      <TableCell className="font-medium text-charcoal-900">{f.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">{f.format.toUpperCase()}</Badge>
                        <span className="ml-1.5 text-xs text-charcoal-500">{titleCase(f.vendor)}</span>
                      </TableCell>
                      <TableCell className="tabular text-right">v{f.version}</TableCell>
                      <TableCell>
                        <Badge variant={
                          f.status === 'published' ? 'success' : f.status === 'draft' ? 'default' : 'warn'
                        }>{titleCase(f.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">
                        {f.publishedAt ? <>{date(f.publishedAt)}<br /><span className="text-charcoal-400">{f.publishedBy}</span></> : '—'}
                      </TableCell>
                      <TableCell>
                        {f.assignedTo.length ? (
                          <div className="flex flex-wrap gap-1">
                            {f.assignedTo.map((a) => (
                              <Badge key={a} variant="info" className="font-mono text-[10px]">{a}</Badge>
                            ))}
                          </div>
                        ) : <span className="text-xs text-charcoal-400">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatTile label="Published designs" value={published.length} tone="success" />
            <StatTile label="Superseded" value={superseded.length}
              hint="retained, each naming its replacement" />
            <StatTile label="Machines running a design" value={new Set(assigned).size}
              hint="one current file per machine, enforced" />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', strong && 'border-t border-charcoal-200 pt-2')}>
      <span className={strong ? 'font-medium text-charcoal-900' : 'text-charcoal-600'}>{label}</span>
      <span className={cn('tabular', strong ? 'font-semibold text-charcoal-900' : 'text-charcoal-700')}>{value}</span>
    </div>
  );
}

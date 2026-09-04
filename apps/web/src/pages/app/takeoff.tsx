import { useMemo, useState } from 'react';
import { Ruler, MousePointerClick, Minus, Square, Box, Hash, Undo2, Trash2, Scissors } from 'lucide-react';
import type { Point } from '@grounup/engine';
import { PageHeader } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MeasurementOverlay, MINIMUM_POINTS, type Tool } from '@/components/takeoff/overlay';
import { SheetCanvas } from '@/components/takeoff/sheet-canvas';
import { MeasurePanel, tryResolveScale, type ScaleState } from '@/components/takeoff/measure-panel';
import { cn } from '@/lib/utils';

/**
 * On-screen takeoff.
 *
 * Earthwork already had a route to a quantity — surfaces compared cell by cell.
 * Every other trade measured on paper and typed the answer in. This is the
 * measuring: a pipe run traced along a plan, a slab outlined, fixtures counted,
 * a roof taken off and corrected for pitch.
 *
 * The screen is arranged around the one thing that decides whether a
 * measurement can become a bid: the scale, and what it was checked against. It
 * is the first thing asked for, it is stated on every measurement taken at it,
 * and an unverified one says so in the same place the number appears — because
 * an estimator who learns at the moment of tracing that the scale was never
 * verified fixes it, and one who learns later does not.
 */
const TOOLS: { tool: Tool; label: string; icon: typeof Ruler; hint: string }[] = [
  { tool: 'calibrate', label: 'Set scale', icon: Ruler,
    hint: 'Click the two ends of a dimension printed on the sheet.' },
  { tool: 'count', label: 'Count', icon: Hash, hint: 'Click each item.' },
  { tool: 'linear', label: 'Length', icon: Minus, hint: 'Trace the run. Give it a width for area.' },
  { tool: 'area', label: 'Area', icon: Square, hint: 'Outline the shape.' },
  { tool: 'volume', label: 'Volume', icon: Box, hint: 'Outline the shape and give it a depth.' },
  { tool: 'deduct', label: 'Deduct', icon: Scissors, hint: 'Outline an opening to subtract.' },
];

const UNITS_FOR: Record<string, string[]> = {
  count: ['EA'], linear: ['LF'], area: ['SF', 'SY', 'ACRE'], volume: ['CY'],
};

export function TakeoffPage() {
  const [tool, setTool] = useState<Tool>('calibrate');
  const [points, setPoints] = useState<Point[]>([]);
  const [deductions, setDeductions] = useState<Point[][]>([]);
  const [sheetSize, setSheetSize] = useState({ width: 1224, height: 792 });
  const [zoom, setZoom] = useState(1);

  const [scaleState, setScaleState] = useState<ScaleState | null>(null);
  const [knownFeet, setKnownFeet] = useState('20');
  const [basis, setBasis] = useState<ScaleState['basis']>('known_dimension');
  const [reference, setReference] = useState('');

  const [unit, setUnit] = useState('LF');
  const [widthFeet, setWidthFeet] = useState('');
  const [depthFeet, setDepthFeet] = useState('');
  const [pitchRise, setPitchRise] = useState('');
  const [countPer, setCountPer] = useState('1');
  const [multiplier, setMultiplier] = useState('1');

  const resolved = useMemo(() => tryResolveScale(scaleState), [scaleState]);
  const scale = resolved && 'scale' in resolved ? resolved.scale : null;
  const scaleError = resolved && 'error' in resolved ? resolved.error : null;

  const displayWidth = Math.round(900 * zoom);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  function chooseTool(next: Tool) {
    setTool(next);
    setPoints([]);
    if (next !== 'deduct') setDeductions([]);
    const allowed = UNITS_FOR[next];
    if (allowed && !allowed.includes(unit)) setUnit(allowed[0]!);
  }

  /** Turn the two calibration points into a scale everything else is measured at. */
  function applyCalibration() {
    if (points.length < 2) return;
    setScaleState({
      from: points[0]!, to: points[1]!,
      knownDistanceFeet: Number(knownFeet) || 0,
      basis, reference,
    });
    setPoints([]);
    setTool('linear');
  }

  function bankDeduction() {
    if (points.length < 3) return;
    setDeductions([...deductions, points]);
    setPoints([]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Takeoff"
        description="Measure quantities off the drawings. Every measurement records the scale it was taken at and what that scale was checked against, because a quantity scaled off an unverified print is not the same claim as one checked against a printed dimension."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</Button>
            <span className="tabular w-12 text-center text-sm text-charcoal-600">
              {Math.round(zoom * 100)}%
            </span>
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>+</Button>
          </div>
        }
      />

      {!scale ? (
        <Alert tone="info" icon={<Ruler className="size-4" />} title="Set the scale before measuring">
          Click the two ends of a dimension printed on the sheet, type what it reads, and say
          which dimension it was. That is what earns a verified scale — and a verified scale is
          what lets a measurement carry weight all the way to an issued estimate.
        </Alert>
      ) : null}
      {scaleError ? <Alert tone="danger">{scaleError}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* ------------------------------------------------------- the sheet */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 border-b border-charcoal-200">
            {TOOLS.map(({ tool: t, label, icon: Icon }) => (
              <Button key={t} size="sm" variant={tool === t ? 'default' : 'outline'}
                onClick={() => chooseTool(t)}>
                <Icon className="size-4" /> {label}
              </Button>
            ))}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" disabled={!points.length}
                onClick={() => setPoints(points.slice(0, -1))}>
                <Undo2 className="size-4" /> Undo point
              </Button>
              <Button size="sm" variant="ghost" disabled={!points.length}
                onClick={() => setPoints([])}>
                <Trash2 className="size-4" /> Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-auto bg-charcoal-100 p-4">
            <div className="relative mx-auto" style={{ width: displayWidth }}>
              <SheetCanvas source="" pageNumber={1} displayWidth={displayWidth}
                onSize={setSheetSize} />
              <MeasurementOverlay
                tool={tool}
                width={sheetSize.width} height={sheetSize.height}
                displayWidth={displayWidth}
                points={points} onPointsChange={setPoints}
                existing={deductions.map((d, i) => ({ id: `d-${i}`, points: d, kind: 'deduct' as Tool }))}
              />
            </div>
            <p className="mt-3 text-center text-xs text-charcoal-500">
              {TOOLS.find((t) => t.tool === tool)?.hint}
              {points.length ? ` ${points.length} of ${MINIMUM_POINTS[tool]} minimum placed.` : ''}
            </p>
          </CardContent>
        </Card>

        {/* -------------------------------------------------------- the panel */}
        <div className="space-y-4">
          {tool === 'calibrate' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Set the scale</CardTitle>
                <CardDescription>
                  Click both ends of a known dimension, then say what it reads.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="known">That distance, in feet</Label>
                  <Input id="known" value={knownFeet} inputMode="decimal"
                    onChange={(e) => setKnownFeet(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="basis">Checked against</Label>
                  <Select value={basis} onValueChange={(v) => setBasis(v as ScaleState['basis'])}>
                    <SelectTrigger id="basis"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="known_dimension">A dimension printed on the drawing</SelectItem>
                      <SelectItem value="graphic_scale_bar">A graphic scale bar</SelectItem>
                      <SelectItem value="stated_scale">The scale in the title block</SelectItem>
                    </SelectContent>
                  </Select>
                  {basis !== 'known_dimension' ? (
                    <p className="text-xs text-warn-700">
                      {basis === 'graphic_scale_bar'
                        ? 'A scale bar is drawn on the sheet and reduces with it, so it proves the print is internally consistent rather than at the scale it claims.'
                        : 'Reissued and reduced prints keep stating the scale they were drawn at.'}
                      {' '}Measurements will be recorded as an approximate scale.
                    </p>
                  ) : null}
                </div>
                {basis === 'known_dimension' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="ref">Which dimension</Label>
                    <Input id="ref" value={reference} placeholder="Dimension string 20'-0&quot; on C-301"
                      onChange={(e) => setReference(e.target.value)} />
                    <p className="text-xs text-charcoal-500">
                      Required. A calibration that cannot say what it checked is recorded as approximate.
                    </p>
                  </div>
                ) : null}
                <Button className="w-full" disabled={points.length < 2} onClick={applyCalibration}>
                  <MousePointerClick className="size-4" />
                  {points.length < 2 ? `Place ${2 - points.length} more point(s)` : 'Use this scale'}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {scale ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Scale</CardTitle>
                  <Badge variant={scale.measurementMethod === 'verified_scale' ? 'success' : 'warn'}>
                    {scale.measurementMethod.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="font-mono text-xs text-charcoal-600">{scale.derivation}</p>
                <Button variant="ghost" size="sm" className="mt-2 px-0"
                  onClick={() => chooseTool('calibrate')}>Recalibrate</Button>
              </CardContent>
            </Card>
          ) : null}

          {tool !== 'calibrate' && tool !== 'none' ? (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Measurement</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-1.5">
                  <Label htmlFor="unit">Report in</Label>
                  <Select value={unit} onValueChange={setUnit}>
                    <SelectTrigger id="unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(UNITS_FOR[tool] ?? ['EA']).map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {tool === 'linear' ? (
                  <Field id="width" label="Width in feet (optional)" value={widthFeet}
                    onChange={setWidthFeet} hint="A run with a width is a strip: a path, a footing, a trench." />
                ) : null}
                {tool === 'volume' || (tool === 'linear' && widthFeet) ? (
                  <Field id="depth" label="Depth in feet" value={depthFeet} onChange={setDepthFeet} />
                ) : null}
                {tool === 'area' || tool === 'volume' ? (
                  <Field id="pitch" label="Roof pitch, rise per 12 (optional)" value={pitchRise}
                    onChange={setPitchRise}
                    hint="A plan view shows the footprint. A 6:12 roof is 11.8% more material." />
                ) : null}
                {tool === 'count' ? (
                  <Field id="per" label="Each marker counts as" value={countPer} onChange={setCountPer} />
                ) : null}
                <Field id="mult" label="Repeats" value={multiplier} onChange={setMultiplier}
                  hint="The same detail on four identical elevations." />
                {tool === 'deduct' ? (
                  <Button className="w-full" disabled={points.length < 3} onClick={bankDeduction}>
                    <Scissors className="size-4" /> Add this opening
                  </Button>
                ) : null}
                {deductions.length ? (
                  <p className="text-xs text-charcoal-500">
                    {deductions.length} opening(s) will be subtracted.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <MeasurePanel
            tool={tool} points={points} scale={scale} unit={unit}
            deductions={deductions}
            {...(num(widthFeet) === undefined ? {} : { widthFeet: num(widthFeet) })}
            {...(num(depthFeet) === undefined ? {} : { depthFeet: num(depthFeet) })}
            {...(num(pitchRise) === undefined ? {} : { pitch: { rise: num(pitchRise)!, run: 12 } })}
            {...(num(countPer) === undefined ? {} : { countPer: num(countPer) })}
            {...(num(multiplier) === undefined ? {} : { multiplier: num(multiplier) })}
          />
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className={cn('text-xs text-charcoal-500')}>{hint}</p> : null}
    </div>
  );
}

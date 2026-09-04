import { AlertTriangle, Ruler, CheckCircle2 } from 'lucide-react';
import { measure, resolveScale, type Point, type ResolvedScale, type ScaleBasis } from '@grounup/engine';
import { Alert } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { qty } from '@/lib/format';
import type { Tool } from './overlay';

/**
 * The live quantity, and how much it deserves to be believed.
 *
 * Everything here comes from the engine. The panel calls `measure()` with the
 * points on screen and shows what comes back — including the derivation and the
 * warnings, because a number an estimator cannot check is a number they have to
 * trust, and Section 23 forbids hiding the calculation.
 *
 * Showing this live is the point. An estimator who traces a roof and sees
 * "approximate scale" beside the number, with the reason, fixes the calibration
 * before the quantity reaches a bid rather than after.
 */
export interface ScaleState {
  from: Point;
  to: Point;
  knownDistanceFeet: number;
  basis: ScaleBasis;
  reference: string;
}

/** Resolve a calibration, or say why it cannot be resolved yet. */
export function tryResolveScale(s: ScaleState | null):
  { scale: ResolvedScale } | { error: string } | null {
  if (!s) return null;
  try {
    return {
      scale: resolveScale({
        from: s.from, to: s.to,
        knownDistance: s.knownDistanceFeet, knownUnit: 'LF',
        basis: s.basis,
        ...(s.reference.trim() ? { reference: s.reference.trim() } : {}),
      }),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'That calibration is not usable.' };
  }
}

export interface MeasurePanelProps {
  tool: Tool;
  points: readonly Point[];
  scale: ResolvedScale | null;
  unit: string;
  closed?: boolean;
  deductions?: readonly (readonly Point[])[];
  pitch?: { rise: number; run: number };
  depthFeet?: number;
  widthFeet?: number;
  countPer?: number;
  multiplier?: number;
}

export function MeasurePanel(props: MeasurePanelProps) {
  const { tool, points, scale, unit } = props;

  if (tool === 'none' || tool === 'calibrate' || tool === 'deduct') return null;

  if (!scale && tool !== 'count') {
    return (
      <Alert tone="warn" icon={<Ruler className="size-4" />} title="Set the scale first">
        A traced line with no calibration is a number of pixels. Calibrate against a
        dimension printed on the sheet — that is what earns a verified scale, and an
        unverified one limits how far the estimate can go.
      </Alert>
    );
  }

  let result;
  try {
    result = measure({
      kind: tool as 'count' | 'linear' | 'area' | 'volume',
      points,
      // A count does not use the scale; the engine reports it as derived.
      scale: scale ?? {
        unitsPerPoint: 1, unit: 'LF', basis: 'stated_scale',
        measurementMethod: 'approximate_scale', derivation: 'not scaled', warnings: [],
      },
      unit: unit as Parameters<typeof measure>[0]['unit'],
      ...(props.closed === undefined ? {} : { closed: props.closed }),
      ...(props.deductions?.length ? { deductions: props.deductions } : {}),
      ...(props.pitch ? { pitch: props.pitch } : {}),
      ...(props.depthFeet === undefined ? {} : { depthFeet: props.depthFeet }),
      ...(props.widthFeet === undefined ? {} : { widthFeet: props.widthFeet }),
      ...(props.countPer === undefined ? {} : { countPer: props.countPer }),
      ...(props.multiplier === undefined ? {} : { multiplier: props.multiplier }),
    });
  } catch (err) {
    // Not an error state so much as an unfinished one: three points make an
    // outline and two do not, and saying so is more use than an empty panel.
    return (
      <Alert tone="info" icon={<Ruler className="size-4" />} title="Keep going">
        {err instanceof Error ? err.message : 'More points are needed.'}
      </Alert>
    );
  }

  const verified = result.measurementMethod === 'verified_scale';

  return (
    <div className="space-y-3">
      <div className="rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
            Measured
          </span>
          <Badge variant={verified ? 'success' : result.measurementMethod === 'derived' ? 'default' : 'warn'}>
            {result.measurementMethod.replace(/_/g, ' ')}
          </Badge>
        </div>
        <p className="tabular mt-1 text-2xl font-bold text-charcoal-900">
          {qty(result.quantity, 2)} <span className="text-base font-medium text-charcoal-500">{result.unit}</span>
        </p>

        <dl className="mt-3 space-y-1 border-t border-charcoal-100 pt-3 text-xs">
          {result.lengthFeet > 0 ? (
            <Row label="Traced length" value={`${qty(result.lengthFeet, 2)} ft`} />
          ) : null}
          {result.planAreaFeet > 0 ? (
            <Row label="Plan area" value={`${qty(result.planAreaFeet, 2)} sq ft`} />
          ) : null}
          {result.deductedAreaFeet > 0 ? (
            <Row label="Deducted" value={`(${qty(result.deductedAreaFeet, 2)} sq ft)`} />
          ) : null}
          {result.pitchFactor !== 1 ? (
            <Row label="Pitch factor" value={`x ${result.pitchFactor.toFixed(5)}`} />
          ) : null}
          {result.markerCount > 0 && tool === 'count' ? (
            <Row label="Markers" value={String(result.markerCount)} />
          ) : null}
        </dl>
      </div>

      {result.warnings.map((w) => (
        <Alert key={w} tone="warn" icon={<AlertTriangle className="size-4" />}>{w}</Alert>
      ))}

      {verified && result.warnings.length === 0 ? (
        <Alert tone="success" icon={<CheckCircle2 className="size-4" />}>
          Measured at a scale verified against a dimension printed on the drawing.
        </Alert>
      ) : null}

      <details className="rounded-[--radius-card] border border-charcoal-200 bg-charcoal-50/60 p-3">
        <summary className="cursor-pointer text-xs font-medium text-charcoal-700">
          Full derivation
        </summary>
        <ol className="mt-2 space-y-1 text-xs text-charcoal-600">
          {result.derivation.map((d, i) => <li key={i} className="font-mono">{d}</li>)}
        </ol>
      </details>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-charcoal-500">{label}</dt>
      <dd className="tabular text-charcoal-800">{value}</dd>
    </div>
  );
}

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '@grounup/engine';
import { cn } from '@/lib/utils';

/**
 * The measuring surface.
 *
 * Deliberately separate from whatever is underneath it. The overlay knows about
 * points, clicks and the shape being drawn; it knows nothing about PDFs, pages
 * or rendering, so the measuring behaviour can be tested without a document —
 * and so a sheet delivered as an image, a photograph or eventually a model view
 * is measured by the same code.
 *
 * Coordinates are in the sheet space the calibration was taken in, not screen
 * pixels. The two differ the moment somebody zooms, and a measurement that
 * changes when you zoom is not a measurement.
 */
export type Tool = 'none' | 'calibrate' | 'count' | 'linear' | 'area' | 'volume' | 'deduct';

/** How many points the tool needs before the shape means anything. */
export const MINIMUM_POINTS: Record<Tool, number> = {
  none: 0, calibrate: 2, count: 1, linear: 2, area: 3, volume: 3, deduct: 3,
};

export interface OverlayProps {
  tool: Tool;
  /** Sheet space size, which fixes the coordinate system regardless of zoom. */
  width: number;
  height: number;
  /** Screen width the sheet is drawn at. Points are converted back to sheet space. */
  displayWidth: number;
  points: readonly Point[];
  onPointsChange: (points: Point[]) => void;
  /** Completed shapes drawn behind the one in progress. */
  existing?: readonly { id: string; points: readonly Point[]; kind: Tool; label?: string }[];
  className?: string;
}

const SHAPE_COLOR: Record<Tool, string> = {
  none: 'stroke-charcoal-400',
  calibrate: 'stroke-yellow-500',
  count: 'stroke-sky-600',
  linear: 'stroke-emerald-600',
  area: 'stroke-violet-600',
  volume: 'stroke-orange-600',
  deduct: 'stroke-danger-500',
};

export function MeasurementOverlay({
  tool, width, height, displayWidth, points, onPointsChange, existing = [], className,
}: OverlayProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);

  // Screen to sheet space. Every stored coordinate goes through this, so a
  // measurement taken at one zoom reads identically at another.
  const scale = displayWidth > 0 ? width / displayWidth : 1;

  function toSheet(e: ReactPointerEvent<SVGSVGElement>): Point {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: (e.clientX - box.left) * scale,
      y: (e.clientY - box.top) * scale,
    };
  }

  function place(e: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'none') return;
    const p = toSheet(e);
    // A calibration is exactly two points: the third would silently redefine
    // the scale every measurement on the sheet was taken at.
    if (tool === 'calibrate' && points.length >= 2) {
      onPointsChange([p]);
      return;
    }
    onPointsChange([...points, p]);
  }

  const closed = tool === 'area' || tool === 'volume' || tool === 'deduct';
  const path = (pts: readonly Point[], close: boolean) =>
    pts.length === 0 ? '' :
      `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}${close && pts.length > 2 ? ' Z' : ''}`;

  const preview = hover && tool !== 'none' && tool !== 'count' && points.length > 0
    ? [...points, hover] : points;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('absolute inset-0 size-full',
        tool === 'none' ? 'pointer-events-none' : 'cursor-crosshair', className)}
      onPointerDown={place}
      onPointerMove={(e) => { if (tool !== 'none') setHover(toSheet(e)); }}
      onPointerLeave={() => setHover(null)}
      role={tool === 'none' ? 'presentation' : 'application'}
      aria-label={tool === 'none' ? undefined : `Measuring: ${tool}`}
    >
      {existing.map((s) => (
        <g key={s.id}>
          <path d={path(s.points, s.kind === 'area' || s.kind === 'volume' || s.kind === 'deduct')}
            className={cn('fill-none', SHAPE_COLOR[s.kind])}
            strokeWidth={2 * scale} strokeOpacity={0.55} />
          {s.kind === 'count'
            ? s.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4 * scale}
                  className="fill-sky-600/60" />
              ))
            : null}
        </g>
      ))}

      {tool !== 'none' && points.length > 0 ? (
        <>
          <path d={path(preview, closed)}
            className={cn('fill-none', SHAPE_COLOR[tool])} strokeWidth={2.5 * scale} />
          {closed && preview.length > 2 ? (
            <path d={path(preview, true)}
              className={cn('stroke-none',
                tool === 'deduct' ? 'fill-danger-500/20' : 'fill-violet-600/15')} />
          ) : null}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={4 * scale}
              className={cn('fill-white', SHAPE_COLOR[tool])} strokeWidth={2 * scale}
              data-testid={`vertex-${i}`} />
          ))}
        </>
      ) : null}
    </svg>
  );
}

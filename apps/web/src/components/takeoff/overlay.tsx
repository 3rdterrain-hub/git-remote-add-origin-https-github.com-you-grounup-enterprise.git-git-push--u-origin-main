import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '@grounup/engine';
import { cn } from '@/lib/utils';

/**
 * The measuring surface.
 *
 * Deliberately separate from whatever is underneath it. The overlay knows about
 * points, clicks and the shape being drawn; it knows nothing about PDFs, pages
 * or rendering, so the measuring behavior can be tested without a document —
 * and so a sheet delivered as an image, a photograph or eventually a model view
 * is measured by the same code.
 *
 * Coordinates are in the sheet space the calibration was taken in, not screen
 * pixels. The two differ the moment somebody zooms, and a measurement that
 * changes when you zoom is not a measurement.
 */
export type Tool =
  | 'none' | 'calibrate' | 'count' | 'linear' | 'area' | 'volume' | 'basin' | 'deduct';

/** How many points the tool needs before the shape means anything. */
export const MINIMUM_POINTS: Record<Tool, number> = {
  none: 0, calibrate: 2, count: 1, linear: 2, area: 3, volume: 3, basin: 3, deduct: 3,
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

  /**
   * Finish the shape and keep it. Enter, and the button that says so.
   *
   * Without this the only way to end a measurement was to apply it to an
   * estimate line, which cleared the canvas — so taking six measurements off
   * one sheet meant six trips through the apply panel, and anything not applied
   * was lost the moment the tool changed.
   */
  onFinish?: () => void;
  /** Drop the last point. Backspace, because that is what a digitizer does. */
  onUndo?: () => void;
  /** Abandon the shape. Escape. */
  onCancel?: () => void;

  /**
   * Feet per unit of sheet space, when the sheet has been calibrated.
   *
   * Only used to say the length of the segment being drawn, which is the
   * difference between tracing a footing and guessing at one. Null before a
   * scale is set, and then nothing is claimed.
   */
  feetPerUnit?: number | null;

  /**
   * Pull a new point onto a vertex already on the sheet when it lands close.
   *
   * Two areas that share a wall have to share its coordinates, or the quantity
   * has a sliver in it that nobody can see at 100% zoom.
   */
  snap?: boolean;
}

/** Within this many sheet units, a click takes the vertex it is near. */
const SNAP_RADIUS = 12;

/** Hold shift and the segment goes horizontal, vertical, or 45 degrees. */
function constrain(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // The diagonal only wins when the run and the rise are genuinely close, so
  // ortho stays the common case and a deliberate 45 is still reachable.
  if (Math.abs(ax - ay) < Math.min(ax, ay) * 0.35) {
    const d = (ax + ay) / 2;
    return { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d };
  }
  return ax >= ay ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

const SHAPE_COLOR: Record<Tool, string> = {
  none: 'stroke-charcoal-400',
  calibrate: 'stroke-yellow-500',
  count: 'stroke-sky-600',
  linear: 'stroke-emerald-600',
  area: 'stroke-violet-600',
  volume: 'stroke-orange-600',
  basin: 'stroke-cyan-600',
  deduct: 'stroke-danger-500',
};

export function MeasurementOverlay({
  tool, width, height, displayWidth, points, onPointsChange, existing = [], className,
  onFinish, onUndo, onCancel, feetPerUnit = null, snap = true,
}: OverlayProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [ortho, setOrtho] = useState(false);

  /*
   * Keys are read from the window rather than the SVG.
   *
   * A digitizer is used with one hand on the mouse and one on the keyboard, and
   * requiring a click into the canvas first would mean the first Backspace of
   * every shape does nothing. The listener is only mounted while a tool is
   * active, so it never competes with typing in a field.
   */
  useEffect(() => {
    if (tool === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      /*
       * The target is `window` for a key pressed with nothing focused, and
       * window has no `getAttribute`. Narrow to an element before asking it
       * anything, or the first Backspace on an empty canvas throws.
       */
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || el.isContentEditable || el.getAttribute('role') === 'combobox');
      if (typing) return;
      if (e.key === 'Shift') { setOrtho(true); return; }
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onUndo?.(); return; }
      if (e.key === 'Enter') { e.preventDefault(); onFinish?.(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setOrtho(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [tool, onFinish, onUndo, onCancel]);

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

  /** Every vertex already on the sheet, for snapping onto. */
  function nearestVertex(p: Point): Point | null {
    if (!snap) return null;
    let best: Point | null = null;
    let bestD = SNAP_RADIUS * scale;
    for (const shape of existing) {
      for (const v of shape.points) {
        const d = Math.hypot(v.x - p.x, v.y - p.y);
        if (d < bestD) { bestD = d; best = v; }
      }
    }
    return best;
  }

  /** Where a point would land: snapped to a vertex, or squared up under shift. */
  function resolve(raw: Point): Point {
    const snapped = nearestVertex(raw);
    if (snapped) return snapped;
    const last = points[points.length - 1];
    if (ortho && last && tool !== 'count') return constrain(last, raw);
    return raw;
  }

  function place(e: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'none') return;
    const p = resolve(toSheet(e));
    // A calibration is exactly two points: the third would silently redefine
    // the scale every measurement on the sheet was taken at.
    if (tool === 'calibrate' && points.length >= 2) {
      onPointsChange([p]);
      return;
    }
    onPointsChange([...points, p]);
  }

  const closed = tool === 'area' || tool === 'volume' || tool === 'basin' || tool === 'deduct';
  const path = (pts: readonly Point[], close: boolean) =>
    pts.length === 0 ? '' :
      `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}${close && pts.length > 2 ? ' Z' : ''}`;

  const preview = hover && tool !== 'none' && tool !== 'count' && points.length > 0
    ? [...points, hover] : points;

  /*
   * The segment being drawn, and the run so far, in feet — but only when the
   * sheet has a scale. Before calibration the numbers on screen would be sheet
   * units, which look like feet and are not.
   */
  const last = points[points.length - 1];
  const readout = (() => {
    if (!feetPerUnit || !hover || tool === 'none' || tool === 'count' || !last) return null;
    const seg = Math.hypot(hover.x - last.x, hover.y - last.y) * feetPerUnit;
    let run = seg;
    for (let i = 1; i < points.length; i += 1) {
      run += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
        * feetPerUnit;
    }
    const ft = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}'`;
    return points.length > 1 ? `${ft(seg)}  ·  ${ft(run)} total` : ft(seg);
  })();

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('absolute inset-0 size-full',
        tool === 'none' ? 'pointer-events-none' : 'cursor-crosshair', className)}
      onPointerDown={place}
      onPointerMove={(e) => { if (tool !== 'none') setHover(resolve(toSheet(e))); }}
      onPointerLeave={() => setHover(null)}
      role={tool === 'none' ? 'presentation' : 'application'}
      aria-label={tool === 'none' ? undefined : `Measuring: ${tool}`}
    >
      {existing.map((s) => (
        <g key={s.id}>
          <path d={path(s.points, s.kind === 'area' || s.kind === 'volume'
            || s.kind === 'basin' || s.kind === 'deduct')}
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

      {/*
        * What the segment being drawn measures, at the cursor.
        *
        * A takeoff is a sequence of judgments about whether the line you just
        * drew is the line on the drawing, and the only way to know is the
        * number. Waiting until the shape is closed to see it means correcting
        * afterwards instead of not making the mistake.
        */}
      {readout && hover ? (
        <g pointerEvents="none">
          <rect x={hover.x + 10 * scale} y={hover.y - 22 * scale}
            width={readout.length * 7.2 * scale + 10 * scale} height={18 * scale}
            rx={3 * scale} className="fill-charcoal-900/85" />
          <text x={hover.x + 15 * scale} y={hover.y - 9 * scale}
            fontSize={12 * scale} className="fill-white">{readout}</text>
        </g>
      ) : null}

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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Ruler, MousePointerClick, Minus, Square, Box, Hash, Undo2, Trash2, Scissors, Waves, Plus,
  Loader2, Maximize2,
} from 'lucide-react';
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
import {
  MeasurePanel, tryResolveScale, type ScaleState, type Lift,
} from '@/components/takeoff/measure-panel';
import { ApplyPanel } from '@/components/takeoff/apply-panel';
import { useQuery } from '@/lib/data/query';
import {
  loadPlanSheets, loadOpenEstimateLines, loadCalibrations, sheetUrl, applyMeasurement, saveCalibration,
  loadPlanSetsWithoutSheets, loadMeasurements, saveMeasurement,
} from '@/lib/data/takeoff';
import { UnsheetedPlanSets } from '@/components/takeoff/unsheeted-plan-sets';
import { basinQuantity } from '@/lib/takeoff-quantity';
import {
  zoomAt, zoomByStep, fitToWidth, wheelFactor, panBy,
} from '@/lib/canvas-navigation';
import { afterToolChange } from '@/lib/takeoff-tools';
import {
  loadConditions, recordConditionTakeoff, type ConditionRow,
} from '@/lib/data/conditions';
import { ConditionList } from '@/components/takeoff/condition-list';
import { SheetIdentity } from '@/components/takeoff/sheet-identity';
import { TakenOff } from '@/components/takeoff/taken-off';
import { DemonstrationNotice, ErrorState } from '@/components/data-state';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { measure, measureBasin, ENGINE_VERSION } from '@grounup/engine';
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
  { tool: 'basin', label: 'Pond', icon: Waves,
    hint: 'Outline the top of bank. The sides slope, so the floor is smaller than the top.' },
  { tool: 'deduct', label: 'Deduct', icon: Scissors, hint: 'Outline an opening to subtract.' },
];

const UNITS_FOR: Record<string, string[]> = {
  count: ['EA'], linear: ['LF'], area: ['SF', 'SY', 'ACRE'], volume: ['CY'],
  // A pond is bid by what comes out of it, by what lines it, or by what it holds.
  basin: ['CY', 'SY', 'SF', 'ACRE', 'GAL'],
};

export function TakeoffPage() {
  /*
   * The line this measurement is for, when somebody arrived from the estimate.
   * Carried in the address so the trip back is a browser button and the tab is
   * shareable — an estimator who wants a colleague to trace one line sends
   * them the link.
   */
  const [params] = useSearchParams();
  const forLine = params.get('line');

  const sheetsQ = useQuery(loadPlanSheets, []);
  /*
   * Anything uploaded before migration 0135 has no sheets and so cannot appear
   * in the picker. Listing those is the difference between fixing this going
   * forward and fixing it.
   */
  const unsheetedQ = useQuery(loadPlanSetsWithoutSheets, []);
  /*
   * What has already been taken off this sheet.
   *
   * `loadMeasurements` has existed since the takeoff screen was built and
   * nothing called it, so a finished measurement disappeared from the drawing
   * the moment it was applied. You could not see what you had already measured,
   * which is how a room gets taken off twice.
   */
  const measurementsQ = useQuery(loadMeasurements, []);
  /*
   * What has been calibrated on each sheet.
   *
   * `loadCalibrations` has existed since the takeoff screen was built and
   * nothing called it, so a scale was written once and never read back: the
   * shapes kept on a sheet had no scale behind them the next time it opened,
   * and the quantity a saved measurement came to could not be recovered.
   */
  const calibrationsQ = useQuery(loadCalibrations, []);
  const linesQ = useQuery(loadOpenEstimateLines, []);
  const demonstration = sheetsQ.status === 'demonstration';

  const sheets = sheetsQ.status === 'ready' ? sheetsQ.data : [];
  const lines = linesQ.status === 'ready' ? linesQ.data : [];

  /**
   * Which estimate this takeoff is for.
   *
   * From the line the estimator arrived on, when they came from one; otherwise
   * the version the open lines belong to. A takeoff is always for an estimate —
   * a measurement with nowhere to go is a number nobody finds again.
   */
  const versionId = useMemo(() => {
    if (forLine) {
      const l = lines.find((x) => x.id === forLine);
      if (l) return l.estimateVersionId;
    }
    return lines[0]?.estimateVersionId ?? null;
  }, [forLine, lines]);

  /*
   * Read here as well as in the panel, so a shape already on the sheet can be
   * drawn in the color of the thing it measures.
   */
  const conditionsQ = useQuery(loadConditions(versionId ?? ''), [versionId]);
  const conditions: ConditionRow[] =
    conditionsQ.status === 'ready' ? conditionsQ.data : [];

  /** A traced shape wears the color of the thing it measures. */
  const conditionColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of conditions) m.set(c.id, c.color);
    return m;
  }, [conditions]);
  const colorOf = (id: string | null) => (id ? conditionColor.get(id) ?? null : null);

  const [sheetId, setSheetId] = useState('');
  /*
   * Derived below `sheetId` rather than above it. The filter callback runs
   * while this function body is still executing, so reading `sheetId` before
   * its `const` threw `ReferenceError: Cannot access 'sheetId' before
   * initialization` on every render where the query had answered — which is to
   * say on every company that had ever saved a measurement.
   */
  const measurements = measurementsQ.status === 'ready'
    ? measurementsQ.data.filter((m) => m.sheetId === sheetId) : [];
  const calibrations = calibrationsQ.status === 'ready' ? calibrationsQ.data : [];
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ name: string; quantity: number; unit: string } | null>(null);

  const [tool, setTool] = useState<Tool>('calibrate');
  const [points, setPoints] = useState<Point[]>([]);
  /*
   * A pond's cuts, top down. Held here rather than in the panel because the
   * apply step needs them: they are inputs to the measurement, not a way of
   * displaying it.
   */
  const [lifts, setLifts] = useState<Lift[]>([{ depthFeet: 8, sideSlopeRun: 3 }]);
  const [freeboardFeet, setFreeboardFeet] = useState('');
  const [deductions, setDeductions] = useState<Point[][]>([]);
  /*
   * The shape the openings are cut out of, parked while one is traced. Without
   * it, stepping into the Deduct tool lost the outline it was deducting from.
   */
  const [outline, setOutline] = useState<Point[]>([]);
  const [shapeName, setShapeName] = useState('');
  const [saving, setSaving] = useState(false);
  const [sheetSize, setSheetSize] = useState({ width: 1224, height: 792 });
  const [zoom, setZoom] = useState(1);
  /*
   * What is being measured. Chosen before tracing, because the condition owns
   * the color that keeps a busy sheet readable and the depth a drawing does not
   * supply — asking for either afterwards means asking once per shape.
   */
  const [condition, setCondition] = useState<ConditionRow | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  /*
   * Moving around the sheet.
   *
   * The wheel zooms about the cursor, which is what every PDF viewer, CAD tool
   * and takeoff product does and the thing people only notice when it is
   * missing: without it each step pushes what you were looking at toward the
   * edge, and at 300% on a 24×36 sheet you lose your place on every notch.
   *
   * Panning is the space bar or the middle button, so a drag with the left
   * button stays what it has always been — tracing.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const panFrom = useRef<{ x: number; y: number } | null>(null);

  const viewportOf = (el: HTMLDivElement) => ({
    clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
  });

  /*
   * A native listener, because React's onWheel is passive and cannot call
   * preventDefault — without which the browser scrolls the page underneath the
   * zoom and the sheet jumps.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return;            /* shift+wheel stays a sideways scroll */
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = zoomAt(zoom, wheelFactor(e.deltaY),
        e.clientX - rect.left, e.clientY - rect.top, viewportOf(el));
      setZoom(next.zoom);
      el.scrollLeft = next.scrollLeft;
      el.scrollTop = next.scrollTop;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  /* Space to grab the sheet. Ignored while typing, or a name box cannot hold one. */
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement
      && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) { e.preventDefault(); setSpaceHeld(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    /* A window that loses focus mid-drag must not come back still grabbing. */
    const blur = () => { setSpaceHeld(false); setPanning(false); panFrom.current = null; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    /* Middle button, or space held. The left button is for tracing. */
    if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panFrom.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
  };

  const movePan = (e: React.PointerEvent<HTMLDivElement>) => {
    const from = panFrom.current;
    const el = scrollRef.current;
    if (!from || !el) return;
    const next = panBy(viewportOf(el), e.clientX - from.x, e.clientY - from.y);
    el.scrollLeft = next.scrollLeft;
    el.scrollTop = next.scrollTop;
    panFrom.current = { x: e.clientX, y: e.clientY };
  };

  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panFrom.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    panFrom.current = null;
    setPanning(false);
  };

  /** Zoom a step about the middle, the way the buttons always have. */
  const stepZoom = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) { setZoom((z) => Math.min(8, Math.max(0.25, z * (direction === 1 ? 1.25 : 0.8)))); return; }
    const next = zoomByStep(zoom, direction, viewportOf(el));
    setZoom(next.zoom);
    el.scrollLeft = next.scrollLeft;
    el.scrollTop = next.scrollTop;
  };

  /*
   * The usual three, on the usual keys. An estimator who zooms with the
   * keyboard in every other tool should not have to reach for a button here.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); stepZoom(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepZoom(-1); }
      else if (e.key === '0') { e.preventDefault(); fitWidth(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /*
   * A sheet opens showing the whole sheet. Landing at 100% on a 24×36 drawing
   * puts you in a corner of the title block with no idea which way the north
   * arrow points.
   */
  useEffect(() => {
    if (!sheetId) return;
    const el = scrollRef.current;
    if (!el) return;
    setZoom(fitToWidth(el.clientWidth));
    el.scrollLeft = 0;
    el.scrollTop = 0;
  }, [sheetId]);

  /** The whole sheet, which is where a takeoff starts and what you return to. */
  const fitWidth = () => {
    const el = scrollRef.current;
    if (!el) return;
    setZoom(fitToWidth(el.clientWidth));
    el.scrollLeft = 0;
    el.scrollTop = 0;
  };

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

  const sheet = sheets.find((x) => x.id === sheetId) ?? null;

  // A signed URL, because a plan set is a customer's competitive position
  // before it is a drawing and the bucket is private for that reason.
  useEffect(() => {
    if (!sheet || !supabase) { setSource(''); return; }
    let canceled = false;
    setSourceError(null);
    void sheetUrl(supabase, sheet.storageBucket, sheet.storagePath)
      .then((u) => { if (!canceled) setSource(u); })
      .catch((e: Error) => { if (!canceled) { setSource(''); setSourceError(e.message); } });
    return () => { canceled = true; };
  }, [sheet]);

  const resolved = useMemo(() => tryResolveScale(scaleState), [scaleState]);
  const scale = resolved && 'scale' in resolved ? resolved.scale : null;
  const scaleError = resolved && 'error' in resolved ? resolved.error : null;

  const displayWidth = Math.round(900 * zoom);
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  /**
   * Switch tools without throwing away the work in progress.
   *
   * This used to clear `points` on the way *into* deduct — losing the outline
   * you were cutting the opening out of — and clear `deductions` on the way
   * back out. Between the two, an opening could never reach `measure`, so the
   * Deduct tool subtracted nothing and the "2 opening(s) will be subtracted"
   * notice under it was never true.
   *
   * Going into deduct parks the outline and starts a fresh ring. Coming back to
   * the shape restores the outline and keeps what was banked. Going anywhere
   * else is a different measurement, and drops both.
   */
  function chooseTool(next: Tool) {
    const after = afterToolChange(tool, next, { points, outline, deductions });
    setPoints(after.points as Point[]);
    setOutline(after.outline as Point[]);
    setDeductions(after.deductions as Point[][]);
    setTool(next);
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

  /**
   * What the engine says this shape comes to.
   *
   * Computed here for the apply step rather than read off the panel, so the
   * figure written to the line and the figure shown beside it come from one
   * call rather than two that could drift.
   */
  const measured = useMemo(() => {
    if (!scale && tool !== 'count') return null;
    if (tool === 'none' || tool === 'calibrate' || tool === 'deduct') return null;
    /*
     * A basin is not a volume with a depth; its sides slope, so its quantity
     * comes from `measureBasin` and the prismoidal arithmetic behind it. Both
     * paths return a quantity in the same unit, which is all the apply step
     * needs — but they are not the same calculation and are not merged.
     */
    if (tool === 'basin') {
      if (!scale || lifts.length === 0) return null;
      try {
        const b = measureBasin({
          points, scale,
          lifts: lifts.map((l) => ({
            depthFeet: l.depthFeet, sideSlopeRun: l.sideSlopeRun,
            ...(l.benchWidthFeet ? { benchWidthFeet: l.benchWidthFeet } : {}),
          })),
          ...(num(freeboardFeet) === undefined ? {} : { freeboardFeet: num(freeboardFeet) }),
          ...(num(multiplier) === undefined ? {} : { multiplier: num(multiplier) }),
        });
        const quantity = basinQuantity(b, unit);
        return {
          quantity,
          measurementMethod: scale.measurementMethod,
          derivation: b.derivation,
          warnings: b.warnings,
        };
      } catch (e) {
        return { refusal: e instanceof Error ? e.message : 'That basin cannot be measured.' };
      }
    }
    try {
      return measure({
        kind: tool as 'count' | 'linear' | 'area' | 'volume',
        points, unit: unit as Parameters<typeof measure>[0]['unit'],
        scale: scale ?? {
          unitsPerPoint: 1, unit: 'LF', basis: 'stated_scale',
          measurementMethod: 'approximate_scale', derivation: 'not scaled', warnings: [],
        },
        ...(deductions.length ? { deductions } : {}),
        ...(num(widthFeet) === undefined ? {} : { widthFeet: num(widthFeet) }),
        ...(num(depthFeet) === undefined ? {} : { depthFeet: num(depthFeet) }),
        ...(num(pitchRise) === undefined ? {} : { pitch: { rise: num(pitchRise)!, run: 12 } }),
        ...(num(countPer) === undefined ? {} : { countPer: num(countPer) }),
        ...(num(multiplier) === undefined ? {} : { multiplier: num(multiplier) }),
      });
    } catch (e) {
      return { refusal: e instanceof Error ? e.message : 'That shape cannot be measured.' };
    }
  }, [tool, points, unit, scale, deductions, widthFeet, depthFeet, pitchRise, countPer,
      multiplier, lifts, freeboardFeet]);

  /*
   * The engine refuses rather than guesses — a volume with no depth, a unit
   * that does not suit the kind, a ring that crosses itself. It said so, and
   * this screen swallowed it and showed nothing, which reads as a dead button
   * rather than as an answer.
   */
  const measureRefusal = measured && 'refusal' in measured ? measured.refusal : null;
  const measuredOk = measured && !('refusal' in measured) ? measured : null;

  async function apply(input: { name: string; trade: string; lineItemId: string }) {
    if (!supabase || !measuredOk || !sheet) return;
    setApplying(true);
    setApplyError(null);
    try {
      let calibrationId: string | null = null;
      if (scaleState && tool !== 'count') {
        calibrationId = await saveCalibration(supabase, {
          companyId: sheet.companyId, sheetId,
          from: scaleState.from, to: scaleState.to,
          knownDistanceFeet: scaleState.knownDistanceFeet,
          basis: scaleState.basis,
          reference: scaleState.reference.trim() || null,
        });
      }
      await applyMeasurement(supabase, {
        companyId: sheet.companyId, sheetId, calibrationId,
        name: input.name, trade: input.trade || null,
        kind: tool as 'count' | 'linear' | 'area' | 'volume' | 'basin',
        unit, geometry: points, deductions,
        isClosed: tool === 'area' || tool === 'volume' || tool === 'basin',
        pitchRise: num(pitchRise) ?? null, pitchRun: num(pitchRise) === undefined ? null : 12,
        depthFeet: num(depthFeet) ?? null, widthFeet: num(widthFeet) ?? null,
        countPer: num(countPer) ?? 1, multiplier: num(multiplier) ?? 1,
        ...(tool === 'basin' ? {
          lifts: lifts.map((l) => ({
            depth_feet: l.depthFeet,
            side_slope_run: l.sideSlopeRun,
            ...(l.benchWidthFeet ? { bench_width_feet: l.benchWidthFeet } : {}),
          })),
          freeboardFeet: num(freeboardFeet) ?? null,
        } : {}),
        lineItemId: input.lineItemId, quantity: measuredOk.quantity,
        engineVersion: ENGINE_VERSION,
      });
      setApplied({ name: input.name, quantity: measuredOk.quantity, unit });
      setPoints([]);
      setDeductions([]);
      linesQ.refetch();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'The measurement could not be applied.');
    } finally {
      setApplying(false);
    }
  }

  /**
   * Finish this shape, keep it, and be ready for the next one.
   *
   * The measurement is written with no line item on it — `applied_line_item_id`
   * has been nullable since 0061 and nothing ever used it. Before this, the
   * only way to end a shape was to apply it to an estimate line, which meant a
   * sheet with twelve things on it was twelve trips through the apply panel in
   * whatever order the estimate happened to be in. A takeoff is not done in
   * that order: you measure what is in front of you, then decide where it goes.
   */
  async function finishShape() {
    if (!supabase || !measuredOk || !sheet || saving) return;
    if (tool === 'calibrate' || tool === 'deduct' || tool === 'none') return;
    setSaving(true); setApplyError(null);
    try {
      let calibrationId: string | null = null;
      if (scaleState && scale) {
        calibrationId = await saveCalibration(supabase, {
          companyId: sheet.companyId, sheetId,
          from: scaleState.from, to: scaleState.to,
          knownDistanceFeet: scaleState.knownDistanceFeet,
          basis: scaleState.basis,
          reference: scaleState.reference.trim() || null,
        });
      }
      const measurementId = await saveMeasurement(supabase, {
        companyId: sheet.companyId, sheetId, calibrationId,
        name: shapeName.trim()
          || (condition
            ? `${condition.name} ${measurements.filter(
                (m) => m.conditionId === condition.id).length + 1}`
            : `${tool.charAt(0).toUpperCase()}${tool.slice(1)} ${measurements.length + 1}`),
        trade: null,
        kind: tool as 'count' | 'linear' | 'area' | 'volume' | 'basin',
        unit, geometry: points, deductions,
        isClosed: tool === 'area' || tool === 'volume' || tool === 'basin',
        pitchRise: num(pitchRise) ?? null, pitchRun: num(pitchRise) === undefined ? null : 12,
        depthFeet: num(depthFeet) ?? null, widthFeet: num(widthFeet) ?? null,
        countPer: num(countPer) ?? 1, multiplier: num(multiplier) ?? 1,
        ...(tool === 'basin' ? {
          lifts: lifts.map((l) => ({
            depth_feet: l.depthFeet,
            side_slope_run: l.sideSlopeRun,
            ...(l.benchWidthFeet ? { bench_width_feet: l.benchWidthFeet } : {}),
          })),
          freeboardFeet: num(freeboardFeet) ?? null,
        } : {}),
      });
      /*
       * Filed under the thing it measures, and onto that thing's line, in one
       * call. This is the point of picking first: trace it wherever it appears
       * without answering the same questions again.
       */
      if (condition) {
        await recordConditionTakeoff(
          supabase, condition.id, measurementId, measuredOk.quantity, ENGINE_VERSION);
        conditionsQ.refetch();
        linesQ.refetch();
      }

      setShapeName('');
      setPoints([]);
      setDeductions([]);
      measurementsQ.refetch();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'That measurement could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  /*
   * A shape can be kept once it is a shape. Calibration is not a measurement
   * and a deduction belongs to the shape it is cut out of, so neither is
   * finishable on its own.
   */
  const canFinish = Boolean(
    measuredOk && sheetId && tool !== 'calibrate' && tool !== 'deduct' && tool !== 'none');

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
            <Button variant="outline" size="sm" title="Zoom out (⌘−)"
              onClick={() => stepZoom(-1)}>−</Button>
            <span className="tabular w-12 text-center text-sm text-charcoal-600">
              {Math.round(zoom * 100)}%
            </span>
            <Button variant="outline" size="sm" title="Zoom in (⌘+)"
              onClick={() => stepZoom(1)}>+</Button>
            <Button variant="outline" size="sm" title="Fit the whole sheet (⌘0)"
              onClick={fitWidth}>
              <Maximize2 className="size-4" /> Fit
            </Button>
          </div>
        }
      />

      {demonstration ? <DemonstrationNotice /> : null}
      {sheetsQ.status === 'error'
        ? <ErrorState message={sheetsQ.message} onRetry={sheetsQ.refetch} /> : null}

      {isSupabaseConfigured && unsheetedQ.status === 'ready' ? (
        <UnsheetedPlanSets
          plans={unsheetedQ.data}
          onSheeted={() => { sheetsQ.refetch(); unsheetedQ.refetch(); }} />
      ) : null}

      {/*
        * What you are measuring, ahead of the tools — the arrangement every
        * takeoff product uses, for the reason above.
        */}
      {isSupabaseConfigured && versionId ? (
        <ConditionList
          versionId={versionId}
          selectedId={condition?.id ?? null}
          onSelect={(c) => {
            setCondition(c);
            if (c) {
              /* The thing decides the tool and the unit, so neither is retyped. */
              chooseTool(c.style as Tool);
              setUnit(c.unit);
              if (c.depthFeet != null) setDepthFeet(String(c.depthFeet));
              if (c.widthFeet != null) setWidthFeet(String(c.widthFeet));
            }
          }}
          onHighlight={setHighlighted}
          editable={isSupabaseConfigured}
        />
      ) : null}

      {isSupabaseConfigured ? (
        <div className="flex flex-wrap items-end gap-3 rounded-[--radius-card] border border-charcoal-200 bg-white p-4">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="sheet">Sheet</Label>
            {/*
              * Switching sheets used to drop a half-traced shape with no
              * warning — a long outline gone on a misclick, which is how
              * somebody stops trusting the tool. Now it asks, and only when
              * there is something to lose.
              */}
            <Select value={sheetId} onValueChange={(v) => {
              if (points.length > 0
                && !window.confirm(
                  `${points.length} point${points.length === 1 ? '' : 's'} have been placed `
                  + 'and are not part of a saved measurement yet. Leave this sheet and lose them?')) {
                return;
              }
              setSheetId(v);
              setPoints([]);
              setDeductions([]);
              setOutline([]);
            }}>
              <SelectTrigger id="sheet">
                <SelectValue placeholder={sheets.length ? 'Choose a sheet' : 'No sheets uploaded yet'} />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((sh) => (
                  <SelectItem key={sh.id} value={sh.id}>
                    {sh.label} — {sh.documentName}
                    {sh.drawingScale ? ` (${sh.drawingScale})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sheet?.drawingScale ? (
            <p className="pb-2 text-xs text-charcoal-500">
              Title block states {sheet.drawingScale}. Calibrate against a printed dimension
              rather than trusting it.
            </p>
          ) : null}
          {/*
            * What the sheet is called, editable where it is shown. Every field
            * behind this has been on `document_sheets` since migration 0005 and
            * nothing ever wrote one, so a fourteen-sheet set read "p.1" to
            * "p.14" and the estimator had to remember which page was which.
            */}
          {sheet ? (
            <div className="w-full">
              <SheetIdentity sheet={sheet} onSaved={() => { void sheetsQ.refetch(); }} />
            </div>
          ) : null}
        </div>
      ) : null}
      {sourceError ? (
        <Alert tone="danger" title="That sheet could not be opened">{sourceError}</Alert>
      ) : null}

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
            <div className="ml-auto flex items-center gap-2">
              {/*
                * Naming it is optional and worth offering: "Slab, north bay"
                * found again in six weeks beats "Area 3".
                */}
              {canFinish ? (
                <Input value={shapeName} onChange={(e) => setShapeName(e.target.value)}
                  placeholder={`${tool.charAt(0).toUpperCase()}${tool.slice(1)} ${measurements.length + 1}`}
                  aria-label="Name this measurement"
                  className="h-8 w-48" />
              ) : null}
              <Button size="sm" variant="ghost" disabled={!points.length}
                onClick={() => setPoints(points.slice(0, -1))}
                title="Backspace">
                <Undo2 className="size-4" /> Undo point
              </Button>
              <Button size="sm" variant="ghost" disabled={!points.length}
                onClick={() => setPoints([])}
                title="Escape">
                <Trash2 className="size-4" /> Clear
              </Button>
              <Button size="sm" disabled={!canFinish || saving}
                onClick={() => void finishShape()}
                title="Enter">
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Done — keep it
              </Button>
            </div>
          </CardHeader>
          <CardContent
            ref={scrollRef}
            className={cn('overflow-auto bg-charcoal-100 p-4',
              panning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : undefined)}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <div className="relative mx-auto" style={{ width: displayWidth }}>
              <SheetCanvas source={source} pageNumber={sheet?.pageNumber ?? 1}
                displayWidth={displayWidth} onSize={setSheetSize} />
              <MeasurementOverlay
                tool={tool}
                width={sheetSize.width} height={sheetSize.height}
                displayWidth={displayWidth}
                points={points} onPointsChange={setPoints}
                existing={[
                  /*
                    * Everything already taken off this sheet, drawn back on it.
                    * An estimate line that says 1,240 LF can only be checked by
                    * seeing what was traced for it, and a sheet whose finished
                    * measurements are invisible is a sheet somebody measures
                    * twice.
                    */
                  ...measurements.map((m) => ({
                    id: m.id,
                    points: m.geometry,
                    kind: m.kind as Tool,
                    label: m.name,
                    /*
                      * Its own thing's color, so forty traces on one sheet can
                      * be told apart. Dimmed when a different thing is being
                      * pointed at in the list, which is how you see at a glance
                      * what fed a number you do not believe.
                      */
                    ...(colorOf(m.conditionId) ? { color: colorOf(m.conditionId)! } : {}),
                    ...(highlighted && m.conditionId !== highlighted ? { dim: true } : {}),
                  })),
                  ...deductions.map((d, i) => (
                    { id: `d-${i}`, points: d, kind: 'deduct' as Tool })),
                ]}
                feetPerUnit={scale ? scale.unitsPerPoint : null}
                onFinish={() => void finishShape()}
                onUndo={() => setPoints(points.slice(0, -1))}
                onCancel={() => setPoints([])}
              />
            </div>
            <p className="mt-3 text-center text-xs text-charcoal-500">
              {TOOLS.find((t) => t.tool === tool)?.hint}
              {points.length ? ` ${points.length} of ${MINIMUM_POINTS[tool]} minimum placed.` : ''}
            </p>
            <p className="mt-1 text-center text-xs text-charcoal-400">
              Enter keeps it · Backspace undoes a point · Escape starts over · hold Shift to
              square the line up · points snap to a corner already on the sheet
            </p>
          </CardContent>
        </Card>

        {/*
          * What has been kept, and the two things left to do with it.
          *
          * Finishing a shape saves it with no line on it, which is the order a
          * takeoff is actually done in — but a measurement that can only be
          * kept is a measurement in a drawer. This is where one goes onto an
          * estimate, or comes off the sheet.
          */}
        <TakenOff
          measurements={measurements}
          calibrations={calibrations}
          lines={lines.map((l) => ({ id: l.id, description: l.description, unit: l.unit }))}
          editable={isSupabaseConfigured && Boolean(sheetId)}
          onChanged={() => {
            measurementsQ.refetch(); linesQ.refetch(); calibrationsQ.refetch();
          }} />


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
                {tool === 'basin' ? (
                  <LiftEditor lifts={lifts} onChange={setLifts}
                    freeboard={freeboardFeet} onFreeboardChange={setFreeboardFeet} />
                ) : null}
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

          {measureRefusal ? (
            <Alert tone="warn" title="That cannot be measured yet">{measureRefusal}</Alert>
          ) : null}

          {isSupabaseConfigured && measuredOk && sheetId ? (
            <ApplyPanel
              quantity={measuredOk.quantity} unit={unit}
              measurementMethod={measuredOk.measurementMethod}
              {...(forLine ? { defaultLineItemId: forLine } : {})}
              lines={lines} linesLoading={linesQ.status === 'loading'}
              busy={applying} onApply={apply} applied={applied} error={applyError} />
          ) : null}

          <MeasurePanel
            tool={tool} points={points} scale={scale} unit={unit}
            deductions={deductions}
            {...(num(widthFeet) === undefined ? {} : { widthFeet: num(widthFeet) })}
            {...(num(depthFeet) === undefined ? {} : { depthFeet: num(depthFeet) })}
            {...(num(pitchRise) === undefined ? {} : { pitch: { rise: num(pitchRise)!, run: 12 } })}
            {...(num(countPer) === undefined ? {} : { countPer: num(countPer) })}
            {...(num(multiplier) === undefined ? {} : { multiplier: num(multiplier) })}
            {...(tool === 'basin' ? { lifts } : {})}
            {...(tool === 'basin' && num(freeboardFeet) !== undefined
              ? { freeboardFeet: num(freeboardFeet) } : {})}
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

/**
 * The cuts a pond is made of.
 *
 * A slope is entered as its run — 3 for 3:1 — because that is what the section
 * on the drawing says, and asking for a percent or an angle would make an
 * estimator convert a number they can read directly. Zero is a vertical face,
 * which some structures have.
 *
 * More than one lift is how a bench is cut: 4:1 down to a safety shelf, then
 * 3:1 below it. The arithmetic is the same one twice, so the editor is a list
 * rather than a special case.
 */
function LiftEditor({ lifts, onChange, freeboard, onFreeboardChange }: {
  lifts: Lift[];
  onChange: (l: Lift[]) => void;
  freeboard: string;
  onFreeboardChange: (v: string) => void;
}) {
  const set = (i: number, patch: Partial<Lift>) =>
    onChange(lifts.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const totalDepth = lifts.reduce((a, l) => a + (l.depthFeet || 0), 0);

  return (
    <div className="space-y-3 rounded-[--radius-card] border border-charcoal-200 bg-charcoal-50/60 p-3">
      <p className="text-xs font-medium text-charcoal-700">Cuts, top down</p>

      {lifts.map((lift, i) => (
        <div key={i} className="space-y-2 rounded-md border border-charcoal-200 bg-white p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-charcoal-600">
              {lifts.length > 1 ? `Lift ${i + 1}` : 'The cut'}
            </span>
            {lifts.length > 1 ? (
              <Button variant="ghost" size="sm" className="h-6 px-1"
                onClick={() => onChange(lifts.filter((_, j) => j !== i))}
                aria-label={`Remove lift ${i + 1}`}>
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`lift-d-${i}`} className="text-xs">Depth, ft</Label>
              <Input id={`lift-d-${i}`} className="h-8" inputMode="decimal"
                value={String(lift.depthFeet)}
                onChange={(e) => set(i, { depthFeet: Number(e.target.value) || 0 })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`lift-s-${i}`} className="text-xs">Slope, run per 1</Label>
              <Input id={`lift-s-${i}`} className="h-8" inputMode="decimal"
                value={String(lift.sideSlopeRun)}
                onChange={(e) => set(i, { sideSlopeRun: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`lift-b-${i}`} className="text-xs">Bench below this cut, ft</Label>
            <Input id={`lift-b-${i}`} className="h-8" inputMode="decimal"
              value={lift.benchWidthFeet === undefined ? '' : String(lift.benchWidthFeet)}
              placeholder="none"
              onChange={(e) => set(i, {
                benchWidthFeet: e.target.value === '' ? undefined : Number(e.target.value) || 0,
              })} />
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full"
        onClick={() => onChange([...lifts, { depthFeet: 4, sideSlopeRun: 3 }])}>
        <Plus className="size-4" /> Add a lift
      </Button>

      <div className="space-y-1">
        <Label htmlFor="freeboard" className="text-xs">Freeboard, ft</Label>
        <Input id="freeboard" className="h-8" inputMode="decimal" value={freeboard}
          placeholder="none" onChange={(e) => onFreeboardChange(e.target.value)} />
        <p className="text-xs text-charcoal-500">
          Top of bank down to the design water surface. What it holds is measured below that
          line; what it costs to dig is the whole hole.
        </p>
      </div>

      <p className="text-xs text-charcoal-500">
        {totalDepth > 0 ? `${totalDepth} ft of cut in total.` : 'Give the cut a depth.'}
      </p>
    </div>
  );
}

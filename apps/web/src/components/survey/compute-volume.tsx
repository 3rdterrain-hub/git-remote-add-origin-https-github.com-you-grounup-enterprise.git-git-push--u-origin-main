/**
 * The volume between two surfaces. WORKFLOW at the front of an ENGINE.
 *
 * `surface_comparisons` held cut, fill, net, areas, depths and coverage, and
 * nothing anywhere could compute one — so this screen showed volumes that had
 * to have been put there by hand, and a yardage somebody typed is a yardage
 * nobody can reproduce. Since 0193 every one of those columns refuses a
 * hand-written value and the recorder is granted to the service role alone, so
 * this button is the only way a cut yardage comes to exist.
 *
 * What it will not do is guess. The two surfaces must agree on datum, units,
 * grid and georeference; the database refuses the rest and its message is the
 * one shown, because that message names the exact disagreement.
 */
import { useState } from 'react';
import { Loader2, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { computeVolume, type SurfaceRow } from '@/lib/data/survey';
import { qty, percent, titleCase } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function ComputeVolume({ companyId, surfaces, canWrite, onComputed }: {
  companyId: string | null;
  surfaces: SurfaceRow[];
  canWrite: boolean;
  onComputed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [existingId, setExistingId] = useState('');
  const [designId, setDesignId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  /* Only surfaces with their elevations loaded can be measured. */
  const usable = surfaces.filter((s) => s.hasGrid);
  const existing = usable.find((s) => s.id === existingId) ?? null;
  const design = usable.find((s) => s.id === designId) ?? null;

  /*
   * The disagreements worth naming before the database does. Not a substitute
   * for its checks — it makes all of them — but an error a person reads after
   * pressing a button is an error the screen could have shown them first.
   */
  const mismatch = existing && design
    ? existing.verticalDatum !== design.verticalDatum
      ? `Those surfaces are on different vertical datums (${existing.verticalDatum} and ${design.verticalDatum}). The volume between them would be wrong by the offset.`
      : existing.units !== design.units
        ? `Those surfaces use different units (${titleCase(existing.units)} and ${titleCase(design.units)}).`
        : existing.cellSizeFt !== design.cellSizeFt
          || existing.gridRows !== design.gridRows
          || existing.gridCols !== design.gridCols
          ? 'Those surfaces are on different grids. Resample one onto the other before comparing.'
          : existing.originEasting === null || design.originEasting === null
            ? 'One of those surfaces has no georeference, so it is a shape rather than a place.'
            : existing.originEasting !== design.originEasting
              || existing.originNorthing !== design.originNorthing
              ? 'Those grids sit over different ground. Two grids of equal shape in different places produce a volume that is entirely fictitious.'
              : null
    : null;

  const ready = companyId !== null && existing !== null && design !== null
    && existing.id !== design.id && name.trim() !== '' && mismatch === null
    && existing.projectId !== null;

  const run = async () => {
    if (!ready || busy || !existing || !design || !companyId) return;
    setBusy(true); setError(null); setWarnings([]);
    try {
      const result = await computeVolume({
        companyId,
        projectId: existing.projectId!,
        existingSurfaceId: existing.id,
        designSurfaceId: design.id,
        name,
      });
      setWarnings(result.warnings);
      setName('');
      if (result.warnings.length === 0) setOpen(false);
      onComputed();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}
        disabled={!canWrite || usable.length < 2}
        title={!canWrite ? 'Needs permission to compute a volume'
          : usable.length < 2 ? 'Two surfaces with their elevations loaded are needed to measure between them'
            : undefined}>
        <Calculator className="size-4" /> Measure between two surfaces
      </Button>
    );
  }

  const option = (s: SurfaceRow) => (
    <option key={s.id} value={s.id}>
      {s.name} — {titleCase(s.role)} ({s.surveyName})
    </option>
  );

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="cv-existing">Existing ground</Label>
          <select id="cv-existing" className={field} value={existingId}
            onChange={(e) => setExistingId(e.target.value)}>
            <option value="">Choose a surface</option>
            {usable.map(option)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cv-design">Design</Label>
          <select id="cv-design" className={field} value={designId}
            onChange={(e) => setDesignId(e.target.value)}>
            <option value="">Choose a surface</option>
            {usable.filter((s) => s.id !== existingId).map(option)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cv-name">Call it</Label>
          <Input id="cv-name" value={name} placeholder="Phase 2 mass earthwork"
            onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      {existing && design ? (
        <p className="text-xs text-charcoal-500">
          {qty(existing.cellCount, 0)} cells at {qty(existing.cellSizeFt, 1)} ft,
          {' '}{existing.verticalDatum}, {titleCase(existing.units)}.
          {existing.minElevation !== null && existing.maxElevation !== null
            ? ` Existing runs ${qty(existing.minElevation, 2)} to ${qty(existing.maxElevation, 2)}.`
            : ''}
        </p>
      ) : null}

      {mismatch ? <Alert tone="warn" title="These two cannot be compared">{mismatch}</Alert> : null}
      {error ? <Alert tone="danger" title="That volume was not computed">{error}</Alert> : null}
      {warnings.length > 0 ? (
        <Alert tone="warn" title="The volume was computed, with reservations">
          <ul className="list-disc pl-4">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Alert>
      ) : null}

      <Alert tone="info" title="Why this is a button and not a box to type in">
        Cut, fill, net, the areas and the coverage are what the method produces from those two
        grids. They are refused as typed values, because the yardage is what the job is bid and
        paid on and a number nobody can reproduce is a number nobody can defend.
      </Alert>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
        <Button size="sm" onClick={() => { void run(); }} disabled={!ready || busy}
          title={ready ? undefined : 'Two comparable surfaces and a name'}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Compute the volume
        </Button>
      </div>
    </div>
  );
}

/** How much of the compared area the survey actually covered, said plainly. */
export function CoverageNote({ coverage }: { coverage: number }) {
  if (coverage >= 0.999) return null;
  return (
    <span className="text-xs text-warn-700">
      {percent(coverage, 1)} covered
    </span>
  );
}

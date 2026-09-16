/**
 * Building a surface out of a capture. WORKFLOW.
 *
 * A grid, not a form. The elevations are pasted as they come out of the
 * instrument or the design package — whitespace, commas or newlines, one value
 * per cell, row by row — and the count is checked against the grid it claims to
 * be *before* it is sent, because an array of the wrong length is the one
 * mistake in this whole area that produces a plausible answer instead of a
 * failure: every cell shifts, and every depth shifts with it.
 *
 * A surface may instead carry only a storage path, for a file that has been
 * uploaded but not gridded yet. The comparison refuses to measure one of those
 * rather than reporting the zero it would otherwise compute, which reads exactly
 * like flat ground.
 */
import { useMemo, useState } from 'react';
import { Loader2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { createSurface, SURFACE_ROLES } from '@/lib/data/survey';
import { integer, titleCase } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

/** Whitespace, commas or newlines. `null`, `-` and an empty cell mean no data. */
function parseGrid(text: string): Array<number | null> | null {
  const tokens = text.split(/[\s,;]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const out: Array<number | null> = [];
  for (const t of tokens) {
    if (t === 'null' || t === '-' || t === 'NaN') { out.push(null); continue; }
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export function AddSurface({ surveyId, surveyName, canWrite, onAdded }: {
  surveyId: string;
  surveyName: string;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('existing');
  const [cellSize, setCellSize] = useState('10');
  const [rows, setRows] = useState('');
  const [cols, setCols] = useState('');
  const [grid, setGrid] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [easting, setEasting] = useState('');
  const [northing, setNorthing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGrid(grid), [grid]);
  const cells = Number(rows || 0) * Number(cols || 0);
  const malformed = grid.trim() !== '' && parsed === null;
  const wrongLength = parsed !== null && cells > 0 && parsed.length !== cells;
  const hasSomething = parsed !== null || storagePath.trim() !== '';

  const georeferenceHalf =
    (easting.trim() === '') !== (northing.trim() === '');

  const ready = name.trim() !== '' && Number(cellSize) > 0 && cells > 0
    && !malformed && !wrongLength && hasSomething && !georeferenceHalf;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await createSurface({
        surveyId,
        name,
        surfaceRole: role,
        cellSizeFt: Number(cellSize),
        gridRows: Number(rows),
        gridCols: Number(cols),
        elevations: parsed,
        storagePath: storagePath.trim() || null,
        originEasting: easting.trim() === '' ? null : Number(easting),
        originNorthing: northing.trim() === '' ? null : Number(northing),
      });
      setName(''); setGrid(''); setStoragePath('');
      setOpen(false);
      onAdded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to add a surface'}>
        <Layers className="size-4" /> Add a surface
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <p className="text-xs text-charcoal-500">Built from <strong>{surveyName}</strong></p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="sf-name">Surface</Label>
          <Input id="sf-name" value={name} autoFocus placeholder="Existing ground"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sf-role">Role</Label>
          <select id="sf-role" className={field} value={role}
            onChange={(e) => setRole(e.target.value)}>
            {SURFACE_ROLES.map((r) => (
              <option key={r} value={r}>{titleCase(r)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sf-cell">Cell size (ft)</Label>
          <Input id="sf-cell" type="number" value={cellSize}
            onChange={(e) => setCellSize(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="sf-rows">Rows</Label>
            <Input id="sf-rows" type="number" value={rows} placeholder="0"
              onChange={(e) => setRows(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-cols">Columns</Label>
            <Input id="sf-cols" type="number" value={cols} placeholder="0"
              onChange={(e) => setCols(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="sf-grid">Elevations, row by row</Label>
        <textarea id="sf-grid" rows={4} value={grid}
          onChange={(e) => setGrid(e.target.value)}
          className="w-full rounded-md border border-charcoal-200 bg-white p-2 font-mono text-xs"
          placeholder="104.2 104.0 103.8&#10;103.9 103.7 103.4" />
        <p className="text-xs text-charcoal-500">
          {cells > 0 ? `${integer(cells)} cells for this grid. ` : ''}
          {parsed === null ? 'Leave empty and give a file path instead.'
            : `${integer(parsed.length)} value${parsed.length === 1 ? '' : 's'} pasted.`}
          {' '}A blank cell is written as <code>null</code> or <code>-</code>.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="sf-path">Or the file it was uploaded to</Label>
          <Input id="sf-path" value={storagePath} placeholder="surfaces/phase-2-existing.xml"
            onChange={(e) => setStoragePath(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sf-east">Origin easting</Label>
          <Input id="sf-east" type="number" value={easting} placeholder="0"
            onChange={(e) => setEasting(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sf-north">Origin northing</Label>
          <Input id="sf-north" type="number" value={northing} placeholder="0"
            onChange={(e) => setNorthing(e.target.value)} />
        </div>
      </div>

      {malformed ? (
        <Alert tone="danger" title="That is not a grid of numbers">
          Values separate on spaces, commas or newlines. A cell with no data is written as
          <code> null</code> or <code>-</code>.
        </Alert>
      ) : null}
      {wrongLength ? (
        <Alert tone="danger" title="That is not the grid it says it is">
          {integer(parsed!.length)} values for a {rows} × {cols} grid, which needs {integer(cells)}.
          An array of the wrong length shifts every cell and every depth with it, and the volume
          that comes out looks entirely reasonable.
        </Alert>
      ) : null}
      {georeferenceHalf ? (
        <Alert tone="warn" title="A georeference is both halves">
          An easting without a northing places nothing. Two grids of equal shape over different
          ground produce a volume that is entirely fictitious and entirely plausible, so the
          comparison asks for both.
        </Alert>
      ) : null}
      {error ? <Alert tone="danger" title="That surface was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={() => { void save(); }} disabled={!ready || busy}
          title={ready ? undefined : 'A surface needs a name, a grid shape, and either elevations or a file'}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add the surface
        </Button>
      </div>
    </div>
  );
}

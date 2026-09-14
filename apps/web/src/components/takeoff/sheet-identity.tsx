/**
 * What this sheet is called.
 *
 * Every field here has been on `document_sheets` since migration 0005, with an
 * index on `(company_id, sheet_number)` for finding a sheet by the number
 * printed on it. Nothing wrote any of them, so a fourteen-sheet civil set
 * listed as "p.1" through "p.14" and the estimator had to remember which page
 * was the site plan.
 *
 * The title block is on the drawing in front of them. This is the ten seconds
 * it takes to copy it across, once, for good.
 */
import { useEffect, useState } from 'react';
import { Check, PencilLine, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { DISCIPLINES, identifySheet, type PlanSheet } from '@/lib/data/sheets';

const OTHER = '__other__';

export function SheetIdentity({ sheet, onSaved }: {
  sheet: PlanSheet;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [otherDiscipline, setOtherDiscipline] = useState('');
  const [scale, setScale] = useState('');
  const [revision, setRevision] = useState('');
  const [revisionDate, setRevisionDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  /* Reload the form whenever the picker moves to a different sheet. */
  useEffect(() => {
    setNumber(sheet.sheetNumber ?? '');
    setTitle(sheet.sheetTitle ?? '');
    const known = DISCIPLINES.some((d) => d === sheet.discipline);
    setDiscipline(sheet.discipline ? (known ? sheet.discipline : OTHER) : '');
    setOtherDiscipline(known ? '' : (sheet.discipline ?? ''));
    setScale(sheet.drawingScale ?? '');
    setRevision(sheet.revision ?? '');
    setRevisionDate(sheet.revisionDate ?? '');
    setError('');
    setSaved(false);
    /* An unnamed sheet opens the form; a named one stays out of the way. */
    setOpen(sheet.unnamed);
  }, [sheet]);

  const save = async () => {
    if (!supabase || saving) return;
    setSaving(true);
    setError('');
    try {
      await identifySheet(supabase, sheet.id, {
        sheetNumber: number,
        sheetTitle: title,
        discipline: discipline === OTHER ? otherDiscipline : discipline,
        drawingScale: scale,
        revision,
        revisionDate: revisionDate || null,
      });
      setSaved(true);
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Tag className="size-4 text-charcoal-500" aria-hidden />
        <span className="font-medium text-charcoal-900">{sheet.label}</span>
        {sheet.discipline ? <Badge variant="default">{sheet.discipline}</Badge> : null}
        {sheet.revision ? <Badge variant="default">rev {sheet.revision}</Badge> : null}
        {sheet.drawingScale
          ? <span className="text-xs text-charcoal-600">{sheet.drawingScale}</span> : null}
        {saved ? (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <Check className="size-3.5" aria-hidden /> saved
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <PencilLine className="mr-1.5 size-3.5" aria-hidden /> Name this sheet
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-charcoal-200 bg-charcoal-50/50 p-3">
      <p className="mb-3 text-xs text-charcoal-600">
        Copy the title block. Page {sheet.pageNumber} of {sheet.documentName}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="sheet-number">Sheet number</Label>
          <Input id="sheet-number" value={number} placeholder="C1.0"
            onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="sheet-title">Sheet title</Label>
          <Input id="sheet-title" value={title} placeholder="Overall Site Plan"
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sheet-discipline">Discipline</Label>
          <Select value={discipline} onValueChange={setDiscipline}>
            <SelectTrigger id="sheet-discipline">
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {DISCIPLINES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              <SelectItem value={OTHER}>Something else…</SelectItem>
            </SelectContent>
          </Select>
          {discipline === OTHER ? (
            <Input aria-label="Discipline" value={otherDiscipline} placeholder="Discipline"
              onChange={(e) => setOtherDiscipline(e.target.value)} />
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sheet-scale">Scale printed on the sheet</Label>
          <Input id="sheet-scale" value={scale} placeholder={'1" = 20\''}
            onChange={(e) => setScale(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sheet-revision">Revision</Label>
            <Input id="sheet-revision" value={revision} placeholder="2"
              onChange={(e) => setRevision(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sheet-revision-date">Revision date</Label>
            <Input id="sheet-revision-date" type="date" value={revisionDate}
              onChange={(e) => setRevisionDate(e.target.value)} />
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-charcoal-500">
        The scale here is what the title block claims. It is not used to measure —
        calibrate against a printed dimension, because a set printed to a different
        size no longer reads at the scale on it.
      </p>

      {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}

      <div className="mt-3 flex gap-2">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving' : 'Save sheet name'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </section>
  );
}

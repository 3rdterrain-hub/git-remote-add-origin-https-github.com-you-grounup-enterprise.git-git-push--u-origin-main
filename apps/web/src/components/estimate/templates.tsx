/**
 * Starting from one you have built before.
 *
 * Three pieces, all of them thin over governed functions:
 *
 *   * `TemplatePicker` — chooses one and shows what it would add, because a
 *     template applied blind is a bid nobody checked.
 *   * `SaveTemplateDialog` — captures the open version, and makes the one
 *     decision that matters explicit: whether the quantities come too.
 *   * `ApplyWarnings` — says what the template could not bring. A template
 *     saved a year ago may name a machine the company has since retired; the
 *     database keeps the line and clears the reference, and this is where the
 *     estimator finds out rather than at pricing time.
 */
import { useState } from 'react';
import { Archive, BookmarkPlus, LayoutTemplate, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/misc';
import { Alert } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadTemplates, loadTemplateLines, saveTemplate, applyTemplate, archiveTemplate,
  type TemplateRow, type ApplyResult,
} from '@/lib/data/templates';
import { date, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

/** One line of plain English about what a template brings. */
export function templateSummary(t: TemplateRow): string {
  const parts = [`${t.lineCount} line${t.lineCount === 1 ? '' : 's'}`];
  if (t.linesWithResources > 0) {
    parts.push(`${t.linesWithResources} with a crew or machine`);
  }
  if (t.markupCount > 0) parts.push(`${t.markupCount} markup${t.markupCount === 1 ? '' : 's'}`);
  parts.push(t.carriesQuantities ? 'quantities included' : 'no quantities');
  return parts.join(' · ');
}

/**
 * Choose a template, and see what it holds before applying it.
 *
 * Selecting is separate from applying on purpose. The preview below the list is
 * the only chance an estimator gets to notice that a template carries last
 * job's quantities before those quantities are in their bid.
 */
export function TemplatePicker({ value, onChange, refreshKey }: {
  value: string | null;
  onChange: (id: string | null, template: TemplateRow | null) => void;
  refreshKey?: unknown;
}) {
  const templates = useQuery(loadTemplates, [refreshKey]);
  const lines = useQuery(
    value ? loadTemplateLines(value) : async () => [], [value]);

  if (templates.status === 'demonstration') return null;
  if (templates.status === 'loading') return <LoadingState label="Loading templates" />;
  if (templates.status === 'error') {
    return <ErrorState message={templates.message} onRetry={templates.refetch} />;
  }
  if (templates.data.length === 0) {
    return (
      <EmptyState
        title="No templates yet"
        hint="Save an estimate you have already built as a template, and the next one like it starts here."
      />
    );
  }

  const chosen = templates.data.find((t) => t.id === value) ?? null;

  return (
    <div className="space-y-3">
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {templates.data.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id === value ? null : t.id, t.id === value ? null : t)}
            className={cn(
              'w-full rounded-lg border p-3 text-left transition-colors',
              t.id === value
                ? 'border-yellow-500 bg-yellow-50'
                : 'border-charcoal-200 hover:border-charcoal-300 hover:bg-charcoal-50',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-charcoal-900">{t.name}</p>
                <p className="truncate text-xs text-charcoal-500">{templateSummary(t)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {t.trade ? <Badge variant="default">{t.trade}</Badge> : null}
                {t.carriesQuantities ? <Badge variant="warn">Quantities</Badge> : null}
              </div>
            </div>
            {t.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-charcoal-600">{t.description}</p>
            ) : null}
          </button>
        ))}
      </div>

      {chosen ? (
        <div className="rounded-lg border border-charcoal-200 bg-charcoal-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-charcoal-700">
            <LayoutTemplate className="size-3.5" />
            What this adds
            {chosen.sourceEstimateNumber ? (
              <span className="font-normal text-charcoal-500">
                · captured from {chosen.sourceEstimateNumber}
              </span>
            ) : null}
          </p>
          {lines.status === 'ready' ? (
            <ul className="space-y-1 text-xs text-charcoal-600">
              {lines.data.slice(0, 8).map((l) => (
                <li key={l.position} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">
                    {l.description}
                    {l.resourceCount > 0 ? (
                      <span className="ml-1.5 inline-flex items-baseline gap-0.5 text-charcoal-400">
                        <Wrench className="size-3 translate-y-0.5" />
                        {l.resourceCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular shrink-0 text-charcoal-500">
                    {chosen.carriesQuantities ? `${qty(l.measuredQuantity)} ${l.unit}` : l.unit}
                  </span>
                </li>
              ))}
              {lines.data.length > 8 ? (
                <li className="text-charcoal-400">and {lines.data.length - 8} more</li>
              ) : null}
            </ul>
          ) : <LoadingState label="Reading the template" />}
          <p className="mt-2 text-xs text-charcoal-500">
            {chosen.carriesQuantities
              ? 'This template carries the quantities it was captured with. Check them against this job before pricing.'
              : 'Quantities arrive at zero. Enter this job’s own, then price.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** What a template could not bring across, said plainly. */
export function ApplyWarnings({ result }: { result: ApplyResult | null }) {
  if (!result || result.warnings.length === 0) return null;
  return (
    <Alert tone="warn" title="Some of it could not come across">
      <ul className="list-disc space-y-0.5 pl-4">
        {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
      <p className="mt-1.5">
        Those lines were kept and their references cleared, so nothing is priced against a row
        that is no longer in your library.
      </p>
    </Alert>
  );
}

/**
 * Save the open version as a template.
 *
 * The quantity switch is off by default and says why. It is the single decision
 * that turns a template from a starting point into a hazard.
 */
export function SaveTemplateDialog({ versionId, lineCount, open, onOpenChange, onSaved }: {
  versionId: string;
  lineCount: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [description, setDescription] = useState('');
  const [includeQuantities, setIncludeQuantities] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || name.trim().length < 2) return;
    setBusy(true); setError(null);
    try {
      const id = await saveTemplate(supabase, {
        versionId, name, description, trade, includeQuantities,
      });
      setName(''); setTrade(''); setDescription(''); setIncludeQuantities(false);
      onSaved(id);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Captures {lineCount} line{lineCount === 1 ? '' : 's'} with the crew, equipment,
            material and haul on each, plus this bid's markups. No price is captured — a template
            starts an estimate the engine then prices against today's rates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input id="tpl-name" value={name} autoFocus
              placeholder="Detention pond with access road"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-trade">Kind of work</Label>
            <Input id="tpl-trade" value={trade} placeholder="Earthwork"
              onChange={(e) => setTrade(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">What it is for</Label>
            <Input id="tpl-desc" value={description}
              placeholder="Excavate, line and the road in"
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-charcoal-200 p-3">
            <div>
              <p className="text-sm font-medium text-charcoal-900">Carry the quantities too</p>
              <p className="text-xs text-charcoal-500">
                Off by default. A template is the shape of a job, not this one's takeoff — and a
                quantity that arrives from the last bid is the kind of number that gets sent.
              </p>
            </div>
            <Switch checked={includeQuantities} onCheckedChange={setIncludeQuantities}
              aria-label="Carry the quantities too" />
          </div>

          {error ? <ErrorState message={error} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || name.trim().length < 2}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BookmarkPlus className="size-4" />}
            {busy ? 'Saving…' : 'Save template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Add a template's lines to an estimate already open.
 *
 * Appended rather than replacing, so two templates can make one bid and a
 * half-built estimate is not lost by starting from one.
 */
export function ApplyTemplateDialog({ versionId, open, onOpenChange, onApplied }: {
  versionId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApplied: (result: ApplyResult) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase || !chosen) return;
    setBusy(true); setError(null);
    try {
      const result = await applyTemplate(supabase, versionId, chosen);
      setChosen(null);
      onApplied(result);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add from a template</DialogTitle>
          <DialogDescription>
            The template's lines are added below what is already here, with the crew and
            equipment attached to each. Nothing already on this estimate is replaced.
          </DialogDescription>
        </DialogHeader>

        <TemplatePicker value={chosen} onChange={(id) => setChosen(id)} refreshKey={open} />
        {error ? <ErrorState message={error} /> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !chosen}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LayoutTemplate className="size-4" />}
            {busy ? 'Adding…' : 'Add these lines'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The templates this company keeps, and the one action they need.
 *
 * Archived rather than deleted, because an estimate built from a template is
 * easier to explain when the template it came from still exists. An archived
 * one stops being offered and frees its name.
 */
export function TemplateShelf({ canEdit }: { canEdit: boolean }) {
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const templates = useQuery(loadTemplates, [refresh]);

  if (templates.status !== 'ready' || templates.data.length === 0) return null;

  const archive = async (id: string) => {
    if (!supabase) return;
    setBusy(id); setError(null);
    try {
      await archiveTemplate(supabase, id, true);
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-charcoal-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-charcoal-200 p-4">
        <div>
          <p className="flex items-center gap-1.5 font-medium text-charcoal-900">
            <LayoutTemplate className="size-4 text-charcoal-400" /> Templates
          </p>
          <p className="text-xs text-charcoal-500">
            Saved structures new estimates start from. Each carries the crew and equipment on
            its lines; none carries a price.
          </p>
        </div>
      </div>
      {error ? <div className="p-4"><ErrorState message={error} /></div> : null}
      <ul className="divide-y divide-charcoal-100">
        {templates.data.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-medium text-charcoal-900">
                {t.name}
                {t.trade ? <Badge variant="default">{t.trade}</Badge> : null}
                {t.carriesQuantities ? <Badge variant="warn">Quantities</Badge> : null}
              </p>
              <p className="truncate text-xs text-charcoal-500">{templateSummary(t)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-charcoal-500">
                {t.timesUsed > 0
                  ? `used ${t.timesUsed}\u00d7${t.lastUsedAt ? `, last ${date(t.lastUsedAt)}` : ''}`
                  : 'not used yet'}
              </span>
              {canEdit ? (
                <Button variant="ghost" size="sm" disabled={busy != null}
                  onClick={() => archive(t.id)}>
                  {busy === t.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Archive className="size-4" />}
                  Archive
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

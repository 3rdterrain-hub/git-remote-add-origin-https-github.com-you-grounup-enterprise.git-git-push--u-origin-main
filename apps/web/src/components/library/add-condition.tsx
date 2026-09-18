/**
 * Describing a condition of your own. WORKFLOW.
 *
 * Twenty shipped modifiers and no way to add the one your own ground gives you.
 *
 * The thing this form exists to say out loud: **the same number means opposite
 * things depending on where it lands.** 0.8 on production is twenty percent
 * slower; 0.8 on labor cost is twenty percent cheaper. That ambiguity is what
 * the explicit factor map was built to remove — the shipped library it replaced
 * had single entries like "0.88 / Labor+Production" that could mean either —
 * so every row here says which way its number goes as you type it.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { CategorySelect } from '@/components/ui/category-select';
import { messageFor } from '@/lib/data/query';
import { createConditionModifier, MODIFIER_TARGETS } from '@/lib/data/library';
import { cn } from '@/lib/utils';

/** What a factor does, in the words somebody would use about the job. */
function says(kind: 'rate' | 'cost', value: number): { text: string; tone: string } {
  if (!Number.isFinite(value) || value <= 0) return { text: '', tone: '' };
  const pct = Math.round(Math.abs(1 - value) * 100);
  if (pct === 0) return { text: 'no change', tone: 'text-charcoal-400' };
  if (kind === 'rate') {
    return value < 1
      ? { text: `${pct}% slower`, tone: 'text-danger-700' }
      : { text: `${pct}% faster`, tone: 'text-success-700' };
  }
  return value > 1
    ? { text: `${pct}% dearer`, tone: 'text-danger-700' }
    : { text: `${pct}% cheaper`, tone: 'text-success-700' };
}

export function AddCondition({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [factors, setFactors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = Object.entries(factors)
    .filter(([, v]) => v.trim() !== '' && Number(v) > 0);
  const ready = companyId !== null && name.trim() !== '' && chosen.length > 0;

  if (!open) {
    return (
      <Button size="sm" disabled={!canWrite || !companyId}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}
        onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a condition
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cm-name">What the ground or the job is doing</Label>
          <Input id="cm-name" value={name} autoFocus placeholder="Toledo blue clay"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cm-cat">Category</Label>
          <CategorySelect id="cm-cat" kind="modifier_category" label="condition category"
            value={category} onChange={setCategory} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>What it does</Label>
        <p className="text-xs text-charcoal-500">
          Leave a row blank and it is untouched. A multiplier, not a percentage: twenty
          percent slower is <strong>0.80</strong>, twenty percent dearer is <strong>1.20</strong>.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODIFIER_TARGETS.map((t) => {
            const raw = factors[t.key] ?? '';
            const meaning = says(t.kind, Number(raw));
            return (
              <div key={t.key} className="flex items-center gap-2">
                <Label htmlFor={`cm-${t.key}`} className="w-32 shrink-0 text-xs">
                  {t.label}
                </Label>
                <Input id={`cm-${t.key}`} type="number" step="0.01" min="0" className="h-8 w-24"
                  value={raw} placeholder="—"
                  onChange={(e) => setFactors((f) => ({ ...f, [t.key]: e.target.value }))} />
                {/* The same number means opposite things on a rate and a cost,
                    so the screen says which as it is typed. */}
                <span className={cn('text-xs', meaning.tone)}>{meaning.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {chosen.some(([k]) => k === 'production')
        && chosen.some(([k]) => k.endsWith('_cost')) ? (
          <Alert tone="warn" title="This one lands twice on the same resource">
            A condition that slows the work and raises a cost does both to the same machine or
            crew — they are on the job longer <em>and</em> dearer. That is usually what you
            mean, and it is a bigger move than either number looks.
          </Alert>
        ) : null}

      {error ? <Alert tone="danger" title="That condition was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'A name, and at least one factor'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createConditionModifier(companyId, {
              name: name.trim(),
              category: category || null,
              factors: Object.fromEntries(chosen.map(([k, v]) => [k, Number(v)])),
            })
              .then(() => {
                setName(''); setCategory(''); setFactors({});
                setOpen(false); onAdded();
              })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it
        </Button>
      </div>
    </div>
  );
}

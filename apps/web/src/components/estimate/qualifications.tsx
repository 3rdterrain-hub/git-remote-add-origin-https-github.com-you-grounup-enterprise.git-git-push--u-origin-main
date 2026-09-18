/**
 * What this bid is priced on, and what it does not cover. WORKFLOW.
 *
 * The proposal document has carried an exclusions section since it was written
 * and `proposal-pdf.ts` passed it an empty array every time, because nothing
 * had ever written a row into `estimate_exclusions`. A bid went out of this
 * platform saying nothing about rock, dewatering, permits, or the geotechnical
 * report nobody supplied — which is an offer to do whatever turns up.
 *
 * Two rules from migration 0232 are visible on this screen rather than hidden
 * in a refusal:
 *
 *   * **Every exclusion states why.** Section 49 — an item may not be excluded
 *     merely because it is inconvenient to estimate. The reason box is beside
 *     the exclusion, not behind a disclosure, because it is the half that has
 *     to be true for this job.
 *   * **Every assumption states what it rests on.** A sheet, a call, a site
 *     visit, or the absence of a report. An assumption with no basis is a guess
 *     with a serious face on.
 */
import { useState } from 'react';
import { Check, Loader2, Plus, ScrollText, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  estimateAssumptions, estimateExclusions, addAssumption, addExclusion,
  setAssumption, removeAssumption, removeExclusion, COMMON_EXCLUSIONS,
} from '@/lib/data/qualifications';
import { plural } from '@/lib/format';

export function Qualifications({ versionId, editable }: {
  versionId: string; editable: boolean;
}) {
  const assumptions = useQuery(estimateAssumptions(versionId), [versionId]);
  const exclusions = useQuery(estimateExclusions(versionId), [versionId]);

  const [exText, setExText] = useState('');
  const [exWhy, setExWhy] = useState('');
  const [exCat, setExCat] = useState('');
  const [asText, setAsText] = useState('');
  const [asWhy, setAsWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const exRows = exclusions.status === 'ready' ? exclusions.data : [];
  const asRows = assumptions.status === 'ready' ? assumptions.data : [];
  const taken = new Set(exRows.map((e) => e.exclusion.toLowerCase()));

  const refresh = () => { exclusions.refetch(); assumptions.refetch(); };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setProblem(null);
    try { await fn(); refresh(); }
    catch (err) { setProblem(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <CollapsibleCard
      id="what-this-price-is-built-on"
      defaultOpen={false}
      title={
        <span className="flex items-center gap-2">
          <ScrollText className="size-4 text-charcoal-500" />
          What this price is built on
        </span>
      }
      description={
        'What a bid excludes and what it assumes is the half of it that gets argued about '
        + 'afterwards. Everything here goes onto the proposal the customer reads, and every '
        + 'line states why — an item may not be excluded merely because it is awkward to price.'
      }
    >
      <div className="space-y-6">
        {/* ------------------------------------------------ exclusions */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Not included in this price</Label>
            {exRows.length > 0 ? (
              <span className="text-xs text-charcoal-500">{plural(exRows.length, 'exclusion')}</span>
            ) : null}
          </div>

          {exRows.length === 0 ? (
            <p className="text-xs text-charcoal-500">
              Nothing excluded yet. A bid with no exclusions is an offer to do whatever
              turns up on the site.
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-100 rounded-md border border-charcoal-200 bg-white">
              {exRows.map((e) => (
                <li key={e.id} className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-charcoal-900">
                      {e.exclusion}
                      {e.category ? (
                        <Badge variant="outline" className="ml-2">{e.category}</Badge>
                      ) : null}
                    </p>
                    <p className="text-sm text-charcoal-600">{e.reason}</p>
                  </div>
                  {editable ? (
                    <Button size="sm" variant="ghost" disabled={busy}
                      title="Take this exclusion off the bid"
                      onClick={() => run(() => removeExclusion(e.id))}>
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {editable ? (
            <>
              {/*
                * Offered, never written automatically. Each still needs a reason
                * typed against it, because the reason is the part that has to be
                * true for this job — "no geotechnical report was provided" is a
                * fact about this set, not a phrase to paste.
                */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {COMMON_EXCLUSIONS
                  .filter((c) => !taken.has(c.exclusion.toLowerCase()))
                  .map((c) => (
                    <button key={c.exclusion} type="button"
                      title={`Start an exclusion for ${c.exclusion} — you still say why`}
                      className="rounded-full border border-charcoal-200 bg-white px-2.5 py-0.5 text-xs text-charcoal-700 hover:bg-charcoal-50"
                      onClick={() => { setExText(c.exclusion); setExCat(c.category); }}>
                      + {c.exclusion}
                    </button>
                  ))}
              </div>

              <div className="grid gap-2 rounded-md border border-dashed border-charcoal-300 p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`ex-${versionId}`}>What is not included</Label>
                  <Input id={`ex-${versionId}`} value={exText} placeholder="Rock excavation"
                    onChange={(e) => setExText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`exw-${versionId}`}>Why it is excluded</Label>
                  <Input id={`exw-${versionId}`} value={exWhy}
                    placeholder="No geotechnical report was provided with the set"
                    onChange={(e) => setExWhy(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Button size="sm"
                    disabled={busy || exText.trim() === '' || exWhy.trim() === ''}
                    title={exText.trim() === ''
                      ? 'Say what is not included'
                      : exWhy.trim() === ''
                        ? 'An item may not be excluded merely because it is awkward to price — say why'
                        : undefined}
                    onClick={() => run(async () => {
                      await addExclusion(versionId, {
                        exclusion: exText.trim(),
                        reason: exWhy.trim(),
                        category: exCat.trim() || null,
                      });
                      setExText(''); setExWhy(''); setExCat('');
                    })}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Add exclusion
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* ----------------------------------------------- assumptions */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>What this price assumes</Label>
            {asRows.length > 0 ? (
              <span className="text-xs text-charcoal-500">{plural(asRows.length, 'assumption')}</span>
            ) : null}
          </div>

          {asRows.length === 0 ? (
            <p className="text-xs text-charcoal-500">
              Nothing recorded yet. What you priced it as — strip depth, haul distance,
              where the spoil goes — is what you will be asked to prove later.
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-100 rounded-md border border-charcoal-200 bg-white">
              {asRows.map((a) => (
                <li key={a.id} className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-charcoal-900">{a.assumption}</p>
                    <p className="text-sm text-charcoal-600">{a.reason}</p>
                  </div>
                  {editable ? (
                    <>
                      {/* Per item, because everything can be shown to the client or held back. */}
                      <Button size="sm" variant="ghost" disabled={busy}
                        title={a.isDisclosedToCustomer
                          ? 'Shown on the proposal. Click to keep it internal.'
                          : 'Internal only. Click to show it on the proposal.'}
                        onClick={() => run(() => setAssumption(a.id, {
                          isDisclosedToCustomer: !a.isDisclosedToCustomer,
                        }))}>
                        {a.isDisclosedToCustomer
                          ? <Eye className="size-4" />
                          : <EyeOff className="size-4 text-charcoal-400" />}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy}
                        title="Take this assumption off the bid"
                        onClick={() => run(() => removeAssumption(a.id))}>
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <Badge variant="outline">
                      {a.isDisclosedToCustomer ? 'On the proposal' : 'Internal'}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editable ? (
            <div className="grid gap-2 rounded-md border border-dashed border-charcoal-300 p-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`as-${versionId}`}>What is assumed</Label>
                <Input id={`as-${versionId}`} value={asText}
                  placeholder="Topsoil stripped at 6 inches"
                  onChange={(e) => setAsText(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`asw-${versionId}`}>What it rests on</Label>
                <Input id={`asw-${versionId}`} value={asWhy}
                  placeholder="Sheet C1.0 grading note, confirmed on the site visit"
                  onChange={(e) => setAsWhy(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Button size="sm"
                  disabled={busy || asText.trim() === '' || asWhy.trim() === ''}
                  title={asText.trim() === ''
                    ? 'Say what is being assumed'
                    : asWhy.trim() === ''
                      ? 'An assumption with no basis is a guess with a serious face on — say where it came from'
                      : undefined}
                  onClick={() => run(async () => {
                    await addAssumption(versionId, {
                      assumption: asText.trim(), reason: asWhy.trim(),
                    });
                    setAsText(''); setAsWhy('');
                  })}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Add assumption
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {problem ? (
          <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}

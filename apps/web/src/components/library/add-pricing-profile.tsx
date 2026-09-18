/**
 * Starting a pricing profile. WORKFLOW.
 *
 * A profile could only be copied — `adopt_profile_markups` takes somebody
 * else's — so a company that marks up the way it has for twenty years had to
 * start from the nearest shipped thing and edit it into shape.
 *
 * It arrives with **no markup on it**, and the form says so. A profile carrying
 * a helpful ten percent would put margin nobody chose on every line it touches,
 * and the first anybody would know is a bid that came back higher than the
 * estimator meant. Pricing at cost is visible and wrong in a way somebody
 * notices; silent margin is wrong in a way nobody does.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { createPricingProfile } from '@/lib/data/library';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function AddPricingProfile({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [method, setMethod] = useState<'parallel' | 'stacked'>('parallel');
  const [region, setRegion] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" disabled={!canWrite || !companyId}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}
        onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add a pricing profile
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pp-name">What it is for</Label>
          <Input id="pp-name" value={name} autoFocus placeholder="Public work"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pp-method">How the markups apply</Label>
          <select id="pp-method" className={field} value={method}
            onChange={(e) => setMethod(e.target.value as 'parallel' | 'stacked')}>
            <option value="parallel">Parallel — each off the same base</option>
            <option value="stacked">Stacked — each off the running total</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pp-region">Region</Label>
          <Input id="pp-region" value={region} placeholder="Northwest Ohio"
            onChange={(e) => setRegion(e.target.value)} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)} />
        Make this the default. Whichever profile holds that now steps down — one default,
        never two.
      </label>

      <Alert tone="info" title="It starts with no markup">
        The profile prices at cost until you add overhead, profit, bond or anything else.
        Nothing is assumed — a markup that arrived on its own would be margin you did not
        choose, on every line it touches.
      </Alert>

      {error ? <Alert tone="danger" title="That profile was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={busy || !name.trim() || !companyId}
          title={name.trim() ? undefined : 'A name, at least'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            createPricingProfile(companyId, {
              name: name.trim(), method, region: region.trim() || null, isDefault,
            })
              .then(() => {
                setName(''); setRegion(''); setIsDefault(false);
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

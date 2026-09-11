/**
 * Entity — where the work is.
 *
 * `estimates.site_address`, `site_city` and `site_state` have existed since
 * migration 0006. `app.award_estimate_version` reads all three and copies them
 * onto the project it creates, which is how a job knows where it is — and it is
 * what the site forecast needs, because a forecast at the yard is a different
 * claim from one at the site.
 *
 * Nothing wrote them until 0148. Every estimate carried three nulls, so every
 * project awarded from one did too. Found by awarding a real estimate and
 * reading the project.
 *
 * The new-estimate dialog asks for it now, which covers the bid invitation that
 * arrived with an address on it. This is the other half, and it is the half the
 * setter was written for: the answer often arrives later and changes — a
 * county and a parcel become a street address once somebody drives out to look.
 * Without this, an estimate created before anybody knew could never be told.
 *
 * It goes read-only the moment the estimate goes out, and says so rather than
 * disappearing. Where the work is was part of what was bid.
 */
import { useState } from 'react';
import { Check, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { messageFor } from '@/lib/data/query';
import { setEstimateSite } from '@/lib/data/estimates';
import { supabase } from '@/lib/supabase';

export function WhereTheWorkIs({ estimateId, address, city, state, editable, onSaved }: {
  estimateId: string;
  address: string | null;
  city: string | null;
  state: string | null;
  /** False once the estimate has gone out; the database refuses it then too. */
  editable: boolean;
  onSaved: () => void;
}) {
  const [a, setA] = useState(address ?? '');
  const [c, setC] = useState(city ?? '');
  const [st, setSt] = useState(state ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stated = [address, city, state].filter(Boolean).join(', ');
  const changed = (a.trim() || null) !== (address ?? null)
    || (c.trim() || null) !== (city ?? null)
    || (st.trim().toUpperCase() || null) !== (state ?? null);

  async function save() {
    if (!supabase) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await setEstimateSite(supabase, estimateId, { address: a, city: c, state: st });
      setSaved(true);
      onSaved();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  }

  return (
    <CollapsibleCard
      title="Where the work is"
      description="Awarding this estimate copies the site onto the project, which is what lets the forecast be the one at the job rather than the one at your yard. It is not used to price anything."
      summary={stated || 'not stated'}
      defaultOpen={false}
    >
      <div className="space-y-3">
        {!editable ? (
          <Alert tone="neutral" icon={<MapPin className="size-4" />}>
            This estimate has gone out, and where the work is was part of what went out. Create a
            revision to change it, or set the site on the project itself once it is won.
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="site-address">Site address</Label>
            <Input id="site-address" value={a} disabled={!editable || busy}
              placeholder="1400 Venice Rd" onChange={(e) => { setA(e.target.value); setSaved(false); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-city">City</Label>
            <Input id="site-city" value={c} disabled={!editable || busy}
              placeholder="Sandusky" onChange={(e) => { setC(e.target.value); setSaved(false); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-state">State</Label>
            <Input id="site-state" className="w-20" value={st} disabled={!editable || busy}
              placeholder="OH" maxLength={2}
              onChange={(e) => { setSt(e.target.value); setSaved(false); }} />
          </div>
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => void save()} disabled={busy || !changed}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save the site
            </Button>
            {saved && !changed ? (
              <span className="flex items-center gap-1 text-xs text-success-700">
                <Check className="size-3.5" /> Saved
              </span>
            ) : null}
            <span className="text-xs text-charcoal-500">
              Clearing all three is allowed: an address nobody has is better recorded as none than
              as a guess.
            </span>
          </div>
        ) : null}
      </div>
    </CollapsibleCard>
  );
}

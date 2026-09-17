/**
 * Consent, and then publication. WORKFLOW.
 *
 * Two acts on a listing you own, in a fixed order, and the order is the whole
 * point. `network_vendors_consent` refuses a published row with no consent
 * recorded, so this panel does not gate anything the database would let past —
 * it says, before the refusal, what the refusal will be about.
 *
 * The note is required rather than optional. "Signed form, returned 3 March"
 * and "somebody said it was fine" are not the same claim, and the difference is
 * the entire value of the record on the day a vendor says they never agreed.
 */
import { useState } from 'react';
import { Loader2, ShieldCheck, Globe, EyeOff, Handshake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import {
  recordNetworkConsent, publishNetworkVendor, type NetworkVendor,
} from '@/lib/data/network';

export function ListingActions({ vendor, canWrite, onChanged }: {
  vendor: NetworkVendor;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [how, setHow] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vendor.isMine) return null;

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    fn()
      .then(() => { setAsking(false); setHow(''); onChanged(); })
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-2 border-t border-charcoal-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {vendor.consentOnRecord ? (
          <span className="flex items-center gap-1.5 text-xs text-success-700"
            title={vendor.consentNote ?? undefined}>
            <ShieldCheck className="size-3.5" /> Consent on record
          </span>
        ) : (
          <Button variant="outline" size="sm" disabled={!canWrite || busy}
            onClick={() => setAsking((a) => !a)}
            title={canWrite ? undefined : 'Needs permission to write the libraries'}>
            <Handshake className="size-4" /> Record their consent
          </Button>
        )}

        {vendor.isPublished ? (
          <Button variant="outline" size="sm" disabled={!canWrite || busy}
            onClick={() => run(() => publishNetworkVendor(vendor.id, false))}
            title="Take the listing back off the network. The ratings left against it stay.">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <EyeOff className="size-4" />}
            Unpublish
          </Button>
        ) : (
          <Button variant="outline" size="sm"
            disabled={!canWrite || busy || !vendor.consentOnRecord}
            onClick={() => run(() => publishNetworkVendor(vendor.id, true))}
            title={vendor.consentOnRecord
              ? 'Put this listing in front of every company on the network'
              : 'Their consent has to be on record first'}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            Publish to the network
          </Button>
        )}
      </div>

      {asking ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
          <div className="space-y-1">
            <Label htmlFor={`nc-${vendor.id}`}>How they agreed to be listed</Label>
            <Input id={`nc-${vendor.id}`} value={how} autoFocus
              placeholder="Signed listing agreement returned by email, 3 March"
              onChange={(e) => setHow(e.target.value)} />
          </div>
          <p className="text-xs text-charcoal-500">
            Stored with your name and the date. It is what you will have to show if they later say
            they never agreed, so it is worth writing the actual thing that happened.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Cancel</Button>
            <Button size="sm" disabled={busy || how.trim() === ''}
              title={how.trim() ? undefined : 'Say how they agreed'}
              onClick={() => run(() => recordNetworkConsent(vendor.id, how.trim()))}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record it
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <Alert tone="danger" title="That did not go through">{error}</Alert> : null}
    </div>
  );
}

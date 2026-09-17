/**
 * Putting a subcontractor in your own list. WORKFLOW.
 *
 * It arrives private. Nothing on this form publishes anything, and that is
 * deliberate: publishing another company's legal name, contact details and
 * insurance status into a directory every tenant can read is a separate act
 * that needs their agreement on file first.
 */
import { useState } from 'react';
import { Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { listNetworkVendor } from '@/lib/data/network';

/** Comma separated in, trimmed list out. Empty entries are dropped, not kept. */
function list(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function ListAVendor({ companyId, canWrite, onListed }: {
  companyId: string | null;
  canWrite: boolean;
  onListed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [trades, setTrades] = useState('');
  const [regions, setRegions] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [insurance, setInsurance] = useState('');
  const [bonding, setBonding] = useState('');
  const [isDbe, setIsDbe] = useState(false);
  const [isMbe, setIsMbe] = useState(false);
  const [isWbe, setIsWbe] = useState(false);
  const [certifications, setCertifications] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = companyId !== null && legalName.trim() !== '';

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to write the libraries'}>
        <Building2 className="size-4" /> Add a vendor
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="nv-legal">Legal name</Label>
          <Input id="nv-legal" value={legalName} autoFocus placeholder="Buckeye Dewatering LLC"
            onChange={(e) => setLegalName(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="nv-display">Known as</Label>
          <Input id="nv-display" value={displayName} placeholder="Buckeye Dewatering"
            onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="nv-trades">Trades</Label>
          <Input id="nv-trades" value={trades} placeholder="Dewatering, Wellpoint, Bypass pumping"
            onChange={(e) => setTrades(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="nv-regions">Service area</Label>
          <Input id="nv-regions" value={regions} placeholder="Northwest Ohio, Southeast Michigan"
            onChange={(e) => setRegions(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nv-city">City</Label>
          <Input id="nv-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nv-state">State</Label>
          <Input id="nv-state" value={state} placeholder="OH"
            onChange={(e) => setState(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nv-ins">Insurance expires</Label>
          <Input id="nv-ins" type="date" value={insurance}
            onChange={(e) => setInsurance(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nv-bond">Bonding capacity</Label>
          <Input id="nv-bond" type="number" value={bonding} placeholder="0"
            onChange={(e) => setBonding(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="nv-certs">Certifications</Label>
          <Input id="nv-certs" value={certifications} placeholder="ODOT prequalified, OSHA 30"
            onChange={(e) => setCertifications(e.target.value)} />
        </div>
      </div>

      <fieldset className="flex flex-wrap items-center gap-4 text-sm">
        <legend className="sr-only">Certified participation</legend>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isDbe} onChange={(e) => setIsDbe(e.target.checked)} /> DBE
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isMbe} onChange={(e) => setIsMbe(e.target.checked)} /> MBE
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isWbe} onChange={(e) => setIsWbe(e.target.checked)} /> WBE
        </label>
      </fieldset>

      <Alert tone="info" title="This listing starts private">
        It is visible to your company and to nobody else. To put it on the network you record how
        the vendor agreed to be listed, and then publish it — two deliberate acts, in that order.
      </Alert>

      {error ? <Alert tone="danger" title="That vendor was not added">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'A legal name, at least'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            listNetworkVendor(companyId, {
              legalName: legalName.trim(),
              displayName: displayName.trim() || null,
              trades: list(trades),
              regions: list(regions),
              city: city.trim() || null,
              state: state.trim() || null,
              insuranceExpiresOn: insurance || null,
              bondingCapacity: bonding ? Number(bonding) : null,
              isDbe, isMbe, isWbe,
              certifications: list(certifications),
            })
              .then(() => {
                setLegalName(''); setDisplayName(''); setTrades(''); setRegions('');
                setCity(''); setState(''); setInsurance(''); setBonding('');
                setCertifications(''); setIsDbe(false); setIsMbe(false); setIsWbe(false);
                setOpen(false); onListed();
              })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add it, privately
        </Button>
      </div>
    </div>
  );
}

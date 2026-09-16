/**
 * Write down a lead that came in some other way.
 *
 * The Leads tab said "No leads yet — put the form on the Website form tab onto
 * your site, and what people send lands here", and that was the literal truth:
 * `submit_lead` takes a public form key and is granted to `anon`, and there was
 * no signed-in path at all. Directly beneath it the Lead-source card counted
 * phone calls, referrals, walk-ins and bid boards — every one of which was
 * impossible.
 *
 * The source list comes from the company's own `lead_source` categories, so a
 * company that wins work a way nobody thought of adds it rather than asking for
 * a change to the product.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategorySelect } from '@/components/ui/category-select';
import { messageFor } from '@/lib/data/query';
import { createLead } from '@/lib/data/leads';

export function AddLead({ companyId, canWrite, onAdded }: {
  companyId: string | null;
  canWrite: boolean;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [source, setSource] = useState('Phone call');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!companyId || busy) return;
    setBusy(true); setError(null);
    try {
      await createLead(companyId, {
        companyName, source, contactName, phone, email, description,
        estimatedValue: value ? Number(value) : null,
      });
      setCompanyName(''); setContactName(''); setPhone(''); setEmail('');
      setDescription(''); setValue('');
      setOpen(false);
      onAdded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to change CRM records'}>
        <Plus className="size-4" /> Write down a lead
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="lead-name">Who called</Label>
          <Input id="lead-name" value={companyName} autoFocus
            placeholder="Sandusky Aggregates"
            onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-source">How they found you</Label>
          <CategorySelect id="lead-source" kind="lead_source" value={source}
            onChange={setSource} allowEmpty={false} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-contact">Who to ask for</Label>
          <Input id="lead-contact" value={contactName}
            onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-phone">Phone</Label>
          <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-email">Email</Label>
          <Input id="lead-email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lead-value">Roughly worth</Label>
          <Input id="lead-value" type="number" value={value}
            onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="lead-desc">What they want</Label>
          <Input id="lead-desc" value={description}
            placeholder="Price on a transfer station pad, wants it before the end of the month"
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-charcoal-500">
        A phone number or an email is required. Without one there is no lead, only a note.
      </p>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void add()}
          disabled={busy || !companyName.trim() || (!phone.trim() && !email.trim())}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the lead
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

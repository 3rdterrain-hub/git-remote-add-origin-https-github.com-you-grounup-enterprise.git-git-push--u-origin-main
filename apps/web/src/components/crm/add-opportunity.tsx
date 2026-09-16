/**
 * Open an opportunity.
 *
 * The Pipeline tab said "An opportunity arrives when a qualified lead
 * converts", and meant it: `move_opportunity_stage` and `update_opportunity`
 * could work one, and only lead conversion could create one. So a repeat
 * customer ringing up about next year's job had to be entered as a stranger,
 * through a website form, and converted — which is the kind of paperwork that
 * ends with the pipeline not being used at all.
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageFor, useQuery } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { createOpportunity } from '@/lib/data/crm-pipeline';
import { loadCrmCustomers } from '@/lib/data/crm';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function AddOpportunity({ canWrite, onAdded }: {
  canWrite: boolean;
  onAdded: () => void;
}) {
  const customersQ = useQuery(loadCrmCustomers, []);
  const customers = customersQ.status === 'ready' ? customersQ.data : [];

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await createOpportunity(supabase, {
        customerId,
        name,
        description,
        estimatedValue: value ? Number(value) : null,
        bidDueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setName(''); setDescription(''); setValue(''); setDueAt(''); setCustomerId('');
      setOpen(false);
      onAdded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}
        disabled={!canWrite || customers.length === 0}
        title={!canWrite ? 'Needs permission to change CRM records'
          : customers.length === 0
            ? 'An opportunity belongs to a customer — add one first'
            : undefined}>
        <Plus className="size-4" /> Open an opportunity
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="opp-customer">Who it is for</Label>
          <select id="opp-customer" className={field} value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="opp-name">What the job is</Label>
          <Input id="opp-name" value={name} autoFocus
            placeholder="Maumee Commerce Park sitework"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="opp-value">Roughly worth</Label>
          <Input id="opp-value" type="number" value={value}
            onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="opp-due">Bid due</Label>
          <Input id="opp-due" type="date" value={dueAt}
            onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="opp-desc">Anything worth remembering</Label>
          <Input id="opp-desc" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void add()}
          disabled={busy || !customerId || !name.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Open it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

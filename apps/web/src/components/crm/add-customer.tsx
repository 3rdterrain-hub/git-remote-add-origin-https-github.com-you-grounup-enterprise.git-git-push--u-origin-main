/**
 * Add a customer.
 *
 * The button this sits behind was `<Button><UserPlus /> Add customer</Button>` —
 * no handler, over a function that did not exist. It rendered, it hovered, and
 * a person clicking it got nothing. Found by the owner using the product.
 *
 * A second record for the same outfit is refused by the database, which names
 * the code of the one that already exists. That message is shown as-is: "open
 * that one" is more useful than "duplicate key".
 */
import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { createCustomer, CUSTOMER_TYPES } from '@/lib/data/crm';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function AddCustomerDialog({ open, onOpenChange, companyId, onAdded }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  companyId: string | null;
  onAdded: (customerId: string) => void;
}) {
  const [name, setName] = useState('');
  const [customerType, setCustomerType] = useState('commercial');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!supabase || !companyId || busy) return;
    setBusy(true); setError(null);
    try {
      const id = await createCustomer(supabase, companyId, {
        name, customerType, email, phone, city, state, paymentTerms: terms,
      });
      setName(''); setEmail(''); setPhone(''); setCity(''); setState(''); setTerms('');
      onOpenChange(false);
      onAdded(id);
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>
            The code is issued by the system, so two people adding the same outfit on the
            same morning cannot pick the same one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="cust-name">Who they are</Label>
            <Input id="cust-name" value={name} autoFocus
              placeholder="Toledo Public Works"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-type">What kind</Label>
            <select id="cust-type" className={field} value={customerType}
              onChange={(e) => setCustomerType(e.target.value)}>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-terms">Payment terms</Label>
            <Input id="cust-terms" value={terms} placeholder="Net 30"
              onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-phone">Phone</Label>
            <Input id="cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-email">Email</Label>
            <Input id="cust-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-city">City</Label>
            <Input id="cust-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-state">State</Label>
            <Input id="cust-state" value={state} placeholder="OH"
              onChange={(e) => setState(e.target.value)} />
          </div>
        </div>

        {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void add()} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add the customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

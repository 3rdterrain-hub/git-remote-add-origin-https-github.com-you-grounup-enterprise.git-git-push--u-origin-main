/**
 * Somebody to call.
 *
 * `contacts` has existed since migration 0005 with a customer-or-vendor
 * constraint, a partial unique index enforcing one primary per customer, and an
 * index for each owner. It has never held a row, while the plan blurb sells
 * "Basic CRM: customers, contacts, opportunities".
 *
 * A customer record with no people on it is a company with no phone number —
 * you know who owes you money and not who to ring about it.
 *
 * Takes a customer or a vendor, because the table does: a vendor has a
 * dispatcher and a salesman the same way a customer has a project manager and
 * somebody in accounts payable.
 */
import { useState } from 'react';
import { Mail, Phone, Star, Trash2, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import {
  loadContacts, saveContact, retireContact, type ContactRow,
} from '@/lib/data/crm-pipeline';

function Person({ c, editable, onChanged }: {
  c: ContactRow; editable: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (run: () => Promise<unknown>) => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try { await run(); onChanged(); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-charcoal-200
                   py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-charcoal-900">
          {c.fullName}
          {c.title ? <span className="ml-2 font-normal text-charcoal-500">{c.title}</span> : null}
          {c.isPrimary ? <Badge variant="default" className="ml-2">primary</Badge> : null}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-3 text-xs text-charcoal-600">
          {c.email ? (
            <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:underline">
              <Mail className="size-3" aria-hidden />{c.email}
            </a>
          ) : null}
          {c.phone ? (
            <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:underline">
              <Phone className="size-3" aria-hidden />{c.phone}
            </a>
          ) : null}
          {c.mobile ? (
            <a href={`tel:${c.mobile}`} className="flex items-center gap-1 hover:underline">
              <Phone className="size-3" aria-hidden />{c.mobile} (m)
            </a>
          ) : null}
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
      {editable ? (
        <div className="flex shrink-0 items-center gap-1">
          {!c.isPrimary && c.customerId ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy}
              title="Make this the person to call"
              onClick={() => void act(() => saveContact(supabase!, {
                id: c.id, isPrimary: true,
              }))}>
              <Star className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          <button type="button" disabled={busy}
            aria-label={`Retire ${c.fullName}`}
            title="Retire this contact — the record is kept"
            onClick={() => void act(() => retireContact(supabase!, c.id))}
            className="rounded p-1 text-charcoal-400 hover:bg-danger-50 hover:text-danger-700">
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ContactsPanel({ customerId, vendorId, editable, title = 'Who to call' }: {
  customerId?: string | null;
  vendorId?: string | null;
  editable: boolean;
  title?: string;
}) {
  const contactsQ = useQuery(loadContacts, []);
  const all = contactsQ.status === 'ready' ? contactsQ.data : [];
  const mine = all.filter((c) => (customerId ? c.customerId === customerId
    : vendorId ? c.vendorId === vendorId : false));

  const [adding, setAdding] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!supabase || busy) return;
    setBusy(true); setError(null);
    try {
      await saveContact(supabase, {
        customerId: customerId ?? null,
        vendorId: vendorId ?? null,
        firstName: first, lastName: last, title: role || null,
        email: email || null, phone: phone || null,
        isPrimary: primary || mine.length === 0,
      });
      setAdding(false);
      setFirst(''); setLast(''); setRole(''); setEmail(''); setPhone(''); setPrimary(false);
      contactsQ.refetch();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-charcoal-900">{title}</h3>
        <p className="text-xs text-charcoal-500">
          The people at this company, and which of them to ring first.
        </p>
      </div>

      {contactsQ.status === 'loading' ? <LoadingState label="Reading the contacts" /> : null}
      {contactsQ.status === 'error'
        ? <ErrorState message={contactsQ.message} onRetry={contactsQ.refetch} /> : null}

      {contactsQ.status === 'ready' && mine.length === 0 && !adding ? (
        <EmptyState title="Nobody is recorded here yet"
          hint="A customer with no contacts is a company you cannot ring." />
      ) : null}

      {mine.length > 0 ? (
        <ul>
          {mine.map((c) => (
            <Person key={c.id} c={c} editable={editable} onChanged={contactsQ.refetch} />
          ))}
        </ul>
      ) : null}

      {editable && !adding ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          <UserPlus className="mr-1.5 size-3.5" aria-hidden /> Add a contact
        </Button>
      ) : null}

      {editable && adding ? (
        <div className="space-y-3 rounded-lg border border-charcoal-200 bg-charcoal-50/50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-first">First name</Label>
              <Input id="c-first" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-last">Last name</Label>
              <Input id="c-last" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-role">Title</Label>
              <Input id="c-role" value={role} placeholder="Project Manager"
                onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-charcoal-700">
            <input type="checkbox" checked={primary || mine.length === 0}
              disabled={mine.length === 0}
              onChange={(e) => setPrimary(e.target.checked)} />
            The person to call first
            {mine.length === 0 ? (
              <span className="text-xs text-charcoal-500">(the first one always is)</span>
            ) : null}
          </label>

          {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}

          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !first.trim() || !last.trim()}
              onClick={() => void add()}>Add</Button>
            <Button type="button" size="sm" variant="ghost"
              onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

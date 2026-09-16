/**
 * The bills that arrive. WORKFLOW.
 *
 * `ap_invoices` had no writer, so the payables list read a table nothing could
 * put a row into — and `ap_invoices_pay_requires_match`, the control that stops
 * a company paying for materials it never received, had stood since migration
 * 0017 without ever once being reached.
 *
 * The match state is never chosen here. It is computed from the purchase order
 * and what has actually been received, because a browser that could declare an
 * invoice matched could declare its way straight past that control.
 */
import { useState } from 'react';
import { Loader2, Receipt, Check, RefreshCw, Ban, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor, useQuery } from '@/lib/data/query';
import { loadVendors } from '@/lib/data/library';
import { listProjects } from '@/lib/data/projects';
import {
  recordApInvoice, rematchApInvoice, approveApInvoice, setApInvoiceStatus,
  recordApPayment, type ApInvoiceRow,
} from '@/lib/data/finance';
import { money } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

/** Record an invoice a vendor sent. */
export function RecordInvoice({ companyId, canWrite, onRecorded }: {
  companyId: string | null;
  canWrite: boolean;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const vendorsQ = useQuery(loadVendors, [open]);
  const projectsQ = useQuery(listProjects, [open]);
  const vendors = vendorsQ.status === 'ready' ? vendorsQ.data : [];
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];

  const [vendorId, setVendorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  const [retainage, setRetainage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vendor = vendorId || vendors[0]?.id || '';
  const ready = companyId !== null && vendor !== '' && invoiceNumber.trim() !== ''
    && Number(amount) > 0;

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to record a vendor invoice'}>
        <Receipt className="size-4" /> Record an invoice
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ap-vendor">Vendor</Label>
          <select id="ap-vendor" className={field} value={vendor}
            onChange={(e) => setVendorId(e.target.value)}>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-number">Invoice number</Label>
          <Input id="ap-number" value={invoiceNumber} autoFocus placeholder="As the vendor wrote it"
            onChange={(e) => setInvoiceNumber(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-date">Invoice date</Label>
          <Input id="ap-date" type="date" value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-due">Due</Label>
          <Input id="ap-due" type="date" value={dueDate}
            onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-amount">Amount</Label>
          <Input id="ap-amount" type="number" value={amount} placeholder="0"
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-tax">Tax</Label>
          <Input id="ap-tax" type="number" value={tax} placeholder="0"
            onChange={(e) => setTax(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-retain">Retainage withheld</Label>
          <Input id="ap-retain" type="number" value={retainage} placeholder="0"
            onChange={(e) => setRetainage(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-project">Project</Label>
          <select id="ap-project" className={field} value={projectId}
            onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Not job costed</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Alert tone="info" title="The match is worked out, not chosen">
        An invoice against a purchase order is compared with what has actually been received. Until
        it matches, or is decided to have no order to match, it cannot be paid — which is the
        control that stops a company paying for materials it never got.
      </Alert>

      {error ? <Alert tone="danger" title="That invoice was not recorded">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={!ready || busy}
          title={ready ? undefined : 'A vendor, an invoice number and an amount'}
          onClick={() => {
            if (!companyId) return;
            setBusy(true); setError(null);
            recordApInvoice(companyId, {
              vendorId: vendor,
              invoiceNumber,
              invoiceDate,
              amount: Number(amount),
              tax: Number(tax || 0),
              dueDate: dueDate || null,
              projectId: projectId || null,
              retainageWithheld: Number(retainage || 0),
            })
              .then(() => {
                setInvoiceNumber(''); setAmount(''); setTax(''); setRetainage('');
                setOpen(false); onRecorded();
              })
              .catch((e: unknown) => setError(messageFor(e)))
              .finally(() => setBusy(false));
          }}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record it
        </Button>
      </div>
    </div>
  );
}

/** Everything that can be done to one invoice. */
export function InvoiceActions({ invoice, canWrite, canApprove, onChanged }: {
  invoice: ApInvoiceRow;
  canWrite: boolean;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');

  const act = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    fn().then(() => { setPaying(false); onChanged(); })
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setBusy(false));
  };

  const settled = invoice.status === 'paid' || invoice.status === 'void';

  return (
    <div className="space-y-1.5 text-right">
      <div className="flex flex-wrap justify-end gap-1.5">
        {invoice.purchaseOrderId && !settled ? (
          <Button variant="ghost" size="sm" disabled={!canWrite || busy}
            title="Compare it again with what has been received"
            onClick={() => { act(() => rematchApInvoice(invoice.id)); }}>
            <RefreshCw className="size-3.5" /> Re-match
          </Button>
        ) : null}
        {invoice.status === 'received' || invoice.status === 'on_hold' ? (
          <Button variant="outline" size="sm" disabled={!canApprove || busy}
            title={canApprove ? 'Approve it for payment' : 'Needs permission to approve payables'}
            onClick={() => { act(() => approveApInvoice(invoice.id)); }}>
            <Check className="size-3.5" /> Approve
          </Button>
        ) : null}
        {!settled ? (
          <Button size="sm" disabled={!canWrite || busy || invoice.blocked}
            title={invoice.blocked
              ? (invoice.matchProblem ?? 'This invoice does not match its order yet')
              : 'Record a payment against it'}
            onClick={() => setPaying((v) => !v)}>
            <Banknote className="size-3.5" /> Pay
          </Button>
        ) : null}
        {!settled && invoice.amountPaid === 0 ? (
          <Button variant="ghost" size="sm" disabled={!canWrite || busy}
            title="Hold it back from payment"
            onClick={() => { act(() => setApInvoiceStatus(invoice.id, 'on_hold')); }}>
            <Ban className="size-3.5" /> Hold
          </Button>
        ) : null}
      </div>

      {paying ? (
        <div className="flex items-center justify-end gap-2">
          <Input type="number" value={amount} autoFocus className="h-8 w-32 text-right"
            placeholder={String(invoice.balanceDue)}
            onChange={(e) => setAmount(e.target.value)} />
          <Button size="sm" disabled={busy}
            onClick={() => {
              const n = Number(amount || invoice.balanceDue);
              if (!Number.isFinite(n) || n <= 0) return;
              act(() => recordApPayment(invoice.id, n));
            }}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Pay {money(Number(amount || invoice.balanceDue))}
          </Button>
        </div>
      ) : null}

      {error ? <span className="block text-xs text-danger-700">{error}</span> : null}
    </div>
  );
}

/**
 * Entity — the leads that came in.
 *
 * The forms card next to this one could already say a form had taken fourteen
 * leads. There was nowhere to see one of the fourteen: `leads` was written by
 * the public intake, counted by the forms screen, and read by nothing. The work
 * of the screen is therefore small and specific — show what arrived, let
 * somebody move it along, and convert it when it is real.
 *
 * Converting calls `convert_lead` (migration 0065), which makes the customer,
 * numbers the opportunity and stamps the lead in one transaction. It refuses a
 * lead that is not qualified and refuses one converted twice, and both messages
 * are written for a person to read, so they are shown exactly as they arrive
 * rather than replaced with something of ours.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, Inbox, Loader2, Mail, MapPin, Phone, Search, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/data-state';
import { messageFor } from '@/lib/data/query';
import { setLeadStage, convertLead, STAGE_SAYS, type LeadRow } from '@/lib/data/leads';
import { money, date, titleCase, plural } from '@/lib/format';

const STAGE_TONE: Record<string, 'default' | 'info' | 'warn' | 'success' | 'danger'> = {
  new: 'info', contacted: 'warn', qualified: 'success',
  unqualified: 'default', converted: 'default',
};

/** The stages somebody can set by hand. `converted` is reached only by converting. */
const SETTABLE = ['new', 'contacted', 'qualified', 'unqualified'] as const;

export function LeadInboxSection({ leads, canEdit, onChanged }: {
  leads: LeadRow[];
  canEdit: boolean;
  /** Re-read after a stage move or a conversion; the page owns the query. */
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [converting, setConverting] = useState<LeadRow | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads
      .filter((l) => (show === 'all' ? true : l.stage !== 'converted' && l.stage !== 'unqualified'))
      .filter((l) => !q
        || l.companyName.toLowerCase().includes(q)
        || (l.contactName ?? '').toLowerCase().includes(q)
        || (l.email ?? '').toLowerCase().includes(q)
        || (l.city ?? '').toLowerCase().includes(q)
        || (l.description ?? '').toLowerCase().includes(q));
  }, [leads, query, show]);

  const waiting = leads.filter((l) => l.stage === 'new').length;
  const ready = leads.filter((l) => l.stage === 'qualified').length;

  async function move(lead: LeadRow, stage: (typeof SETTABLE)[number]) {
    setBusy(lead.id);
    setFailure(null);
    try {
      await setLeadStage(lead.id, stage);
      onChanged();
    } catch (e) {
      setFailure(messageFor(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-charcoal-500" />
              Leads
            </CardTitle>
            <CardDescription>
              {leads.length === 0
                ? 'Nothing has come in yet.'
                : `${plural(waiting, 'lead')} nobody has spoken to`
                  + (ready > 0 ? `, ${ready} qualified and ready to convert` : '')}
            </CardDescription>
          </div>
          <Select value={show} onValueChange={(v) => setShow(v as 'open' | 'all')}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Still open</SelectItem>
              <SelectItem value="all">Everything</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="space-y-3">
          {failure ? (
            <p className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {failure}
            </p>
          ) : null}

          {leads.length > 0 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
              <Input className="pl-9" placeholder="Search by name, contact, email, city or what they need…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          ) : null}

          {leads.length === 0 ? (
            <EmptyState title="No leads yet"
              hint="Put the form on the Website form tab onto your site, and what people send lands here." />
          ) : shown.length === 0 ? (
            <EmptyState title={query ? 'Nothing matches that search' : 'Nothing open'}
              hint={query ? undefined : 'Switch to Everything to see converted and unqualified leads.'} />
          ) : (
            <ul className="divide-y divide-charcoal-200 rounded-md border border-charcoal-200">
              {shown.map((lead) => (
                <li key={lead.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium text-charcoal-900">{lead.companyName}</span>
                      <Badge variant={STAGE_TONE[lead.stage] ?? 'default'}>{titleCase(lead.stage)}</Badge>
                      {lead.formName ? (
                        <span className="text-xs text-charcoal-500">via {lead.formName}</span>
                      ) : lead.source ? (
                        <span className="text-xs text-charcoal-500">{lead.source}</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-charcoal-500">
                      {date(lead.submittedAt ?? lead.createdAt)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-charcoal-600">
                    {lead.contactName ? <span>{lead.contactName}</span> : null}
                    {lead.email ? (
                      <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${lead.email}`}>
                        <Mail className="size-3.5" />{lead.email}
                      </a>
                    ) : null}
                    {lead.phone ? (
                      <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${lead.phone}`}>
                        <Phone className="size-3.5" />{lead.phone}
                      </a>
                    ) : null}
                    {lead.city || lead.state ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" />
                        {[lead.city, lead.state].filter(Boolean).join(', ')}
                      </span>
                    ) : null}
                    {lead.estimatedValue !== null ? (
                      <span className="tabular">{money(lead.estimatedValue)}</span>
                    ) : null}
                  </div>

                  {lead.description ? (
                    <p className="text-sm text-charcoal-700">{lead.description}</p>
                  ) : null}

                  {lead.stage === 'converted' ? (
                    <p className="text-sm text-charcoal-600">
                      Converted {date(lead.convertedAt ?? lead.createdAt)}.{' '}
                      <Link className="underline" to="/app/crm">See them in Customers</Link>
                    </p>
                  ) : canEdit ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {busy === lead.id ? (
                        <Loader2 className="size-4 animate-spin text-charcoal-400" />
                      ) : null}
                      {SETTABLE.filter((s) => s !== lead.stage).map((s) => (
                        <Button key={s} size="sm" variant="outline" disabled={busy === lead.id}
                          onClick={() => void move(lead, s)}>
                          {s === 'contacted' ? <Phone className="size-3.5" />
                            : s === 'qualified' ? <Check className="size-3.5" />
                            : s === 'unqualified' ? <X className="size-3.5" /> : null}
                          {s === 'new' ? 'Back to new' : titleCase(s)}
                        </Button>
                      ))}
                      <Button size="sm" disabled={busy === lead.id || lead.stage !== 'qualified'}
                        title={lead.stage === 'qualified'
                          ? 'Make a customer and an opportunity from this lead'
                          : 'Speak to them and mark the lead qualified first'}
                        onClick={() => { setFailure(null); setConverting(lead); }}>
                        Convert <ArrowRight className="size-3.5" />
                      </Button>
                      <span className="text-xs text-charcoal-500">{STAGE_SAYS[lead.stage]}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-charcoal-500">{STAGE_SAYS[lead.stage]}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConvertDialog lead={converting} onClose={() => setConverting(null)}
        onDone={() => { setConverting(null); onChanged(); }} />
    </div>
  );
}

/**
 * What the opportunity will be called, and what it is worth.
 *
 * Both are optional to the function — it falls back to the lead's own company
 * name and estimated value — so both are prefilled rather than required, and a
 * person who has nothing to add can press the button.
 */
function ConvertDialog(
  { lead, onClose, onDone }: { lead: LeadRow | null; onClose: () => void; onDone: () => void },
) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [primed, setPrimed] = useState<string | null>(null);

  // Prefill once per lead, and never over something already typed.
  if (lead && primed !== lead.id) {
    setPrimed(lead.id);
    setName(lead.companyName);
    setValue(lead.estimatedValue === null ? '' : String(lead.estimatedValue));
    setFailure(null);
  }

  async function go() {
    if (!lead) return;
    setBusy(true);
    setFailure(null);
    try {
      const trimmed = value.trim();
      await convertLead(lead.id, name, trimmed === '' ? null : Number(trimmed));
      onDone();
    } catch (e) {
      setFailure(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert {lead?.companyName}</DialogTitle>
          <DialogDescription>
            This makes a customer and an opportunity against them. A customer of the same name that
            already exists is reused rather than duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="convert-name">Opportunity name</Label>
            <Input id="convert-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="convert-value">Estimated value</Label>
            <Input id="convert-value" type="number" inputMode="decimal" min="0" step="any"
              placeholder="Leave blank if you do not know yet"
              value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {failure ? (
            <p className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {failure}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void go()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sending a proposal to the person who has to answer it.
 *
 * Until now the only record of a customer's answer was a member of staff typing
 * the customer's name into a dialog. That is what a disputed bid rested on.
 * This issues a link addressed to one named person, and their answer comes back
 * as their own act with the date, the document it covered and the address it
 * came from.
 *
 * The token appears exactly once. Only its hash is stored, so it cannot be read
 * back out of the database later — the same bargain an API key strikes, and for
 * the same reason. The dialog therefore makes copying it the obvious next step
 * rather than something to come back for.
 */
import { useState } from 'react';
import { Link2, Copy, Check, Loader2, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadShareLinks, createShareLink, revokeShareLink, type IssuedLink,
} from '@/lib/data/proposal-links';
import { date } from '@/lib/format';

const STANDING: Record<string, { label: string; tone: 'success' | 'info' | 'warn' | 'default' }> = {
  live: { label: 'waiting', tone: 'info' },
  answered: { label: 'answered', tone: 'success' },
  withdrawn: { label: 'withdrawn', tone: 'default' },
  expired: { label: 'expired', tone: 'warn' },
};

export function SendForSignature({ proposalId, proposalNumber, defaultName }: {
  proposalId: string;
  proposalNumber: string;
  defaultName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const links = useQuery(loadShareLinks(proposalId), [proposalId, open]);
  const [name, setName] = useState(defaultName ?? '');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('30');
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = links.status === 'ready' ? links.data : [];
  const live = rows.filter((l) => l.standing === 'live').length;

  const issue = async () => {
    setBusy(true); setError(null);
    try {
      const link = await createShareLink({
        proposalId, recipientName: name, recipientEmail: email || null, days: Number(days) || 30,
      });
      setIssued(link);
      links.refetch();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* A browser that refuses the clipboard still shows the address. */ }
  };

  const withdraw = (id: string) => {
    const why = window.prompt('Why is this link being withdrawn?') ?? undefined;
    setBusy(true);
    revokeShareLink(id, why)
      .then(() => links.refetch())
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="size-4" /> Send for signature
        {live > 0 ? <Badge variant="info" className="ml-1">{live} out</Badge> : null}
      </Button>

      <Dialog open={open} onOpenChange={(o) => {
        setOpen(o);
        if (!o) { setIssued(null); setError(null); }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send {proposalNumber} for signature</DialogTitle>
          </DialogHeader>

          {issued ? (
            <div className="space-y-3">
              <Alert tone="success" title="Link issued">
                Send this to {name}. It expires {date(issued.expiresAt)} and can be answered once.
              </Alert>
              <div className="flex gap-2">
                <Input readOnly value={issued.url} aria-label="The signing link"
                  onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={() => { void copy(); }}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-charcoal-500">
                Copy it now. Only a hash of this link is stored, so it cannot be read back
                afterwards — losing it means issuing another.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="link-name">Who is signing</Label>
                  <Input id="link-name" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Their name" />
                </div>
                <div>
                  <Label htmlFor="link-email">Their email</Label>
                  <Input id="link-email" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="link-days">Days before it expires</Label>
                  <Input id="link-days" type="number" value={days}
                    onChange={(e) => setDays(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-charcoal-500">
                A link is addressed to one person so the answer that comes back says who gave it.
                It is spent once answered.
              </p>
              {error ? <ErrorState message={error} /> : null}
            </div>
          )}

          {rows.length > 0 ? (
            <div className="space-y-1.5 border-t border-charcoal-200 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
                Links on this proposal
              </p>
              {links.status === 'loading' ? <LoadingState label="Reading the links" /> : null}
              {rows.map((l) => {
                const s = STANDING[l.standing]!;
                return (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2
                                             rounded-md border border-charcoal-200 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-charcoal-800">
                        {l.recipientName}
                        <span className="ml-2 font-mono text-xs text-charcoal-400">
                          {l.tokenPrefix}…
                        </span>
                      </p>
                      <p className="text-xs text-charcoal-500">
                        {l.standing === 'answered' && l.respondedAt
                          ? `answered ${date(l.respondedAt)}`
                          : `expires ${date(l.expiresAt)}`}
                        {l.openedCount > 0
                          ? ` · opened ${l.openedCount} time${l.openedCount === 1 ? '' : 's'}`
                          : ' · not opened yet'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.tone}>{s.label}</Badge>
                      {l.standing === 'live' ? (
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => withdraw(l.id)}>
                          <Ban className="size-3.5" /> Withdraw
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <DialogFooter>
            {issued ? (
              <Button onClick={() => { setIssued(null); setName(defaultName ?? ''); setEmail(''); }}>
                Issue another
              </Button>
            ) : (
              <Button onClick={() => { void issue(); }} disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Issue the link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

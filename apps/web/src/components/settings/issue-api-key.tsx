/**
 * Issue an API key.
 *
 * The secret exists exactly once: `create_api_key` returns it and nothing stores
 * it — only a SHA-256, which is what the gateway matches on. So this screen has
 * one job beyond the form, and it is the job the whole design depends on:
 * press the key on the person before they navigate away, and be honest that
 * nobody can produce it again.
 *
 * There is no "show it again" here. Not because the product declines to, but
 * because the database cannot.
 */
import { useState } from 'react';
import { KeyRound, Loader2, Copy, Check, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor } from '@/lib/data/query';
import { createApiKey, API_SCOPES, type IssuedKey } from '@/lib/data/api-keys';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

export function IssueApiKey({ companyId, canManage, onIssued }: {
  companyId: string | null;
  canManage: boolean;
  onIssued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState('120');
  const [environment, setEnvironment] = useState<'live' | 'test'>('live');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (scope: string) =>
    setScopes((prev) => (prev.includes(scope)
      ? prev.filter((s) => s !== scope) : [...prev, scope]));

  const issue = async () => {
    if (!companyId || busy) return;
    setBusy(true); setError(null);
    try {
      const key = await createApiKey(companyId, {
        name, scopes, rateLimitPerMinute: Number(rateLimit) || 120,
        expiresAt: expiresAt || null, environment,
      });
      setIssued(key);
      setName(''); setScopes([]); setRateLimit('120'); setExpiresAt('');
      setOpen(false);
      onIssued();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  /* Shown until it is dismissed on purpose. Navigating away loses it forever. */
  if (issued) {
    return (
      <Alert tone="success" icon={<ShieldCheck className="size-4" />}
        title="Copy this key now — it cannot be shown again">
        <div className="space-y-3">
          <p>
            Only a hash of it is stored, so nobody here — not GrounUp, not an administrator,
            not this screen — can produce it a second time. If it is lost, revoke it and
            issue another.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded border border-charcoal-200 bg-white px-2 py-1 font-mono text-sm break-all">
              {issued.key}
            </code>
            <Button size="sm" variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(issued.key).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy it'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
            I have saved it
          </Button>
        </div>
      </Alert>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} disabled={!canManage}
        title={canManage ? undefined
          : 'Issuing a key needs the company.manage permission — a key is company-wide authority'}>
        <KeyRound className="size-4" /> Create key
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="key-name">What holds it</Label>
          <Input id="key-name" value={name} autoFocus
            placeholder="Accounting sync, telematics feed, the BI job"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="key-env">Which environment</Label>
          <select id="key-env" className={field} value={environment}
            onChange={(e) => setEnvironment(e.target.value as 'live' | 'test')}>
            <option value="live">Live</option>
            <option value="test">Test</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="key-rate">Requests a minute</Label>
          <Input id="key-rate" type="number" min={1} max={10000} value={rateLimit}
            onChange={(e) => setRateLimit(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="key-exp">Expires (optional)</Label>
          <Input id="key-exp" type="date" value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>What it may reach</Label>
        <div className="flex flex-wrap gap-1.5">
          {API_SCOPES.map((s) => {
            const on = scopes.includes(s.value);
            return (
              <button key={s.value} type="button" aria-pressed={on}
                onClick={() => toggle(s.value)}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  on ? 'border-charcoal-900 bg-charcoal-900 text-white'
                    : 'border-charcoal-200 bg-white text-charcoal-600 hover:bg-charcoal-50'}`}>
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-charcoal-500">
          Give it the least it needs — a key is easier to widen than to take back. A key can
          never reach beyond this company&rsquo;s data, whatever scopes it holds.
        </p>
      </div>

      {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void issue()}
          disabled={busy || !name.trim() || scopes.length === 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Issue the key
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

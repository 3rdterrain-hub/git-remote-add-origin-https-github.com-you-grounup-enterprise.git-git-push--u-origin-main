import { useState } from 'react';
import { KeyRound, ShieldCheck, Activity, Ban, Copy, BookOpen, Gauge } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { integer, date, dateTime, percent, plural } from '@/lib/format';
import { LoadingState, ErrorState } from '@/components/data-state';
import { EmptyState } from '@/components/ui/misc';
import { useQuery, messageFor } from '@/lib/data/query';
import { usePermissions, useCompanyId } from '@/lib/data/session';
import { loadApiKeys, revokeApiKey } from '@/lib/data/api-keys';
import { IssueApiKey } from '@/components/settings/issue-api-key';
import { cn } from '@/lib/utils';
import spec from '@/data/openapi.json';

/**
 * The published endpoints, read from the OpenAPI spec.
 *
 * The spec is generated from the gateway's own route table, so this list
 * cannot fall behind the gateway. A hand-written one does, and then tells a
 * customer an endpoint exists that does not.
 */
interface Endpoint { method: string; path: string; scope: string; note: string }

type SpecOperation = { summary?: string; security?: { apiKey?: string[] }[] };

const ENDPOINTS: Endpoint[] = Object.entries(
  spec.paths as unknown as Record<string, Record<string, SpecOperation>>,
).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({
    method: method.toUpperCase(),
    path: `/v1${path}`,
    scope: op.security?.[0]?.apiKey?.[0] ?? '',
    note: op.summary ?? '',
  })),
).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-info-50 text-info-700 border-info-600/25',
  POST: 'bg-success-50 text-success-700 border-success-500/25',
};

export function ApiAccessPage() {
  /* Which tab the two countable boxes above open. */
  const [tab, setTab] = useState('keys');
  const { can } = usePermissions();
  const { companyId } = useCompanyId();
  const canManage = can('company.manage');

  /*
   * This page listed five invented keys on a live route while `api_keys` — a
   * hash-only table with scopes, a rate limit and a rewrite guard — had no
   * writer anywhere, so the API this platform sells could not be used at all.
   */
  const [nonce, setNonce] = useState(0);
  const keysQ = useQuery(loadApiKeys, [nonce]);
  const KEYS = keysQ.status === 'ready' ? keysQ.data : [];
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const active = KEYS.filter((k) => !k.isRevoked);
  const calls = KEYS.reduce((a, k) => a + k.requests30Days, 0);
  const errors = KEYS.reduce((a, k) => a + k.errors30Days, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Access"
        description="Keys for the systems that need GrounUp data — accounting, telematics, BI. Every key carries a company, a scope list and a rate limit, and every request is logged against it."
        actions={
          <>
            {/*
              * The spec is generated from the schema by `npm run openapi` and
              * imported above, so this hands over the real document rather than
              * linking somewhere it might not be.
              */}
            <Button variant="outline" onClick={() => {
              const blob = new Blob([JSON.stringify(spec, null, 2)],
                { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'grounup-openapi.json';
              a.click();
              URL.revokeObjectURL(url);
            }}>
              <BookOpen className="size-4" /> OpenAPI spec
            </Button>
            <IssueApiKey companyId={companyId} canManage={canManage}
              onIssued={() => setNonce((n) => n + 1)} />
          </>
        }
      />

      <Alert tone="warn" icon={<ShieldCheck className="size-4" />} title="A key is shown once">
        Only a hash of the key is stored, so it cannot be recovered or re-displayed — the prefix below is for
        identifying it in a log, not for authenticating. If a key is lost, revoke it and issue another. A key can
        never reach beyond its own company's data, whatever scopes it holds.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active keys" value={active.length} icon={<KeyRound className="size-4" />}
          hint={`${KEYS.length - active.length} revoked and retained`}
          onClick={() => setTab('keys')} active={tab === 'keys'}
          actionLabel="List the keys, live and revoked" />
        <StatTile label="Calls, 30 days" value={integer(calls)} icon={<Activity className="size-4" />}
          detail={
            <p>
              Requests across every key in the last thirty days, revoked keys included — a key that
              was revoked on Tuesday still made the calls it made on Monday, and removing them would
              hide the traffic that caused the revocation. Each key's own share is on the keys tab,
              beside the rate limit it is counted against.
            </p>
          } />
        <StatTile label="Error rate" value={percent(calls ? errors / calls : 0, 2)}
          tone={errors / Math.max(calls, 1) < 0.01 ? 'success' : 'warn'}
          hint={`${integer(Math.round(errors))} failed requests`}
          detail={
            <p>
              Failed requests over total requests. A refusal counts as a failure here — a call that
              asked for another company's data, or reached past its key's scopes, is a failure of the
              integration and not of the platform, and it is exactly the thing worth noticing. A rate
              that climbs after a key is issued usually means the integration is asking for something
              its scopes do not cover.
            </p>
          } />
        <StatTile label="Endpoints published" value={ENDPOINTS.length} icon={<Gauge className="size-4" />}
          hint="versioned at /v1"
          onClick={() => setTab('endpoints')} active={tab === 'endpoints'}
          actionLabel="List the published endpoints" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="keys">Keys ({KEYS.length})</TabsTrigger>
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-4">
          {keysQ.status === 'loading' ? <LoadingState label="Reading your keys" /> : null}
          {keysQ.status === 'error'
            ? <ErrorState message={keysQ.message} onRetry={keysQ.refetch} /> : null}
          {revokeError ? <Alert tone="danger" title="That key was not revoked">{revokeError}</Alert> : null}
          {keysQ.status === 'ready' && KEYS.length === 0 ? (
            <Card><CardContent className="p-6">
              <EmptyState title="No keys yet"
                description="A key is how an outside system — accounting, telematics, a BI job — reads this company's data. It carries its own scopes and rate limit, and it is shown once." />
            </CardContent></Card>
          ) : null}
          {KEYS.length > 0 ? (
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead className="text-right">Rate limit</TableHead>
                  <TableHead className="text-right">Calls (30d)</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {KEYS.map((k) => (
                  <TableRow key={k.id} className={cn(k.isRevoked && 'opacity-55')}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{k.name}</p>
                      <button type="button"
                        onClick={() => { void navigator.clipboard?.writeText(k.keyPrefix); }}
                        className="flex items-center gap-1.5 font-mono text-xs text-charcoal-500 hover:text-charcoal-900"
                        title="Copy the prefix. It identifies this key in a log and authenticates nothing.">
                        {k.keyPrefix}…<Copy className="size-3" />
                      </button>
                      <p className="mt-0.5 text-xs text-charcoal-400">
                        {k.isRevoked
                          ? `Revoked ${date(k.revokedAt!)}${k.revokeReason ? ` — ${k.revokeReason}` : ''}`
                          : `Created ${date(k.createdAt)}${k.createdBy ? ` by ${k.createdBy}` : ''}`}
                        {k.expiresAt && !k.isRevoked
                          ? ` · ${k.isExpired ? 'expired' : 'expires'} ${date(k.expiresAt)}` : ''}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant={s.endsWith(':write') ? 'warn' : 'outline'}
                            className="font-mono text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right text-charcoal-600">
                      {k.rateLimitPerMinute}/min
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {integer(k.requests30Days)}
                      {k.errors30Days > 0 ? (
                        <span className="block text-xs text-warn-700">
                          {percent(k.errors30Days / Math.max(k.requests30Days, 1), 2)} errors
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                      {k.lastUsedAt ? dateTime(k.lastUsedAt) : <span className="text-charcoal-400">never used</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {k.isRevoked
                        ? <Badge variant="danger"><Ban className="size-3" /> Revoked</Badge>
                        : (
                          <Button size="sm" variant="outline" disabled={!canManage}
                            title={canManage ? undefined
                              : 'Revoking a key needs the company.manage permission'}
                            onClick={() => {
                              const why = window.prompt(
                                `Why is "${k.name}" being revoked? The next person reads this.`);
                              if (!why || why.trim().length < 3) return;
                              setRevokeError(null);
                              void revokeApiKey(k.id, why)
                                .then(() => setNonce((n) => n + 1))
                                .catch((e) => setRevokeError(messageFor(e)));
                            }}>
                            Revoke
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
          ) : null}

          {KEYS.length > active.length ? (
            <Alert tone="neutral" icon={<Activity className="size-4" />}
              title="Revoked keys are kept">
              {plural(KEYS.length - active.length, 'revoked key is', 'revoked keys are')} retained rather than
              deleted, so the request log still resolves to the key that made each call. Answering "what did that
              integration read last March" needs the key record to survive its revocation.
            </Alert>
          ) : null}
        </TabsContent>

        <TabsContent value="endpoints">
          <Card>
            <CardHeader>
              <CardTitle>Published endpoints</CardTitle>
              <CardDescription>
                Every endpoint requires a scope, and every response is filtered to the key's company before it is
                serialized — the scope decides what kind of record you may read, the company decides which records
                exist at all.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Method</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ENDPOINTS.map((e) => (
                    <TableRow key={`${e.method} ${e.path}`}>
                      <TableCell>
                        <span className={cn(
                          'inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold',
                          METHOD_TONE[e.method],
                        )}>{e.method}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-charcoal-800">{e.path}</TableCell>
                      <TableCell>
                        <Badge variant={e.scope.endsWith(':write') ? 'warn' : 'outline'}
                          className="font-mono text-[10px]">{e.scope}</Badge>
                      </TableCell>
                      <TableCell className="text-charcoal-600">{e.note}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

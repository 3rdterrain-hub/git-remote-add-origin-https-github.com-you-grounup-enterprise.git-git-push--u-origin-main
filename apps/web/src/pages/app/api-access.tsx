import { KeyRound, Plus, ShieldCheck, Activity, Ban, Copy, BookOpen, Gauge } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { integer, date, dateTime, percent, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import spec from '@/data/openapi.json';

interface ApiKey {
  id: string; name: string; prefix: string; scopes: string[];
  createdOn: string; createdBy: string; lastUsedAt: string | null;
  expiresOn: string | null; rateLimitPerMinute: number; revokedOn: string | null;
  calls30d: number; errorRate: number;
}

const KEYS: ApiKey[] = [
  { id: 'k1', name: 'Sage Intacct sync', prefix: 'gu_live_7Kd2', scopes: ['projects:read', 'finance:read', 'finance:write'], createdOn: '2026-05-14', createdBy: 'Dana Whitfield', lastUsedAt: '2026-09-02T06:15:00Z', expiresOn: null, rateLimitPerMinute: 120, revokedOn: null, calls30d: 41_882, errorRate: 0.004 },
  { id: 'k2', name: 'VisionLink telematics pull', prefix: 'gu_live_QpX9', scopes: ['fleet:read', 'fleet:write'], createdOn: '2026-06-02', createdBy: 'Marcus Ruiz', lastUsedAt: '2026-09-02T05:45:00Z', expiresOn: null, rateLimitPerMinute: 60, revokedOn: null, calls30d: 12_960, errorRate: 0.001 },
  { id: 'k3', name: 'Power BI — executive dashboard', prefix: 'gu_live_3mNv', scopes: ['metrics:read'], createdOn: '2026-07-21', createdBy: 'Dana Whitfield', lastUsedAt: '2026-09-01T23:00:00Z', expiresOn: '2027-07-21', rateLimitPerMinute: 30, revokedOn: null, calls30d: 744, errorRate: 0 },
  { id: 'k4', name: 'Estimating spreadsheet (legacy)', prefix: 'gu_live_8bTr', scopes: ['estimates:read'], createdOn: '2026-02-10', createdBy: 'Alice Okafor', lastUsedAt: '2026-06-30T14:22:00Z', expiresOn: null, rateLimitPerMinute: 30, revokedOn: '2026-07-01', calls30d: 0, errorRate: 0 },
];

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
  const active = KEYS.filter((k) => !k.revokedOn);
  const calls = KEYS.reduce((a, k) => a + k.calls30d, 0);
  const errors = KEYS.reduce((a, k) => a + k.calls30d * k.errorRate, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Access"
        description="Keys for the systems that need GrounUp data — accounting, telematics, BI. Every key carries a company, a scope list and a rate limit, and every request is logged against it."
        actions={
          <>
            <Button variant="outline"><BookOpen className="size-4" /> OpenAPI spec</Button>
            <Button><Plus className="size-4" /> Create key</Button>
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
          hint={`${KEYS.length - active.length} revoked and retained`} />
        <StatTile label="Calls, 30 days" value={integer(calls)} icon={<Activity className="size-4" />} />
        <StatTile label="Error rate" value={percent(calls ? errors / calls : 0, 2)}
          tone={errors / Math.max(calls, 1) < 0.01 ? 'success' : 'warn'}
          hint={`${integer(Math.round(errors))} failed requests`} />
        <StatTile label="Endpoints published" value={ENDPOINTS.length} icon={<Gauge className="size-4" />}
          hint="versioned at /v1" />
      </div>

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys">Keys ({KEYS.length})</TabsTrigger>
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
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
                  <TableRow key={k.id} className={cn(k.revokedOn && 'opacity-55')}>
                    <TableCell>
                      <p className="font-medium text-charcoal-900">{k.name}</p>
                      <p className="flex items-center gap-1.5 font-mono text-xs text-charcoal-500">
                        {k.prefix}…<Copy className="size-3" />
                      </p>
                      <p className="mt-0.5 text-xs text-charcoal-400">
                        {k.revokedOn
                          ? `Revoked ${date(k.revokedOn)}`
                          : `Created ${date(k.createdOn)} by ${k.createdBy}`}
                        {k.expiresOn && !k.revokedOn ? ` · expires ${date(k.expiresOn)}` : ''}
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
                      {integer(k.calls30d)}
                      {k.errorRate > 0 ? (
                        <span className="block text-xs text-warn-700">{percent(k.errorRate, 2)} errors</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                      {k.lastUsedAt ? dateTime(k.lastUsedAt) : <span className="text-charcoal-400">never used</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {k.revokedOn
                        ? <Badge variant="danger"><Ban className="size-3" /> Revoked</Badge>
                        : <Button size="sm" variant="outline">Revoke</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>

          <Alert tone="neutral" className="mt-4" icon={<Activity className="size-4" />}
            title="Revoked keys are kept">
            {plural(KEYS.length - active.length, 'revoked key is', 'revoked keys are')} retained rather than
            deleted, so the request log still resolves to the key that made each call. Answering "what did that
            integration read last March" needs the key record to survive its revocation.
          </Alert>
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

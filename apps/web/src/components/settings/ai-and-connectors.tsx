/**
 * The AI registry and the connector runtime, on real rows.
 *
 * Library and Entity: which models the platform may use, which prompt versions
 * exist and what each scored, and what this company has connected.
 *
 * Both panels are deliberately read-only for now and say so. Enabling a model
 * or promoting a prompt are governed acts — 0013 refuses to mark a prompt
 * active without recording who promoted it and its evaluation result — and a
 * switch that wrote one without the rest of that workflow would be the defect
 * this codebase keeps producing, one layer in. What they are not any more is
 * invented.
 */
import { Cpu, Bot, Plug, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatTile } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useState } from 'react';
import { useQuery } from '@/lib/data/query';
import {
  loadAiModels, loadAiPrompts, loadConnectors,
} from '@/lib/data/ai-registry';
import { dateTime, percent, integer, titleCase } from '@/lib/format';

const PROMPT_VARIANT: Record<string, 'success' | 'info' | 'warn' | 'default'> = {
  active: 'success', evaluating: 'info', draft: 'default', retired: 'warn',
};

const CONNECTOR_VARIANT: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'default'> = {
  connected: 'success', degraded: 'warn', failed: 'danger',
  not_connected: 'default', disabled: 'default',
};

export function AiRegistrySettings() {
  const modelsQ = useQuery(loadAiModels, []);
  const promptsQ = useQuery(loadAiPrompts, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> Models</CardTitle>
          <CardDescription>
            What this platform may call, and what each is allowed to be used for. A model
            absent from this list is one nobody has enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {modelsQ.status === 'loading' ? <LoadingState label="Reading the registry" /> : null}
          {modelsQ.status === 'error'
            ? <ErrorState message={modelsQ.message} onRetry={modelsQ.refetch} /> : null}
          {modelsQ.status === 'demonstration'
            ? <Alert tone="info" title="Not connected">The registry is read from the platform.</Alert> : null}
          {modelsQ.status === 'ready' && modelsQ.data.length === 0 ? (
            <EmptyState title="No models enabled"
              hint="Nothing here is invented — an empty registry means none has been turned on." />
          ) : null}
          {modelsQ.status === 'ready' && modelsQ.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Used for</TableHead>
                  <TableHead className="text-right">Context</TableHead>
                  <TableHead className="text-right">In / out per Mtok</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelsQ.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.displayName}
                      {m.isDefault ? <Badge variant="info" className="ml-2">Default</Badge> : null}
                    </TableCell>
                    <TableCell>{titleCase(m.provider)}</TableCell>
                    <TableCell className="space-x-1">
                      {m.capabilities.length === 0
                        ? <span className="text-charcoal-400">—</span>
                        : m.capabilities.map((c) => (
                            <Badge key={c} variant="default">{c.replace(/_/g, ' ')}</Badge>
                          ))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.contextTokens === null ? '—' : integer(m.contextTokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.inputCostPerMtok === null && m.outputCostPerMtok === null
                        ? '—'
                        : `$${(m.inputCostPerMtok ?? 0).toFixed(2)} / $${(m.outputCostPerMtok ?? 0).toFixed(2)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> Prompt versions</CardTitle>
          <CardDescription>
            Every version of every agent's instructions, with what it scored. A prompt
            cannot be made active without recording who promoted it and its evaluation
            result — which is why the score is shown rather than the prose.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {promptsQ.status === 'loading' ? <LoadingState label="Reading the prompts" /> : null}
          {promptsQ.status === 'error'
            ? <ErrorState message={promptsQ.message} onRetry={promptsQ.refetch} /> : null}
          {promptsQ.status === 'ready' && promptsQ.data.length === 0 ? (
            <EmptyState title="No prompt versions"
              hint="The shipped prompts arrive with the platform; your own variants appear here beside them." />
          ) : null}
          {promptsQ.status === 'ready' && promptsQ.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Passed</TableHead>
                  <TableHead>Activated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promptsQ.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.agentId}</TableCell>
                    <TableCell className="tabular-nums">{p.version}</TableCell>
                    <TableCell>
                      {p.companyId === null
                        ? <span className="text-charcoal-500">Shipped</span>
                        : <Badge variant="info">Yours</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={PROMPT_VARIANT[p.state] ?? 'default'}>{titleCase(p.state)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.evalPassRate === null
                        ? <span className="text-charcoal-400">not evaluated</span>
                        : `${percent(p.evalPassRate, 0)}${p.evalSampleSize ? ` of ${integer(p.evalSampleSize)}` : ''}`}
                    </TableCell>
                    <TableCell>
                      {p.activatedAt ? dateTime(p.activatedAt) : <span className="text-charcoal-400">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function ConnectorSettings() {
  const connectorsQ = useQuery(loadConnectors, []);
  /*
   * The four boxes count the table below by status and are the filter for it.
   * A number on a tile answers the question it raises, and "three connectors
   * failed" raises exactly one: which three.
   */
  const [status, setStatus] = useState<string | null>(null);
  const all = connectorsQ.status === 'ready' ? connectorsQ.data : [];
  const shown = status ? all.filter((c) => c.status === status) : all;
  const tile = (s: string) => ({
    onClick: () => setStatus((c) => (c === s ? null : s)),
    active: status === s,
  });
  const count = (s: string) => all.filter((c) => c.status === s).length;

  return (
    <div className="space-y-4">
      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="Where the credentials live">
        A connector stores a <em>handle</em> into the platform secret store, never the secret
        itself. Reading this table yields nothing anyone could authenticate with, and a
        connector cannot be enabled without a credential to run as.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Connected" value={count('connected')} tone="success"
          hint={`of ${all.length} configured`}
          {...tile('connected')}
          actionLabel="List the connectors that are working" />
        <StatTile label="Degraded" value={count('degraded')}
          tone={count('degraded') > 0 ? 'warn' : 'success'}
          hint="last run did not fully succeed"
          {...tile('degraded')}
          actionLabel="List the connectors whose last run did not fully succeed" />
        <StatTile label="Failed" value={count('failed')}
          tone={count('failed') > 0 ? 'danger' : 'success'}
          hint="three consecutive failures"
          {...tile('failed')}
          actionLabel="List the connectors that have failed" />
        <StatTile label="Not connected" value={count('not_connected')}
          hint="available but not set up"
          {...tile('not_connected')}
          actionLabel="List the connectors that are available but not set up" />
      </div>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Plug className="size-4" /> Connector runtime</CardTitle>
        <CardDescription>
          What this company has connected, when it last ran, and whether it worked. Health
          is derived from each connector's own run history, so one that quietly stopped
          working shows as degraded rather than continuing to look connected.
        </CardDescription>
        {status ? (
          <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-charcoal-600">
            <span>Showing the {titleCase(status.replace(/_/g, ' '))} connectors.</span>
            <button type="button" onClick={() => setStatus(null)}
              className="text-sm font-medium underline">Show all</button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {connectorsQ.status === 'loading' ? <LoadingState label="Reading the connectors" /> : null}
        {connectorsQ.status === 'error'
          ? <ErrorState message={connectorsQ.message} onRetry={connectorsQ.refetch} /> : null}
        {connectorsQ.status === 'demonstration'
          ? <Alert tone="info" title="Not connected">Connectors are read from your own company.</Alert> : null}
        {connectorsQ.status === 'ready' && shown.length === 0 ? (
          <EmptyState title="Nothing connected yet"
            hint="Accounting, payroll, telematics, fuel cards, machine control and storage all connect here." />
        ) : null}
        {connectorsQ.status === 'ready' && shown.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name}
                    <span className="block text-xs text-charcoal-500">{titleCase(c.provider)}</span>
                  </TableCell>
                  <TableCell>{titleCase(c.connectorType.replace(/_/g, ' '))}</TableCell>
                  <TableCell>
                    <Badge variant={CONNECTOR_VARIANT[c.status] ?? 'default'}>
                      {titleCase(c.status.replace(/_/g, ' '))}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {c.scheduleCron ?? <span className="text-charcoal-400">on demand</span>}
                  </TableCell>
                  <TableCell>
                    {c.lastRunAt ? dateTime(c.lastRunAt) : <span className="text-charcoal-400">never</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.consecutiveFailures === 0
                      ? <span className="text-charcoal-400">—</span>
                      : <span className="text-danger-600">{c.consecutiveFailures}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
    </div>
  );
}

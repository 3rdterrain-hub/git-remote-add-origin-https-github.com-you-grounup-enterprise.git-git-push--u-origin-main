import { useState } from 'react';
import { Building2, Users, Palette, Sliders, ShieldCheck, Plug, Save, Info, Bot, Cpu } from 'lucide-react';
import { PageHeader, StatTile } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Switch, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COMPANY, USER } from '@/data/demo';
import { AI_MODELS, AI_PROMPTS } from '@/data/field';
import { CONNECTORS } from '@/data/safety';
import { percent, date, dateTime, titleCase, integer } from '@/lib/format';

/**
 * Security controls this platform actually enforces, each naming what enforces
 * it.
 *
 * This panel used to be four switches — multi-factor authentication, single
 * sign-on, session timeout, export restriction — none of which was read by any
 * code. A switch an administrator can turn on, that nothing implements, is a
 * false assurance rather than a missing feature: they come away believing their
 * organization is protected. The switches are gone, and what remains is
 * enforced and checkable.
 */
const ENFORCED_CONTROLS = [
  {
    control: 'One company can never read another company\u2019s records',
    detail: 'Row level security is enabled and forced on every table, and a migration that leaves one open refuses to apply.',
    mechanism: 'PostgreSQL RLS + app.assert_security_gates()',
  },
  {
    control: 'The audit ledger cannot be edited or deleted',
    detail: 'By anyone, at any privilege level. Corrections are appended as new events.',
    mechanism: 'app.forbid_mutation() trigger',
  },
  {
    control: 'Nobody approves their own request',
    detail: 'Approval tiers gate consequential changes, and an override records a requester and a separate approver.',
    mechanism: 'approval_requests + value_overrides constraints',
  },
  {
    control: 'An issued estimate cannot be changed',
    detail: 'A revision creates a new version, and the library rows that priced it are copied so the figure stays reproducible.',
    mechanism: 'RULE-009 trigger + library_snapshots',
  },
  {
    control: 'API keys are stored only as a hash',
    detail: 'A key is shown once and cannot be recovered. Each carries scopes and reaches only its own company.',
    mechanism: 'SHA-256 key_hash, scoped and revocable',
  },
  {
    control: 'No secret reaches the browser',
    detail: 'Only the public anon key is in the bundle. Stripe and service-role keys live in server-side secrets.',
    mechanism: 'Edge Function environment secrets',
  },
  {
    control: 'Credentials are removed from logs',
    detail: 'By field name and by value shape, so a key pasted into a free-text field is caught wherever it appears.',
    mechanism: '_shared/observability/redaction',
  },
  {
    control: 'AI cannot change an approved record',
    detail: 'Agents propose findings with citations. A person accepts them, and the acceptance records who and when.',
    mechanism: 'ai_agents authority cap + acceptance trigger',
  },
] as const;

/** Controls that do not exist, said plainly rather than shown as a setting. */
const UNAVAILABLE_CONTROLS = [
  { control: 'Multi-factor authentication', detail: 'Not implemented. There is no second factor to require.' },
  { control: 'Single sign-on', detail: 'No SAML or OIDC federation. Every user authenticates directly.' },
  { control: 'Session policy', detail: 'Sessions are issued and validated, but this platform sets no inactivity bound of its own.' },
  { control: 'Export restriction', detail: 'No export permission exists, so exports cannot yet be restricted by role.' },
  { control: 'Retention and deletion', detail: 'Nothing expires or deletes records on a schedule, and there is no legal hold.' },
] as const;

/** The system roles shipped by migration 0011, with their real permission sets. */
const ROLES = [
  { key: 'owner', name: 'Owner', tier: 4, permissions: 'All permissions', users: 1 },
  { key: 'admin', name: 'Administrator', tier: 3, permissions: 'Company, users, libraries, estimating, projects, audit', users: 1 },
  { key: 'chief_estimator', name: 'Chief Estimator', tier: 3, permissions: 'Approve and issue estimates, approve library changes', users: 0 },
  { key: 'senior_estimator', name: 'Senior Estimator', tier: 2, permissions: 'Full estimating including senior review sign-off', users: 2 },
  { key: 'estimator', name: 'Estimator', tier: 1, permissions: 'Build estimates, accept AI findings at estimator tier', users: 3 },
  { key: 'project_manager', name: 'Project Manager', tier: 2, permissions: 'Schedule, cost, change orders, field production', users: 2 },
  { key: 'superintendent', name: 'Superintendent', tier: 1, permissions: 'Daily reports, installed quantities, production actuals', users: 2 },
  { key: 'foreman', name: 'Foreman', tier: 0, permissions: 'Field production for assigned work', users: 4 },
  { key: 'accountant', name: 'Accountant', tier: 1, permissions: 'Job cost, billing, financial reporting', users: 1 },
  { key: 'sales', name: 'Sales', tier: 0, permissions: 'CRM pipeline and proposals; reads estimates', users: 1 },
  { key: 'viewer', name: 'Viewer', tier: 0, permissions: 'Read-only', users: 3 },
];

export function SettingsPage() {
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Settings"
        description="GrounUp adapts to how your company operates. Change what you need — every change is versioned, attributed and auditable."
        actions={dirty ? <Button onClick={() => setDirty(false)}><Save className="size-4" /> Save changes</Button> : null}
      />

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="estimating">Estimating defaults</TabsTrigger>
          <TabsTrigger value="users">Users &amp; roles</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="ai">AI registry</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------- company */}
        <TabsContent value="company" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="size-4" /> Company profile</CardTitle>
              <CardDescription>Used on proposals, reports and the customer portal.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FieldInput label="Company name" defaultValue={COMPANY.name} onChange={touch} />
              <FieldInput label="Legal name" defaultValue="Ridgeline Excavating LLC" onChange={touch} />
              <FieldInput label="City" defaultValue={COMPANY.city} onChange={touch} />
              <FieldInput label="State" defaultValue={COMPANY.state} onChange={touch} />
              <FieldInput label="Phone" defaultValue="(419) 555-0100" onChange={touch} />
              <FieldInput label="Email" type="email" defaultValue="office@ridgeline.test" onChange={touch} />
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select defaultValue="USD" onValueChange={touch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD — US Dollar</SelectItem><SelectItem value="CAD">CAD — Canadian Dollar</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Time zone</Label>
                <Select defaultValue="America/New_York" onValueChange={touch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">Eastern</SelectItem>
                    <SelectItem value="America/Chicago">Central</SelectItem>
                    <SelectItem value="America/Denver">Mountain</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Terminology</CardTitle>
              <CardDescription>
                Rename what GrounUp calls things so the platform speaks your company's vocabulary
                rather than the other way round.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <FieldInput label="Estimate is called" defaultValue="Estimate" onChange={touch} />
              <FieldInput label="Customer is called" defaultValue="Customer" onChange={touch} />
              <FieldInput label="Project is called" defaultValue="Project" onChange={touch} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------ estimating */}
        <TabsContent value="estimating" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sliders className="size-4" /> Estimating defaults</CardTitle>
              <CardDescription>
                Applied to every new estimate. A line may override any of them, and the override is
                recorded on the line.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FieldInput label="Shift hours" type="number" defaultValue="8" onChange={touch}
                hint="Hours per working shift" />
              <FieldInput label="Calendar efficiency" type="number" step="0.01" defaultValue="0.85" onChange={touch}
                hint="Fraction of days actually worked" />
              <FieldInput label="Fuel price ($/gal)" type="number" step="0.01" defaultValue="4.25" onChange={touch} />
              <FieldInput label="DEF price ($/gal)" type="number" step="0.01" defaultValue="12.00" onChange={touch} />
              <FieldInput label="Swell factor" type="number" step="0.01" defaultValue="0.25" onChange={touch}
                hint="Bank to loose volume increase" />
              <FieldInput label="Shrink factor" type="number" step="0.01" defaultValue="0.10" onChange={touch}
                hint="Bank to compacted volume decrease" />
              <FieldInput label="Bid rounding increment" type="number" defaultValue="500" onChange={touch}
                hint="Bids round up, never down" />
              <div className="space-y-1.5">
                <Label>Default pricing profile</Label>
                <Select defaultValue="PP-AVG" onValueChange={touch}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PP-AVG">Average Market (parallel)</SelectItem>
                    <SelectItem value="PP-UNION">Union (stacked)</SelectItem>
                    <SelectItem value="PP-CUSTOM">Custom Company (parallel + bond)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter>
              <Alert tone="info" icon={<Info className="size-4" />}>
                Changing a default does not reprice an existing estimate. Estimates carry the values
                they were priced with, so a historical bid stays reproducible.
              </Alert>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval thresholds</CardTitle>
              <CardDescription>Where the confidence engine routes work. These are governed values, not preferences.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ['Auto-accept floor', '95', 'Below this, a person reviews the line.'],
                ['Senior review ceiling', '80', 'Below this, a senior estimator must sign off.'],
                ['Mandatory senior review', '69', 'At or below this, sign-off cannot be waived.'],
                ['Major cost impact share', '10%', 'A line above this share of estimate value escalates.'],
              ].map(([label, value, hint]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-charcoal-200 pb-3 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-charcoal-900">{label}</p>
                    <p className="text-xs text-charcoal-500">{hint}</p>
                  </div>
                  <Badge variant="dark" className="tabular shrink-0">{value}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- users */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Roles and permissions</CardTitle>
              <CardDescription>
                Eleven system roles ship with GrounUp. The approval tier controls which review gates a
                user can satisfy — an estimator cannot clear a senior review, whatever else they are permitted.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Approval tier</TableHead>
                    <TableHead className="min-w-72">Permissions</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ROLES.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{r.name}</p>
                        <p className="font-mono text-xs text-charcoal-400">{r.key}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={r.tier >= 3 ? 'danger' : r.tier === 2 ? 'warn' : r.tier === 1 ? 'info' : 'default'}>
                          Tier {r.tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">{r.permissions}</TableCell>
                      <TableCell className="tabular text-right">{r.users || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="Segregation of duties">
            A person cannot approve their own request, and a company must always keep at least one
            active owner. Both are enforced by the database, so no administrative mistake or
            application bug can bypass them.
          </Alert>
        </TabsContent>

        {/* -------------------------------------------------------- branding */}
        <TabsContent value="branding">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="size-4" /> Branding</CardTitle>
              <CardDescription>Applied to proposals, reports and — on the Enterprise plan — the whole application.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Primary color</Label>
                  <div className="flex items-center gap-2">
                    <span className="size-10 shrink-0 rounded-md border border-charcoal-300 bg-charcoal-900" />
                    <Input defaultValue="#111827" className="font-mono" onChange={touch} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Accent color</Label>
                  <div className="flex items-center gap-2">
                    <span className="size-10 shrink-0 rounded-md border border-charcoal-300 bg-yellow-500" />
                    <Input defaultValue="#F6C101" className="font-mono" onChange={touch} />
                  </div>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-charcoal-900">White label</p>
                  <p className="text-xs text-charcoal-500">Remove GrounUp branding entirely. Requires the Enterprise plan.</p>
                </div>
                <Switch disabled aria-label="White label" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- security */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Security</CardTitle>
              <CardDescription>Signed in as {USER.name} ({USER.role}, approval tier {USER.approvalTier}).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-charcoal-600">
                These are enforced by the platform, not configured here. Each names the mechanism
                that enforces it, so it can be checked rather than taken on trust.
              </p>
              <ul className="space-y-3">
                {ENFORCED_CONTROLS.map((c) => (
                  <li key={c.control} className="flex gap-3 border-b border-charcoal-200 pb-3 last:border-0 last:pb-0">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-600" />
                    <div>
                      <p className="text-sm font-medium text-charcoal-900">{c.control}</p>
                      <p className="text-xs text-charcoal-500">{c.detail}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-charcoal-400">{c.mechanism}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Not yet available</CardTitle>
              <CardDescription>
                Named here rather than shown as a setting. A control an administrator can switch on,
                that nothing enforces, is worse than one that is plainly absent — it reads as
                protection the organization does not have.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {UNAVAILABLE_CONTROLS.map((c) => (
                  <li key={c.control} className="flex gap-3 border-b border-charcoal-200 pb-3 last:border-0 last:pb-0">
                    <Info className="mt-0.5 size-4 shrink-0 text-charcoal-400" />
                    <div>
                      <p className="text-sm font-medium text-charcoal-700">{c.control}</p>
                      <p className="text-xs text-charcoal-500">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit ledger</CardTitle>
              <CardDescription>Append-only. It cannot be edited or deleted by anyone, at any privilege level.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['Events recorded', '18,442', 'last 90 days'],
                  ['Retention', 'No policy set', 'nothing expires entries today'],
                  ['Tamper protection', 'Trigger-enforced', 'UPDATE and DELETE blocked'],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-md border border-charcoal-200 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
                    <p className="tabular mt-1 text-lg font-bold text-charcoal-900">{value}</p>
                    <p className="text-xs text-charcoal-500">{hint}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- AI registry */}
        <TabsContent value="ai" className="space-y-6">
          <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="Agents draft; they never decide">
            Every agent is capped at draft-and-recommend authority, must cite its sources, and requires human
            approval for anything consequential. The database refuses to store an agent configured any other way —
            it is not a setting that can be turned off here.
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> Models</CardTitle>
              <CardDescription>
                Which models the platform may route to, and what each costs. Pricing is per million tokens.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Context</TableHead>
                    <TableHead className="text-right">In / Out</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AI_MODELS.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{m.displayName}</p>
                        <p className="font-mono text-xs text-charcoal-400">{m.id}</p>
                      </TableCell>
                      <TableCell className="text-charcoal-600">{m.provider}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {m.capabilities.map((c) => (
                            <Badge key={c} variant="outline" className="text-[10px]">{c.replace(/_/g, ' ')}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">
                        {(m.contextTokens / 1000).toFixed(0)}K
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap text-right text-charcoal-600">
                        ${m.inputCost} / ${m.outputCost}
                      </TableCell>
                      <TableCell>
                        {m.isDefault ? <Badge variant="success">Default</Badge> : <Badge variant="default">Enabled</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> Prompt versions</CardTitle>
              <CardDescription>
                A prompt cannot go live without an evaluation result and a named person who promoted it — RULE-008
                applied to the agents themselves. Exactly one version per agent is active at a time.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Eval pass rate</TableHead>
                    <TableHead className="text-right">Sample</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Promoted by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AI_PROMPTS.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{p.agentName}</p>
                        <p className="font-mono text-xs text-charcoal-400">{p.agentId}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-charcoal-700">{p.version}</TableCell>
                      <TableCell>
                        <Badge variant={p.scope === 'GrounUp' ? 'default' : 'info'}>{p.scope}</Badge>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {p.evalPassRate != null ? (
                          <span className={p.evalPassRate >= 0.9 ? 'text-success-700' : 'text-warn-700'}>
                            {percent(p.evalPassRate, 1)}
                          </span>
                        ) : <span className="text-charcoal-400">not evaluated</span>}
                      </TableCell>
                      <TableCell className="tabular text-right text-charcoal-600">{p.evalSampleSize ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={
                          p.state === 'active' ? 'success' : p.state === 'evaluating' ? 'warn' : 'default'
                        }>{titleCase(p.state)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">
                        {p.activatedBy ? <>{p.activatedBy}<br /><span className="text-charcoal-400">{date(p.activatedAt)}</span></> : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- integrations */}
        <TabsContent value="integrations" className="space-y-4">
          <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="Where the credentials live">
            A connector stores a <em>handle</em> into the platform secret store, never the secret itself. Reading
            this table yields nothing anyone could authenticate with, and a connector cannot be enabled without a
            credential to run as.
          </Alert>

          <div className="grid gap-4 sm:grid-cols-4">
            <StatTile label="Connected" value={CONNECTORS.filter((c) => c.status === 'connected').length}
              tone="success" hint={`of ${CONNECTORS.length} available`} />
            <StatTile label="Degraded" value={CONNECTORS.filter((c) => c.status === 'degraded').length}
              tone={CONNECTORS.some((c) => c.status === 'degraded') ? 'warn' : 'success'}
              hint="last run did not fully succeed" />
            <StatTile label="Failed" value={CONNECTORS.filter((c) => c.status === 'failed').length}
              tone={CONNECTORS.some((c) => c.status === 'failed') ? 'danger' : 'success'}
              hint="three consecutive failures" />
            <StatTile label="Not connected" value={CONNECTORS.filter((c) => c.status === 'not_connected').length}
              hint="available but not set up" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plug className="size-4" /> Connector runtime</CardTitle>
              <CardDescription>
                Health is derived from each connector's own run history, so a connector that quietly stopped
                working shows as degraded rather than continuing to look connected.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Connector</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CONNECTORS.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <p className="font-medium text-charcoal-900">{c.provider}</p>
                        <p className="text-xs text-charcoal-500">{c.name}</p>
                      </TableCell>
                      <TableCell><Badge variant="outline">{titleCase(c.type)}</Badge></TableCell>
                      <TableCell className="font-mono text-xs text-charcoal-600">
                        {c.schedule ?? <span className="font-sans text-charcoal-400">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-charcoal-600">
                        {c.lastRunAt ? dateTime(c.lastRunAt) : <span className="text-charcoal-400">never</span>}
                      </TableCell>
                      <TableCell className="text-xs text-charcoal-600">
                        {c.lastRun ? (
                          <>
                            <span className="tabular">
                              {integer(c.lastRun.recordsRead)} read · {integer(c.lastRun.recordsWritten)} written
                              {c.lastRun.recordsSkipped ? ` · ${integer(c.lastRun.recordsSkipped)} skipped` : ''}
                            </span>
                            {c.lastRun.error ? (
                              <p className="mt-0.5 max-w-72 text-warn-700">{c.lastRun.error}</p>
                            ) : null}
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          c.status === 'connected' ? 'success'
                          : c.status === 'degraded' ? 'warn'
                          : c.status === 'failed' ? 'danger' : 'default'
                        }>{titleCase(c.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline">
                          {c.status === 'not_connected' ? 'Connect' : 'Configure'}
                        </Button>
                      </TableCell>
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

function FieldInput({
  label, hint, onChange, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} onChange={onChange} {...props} />
      {hint ? <p className="text-xs text-charcoal-500">{hint}</p> : null}
    </div>
  );
}

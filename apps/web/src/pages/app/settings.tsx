import { useState } from 'react';
import { Users, Palette, ShieldCheck, Save, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Switch, Separator } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationSettings } from '@/components/settings/notifications';
import { CompanyProfileSettings } from '@/components/settings/company-profile';
import { AiRegistrySettings, ConnectorSettings } from '@/components/settings/ai-and-connectors';
import { useQuery } from '@/lib/data/query';
import { loadShellIdentity } from '@/lib/data/company';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
  const meQ = useQuery(loadShellIdentity, []);
  const me = meQ.status === 'ready' ? meQ.data : null;
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
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="ai">AI registry</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------- company */}
        <TabsContent value="company" className="space-y-6">
          <CompanyProfileSettings section="company" />
        </TabsContent>

        {/* ------------------------------------------------------ estimating */}
        <TabsContent value="estimating" className="space-y-6">
          <CompanyProfileSettings section="estimating" />

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
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Security</CardTitle>
              <CardDescription>
                {/* Whoever is actually signed in. This read "Dana Whitfield" for
                    every user of the platform, on the screen about security. */}
                {me ? `Signed in as ${me.personName ?? me.email ?? ''}${me.roleName ? ` (${me.roleName})` : ''}.` : ''}
              </CardDescription>
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
          <AiRegistrySettings />
        </TabsContent>

        {/* ---------------------------------------------------- integrations */}
        <TabsContent value="integrations" className="space-y-4">
          <ConnectorSettings />
        </TabsContent>

      </Tabs>
    </div>
  );
}

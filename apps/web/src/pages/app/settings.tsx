import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, Info } from 'lucide-react';
import { CONFIDENCE_THRESHOLDS } from '@grounup/engine';
import { PageHeader } from '@/components/layout/page';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationSettings } from '@/components/settings/notifications';
import { CompanyProfileSettings } from '@/components/settings/company-profile';
import { BrandingSettings } from '@/components/settings/branding';
import { AiRegistrySettings, ConnectorSettings } from '@/components/settings/ai-and-connectors';
import { TeamMembers } from '@/components/settings/team-members';
import { CompanyRoles } from '@/components/settings/company-roles';
import { AuditLedger } from '@/components/settings/audit-ledger';
import { BillingPage } from './billing';
import { ApiAccessPage } from './api-access';
import { useQuery } from '@/lib/data/query';
import { loadShellIdentity } from '@/lib/data/company';
import { loadSession, useCompanyId, usePermissions } from '@/lib/data/session';
import { percent } from '@/lib/format';

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

export function SettingsPage() {
  const meQ = useQuery(loadShellIdentity, []);
  const me = meQ.status === 'ready' ? meQ.data : null;
  const sessionQ = useQuery(loadSession, []);
  const myPermissions = sessionQ.status === 'ready' ? sessionQ.data.permissions : [];
  const { companyId } = useCompanyId();
  const { can } = usePermissions();
  const canManageUsers = can('users.manage');

  /*
   * Which tab is open lives in the address, so a tab can be linked to — Billing
   * and API Access moved in here from their own nav entries and the two routes
   * that used to serve them now send people to `?tab=billing` and `?tab=api`.
   * A section somebody cannot link to is a section they cannot send a colleague.
   */
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'company';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Settings"
        description="GrounUp adapts to how your company operates. Change what you need — every change is versioned, attributed and auditable."
      />
      {/*
        * No page-level "Save changes" button. There was one, and it existed
        * only for the branding boxes below it: its handler set a dirty flag to
        * false and wrote nothing. Each section here saves its own values and
        * says so, which is the only arrangement in which a Save button means
        * anything.
        */}

      <Tabs value={tab} onValueChange={(v) => setParams(
        (prev) => { const next = new URLSearchParams(prev); next.set('tab', v); return next; },
        { replace: true },
      )}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="estimating">Estimating defaults</TabsTrigger>
          <TabsTrigger value="users">Users &amp; roles</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="ai">AI registry</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="api">API Access</TabsTrigger>
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
              <CardDescription>
                Where the confidence engine routes work. These are governed values rather than
                preferences, and they are read from the engine itself so this screen cannot drift
                from what actually routes a line.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/*
                * Read from the engine, not typed here. These were four string
                * literals in this JSX while the engine held its own copy, so
                * the screen could have been showing numbers that no longer
                * routed anything and nothing would have caught it. Same
                * principle as RULE-003 for rates: the number a screen shows
                * must be the number that acts.
                */}
              {[
                ['Auto-accept floor', String(CONFIDENCE_THRESHOLDS.autoAcceptFloor),
                  'Below this, a person reviews the line.'],
                ['Senior review ceiling', String(CONFIDENCE_THRESHOLDS.seniorReviewCeiling),
                  'Below this, a senior estimator must sign off.'],
                ['Mandatory senior review', String(CONFIDENCE_THRESHOLDS.seniorReviewFloor),
                  'At or below this, sign-off cannot be waived.'],
                ['Major cost impact share', percent(CONFIDENCE_THRESHOLDS.majorCostImpactShare),
                  'A line above this share of estimate value escalates.'],
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
          {/*
            * This tab used to be an eleven-row array typed into the JSX, with
            * invented user counts beside each role — on the screen an owner
            * opens to find out who can do what in their company. Migration 0211
            * gave `roles`, `company_memberships` and `company_invitations` the
            * doors they had gone without since 0002.
            */}
          <TeamMembers companyId={companyId} canManage={canManageUsers} />
          <CompanyRoles companyId={companyId} canManage={canManageUsers}
            myPermissions={myPermissions} />
        </TabsContent>

        {/* -------------------------------------------------------- branding */}
        <TabsContent value="branding">
          <BrandingSettings />
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

          <AuditLedger />

        </TabsContent>

        {/* -------------------------------------------------------- AI registry */}
        <TabsContent value="ai" className="space-y-6">
          <AiRegistrySettings />
        </TabsContent>

        {/* ---------------------------------------------------- integrations */}
        <TabsContent value="integrations" className="space-y-4">
          <ConnectorSettings />
        </TabsContent>

        {/* --------------------------------------------- billing, moved in */}
        <TabsContent value="billing">
          {/* Both of these were their own Administration nav entries, which
              left that group holding three items that were all company
              settings. `embedded` suppresses their page headers; everything
              else about them is unchanged, and their old routes still work. */}
          <BillingPage embedded />
        </TabsContent>

        <TabsContent value="api">
          <ApiAccessPage embedded />
        </TabsContent>

      </Tabs>
    </div>
  );
}

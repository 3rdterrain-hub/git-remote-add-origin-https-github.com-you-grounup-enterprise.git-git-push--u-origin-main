/**
 * The people in the company. WORKFLOW.
 *
 * Until migration 0211 a company could not add a person, change what somebody
 * may do, or take access away — `company_memberships` and `company_invitations`
 * had existed since 0002 with no writer at all.
 *
 * Two things this screen says out loud rather than hiding:
 *
 *   * **You cannot change your own role or suspend your own access.** The
 *     controls are disabled on your own row with the reason in the title,
 *     because the database refuses it and a person should know before clicking
 *     rather than after.
 *   * **An invitation link is shown once.** Nothing emails it. The link is put
 *     in front of whoever created it to pass on, which is the truth about what
 *     happened — "invitation sent" would be a sentence about an email that was
 *     never sent.
 */
import { useState } from 'react';
import {
  Loader2, UserPlus, Copy, Check, Ban, RotateCcw, ShieldCheck, Link2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { messageFor, useQuery } from '@/lib/data/query';
import {
  loadCompanyMembers, loadCompanyInvitations, loadCompanyRoles,
  setMemberRole, setMemberStatus, inviteMember, revokeInvitation,
  type CompanyMember,
} from '@/lib/data/team';
import { date, dateTime, titleCase } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const STATUS_TONE: Record<CompanyMember['status'], 'success' | 'warn' | 'default' | 'danger'> = {
  active: 'success', invited: 'default', suspended: 'warn', removed: 'danger',
};

/** The one-time link, with the only honest caption for it. */
function InvitationLink({ token, expiresAt, onDone }: {
  token: string; expiresAt: string; onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${token}`;
  return (
    <Alert tone="success" icon={<Link2 className="size-4" />} title="The invitation link, shown once">
      <p className="mb-2">
        This link is not stored and cannot be shown again — only its hash is kept, so a database
        read cannot be turned into somebody&rsquo;s access. Send it to them yourself; nothing is
        emailed from here. It stops working on {date(expiresAt)}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-charcoal-200 bg-white px-2 py-1 font-mono text-xs">
          {link}
        </code>
        <Button size="sm" variant="outline" onClick={() => {
          navigator.clipboard?.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }).catch(() => setCopied(false));
        }}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}><X className="size-4" /> Done</Button>
      </div>
    </Alert>
  );
}

export function TeamMembers({ companyId, canManage }: {
  companyId: string | null;
  canManage: boolean;
}) {
  const [nonce, setNonce] = useState(0);
  const again = () => setNonce((n) => n + 1);
  const membersQ = useQuery(loadCompanyMembers, [nonce]);
  const invitesQ = useQuery(loadCompanyInvitations, [nonce]);
  const rolesQ = useQuery(loadCompanyRoles, [nonce]);

  const members = membersQ.status === 'ready' ? membersQ.data : [];
  const invitations = invitesQ.status === 'ready' ? invitesQ.data : [];
  const roles = rolesQ.status === 'ready' ? rolesQ.data : [];
  const pending = invitations.filter((i) => i.state === 'pending');

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    fn().then(again).catch((e: unknown) => setError(messageFor(e))).finally(() => setBusy(false));
  };

  if (membersQ.status === 'loading') return <LoadingState label="Reading the team" />;
  if (membersQ.status === 'error') {
    return <ErrorState message={membersQ.message} onRetry={membersQ.refetch} />;
  }

  const chosenRole = roleId || roles.find((r) => r.key === 'estimator')?.id || roles[0]?.id || '';

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger" title="That did not go through">{error}</Alert> : null}
      {issued ? (
        <InvitationLink token={issued.token} expiresAt={issued.expiresAt}
          onDone={() => setIssued(null)} />
      ) : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>People</CardTitle>
            <CardDescription>
              Everybody with access to this company, and what each of them may do. A role change
              takes effect immediately — permissions are checked on every request, not at sign-in.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={!canManage || !companyId}
            onClick={() => setInviting((v) => !v)}
            title={canManage ? undefined : 'Needs permission to manage users'}>
            <UserPlus className="size-4" /> Invite somebody
          </Button>
        </CardHeader>

        {inviting ? (
          <CardContent>
            <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="inv-email">Their email address</Label>
                  <Input id="inv-email" type="email" value={email} autoFocus
                    placeholder="somebody@company.com"
                    onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="inv-role">Role</Label>
                  <select id="inv-role" className={field} value={chosenRole}
                    onChange={(e) => setRoleId(e.target.value)}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-charcoal-500">
                No account is created. They receive a link that lets them join this company
                themselves, which is why nobody can be added without their own action.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setInviting(false)}>Cancel</Button>
                <Button size="sm" disabled={busy || !email.trim() || !chosenRole || !companyId}
                  onClick={() => {
                    if (!companyId) return;
                    setBusy(true); setError(null);
                    inviteMember(companyId, { email: email.trim(), roleId: chosenRole })
                      .then((r) => {
                        setIssued({ token: r.token, expiresAt: r.expiresAt });
                        setEmail(''); setInviting(false); again();
                      })
                      .catch((e: unknown) => setError(messageFor(e)))
                      .finally(() => setBusy(false));
                  }}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null} Create the invitation
                </Button>
              </div>
            </div>
          </CardContent>
        ) : null}

        <CardContent className="p-0">
          {members.length === 0 ? (
            <EmptyState title="Nobody here yet" description="Invite the people who work with you." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="min-w-44">Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.filter((m) => m.status !== 'removed').map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="flex items-center gap-2 font-medium text-charcoal-900">
                        {m.fullName ?? m.email ?? 'Unnamed'}
                        {m.isMe ? <Badge variant="outline">You</Badge> : null}
                        {m.isOwner ? <Badge variant="info">Owner</Badge> : null}
                      </p>
                      <p className="text-xs text-charcoal-500">{m.email}</p>
                    </TableCell>
                    <TableCell>
                      {/* A choice is a select, not a label. */}
                      <select className={field} value={m.roleId} disabled={!canManage || m.isMe || busy}
                        title={m.isMe ? 'Somebody else has to change your role' : undefined}
                        onChange={(e) => run(() => setMemberRole(m.id, e.target.value))}>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <p className="mt-0.5 text-xs text-charcoal-400">
                        Approval tier {m.approvalTier}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[m.status]}>{titleCase(m.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-500">
                      {m.lastSeenAt ? dateTime(m.lastSeenAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {m.status === 'suspended' ? (
                        <Button size="sm" variant="outline" disabled={!canManage || busy}
                          onClick={() => run(() => setMemberStatus(m.id, 'active'))}>
                          <RotateCcw className="size-4" /> Restore
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline"
                          disabled={!canManage || m.isMe || busy}
                          title={m.isMe ? 'You cannot suspend your own access' : undefined}
                          onClick={() => run(() => setMemberStatus(m.id, 'suspended'))}>
                          <Ban className="size-4" /> Suspend
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pending.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitations waiting</CardTitle>
            <CardDescription>
              Each is a claim on a role that nobody has redeemed yet. Revoking one makes its link
              stop working.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Invited by</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">&nbsp;</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium text-charcoal-900">{i.email}</TableCell>
                    <TableCell>{i.roleName}</TableCell>
                    <TableCell className="text-xs text-charcoal-500">
                      {i.invitedByName ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-500">{date(i.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" disabled={!canManage || busy}
                        onClick={() => run(() => revokeInvitation(i.id))}>
                        <X className="size-4" /> Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Alert tone="neutral" icon={<ShieldCheck className="size-4" />} title="Segregation of duties">
        A person cannot approve their own request, cannot change their own role, and cannot suspend
        their own access — and a company must always keep at least one active owner. All four are
        enforced by the database, so no administrative mistake or application bug can bypass them.
      </Alert>
    </div>
  );
}

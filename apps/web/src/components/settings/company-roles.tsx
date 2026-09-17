/**
 * What each role may do. LIBRARY.
 *
 * The eleven shipped roles are shared by every company on the platform and are
 * not editable here — a company that needs something different defines its own,
 * which is what the Add a role control does.
 *
 * The permission list is not typed into this file. It comes from
 * `app.known_permissions()`, derived in turn from what the shipped roles
 * actually grant, so the checkboxes can never offer a permission
 * `app.has_permission` would not match. A permission that matches nothing would
 * produce a role somebody believes grants access it does not.
 *
 * What is deliberately not offered: granting a permission the person editing
 * does not hold themselves, and the `*` wildcard. Both are refused by the
 * database (0211) and both are hidden here, so the screen and the rule agree.
 */
import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Users, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { LoadingState, ErrorState } from '@/components/data-state';
import { messageFor, useQuery } from '@/lib/data/query';
import {
  loadCompanyRoles, createCompanyRole, setCompanyRole, deleteCompanyRole,
  type CompanyRole,
} from '@/lib/data/team';
import { plural } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';

const TIER_SAYS: Record<number, string> = {
  0: 'Signs nothing off',
  1: 'Estimator sign-off',
  2: 'Senior estimator sign-off',
  3: 'Chief estimator sign-off',
  4: 'Executive sign-off',
};

/** Group permissions by their prefix, so the list reads as areas of the business. */
function grouped(all: string[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const p of all) {
    const area = p.includes('.') ? p.slice(0, p.indexOf('.')) : 'other';
    const list = map.get(area);
    if (list) list.push(p); else map.set(area, [p]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function RoleEditor({ role, everyPermission, grantable, onCancel, onSave, busy }: {
  role: CompanyRole | null;
  everyPermission: string[];
  /** What the person editing holds. Anything else is refused by the database. */
  grantable: Set<string>;
  onCancel: () => void;
  onSave: (v: { name: string; description: string; permissions: string[]; tier: number }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [tier, setTier] = useState(role?.approvalTier ?? 0);
  const [chosen, setChosen] = useState<Set<string>>(new Set(role?.permissions ?? []));

  const toggle = (p: string) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="role-name">Name</Label>
          <Input id="role-name" value={name} autoFocus placeholder="Yard Foreman"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="role-desc">What this role is for</Label>
          <Input id="role-desc" value={description} placeholder="Runs the yard and the small tools"
            onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="role-tier">Approval tier</Label>
        <select id="role-tier" className={field} value={tier}
          onChange={(e) => setTier(Number(e.target.value))}>
          {[0, 1, 2, 3, 4].map((t) => (
            <option key={t} value={t}>Tier {t} — {TIER_SAYS[t]}</option>
          ))}
        </select>
        <p className="text-xs text-charcoal-500">
          A tier gates which review a person can satisfy. You cannot create a role that signs off
          above your own.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Permissions</Label>
        {grouped(everyPermission).map(([area, perms]) => (
          <div key={area}>
            <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{area}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {perms.map((p) => {
                const allowed = grantable.has(p);
                return (
                  <label key={p}
                    className={`flex items-center gap-1.5 text-sm ${allowed ? '' : 'opacity-40'}`}
                    title={allowed ? undefined : 'You do not hold this permission, so you cannot grant it'}>
                    <input type="checkbox" checked={chosen.has(p)} disabled={!allowed}
                      onChange={() => toggle(p)} />
                    <span className="font-mono text-xs">{p.split('.')[1] ?? p}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={busy || !name.trim() || chosen.size === 0}
          title={chosen.size === 0 ? 'A role that grants nothing gives its holder no way in' : undefined}
          onClick={() => onSave({
            name: name.trim(), description: description.trim(),
            permissions: [...chosen], tier,
          })}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save the role
        </Button>
      </div>
    </div>
  );
}

export function CompanyRoles({ companyId, canManage, myPermissions }: {
  companyId: string | null;
  canManage: boolean;
  /** What the signed-in person holds. '*' means everything. */
  myPermissions: string[];
}) {
  const [nonce, setNonce] = useState(0);
  const again = () => setNonce((n) => n + 1);
  const rolesQ = useQuery(loadCompanyRoles, [nonce]);
  const roles = rolesQ.status === 'ready' ? rolesQ.data : [];

  const [editing, setEditing] = useState<CompanyRole | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CompanyRole | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /*
   * Every permission the platform knows, taken from the shipped roles that are
   * in this list already. The same derivation the database uses, so the
   * checkboxes and `app.known_permissions()` cannot disagree.
   */
  const everyPermission = [...new Set(
    roles.filter((r) => r.isSystem).flatMap((r) => r.permissions),
  )].filter((p) => p !== '*').sort();
  const holdsEverything = myPermissions.includes('*');
  const grantable = new Set(
    holdsEverything ? everyPermission : everyPermission.filter((p) => myPermissions.includes(p)),
  );

  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    fn().then(() => { again(); setEditing(null); setAdding(false); setRemoving(null); })
      .catch((e: unknown) => setError(messageFor(e)))
      .finally(() => setBusy(false));
  };

  if (rolesQ.status === 'loading') return <LoadingState label="Reading the roles" />;
  if (rolesQ.status === 'error') {
    return <ErrorState message={rolesQ.message} onRetry={rolesQ.refetch} />;
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger" title="That role was not saved">{error}</Alert> : null}
      {note ? <Alert tone="success" title="Done">{note}</Alert> : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Roles and permissions</CardTitle>
            <CardDescription>
              The shipped roles are shared by every company on GrounUp and cannot be edited — define
              your own if you need something different. The approval tier controls which review
              gates a person can satisfy: an estimator cannot clear a senior review, whatever else
              they are permitted.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={!canManage || !companyId}
            onClick={() => { setAdding(true); setEditing(null); }}
            title={canManage ? undefined : 'Needs permission to manage users'}>
            <Plus className="size-4" /> Add a role
          </Button>
        </CardHeader>

        {adding ? (
          <CardContent>
            <RoleEditor role={null} everyPermission={everyPermission} grantable={grantable}
              busy={busy} onCancel={() => setAdding(false)}
              onSave={(v) => {
                if (!companyId) return;
                run(() => createCompanyRole(companyId, {
                  name: v.name, permissions: v.permissions,
                  description: v.description || null, approvalTier: v.tier,
                }));
              }} />
          </CardContent>
        ) : null}

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Approval tier</TableHead>
                <TableHead className="min-w-72">Permissions</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => (
                <>
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="flex items-center gap-2 font-medium text-charcoal-900">
                        {r.name}
                        {r.isSystem ? (
                          <Badge variant="outline" title="Shipped with GrounUp, shared by every company">
                            <Shield className="size-3" /> Shipped
                          </Badge>
                        ) : null}
                      </p>
                      <p className="font-mono text-xs text-charcoal-400">{r.key}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={r.approvalTier >= 3 ? 'danger' : r.approvalTier === 2 ? 'warn' : r.approvalTier === 1 ? 'info' : 'default'}
                        title={TIER_SAYS[r.approvalTier]}>
                        Tier {r.approvalTier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-charcoal-600">
                      {r.permissions.includes('*')
                        ? 'All permissions'
                        : r.permissions.map((p) => p.replace('.', ' ')).join(', ')}
                    </TableCell>
                    {/* Counted from the memberships, not remembered. */}
                    <TableCell className="tabular text-right">{r.memberCount || '—'}</TableCell>
                    <TableCell className="text-right">
                      {r.isEditable ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={!canManage || busy}
                            onClick={() => { setEditing(r); setAdding(false); }}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!canManage || busy}
                            onClick={() => { setRemoving(r); setMoveTo(''); }}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-charcoal-400">Shipped</span>
                      )}
                    </TableCell>
                  </TableRow>
                  {editing?.id === r.id ? (
                    <TableRow key={`${r.id}-edit`}>
                      <TableCell colSpan={5}>
                        {/* Editors open under the row, never inside a cell. */}
                        <RoleEditor role={r} everyPermission={everyPermission} grantable={grantable}
                          busy={busy} onCancel={() => setEditing(null)}
                          onSave={(v) => run(() => setCompanyRole(r.id, {
                            name: v.name, permissions: v.permissions,
                            description: v.description || null, approvalTier: v.tier,
                          }))} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {removing?.id === r.id ? (
                    <TableRow key={`${r.id}-remove`}>
                      <TableCell colSpan={5}>
                        <div className="space-y-2 rounded-md border border-danger-200 bg-danger-50/50 p-3">
                          <p className="text-sm font-medium text-charcoal-900">
                            Remove {r.name}?
                          </p>
                          <p className="text-xs text-charcoal-600">
                            {r.memberCount
                              ? `${plural(r.memberCount, 'person')} holds this role. Say which role they move into — removing a role and changing what those people may do are different decisions.`
                              : 'Nobody holds this role. Still say where any late arrival would go.'}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <select className={`${field} max-w-64`} value={moveTo}
                              onChange={(e) => setMoveTo(e.target.value)}>
                              <option value="">Move them into…</option>
                              {roles.filter((o) => o.id !== r.id).map((o) => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                              Cancel
                            </Button>
                            <Button size="sm" disabled={busy || !moveTo}
                              title={moveTo ? undefined : 'Say which role they move into'}
                              onClick={() => run(() => deleteCompanyRole(r.id, moveTo).then((n) => {
                                setNote(n ? `${plural(n, 'person')} moved into their new role.`
                                  : `${r.name} removed.`);
                              }))}>
                              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Remove it
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!holdsEverything ? (
        <Alert tone="info" title="You can only grant what you hold">
          Permissions you do not have are shown but cannot be ticked. Handing out access you were
          never given is how an administrator becomes an owner, so the database refuses it as well
          as this screen.
        </Alert>
      ) : null}
    </div>
  );
}

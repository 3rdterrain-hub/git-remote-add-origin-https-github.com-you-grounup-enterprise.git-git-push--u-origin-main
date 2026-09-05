import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShieldAlert, Loader2, Plus, Lock, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { useQuery } from '@/lib/data/query';
import {
  loadPlatformRoles, loadPlatformPermissions, loadOperators, setRolePermissions,
  createPlatformRole, setOperatorRole, revokeOperator,
} from '@/lib/data/admin';
import { LoadingState, ErrorState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';
import type { OperatorContext } from './shell';

/**
 * What each kind of operator may do.
 *
 * Two things on this screen are deliberately not editable, and both are
 * structural rather than administrative. The superadmin role is fixed at
 * everything, because a screen that can narrow it is a screen that can lock
 * the platform out of itself. And no other role can be given `*` — a job is
 * described by the permissions it needs, one at a time.
 *
 * The checkboxes are a convenience over the refusal. `app.set_role_permissions`
 * makes the same three checks itself, so an operator who reaches the function
 * another way gets the same answer.
 */
export function AdminRoles() {
  const { can } = useOutletContext<OperatorContext>();
  const rolesQ = useQuery(loadPlatformRoles, []);
  const permsQ = useQuery(loadPlatformPermissions, []);
  const operatorsQ = useQuery(loadOperators, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ key: '', name: '', description: '' });
  const [newPerms, setNewPerms] = useState<string[]>([]);

  const roles = rolesQ.status === 'ready' ? rolesQ.data : [];
  const permissions = permsQ.status === 'ready' ? permsQ.data : [];
  const operators = (operatorsQ.status === 'ready' ? operatorsQ.data : [])
    .filter((o) => !o.revokedAt);
  const grantable = roles.filter((r) => r.assignable);
  const mayManage = can('operators.manage');

  const failure = [rolesQ, permsQ, operatorsQ].find((q) => q.status === 'error');
  if (failure) return <ErrorState message={failure.message} onRetry={failure.refetch} />;
  if (rolesQ.status === 'loading') return <LoadingState label="Reading roles" />;

  const held = (key: string) =>
    draft[key] ?? roles.find((r) => r.key === key)?.permissions ?? [];

  const toggle = (key: string, permission: string) => {
    const now = held(key);
    setDraft({
      ...draft,
      [key]: now.includes(permission)
        ? now.filter((p) => p !== permission)
        : [...now, permission],
    });
  };

  const dirty = (key: string) => {
    const before = roles.find((r) => r.key === key)?.permissions ?? [];
    const after = held(key);
    return before.length !== after.length || after.some((p) => !before.includes(p));
  };

  async function save(key: string) {
    if (!supabase) return;
    setBusy(key); setError(null);
    try {
      await setRolePermissions(supabase, key, held(key), why[key] ?? '');
      setDraft({ ...draft, [key]: [] });
      setWhy({ ...why, [key]: '' });
      delete draft[key];
      rolesQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That role could not be changed.');
    } finally { setBusy(null); }
  }

  async function create() {
    if (!supabase) return;
    setBusy('new'); setError(null);
    try {
      await createPlatformRole(supabase, { ...newRole, permissions: newPerms });
      setNewRole({ key: '', name: '', description: '' });
      setNewPerms([]); setCreating(false);
      rolesQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That role could not be added.');
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">
          Roles and permissions
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          What each kind of operator may do. Changes take effect on their next request —
          there is no cached copy of a permission anywhere.
        </p>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/*
        * Who, then what. The list used to start with the roles, which is the
        * right shape for designing them and the wrong shape for the question
        * anybody actually arrives with: what does this person control.
        */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" /> Your people
          </CardTitle>
          <CardDescription>
            What each of them controls. Changing somebody&apos;s role takes effect on their
            next request — there is no cached copy of a permission anywhere.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {operators.map((o) => {
            const held = roles.find((r) => r.key === o.roleKey);
            const isSuper = o.roleKey === 'superadmin';
            return (
              <div key={o.userId}
                className="grid gap-3 border-b border-charcoal-100 pb-4 last:border-0
                           sm:grid-cols-[1fr_14rem_auto]">
                <div className="min-w-0">
                  <p className="font-medium text-charcoal-900">{o.email ?? o.userId}</p>
                  <p className="text-xs text-charcoal-500">{o.reason}</p>
                  {held ? (
                    <p className="mt-1 text-xs text-charcoal-600">
                      {held.permissions.includes('*')
                        ? 'Everything on this platform.'
                        : held.permissions.length
                          ? permissions
                              .filter((p) => held.permissions.includes(p.key))
                              .map((p) => p.label).join(' · ')
                          : 'Nothing yet — pick what they should control.'}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`role-${o.userId}`} className="text-xs">
                    What they control
                  </Label>
                  {isSuper ? (
                    <p className="flex h-9 items-center gap-1.5 text-sm text-charcoal-500">
                      <Lock className="size-3.5" /> Superadmin
                    </p>
                  ) : (
                    <select id={`role-${o.userId}`} value={o.roleKey}
                      className="h-9 w-full rounded border border-charcoal-300 bg-white
                                 px-2 text-sm"
                      disabled={!mayManage || busy === o.userId}
                      onChange={async (e) => {
                        if (!supabase) return;
                        setBusy(o.userId); setError(null);
                        try {
                          await setOperatorRole(supabase, o.userId, e.target.value,
                            'Role changed from the roles screen');
                          operatorsQ.refetch();
                        } catch (err) {
                          setError(err instanceof Error ? err.message
                            : 'That role could not be changed.');
                        } finally { setBusy(null); }
                      }}>
                      {grantable.map((r) => (
                        <option key={r.key} value={r.key}>{r.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex items-end">
                  {busy === o.userId ? (
                    <Loader2 className="mb-2 size-4 animate-spin text-charcoal-400" />
                  ) : null}
                  {!isSuper ? (
                    <Button size="sm" variant="ghost" disabled={!mayManage || busy === o.userId}
                      onClick={async () => {
                        if (!supabase) return;
                        setBusy(o.userId); setError(null);
                        try {
                          await revokeOperator(supabase, o.userId,
                            'Access withdrawn from the roles screen');
                          operatorsQ.refetch();
                        } catch (err) {
                          setError(err instanceof Error ? err.message
                            : 'That access could not be withdrawn.');
                        } finally { setBusy(null); }
                      }}>
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!operators.length && operatorsQ.status === 'ready' ? (
            <p className="text-sm text-charcoal-500">
              Nobody but you operates this platform yet. Take somebody on under
              <strong> Controls</strong>.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-bold text-charcoal-900">What each role means</h2>
        <p className="mt-1 text-sm text-charcoal-500">
          The jobs above are chosen from these. Change one and everybody holding it changes
          with it.
        </p>
      </div>

      {roles.map((role) => (
        <Card key={role.key}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {role.name}
                  {!role.assignable ? (
                    <Badge variant="warn">
                      <Lock className="mr-1 size-3" /> Fixed
                    </Badge>
                  ) : null}
                  {!role.isSystem ? <Badge variant="default">Yours</Badge> : null}
                </CardTitle>
                <CardDescription>{role.description}</CardDescription>
              </div>
              {role.permissions.includes('*') ? (
                <Badge variant="warn">Everything</Badge>
              ) : (
                <span className="text-xs text-charcoal-500">
                  {role.permissions.length} of {permissions.length}
                </span>
              )}
            </div>
          </CardHeader>

          {role.assignable ? (
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {permissions.map((p) => (
                  <label key={p.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded border
                               border-charcoal-200 p-3 hover:bg-charcoal-50">
                    <input type="checkbox" className="mt-0.5 size-4 accent-charcoal-900"
                      disabled={!mayManage}
                      checked={held(role.key).includes(p.key)}
                      onChange={() => toggle(role.key, p.key)} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium
                                       text-charcoal-900">
                        {p.label}
                        {p.isPowerful ? <Badge variant="warn">Powerful</Badge> : null}
                      </span>
                      <span className="block text-xs text-charcoal-500">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              {dirty(role.key) ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`why-${role.key}`}>Why this is changing</Label>
                    <Input id={`why-${role.key}`} value={why[role.key] ?? ''}
                      placeholder="Support needs to see billing to answer payment tickets"
                      onChange={(e) => setWhy({ ...why, [role.key]: e.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button disabled={!mayManage || busy === role.key
                      || (why[role.key] ?? '').trim().length < 5}
                      onClick={() => save(role.key)}>
                      {busy === role.key ? <Loader2 className="size-4 animate-spin" /> : null}
                      Save
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          ) : (
            <CardContent>
              <p className="text-sm text-charcoal-500">
                Not editable, and not grantable from a screen. Narrowing it could leave the
                platform with nobody able to grant anything, so handing the seat over stays a
                deliberate act outside the product.
              </p>
            </CardContent>
          )}
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>A role of your own</CardTitle>
          <CardDescription>
            For a job the five above do not describe. It can hold any combination of the
            permissions in the catalog, and never all of them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!creating ? (
            <Button variant="outline" disabled={!mayManage} onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Add a role
            </Button>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="role-key">Key</Label>
                  <Input id="role-key" value={newRole.key} placeholder="onboarding"
                    onChange={(e) => setNewRole({ ...newRole, key: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role-name">Name</Label>
                  <Input id="role-name" value={newRole.name} placeholder="Onboarding"
                    onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-desc">What this role is for</Label>
                <Input id="role-desc" value={newRole.description}
                  placeholder="Sets a new customer up and hands them to their account manager"
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {permissions.map((p) => (
                  <label key={p.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded border
                               border-charcoal-200 p-2.5 text-sm hover:bg-charcoal-50">
                    <input type="checkbox" className="size-4 accent-charcoal-900"
                      checked={newPerms.includes(p.key)}
                      onChange={() => setNewPerms(newPerms.includes(p.key)
                        ? newPerms.filter((k) => k !== p.key) : [...newPerms, p.key])} />
                    {p.label}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button disabled={busy === 'new' || !newRole.key.trim()
                  || !newRole.name.trim() || newRole.description.trim().length < 10}
                  onClick={create}>
                  {busy === 'new' ? <Loader2 className="size-4 animate-spin" /> : null}
                  Add role
                </Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!mayManage ? (
        <Alert tone="warn" icon={<ShieldAlert className="size-4" />}
          title="Changing these is somebody else's">
          You can see how the platform is staffed. Changing it needs the operators
          permission, and the database refuses it here regardless of what this screen shows.
        </Alert>
      ) : null}
    </div>
  );
}

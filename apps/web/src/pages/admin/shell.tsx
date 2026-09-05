import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Package, CreditCard, ShieldAlert,
  Globe, Settings, LogOut, Loader2, Users, KeyRound, Filter, TrendingDown,
} from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  isPlatformAdmin, isSuperadmin, superadminSeatIsOpen, claimFirstSuperadmin,
  myOperatorPermissions,
} from '@/lib/data/admin';
import { cn } from '@/lib/utils';

/**
 * The console every operator screen sits inside.
 *
 * What a person sees here is decided by what they may do, asked of the
 * database rather than inferred from a role name. Hiding a section is a
 * courtesy on top of a refusal, never instead of one: every function behind
 * these screens checks for itself, and the views return nothing to somebody
 * without the permission to read them.
 */
export interface OperatorContext {
  isSuper: boolean;
  /** Whether the signed-in operator holds a platform permission. */
  can: (permission: string) => boolean;
}

/** Every permission the console asks about, in one place. */
const PERMISSIONS = [
  'companies.read', 'companies.manage', 'billing.read', 'billing.manage',
  'upsell.propose', 'upsell.decide', 'features.manage', 'pricing.manage',
  'operators.manage', 'support.open',
] as const;

/*
 * A section appears when the operator holds any one of the permissions it is
 * built on. `needs: []` means the section has nothing behind it worth gating —
 * the dashboard and their own settings.
 */
const SECTIONS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, needs: [] as string[] },
  { to: '/admin/companies', label: 'Companies', icon: Building2, needs: ['companies.read'] },
  { to: '/admin/traffic', label: 'Traffic', icon: Filter, needs: ['companies.read'] },
  { to: '/admin/accounts', label: 'Accounts', icon: Users,
    needs: ['companies.manage', 'billing.manage'] },
  { to: '/admin/packages', label: 'Packages', icon: Package, needs: ['pricing.manage'] },
  { to: '/admin/billing', label: 'Billing', icon: CreditCard, needs: ['billing.read'] },
  { to: '/admin/churn', label: 'Losing customers', icon: TrendingDown,
    needs: ['billing.read'] },
  { to: '/admin/controls', label: 'Controls', icon: ShieldAlert,
    needs: ['upsell.decide', 'features.manage', 'operators.manage'] },
  { to: '/admin/roles', label: 'Roles', icon: KeyRound, needs: ['operators.manage'] },
  { to: '/admin/front-end', label: 'Front end', icon: Globe, needs: ['pricing.manage'] },
  { to: '/admin/settings', label: 'Settings', icon: Settings, needs: [] as string[] },
];

export function AdminShell() {
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'operator' | 'no'>('checking');
  const [isSuper, setIsSuper] = useState(false);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState<string | null>(null);
  /*
   * Whether nobody yet holds the operator seat. `platform_admins` has no insert
   * policy on purpose — it is the most powerful grant in the system — which is
   * right once a platform is running and wrong on the day it is installed,
   * because there is nobody to do the granting.
   */
  const [seatOpen, setSeatOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setState('no'); return; }
    let canceled = false;
    void (async () => {
      const { data } = await supabase!.auth.getUser();
      if (canceled) return;
      if (!data.user) { setState('no'); return; }
      setEmail(data.user.email ?? null);
      try {
        const [operator, superadmin] = await Promise.all([
          isPlatformAdmin(supabase!), isSuperadmin(supabase!),
        ]);
        if (canceled) return;
        setIsSuper(superadmin);
        if (operator) {
          const permissions = await myOperatorPermissions(supabase!, [...PERMISSIONS]);
          if (canceled) return;
          setHeld(permissions);
        }
        if (!operator) setSeatOpen(await superadminSeatIsOpen(supabase!).catch(() => false));
        setState(operator ? 'operator' : 'no');
      } catch {
        if (!canceled) setState('no');
      }
    })();
    return () => { canceled = true; };
  }, []);

  if (state === 'checking') {
    return (
      <div className="flex min-h-full items-center justify-center bg-charcoal-900"
        role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-charcoal-500" />
        <span className="sr-only">Checking your access</span>
      </div>
    );
  }

  if (state === 'no') {
    if (!isSupabaseConfigured) {
      return (
        <div className="mx-auto max-w-lg p-10">
          <Alert tone="info" icon={<ShieldAlert className="size-4" />}
            title="The console needs a configured workspace">
            This build runs against the demonstration dataset, which has one company in it
            and no subscriptions to operate.
          </Alert>
        </div>
      );
    }
    if (email && seatOpen) {
      return (
        <div className="mx-auto max-w-lg space-y-4 p-10">
          <Alert tone="warn" icon={<ShieldAlert className="size-4" />}
            title="Nobody operates this platform yet">
            The operator seat is unclaimed. It can be taken once, by the first account
            registered here — which is how a new installation gets its first
            administrator without anybody writing SQL. After that it is granted in the
            database like any other operator access.
          </Alert>
          {claimError ? <Alert tone="danger">{claimError}</Alert> : null}
          <div className="rounded-[--radius-card] border border-charcoal-200 bg-white p-5">
            <p className="text-sm text-charcoal-700">
              Signed in as <span className="font-medium">{email}</span>.
            </p>
            <Button className="mt-3" disabled={claiming}
              onClick={async () => {
                if (!supabase) return;
                setClaiming(true); setClaimError(null);
                try {
                  await claimFirstSuperadmin(supabase);
                  window.location.reload();
                } catch (err) {
                  setClaimError(err instanceof Error ? err.message
                    : 'That seat could not be claimed.');
                  setClaiming(false);
                }
              }}>
              {claiming ? <Loader2 className="size-4 animate-spin" /> : null}
              Claim the operator seat
            </Button>
          </div>
        </div>
      );
    }
    return <Navigate to="/admin/login" replace />;
  }

  const can = (permission: string) => held.has(permission);
  const visible = SECTIONS.filter(
    (s) => s.needs.length === 0 || s.needs.some(can));

  return (
    <div className="flex min-h-full bg-charcoal-100">
      <aside className="flex w-60 flex-col bg-charcoal-900">
        <div className="flex items-center gap-2 px-5 py-4">
          <Logo className="text-white" showDescriptor={false} />
          <Badge variant="warn">{isSuper ? 'Superadmin' : 'Operator'}</Badge>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {visible.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-charcoal-800 text-white'
                  : 'text-charcoal-300 hover:bg-charcoal-800/60 hover:text-white')}>
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-charcoal-800 p-3">
          <p className="truncate px-2 text-xs text-charcoal-400">{email}</p>
          <p className="px-2 text-[11px] text-charcoal-500">
            {isSuper ? 'Approves everything'
              : `${held.size} permission${held.size === 1 ? '' : 's'}`}
          </p>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-charcoal-300"
            onClick={async () => {
              await supabase?.auth.signOut();
              navigate('/admin/login', { replace: true });
            }}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[100rem] p-6">
          {!isSuper ? (
            <Alert tone="neutral" className="mb-5" icon={<ShieldAlert className="size-4" />}
              title="You hold some of what this console can do">
              The sections you can see are the ones your role covers. Everything else is
              refused by the database rather than merely hidden here, so reaching a screen
              another way changes nothing about what you can do on it.
            </Alert>
          ) : null}
          <Outlet context={{ isSuper, can } satisfies OperatorContext} />
        </div>
      </main>
    </div>
  );
}

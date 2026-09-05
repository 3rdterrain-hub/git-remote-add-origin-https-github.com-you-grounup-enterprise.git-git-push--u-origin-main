import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Package, CreditCard, ShieldAlert,
  Globe, Settings, LogOut, Loader2,
} from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isPlatformAdmin, isSuperadmin } from '@/lib/data/admin';
import { cn } from '@/lib/utils';

/**
 * The console every operator screen sits inside.
 *
 * Two facts decide what a person sees here, and they are asked of the database
 * rather than inferred: are you an operator at all, and are you the one who
 * decides. Sales sees the same tenants and none of the controls; hiding a
 * button is a courtesy on top of a refusal, never instead of one, and every
 * function behind these screens checks for itself.
 */
export interface OperatorContext {
  isSuper: boolean;
}

const SECTIONS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, superOnly: false },
  { to: '/admin/companies', label: 'Companies', icon: Building2, superOnly: false },
  { to: '/admin/packages', label: 'Packages', icon: Package, superOnly: false },
  { to: '/admin/billing', label: 'Billing', icon: CreditCard, superOnly: false },
  { to: '/admin/controls', label: 'Superadmin controls', icon: ShieldAlert, superOnly: true },
  { to: '/admin/front-end', label: 'Front end', icon: Globe, superOnly: true },
  { to: '/admin/settings', label: 'Settings', icon: Settings, superOnly: false },
];

export function AdminShell() {
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'operator' | 'no'>('checking');
  const [isSuper, setIsSuper] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

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
    return <Navigate to="/admin/login" replace />;
  }

  const visible = SECTIONS.filter((s) => !s.superOnly || isSuper);

  return (
    <div className="flex min-h-full bg-charcoal-100">
      <aside className="flex w-60 flex-col bg-charcoal-900">
        <div className="flex items-center gap-2 px-5 py-4">
          <Logo className="text-white" showDescriptor={false} />
          <Badge variant="warn">{isSuper ? 'Super' : 'Sales'}</Badge>
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
            {isSuper ? 'Approves everything' : 'Sees and proposes'}
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
              title="You are signed in as sales">
              You can see how every company is doing and propose an upsell with a reason
              attached. Changing a customer&apos;s plan or features is the superadmin&apos;s, and
              the database refuses it here regardless of what this screen shows.
            </Alert>
          ) : null}
          <Outlet context={{ isSuper } satisfies OperatorContext} />
        </div>
      </main>
    </div>
  );
}

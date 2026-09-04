import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calculator, FileStack, HardHat, Users, Library,
  BarChart3, Settings, CreditCard, Menu, X, Bell, Search, ChevronDown, Bot,
  FileSignature, ArrowRight, CalendarDays, Truck, Users2, ShoppingCart, Banknote, ShieldAlert,
  Mountain, Gavel, Network, KeyRound,
} from 'lucide-react';
import { Logo } from './logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { COMPANY, USER } from '@/data/demo';
import { ESTIMATE } from '@/data/demo';
import { AI_FINDINGS } from '@/data/operations';
import { NOTIFICATIONS } from '@/data/field';
import { search, KIND_LABEL, type SearchHit } from '@/lib/search';

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/estimates', label: 'Estimating', icon: Calculator },
  { to: '/app/proposals', label: 'Proposals', icon: FileSignature },
  { to: '/app/plans', label: 'Plans & Specs', icon: FileStack },
  { to: '/app/projects', label: 'Projects', icon: HardHat },
  { to: '/app/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/app/fleet', label: 'Fleet', icon: Truck },
  { to: '/app/workforce', label: 'Workforce', icon: Users2 },
  { to: '/app/procurement', label: 'Procurement', icon: ShoppingCart },
  { to: '/app/finance', label: 'Finance', icon: Banknote },
  { to: '/app/safety', label: 'Safety & Quality', icon: ShieldAlert },
  { to: '/app/survey', label: 'Survey & Grade', icon: Mountain },
  { to: '/app/claims', label: 'Claims', icon: Gavel },
  { to: '/app/crm', label: 'CRM', icon: Users },
  { to: '/app/libraries', label: 'Master Libraries', icon: Library },
  { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  { to: '/app/network', label: 'GrounUp Network', icon: Network },
] as const;

const ADMIN_NAV = [
  { to: '/app/settings', label: 'Company Settings', icon: Settings },
  { to: '/app/billing', label: 'Billing', icon: CreditCard },
  { to: '/app/api', label: 'API Access', icon: KeyRound },
] as const;

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const pendingFindings = AI_FINDINGS.filter((f) => f.state === 'proposed').length;
  const unread = NOTIFICATIONS.filter((n) => !n.readAt);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return; }
    let canceled = false;
    const t = setTimeout(() => {
      search(query).then((r) => { if (!canceled) setHits(r); }).catch(() => undefined);
    }, 180);
    return () => { canceled = true; clearTimeout(t); };
  }, [query]);

  // Cmd/Ctrl-K focuses search, the shortcut people already have in their hands.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goTo = (hit: SearchHit) => {
    setSearchOpen(false);
    setQuery('');
    navigate(hit.path);
  };

  return (
    <div className="flex min-h-full bg-charcoal-100">
      {/* Mobile scrim */}
      {open ? (
        <button
          className="fixed inset-0 z-30 bg-charcoal-950/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-charcoal-900 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-charcoal-800 px-4">
          <NavLink to="/app" onClick={() => setOpen(false)}>
            <Logo subdued />
          </NavLink>
          <Button variant="ghost" size="icon" className="text-charcoal-400 hover:bg-charcoal-800 lg:hidden" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>

        <div className="border-b border-charcoal-800 px-4 py-3">
          <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-charcoal-800">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{COMPANY.name}</span>
              <span className="block text-xs text-charcoal-400">{COMPANY.city}, {COMPANY.state} · {COMPANY.planName}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-charcoal-500" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} onNavigate={() => setOpen(false)}
              badge={item.label === 'Plans & Specs' && pendingFindings ? pendingFindings : undefined} />
          ))}
          <p className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-charcoal-500">
            Administration
          </p>
          {ADMIN_NAV.map((item) => (
            <NavItem key={item.to} {...item} onNavigate={() => setOpen(false)} />
          ))}
        </nav>

        <div className="border-t border-charcoal-800 p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-charcoal-900">
              {USER.name.split(' ').map((n) => n[0]).join('')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{USER.name}</span>
              <span className="block truncate text-xs text-charcoal-400">{USER.role}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-charcoal-200 bg-white px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>

          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search estimates, projects, drawings, assets, people…"
              aria-label="Search"
              className="h-9 w-full rounded-md border border-charcoal-200 bg-charcoal-50 pl-9 pr-14 text-sm placeholder:text-charcoal-400 focus:border-yellow-500 focus:bg-white focus:outline-none"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-charcoal-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-charcoal-400">
              ⌘K
            </kbd>

            {searchOpen && query.trim().length >= 2 ? (
              <>
                <button className="fixed inset-0 z-40 cursor-default" aria-hidden="true" tabIndex={-1}
                  onClick={() => setSearchOpen(false)} />
                <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-[--radius-card] border border-charcoal-200 bg-white shadow-xl">
                  {hits.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-charcoal-500">
                      Nothing matches “{query}”.
                    </p>
                  ) : (
                    <ul className="max-h-96 divide-y divide-charcoal-200 overflow-y-auto">
                      {hits.map((h) => (
                        <li key={`${h.kind}-${h.id}`}>
                          <button onClick={() => goTo(h)}
                            className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-charcoal-50">
                            <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">{KIND_LABEL[h.kind]}</Badge>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-charcoal-900">{h.title}</span>
                              <span className="block truncate text-xs text-charcoal-500">{h.subtitle}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="border-t border-charcoal-200 px-4 py-2 text-[11px] text-charcoal-500">
                    Results are permission-filtered in the database — you only see what your role can already open.
                  </p>
                </div>
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {ESTIMATE.blockedFromIssue ? (
              <Badge variant="danger" className="hidden sm:inline-flex">
                {ESTIMATE.number} blocked from issue
              </Badge>
            ) : null}
            <Button variant="ghost" size="icon" aria-label="AI review queue" className="relative">
              <Bot />
              {pendingFindings ? (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-yellow-500" />
              ) : null}
            </Button>
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`}
                aria-expanded={bellOpen}
                className="relative"
                onClick={() => setBellOpen((v) => !v)}
              >
                <Bell />
                {unread.length ? (
                  <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
                    {unread.length}
                  </span>
                ) : null}
              </Button>

              {bellOpen ? (
                <>
                  {/* Click-away layer so the panel closes like a real menu. */}
                  <button
                    className="fixed inset-0 z-40 cursor-default"
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={() => setBellOpen(false)}
                  />
                  <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-[--radius-card] border border-charcoal-200 bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b border-charcoal-200 px-4 py-2.5">
                      <p className="text-sm font-semibold text-charcoal-900">Notifications</p>
                      <Badge variant={unread.length ? 'warn' : 'success'}>{unread.length} unread</Badge>
                    </div>
                    <ul className="max-h-80 divide-y divide-charcoal-200 overflow-y-auto">
                      {unread.slice(0, 5).map((n) => (
                        <li key={n.id}>
                          <NavLink
                            to={n.actionPath ?? '/app/notifications'}
                            onClick={() => setBellOpen(false)}
                            className="block px-4 py-3 transition-colors hover:bg-charcoal-50"
                          >
                            <p className="text-sm font-medium leading-snug text-charcoal-900">{n.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-charcoal-500">{n.body}</p>
                          </NavLink>
                        </li>
                      ))}
                      {unread.length === 0 ? (
                        <li className="px-4 py-6 text-center text-sm text-charcoal-500">Nothing unread.</li>
                      ) : null}
                    </ul>
                    <NavLink
                      to="/app/notifications"
                      onClick={() => setBellOpen(false)}
                      className="flex items-center justify-center gap-1.5 border-t border-charcoal-200 px-4 py-2.5 text-sm font-medium text-charcoal-700 transition-colors hover:bg-charcoal-50 hover:text-charcoal-900"
                    >
                      View all notifications <ArrowRight className="size-3.5" />
                    </NavLink>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main key={location.pathname} className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavItem({
  to, label, icon: Icon, end, onNavigate, badge,
}: {
  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean;
  onNavigate: () => void; badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            // The active item gets the yellow rail, which is the only place
            // yellow appears in the navigation — so it is unambiguous.
            ? 'bg-charcoal-800 text-white shadow-[inset_3px_0_0_0_var(--color-yellow-500)]'
            : 'text-charcoal-300 hover:bg-charcoal-800/60 hover:text-white',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="rounded-full bg-yellow-500 px-1.5 text-[10px] font-bold text-charcoal-900">{badge}</span>
      ) : null}
    </NavLink>
  );
}

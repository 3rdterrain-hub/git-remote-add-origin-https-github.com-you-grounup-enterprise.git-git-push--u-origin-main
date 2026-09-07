import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calculator, FileStack, HardHat, Users, Library,
  BarChart3, Settings, CreditCard, Menu, X, Bell, Search, ChevronDown, Bot,
  FileSignature, ArrowRight, CalendarDays, Truck, Users2, ShoppingCart, Banknote, ShieldAlert,
  Mountain, Gavel, Network, KeyRound, Ruler, SlidersHorizontal,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { Logo } from './logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { COMPANY, USER } from '@/data/demo';
import { AI_FINDINGS } from '@/data/operations';
import { NOTIFICATIONS } from '@/data/field';
import { search, KIND_LABEL, type SearchHit } from '@/lib/search';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@/lib/data/query';
import {
  loadMemberships, loadMySuspension, loadMyPaymentProblem, loadMyAnnouncements,
  dismissAnnouncement, loadMyNotifications, markNotificationRead,
  useAuthState,
} from '@/lib/data/session';
import {
  loadNavPreference, applyNavOrder, DEFAULT_NAV, type NavPreference,
} from '@/lib/data/preferences';
import { CustomizeNavDialog, type NavChoice } from './customize-nav';
import { loadBlockedCount } from '@/lib/data/dashboard';

/**
 * Every screen the application has, in the order it ships in.
 *
 * A person's saved arrangement refers to these by `to`, which is stable, unique
 * and already the thing the router knows the screen by — a separate key would
 * be a second name for one thing and would drift from the route the first time
 * somebody moved a page.
 */
/**
 * The order the groups read in: the work of winning a job, then doing it, then
 * being paid for it, then the records all three draw on.
 */
const GROUPS = ['', 'Winning work', 'Doing the work', 'Getting paid', 'Reference',
                'Administration'] as const;
type Group = (typeof GROUPS)[number];

/**
 * Every screen, and which part of the job it belongs to.
 *
 * Grouped because twenty-one items in one column is a list nobody reads — the
 * operator console has been grouped since it was built and is markedly easier
 * to find anything in. Takeoff sits beside the Estimator because it is a phase
 * of estimating rather than a department: a measurement exists to become a
 * quantity on a line.
 *
 * What it is *not* is a sub-screen of the Estimator. A measurement belongs to a
 * drawing, not to an estimate — `applied_line_item_id` is nullable — so it can
 * be traced before any estimate exists and can feed several.
 */
const NAV: ReadonlyArray<{
  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; group: Group;
}> = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true, group: '' },

  { to: '/app/estimates', label: 'Estimator', icon: Calculator, group: 'Winning work' },
  { to: '/app/takeoff', label: 'Takeoff', icon: Ruler, group: 'Winning work' },
  { to: '/app/plans', label: 'Plans & Specs', icon: FileStack, group: 'Winning work' },
  { to: '/app/proposals', label: 'Proposals', icon: FileSignature, group: 'Winning work' },
  { to: '/app/crm', label: 'Customers', icon: Users, group: 'Winning work' },

  { to: '/app/projects', label: 'Projects', icon: HardHat, group: 'Doing the work' },
  { to: '/app/schedule', label: 'Schedule', icon: CalendarDays, group: 'Doing the work' },
  { to: '/app/fleet', label: 'Fleet', icon: Truck, group: 'Doing the work' },
  { to: '/app/workforce', label: 'Workforce', icon: Users2, group: 'Doing the work' },
  { to: '/app/procurement', label: 'Procurement', icon: ShoppingCart, group: 'Doing the work' },
  { to: '/app/safety', label: 'Safety & Quality', icon: ShieldAlert, group: 'Doing the work' },
  { to: '/app/survey', label: 'Survey & Grade', icon: Mountain, group: 'Doing the work' },

  { to: '/app/finance', label: 'Finance', icon: Banknote, group: 'Getting paid' },
  { to: '/app/claims', label: 'Claims', icon: Gavel, group: 'Getting paid' },

  { to: '/app/libraries', label: 'Master Libraries', icon: Library, group: 'Reference' },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, group: 'Reference' },
  { to: '/app/network', label: 'GrounUp Network', icon: Network, group: 'Reference' },
];

const ADMIN_NAV: ReadonlyArray<{
  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; group: Group;
}> = [
  { to: '/app/settings', label: 'Company Settings', icon: Settings, group: 'Administration' },
  { to: '/app/billing', label: 'Billing', icon: CreditCard, group: 'Administration' },
  { to: '/app/api', label: 'API Access', icon: KeyRound, group: 'Administration' },
];

export function AppShell() {
  /*
   * Signed out, every query behind this shell fails with *permission denied* —
   * row level security working exactly as intended, and the worst possible
   * thing to render. The shell used to draw itself around those errors and
   * leave somebody reading "permission denied for table estimates" when the
   * honest answer was "sign in". Where they were going is carried along, so
   * signing in returns them to it rather than to the dashboard.
   */
  const auth = useAuthState();
  const here = useLocation();

  /*
   * A signed-in person with no company sees an empty screen on every route,
   * because row level security correctly returns nothing to somebody who
   * belongs nowhere. Before migration 0059 that was every person who had ever
   * signed up. Send them somewhere they can do something about it.
   */
  const memberships = useQuery(loadMemberships, []);
  const suspensionQ = useQuery(loadMySuspension, []);
  const suspension = suspensionQ.status === 'ready' ? suspensionQ.data : null;
  const paymentQ = useQuery(loadMyPaymentProblem, []);
  const payment = paymentQ.status === 'ready' ? paymentQ.data : null;
  const announcementsQ = useQuery(loadMyAnnouncements, []);
  const announcements = announcementsQ.status === 'ready' ? announcementsQ.data : [];
  const [cleared, setCleared] = useState<string[]>([]);

  /*
   * Cleared locally as well as in the database, so the banner goes the moment
   * it is dismissed rather than on the next refetch. The database is still the
   * record — this only avoids a banner that lingers after being told to go.
   */
  async function clearAnnouncement(id: string) {
    setCleared((seen) => [...seen, id]);
    if (!supabase) return;
    await dismissAnnouncement(supabase, id).catch(() => {
      // It failed; put it back rather than pretending it cleared.
      setCleared((seen) => seen.filter((x) => x !== id));
    });
  }

  const [open, setOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);

  /*
   * The bar, narrowed to icons. Remembered per browser, because a person who
   * works from a laptop wants the room back every day rather than once — and
   * guarded, because a private window throws on storage rather than returning
   * nothing.
   */
  const [iconsOnly, setIconsOnly] = useState(() => {
    try { return window.localStorage.getItem('grounup.nav.iconsOnly') === 'yes'; }
    catch { return false; }
  });
  const narrow = (next: boolean) => {
    setIconsOnly(next);
    try { window.localStorage.setItem('grounup.nav.iconsOnly', next ? 'yes' : 'no'); }
    catch { /* a bar that cannot be remembered still collapses */ }
  };

  /*
   * The arrangement, read from the profile and held here so a save takes effect
   * without a round trip. Until it has loaded the shipped order is shown, which
   * is the right thing to be wrong with: every screen is present and in a
   * sensible order, rather than an empty bar that fills in a moment later.
   */
  const navPrefQ = useQuery(loadNavPreference, []);
  const [navOverride, setNavOverride] = useState<NavPreference | null>(null);
  const navPref = navOverride
    ?? (navPrefQ.status === 'ready' ? navPrefQ.data : DEFAULT_NAV);

  const withKeys = <T extends { to: string }>(items: readonly T[]) =>
    items.map((i) => ({ ...i, key: i.to }));
  const ordered = applyNavOrder([...withKeys(NAV), ...withKeys(ADMIN_NAV)], navPref);
  /*
   * Bucketed after ordering, so a person's arrangement holds inside each group
   * and the groups themselves stay put. Reordering across a boundary would
   * scatter the headings, which is why the arrange dialog moves within a group.
   */
  const sections = GROUPS
    .map((g) => [g, ordered.filter((i) => i.group === g)] as const)
    .filter(([, items]) => items.length > 0);
  const choices: NavChoice[] = [...withKeys(NAV), ...withKeys(ADMIN_NAV)]
    .map(({ key, label, icon, group }) => ({ key, label, icon, group }));
  const onTop = navPref.placement === 'top';
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const pendingFindings = AI_FINDINGS.filter((f) => f.state === 'proposed').length;

  /*
   * The bell read a fixture: "3 unread" in every signed-in person's header and
   * five sample notices behind it, whoever they were. With no workspace behind
   * the build it still shows the sample set, which is the honest thing to show
   * somebody who has none — but it never shows them to somebody who does.
   */
  const notificationsQ = useQuery(loadMyNotifications, []);
  const notifications = notificationsQ.status === 'ready'
    ? notificationsQ.data
    : notificationsQ.status === 'demonstration'
      ? NOTIFICATIONS.map((n) => ({
          id: n.id, category: n.category, severity: 'info' as const,
          title: n.title, body: n.body, actionPath: n.actionPath ?? null,
          actionLabel: null, readAt: n.readAt ?? null, createdAt: n.createdAt,
        }))
      : [];
  const unread = notifications.filter((n) => !n.readAt);

  /*
   * How many of the caller's own estimates the engine has not cleared. Counted
   * rather than fetched in full: the header needs a number, and the list lives
   * on the estimator screen.
   */
  const blockedQ = useQuery(loadBlockedCount, []);
  const blockedCount = blockedQ.status === 'ready' ? blockedQ.data : 0;

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

  if (auth === 'checking') {
    return (
      <div className="flex min-h-full items-center justify-center" role="status" aria-live="polite">
        <span className="size-6 animate-spin rounded-full border-2 border-charcoal-200 border-t-yellow-500" />
        <span className="sr-only">Checking your session</span>
      </div>
    );
  }
  if (auth === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: here.pathname + here.search }} />;
  }

  if (memberships.status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center" role="status" aria-live="polite">
        <span className="size-6 animate-spin rounded-full border-2 border-charcoal-200 border-t-yellow-500" />
        <span className="sr-only">Loading your workspace</span>
      </div>
    );
  }
  if (memberships.status === 'ready' && memberships.data.length === 0) {
    return <Navigate to="/welcome" replace />;
  }

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

      {/*
        * On top, the sidebar still exists — it is the mobile drawer. A phone has
        * no room for eighteen items across, so the placement preference governs
        * the desktop layout and the drawer is what a narrow screen always gets.
        */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-charcoal-900 transition-all',
          /* Narrow only where there is a pointer to hover with; the phone
             drawer is always full width, because a tooltip is no use there. */
          iconsOnly ? 'w-64 lg:w-16' : 'w-64',
          onTop ? 'lg:hidden' : 'lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className={cn(
          'flex h-16 shrink-0 items-center border-b border-charcoal-800',
          iconsOnly ? 'justify-center px-2 lg:justify-center' : 'justify-between px-4')}>
          <NavLink to="/app" onClick={() => setOpen(false)}
            className={iconsOnly ? 'lg:hidden' : undefined}>
            <Logo subdued />
          </NavLink>
          <button
            onClick={() => narrow(!iconsOnly)}
            title={iconsOnly ? 'Widen the bar' : 'Narrow the bar to icons'}
            aria-label={iconsOnly ? 'Widen the navigation' : 'Narrow the navigation to icons'}
            aria-pressed={iconsOnly}
            className="hidden rounded-md p-1.5 text-charcoal-400 hover:bg-charcoal-800
                       hover:text-white lg:block">
            {iconsOnly ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
          <Button variant="ghost" size="icon" className="text-charcoal-400 hover:bg-charcoal-800 lg:hidden" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>

        <div className={cn('border-b border-charcoal-800 py-3', iconsOnly ? 'px-2' : 'px-4')}>
          <button
            title={iconsOnly ? COMPANY.name : undefined}
            className={cn(
              'flex w-full items-center rounded-md py-1.5 text-left transition-colors hover:bg-charcoal-800',
              iconsOnly ? 'justify-center px-0' : 'justify-between px-2')}>
            {iconsOnly ? (
              <span className="flex size-8 items-center justify-center rounded-md bg-charcoal-800
                               text-xs font-bold text-white">
                {COMPANY.name.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">{COMPANY.name}</span>
                  <span className="block text-xs text-charcoal-400">{COMPANY.city}, {COMPANY.state} · {COMPANY.planName}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-charcoal-500" />
              </>
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {sections.map(([group, items]) => (
            <div key={group || 'top'}>
              {group ? (
                iconsOnly ? (
                  <div className="mx-2 my-2 border-t border-charcoal-800 lg:block" aria-hidden />
                ) : (
                  <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase
                                tracking-[0.14em] text-charcoal-500">
                    {group}
                  </p>
                )
              ) : null}
              {items.map(({ key, group: _g, ...item }) => (
                <NavItem key={key} {...item} iconsOnly={iconsOnly}
                  onNavigate={() => setOpen(false)}
                  badge={item.label === 'Plans & Specs' && pendingFindings
                    ? pendingFindings : undefined} />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-charcoal-800 p-3">
          {/*
            * Pinned rather than left at the end of the list. With twenty-two
            * items the list scrolls, and a control that lives past the fold is
            * a control nobody finds.
            */}
          <button
            onClick={() => { setCustomizing(true); setOpen(false); }}
            title={iconsOnly ? 'Arrange this bar' : undefined}
            aria-label={iconsOnly ? 'Arrange this bar' : undefined}
            className={cn(
              'mb-1 flex w-full items-center rounded-md py-2 text-sm font-medium',
              'text-charcoal-400 transition-colors hover:bg-charcoal-800/60 hover:text-white',
              iconsOnly ? 'justify-center px-0' : 'gap-3 px-2')}>
            <SlidersHorizontal className="size-4 shrink-0" />
            {iconsOnly ? null : <span className="flex-1 text-left">Arrange this bar</span>}
          </button>
          <div className={cn('flex items-center rounded-md py-2',
            iconsOnly ? 'justify-center px-0' : 'gap-3 px-2')}
            title={iconsOnly ? USER.name : undefined}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-charcoal-900">
              {USER.name.split(' ').map((n) => n[0]).join('')}
            </span>
            {iconsOnly ? null : (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{USER.name}</span>
                <span className="block truncate text-xs text-charcoal-400">{USER.role}</span>
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-charcoal-200 bg-white px-4 lg:px-6">
          <Button variant="ghost" size="icon" className={onTop ? '' : 'lg:hidden'}
            onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>

          {/* The logo comes up here when the bar does, so it is still the
              first thing on the page rather than disappearing with the rail. */}
          {onTop ? (
            <NavLink to="/app" className="hidden shrink-0 lg:block"><Logo /></NavLink>
          ) : null}

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
            {/*
              * The caller's own count, not a sample estimate's number. This
              * read "EST-2026-0184 blocked from issue" in every signed-in
              * person's header regardless of whose workspace it was, which is
              * the platform asserting something about their data that came
              * from a fixture.
              */}
            {blockedCount > 0 ? (
              <NavLink to="/app/estimates" className="hidden sm:inline-flex">
                <Badge variant="danger">
                  {blockedCount} blocked from issue
                </Badge>
              </NavLink>
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
                            onClick={() => {
                              setBellOpen(false);
                              // Opening one is reading it. Failing to record
                              // that is not worth interrupting them over.
                              if (supabase) {
                                markNotificationRead(supabase, n.id)
                                  .then(() => notificationsQ.refetch())
                                  .catch(() => undefined);
                              }
                            }}
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

        {/*
          * The bar across the top. It scrolls sideways rather than wrapping,
          * because a navigation whose height changes with the window moves the
          * page under the reader every time they resize it.
          */}
        {onTop ? (
          <nav className="sticky top-16 z-10 hidden shrink-0 items-center gap-1 overflow-x-auto
                          border-b border-charcoal-200 bg-charcoal-900 px-3 py-1.5 lg:flex">
            {sections.flatMap(([group, items], i) => [
              // A divider rather than a heading: a bar running across has no
              // room for five labels, and the grouping is still worth seeing.
              ...(i > 0 && group
                ? [<span key={`sep-${group}`} aria-hidden="true"
                    className="mx-1 h-5 w-px shrink-0 bg-charcoal-700" />]
                : []),
              ...items.map(({ key, group: _g, ...item }) => (
                <TopNavItem key={key} {...item}
                  badge={item.label === 'Plans & Specs' && pendingFindings
                    ? pendingFindings : undefined} />
              )),
            ])}
            <button onClick={() => setCustomizing(true)}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5
                         text-sm font-medium text-charcoal-400 transition-colors
                         hover:bg-charcoal-800/60 hover:text-white"
              aria-label="Arrange this bar">
              <SlidersHorizontal className="size-4" />
            </button>
          </nav>
        ) : null}

        <main key={location.pathname} className="min-w-0 flex-1 p-4 lg:p-6">
          {/*
            * Said here rather than discovered on a refusal. Somebody who spends
            * a morning on an estimate and only then learns their account is
            * read-only has lost the morning, and the message exists to be read
            * before that rather than after.
            */}
          {/*
            * What the platform has to say, and what the reader can make go
            * away. Above the billing warnings, which are about them
            * specifically and stay until they are fixed.
            */}
          {announcements.filter((a) => !cleared.includes(a.id)).map((a) => (
            <div key={a.id}
              className="mb-3 flex items-start justify-between gap-3 rounded-[--radius-card]
                         border border-charcoal-200 bg-charcoal-50 p-4">
              <div className="min-w-0">
                <p className="font-medium text-charcoal-900">{a.title}</p>
                <p className="mt-0.5 text-sm text-charcoal-700">{a.body}</p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0"
                onClick={() => clearAnnouncement(a.id)}>
                Dismiss
              </Button>
            </div>
          ))}

          {/*
            * A card that is being refused, said before access is affected
            * rather than on the day it goes. Usually an expired card, and the
            * customer has no way of knowing.
            */}
          {payment && !suspension ? (
            <div className="mb-5 rounded-[--radius-card] border border-warn-300
                            bg-warn-50 p-4">
              <p className="flex items-center gap-2 font-medium text-warn-800">
                <ShieldAlert className="size-4" /> {payment.whatHappened}
              </p>
              <p className="mt-1 text-sm text-warn-700">
                {payment.stripeGaveUp
                  ? 'We have stopped retrying. Your subscription will end unless it is paid.'
                  : 'We will try again automatically, but updating the card now avoids any interruption.'}
              </p>
              {payment.hostedInvoiceUrl ? (
                <a href={payment.hostedInvoiceUrl} target="_blank" rel="noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-warn-800 underline">
                  Pay it now
                </a>
              ) : null}
            </div>
          ) : null}

          {suspension ? (
            <div className="mb-5 rounded-[--radius-card] border border-danger-300
                            bg-danger-50 p-4">
              <p className="flex items-center gap-2 font-medium text-danger-800">
                <ShieldAlert className="size-4" /> This account is read-only
              </p>
              <p className="mt-1 text-sm text-danger-700">{suspension.customerMessage}</p>
              <p className="mt-1 text-xs text-danger-600">
                Everything you have made is still here and can be opened, printed and
                exported. Nothing has been deleted.
              </p>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      <CustomizeNavDialog
        open={customizing}
        onOpenChange={setCustomizing}
        items={choices}
        value={navPref}
        onSaved={setNavOverride}
      />
    </div>
  );
}

/** The same item, laid out for a bar that runs across rather than down. */
function TopNavItem({ to, label, icon: Icon, end, badge }: {
  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          isActive
            // A rail underneath rather than down the left, which is the same
            // idea turned through ninety degrees along with everything else.
            ? 'bg-charcoal-800 text-white shadow-[inset_0_-3px_0_0_var(--color-yellow-500)]'
            : 'text-charcoal-300 hover:bg-charcoal-800/60 hover:text-white',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
      {badge ? (
        <span className="rounded-full bg-yellow-500 px-1.5 text-[10px] font-bold text-charcoal-900">
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function NavItem({
  to, label, icon: Icon, end, onNavigate, badge, iconsOnly = false,
}: {
  to: string; label: string; icon: typeof LayoutDashboard; end?: boolean;
  onNavigate: () => void; badge?: number;
  /** Narrowed to the icon. The label becomes the tooltip and the accessible name. */
  iconsOnly?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={iconsOnly ? label : undefined}
      aria-label={iconsOnly ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center rounded-md py-2 text-sm font-medium transition-colors',
          iconsOnly ? 'justify-center px-2' : 'gap-3 px-3',
          isActive
            // The active item gets the yellow rail, which is the only place
            // yellow appears in the navigation — so it is unambiguous.
            ? 'bg-charcoal-800 text-white shadow-[inset_3px_0_0_0_var(--color-yellow-500)]'
            : 'text-charcoal-300 hover:bg-charcoal-800/60 hover:text-white',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {iconsOnly ? null : <span className="flex-1">{label}</span>}
      {badge ? (
        <span className={cn(
          'rounded-full bg-yellow-500 text-[10px] font-bold text-charcoal-900',
          iconsOnly ? 'absolute ml-6 -mt-4 px-1' : 'px-1.5')}>{badge}</span>
      ) : null}
    </NavLink>
  );
}

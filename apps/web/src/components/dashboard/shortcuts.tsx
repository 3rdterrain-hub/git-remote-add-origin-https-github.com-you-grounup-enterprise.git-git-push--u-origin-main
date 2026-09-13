/**
 * Where to go next, on the first screen of the day.
 *
 * A platform with eighteen sections in its toolbar asks somebody to remember
 * which of the eighteen holds the thing they are about to do. This is the
 * shortcut: the two or three things a contractor starts most mornings, then
 * every section, one click from the screen they already have open.
 *
 * Everything here is a link. That is the point — a shortcut panel of buttons
 * that do not go anywhere would be the same defect this platform has produced
 * repeatedly, and it would be on the first screen. Where an action needs a
 * dialog, the link opens the screen that owns the dialog rather than trying to
 * reach into it, so nothing here can fall out of step with the screen it names.
 */
import { Link } from 'react-router-dom';
import {
  Calculator, HardHat, AlarmClock, UserPlus, Truck, FileSignature, ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { NAV, ADMIN_NAV } from '@/components/layout/app-shell';
import { cn } from '@/lib/utils';

/**
 * The handful of things a working day starts with.
 *
 * Each names the permission it needs, so an estimator is not offered "Add
 * someone to the crew" and a foreman is not offered a new bid. The list is
 * short on purpose: a panel of twenty shortcuts is a second toolbar, and the
 * second half of it never gets read.
 */
const START = [
  {
    to: '/app/estimates', label: 'New estimate', hint: 'Price a job',
    icon: Calculator, permission: 'estimates.write',
  },
  {
    to: '/clock', label: 'Clock in', hint: 'Punch at the kiosk',
    icon: AlarmClock, permission: 'projects.read',
  },
  {
    to: '/app/projects', label: 'Open a project', hint: 'Daily report, RFI, change order',
    icon: HardHat, permission: 'projects.read',
  },
  {
    to: '/app/workforce', label: 'Add someone', hint: 'So they can be scheduled and paid',
    icon: UserPlus, permission: 'hr.write',
  },
  {
    to: '/app/fleet', label: 'Add a machine', hint: 'And what it is estimated at',
    icon: Truck, permission: 'fleet.write',
  },
  {
    to: '/app/proposals', label: 'Send a proposal', hint: 'What the customer receives',
    icon: FileSignature, permission: 'estimates.write',
  },
] as const;

export function ShortcutsPanel({ can }: { can: (permission: string) => boolean }) {
  const start = START.filter((s) => can(s.permission));
  /* Dashboard is left out: this panel is on it. */
  const destinations = [...NAV.filter((n) => n.to !== '/app'), ...ADMIN_NAV];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jump to</CardTitle>
        <CardDescription>
          What a day usually starts with, and every section of the platform one click away.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {start.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {start.map((s) => (
              <li key={s.label}>
                <Link to={s.to}
                  className="group flex items-center gap-3 rounded-lg border border-charcoal-200
                             p-3 transition-colors hover:border-yellow-400 hover:bg-yellow-50/60">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md
                                   bg-charcoal-100 text-charcoal-700 group-hover:bg-yellow-500
                                   group-hover:text-charcoal-900">
                    <s.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-charcoal-900">{s.label}</span>
                    <span className="block truncate text-xs text-charcoal-500">{s.hint}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-charcoal-300 group-hover:text-charcoal-600" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">
            Every section
          </p>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {destinations.map((n) => (
              <li key={n.to}>
                <Link to={n.to}
                  className={cn('flex items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                    'text-charcoal-700 transition-colors hover:bg-charcoal-100 hover:text-charcoal-900')}>
                  <n.icon className="size-4 shrink-0 text-charcoal-400" />
                  <span className="truncate">{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

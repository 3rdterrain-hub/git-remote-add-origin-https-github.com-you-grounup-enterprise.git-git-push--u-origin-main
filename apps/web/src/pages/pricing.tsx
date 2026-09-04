import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, ArrowRight, Loader2, ShieldCheck, Menu, X } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/misc';
import { Alert } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SiteFooter } from './landing';
import { PLANS, COMPARISON, loadPlanPrices, type Plan } from '@/data/plans';
import { callFunction, isSupabaseConfigured } from '@/lib/supabase';
import { COMPANY } from '@/data/demo';
import { cn } from '@/lib/utils';

export function PricingPage() {
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState<Plan[]>(PLANS);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { loadPlanPrices().then(setPlans).catch(() => undefined); }, []);

  /**
   * Checkout always goes through the Edge Function. The browser sends only a
   * plan id and an interval; the server resolves the actual Stripe price from
   * the governed catalog, so nothing here can influence what is charged.
   */
  async function startCheckout(planId: string) {
    setError(null);
    if (!isSupabaseConfigured) {
      setError('This build has no Stripe or Supabase project configured. Deploy the Edge Functions and set the environment variables to take payments.');
      return;
    }
    setPending(planId);
    try {
      const { url } = await callFunction<{ url: string }>('create-checkout-session', {
        companyId: COMPANY.id,
        planId,
        interval: yearly ? 'year' : 'month',
        successPath: '/app/billing',
        cancelPath: '/pricing',
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started.');
    } finally {
      setPending(null);
    }
  }

  const price = (p: Plan) => (yearly ? p.yearlyCents / 12 : p.monthlyCents) / 100;

  return (
    <div className="min-h-full bg-white">
      <header className="sticky top-0 z-40 border-b border-charcoal-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex">
            <Link to="/" className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-600 hover:bg-charcoal-100 hover:text-charcoal-900">Home</Link>
            <Link to="/#features" className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-600 hover:bg-charcoal-100 hover:text-charcoal-900">Features</Link>
            <Link to="/pricing" className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-900">Pricing</Link>
            <Link to="/login" className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-600 hover:bg-charcoal-100 hover:text-charcoal-900">Login</Link>
            <Button asChild className="ml-2"><Link to="/signup">Start Free</Link></Button>
          </nav>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation">
            {menuOpen ? <X /> : <Menu />}
          </Button>
        </div>
        {menuOpen ? (
          <div className="border-t border-charcoal-200 px-4 py-3 md:hidden">
            <Link to="/" className="block rounded-md px-3 py-2 text-sm font-medium text-charcoal-700 hover:bg-charcoal-100">Home</Link>
            <Link to="/login" className="block rounded-md px-3 py-2 text-sm font-medium text-charcoal-700 hover:bg-charcoal-100">Login</Link>
            <Button asChild className="mt-2 w-full"><Link to="/signup">Start Free</Link></Button>
          </div>
        ) : null}
      </header>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-charcoal-900 sm:text-5xl">
            Pricing that grows with the company
          </h1>
          <p className="mt-4 text-lg text-charcoal-500">
            Start with one estimator and a seeded master library. Grow into divisions, regions and
            multiple companies without changing platform.
          </p>

          <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-charcoal-200 bg-charcoal-50 px-4 py-2">
            <span className={cn('text-sm font-medium', !yearly && 'text-charcoal-900')}>Monthly</span>
            <Switch checked={yearly} onCheckedChange={setYearly} aria-label="Bill annually" />
            <span className={cn('text-sm font-medium', yearly && 'text-charcoal-900')}>Annual</span>
            <Badge variant="success" className="ml-1">Save 2 months</Badge>
          </div>
        </div>

        {error ? <Alert tone="warn" className="mx-auto mt-8 max-w-3xl">{error}</Alert> : null}

        <div className="mt-12 grid gap-6 lg:grid-cols-4">
          {plans.map((p) => (
            <Card key={p.id} className={cn('relative flex flex-col', p.highlight && 'border-yellow-500 shadow-lg ring-1 ring-yellow-500')}>
              {p.highlight ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-yellow-500 px-3 py-1 text-xs font-bold text-charcoal-900">
                  Most popular
                </span>
              ) : null}
              <CardContent className="flex flex-1 flex-col p-6">
                <h2 className="text-lg font-bold text-charcoal-900">{p.name}</h2>
                <p className="mt-1 min-h-10 text-sm text-charcoal-500">{p.tagline}</p>

                <div className="mt-5">
                  <span className="tabular text-4xl font-bold tracking-tight text-charcoal-900">
                    ${price(p).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                  <span className="ml-1 text-sm text-charcoal-500">/month</span>
                  {yearly ? (
                    <p className="mt-1 text-xs text-charcoal-500">
                      ${(p.yearlyCents / 100).toLocaleString('en-US')} billed annually
                    </p>
                  ) : null}
                </div>

                <p className="mt-2 text-sm font-medium text-charcoal-700">{p.seats}</p>

                <Button
                  className="mt-5 w-full"
                  variant={p.highlight ? 'default' : p.contactSales ? 'outline' : 'dark'}
                  disabled={pending === p.id}
                  onClick={() => (p.contactSales ? (window.location.href = 'mailto:sales@grounup.example') : startCheckout(p.id))}
                >
                  {pending === p.id ? <Loader2 className="size-4 animate-spin" /> : null}
                  {p.contactSales ? 'Contact sales' : p.trialDays ? `Start ${p.trialDays}-day trial` : 'Choose plan'}
                  {!pending && !p.contactSales ? <ArrowRight className="size-4" /> : null}
                </Button>

                <ul className="mt-6 flex-1 space-y-2.5 border-t border-charcoal-200 pt-5">
                  {p.headline.map((f) => (
                    <li key={f} className="flex gap-2 text-sm text-charcoal-700">
                      <Check className="mt-0.5 size-4 shrink-0 text-success-600" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <dl className="mt-5 space-y-1 border-t border-charcoal-200 pt-4 text-xs text-charcoal-500">
                  {Object.entries(p.limits).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="capitalize">{k}</dt>
                      <dd className="text-right font-medium text-charcoal-700">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>

        <Alert tone="neutral" className="mx-auto mt-10 max-w-3xl" icon={<ShieldCheck className="size-4" />}
          title="Paying for a feature is never a permission">
          A subscription entitles the company to a capability. Whether a given user may act on it
          is a separate question answered by their role. Both checks must pass, always.
        </Alert>
      </section>

      {/* --------------------------------------------------------- comparison */}
      <section className="border-t border-charcoal-200 bg-charcoal-50 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-charcoal-900">Compare every plan</h2>

          <div className="mt-8 overflow-hidden rounded-[--radius-card] border border-charcoal-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow className="bg-charcoal-50 hover:bg-charcoal-50">
                  <TableHead className="min-w-64">Capability</TableHead>
                  {plans.map((p) => (
                    <TableHead key={p.id} className="min-w-32 text-center">{p.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {COMPARISON.map((group) => (
                  // Fragment, not <>: the element map() returns is the list
                  // child, so the key belongs here rather than on the row inside.
                  <Fragment key={group.group}>
                    <TableRow className="bg-charcoal-900 hover:bg-charcoal-900">
                      <TableCell colSpan={plans.length + 1} className="py-2 text-xs font-semibold uppercase tracking-wide text-white">
                        {group.group}
                      </TableCell>
                    </TableRow>
                    {group.rows.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="text-sm font-medium text-charcoal-700">{row.label}</TableCell>
                        {row.values.map((v, i) => (
                          <TableCell key={i} className="text-center">
                            {typeof v === 'boolean' ? (
                              v ? <Check className="mx-auto size-4 text-success-600" />
                                : <Minus className="mx-auto size-4 text-charcoal-300" />
                            ) : (
                              <span className="tabular text-sm font-medium text-charcoal-700">{v}</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-charcoal-900">Common questions</h2>
        <dl className="mt-8 space-y-6">
          {[
            ['How is billing handled?', 'Stripe Checkout collects payment; card details never reach GrounUp. Subscription state is written only from signature-verified Stripe webhooks, so a browser redirect can never activate paid access on its own.'],
            ['What happens when a card fails?', 'A past-due account keeps working through Stripe’s dunning window rather than cutting off mid-bid. If it stays unpaid, Stripe cancels and entitlement is revoked on the verified event.'],
            ['Can we change plans mid-cycle?', 'Yes. Upgrades and downgrades are prorated. The change is applied by Stripe and takes effect in GrounUp when the verified webhook lands, not optimistically in the browser.'],
            ['Do we own our data?', 'Yes. Your estimates, libraries, production rates and job costs are yours, isolated by row level security, and exportable at any time.'],
            ['Is the master library editable?', 'The GrounUp global seed is read-only so it stays a stable benchmark. Copy any record into your own company scope and edit the copy — with full version history on the change.'],
          ].map(([q, a]) => (
            <div key={q} className="border-b border-charcoal-200 pb-6 last:border-0">
              <dt className="font-semibold text-charcoal-900">{q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-charcoal-500">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <SiteFooter />
    </div>
  );
}

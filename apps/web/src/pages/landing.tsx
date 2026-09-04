import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowRight, Calculator, FileSearch, HardHat, ShieldCheck, Menu, X,
  CheckCircle2, AlertTriangle, Layers, Building2, Wrench, Truck, Ruler,
  ClipboardCheck, LockKeyhole, History, UserCheck, Bot,
} from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { moneyCompact, percent, integer } from '@/lib/format';
import { ESTIMATE } from '@/data/demo';

const NAV_LINKS = [
  { href: '#home', label: 'Home' },
  { href: '#features', label: 'Features' },
  { href: '#about', label: 'About' },
  { href: '/pricing', label: 'Pricing', route: true },
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-full bg-white">
      {/* ---------------------------------------------------------------- nav */}
      <header className="sticky top-0 z-40 border-b border-charcoal-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="GrounUp Enterprise home"><Logo /></Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV_LINKS.map((l) =>
              l.route ? (
                <Link key={l.label} to={l.href} className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-600 transition-colors hover:bg-charcoal-100 hover:text-charcoal-900">
                  {l.label}
                </Link>
              ) : (
                <a key={l.label} href={l.href} className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-600 transition-colors hover:bg-charcoal-100 hover:text-charcoal-900">
                  {l.label}
                </a>
              ),
            )}
            <Link to="/login" className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-600 transition-colors hover:bg-charcoal-100 hover:text-charcoal-900">
              Login
            </Link>
            <Button asChild className="ml-2"><Link to="/signup">Start Building Estimates</Link></Button>
          </nav>

          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
            {menuOpen ? <X /> : <Menu />}
          </Button>
        </div>

        {menuOpen ? (
          <div className="border-t border-charcoal-200 bg-white px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {NAV_LINKS.map((l) =>
                l.route ? (
                  <Link key={l.label} to={l.href} onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-700 hover:bg-charcoal-100">{l.label}</Link>
                ) : (
                  <a key={l.label} href={l.href} onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-700 hover:bg-charcoal-100">{l.label}</a>
                ),
              )}
              <Link to="/login" onClick={() => setMenuOpen(false)} className="rounded-md px-3 py-2 text-sm font-medium text-charcoal-700 hover:bg-charcoal-100">Login</Link>
              <Button asChild className="mt-2"><Link to="/signup">Start Building Estimates</Link></Button>
            </nav>
          </div>
        ) : null}
      </header>

      {/* --------------------------------------------------------------- hero */}
      <section id="home" className="relative overflow-hidden bg-charcoal-900">
        <div className="absolute inset-0 grid-blueprint opacity-70" aria-hidden="true" />
        <div
          className="absolute -right-40 -top-40 size-[38rem] rounded-full bg-yellow-500/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <Badge variant="accent" className="mb-5 border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                <Bot className="size-3" /> Governed AI · deterministic estimating engine
              </Badge>

              <h1 className="text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Estimate Smarter.<br />
                Build Better.<br />
                <span className="text-yellow-500">Run Everything From the Ground Up.</span>
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-charcoal-300">
                GrounUp connects AI-assisted construction estimating, plan and specification
                intelligence, project operations and business management in one platform — so the
                work you do to win a job becomes the system you use to run it.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to="/signup">Start Free <ArrowRight className="size-4" /></Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-charcoal-600 bg-transparent text-white hover:bg-charcoal-800 hover:text-white">
                  <a href="#how-it-works">See How It Works</a>
                </Button>
              </div>

              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-charcoal-800 pt-6">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Master library</dt>
                  <dd className="tabular mt-1 text-xl font-bold text-white">4,671</dd>
                  <dd className="text-xs text-charcoal-400">seeded catalog records</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-500">Cost buckets</dt>
                  <dd className="tabular mt-1 text-xl font-bold text-white">10</dd>
                  <dd className="text-xs text-charcoal-400">kept separately visible</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-500">AI authority</dt>
                  <dd className="mt-1 text-xl font-bold text-white">Draft</dd>
                  <dd className="text-xs text-charcoal-400">humans approve</dd>
                </div>
              </dl>
            </div>

            <HeroPreview />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ benefits */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-charcoal-900 sm:text-4xl">
            One system, from the opportunity to the closeout
          </h2>
          <p className="mt-4 text-charcoal-500">
            Most contractors run estimating, project management and accounting as three
            disconnected systems and retype the same information into each. GrounUp keeps one
            source of truth from the first drawing to the final job cost.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <BenefitCard
            icon={<Calculator />}
            title="Build Better Estimates"
            body="Production-based labor, equipment, material, trucking, assemblies and markup calculations — with cycle-based haul analysis, crew balance and the controlling-resource check that stops a spread being priced faster than its slowest truck."
            points={[
              'Every cost bucket stays separately visible',
              'Parallel and stacked markup, with the dollar effect shown',
              'BCY, LCY and CCY never silently mixed',
            ]}
          />
          <BenefitCard
            icon={<FileSearch />}
            title="Understand Plans Faster"
            body="AI-assisted plan and specification review that surfaces quantity candidates, document conflicts, missing scope, assumptions and the evidence behind each one — every claim traced back to a sheet or a spec section."
            points={[
              'Revision comparison across addenda',
              'Conflicts raised, never silently resolved',
              'Nothing enters an estimate unapproved',
            ]}
          />
          <BenefitCard
            icon={<HardHat />}
            title="Run the Job After You Win It"
            body="Award converts the priced estimate straight into a project: schedule, crews, equipment, procurement, cost tracking and reporting all inherit the estimate, so nothing is entered twice and budget always ties back to how it was priced."
            points={[
              'Budget baseline traced to its estimate line',
              'Field production measured against the estimate',
              'Actuals become tomorrow’s production rates',
            ]}
          />
        </div>
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section id="how-it-works" className="border-y border-charcoal-200 bg-charcoal-50 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-charcoal-900 sm:text-4xl">
              AI decides what to look at. The engine decides what it costs.
            </h2>
            <p className="mt-4 text-charcoal-500">
              Asking a language model to do your estimating arithmetic is how you get a confident
              wrong number. GrounUp splits the work along the line where each side is actually good.
            </p>
          </div>

          <ol className="mt-14 grid gap-4 md:grid-cols-4">
            {[
              { n: '01', title: 'AI reads the documents', body: 'Classifies sheets, extracts scope and quantity candidates, compares revisions and finds conflicts — citing every source.' },
              { n: '02', title: 'The engine calculates', body: 'Deterministic production, crew, equipment, haul, material and markup arithmetic. Same inputs, same number, every time.' },
              { n: '03', title: 'AI explains the result', body: 'What drove the price, which assumptions it rests on, what could go wrong, and where the risk is concentrated.' },
              { n: '04', title: 'A human approves', body: 'Confidence scoring routes each line to auto-accept, estimator review, senior review or an RFI. Nothing skips the gate.' },
            ].map((s) => (
              <li key={s.n} className="relative rounded-[--radius-card] border border-charcoal-200 bg-white p-5">
                <span className="tabular text-xs font-bold text-yellow-600">{s.n}</span>
                <h3 className="mt-2 font-semibold text-charcoal-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-charcoal-500">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------- built for construction */}
      <section id="about" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-charcoal-900 sm:text-4xl">
              Built for construction, not adapted to it
            </h2>
            <p className="mt-4 text-charcoal-500">
              GrounUp understands swell and shrink, depth bands, haul cycles, crew balance and
              controlling resources — because a platform that does not understand how the work is
              actually performed can only ever store your numbers, not check them.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {[
                'Excavation', 'Earthwork', 'Heavy civil', 'Demolition', 'Utilities', 'Sitework',
                'Grading', 'Roadwork', 'Landscaping & site finishes', 'Remodeling', 'General construction',
              ].map((t) => (
                <Badge key={t} variant="outline" className="px-2.5 py-1 text-[13px]">{t}</Badge>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureRow icon={<Ruler />} title="Real takeoff mathematics" body="Trench volume from length, width and depth. Asphalt tonnage from area, thickness and mix density. Cut/fill converted before it is compared." />
            <FeatureRow icon={<Truck />} title="Cycle-based haul" body="Load, travel, dump, return and queue. Fleet sized against loader production, and the imbalance costed either way." />
            <FeatureRow icon={<Wrench />} title="Equipment rate hierarchy" body="Project quote beats company rate beats regional beats seed — and the estimate records which one won." />
            <FeatureRow icon={<Layers />} title="Assemblies that nest" body="A 12-inch storm run at 6–8 ft carries its own excavation, bedding, pipe, structures, testing, backfill and restoration." />
            <FeatureRow icon={<Building2 />} title="One company or fifty" body="Divisions, offices and regions inside a company; corporate standard libraries with local overrides above it." />
            <FeatureRow icon={<ClipboardCheck />} title="Configurable, not uncontrolled" body="Change a production rate and GrounUp records who changed it, when, from what, and which estimates use which version." />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- security */}
      <section className="bg-charcoal-900 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <Badge variant="accent" className="mb-4 border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                <ShieldCheck className="size-3" /> Security &amp; control
              </Badge>
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Your numbers are your numbers
              </h2>
              <p className="mt-4 text-charcoal-300">
                Tenant isolation is enforced in the database itself, not in application code that
                might forget. Every governed change is recorded with its prior value, its new value
                and who made it — and AI never writes to an approved record.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SecurityCard icon={<LockKeyhole />} title="Tenant isolation" body="Row level security on every table, forced, with a build gate that fails if a table is ever added without it." />
              <SecurityCard icon={<UserCheck />} title="Role-based permissions" body="Eleven roles from viewer to owner, with approval tiers, project-level scoping and segregation of duties on every approval." />
              <SecurityCard icon={<History />} title="Audit history" body="An append-only ledger that cannot be rewritten — not by a user, not by an administrator, not by a superuser." />
              <SecurityCard icon={<Bot />} title="Governed AI" body="Agents draft and recommend. They cite sources, they cannot compute an authoritative price, and they cannot accept their own findings." />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="bg-yellow-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-14 text-center sm:px-6 lg:flex-row lg:justify-between lg:px-8 lg:text-left">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-charcoal-900 sm:text-3xl">
              Start estimating this week, not next quarter
            </h2>
            <p className="mt-2 max-w-2xl text-charcoal-800">
              The master library ships seeded, so your first estimate is a workflow question rather
              than a data-entry project. Fourteen-day trial, no card required.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="dark"><Link to="/pricing">See Pricing <ArrowRight className="size-4" /></Link></Button>
            <Button asChild size="lg" variant="outline" className="border-charcoal-900/25 bg-white/70 hover:bg-white"><Link to="/signup">Start Free</Link></Button>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HeroPreview() {
  const blocked = ESTIMATE.approvalSummary.senior_review.length + ESTIMATE.approvalSummary.rfi_required.length;
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-xl border border-charcoal-700 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-charcoal-200 bg-charcoal-100 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-charcoal-300" />
          <span className="size-2.5 rounded-full bg-charcoal-300" />
          <span className="size-2.5 rounded-full bg-charcoal-300" />
          <span className="ml-2 truncate text-xs font-medium text-charcoal-500">
            {ESTIMATE.number} — {ESTIMATE.name}
          </span>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="Bid price" value={moneyCompact(ESTIMATE.bidPrice)} />
            <MiniStat label="Direct cost" value={moneyCompact(ESTIMATE.totalDirectCost)} />
            <MiniStat label="Confidence" value={`${ESTIMATE.weightedConfidence}`} tone="warn" />
          </div>

          <div className="rounded-md border border-danger-500/25 bg-danger-50 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-danger-700">
              <AlertTriangle className="size-3.5" /> RFI resolution required before final pricing
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-danger-700/80">
              {blocked} of {ESTIMATE.lines.length} lines carry a document conflict, a material
              geotechnical assumption or an unanswered question.
            </p>
          </div>

          <div className="space-y-1.5">
            {ESTIMATE.lines.slice(0, 5).map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded-md border border-charcoal-200 px-2.5 py-2">
                <span className={[
                  'size-1.5 shrink-0 rounded-full',
                  l.approval.gate === 'auto_accept' ? 'bg-success-500'
                    : l.approval.gate === 'rfi_required' ? 'bg-danger-500' : 'bg-warn-600',
                ].join(' ')} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-charcoal-700">
                  {l.description}
                </span>
                <span className="tabular shrink-0 text-[11px] font-semibold text-charcoal-900">
                  {moneyCompact(l.totalDirectCost)}
                </span>
                <span className="tabular w-8 shrink-0 text-right text-[11px] text-charcoal-400">
                  {l.confidence.score}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-charcoal-200 pt-3">
            <span className="text-[11px] text-charcoal-500">
              Contingency {percent(ESTIMATE.appliedContingency, 0)} · {integer(ESTIMATE.totalLaborHours)} labor hr
            </span>
            <span className="text-[11px] font-semibold text-charcoal-900">
              {integer(ESTIMATE.totalDurationDays)} crew-days
            </span>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-4 -left-4 hidden rounded-lg border border-charcoal-700 bg-charcoal-800 px-3.5 py-2.5 shadow-xl sm:block">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-400">Controlling resource</p>
        <p className="mt-0.5 text-sm font-bold text-white">Haul fleet · 7 trucks</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warn' }) {
  return (
    <div className="rounded-md bg-charcoal-50 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className={`tabular mt-0.5 text-base font-bold ${tone === 'warn' ? 'text-warn-700' : 'text-charcoal-900'}`}>{value}</p>
    </div>
  );
}

function BenefitCard({ icon, title, body, points }: { icon: React.ReactNode; title: string; body: string; points: string[] }) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-6">
        <span className="flex size-11 items-center justify-center rounded-lg bg-charcoal-900 text-yellow-500 [&_svg]:size-5">
          {icon}
        </span>
        <h3 className="mt-4 text-lg font-semibold text-charcoal-900">{title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-charcoal-500">{body}</p>
        <ul className="mt-4 space-y-2 border-t border-charcoal-200 pt-4">
          {points.map((p) => (
            <li key={p} className="flex gap-2 text-sm text-charcoal-700">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-600" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function FeatureRow({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-[--radius-card] border border-charcoal-200 bg-charcoal-50 p-4">
      <span className="text-yellow-600 [&_svg]:size-5">{icon}</span>
      <h3 className="mt-2.5 font-semibold text-charcoal-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-charcoal-500">{body}</p>
    </div>
  );
}

function SecurityCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-[--radius-card] border border-charcoal-700 bg-charcoal-800/60 p-4">
      <span className="text-yellow-500 [&_svg]:size-5">{icon}</span>
      <h3 className="mt-2.5 font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-charcoal-400">{body}</p>
    </div>
  );
}

export function SiteFooter() {
  const groups = [
    { title: 'Product', links: [['Features', '#features'], ['How it works', '#how-it-works'], ['Pricing', '/pricing'], ['Security', '#about']] },
    { title: 'Company', links: [['About', '#about'], ['Built for construction', '#about'], ['Contact', 'mailto:hello@grounup.example']] },
    { title: 'Support', links: [['Documentation', '#'], ['Implementation', '#'], ['Status', '#'], ['Login', '/login']] },
    { title: 'Legal', links: [['Privacy', '#'], ['Terms', '#'], ['Data processing', '#']] },
  ] as const;

  return (
    <footer className="border-t border-charcoal-200 bg-charcoal-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-charcoal-500">
              An AI-powered construction operating system for contractors who actually run the work —
              from the first drawing to the final job cost.
            </p>
          </div>
          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-charcoal-900">{g.title}</h3>
              <ul className="mt-3 space-y-2">
                {g.links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('/') ? (
                      <Link to={href} className="text-sm text-charcoal-500 transition-colors hover:text-charcoal-900">{label}</Link>
                    ) : (
                      <a href={href} className="text-sm text-charcoal-500 transition-colors hover:text-charcoal-900">{label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-charcoal-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-charcoal-400">
            © {new Date().getFullYear()} GrounUp Enterprise. Estimating figures shown are computed by the
            GrounUp engine from a demonstration project.
          </p>
          <p className="text-xs text-charcoal-400">Built for the people who run jobs in the field and the office.</p>
        </div>
      </div>
    </footer>
  );
}

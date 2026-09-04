import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, ShieldCheck, Mail, Lock, Building2 } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type Mode = 'login' | 'signup' | 'reset';

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  login: { title: 'Welcome back', subtitle: 'Sign in to your GrounUp workspace.', cta: 'Sign in' },
  signup: { title: 'Start building estimates', subtitle: 'Create your account. The master library is seeded and ready.', cta: 'Create account' },
  reset: { title: 'Reset your password', subtitle: 'We will email you a link to set a new password.', cta: 'Send reset link' },
};

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const copy = COPY[mode];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Without a configured project there is no auth service to talk to. Say so
    // plainly and open the demo rather than failing with a network error.
    if (!isSupabaseConfigured || !supabase) {
      setNotice('Supabase is not configured, so this build runs against the demonstration workspace. Opening it now.');
      setTimeout(() => navigate('/app'), 900);
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate('/app');
      } else if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({
          email, password,
          options: { data: { company_name: companyName } },
        });
        if (err) throw err;
        setNotice('Check your email to verify the account, then sign in.');
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (err) throw err;
        setNotice('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex flex-col justify-center px-4 py-12 sm:px-8 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/" className="inline-block"><Logo /></Link>

          <h1 className="mt-10 text-2xl font-bold tracking-tight text-charcoal-900">{copy.title}</h1>
          <p className="mt-1.5 text-sm text-charcoal-500">{copy.subtitle}</p>

          {!isSupabaseConfigured ? (
            <Alert tone="info" className="mt-5" icon={<ShieldCheck className="size-4" />}>
              This build has no Supabase project configured, so it runs against the demonstration
              workspace. Set <code className="font-mono text-[12px]">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono text-[12px]">VITE_SUPABASE_ANON_KEY</code> to connect real authentication.
            </Alert>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            {mode === 'signup' ? (
              <div className="space-y-1.5">
                <Label htmlFor="company">Company name</Label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                  <Input id="company" className="pl-9" placeholder="Ridgeline Excavating" value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                <Input id="email" type="email" className="pl-9" placeholder="you@yourcompany.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
            </div>

            {mode !== 'reset' ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === 'login' ? (
                    <Link to="/reset-password" className="text-xs font-medium text-charcoal-500 hover:text-charcoal-900">
                      Forgot password?
                    </Link>
                  ) : null}
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
                  <Input id="password" type="password" className="pl-9" placeholder="••••••••••••" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={mode === 'signup' ? 12 : undefined} required />
                </div>
                {mode === 'signup' ? (
                  <p className="text-xs text-charcoal-500">At least 12 characters.</p>
                ) : null}
              </div>
            ) : null}

            {error ? <Alert tone="danger">{error}</Alert> : null}
            {notice ? <Alert tone="success">{notice}</Alert> : null}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {copy.cta} {!busy ? <ArrowRight className="size-4" /> : null}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-charcoal-500">
            {mode === 'login' ? (
              <>New to GrounUp? <Link to="/signup" className="font-medium text-charcoal-900 hover:text-yellow-700">Create an account</Link></>
            ) : (
              <>Already have an account? <Link to="/login" className="font-medium text-charcoal-900 hover:text-yellow-700">Sign in</Link></>
            )}
          </p>

          <Button asChild variant="ghost" className="mt-3 w-full">
            <Link to="/app">Explore the demonstration workspace</Link>
          </Button>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-charcoal-900 lg:block">
        <div className="absolute inset-0 grid-blueprint opacity-60" aria-hidden="true" />
        <div className="relative flex h-full flex-col justify-center px-16">
          <blockquote className="max-w-md">
            <p className="text-2xl font-semibold leading-snug text-white">
              “The estimate should not stop being useful the moment you win the job.”
            </p>
            <p className="mt-5 text-sm leading-relaxed text-charcoal-400">
              GrounUp carries the priced estimate straight into the project — budget, schedule,
              crews, equipment and cost codes all inherit it. What the field actually produces then
              flows back as calibration candidates for the next estimate, so the system gets better
              at forecasting the longer you use it.
            </p>
          </blockquote>

          <dl className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-charcoal-800 pt-8">
            {([
              ['Tenant isolation', 'Row level security'],
              ['Audit history', 'Append-only ledger'],
              ['AI authority', 'Draft and recommend'],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{k}</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}

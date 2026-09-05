import { useState, type FormEvent } from 'react';
import { ShieldCheck, Loader2, ArrowRight, Lock } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * The operator's own way in.
 *
 * A separate screen rather than a link tucked inside the customer application,
 * for two reasons that are not cosmetic:
 *
 *   * An operator arriving here is doing a different job. Landing them in a
 *     tenant's application first and asking them to find a console is how
 *     somebody ends up looking at the wrong company's screen.
 *   * The customer sign-in page should not advertise that a platform console
 *     exists. Nothing here is protected by that obscurity — the database
 *     refuses a non-operator whatever screen they came from — but there is no
 *     reason to publish the door either.
 *
 * The credential is the same Supabase account. There is no second identity
 * system: being an operator is a row in `platform_admins`, not a different
 * password, and that keeps one place where access is granted and revoked.
 */
export function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isSupabaseConfigured || !supabase) {
      setError('This build has no workspace behind it, so there is nothing to sign in to.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      // Deliberately a full navigation rather than a client-side hop: the
      // console reads who you are on load, and a stale session in memory is
      // the one thing that would make it show the wrong answer.
      window.location.href = '/admin';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That sign-in did not work.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-charcoal-900 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Logo className="text-white" />
          <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-xs font-medium text-yellow-400">
            Operator
          </span>
        </div>

        <div className="rounded-[--radius-card] border border-charcoal-700 bg-charcoal-800 p-6">
          <h1 className="text-lg font-semibold text-white">Platform console</h1>
          <p className="mt-1 text-sm text-charcoal-300">
            For the people who run GrounUp, not the people who use it.
          </p>

          {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-charcoal-200">Email</Label>
              <Input id="admin-email" type="email" value={email} autoComplete="username"
                className="bg-charcoal-900 text-white"
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password" className="text-charcoal-200">Password</Label>
              <Input id="admin-password" type="password" value={password}
                autoComplete="current-password" className="bg-charcoal-900 text-white"
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy || !email || !password}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              Sign in
            </Button>
          </form>

          <p className="mt-5 flex items-start gap-2 border-t border-charcoal-700 pt-4 text-xs text-charcoal-400">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Signing in here does not make you an operator. Being one is a row in the
              database, granted deliberately and revocable in one place — so this screen
              shows an ordinary account exactly nothing.
            </span>
          </p>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-charcoal-500">
          <ShieldCheck className="size-3.5" />
          An operator sees how companies are doing, never what is in them.
        </p>
      </div>
    </div>
  );
}

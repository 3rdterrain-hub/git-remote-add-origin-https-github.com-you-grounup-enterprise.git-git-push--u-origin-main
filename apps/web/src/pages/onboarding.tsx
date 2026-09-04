import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Building2, Check } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useQuery } from '@/lib/data/query';
import { loadMemberships, createCompany } from '@/lib/data/session';
import { LoadingState, ErrorState } from '@/components/data-state';

/**
 * The step that was missing between signing up and using the platform.
 *
 * `app.provision_company()` has existed since migration 0011 and nothing
 * outside the test suite had ever called it. So the real path ended with an
 * auth user and a profile: no company, no membership, no role, and row level
 * security correctly showing that person an empty application forever. The
 * sign-up form even collected a company name — into `raw_user_meta_data`, where
 * nothing read it.
 *
 * One field, because one field is all the database needs. The slug, the owner
 * membership, the default pricing profile with its overhead, profit and
 * contingency components, and the bounded trial are all settled server-side in
 * one transaction. A half-provisioned tenant is worse than none, so there is no
 * multi-step wizard here to fail in the middle of.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const memberships = useQuery(loadMemberships, []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // The name the sign-up form collected, finally used for something.
  useEffect(() => {
    if (prefilled || !isSupabaseConfigured || !supabase) return;
    let canceled = false;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { company_name?: string } | undefined;
      if (!canceled && meta?.company_name && !name) {
        setName(meta.company_name);
        setPrefilled(true);
      }
    });
    return () => { canceled = true; };
  }, [prefilled, name]);

  // Nothing to do here without a workspace, and nothing to do here for somebody
  // who already has one.
  if (memberships.status === 'demonstration') return <Navigate to="/app" replace />;
  if (memberships.status === 'loading') {
    return <LoadingState label="Checking your workspace" />;
  }
  if (memberships.status === 'error') {
    return <ErrorState message={memberships.message} onRetry={memberships.refetch} />;
  }
  if (memberships.data.length > 0) return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!supabase) return;
    setBusy(true);
    try {
      await createCompany(supabase, name.trim());
      // A fresh read rather than an optimistic hop: the shell decides where a
      // person may go from their memberships, and it should be reading the real
      // ones by the time it does.
      memberships.refetch();
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The workspace could not be created. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const valid = name.trim().length >= 2;

  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-12 sm:px-8">
      <div className="mx-auto w-full max-w-md">
        <Logo />

        <h1 className="mt-10 text-2xl font-bold tracking-tight text-charcoal-900">
          Name your company
        </h1>
        <p className="mt-1.5 text-sm text-charcoal-500">
          This creates your workspace. You are its owner, and everything in it is yours alone —
          no other company on this platform can see a single record of it.
        </p>

        {error ? <Alert tone="danger" className="mt-5">{error}</Alert> : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="company">Company name</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-charcoal-400" />
              <Input id="company" value={name} autoFocus className="pl-9"
                placeholder="Ridgeline Construction"
                onChange={(e) => setName(e.target.value)} />
            </div>
            <p className="text-xs text-charcoal-500">
              You can change this later. The web address it produces is set once.
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={!valid || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {busy ? 'Creating your workspace' : 'Create workspace'}
          </Button>
        </form>

        <div className="mt-8 rounded-[--radius-card] border border-charcoal-200 bg-charcoal-50/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">
            What you get immediately
          </p>
          <ul className="mt-2.5 space-y-1.5 text-sm text-charcoal-700">
            {[
              'The full master library — services, assemblies, production rates and equipment',
              'A default pricing profile with overhead, profit and contingency',
              'Owner permissions, and a trial that expires rather than running forever',
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

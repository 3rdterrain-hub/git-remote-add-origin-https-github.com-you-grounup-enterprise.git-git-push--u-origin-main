import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

/**
 * Where a provider sends somebody back to.
 *
 * It exists so there is a place to wait. Without it the redirect lands on a
 * protected page during the instant before the token has been exchanged for a
 * session, that page decides nobody is signed in, and somebody who just
 * authorized successfully is bounced to the login screen — which reads as a
 * failure and is not one.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { navigate('/login', { replace: true }); return; }

    /*
     * A provider can also come back with a refusal — somebody pressed cancel,
     * or the account is not permitted. That arrives in the URL rather than as
     * a thrown error, and saying so is better than a spinner that never stops.
     */
    const params = new URLSearchParams(
      window.location.hash.replace(/^#/, '') || window.location.search);
    const denied = params.get('error_description') ?? params.get('error');
    if (denied) { setError(denied); return; }

    let canceled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (canceled) return;
      if (data.session) { navigate('/app', { replace: true }); return; }
      // The session arrives a moment later on some providers.
      const { data: sub } = supabase!.auth.onAuthStateChange((_event, session) => {
        if (session) { sub.subscription.unsubscribe(); navigate('/app', { replace: true }); }
      });
      setTimeout(() => {
        if (canceled) return;
        sub.subscription.unsubscribe();
        setError('That sign-in did not complete. Try again, or use your email address.');
      }, 8000);
    });
    return () => { canceled = true; };
  }, [navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-10">
        <Alert tone="danger" title="That did not finish">{error}</Alert>
        <Button onClick={() => navigate('/login', { replace: true })}>
          Back to signing in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center p-10"
      role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-charcoal-400" />
      <span className="ml-3 text-sm text-charcoal-600">Finishing sign-in</span>
    </div>
  );
}

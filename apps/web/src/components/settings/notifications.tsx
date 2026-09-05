import { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';
import { useQuery } from '@/lib/data/query';
import { loadNotificationSettings, setNotificationPreference } from '@/lib/data/session';
import { LoadingState, ErrorState } from '@/components/data-state';
import { supabase } from '@/lib/supabase';

/**
 * What reaches you, and how.
 *
 * The screen the announcement email points at. Before this it did not exist,
 * so "you can switch these off under Settings, Notifications" was an
 * instruction that led nowhere — which for bulk email is the one part that is
 * not merely rude.
 *
 * The categories a person cannot switch off are shown rather than hidden. A
 * list that quietly omitted them would read as a shorter list rather than an
 * honest one, and somebody would reasonably conclude they had turned everything
 * off and then be surprised by a message about their card.
 */
export function NotificationSettings() {
  const settingsQ = useQuery(loadNotificationSettings, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, { inApp: boolean; email: boolean }>>({});

  const settings = settingsQ.status === 'ready' ? settingsQ.data : [];
  if (settingsQ.status === 'error') {
    return <ErrorState message={settingsQ.message} onRetry={settingsQ.refetch} />;
  }
  if (settingsQ.status === 'loading') return <LoadingState label="Reading your settings" />;

  const value = (s: (typeof settings)[number]) =>
    local[s.category] ?? { inApp: s.inApp, email: s.email };

  async function change(
    s: (typeof settings)[number], field: 'inApp' | 'email', next: boolean,
  ) {
    const now = { ...value(s), [field]: next };
    setLocal((all) => ({ ...all, [s.category]: now }));
    setBusy(s.category); setError(null);
    try {
      if (!supabase) return;
      await setNotificationPreference(supabase, {
        companyId: s.companyId, category: s.category,
        inApp: now.inApp, email: now.email,
      });
    } catch (err) {
      // Put it back rather than leaving a switch showing something untrue.
      setLocal((all) => {
        const rest = { ...all };
        delete rest[s.category];
        return rest;
      });
      setError(err instanceof Error ? err.message : 'That could not be saved.');
    } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          What reaches you, and how. These are yours — changing them does not change what
          your colleagues receive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {settings.map((s) => {
          const v = value(s);
          return (
            <div key={s.category}
              className="flex flex-wrap items-start justify-between gap-4 border-b
                         border-charcoal-100 pb-3 last:border-0">
              <div className="min-w-0 max-w-xl">
                <p className="flex items-center gap-2 font-medium text-charcoal-900">
                  {s.label}
                  {!s.optional ? (
                    <Badge variant="default">
                      <Lock className="mr-1 size-3" /> Always sent
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-sm text-charcoal-500">{s.description}</p>
              </div>
              <div className="flex items-center gap-4">
                {busy === s.category ? (
                  <Loader2 className="size-4 animate-spin text-charcoal-400" />
                ) : null}
                <label className="flex items-center gap-2 text-sm text-charcoal-700">
                  <input type="checkbox" className="size-4 accent-charcoal-900"
                    checked={v.inApp} disabled={!s.optional || busy === s.category}
                    onChange={(e) => change(s, 'inApp', e.target.checked)} />
                  In the app
                </label>
                <label className="flex items-center gap-2 text-sm text-charcoal-700">
                  <input type="checkbox" className="size-4 accent-charcoal-900"
                    checked={v.email} disabled={!s.optional || busy === s.category}
                    onChange={(e) => change(s, 'email', e.target.checked)} />
                  By email
                </label>
              </div>
            </div>
          );
        })}

        <Alert tone="neutral" title="What you cannot switch off, and why">
          A declined payment, a suspension, and money going back to you are facts about your
          own account. Being able to turn those off would mean losing an account without
          ever having been told, which is not a setting worth having.
        </Alert>
      </CardContent>
    </Card>
  );
}

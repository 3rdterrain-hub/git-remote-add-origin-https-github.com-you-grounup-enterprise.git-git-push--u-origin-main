/**
 * The library a company starts from.
 *
 * The shipped catalog has services, tasks and rates, and every one of its 8,142
 * assembly components is a *task*. Not one is labor, equipment or material — so
 * picking a service tells an estimator what to do and never what it takes, and
 * the suggestion panel on the wrench comes back empty for everything.
 *
 * This installs assemblies whose components are resources: crews with real
 * classifications behind them, machines with hourly rates, and hours per unit
 * derived from a day's production. It is what makes a service suggest its own
 * build-up.
 *
 * Offered rather than applied. The rates are one excavation contractor's
 * considered figures, not a universal truth, and they arrive as company rows
 * where RULE-003 ranks them above the shipped seed and below anything quoted
 * for a project — and as `company_historical`, because nobody has measured them
 * yet.
 */
import { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { ErrorState } from '@/components/data-state';
import { messageFor } from '@/lib/data/query';
import { installStarterLibrary, type StarterLibraryResult } from '@/lib/data/library';

export function StarterLibrary({ companyId, onInstalled }: {
  companyId?: string | null;
  onInstalled?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<StarterLibraryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setBusy(true); setError(null);
    try {
      setDone(await installStarterLibrary(companyId));
      onInstalled?.();
    } catch (err) { setError(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-charcoal-500" /> Earthwork starter library
        </CardTitle>
        <CardDescription>
          Fifty-nine assemblies that carry their own crew and machines, forty-seven production
          rates, five crews and nine machines. The shipped catalog has services and rates and no
          assembly with a resource in it, which is why picking a service says what to do and never
          what it takes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {done ? (
          <Alert tone="success" icon={<CheckCircle2 className="size-4" />} title="Installed">
            {done.assemblies} assemblies with {done.components} resource components,
            {' '}{done.rates} production rates, {done.crews} crews and {done.machines} machines.
            Pick one of them on a line and the wrench will tell you what it takes.
          </Alert>
        ) : (
          <p className="text-sm text-charcoal-600">
            Installed as your own rows, so a rate here outranks the shipped benchmark and is
            outranked by anything quoted for a project. They arrive as historical rather than
            measured, because nobody has run them yet — field production is what turns the second
            into the first.
          </p>
        )}

        {error ? <ErrorState message={error} /> : null}

        <Button onClick={() => { void install(); }} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {done ? 'Install again' : 'Install the starter library'}
        </Button>
        {done ? (
          <p className="text-xs text-charcoal-500">
            Running it again matches every row on its code and updates rather than adding, so
            nothing doubles.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

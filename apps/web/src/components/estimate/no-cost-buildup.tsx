/**
 * This service has no cost build-up yet.
 *
 * Said at the moment a line is added, because the alternative is what the owner
 * actually hit: pick a service, enter 1,200 tons, press Price, and get $0.00
 * with a confidence score and no explanation.
 *
 * The cause is not a bug in the engine. `app.line_resource_suggestions` reads
 * `assembly_components` of kind labor, equipment, material or trucking, and the
 * shipped catalog contains only `task` rows — 2,545 services that describe what
 * work happens and carry nothing that costs money. So the honest thing is to
 * say it here, with the two ways forward, rather than let somebody discover it
 * from a zero.
 *
 * Deliberately not offered: a suggested price. Inventing a crew and a rate
 * would put a number nobody can reproduce against 2,545 services, and "never
 * invent a number" is the rule this platform is built on.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, Wrench, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { plural } from '@/lib/format';
import type { ServiceBuildup } from '@/lib/data/estimates';

export function NoCostBuildup({ services, onBuildUp, onSaveFromLine, saving, canWrite }: {
  /** Only the services that cannot price; an empty list renders nothing. */
  services: ServiceBuildup[];
  /** Open the wrench panel on the first line that needs building up. */
  onBuildUp?: () => void;
  /** Keep what is already on the line, for every later estimate. */
  onSaveFromLine?: () => void;
  saving?: boolean;
  canWrite: boolean;
}) {
  if (services.length === 0) return null;

  const named = services.slice(0, 3).map((s) => s.name).join(', ');
  const rest = services.length - 3;

  return (
    <Alert tone="warn" icon={<AlertTriangle className="size-4" />}
      title={`${plural(services.length, 'service')} on this estimate will price at nothing`}>
      <div className="space-y-3">
        <p>
          {named}{rest > 0 ? ` and ${plural(rest, 'other')}` : ''}
          {services.length === 1 ? ' carries' : ' carry'} the steps of the work and no crew,
          machines or materials — so the engine has nothing to compute a cost from and the
          line comes back at $0.00. The shipped catalog is like this everywhere: it names
          2,545 services and prices none of them, because a price GrounUp guessed for your
          yard would be a price you could not stand behind.
        </p>
        <p className="text-sm">
          Put the crew, machines and materials on the line in the wrench panel, then keep it:
          the service remembers, and every later estimate that picks it starts built up.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onBuildUp ? (
            <Button size="sm" variant="outline" onClick={onBuildUp} disabled={!canWrite}>
              <Wrench className="size-4" /> Build the line up
            </Button>
          ) : null}
          {onSaveFromLine ? (
            <Button size="sm" variant="outline" onClick={onSaveFromLine}
              disabled={!canWrite || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Keep this build-up in the library
            </Button>
          ) : null}
          <Link to="/app/libraries" className="text-sm text-charcoal-600 underline">
            Open the library
          </Link>
        </div>
      </div>
    </Alert>
  );
}

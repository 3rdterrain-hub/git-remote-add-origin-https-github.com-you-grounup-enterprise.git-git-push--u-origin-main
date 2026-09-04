/**
 * The three things a screen can be showing, and saying which.
 *
 * A screen reading governed data is loading it, failed to load it, or has it.
 * A screen with no Supabase project behind it is showing the demonstration
 * dataset, and that is a fourth thing which must never be mistaken for the
 * third — so it is labeled here rather than left to look like real numbers.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, FlaskConical } from 'lucide-react';
import { Alert } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="danger" icon={<AlertTriangle className="size-4" />}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        ) : null}
      </div>
    </Alert>
  );
}

/**
 * Nothing to show, said in a way that distinguishes "you have none of these
 * yet" from "something went wrong" — which an empty table alone does not.
 */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * The label on demonstration data.
 *
 * Shown wherever a screen is computing from the sample dataset because no
 * Supabase project is configured. It is deliberately not dismissible: a person
 * who has clicked it away is exactly the person who will later mistake these
 * figures for their own.
 */
export function DemonstrationNotice({ what = 'this page' }: { what?: string }) {
  return (
    <Alert tone="info" icon={<FlaskConical className="size-4" />}>
      <span>
        <Badge variant="outline" className="mr-2 align-middle">Demonstration data</Badge>
        The figures on {what} come from a sample project, not from a workspace. Connect a
        Supabase project to see your own.
      </span>
    </Alert>
  );
}

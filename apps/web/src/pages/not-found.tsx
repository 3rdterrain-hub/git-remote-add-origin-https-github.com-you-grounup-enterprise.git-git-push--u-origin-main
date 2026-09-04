import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/layout/logo';

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-charcoal-50 px-4 text-center">
      <Logo />
      <div className="space-y-2">
        <p className="tabular text-5xl font-bold text-charcoal-900">404</p>
        <p className="text-charcoal-500">That page is not on the plan set.</p>
      </div>
      <div className="flex gap-3">
        <Button asChild variant="outline"><Link to="/">Back to home</Link></Button>
        <Button asChild><Link to="/app">Open the dashboard</Link></Button>
      </div>
    </div>
  );
}

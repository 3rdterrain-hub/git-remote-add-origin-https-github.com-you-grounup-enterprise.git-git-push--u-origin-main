/**
 * The form on your own website, and where your leads are coming from.
 *
 * Migration 0065 built a working public intake and gave it no door: a company
 * could not create a form, could not see its key, and could not tell which of
 * three forms was bringing work in. This is the door.
 *
 * The snippet is shown in full rather than behind a "get code" button, because
 * the whole value of it is that a contractor can see it is an ordinary HTML
 * form with their form key in it. What it carries is public by design — the
 * form key, which addresses a form and can be switched off, and the anon key,
 * which may call exactly one function in the schema and read nothing at all.
 */
import { useState } from 'react';
import { Check, Copy, Globe, Loader2, Plus, Power, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState, ErrorState, EmptyState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadLeadIntakeForms, loadLeadSources, createLeadIntakeForm, setLeadFormActive,
  addLeadSource, embedSnippet, intakeUrl,
  type LeadIntakeForm,
} from '@/lib/data/lead-forms';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A copy button that says it worked; a silent copy looks like a broken one. */
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline" size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}>
      {copied ? <Check className="size-4 text-ok-600" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function FormCard({ form, onChanged }: { form: LeadIntakeForm; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const snippet = embedSnippet(form);

  return (
    <Card collapseKey={`lead-form-${form.id}`}>
      <CardHeader>
        <CardTitle>
          <span className="flex flex-wrap items-center gap-2">
            <Globe className="size-4 text-charcoal-500" /> {form.name}
            <Badge variant="outline" className={cn('border',
              form.isActive
                ? 'bg-ok-100 text-ok-800 border-ok-200'
                : 'bg-charcoal-100 text-charcoal-600 border-charcoal-200')}>
              {form.isActive ? 'Live' : 'Off'}
            </Badge>
          </span>
        </CardTitle>
        <CardDescription>
          Filed as <strong>{form.sourceLabel}</strong>.{' '}
          {form.leadsTaken > 0
            ? `${plural(form.leadsTaken, 'lead')} so far.`
            : 'Nothing has come through it yet.'}
          {' '}At most {form.maxPerHourPerAddress} an hour from one sender,
          {' '}{form.maxPerHourPerForm} an hour in total.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Paste this into your website</Label>
            <div className="flex gap-2">
              <CopyButton text={snippet} label="Copy the form" />
              <Button
                variant="ghost" size="sm" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setProblem(null);
                  try { await setLeadFormActive(form.id, !form.isActive); onChanged(); }
                  catch (err) { setProblem(messageFor(err)); }
                  finally { setBusy(false); }
                }}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                {form.isActive ? 'Switch off' : 'Switch on'}
              </Button>
            </div>
          </div>
          <pre className="max-h-72 overflow-auto rounded-md border border-charcoal-200 bg-charcoal-900 p-3 text-xs leading-relaxed text-charcoal-100">
            <code>{snippet}</code>
          </pre>
          <p className="text-xs text-charcoal-500">
            Two keys are in here and both are meant to be public. The form key addresses
            this form and nothing else — switching the form off stops it working, without
            touching the leads it already brought in. The other key can call this one
            function and read nothing at all: no customers, no estimates, no prices.
          </p>
          {!form.isActive ? (
            <p className="text-xs font-medium text-warn-700">
              This form is switched off. A submission to it is answered exactly like a
              successful one and nothing is recorded — a stranger is never told which
              companies exist here.
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label>Where it posts</Label>
          <code className="block truncate rounded bg-charcoal-100 px-2 py-1 text-xs text-charcoal-700">
            {intakeUrl() || 'Not configured'}
          </code>
        </div>

        {problem ? <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p> : null}
      </CardContent>
    </Card>
  );
}

/** The sources a lead can be filed under, and how to add one. */
export function LeadSources({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const sources = useQuery(loadLeadSources, [companyId]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (sources.status === 'loading') return <LoadingState label="Reading your sources" />;
  if (sources.status === 'error') return <ErrorState message={sources.message} onRetry={sources.refetch} />;
  if (sources.status === 'demonstration') return null;

  const add = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await addLeadSource(companyId, name.trim());
      setName('');
      sources.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>What it means</TableHead>
              <TableHead className="text-right">Leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium text-charcoal-900">
                  {s.name}
                  {s.isPlatform ? null : (
                    <Badge variant="outline" className="ml-2 text-xs">yours</Badge>
                  )}
                </TableCell>
                <TableCell className="text-charcoal-600">{s.description ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-charcoal-700">
                  {s.leadsFromHere || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="new-source">Add a source</Label>
            <Input id="new-source" value={name} placeholder="Home show"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <Button size="sm" disabled={busy || name.trim().length === 0} onClick={add}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </Button>
        </div>
      ) : null}

      {problem ? <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p> : null}
    </div>
  );
}

/** The whole section, as it appears on the CRM screen. */
export function LeadFormsSection({ companyId, canEdit }: {
  companyId: string; canEdit: boolean;
}) {
  const forms = useQuery(loadLeadIntakeForms, [companyId]);
  const sources = useQuery(loadLeadSources, [companyId]);
  const [name, setName] = useState('');
  const [source, setSource] = useState('Website');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (forms.status === 'loading') return <LoadingState label="Reading your forms" />;
  if (forms.status === 'error') return <ErrorState message={forms.message} onRetry={forms.refetch} />;
  if (forms.status === 'demonstration') {
    return <EmptyState title="Connect a workspace to publish a lead form" />;
  }

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await createLeadIntakeForm(companyId, name.trim(), source);
      setName('');
      forms.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card collapseKey="lead-sources">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Tag className="size-4 text-charcoal-500" /> Where your leads come from
            </span>
          </CardTitle>
          <CardDescription>
            Every lead is filed under one of these. Add your own — the list is yours, and
            a source that is not on it is refused rather than quietly creating a fourth
            spelling of "website".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadSources companyId={companyId} canEdit={canEdit} />
        </CardContent>
      </Card>

      {canEdit ? (
        <Card collapseKey="publish-lead-form">
          <CardHeader>
            <CardTitle>Publish a form</CardTitle>
            <CardDescription>
              One form gives you one snippet to paste into your website. Somebody fills it
              in and it becomes a lead in your pipeline, filed under the source you pick.
              Run more than one — one per landing page — and you can tell which is working.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="new-form">Call it something you will recognize</Label>
                <Input id="new-form" value={name} placeholder="Contact page"
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="w-48 space-y-1">
                <Label htmlFor="new-form-source">File its leads as</Label>
                <select
                  id="new-form-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="h-9 w-full rounded-md border border-charcoal-200 bg-white px-3 text-sm">
                  {(sources.status === 'ready' ? sources.data : []).map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <Button disabled={busy || name.trim().length === 0} onClick={create}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Publish
              </Button>
            </div>
            {problem ? (
              <p role="alert" className="mt-2 text-sm font-medium text-danger-700">{problem}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-charcoal-500">
          Publishing a lead form needs the crm.write permission.
        </p>
      )}

      {forms.data.length === 0 ? (
        <EmptyState title="No lead forms yet"
          hint="Publish one and paste the snippet into your website. Nothing else is needed — no plugin, and no account for the person filling it in." />
      ) : (
        forms.data.map((f) => <FormCard key={f.id} form={f} onChanged={forms.refetch} />)
      )}
    </div>
  );
}

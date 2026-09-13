/**
 * Company profile and estimating defaults, on the company's own record.
 *
 * Entity: the row every other screen names. It carries the letterhead a
 * proposal prints, the city the forecast is fetched for, and the six estimating
 * defaults the engine falls back to when a line does not override them.
 *
 * The form is deliberately one save for the whole card rather than a save per
 * box. Address lines are entered together and a half-entered address geocodes
 * to the wrong town; the estimating defaults are read as a set by the engine,
 * and letting swell land before shrink would price a job against a mixture of
 * the old settings and the new ones.
 */
import { useEffect, useState } from 'react';
import { Building2, Sliders, Save, Loader2, CheckCircle2, CloudSun } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadCompanyProfile, saveCompanyProfile,
  type CompanyProfile, type CompanyProfileEdit,
} from '@/lib/data/company';

/** The zones a US or Canadian contractor actually works in. */
const TIMEZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona (no DST)'],
  ['America/Los_Angeles', 'Pacific'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'],
] as const;

function Field({
  label, hint, value, onChange, ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
}) {
  const id = `company-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...props} />
      {hint ? <p className="text-xs text-charcoal-500">{hint}</p> : null}
    </div>
  );
}

/** A percentage stored as a fraction, typed as a percentage. */
function PercentField({
  label, hint, value, onChange, max,
}: { label: string; hint?: string; value: number; onChange: (v: number) => void; max?: number }) {
  const id = `company-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id} type="number" step="0.1" min={0} max={max}
          value={Number.isFinite(value) ? String(Math.round(value * 1000) / 10) : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value) / 100)}
          className="pr-7"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-charcoal-500">%</span>
      </div>
      {hint ? <p className="text-xs text-charcoal-500">{hint}</p> : null}
    </div>
  );
}

export function CompanyProfileSettings({ section }: { section: 'company' | 'estimating' }) {
  const loaded = useQuery(loadCompanyProfile, []);
  const [draft, setDraft] = useState<CompanyProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === 'ready' && loaded.data) setDraft(loaded.data);
  }, [loaded.status, loaded.status === 'ready' ? loaded.data : null]);

  if (loaded.status === 'loading') return <LoadingState label="Reading your company" />;
  if (loaded.status === 'error') return <ErrorState message={loaded.message} onRetry={loaded.refetch} />;
  if (loaded.status === 'demonstration') {
    return (
      <Alert tone="info" title="Not connected">
        Company settings are read from your own company record. Connect the workspace to
        a project and this screen becomes that record.
      </Alert>
    );
  }
  if (!draft) {
    return (
      <Alert tone="warn" title="No company yet">
        You are signed in but do not belong to a company, so there is no record to change.
      </Alert>
    );
  }

  const original = loaded.status === 'ready' ? loaded.data : null;
  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  };

  /* Only what changed is sent, so a save cannot overwrite a column this form
     does not show with a stale copy of it. */
  const changes = (): CompanyProfileEdit => {
    if (!original) return {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as Array<keyof CompanyProfile>) {
      if (key === 'id') continue;
      if (JSON.stringify(draft[key]) !== JSON.stringify(original[key])) out[key] = draft[key];
    }
    return out as CompanyProfileEdit;
  };
  const dirty = Object.keys(changes()).length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await saveCompanyProfile(draft.id, changes());
      setDraft(next);
      setSaved(true);
      loaded.refetch();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <CardFooter className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-charcoal-500">
        {dirty ? 'Unsaved changes.'
          : saved ? <span className="inline-flex items-center gap-1 text-success-700"><CheckCircle2 className="size-3.5" /> Saved.</span>
          : 'Every change is attributed and auditable.'}
      </p>
      <Button onClick={save} disabled={!dirty || saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes
      </Button>
    </CardFooter>
  );

  if (section === 'estimating') {
    return (
      <div className="space-y-6">
        {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sliders className="size-4" /> Estimating defaults</CardTitle>
            <CardDescription>
              What the engine uses when a line does not say otherwise. Every one of these is
              overridable on the line that needs it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Shift hours" type="number" step="0.25" min="0.25" max="24"
              value={String(draft.defaultShiftHours)}
              onChange={(v) => set('defaultShiftHours', Number(v))}
              hint="A working day, before efficiency."
            />
            <PercentField
              label="Calendar efficiency" max={100}
              value={draft.defaultCalendarEfficiency}
              onChange={(v) => set('defaultCalendarEfficiency', v)}
              hint="The share of a day that is productive. The forecast refines this per day."
            />
            <Field
              label="Fuel price" type="number" step="0.01" min="0"
              value={String(draft.defaultFuelPrice)}
              onChange={(v) => set('defaultFuelPrice', Number(v))}
              hint="Per gallon. Fuel is its own cost bucket, never inside an equipment rate."
            />
            <PercentField
              label="Swell" value={draft.defaultSwellPercent}
              onChange={(v) => set('defaultSwellPercent', v)}
              hint="Bank to loose. Used when a material does not state its own."
            />
            <PercentField
              label="Shrink" max={99} value={draft.defaultShrinkPercent}
              onChange={(v) => set('defaultShrinkPercent', v)}
              hint="Bank to compacted."
            />
            <Field
              label="Bid rounding" type="number" step="1" min="0"
              value={String(draft.bidRoundingIncrement)}
              onChange={(v) => set('bidRoundingIncrement', Number(v))}
              hint="Round the bid price to this increment. Zero does not round."
            />
          </CardContent>
          {footer}
        </Card>
      </div>
    );
  }

  const hasPlace = Boolean((draft.city ?? '').trim() || (draft.postalCode ?? '').trim());

  return (
    <div className="space-y-6">
      {error ? <Alert tone="danger" title="That did not save">{error}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="size-4" /> Company profile</CardTitle>
          <CardDescription>Used on proposals, reports and the customer portal.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" value={draft.name} onChange={(v) => set('name', v)} />
          <Field label="Legal name" value={draft.legalName ?? ''} onChange={(v) => set('legalName', v)}
                 hint="If it differs from the trading name." />
          <Field label="Address" value={draft.addressLine1 ?? ''} onChange={(v) => set('addressLine1', v)} />
          <Field label="Address line 2" value={draft.addressLine2 ?? ''} onChange={(v) => set('addressLine2', v)} />
          <Field label="City" value={draft.city ?? ''} onChange={(v) => set('city', v)} />
          <Field label="State" value={draft.stateProvince ?? ''} onChange={(v) => set('stateProvince', v)} />
          <Field label="ZIP or postal code" value={draft.postalCode ?? ''} onChange={(v) => set('postalCode', v)} />
          <Field label="Phone" type="tel" value={draft.phone ?? ''} onChange={(v) => set('phone', v)} />
          <Field label="Email" type="email" value={draft.email ?? ''} onChange={(v) => set('email', v)} />
          <Field label="Website" value={draft.website ?? ''} onChange={(v) => set('website', v)} />
          <Field label="Tax ID" value={draft.taxId ?? ''} onChange={(v) => set('taxId', v)} />
          <div className="space-y-1.5">
            <Label htmlFor="company-timezone">Time zone</Label>
            <Select value={draft.timezone} onValueChange={(v) => set('timezone', v)}>
              <SelectTrigger id="company-timezone"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-currency">Currency</Label>
            <Select value={draft.currency} onValueChange={(v) => set('currency', v)}>
              <SelectTrigger id="company-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD — US Dollar</SelectItem>
                <SelectItem value="CAD">CAD — Canadian Dollar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        {footer}
      </Card>

      {/*
        * Terminology is one column, `companies.terminology`, and it is edited
        * here rather than on its own screen because it is part of what the
        * company is called. Three words cover the ones that appear on nearly
        * every screen; an empty box means "use ours" rather than a blank label.
        */}
      <Card>
        <CardHeader>
          <CardTitle>Terminology</CardTitle>
          <CardDescription>
            Rename what GrounUp calls things so the platform speaks your company's vocabulary
            rather than the other way round. Leave one blank to keep ours.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {(['estimate', 'customer', 'project'] as const).map((word) => (
            <Field
              key={word}
              label={`${word[0]!.toUpperCase()}${word.slice(1)} is called`}
              value={draft.terminology[word] ?? ''}
              placeholder={`${word[0]!.toUpperCase()}${word.slice(1)}`}
              onChange={(v) => {
                const next = { ...draft.terminology };
                if (v.trim()) next[word] = v;
                else delete next[word];
                set('terminology', next);
              }}
            />
          ))}
        </CardContent>
        {footer}
      </Card>

      {/*
        * Said here rather than only on the dashboard, because this is the screen
        * that fixes it. The forecast geocodes the city or the postal code, and
        * the daily verdict it produces is what the calendar efficiency above is
        * refined from.
        */}
      {!hasPlace ? (
        <Alert tone="warn" title="No forecast until this has a city">
          <span className="inline-flex items-center gap-1.5">
            <CloudSun className="size-4 shrink-0" />
            The weather panel on your dashboard is fetched for the city or ZIP above. Until
            one of them is filled in there is nowhere to report the weather for.
          </span>
        </Alert>
      ) : null}
    </div>
  );
}

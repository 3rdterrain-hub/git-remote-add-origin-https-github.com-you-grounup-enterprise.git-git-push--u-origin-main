import { useState } from 'react';
import { Loader2, Plus, X, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Switch } from '@/components/ui/misc';
import { UnitSelect } from '@/components/ui/unit-select';
import { CategorySelect } from '@/components/ui/category-select';

/**
 * Adding to the company's own library.
 *
 * The one thing this form has to be honest about is scope. A member can read
 * three tiers — the catalog GrounUp ships, a corporate standard, and their own
 * company's rows — and may write only the last. That is what keeps a shared
 * catalog worth pricing from, and it means "edit this catalog service" is not a
 * thing that happens: what happens is a new company row.
 *
 * Said before somebody types, rather than discovered when their change silently
 * does nothing.
 */
/**
 * Every value of `app.unit_code`, re-exported from the engine.
 *
 * This list used to be typed out here as well, and the two drifted the first
 * time a real materials export arrived: framing lumber in board feet, shingles
 * in squares, a solar allowance in kilowatts, and four materials nearly dropped
 * because a dropdown in a form did not know units the platform was about to
 * have. There is one list, it lives in the engine, and a governance test holds
 * it to the enum.
 */
import { UNITS } from '@grounup/engine';
export { UNITS };

export interface ServiceFormValues {
  code: string; name: string; description: string;
  category: string; subcategory: string; industry: string;
  defaultUnit: string; supportedUnits: string[];
}

export interface TaskFormValues {
  code: string; name: string; defaultUnit: string; category: string;
  productionRequired: boolean; crewRequired: boolean;
  equipmentRequired: boolean; materialRequired: boolean;
  safetyReviewRequired: boolean;
}

export function ServiceForm({ initial, busy, error, onSubmit, onCancel, title }: {
  initial?: Partial<ServiceFormValues>;
  busy: boolean; error: string | null;
  onSubmit: (v: ServiceFormValues) => void;
  onCancel: () => void;
  title: string;
}) {
  const [v, setV] = useState<ServiceFormValues>({
    code: initial?.code ?? '', name: initial?.name ?? '',
    description: initial?.description ?? '', category: initial?.category ?? '',
    subcategory: initial?.subcategory ?? '', industry: initial?.industry ?? '',
    defaultUnit: initial?.defaultUnit ?? 'LS',
    supportedUnits: initial?.supportedUnits ?? ['LS'],
  });
  const set = <K extends keyof ServiceFormValues>(k: K, x: ServiceFormValues[K]) =>
    setV((p) => ({ ...p, [k]: x }));

  const ready = v.code.trim().length > 0 && v.name.trim().length > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            Saved to your company&apos;s library. The catalog GrounUp ships is read-only for
            every company, which is what makes it worth pricing from.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Close">
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="svc-code" label="Code" value={v.code} onChange={(x) => set('code', x)}
            hint="Unique within your library." placeholder="SVC-EL-0001" />
          <div className="space-y-1.5">
            <Label htmlFor="svc-unit">Default unit</Label>
            <UnitSelect id="svc-unit" label="default unit" className="w-full"
              value={v.defaultUnit} onChange={(x) => set('defaultUnit', x)} />
          </div>
        </div>

        <Field id="svc-name" label="Name" value={v.name} onChange={(x) => set('name', x)}
          placeholder="Branch circuit rough-in, 20A" />
        <Field id="svc-desc" label="Description" value={v.description}
          onChange={(x) => set('description', x)} />

        {/*
          * Chosen rather than typed. A category is a record since migration
          * 0113 and the database refuses one that is not — which is what stops
          * "Site Work", "Sitework" and "Site work" becoming three categories
          * that every report has to reconcile. The plus adds one to your
          * company's list without leaving the form.
          */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="svc-industry">Industry</Label>
            <CategorySelect id="svc-industry" kind="industry" label="industry"
              value={v.industry} onChange={(x) => set('industry', x)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-cat">Trade or category</Label>
            <CategorySelect id="svc-cat" kind="service_category" label="service category"
              value={v.category} onChange={(x) => set('category', x)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-sub">Subcategory</Label>
            <CategorySelect id="svc-sub" kind="service_subcategory" label="subcategory"
              value={v.subcategory} onChange={(x) => set('subcategory', x)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Units this can be measured in</Label>
          <div className="flex flex-wrap gap-1.5">
            {UNITS.map((u) => {
              const on = v.supportedUnits.includes(u) || u === v.defaultUnit;
              return (
                <Button key={u} type="button" size="sm"
                  variant={on ? 'default' : 'outline'}
                  disabled={u === v.defaultUnit}
                  aria-pressed={on}
                  onClick={() => set('supportedUnits', on
                    ? v.supportedUnits.filter((x) => x !== u)
                    : [...v.supportedUnits, u])}>{u}</Button>
              );
            })}
          </div>
          <p className="text-xs text-charcoal-500">
            The default unit is always included. A service whose default is not among the
            units it supports is one nothing can price, and the database refuses it.
          </p>
        </div>

        <Button className="w-full" disabled={!ready || busy} onClick={() => onSubmit(v)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save service
        </Button>
      </CardContent>
    </Card>
  );
}

export function TaskForm({ busy, error, onSubmit, onCancel }: {
  busy: boolean; error: string | null;
  onSubmit: (v: TaskFormValues) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<TaskFormValues>({
    code: '', name: '', defaultUnit: 'LS', category: '',
    productionRequired: true, crewRequired: true, equipmentRequired: true,
    materialRequired: false, safetyReviewRequired: false,
  });
  const set = <K extends keyof TaskFormValues>(k: K, x: TaskFormValues[K]) =>
    setV((p) => ({ ...p, [k]: x }));

  const toggles: { key: keyof TaskFormValues; label: string; hint: string }[] = [
    { key: 'productionRequired', label: 'Needs a production rate',
      hint: 'How much gets done in an hour. Without one the engine cannot work out a duration.' },
    { key: 'crewRequired', label: 'Needs a crew', hint: 'Who does it.' },
    { key: 'equipmentRequired', label: 'Needs equipment', hint: 'What machine it takes.' },
    { key: 'materialRequired', label: 'Needs material', hint: 'What is installed or consumed.' },
    { key: 'safetyReviewRequired', label: 'Needs a safety review',
      hint: 'Confined space, energized work, lifts over occupied areas.' },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>New task</CardTitle>
          <CardDescription>
            A task is a unit of work a service is built from. What it requires decides what
            the estimating engine insists on before it will price a line.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Close">
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tsk-code" label="Code" value={v.code} onChange={(x) => set('code', x)}
            placeholder="TSK-EL-0001" />
          <div className="space-y-1.5">
            <Label htmlFor="tsk-unit">Unit</Label>
            <UnitSelect id="tsk-unit" label="default unit" className="w-full"
              value={v.defaultUnit} onChange={(x) => set('defaultUnit', x)} />
          </div>
        </div>
        <Field id="tsk-name" label="Name" value={v.name} onChange={(x) => set('name', x)}
          placeholder="Pull and terminate 12 AWG branch circuit" />
        <div className="space-y-1.5">
          <Label htmlFor="tsk-cat">Trade or category</Label>
          <CategorySelect id="tsk-cat" kind="task_category" label="task category"
            value={v.category} onChange={(x) => set('category', x)} />
        </div>

        <div className="space-y-2.5 border-t border-charcoal-200 pt-3">
          {toggles.map((t) => (
            <div key={String(t.key)} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-charcoal-800">{t.label}</p>
                <p className="text-xs text-charcoal-500">{t.hint}</p>
              </div>
              <Switch checked={Boolean(v[t.key])} aria-label={t.label}
                onCheckedChange={(c) => set(t.key, c as never)} />
            </div>
          ))}
        </div>

        <Button className="w-full" disabled={busy || !v.code.trim() || !v.name.trim()}
          onClick={() => onSubmit(v)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Save task
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, value, onChange, hint, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  hint?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="text-xs text-charcoal-500">{hint}</p> : null}
    </div>
  );
}

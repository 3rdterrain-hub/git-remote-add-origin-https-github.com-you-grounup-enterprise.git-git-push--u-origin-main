/**
 * The overtime rule, in the words somebody would use to explain it.
 *
 * This is the most consequential setting in the workforce module and it is four
 * numbers, which is exactly the shape of thing that gets set once by whoever is
 * closest to the keyboard and never looked at again. So the panel states the
 * rule as a sentence above the fields — "Overtime after 8 hours in a day, and
 * after 40 hours in a week. Minutes are counted as worked, with no rounding." —
 * and the sentence updates as the fields change, before anything is saved.
 *
 * The two defaults are deliberate and are explained on the screen rather than
 * only in the migration. Federal, not California, because paying overtime
 * nobody owes is a real cost silently incurred. And no rounding, because the
 * seven-minute rule is legal in most places and is also the most common way a
 * time system quietly shorts people.
 */
import { useEffect, useState } from 'react';
import { Loader2, Save, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadOvertimePolicy, saveOvertimePolicy, describeOvertime,
  DEFAULT_OVERTIME, type OvertimePolicy,
} from '@/lib/data/time-clock';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** An empty field means "no rule", which is different from zero. */
const asHours = (raw: string): number | null => {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function OvertimePolicyCard({ companyId, canEdit }: {
  companyId: string; canEdit: boolean;
}) {
  const loaded = useQuery(loadOvertimePolicy, [companyId]);
  const [draft, setDraft] = useState<OvertimePolicy>(DEFAULT_OVERTIME);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === 'ready') setDraft(loaded.data);
  }, [loaded.status, loaded.status === 'ready' ? loaded.data : null]);

  if (loaded.status === 'loading') return <LoadingState label="Reading the overtime rule" />;
  if (loaded.status === 'error') return <ErrorState message={loaded.message} onRetry={loaded.refetch} />;

  const set = <K extends keyof OvertimePolicy>(k: K, v: OvertimePolicy[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await saveOvertimePolicy(companyId, draft);
      setSaved(true);
      loaded.refetch();
    } catch (err) {
      setProblem(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="size-4 text-charcoal-500" /> Overtime rule
        </CardTitle>
        <CardDescription>
          How the time clock turns punches into straight, overtime and double time hours.
          The default is the federal rule — overtime after forty hours in a week and no daily
          overtime — because paying overtime nobody owes is a cost you would not see.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="rounded-md border border-charcoal-200 bg-charcoal-50 p-3 text-sm text-charcoal-800">
          {describeOvertime(draft)}
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ot-daily">Daily overtime after</Label>
            <Input
              id="ot-daily" inputMode="decimal" disabled={!canEdit}
              value={draft.dailyOvertimeAfter ?? ''}
              placeholder="No daily rule"
              onChange={(e) => set('dailyOvertimeAfter', asHours(e.target.value))} />
            <p className="text-xs text-charcoal-500">Hours. Leave empty for none.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ot-double">Double time after</Label>
            <Input
              id="ot-double" inputMode="decimal" disabled={!canEdit}
              value={draft.dailyDoubletimeAfter ?? ''}
              placeholder="No double time"
              onChange={(e) => set('dailyDoubletimeAfter', asHours(e.target.value))} />
            <p className="text-xs text-charcoal-500">Hours in a day. Must be more than the overtime hour.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ot-weekly">Weekly overtime after</Label>
            <Input
              id="ot-weekly" inputMode="decimal" disabled={!canEdit}
              value={draft.weeklyOvertimeAfter ?? ''}
              placeholder="No weekly rule"
              onChange={(e) => set('weeklyOvertimeAfter', asHours(e.target.value))} />
            <p className="text-xs text-charcoal-500">Hours. Federal is 40.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ot-week-start">The week starts on</Label>
            <Select
              value={String(draft.weekStartsOn)} disabled={!canEdit}
              onValueChange={(v) => set('weekStartsOn', Number(v))}>
              <SelectTrigger id="ot-week-start"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-charcoal-500">Where the weekly count resets.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ot-rounding">Round worked time to</Label>
            <Select
              value={String(draft.roundingMinutes)} disabled={!canEdit}
              onValueChange={(v) => set('roundingMinutes', Number(v))}>
              <SelectTrigger id="ot-rounding"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">No rounding</SelectItem>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="6">6 minutes (tenth of an hour)</SelectItem>
                <SelectItem value="10">10 minutes</SelectItem>
                <SelectItem value="15">15 minutes (quarter hour)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-charcoal-500">Off by default. Rounding can cost people time.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ot-direction">Rounding direction</Label>
            <Select
              value={draft.roundingDirection} disabled={!canEdit || draft.roundingMinutes <= 1}
              onValueChange={(v) => set('roundingDirection', v as OvertimePolicy['roundingDirection'])}>
              <SelectTrigger id="ot-direction"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nearest">To the nearest</SelectItem>
                <SelectItem value="up">Always up, in the employee's favor</SelectItem>
                <SelectItem value="down">Always down</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-charcoal-500">
              Rounding down shortens every partial interval. Check your state before choosing it.
            </p>
          </div>
        </div>

        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save the rule
            </Button>
            {saved ? <span className="text-sm text-ok-700">Saved.</span> : null}
          </div>
        ) : (
          <p className="text-sm text-charcoal-500">
            Changing the overtime rule needs the company.manage permission.
          </p>
        )}

        {problem ? <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p> : null}
      </CardContent>
    </Card>
  );
}

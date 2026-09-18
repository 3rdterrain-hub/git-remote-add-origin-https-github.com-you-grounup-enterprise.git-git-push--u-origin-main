/**
 * The questions a company writes onto its own lead form. WORKFLOW.
 *
 * 0229 put the questions, the choices and the answers in the database. This is
 * the door, and it has to be the whole of one: a question that could be added
 * and never renamed, required, reordered or retired would be the same defect
 * one layer along — a control that takes a value and then stops.
 *
 * So every part of a question is changed where it is shown. The label is typed
 * over in place, "Required" is a toggle on the row, the arrows move it, and
 * "Put away" retires it rather than destroying it, because leads that already
 * answered it point at it.
 */
import { useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, Loader2, Plus, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  leadFormChoices, addLeadFormQuestion, setLeadFormQuestion,
  addLeadFormChoice, setLeadFormChoice, QUESTION_KINDS,
  type LeadFormQuestion, type LeadQuestionKind,
} from '@/lib/data/lead-forms';
import { plural } from '@/lib/format';

/** A label edited in place: click it, type over it, Enter saves and Escape does not. */
function EditableLabel({ value, onSave }: {
  value: string; onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <button type="button"
        className="rounded px-1 text-left text-sm font-medium text-charcoal-900 underline decoration-dotted underline-offset-4 hover:bg-charcoal-50"
        title="Change what this asks"
        onClick={() => { setDraft(value); setEditing(true); }}>
        {value}
      </button>
    );
  }
  const save = async () => {
    setBusy(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setBusy(false); }
  };
  return (
    <span className="flex items-center gap-1">
      <Input value={draft} autoFocus className="h-8 w-64"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setEditing(false);
        }} />
      <Button size="sm" variant="ghost" disabled={busy || draft.trim() === ''} onClick={save}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      </Button>
    </span>
  );
}

/** The options on one choice question, added to and taken away where they are shown. */
function Choices({ question, onChanged }: {
  question: LeadFormQuestion; onChanged: () => void;
}) {
  const choices = useQuery(leadFormChoices(question.id), [question.id]);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => { choices.refetch(); onChanged(); };

  const add = async () => {
    setBusy(true); setProblem(null);
    try { await addLeadFormChoice(question.id, adding.trim()); setAdding(''); refresh(); }
    catch (err) { setProblem(messageFor(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 pl-6">
      <div className="flex flex-wrap items-center gap-1">
        {(choices.status === 'ready' ? choices.data : []).map((c) => (
          <span key={c.id}
            className="inline-flex items-center gap-1 rounded-full border border-charcoal-200 bg-white px-2 py-0.5 text-xs text-charcoal-700">
            {c.label}
            <button type="button" title={`Take "${c.label}" off the list`}
              className="text-charcoal-400 hover:text-danger-600"
              onClick={async () => {
                setProblem(null);
                try { await setLeadFormChoice(c.id, { isActive: false }); refresh(); }
                catch (err) { setProblem(messageFor(err)); }
              }}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        {choices.status === 'ready' && choices.data.length === 0 ? (
          <span className="text-xs text-charcoal-500">Nothing to choose from yet.</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Input value={adding} placeholder="Another option" className="h-8 w-56"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim()) void add(); }} />
        <Button size="sm" variant="outline" disabled={busy || adding.trim() === ''} onClick={add}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-xs font-medium text-danger-700">{problem}</p>
      ) : null}
    </div>
  );
}

/*
 * The questions are loaded by the card above rather than here, and handed down.
 * The snippet on that card is built from the same list, so a question added in
 * this panel is in the code somebody pastes on the next render. Two independent
 * reads would let the two disagree, and the one that would be wrong is the one
 * a contractor copies onto their website.
 */
export function FormQuestions({ formId, canEdit, questions, onChanged }: {
  formId: string;
  canEdit: boolean;
  questions: readonly LeadFormQuestion[];
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<LeadQuestionKind>('select');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const offersChoices = kind === 'select' || kind === 'multi_select';
  const rows = questions.filter((q) => q.isActive);

  const create = async () => {
    setBusy(true); setProblem(null);
    try {
      await addLeadFormQuestion(formId, {
        label: label.trim(),
        kind,
        isRequired: required,
        choices: offersChoices
          ? options.split(/[\n,]/).map((o) => o.trim()).filter(Boolean)
          : null,
      });
      setLabel(''); setOptions(''); setRequired(false);
      onChanged();
    } catch (err) { setProblem(messageFor(err)); }
    finally { setBusy(false); }
  };

  const change = async (id: string, next: Parameters<typeof setLeadFormQuestion>[1]) => {
    setProblem(null);
    try { await setLeadFormQuestion(id, next); onChanged(); }
    catch (err) { setProblem(messageFor(err)); }
  };

  /* Swapping two sort orders, so a question moves without renumbering the rest. */
  const move = async (index: number, by: -1 | 1) => {
    const a = rows[index];
    const b = rows[index + by];
    if (!a || !b) return;
    setProblem(null);
    try {
      await setLeadFormQuestion(a.id, { sortOrder: b.sortOrder });
      await setLeadFormQuestion(b.id, { sortOrder: a.sortOrder });
      onChanged();
    } catch (err) { setProblem(messageFor(err)); }
  };

  const ready = label.trim() !== ''
    && (!offersChoices || options.split(/[\n,]/).some((o) => o.trim() !== ''));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>What this form asks, beyond name and contact</Label>
        {rows.length > 0 ? (
          <span className="text-xs text-charcoal-500">
            {plural(rows.length, 'question')} of your own
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-charcoal-500">
          It asks for a name, a company, an email, a phone, a city, a state and what they
          need. Add anything else you want to know before you pick up the phone — the kind
          of work, the acreage, when they want to start.
        </p>
      ) : (
        <ul className="divide-y divide-charcoal-100 rounded-md border border-charcoal-200 bg-white">
          {rows.map((q, i) => (
            <li key={q.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {canEdit
                  ? <EditableLabel value={q.label}
                      onSave={(next) => change(q.id, { label: next })} />
                  : <span className="text-sm font-medium text-charcoal-900">{q.label}</span>}
                <Badge variant="outline">
                  {QUESTION_KINDS.find((k) => k.value === q.kind)?.label ?? q.kind}
                </Badge>
                {q.answeredCount > 0 ? (
                  <span className="text-xs text-charcoal-500">
                    {plural(q.answeredCount, 'answer')}
                  </span>
                ) : null}

                <span className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={!canEdit || i === 0}
                    title={i === 0 ? 'Already first' : 'Ask this sooner'}
                    onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost"
                    disabled={!canEdit || i === rows.length - 1}
                    title={i === rows.length - 1 ? 'Already last' : 'Ask this later'}
                    onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button size="sm" variant={q.isRequired ? 'default' : 'outline'}
                    disabled={!canEdit}
                    title={q.isRequired
                      ? 'Nobody can send the form without answering this'
                      : 'Make this one they have to answer'}
                    onClick={() => change(q.id, { isRequired: !q.isRequired })}>
                    {q.isRequired ? 'Required' : 'Optional'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!canEdit}
                    title="Stop asking it. The answers already given are kept."
                    onClick={() => change(q.id, { isActive: false })}>
                    Put away
                  </Button>
                </span>
              </div>

              {(q.kind === 'select' || q.kind === 'multi_select') && canEdit ? (
                <Choices question={q} onChanged={onChanged} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="space-y-2 rounded-md border border-dashed border-charcoal-300 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor={`q-label-${formId}`}>Ask something of your own</Label>
              <Input id={`q-label-${formId}`} value={label}
                placeholder="What kind of work?"
                onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="w-44 space-y-1">
              <Label htmlFor={`q-kind-${formId}`}>How they answer</Label>
              <select id={`q-kind-${formId}`} value={kind}
                onChange={(e) => setKind(e.target.value as LeadQuestionKind)}
                className="h-9 w-full rounded-md border border-charcoal-200 bg-white px-3 text-sm">
                {QUESTION_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
            <Button variant={required ? 'default' : 'outline'}
              title={required
                ? 'They cannot send the form without it'
                : 'They can leave it blank'}
              onClick={() => setRequired((r) => !r)}>
              {required ? 'Required' : 'Optional'}
            </Button>
            <Button disabled={busy || !ready} onClick={create}
              title={ready ? undefined
                : offersChoices && label.trim() !== ''
                  ? 'A choice needs something to choose from'
                  : 'Say what you want to know'}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add it
            </Button>
          </div>

          {offersChoices ? (
            <div className="space-y-1">
              <Label htmlFor={`q-options-${formId}`}>The options, one per line</Label>
              <textarea id={`q-options-${formId}`} rows={3} value={options}
                onChange={(e) => setOptions(e.target.value)}
                className="w-full rounded-md border border-charcoal-200 bg-white p-2 text-sm"
                placeholder={'Site work\nDemolition\nUtilities\nGrading'} />
              <p className="text-xs text-charcoal-500">
                You can add more later. An answer that is not on this list is refused rather
                than stored, which is what keeps one name for one thing.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger-700">{problem}</p>
      ) : null}
    </div>
  );
}

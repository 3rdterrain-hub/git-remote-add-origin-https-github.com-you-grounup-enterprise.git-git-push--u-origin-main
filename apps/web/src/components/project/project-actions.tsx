/**
 * Workflow — the three things a project manager does, from the project page.
 *
 * `project-detail` was made live in migration 0142 and shipped with three
 * buttons that did nothing: Daily report, Change order, New RFI. The tables
 * behind them have existed since 0006 and 0007 and are fully governed — a
 * submitted daily report freezes its date because it is evidence in a claim, an
 * executed change order refuses edits, an answered RFI must carry its answer —
 * and none of them had a writer. So a live job could be read in detail and
 * never actually worked.
 *
 * What each dialog asks for is the smallest thing that makes a real record, and
 * no more:
 *
 *   * **A daily report asks for the date.** Defaulted to today, refused in the
 *     future, and refused twice for one day — one report per project per day is
 *     an index, and the second attempt says so by name rather than through a
 *     constraint. Everything else about the day is filled in on the report.
 *
 *   * **A change order asks why.** The title and the reason, because a change
 *     order is an argument for money and one that does not say why is an
 *     argument nobody can answer. It does *not* ask for a cost — that comes
 *     from pricing the change, and a number typed here is a number nobody can
 *     reproduce.
 *
 *   * **An RFI asks the question.** Literally: a title and the question being
 *     put. It opens in draft, because issuing an RFI starts a clock and that is
 *     a decision separate from writing it down.
 */
import { useState } from 'react';
import { CalendarDays, FileWarning, HelpCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { messageFor } from '@/lib/data/query';
import { supabase } from '@/lib/supabase';
import { createDailyReport, createChangeOrder, createRfi } from '@/lib/data/project';

type Which = 'daily' | 'change' | 'rfi';

/** Today as the browser sees it, which is the day somebody means by "today". */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ORIGINS: Array<[string, string]> = [
  ['owner_request', 'The owner asked for it'],
  ['design_change', 'The design changed'],
  ['differing_site_condition', 'The site was not what the documents said'],
  ['error_omission', 'An error or omission in the documents'],
  ['weather', 'Weather'],
  ['other', 'Something else'],
];

const PRIORITIES: Array<[string, string]> = [
  ['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['critical', 'Critical'],
];

export function ProjectActions({ projectId, canWrite, canRaiseRfi, onCreated }: {
  projectId: string;
  /** `projects.write` — a day on site and a change to the contract. */
  canWrite: boolean;
  /** `estimates.write` — what migration 0010 decided an RFI needs. */
  canRaiseRfi: boolean;
  /** Which tab to open, and a refetch, once something exists. */
  onCreated: (what: Which) => void;
}) {
  const [open, setOpen] = useState<Which | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Daily report
  const [date, setDate] = useState(today());
  const [work, setWork] = useState('');
  // Change order
  const [coTitle, setCoTitle] = useState('');
  const [coReason, setCoReason] = useState('');
  const [coOrigin, setCoOrigin] = useState('owner_request');
  // RFI
  const [rfiTitle, setRfiTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [priority, setPriority] = useState('normal');

  const close = () => { setOpen(null); setError(null); };

  const reset = () => {
    setDate(today()); setWork('');
    setCoTitle(''); setCoReason(''); setCoOrigin('owner_request');
    setRfiTitle(''); setQuestion(''); setDiscipline(''); setPriority('normal');
  };

  const run = async (what: Which) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    try {
      if (what === 'daily') {
        await createDailyReport(supabase, { projectId, date, workPerformed: work });
      } else if (what === 'change') {
        await createChangeOrder(supabase, {
          projectId, title: coTitle, reason: coReason, origin: coOrigin,
        });
      } else {
        await createRfi(supabase, {
          projectId, title: rfiTitle, question, discipline, priority,
        });
      }
      reset(); setOpen(null);
      onCreated(what);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    open === 'daily' ? date !== ''
      : open === 'change' ? coTitle.trim() !== '' && coReason.trim() !== ''
        : rfiTitle.trim() !== '' && question.trim() !== '';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!canWrite}
          onClick={() => { setOpen('daily'); setError(null); }}>
          <CalendarDays className="size-4" /> Daily report
        </Button>
        <Button variant="outline" disabled={!canWrite}
          onClick={() => { setOpen('change'); setError(null); }}>
          <FileWarning className="size-4" /> Change order
        </Button>
        <Button disabled={!canRaiseRfi}
          onClick={() => { setOpen('rfi'); setError(null); }}>
          <HelpCircle className="size-4" /> New RFI
        </Button>
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => { if (!v) close(); }}>
        <DialogContent className="max-w-lg">
          {open === 'daily' ? (
            <>
              <DialogHeader>
                <DialogTitle>Start a daily report</DialogTitle>
                <DialogDescription>
                  The contemporaneous record of a day on site. It stays open until you submit
                  it — submitting is what freezes the date, because a submitted report is
                  evidence in a claim.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dr-date">Which day</Label>
                  <Input id="dr-date" type="date" value={date} max={today()}
                    onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dr-work">What was done (optional)</Label>
                  <Input id="dr-work" value={work} placeholder="Stripped topsoil, east half"
                    onChange={(e) => setWork(e.target.value)} />
                </div>
              </div>
            </>
          ) : null}

          {open === 'change' ? (
            <>
              <DialogHeader>
                <DialogTitle>Raise a change order</DialogTitle>
                <DialogDescription>
                  It starts as potential and priced at nothing. A change nobody has priced is
                  not yet a claim on anybody, and the cost comes from pricing the work rather
                  than from this box.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="co-title">Title</Label>
                  <Input id="co-title" value={coTitle} autoFocus
                    placeholder="Rock excavation, east trench"
                    onChange={(e) => setCoTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="co-reason">Why the work changed</Label>
                  <Input id="co-reason" value={coReason}
                    placeholder="Limestone ledge at 9 ft, not shown on the borings"
                    onChange={(e) => setCoReason(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="co-origin">Where it came from</Label>
                  <select id="co-origin" value={coOrigin}
                    onChange={(e) => setCoOrigin(e.target.value)}
                    className="h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm">
                    {ORIGINS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </div>
              </div>
            </>
          ) : null}

          {open === 'rfi' ? (
            <>
              <DialogHeader>
                <DialogTitle>Raise an RFI</DialogTitle>
                <DialogDescription>
                  It opens in draft. Issuing an RFI starts a clock somebody has to answer
                  against, and that is a decision separate from writing the question down.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rfi-title">Title</Label>
                  <Input id="rfi-title" value={rfiTitle} autoFocus
                    placeholder="Conflict between C-3 and S-2 at grid B4"
                    onChange={(e) => setRfiTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rfi-question">The question</Label>
                  <Input id="rfi-question" value={question}
                    placeholder="Which invert governs at the tie-in?"
                    onChange={(e) => setQuestion(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="rfi-disc">Discipline (optional)</Label>
                    <Input id="rfi-disc" value={discipline} placeholder="Civil"
                      onChange={(e) => setDiscipline(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rfi-priority">Priority</Label>
                    <select id="rfi-priority" value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="h-9 rounded-md border border-charcoal-200 bg-white px-2 text-sm">
                      {PRIORITIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {error ? <Alert tone="danger" title="That did not go through">{error}</Alert> : null}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !ready} onClick={() => open && void run(open)}>
              {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {open === 'daily' ? 'Start the report'
                : open === 'change' ? 'Raise the change order' : 'Raise the RFI'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The file a machine cuts to. WORKFLOW.
 *
 * `machine_control_files` and `machine_assignments` had four integrity guards
 * and no writer, so a design could never be published, never superseded and
 * never sent to a machine. O-022 has been open since machine control was
 * written; this closes it.
 *
 * The three facts this screen keeps separate, because they are separate:
 *
 *   * **Published** — the office approved it and recorded the digest of what it
 *     approved. Without the digest there is no way to show that the file on the
 *     machine is the file that was approved, and the schema refuses one without.
 *   * **Sent** — a machine was told to run it.
 *   * **Acknowledged** — the operator confirmed the machine has it. A file the
 *     machine has not confirmed is a file the operator may not be cutting to.
 */
import { useState } from 'react';
import { Loader2, Radio, Send, Upload, Check, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { messageFor, useQuery } from '@/lib/data/query';
import { listProjects } from '@/lib/data/projects';
import { loadAssets } from '@/lib/data/fleet';
import {
  recordMachineControlFile, publishMachineControlFile, supersedeMachineControlFile,
  withdrawMachineControlFile, sendFileToMachine, acknowledgeMachineFile,
  MACHINE_FORMATS, MACHINE_VENDORS, type SurfaceRow, type MachineFileRow,
} from '@/lib/data/survey';
import { titleCase } from '@/lib/format';

const field = 'h-9 w-full rounded-md border border-charcoal-200 bg-white px-2 text-sm';
const DIGEST = /^[a-f0-9]{64}$/;

/** Record a new design against a project, as a draft. */
export function RecordMachineFile({ surfaces, canWrite, onRecorded }: {
  surfaces: SurfaceRow[];
  canWrite: boolean;
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const projectsQ = useQuery(listProjects, [open]);
  const projects = projectsQ.status === 'ready' ? projectsQ.data : [];

  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [format, setFormat] = useState<string>('ttm');
  const [vendor, setVendor] = useState<string>('trimble');
  const [path, setPath] = useState('');
  const [surfaceId, setSurfaceId] = useState('');
  const [checksum, setChecksum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projectId || projects[0]?.id || '';
  const digestBad = checksum.trim() !== '' && !DIGEST.test(checksum.trim().toLowerCase());
  const ready = project !== '' && name.trim() !== '' && path.trim() !== '' && !digestBad;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await recordMachineControlFile({
        projectId: project, name, fileFormat: format, storagePath: path,
        surfaceId: surfaceId || null, vendor, checksum: checksum || null,
      });
      setName(''); setPath(''); setChecksum('');
      setOpen(false);
      onRecorded();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}
        title={canWrite ? undefined : 'Needs permission to add a machine control file'}>
        <Upload className="size-4" /> Add a design
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-200 bg-charcoal-50/60 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="mc-project">Project</Label>
          <select id="mc-project" className={field} value={project}
            onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mc-name">Design</Label>
          <Input id="mc-name" value={name} autoFocus placeholder="Phase 2 subgrade"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mc-format">Format</Label>
          <select id="mc-format" className={field} value={format}
            onChange={(e) => setFormat(e.target.value)}>
            {MACHINE_FORMATS.map((f) => (
              <option key={f} value={f}>{f.toUpperCase().replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mc-vendor">Machine brand</Label>
          <select id="mc-vendor" className={field} value={vendor}
            onChange={(e) => setVendor(e.target.value)}>
            {MACHINE_VENDORS.map((v) => (
              <option key={v} value={v}>{titleCase(v)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="mc-path">File</Label>
          <Input id="mc-path" value={path} placeholder="machine/phase-2-subgrade.ttm"
            onChange={(e) => setPath(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mc-surface">Cut from</Label>
          <select id="mc-surface" className={field} value={surfaceId}
            onChange={(e) => setSurfaceId(e.target.value)}>
            <option value="">Not recorded</option>
            {surfaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.surveyName})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mc-digest">SHA-256</Label>
          <Input id="mc-digest" value={checksum} placeholder="Needed before it can be published"
            onChange={(e) => setChecksum(e.target.value)} />
        </div>
      </div>

      {digestBad ? (
        <Alert tone="warn" title="That is not a SHA-256">
          A digest is 64 lowercase hex characters. It can be left empty here and given when the
          design is published.
        </Alert>
      ) : null}
      {error ? <Alert tone="danger" title="That design was not recorded">{error}</Alert> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={() => { void save(); }} disabled={!ready || busy}
          title={ready ? undefined : 'A design needs a project, a name and a file'}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Record the design
        </Button>
      </div>
    </div>
  );
}

/**
 * Everything that can be done to one design: publish it, send it, replace it,
 * withdraw it.
 */
export function MachineFileActions({ file, files, canWrite, onChanged }: {
  file: MachineFileRow;
  files: MachineFileRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'publish' | 'send' | 'supersede'>('none');
  const [checksum, setChecksum] = useState('');
  const [assetId, setAssetId] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetsQ = useQuery(loadAssets, [mode === 'send']);
  const assets = assetsQ.status === 'ready' ? assetsQ.data : [];

  const replacements = files.filter(
    (f) => f.id !== file.id && f.status === 'published' && f.supersededById === null,
  );

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await fn();
      setMode('none'); setChecksum('');
      onChanged();
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const digestBad = checksum.trim() !== '' && !DIGEST.test(checksum.trim().toLowerCase());

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        {file.status === 'draft' ? (
          <Button variant="outline" size="sm" disabled={!canWrite}
            onClick={() => setMode(mode === 'publish' ? 'none' : 'publish')}
            title={canWrite ? 'Approve this design and record the digest of what was approved'
              : 'Needs permission to publish a design'}>
            <Radio className="size-4" /> Publish
          </Button>
        ) : null}
        {file.status === 'published' ? (
          <>
            <Button variant="outline" size="sm" disabled={!canWrite}
              onClick={() => setMode(mode === 'send' ? 'none' : 'send')}
              title={canWrite ? 'Send this design to a machine' : 'Needs permission to send a design'}>
              <Send className="size-4" /> Send to a machine
            </Button>
            {replacements.length > 0 ? (
              <Button variant="ghost" size="sm" disabled={!canWrite}
                onClick={() => setMode(mode === 'supersede' ? 'none' : 'supersede')}
                title="Mark this design replaced by a newer one">
                Replace
              </Button>
            ) : null}
          </>
        ) : null}
        {file.status !== 'superseded' && file.status !== 'withdrawn' ? (
          <Button variant="ghost" size="sm" disabled={!canWrite}
            onClick={() => { void act(() => withdrawMachineControlFile(file.id)); }}
            title="Take this design off every machine carrying it">
            <Ban className="size-4" /> Withdraw
          </Button>
        ) : null}
      </div>

      {mode === 'publish' ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-2 text-left">
          <Label htmlFor={`pub-${file.id}`}>SHA-256 of the file being published</Label>
          <Input id={`pub-${file.id}`} value={checksum} autoFocus
            placeholder="64 lowercase hex characters"
            onChange={(e) => setChecksum(e.target.value)} />
          <p className="text-xs text-charcoal-500">
            Without it there is no way to show that the file on the machine is the file that was
            approved. Publishing also freezes the surface this was cut from.
          </p>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || digestBad}
              onClick={() => { void act(() => publishMachineControlFile(file.id, checksum)); }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Publish it
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'send' ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-2 text-left">
          <Label htmlFor={`snd-${file.id}`}>Machine</Label>
          <select id={`snd-${file.id}`} className={field} value={assetId}
            onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Choose a machine</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.assetNumber} — {a.name}</option>
            ))}
          </select>
          <p className="text-xs text-charcoal-500">
            Whatever that machine is carrying now is stood down in the same step. An operator
            holding two designs has no way to know which one the office meant.
          </p>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || assetId === ''}
              onClick={() => { void act(() => sendFileToMachine(assetId, file.id)); }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Send it
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'supersede' ? (
        <div className="space-y-2 rounded-md border border-charcoal-200 bg-white p-2 text-left">
          <Label htmlFor={`sup-${file.id}`}>Replaced by</Label>
          <select id={`sup-${file.id}`} className={field} value={replacementId}
            onChange={(e) => setReplacementId(e.target.value)}>
            <option value="">Choose the design that replaces it</option>
            {replacements.map((f) => (
              <option key={f.id} value={f.id}>{f.name} (v{f.version})</option>
            ))}
          </select>
          <p className="text-xs text-charcoal-500">
            Every machine still carrying this one is told. A superseded design left live on a dozer
            is how a crew builds last week&rsquo;s grade.
          </p>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || replacementId === ''}
              onClick={() => { void act(() => supersedeMachineControlFile(file.id, replacementId)); }}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Replace it
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <Alert tone="danger" title="That did not happen">{error}</Alert> : null}
    </div>
  );
}

/** The operator confirming the machine has it. */
export function AcknowledgeFile({ assignmentId, canWrite, onAcknowledged }: {
  assignmentId: string;
  canWrite: boolean;
  onAcknowledged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="ghost" size="sm" disabled={!canWrite || busy}
        title={canWrite ? 'Record that the machine has this design'
          : 'Needs permission to acknowledge a design'}
        onClick={() => {
          if (busy) return;
          setBusy(true); setError(null);
          acknowledgeMachineFile(assignmentId)
            .then(onAcknowledged)
            .catch((e: unknown) => setError(messageFor(e)))
            .finally(() => setBusy(false));
        }}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Confirm it has it
      </Button>
      {error ? <span className="block text-xs text-danger-700">{error}</span> : null}
    </>
  );
}

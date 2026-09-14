/**
 * The mark and the colors a company puts on what it sends.
 *
 * `logo_path`, `primary_color` and `accent_color` have been on `companies`
 * since migration 0002, with a hex check constraint on the colors and a comment
 * saying the logo is a storage path and never a blob. Across the repository
 * those columns appeared in exactly one file — the migration that created them.
 *
 * The tab that stood here was the other half of the same defect: two boxes with
 * `defaultValue="#111827"` typed into the markup, swatches painted by a fixed
 * CSS class rather than by the color, and a Save button whose handler set a
 * `dirty` flag to false. It took a value and changed nothing, and it looked
 * exactly like a working screen.
 *
 * The preview is not decoration. A color chosen against a white settings page
 * and a color chosen against the header it will actually be is not the same
 * decision, and the header is the thing being configured.
 */
import { useEffect, useRef, useState } from 'react';
import { ImageUp, Palette, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { LoadingState, ErrorState } from '@/components/data-state';
import { useQuery, messageFor } from '@/lib/data/query';
import {
  loadCompanyProfile, saveCompanyProfile, uploadCompanyLogo, removeCompanyLogo,
  logoUrl, type CompanyProfile,
} from '@/lib/data/company';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Black or white, whichever can be read on this background.
 *
 * Relative luminance, the way the contrast standard defines it. A company that
 * picks a pale accent gets dark text on it rather than a white-on-yellow header
 * nobody can read — and it is computed rather than chosen, because asking
 * somebody to also pick a text color is asking them to solve this by eye.
 */
export function readableOn(hex: string): string {
  if (!HEX.test(hex)) return '#FFFFFF';
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.179 ? '#111827' : '#FFFFFF';
}

function ColorField({ id, label, value, onChange, hint }: {
  id: string; label: string; value: string;
  onChange: (next: string) => void; hint: string;
}) {
  const valid = HEX.test(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {/*
          * The picker and the hex box are one value in two forms. The swatch is
          * the color itself rather than a class that happens to resemble it.
          */}
        <input
          type="color" aria-label={`${label} swatch`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-10 shrink-0 cursor-pointer rounded-md border border-charcoal-300
                     bg-white p-1"
        />
        <Input id={id} value={value} className="font-mono" spellCheck={false}
          onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </div>
      <p className="text-xs text-charcoal-500">{hint}</p>
      {!valid ? (
        <p className="text-xs text-danger-700">
          A color is six hex digits after a hash, like #1B4D3E. The database
          refuses anything else, so this would not save.
        </p>
      ) : null}
    </div>
  );
}

/** The proposal header, as the customer will actually receive it. */
function Preview({ name, logo, primary, accent }: {
  name: string; logo: string | null; primary: string; accent: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-charcoal-200">
      <div className="flex items-center justify-between gap-4 p-4"
        style={{ backgroundColor: primary, color: readableOn(primary) }}>
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            /* The logo is the company's name set in a picture, so it says so. */
            <img src={logo} alt={name} className="max-h-10 max-w-40 object-contain" />
          ) : (
            <span className="truncate text-lg font-semibold">{name}</span>
          )}
        </div>
        <div className="text-right text-xs">
          <p className="font-medium">PROPOSAL</p>
          <p className="opacity-80">P-2026-0001</p>
        </div>
      </div>
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      <div className="space-y-2 bg-white p-4">
        <p className="text-sm font-medium text-charcoal-900">Site work — Kingsway</p>
        <p className="text-xs text-charcoal-500">
          This is the header the customer opens from the emailed link, and the one
          printed on what they keep.
        </p>
        <span className="inline-block rounded px-2.5 py-1 text-xs font-medium"
          style={{ backgroundColor: accent, color: readableOn(accent) }}>
          Accept this proposal
        </span>
      </div>
    </div>
  );
}

export function BrandingSettings() {
  const profileQ = useQuery(loadCompanyProfile, []);
  const company = profileQ.status === 'ready' ? profileQ.data : null;

  const [primary, setPrimary] = useState('#111827');
  const [accent, setAccent] = useState('#F6C101');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!company) return;
    setPrimary(company.primaryColor);
    setAccent(company.accentColor);
  }, [company]);

  const changed = Boolean(company
    && (company.primaryColor !== primary || company.accentColor !== accent));
  const valid = HEX.test(primary) && HEX.test(accent);

  const after = (next: CompanyProfile) => {
    setPrimary(next.primaryColor);
    setAccent(next.accentColor);
    profileQ.refetch();
  };

  const save = async () => {
    if (!company || saving || !valid) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      after(await saveCompanyProfile(company.id, {
        primaryColor: primary, accentColor: accent,
      }));
      setSaved(true);
    } catch (e) { setError(messageFor(e)); } finally { setSaving(false); }
  };

  const pickLogo = async (f: File | undefined) => {
    if (!company || !f || busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      after(await uploadCompanyLogo(company.id, f));
      setSaved(true);
    } catch (e) { setError(messageFor(e)); } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const dropLogo = async () => {
    if (!company || busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      after(await removeCompanyLogo(company.id, company.logoPath));
    } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };

  const logo = logoUrl(company?.logoPath ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4" /> Branding
        </CardTitle>
        <CardDescription>
          The mark and colors on every proposal this company sends, including the one a
          customer opens from a link with no account. Set here rather than per proposal,
          so two proposals sent the same week cannot disagree about what the company
          looks like.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {profileQ.status === 'loading' ? <LoadingState label="Reading the company" /> : null}
        {profileQ.status === 'error'
          ? <ErrorState message={profileQ.message} onRetry={profileQ.refetch} /> : null}

        {company ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <ColorField id="primary-color" label="Primary color" value={primary}
                  onChange={setPrimary}
                  hint="The header band. Usually the darker of the two." />
                <ColorField id="accent-color" label="Accent color" value={accent}
                  onChange={setAccent}
                  hint="The rule under the header, and the button the customer presses." />

                <div className="space-y-1.5">
                  <Label htmlFor="logo">Logo</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input ref={file} id="logo" type="file" className="sr-only"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(e) => void pickLogo(e.target.files?.[0])} />
                    <Button type="button" variant="outline" size="sm" disabled={busy}
                      onClick={() => file.current?.click()}>
                      <ImageUp className="mr-1.5 size-3.5" aria-hidden />
                      {company.logoPath ? 'Replace logo' : 'Upload a logo'}
                    </Button>
                    {company.logoPath ? (
                      <Button type="button" variant="ghost" size="sm" disabled={busy}
                        onClick={() => void dropLogo()}>
                        <Trash2 className="mr-1.5 size-3.5" aria-hidden /> Remove
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-charcoal-500">
                    PNG, JPEG, WebP or SVG, up to 5MB. Stored where a customer with no
                    account can load it, because that is who opens the proposal — the
                    file is public, and only somebody who can manage this company can
                    change it.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>What the customer sees</Label>
                <Preview name={company.name} logo={logo} primary={primary} accent={accent} />
              </div>
            </div>

            {error ? <Alert tone="danger" title="That could not be saved">{error}</Alert> : null}
            {saved && !changed ? <Alert tone="success">Branding saved.</Alert> : null}

            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => void save()}
                disabled={saving || !changed || !valid}>
                {saving ? 'Saving' : 'Save branding'}
              </Button>
              {changed ? (
                <Button type="button" variant="ghost" onClick={() => {
                  setPrimary(company.primaryColor);
                  setAccent(company.accentColor);
                }}>Discard</Button>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

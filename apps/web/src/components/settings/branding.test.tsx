/**
 * The mark and colors a company puts on what it sends.
 *
 * The tab that stood here had `defaultValue="#111827"` typed into the markup,
 * swatches painted by a fixed CSS class rather than by the color, and a Save
 * button whose handler set a dirty flag to false. It took a value and changed
 * nothing — and the three columns behind it had been on `companies` since
 * migration 0002, read by nothing and written by nothing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompanyProfile } from '@/lib/data/company';
import { BrandingSettings, readableOn } from './branding';

const hoisted = vi.hoisted(() => ({
  company: null as CompanyProfile | null,
  saved: [] as Array<Record<string, unknown>>,
  uploaded: [] as string[],
  removed: 0,
  failWith: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/company', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/company')>('@/lib/data/company');
  return {
    ...actual,
    loadCompanyProfile: async () => hoisted.company,
    logoUrl: (p: string | null) => (p ? `https://cdn.test/${p}` : null),
    saveCompanyProfile: async (_id: string, edit: Record<string, unknown>) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.saved.push(edit);
      hoisted.company = { ...hoisted.company!, ...edit } as CompanyProfile;
      return hoisted.company;
    },
    uploadCompanyLogo: async (_id: string, f: File) => {
      if (hoisted.failWith) throw new Error(hoisted.failWith);
      hoisted.uploaded.push(f.name);
      hoisted.company = { ...hoisted.company!, logoPath: `co/${f.name}` } as CompanyProfile;
      return hoisted.company;
    },
    removeCompanyLogo: async () => {
      hoisted.removed += 1;
      hoisted.company = { ...hoisted.company!, logoPath: null } as CompanyProfile;
      return hoisted.company;
    },
  };
});

const company = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  id: 'co-1', name: '3RD Terrain', legalName: null, taxId: null, phone: null,
  email: null, website: null, addressLine1: null, addressLine2: null,
  city: 'Toledo', stateProvince: 'OH', postalCode: null, country: 'US',
  timezone: 'America/New_York', currency: 'USD',
  defaultShiftHours: 8, defaultCalendarEfficiency: 0.85, defaultSwellPercent: 0.25,
  defaultShrinkPercent: 0.1, defaultFuelPrice: 4.25, bidRoundingIncrement: 0,
  terminology: {},
  logoPath: null, primaryColor: '#111827', accentColor: '#F6C101',
  ...over,
});

beforeEach(() => {
  hoisted.company = company();
  hoisted.saved = [];
  hoisted.uploaded = [];
  hoisted.removed = 0;
  hoisted.failWith = null;
});

describe('choosing a readable text color', () => {
  it('puts white on a dark ground and near-black on a light one', () => {
    expect(readableOn('#111827')).toBe('#FFFFFF');
    expect(readableOn('#1B4D3E')).toBe('#FFFFFF');
    expect(readableOn('#F6C101')).toBe('#111827');
    expect(readableOn('#FFFFFF')).toBe('#111827');
  });

  it('does not guess at a color that is not one', () => {
    expect(readableOn('not-a-color')).toBe('#FFFFFF');
  });
});

describe('the branding tab', () => {
  it('shows the colors the company actually has, not a literal', async () => {
    hoisted.company = company({ primaryColor: '#1B4D3E', accentColor: '#C2410C' });
    render(<BrandingSettings />);
    /* The boxes render before the company arrives; the values follow it. */
    await waitFor(() =>
      expect(screen.getByLabelText('Primary color')).toHaveValue('#1B4D3E'));
    expect(screen.getByLabelText('Accent color')).toHaveValue('#C2410C');
  });

  it('paints the swatch with the color itself', async () => {
    hoisted.company = company({ primaryColor: '#1B4D3E' });
    render(<BrandingSettings />);
    await waitFor(() =>
      expect(screen.getByLabelText('Primary color swatch')).toHaveValue('#1b4d3e'));
  });

  it('offers nothing to save until something changes', async () => {
    render(<BrandingSettings />);
    expect(await screen.findByRole('button', { name: 'Save branding' })).toBeDisabled();
  });

  it('saves the colors that were chosen', async () => {
    const user = userEvent.setup();
    render(<BrandingSettings />);
    const primary = await screen.findByLabelText('Primary color');
    await user.clear(primary);
    await user.type(primary, '#1B4D3E');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]).toMatchObject({ primaryColor: '#1B4D3E', accentColor: '#F6C101' });
  });

  it('refuses to send a color the database would reject, and says why', async () => {
    const user = userEvent.setup();
    render(<BrandingSettings />);
    const primary = await screen.findByLabelText('Primary color');
    await user.clear(primary);
    await user.type(primary, '#ZZZ');
    expect(screen.getByRole('button', { name: 'Save branding' })).toBeDisabled();
    expect(screen.getByText(/six hex digits after a hash/)).toBeInTheDocument();
    expect(hoisted.saved).toEqual([]);
  });

  it('puts the company name in the header until there is a logo', async () => {
    render(<BrandingSettings />);
    expect(await screen.findByText('3RD Terrain')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload a logo/ })).toBeInTheDocument();
  });

  it('uploads a logo and then shows it', async () => {
    const user = userEvent.setup();
    render(<BrandingSettings />);
    await screen.findByRole('button', { name: /Upload a logo/ });
    const input = document.getElementById('logo') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'terrain.png', { type: 'image/png' }));
    await waitFor(() => expect(hoisted.uploaded).toEqual(['terrain.png']));
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.test/co/terrain.png'));
    expect(screen.getByRole('button', { name: /Replace logo/ })).toBeInTheDocument();
  });

  it('takes the logo off again', async () => {
    hoisted.company = company({ logoPath: 'co/terrain.png' });
    const user = userEvent.setup();
    render(<BrandingSettings />);
    await user.click(await screen.findByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(hoisted.removed).toBe(1));
  });

  it('says what the database refused rather than a generic failure', async () => {
    hoisted.failWith = 'You do not have permission to change company settings.';
    const user = userEvent.setup();
    render(<BrandingSettings />);
    const accent = await screen.findByLabelText('Accent color');
    /*
     * Wait for the company to land before typing. The box exists before the
     * query answers, and typing into it first meant the arriving value
     * overwrote what was typed — the Save button then stayed disabled and this
     * test failed intermittently rather than always.
     */
    await waitFor(() => expect(accent).toHaveValue('#F6C101'));
    await user.clear(accent);
    await user.type(accent, '#C2410C');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('You do not have permission to change company settings.'))
      .toBeInTheDocument();
  });

  it('discards a change without saving it', async () => {
    const user = userEvent.setup();
    render(<BrandingSettings />);
    const primary = await screen.findByLabelText('Primary color');
    await user.clear(primary);
    await user.type(primary, '#1B4D3E');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(primary).toHaveValue('#111827');
    expect(hoisted.saved).toEqual([]);
  });
});

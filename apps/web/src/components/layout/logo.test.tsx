import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { render } from '@testing-library/react';
import { Logo, LogoMark, LogoWordmark, BRAND } from './logo';

// The stylesheet is read from disk rather than imported: Tailwind's Vite plugin
// consumes .css imports, so `?raw` yields an empty string here. The candidate
// list covers running from the repo root or from apps/web.
const css = readFileSync(
  ['apps/web/src/index.css', 'src/index.css'].find(existsSync)!,
  'utf8',
);

/**
 * The brand is supplied artwork, not a design choice made here. These tests
 * exist because the earlier build shipped an invented mark and a generic yellow,
 * and nothing caught it.
 */
describe('brand fidelity', () => {
  it('uses the gold sampled from the official logo files', () => {
    // src/assets/brand/BRAND-REFERENCE.md — #F6C101, not a generic yellow.
    expect(BRAND.gold).toBe('#F6C101');
    expect(BRAND.black).toBe('#000000');
  });

  it('anchors the design-token gold scale on the brand value', () => {
    expect(css).toContain('--color-yellow-500: #f6c101;');
    // The superseded generic yellow must not reappear anywhere in the tokens.
    expect(css.toLowerCase()).not.toContain('f5b800');
  });

  it('draws the wordmark from the real vector geometry', () => {
    const { container } = render(<LogoWordmark />);
    const paths = [...container.querySelectorAll('path')];
    // Six letterforms plus the two-part G, exactly as the source PDF contains.
    expect(paths).toHaveLength(8);
    expect(paths.filter((p) => p.getAttribute('fill') === '#F6C101')).toHaveLength(3);
    expect(paths.filter((p) => p.getAttribute('fill') === 'currentColor')).toHaveLength(5);
  });

  it('draws the G mark from the real vector geometry', () => {
    const { container } = render(<LogoMark />);
    const paths = [...container.querySelectorAll('path')];
    // The G is two paths: the black body and the gold sweep.
    expect(paths).toHaveLength(2);
    expect(paths.filter((p) => p.getAttribute('fill') === '#F6C101')).toHaveLength(1);
  });

  it('inherits the surrounding text color so it works on light and dark', () => {
    const { container } = render(<LogoWordmark />);
    const inheriting = [...container.querySelectorAll('path')]
      .filter((p) => p.getAttribute('fill') === 'currentColor');
    expect(inheriting.length).toBeGreaterThan(0);
  });

  it('labels the mark for assistive technology', () => {
    const { getAllByRole } = render(<LogoWordmark />);
    expect(getAllByRole('img', { name: 'GrounUp' })).toHaveLength(1);
  });

  it('renders the Enterprise descriptor, and can suppress it', () => {
    const withDescriptor = render(<Logo />);
    expect(withDescriptor.getByText('Enterprise')).toBeInTheDocument();
    withDescriptor.unmount();

    const without = render(<Logo showDescriptor={false} />);
    expect(without.queryByText('Enterprise')).not.toBeInTheDocument();
  });

  it('switches the wordmark to white on a dark surface without touching the gold', () => {
    const { container } = render(<Logo subdued />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('text-white');
    expect(container.querySelectorAll('path[fill="#F6C101"]')).toHaveLength(3);
  });
});

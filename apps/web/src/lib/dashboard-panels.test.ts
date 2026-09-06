/**
 * What a dashboard may be built from.
 *
 * Three things read this catalog — the dashboard that renders panels, the
 * customizer that offers them, and the permission check that decides who sees
 * what. The tests here are about the ways those three could quietly disagree.
 *
 * The one that matters most: permission is applied last and cannot be
 * overridden by a saved arrangement. Somebody who arranged a safety panel onto
 * their dashboard, and then had safety permission taken away, must stop seeing
 * safety records — the preference is a layout, never a grant.
 */
import { describe, expect, it } from 'vitest';
import {
  PANELS, DASHBOARD_TABS, DEFAULT_DASHBOARD, visiblePanels,
} from './dashboard-panels';

const all = () => true;
const none = () => false;
const only = (...permissions: string[]) => (p: string) => permissions.includes(p);

describe('the catalog itself', () => {
  it('gives every panel a key nothing else uses', () => {
    const keys = PANELS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts every panel in a tab the dashboard knows about', () => {
    for (const p of PANELS) {
      expect(DASHBOARD_TABS).toContain(p.tab);
    }
  });

  it('gives every panel a permission and a reason to exist', () => {
    for (const p of PANELS) {
      expect(p.permission).toMatch(/\./);
      expect(p.blurb.length).toBeGreaterThan(20);
    }
  });
});

describe('what a person sees', () => {
  it('shows the shipped arrangement to somebody who has never arranged anything', () => {
    const shown = visiblePanels(DEFAULT_DASHBOARD, all);
    expect(shown.map((p) => p.key)).toEqual(
      PANELS.filter((p) => p.defaultOn).map((p) => p.key));
  });

  it('honors the order somebody chose', () => {
    const shown = visiblePanels(
      { order: ['production', 'due'], hidden: [], layout: 'tabs' }, all);
    expect(shown.slice(0, 2).map((p) => p.key)).toEqual(['production', 'due']);
  });

  it('turns one off when it was turned off', () => {
    const shown = visiblePanels({ order: [], hidden: ['due'], layout: 'tabs' }, all);
    expect(shown.map((p) => p.key)).not.toContain('due');
  });

  it('turns one on that is not on by default', () => {
    expect(PANELS.find((p) => p.key === 'safety')!.defaultOn).toBe(false);
    const shown = visiblePanels({ order: ['safety'], hidden: [], layout: 'tabs' }, all);
    expect(shown.map((p) => p.key)).toContain('safety');
  });

  it('lets an arrangement end up empty, because that is a choice', () => {
    const shown = visiblePanels(
      { order: [], hidden: PANELS.map((p) => p.key), layout: 'tabs' }, all);
    expect(shown).toEqual([]);
  });
});

describe('an arrangement is a layout, never a grant', () => {
  it('stops showing a panel whose permission was taken away', () => {
    /*
     * The failure this is written against: somebody arranges the safety panel
     * onto their dashboard, later loses safety permission, and keeps seeing
     * safety records because their saved layout said so.
     */
    const arranged = { order: ['safety', 'due'], hidden: [], layout: 'tabs' as const };
    expect(visiblePanels(arranged, all).map((p) => p.key)).toContain('safety');
    expect(visiblePanels(arranged, only('estimates.read')).map((p) => p.key))
      .not.toContain('safety');
  });

  it('shows nothing at all to somebody with no permissions', () => {
    expect(visiblePanels(DEFAULT_DASHBOARD, none)).toEqual([]);
  });
});

describe('an arrangement does not freeze the product', () => {
  it('meets a panel added after the arrangement was saved', () => {
    /*
     * A person who arranged two panels a year ago should still see a new one
     * when it ships — provided it is on by default. Freezing their dashboard to
     * what existed then would hide a feature they are paying for.
     */
    const arranged = { order: ['production'], hidden: [], layout: 'tabs' as const };
    const shown = visiblePanels(arranged, all).map((p) => p.key);
    for (const p of PANELS.filter((x) => x.defaultOn)) {
      expect(shown).toContain(p.key);
    }
  });

  it('keeps the arranged ones ahead of the ones that were not', () => {
    const arranged = { order: ['production'], hidden: [], layout: 'tabs' as const };
    expect(visiblePanels(arranged, all)[0]!.key).toBe('production');
  });

  it('ignores a key for a panel that no longer exists', () => {
    const arranged = { order: ['a-panel-we-removed', 'due'], hidden: [], layout: 'tabs' as const };
    expect(visiblePanels(arranged, all)[0]!.key).toBe('due');
  });
});

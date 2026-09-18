/**
 * Putting a library row away, and getting it back.
 *
 * The owner archived a crew, believed it was deleted, and it was still there
 * with both its members. The schema was right and the product was wrong: the
 * row vanished, nothing said it was kept, and there was no way back.
 *
 * So these tests are mostly about what the control *says* before it acts, and
 * about the shipped row it refuses to offer at all.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hoisted = vi.hoisted(() => ({
  calls: [] as Array<{ kind: string; id: string; status: string }>,
  reject: null as string | null,
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() { return true; },
  get supabase() { return {}; },
}));

vi.mock('@/lib/data/library', async () => {
  const actual = await vi.importActual<typeof import('@/lib/data/library')>('@/lib/data/library');
  return {
    ...actual,
    setLibraryStatus: async (kind: string, id: string, status: string) => {
      if (hoisted.reject) throw new Error(hoisted.reject);
      hoisted.calls.push({ kind, id, status });
      return status;
    },
  };
});

const { ArchiveAction } = await import('./archive-action');

const show = (over: Partial<Parameters<typeof ArchiveAction>[0]> = {}) => {
  const onChanged = vi.fn();
  render(<ArchiveAction kind="crew" id="c-1" name="Excavation Crew A" status="active"
    editable canWrite onChanged={onChanged} {...over} />);
  return { onChanged };
};

beforeEach(() => { hoisted.calls = []; hoisted.reject = null; });

describe('before it archives anything', () => {
  it('says the row is kept, not deleted — which is what was missing', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /archive excavation crew a/i }));
    expect(screen.getByText('Archive Excavation Crew A? It is kept, not deleted.')).toBeTruthy();
  });

  it('asks first, so one stray click cannot take a crew off the screen', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /archive excavation crew a/i }));
    expect(hoisted.calls).toEqual([]);
  });

  it('backs out without changing anything', async () => {
    const { onChanged } = show();
    await userEvent.click(screen.getByRole('button', { name: /archive excavation crew a/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(hoisted.calls).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /archive excavation crew a/i })).toBeTruthy();
  });

  it('carries the promise in the button title too', async () => {
    show();
    expect(screen.getByRole('button', { name: /archive excavation crew a/i }).getAttribute('title'))
      .toMatch(/Nothing is deleted — you can bring it back/);
  });
});

describe('archiving, and the way back', () => {
  it('archives once confirmed', async () => {
    const { onChanged } = show();
    await userEvent.click(screen.getByRole('button', { name: /archive excavation crew a/i }));
    await userEvent.click(screen.getByRole('button', { name: /archive it/i }));
    await waitFor(() => expect(hoisted.calls).toEqual([
      { kind: 'crew', id: 'c-1', status: 'archived' },
    ]));
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers Restore on a row that is already archived', async () => {
    show({ status: 'archived' });
    const restore = screen.getByRole('button', { name: /restore/i });
    expect(restore.getAttribute('title')).toMatch(/bring Excavation Crew A back/i);
    await userEvent.click(restore);
    await waitFor(() => expect(hoisted.calls).toEqual([
      { kind: 'crew', id: 'c-1', status: 'active' },
    ]));
  });

  it('goes back through the same door, not a second one', async () => {
    /* Archive and restore are one function. A round trip needing two is a
       round trip somebody builds half of — which is how this started. */
    show({ status: 'archived' });
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(hoisted.calls[0]!.kind).toBe('crew'));
  });

  it('shows the refusal rather than pretending it worked', async () => {
    hoisted.reject = 'Crushed stone is shipped with GrounUp and is shared by every company';
    const { onChanged } = show();
    await userEvent.click(screen.getByRole('button', { name: /archive excavation crew a/i }));
    await userEvent.click(screen.getByRole('button', { name: /archive it/i }));
    await waitFor(() => expect(screen.getByText(/shipped with GrounUp/)).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('what it will not offer', () => {
  it('shows nothing at all on a shipped row', () => {
    /*
     * A shipped row belongs to every company on the platform, so the database
     * refuses to archive it. A button that exists only to be refused is worse
     * than no button.
     */
    const { container } = render(<ArchiveAction kind="service" id="s-1" name="Mass excavation"
      status="active" editable={false} canWrite onChanged={vi.fn()} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('is disabled without permission to write the libraries', () => {
    show({ canWrite: false });
    expect(screen.getByRole('button', { name: /archive excavation crew a/i })).toBeDisabled();
  });
});

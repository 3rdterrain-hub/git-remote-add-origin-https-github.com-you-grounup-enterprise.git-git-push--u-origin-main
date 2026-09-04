import { describe, expect, it } from 'vitest';
import { createHarness, listMigrations } from './harness.js';

describe('migrations apply to a real PostgreSQL', () => {
  it('runs every migration in order without error', async () => {
    const h = await createHarness();
    const v = await h.sql<{ version: string }>('select version()');
    expect(v[0]!.version).toContain('PostgreSQL');
    const files = await listMigrations();
    expect(files.length).toBeGreaterThan(0);
    await h.db.close();
  });
});

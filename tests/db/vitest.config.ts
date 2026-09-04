import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    // PGlite spins up a full Postgres per suite; give it room and keep the
    // suites serial so several WASM instances do not fight over memory.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

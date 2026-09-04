import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/governance/**/*.test.ts'], environment: 'node', testTimeout: 180_000 },
});

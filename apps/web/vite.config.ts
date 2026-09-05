import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  /*
   * Pinned to this file's own directory rather than left to the working
   * directory. Vite defaults the root to `process.cwd()`, so launching it from
   * the repository root with `--config apps/web/vite.config.ts` produced a
   * server that started cleanly, printed a URL, and served 404 for everything —
   * the worst kind of wrong, because it looks like it worked.
   */
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Matches the tsconfig path mapping: build from engine source, so the
      // app cannot be built against a stale dist.
      '@grounup/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: false },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        /*
         * React and the Radix primitives change far less often than application
         * code, so splitting them out lets a returning user re-use a cached
         * vendor chunk after every deploy.
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['lucide-react', 'class-variance-authority', 'clsx', 'tailwind-merge'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    /*
     * The suite must not read the developer's own workspace.
     *
     * Vite loads `.env.local` for tests as readily as for a dev server, so the
     * moment somebody connected a real Supabase project two tests began
     * failing — `isSupabaseConfigured` flipped to true, and a screen that falls
     * back to the sample user for permissions stopped falling back. The tests
     * had been passing because of an absent file.
     *
     * An empty prefix loads no VITE_ variables at all, so every run sees the
     * same unconfigured build. A test that wants the configured case mocks
     * `@/lib/supabase`, which is explicit and visible in the test itself.
     */
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
});

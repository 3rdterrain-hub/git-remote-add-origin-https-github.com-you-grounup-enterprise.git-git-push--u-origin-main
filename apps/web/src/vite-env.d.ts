/// <reference types="vite/client" />

/** Only public, browser-safe values belong here. Secrets live in Edge Function env. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

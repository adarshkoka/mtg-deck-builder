/// <reference types="vite/client" />

// The environment variables this app reads (see src/config.ts).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

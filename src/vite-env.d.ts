/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_PROVIDER: string;
  readonly VITE_INVESTODAY_API_KEY: string;
  readonly VITE_CLOUDBASE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

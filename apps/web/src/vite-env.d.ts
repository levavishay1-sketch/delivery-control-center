/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DCC_DEV_EMAIL?: string;
  readonly VITE_DCC_HOOK_TOKEN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

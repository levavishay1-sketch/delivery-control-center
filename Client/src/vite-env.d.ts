/// <reference types="vite/client" />

// No build-time settings: the signed-in user comes from the session (auth/session.ts).
interface ImportMetaEnv {}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

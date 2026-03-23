interface ImportMetaEnv {
  readonly VITE_DEFAULT_RELAYS?: string;
  readonly VITE_BIFROST_EVENT_KIND?: string;
  readonly VITE_IGLOO_DEBUG?: string;
  readonly VITE_IGLOO_VERBOSE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

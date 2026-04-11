/// <reference types="vite/client" />

import type { GladeApi } from "../shared/types";

declare global {
  interface Window {
    glade: GladeApi;
  }
}

export {};


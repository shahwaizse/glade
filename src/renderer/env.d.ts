/// <reference types="vite/client" />

import type { GladeApi } from "../shared/types";

declare global {
  interface Window {
    glade: GladeApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        allowpopups?: string;
        partition?: string;
        src?: string;
      };
    }
  }
}

export {};

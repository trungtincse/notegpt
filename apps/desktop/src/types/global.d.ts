import type { MdnoteApi } from "../../electron/preload";

declare global {
  interface Window {
    mdnote: MdnoteApi;
  }
}

export {};

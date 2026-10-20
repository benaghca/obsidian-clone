import { defineConfig } from "vite";
import tauriConf from "./src-tauri/tauri.conf.json" with { type: "json" };

// Settings follow the Tauri 2 + Vite guide: a fixed port the Tauri dev
// config can point at, and no watching of the Rust side.

// The Content-Security-Policy lives in src-tauri/tauri.conf.json. Tauri only
// applies it to pages it serves itself, and on desktop `tauri dev` loads the
// Vite server directly, so the dev server and `vite preview` send the same
// policy as a header. That way the browser, dev and release builds all run
// under it.
type Csp = Record<string, string | string[]>;
const security: { csp: Csp; devCsp?: Csp } = tauriConf.app.security;
const cspHeader = (csp: Csp) =>
  Object.entries(csp)
    .map(([directive, sources]) => `${directive} ${[sources].flat().join(" ")}`)
    .join("; ");

export default defineConfig(({ mode }) => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    headers: { "Content-Security-Policy": cspHeader(security.devCsp ?? security.csp) },
  },
  preview: {
    headers: { "Content-Security-Policy": cspHeader(security.csp) },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    // No source maps in release builds (the dev server always serves them);
    // `vite build --mode development` keeps them for debugging a bundle.
    sourcemap: mode !== "production",
    // The polyfill preloads chunks with the fetch API; the webview supports
    // modulepreload natively, and the bundle should hold no network calls.
    modulePreload: { polyfill: false },
    // lang-markdown brings the HTML/CSS/JS grammars for embedded HTML; the
    // bundle loads from disk inside Tauri, so ~600 kB is fine.
    chunkSizeWarningLimit: 1000,
  },
}));

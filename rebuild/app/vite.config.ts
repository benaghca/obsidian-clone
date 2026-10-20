import { defineConfig } from "vite";

// Settings follow the Tauri 2 + Vite guide: a fixed port the Tauri dev
// config can point at, and no watching of the Rust side.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    sourcemap: true,
    // lang-markdown brings the HTML/CSS/JS grammars for embedded HTML; the
    // bundle loads from disk inside Tauri, so ~600 kB is fine.
    chunkSizeWarningLimit: 1000,
  },
});

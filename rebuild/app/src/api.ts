// The only module that talks to the backend. Inside Tauri it calls the Rust
// commands from rebuild/CONTRACT.md; in a plain browser (npm run dev) it loads
// an in-memory mock vault instead, so the front end runs on its own.

import { isExternalUrl } from "./links";

export interface VaultInfo {
  path: string;
  name: string;
}

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  mtime_ms: number;
  size: number;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface Backlink {
  from: string;
  line: number;
  text: string;
}

export interface LinkIndex {
  outgoing: Record<string, string[]>;
  backlinks: Record<string, Backlink[]>;
}

export interface VaultChange {
  kind: "create" | "modify" | "remove" | "rename";
  paths: string[];
}

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export type Listen = (event: string, handler: (payload: unknown) => void) => Promise<() => void>;

export const isTauri = "__TAURI_INTERNALS__" in window;

let backend: Promise<{ invoke: Invoke; listen: Listen }> | null = null;

function load() {
  backend ??= isTauri
    ? Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]).then(
        ([core, event]) => ({
          invoke: core.invoke as Invoke,
          listen: (name: string, handler: (payload: unknown) => void) =>
            event.listen(name, (e) => handler(e.payload)),
        }),
      )
    : import("./mock/backend").then((m) => m.createMockBackend());
  return backend;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (await load()).invoke<T>(cmd, args);
}

/**
 * Hand an http(s) or mailto link to the system's default handler. Only ever
 * called from an explicit click: nothing in the app fetches, previews or
 * loads these URLs itself. In the browser mock it is only logged.
 */
async function openExternal(url: string): Promise<void> {
  url = url.trim();
  if (!isExternalUrl(url)) {
    console.warn(`Not opening ${url}: only http, https and mailto links open externally`);
    return;
  }
  if (!isTauri) {
    console.info(`[mock] would open externally: ${url}`);
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export const api = {
  openVault: (path: string) => call<VaultInfo>("open_vault", { path }),
  lastVault: () => call<VaultInfo | null>("last_vault"),
  listFiles: () => call<FileEntry[]>("list_files"),
  readNote: (path: string) => call<string>("read_note", { path }),
  writeNote: (path: string, content: string) => call<void>("write_note", { path, content }),
  createNote: (path: string, content: string) => call<FileEntry>("create_note", { path, content }),
  createFolder: (path: string) => call<FileEntry>("create_folder", { path }),
  renamePath: (from: string, to: string) => call<void>("rename_path", { from, to }),
  /** Move to the vault's .trash, or with `permanent` remove for good. */
  deletePath: (path: string, permanent = false) => call<void>("delete_path", { path, permanent }),
  search: (query: string, limit: number) => call<SearchHit[]>("search", { query, limit }),
  linkIndex: () => call<LinkIndex>("link_index"),
  /** A settings file from the vault's .grove folder (null if there is none yet). */
  readConfig: (name: string) => call<string | null>("read_config", { name }),
  /** Write a settings file (JSON) into the vault's .grove folder. */
  writeConfig: (name: string, content: string) => call<void>("write_config", { name, content }),
  openExternal,
  onVaultChanged: async (handler: (change: VaultChange) => void) =>
    (await load()).listen("vault-changed", (p) => handler(p as VaultChange)),
};

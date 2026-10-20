// The only module that talks to the backend. Inside Tauri it calls the Rust
// commands from rebuild/CONTRACT.md; in a plain browser (npm run dev) it loads
// an in-memory mock vault instead, so the front end runs on its own.

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

export const api = {
  openVault: (path: string) => call<VaultInfo>("open_vault", { path }),
  lastVault: () => call<VaultInfo | null>("last_vault"),
  listFiles: () => call<FileEntry[]>("list_files"),
  readNote: (path: string) => call<string>("read_note", { path }),
  writeNote: (path: string, content: string) => call<void>("write_note", { path, content }),
  createNote: (path: string, content: string) => call<FileEntry>("create_note", { path, content }),
  renamePath: (from: string, to: string) => call<void>("rename_path", { from, to }),
  deletePath: (path: string) => call<void>("delete_path", { path }),
  search: (query: string, limit: number) => call<SearchHit[]>("search", { query, limit }),
  linkIndex: () => call<LinkIndex>("link_index"),
  onVaultChanged: async (handler: (change: VaultChange) => void) =>
    (await load()).listen("vault-changed", (p) => handler(p as VaultChange)),
};

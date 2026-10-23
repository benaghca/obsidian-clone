// The only module that talks to the backend. Inside Tauri it calls the Rust
// commands from rebuild/CONTRACT.md; in a plain browser (npm run dev) it loads
// an in-memory mock vault instead, so the front end runs on its own.

import { isExternalUrl } from "./links/external";

export interface VaultInfo {
  path: string;
  name: string;
}

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  mtime_ms: number;
  /** When it was created (its modified time where the file system doesn't keep that; 0 for folders). */
  ctime_ms: number;
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
  /** Resolved [[wikilink]] targets per note. */
  outgoing: Record<string, string[]>;
  backlinks: Record<string, Backlink[]>;
  /** Resolved [text](path) link targets per note (not in outgoing or backlinks). */
  markdown?: Record<string, string[]>;
  /** Link targets that match no file, per note, as written. */
  unresolved?: Record<string, string[]>;
}

interface VaultChange {
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
  /** An image file's bytes (vault images only, at most 20 MB), for an embed. */
  readFileBytes: (path: string) => call<ArrayBuffer>("read_file_bytes", { path }),
  writeNote: (path: string, content: string) => call<void>("write_note", { path, content }),
  createNote: (path: string, content: string) => call<FileEntry>("create_note", { path, content }),
  createFolder: (path: string) => call<FileEntry>("create_folder", { path }),
  renamePath: (from: string, to: string) => call<void>("rename_path", { from, to }),
  /** Move to the vault's .trash, or with `permanent` remove for good. */
  deletePath: (path: string, permanent = false) => call<void>("delete_path", { path, permanent }),
  search: (query: string, limit: number) => call<SearchHit[]>("search", { query, limit }),
  linkIndex: () => call<LinkIndex>("link_index"),
  /** Each note's frontmatter block (`---` lines included), for `paths` or every note; notes without one are left out. */
  frontmatter: (paths?: string[]) => call<Record<string, string>>("frontmatter", { paths: paths ?? null }),
  /** A settings file from the vault's .grove folder (null if there is none yet). */
  readConfig: (name: string) => call<string | null>("read_config", { name }),
  /** Write a settings file (JSON) into the vault's .grove folder. */
  writeConfig: (name: string, content: string) => call<void>("write_config", { name, content }),
  openExternal,
  /** "Open in new window": the note in a window of its own (the browser preview only logs; `?note=` shows that window). */
  openNoteWindow: async (path: string) => {
    // Percent-encoded in full: the backend accepts nothing else in the URL.
    const note = encodeURIComponent(path).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    if (isTauri) await call<void>("open_note_window", { note });
    else console.info(`[mock] would open ?note=${note} in a new window`);
  },
  onVaultChanged: async (handler: (change: VaultChange) => void) =>
    (await load()).listen("vault-changed", (p) => handler(p as VaultChange)),
};

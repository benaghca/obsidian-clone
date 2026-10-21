// Bookmarked notes and folders, per vault. Kept in the webview's
// localStorage next to the layout prefs (nothing leaves the machine); a
// rename or move carries its bookmark along.

import { listeners } from "./listeners";
import { readStored, store } from "./storage";
import type { Workspace } from "./workspace";

const key = (vaultPath: string) => `grove.bookmarks:${vaultPath}`;

export class Bookmarks {
  private paths: string[] = [];
  private changes = listeners();
  /** Called after bookmarks are added, removed, moved or loaded. */
  readonly onChange = this.changes.on;

  constructor(private ws: Workspace) {
    ws.onMove((swap) => {
      const next = this.paths.map(swap);
      if (next.some((p, i) => p !== this.paths[i])) this.set(next);
    });
  }

  /** Read the open vault's bookmarks (after the vault is open). */
  load() {
    const saved = readStored(key(this.ws.vault.path), []);
    this.paths = Array.isArray(saved) ? saved.filter((p) => typeof p === "string") : [];
    this.changes.emit();
  }

  /** Bookmarked paths that still exist, in the order they were added. */
  list(): string[] {
    const existing = new Set(this.ws.vault.files.map((f) => f.path));
    return this.paths.filter((p) => existing.has(p));
  }

  has(path: string | null): boolean {
    return !!path && this.paths.includes(path);
  }

  toggle(path: string) {
    this.set(this.has(path) ? this.paths.filter((p) => p !== path) : [...this.paths, path]);
  }

  private set(paths: string[]) {
    this.paths = paths;
    store(key(this.ws.vault.path), paths); // without storage, bookmarks last for this session only
    this.changes.emit();
  }
}

// Bookmarked notes and folders, per vault. Kept in the webview's
// localStorage next to the layout prefs (nothing leaves the machine); a
// rename or move carries its bookmark along.

import type { Workspace } from "./workspace";

const key = (vaultPath: string) => `grove.bookmarks:${vaultPath}`;

export class Bookmarks {
  private paths: string[] = [];
  private listeners = new Set<() => void>();

  constructor(private ws: Workspace) {
    ws.onMove((swap) => {
      const next = this.paths.map(swap);
      if (next.some((p, i) => p !== this.paths[i])) this.set(next);
    });
  }

  /** Read the open vault's bookmarks (after the vault is open). */
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(key(this.ws.vault.path)) ?? "[]");
      this.paths = Array.isArray(saved) ? saved.filter((p) => typeof p === "string") : [];
    } catch {
      this.paths = [];
    }
    this.changed();
  }

  /** Bookmarked paths that still exist, in the order they were added. */
  list(): string[] {
    const existing = new Set(this.ws.files.map((f) => f.path));
    return this.paths.filter((p) => existing.has(p));
  }

  has(path: string | null): boolean {
    return !!path && this.paths.includes(path);
  }

  toggle(path: string) {
    this.set(this.has(path) ? this.paths.filter((p) => p !== path) : [...this.paths, path]);
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private set(paths: string[]) {
    this.paths = paths;
    try {
      localStorage.setItem(key(this.ws.vault.path), JSON.stringify(paths));
    } catch {
      // storage full or disabled: bookmarks last for this session only
    }
    this.changed();
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }
}

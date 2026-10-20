// App state: the vault's files, the open tabs with their back/forward
// history, and one EditorState per open note. A single EditorView shows the
// active tab; switching swaps states, so it costs no re-parse or re-render of
// unchanged notes.

import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isTauri, api, type FileEntry, type LinkIndex, type VaultInfo } from "./api";
import { createNoteState } from "./editor/editor";
import type { EditorHost, NoteRef } from "./editor/host";

export interface Tab {
  id: number;
  path: string | null;
  back: string[];
  forward: string[];
}

/** "show" fires when the view swaps to a different note (or tab), before "tabs". */
export type Change = "files" | "tabs" | "doc" | "links" | "show";

const SAVE_DELAY = 300;
const LINK_INDEX_DELAY = 1000;

export const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
export const parentDir = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export class Workspace {
  vault: VaultInfo = { path: "", name: "" };
  files: FileEntry[] = [];
  notes: NoteRef[] = [];
  links: LinkIndex = { outgoing: {}, backlinks: {} };
  tabs: Tab[] = [];
  active: Tab;
  /** Recently shown notes, most recent first. */
  recent: string[] = [];
  readonly view: EditorView;
  /** The element that scrolls the active note (set by the pane). */
  scroller: HTMLElement | null = null;

  private nextTabId = 1;
  private states = new Map<string, EditorState>();
  private scrollTops = new Map<string, number>();
  private saveTimers = new Map<string, number>();
  private linkTimer = 0;
  private listeners = new Set<(change: Change) => void>();
  private readonly host: EditorHost;
  private readonly updates = EditorView.updateListener.of((u) => {
    const path = this.active.path;
    if (!path || !u.docChanged) return;
    this.states.set(path, u.state);
    if (!u.transactions.some((tr) => tr.isUserEvent("external"))) this.scheduleSave(path);
    this.emit("doc");
  });

  constructor() {
    this.host = {
      openLink: (target, newTab) => void this.openLink(target, newTab),
      openUrl: (url) => window.open(url, "_blank", "noopener"),
      notes: () => this.notes,
    };
    this.view = new EditorView();
    this.active = this.addTab();
  }

  on(fn: (change: Change) => void) {
    this.listeners.add(fn);
  }

  private emit(change: Change) {
    for (const fn of this.listeners) fn(change);
  }

  async init() {
    const last = await api.lastVault();
    if (isTauri) {
      const path =
        last?.path ??
        window.prompt("Vault folder to open", "/home/chris/workspaces/remote/grove-test-vault");
      if (path) this.vault = await api.openVault(path);
    } else {
      this.vault = last ?? this.vault;
    }
    await this.refreshFiles();
    void this.refreshLinks();
    api.onVaultChanged((change) => void this.onVaultChanged(change.kind, change.paths));
  }

  async refreshFiles() {
    this.files = await api.listFiles();
    this.notes = this.files
      .filter((f) => !f.is_dir && f.path.endsWith(".md"))
      .map((f) => ({ name: noteName(f.path), path: f.path }));
    this.emit("files");
  }

  async refreshLinks() {
    this.links = await api.linkIndex();
    this.emit("links");
  }

  /** Resolve a link target the way Obsidian does: by note name, case-insensitively. */
  resolve(target: string): string | null {
    const name = target.split("#")[0].trim().toLowerCase();
    if (!name) return null;
    const byPath = this.notes.find((n) => n.path.toLowerCase() === `${name}.md`);
    return (byPath ?? this.notes.find((n) => n.name.toLowerCase() === name))?.path ?? null;
  }

  // ----- tabs -----

  addTab(): Tab {
    const tab: Tab = { id: this.nextTabId++, path: null, back: [], forward: [] };
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length;
    this.tabs.splice(at, 0, tab);
    return tab;
  }

  newTab() {
    this.activate(this.addTab());
  }

  closeTab(tab: Tab) {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.tabs.length === 0) this.tabs.push({ id: this.nextTabId++, path: null, back: [], forward: [] });
    if (tab === this.active) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)], true);
    else this.emit("tabs");
  }

  activate(tab: Tab, force = false) {
    if (tab === this.active && !force) return;
    this.rememberScroll();
    this.active = tab;
    this.show();
  }

  cycleTab(dir: 1 | -1) {
    const i = this.tabs.indexOf(this.active);
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
  }

  // ----- navigation -----

  /** Open a note in the active tab (or a new one), optionally at a 1-based line. */
  async open(path: string, opts: { newTab?: boolean; line?: number } = {}) {
    const state = await this.load(path);
    if (!state) return;
    this.rememberScroll();
    let tab = this.active;
    if (opts.newTab) tab = this.addTab();
    else if (tab.path !== path && tab.path) {
      tab.back.push(tab.path);
      tab.forward = [];
    }
    if (tab.path !== path || tab !== this.active) {
      tab.path = path;
      this.active = tab;
      this.show();
    }
    if (opts.line) {
      const line = this.view.state.doc.line(Math.min(opts.line, this.view.state.doc.lines));
      this.view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      this.view.focus();
    }
  }

  async openLink(target: string, newTab = false) {
    let path = this.resolve(target);
    if (!path) {
      const name = target.split("#")[0].trim();
      if (!name) return;
      path = (await this.createNote(`${name}.md`)).path;
    }
    await this.open(path, { newTab });
  }

  async goBack() {
    await this.travel(this.active.back, this.active.forward);
  }

  async goForward() {
    await this.travel(this.active.forward, this.active.back);
  }

  private async travel(from: string[], to: string[]) {
    const tab = this.active;
    const path = from.pop();
    if (!path) return;
    if (!(await this.load(path))) return;
    this.rememberScroll();
    if (tab.path) to.push(tab.path);
    tab.path = path;
    this.show();
  }

  private async load(path: string): Promise<EditorState | null> {
    let state = this.states.get(path);
    if (state) return state;
    try {
      const doc = await api.readNote(path);
      state = createNoteState({ doc, host: this.host, extensions: this.updates });
      this.states.set(path, state);
      return state;
    } catch (err) {
      console.error(`Could not open ${path}`, err);
      return null;
    }
  }

  private rememberScroll() {
    if (this.active?.path && this.scroller) this.scrollTops.set(this.active.path, this.scroller.scrollTop);
  }

  private show() {
    const path = this.active.path;
    if (path) {
      this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, 50);
      const state = this.states.get(path)!;
      if (this.view.state !== state) this.view.setState(state);
    }
    this.emit("show");
    this.emit("tabs");
    if (path && this.scroller) this.scroller.scrollTop = this.scrollTops.get(path) ?? 0;
    if (path) this.view.focus();
  }

  // ----- files -----

  async createNote(path: string, content = ""): Promise<FileEntry> {
    const entry = await api.createNote(path, content);
    await this.refreshFiles();
    return entry;
  }

  /** Create "Untitled.md" (or "Untitled 1.md", ...) at the vault root and open it. */
  async newNote(): Promise<string> {
    const taken = new Set(this.files.map((f) => f.path.toLowerCase()));
    let name = "Untitled";
    for (let i = 1; taken.has(`${name.toLowerCase()}.md`); i++) name = `Untitled ${i}`;
    const entry = await this.createNote(`${name}.md`);
    await this.open(entry.path, { newTab: this.active.path !== null });
    return entry.path;
  }

  async rename(path: string, newName: string) {
    newName = newName.trim().replace(/[\\/:]/g, "");
    if (!newName || newName === noteName(path)) return;
    const dir = parentDir(path);
    const to = `${dir ? dir + "/" : ""}${newName}.md`;
    if (this.files.some((f) => f.path.toLowerCase() === to.toLowerCase())) throw new Error(`"${newName}" already exists`);
    await this.flush(path);
    await api.renamePath(path, to);
    const move = <T>(map: Map<string, T>) => {
      if (map.has(path)) {
        map.set(to, map.get(path)!);
        map.delete(path);
      }
    };
    move(this.states);
    move(this.scrollTops);
    const swap = (p: string) => (p === path ? to : p);
    for (const tab of this.tabs) {
      if (tab.path === path) tab.path = to;
      tab.back = tab.back.map(swap);
      tab.forward = tab.forward.map(swap);
    }
    await this.refreshFiles();
    this.emit("tabs");
    void this.refreshLinks();
  }

  async remove(path: string) {
    await this.flush(path);
    await api.deletePath(path);
    this.states.delete(path);
    this.scrollTops.delete(path);
    for (const tab of this.tabs) {
      tab.back = tab.back.filter((p) => p !== path);
      tab.forward = tab.forward.filter((p) => p !== path);
      if (tab.path === path) tab.path = null;
    }
    await this.refreshFiles();
    this.show();
    void this.refreshLinks();
  }

  // ----- saving -----

  private scheduleSave(path: string) {
    clearTimeout(this.saveTimers.get(path));
    this.saveTimers.set(path, window.setTimeout(() => void this.save(path), SAVE_DELAY));
  }

  private async save(path: string) {
    this.saveTimers.delete(path);
    const state = this.states.get(path);
    if (!state) return;
    try {
      await api.writeNote(path, state.doc.toString());
    } catch (err) {
      console.error(`Could not save ${path}`, err);
      return;
    }
    clearTimeout(this.linkTimer);
    this.linkTimer = window.setTimeout(() => void this.refreshLinks(), LINK_INDEX_DELAY);
  }

  private async flush(path: string) {
    if (this.saveTimers.has(path)) {
      clearTimeout(this.saveTimers.get(path));
      await this.save(path);
    }
  }

  async flushAll() {
    await Promise.all([...this.saveTimers.keys()].map((p) => this.flush(p)));
  }

  // ----- outside changes -----

  private async onVaultChanged(kind: string, paths: string[]) {
    if (kind !== "modify") await this.refreshFiles();
    for (const path of paths) {
      const state = this.states.get(path);
      if (!state || this.saveTimers.has(path)) continue;
      if (kind === "remove") continue;
      const doc = await api.readNote(path).catch(() => null);
      if (doc === null || doc === state.doc.toString()) continue;
      const tr = state.update({ changes: { from: 0, to: state.doc.length, insert: doc }, userEvent: "external" });
      if (this.active.path === path) this.view.dispatch(tr);
      else this.states.set(path, tr.state);
    }
    void this.refreshLinks();
  }
}

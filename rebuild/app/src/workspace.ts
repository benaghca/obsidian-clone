// App state: the vault's files, the open tabs with their back/forward
// history, and one EditorState per open note. A single EditorView shows the
// active tab; switching swaps states, so it costs no re-parse or re-render of
// unchanged notes.

import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isTauri, api, type FileEntry, type LinkIndex, type VaultInfo } from "./api";
import { createNoteState, VIEW_MODES, type ViewMode, viewModeCompartment, viewModeOf } from "./editor/editor";
import { headingPos } from "./editor/headings";
import type { EditorHost, NoteRef } from "./editor/host";
import { duration, nextFrame, smoothScrollTo } from "./motion";

export interface Tab {
  id: number;
  path: string | null;
  back: string[];
  forward: string[];
  /** Live Preview, Source mode or Reading view, per tab like Obsidian's. */
  mode: ViewMode;
  /** A pinned tab keeps its note: links followed from it open in a new tab. */
  pinned: boolean;
}

/**
 * "show" fires when the view swaps to a different note (or tab), before
 * "tabs". "mode" fires when a tab switches between editing and reading.
 */
export type Change = "files" | "tabs" | "doc" | "links" | "show" | "mode";

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
  /** Shows the editor's right-click menu (set by the app). */
  editorMenu: EditorHost["contextMenu"];

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
      openUrl: (url) => void api.openExternal(url).catch((err) => console.error(`Could not open ${url}`, err)),
      notes: () => this.notes,
      contextMenu: (view, at, pos, keyboard) => this.editorMenu?.(view, at, pos, keyboard),
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

  private blankTab(): Tab {
    return { id: this.nextTabId++, path: null, back: [], forward: [], mode: "live", pinned: false };
  }

  addTab(): Tab {
    const tab = this.blankTab();
    const at = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length;
    this.tabs.splice(at, 0, tab);
    return tab;
  }

  newTab() {
    this.activate(this.addTab());
  }

  closeTab(tab: Tab) {
    this.closeTabs([tab]);
  }

  /** Close several tabs at once; the active one passes to its nearest open neighbour. */
  closeTabs(close: Tab[]) {
    const gone = new Set(close.filter((t) => this.tabs.includes(t)));
    if (!gone.size) return;
    const at = this.tabs.indexOf(this.active);
    const keep = this.tabs.filter((t) => !gone.has(t));
    if (!gone.has(this.active)) {
      this.tabs = keep;
      return this.emit("tabs");
    }
    // The nearest survivor to the right of the active tab, else to its left.
    const next = this.tabs.slice(at + 1).find((t) => !gone.has(t)) ?? [...this.tabs.slice(0, at)].reverse().find((t) => !gone.has(t));
    this.tabs = keep;
    if (!next) this.tabs.push(this.blankTab());
    this.activate(next ?? this.tabs[0], true);
  }

  /** Obsidian's "Close others", "Close tabs to the right" and "Close all" leave pinned tabs open. */
  closeOthers(tab: Tab) {
    this.closeTabs(this.tabs.filter((t) => t !== tab && !t.pinned));
  }

  closeToRight(tab: Tab) {
    this.closeTabs(this.tabs.slice(this.tabs.indexOf(tab) + 1).filter((t) => !t.pinned));
  }

  closeAll() {
    this.closeTabs(this.tabs.filter((t) => !t.pinned));
  }

  togglePin(tab: Tab = this.active) {
    tab.pinned = !tab.pinned;
    this.emit("tabs");
  }

  /** Switch a tab between Live Preview, Source mode and Reading view. */
  setMode(mode: ViewMode, tab: Tab = this.active) {
    if (tab.mode === mode) return;
    tab.mode = mode;
    if (tab === this.active) this.applyMode();
    this.emit("mode");
  }

  /** Configure the shown note's state for the active tab's mode (a no-op when it already is). */
  private applyMode() {
    const mode = this.active.path ? this.active.mode : "live";
    if (viewModeOf(this.view.state) !== mode) {
      this.view.dispatch({ effects: viewModeCompartment.reconfigure(VIEW_MODES[mode]) });
    }
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

  /**
   * Open a note in the active tab (or a new one), optionally at a 1-based
   * line (selecting columns `ch` of it) or at a heading.
   */
  async open(path: string, opts: { newTab?: boolean; line?: number; ch?: [number, number]; heading?: string } = {}) {
    const state = await this.load(path);
    if (!state) return;
    // A pinned tab keeps its note; anything else opened from it gets a new tab.
    if (this.active.pinned && this.active.path && this.active.path !== path) opts = { ...opts, newTab: true };
    const alreadyShown = !opts.newTab && this.active.path === path;
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
    const doc = this.view.state.doc;
    const line = opts.line ? doc.line(Math.min(opts.line, doc.lines)) : null;
    const pos = line ? line.from : opts.heading ? headingPos(doc, opts.heading) : null;
    if (pos === null) return;
    const clamp = (ch: number) => Math.min(line!.to, line!.from + ch);
    const selection = line && opts.ch ? { anchor: clamp(opts.ch[0]), head: clamp(opts.ch[1]) } : { anchor: pos };
    // Within the note on screen the jump glides; into a just-switched note
    // it lands at once, so the first frame already shows the target.
    if (alreadyShown) this.jumpTo(selection);
    else {
      this.view.dispatch({ selection, effects: EditorView.scrollIntoView(selection.anchor, { y: "center" }) });
      this.view.focus();
    }
  }

  /** Put the caret (or a selection) in the open note and glide it into view. */
  jumpTo(selection: { anchor: number; head?: number }) {
    this.view.dispatch({ selection });
    void this.glideTo(selection.anchor);
    this.view.focus();
  }

  /** Follow a link target: "Note", "Note#Heading", or "#Heading" in the open note. */
  async openLink(target: string, newTab = false) {
    const hash = target.indexOf("#");
    const name = (hash < 0 ? target : target.slice(0, hash)).trim();
    const heading = hash < 0 ? undefined : target.slice(hash + 1);
    let path = name ? this.resolve(name) : this.active.path;
    if (!path) {
      if (!name) return;
      path = (await this.createNote(`${name}.md`)).path;
    }
    await this.open(path, { newTab, heading });
  }

  /**
   * Smoothly scroll a document position to the middle of the view. A long jump
   * cuts to one screen short of the target first, so the editor never has to
   * render every line in between.
   */
  private async glideTo(pos: number) {
    const scroller = this.scroller;
    if (!scroller || duration("slow") <= 0) {
      this.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      return;
    }
    const targetTop = () => {
      const block = this.view.lineBlockAt(pos);
      const docTop = this.view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const top = docTop + block.top - (scroller.clientHeight - block.height) / 2;
      return Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, top));
    };
    const distance = targetTop() - scroller.scrollTop;
    if (Math.abs(distance) > 2 * scroller.clientHeight) {
      scroller.scrollTop = targetTop() - Math.sign(distance) * scroller.clientHeight;
      // Two frames: CodeMirror reads the new viewport, then measures its lines.
      await nextFrame();
      await nextFrame();
    }
    // Re-aimed every frame: line heights estimated before CodeMirror measured
    // them can move the target a little while the scroll is under way.
    await smoothScrollTo(scroller, targetTop);
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
      this.applyMode();
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

  /** Create "Untitled.md" (or "Untitled 1.md", ...) in a folder (the vault root by default) and open it. */
  async newNote(folder = ""): Promise<string> {
    const entry = await this.createNote(this.freeName(folder, ".md"));
    await this.open(entry.path, { newTab: this.active.path !== null });
    return entry.path;
  }

  /** Rename a note (keeping its folder and .md) or a folder. */
  async rename(path: string, newName: string) {
    newName = newName.trim().replace(/[\\/:]/g, "");
    const isDir = this.isFolder(path);
    if (!newName || newName === (isDir ? path.slice(path.lastIndexOf("/") + 1) : noteName(path))) return;
    const dir = parentDir(path);
    await this.relocate(path, `${dir ? dir + "/" : ""}${newName}${isDir ? "" : ".md"}`);
  }

  /** Move a note or folder into another folder ("" for the vault root). */
  async moveTo(path: string, folder: string) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const to = folder ? `${folder}/${name}` : name;
    if (to !== path) await this.relocate(path, to);
  }

  isFolder(path: string) {
    return this.files.some((f) => f.path === path && f.is_dir);
  }

  /**
   * Move a file or folder, and everything open that points into it: tabs,
   * their history, loaded notes and recents follow.
   */
  private async relocate(from: string, to: string) {
    const clash = this.files.find((f) => f.path.toLowerCase() === to.toLowerCase());
    if (clash && clash.path !== from) throw new Error(`"${to}" already exists`);
    const under = (p: string) => p === from || p.startsWith(from + "/");
    await Promise.all([...this.saveTimers.keys()].filter(under).map((p) => this.flush(p)));
    await api.renamePath(from, to);
    const swap = (p: string) => (under(p) ? to + p.slice(from.length) : p);
    for (const map of [this.states, this.scrollTops] as Map<string, unknown>[]) {
      for (const [key, value] of [...map]) {
        if (!under(key)) continue;
        map.delete(key);
        map.set(swap(key), value);
      }
    }
    for (const tab of this.tabs) {
      if (tab.path) tab.path = swap(tab.path);
      tab.back = tab.back.map(swap);
      tab.forward = tab.forward.map(swap);
    }
    this.recent = this.recent.map(swap);
    for (const fn of this.moveListeners) fn(swap);
    await this.refreshFiles();
    this.emit("tabs");
    void this.refreshLinks();
  }

  private moveListeners = new Set<(swap: (path: string) => string) => void>();

  /** Called with a path-mapping function after anything is renamed or moved. */
  onMove(fn: (swap: (path: string) => string) => void) {
    this.moveListeners.add(fn);
  }

  /** A free "Untitled" name in a folder: "Untitled", "Untitled 1", ... */
  private freeName(folder: string, ext: string) {
    const taken = new Set(this.files.map((f) => f.path.toLowerCase()));
    const at = (name: string) => `${folder ? folder + "/" : ""}${name}${ext}`;
    let name = "Untitled";
    for (let i = 1; taken.has(at(name).toLowerCase()); i++) name = `Untitled ${i}`;
    return at(name);
  }

  /** Create an empty "Untitled" folder; returns its path. */
  async newFolder(parent = ""): Promise<string> {
    const entry = await api.createFolder(this.freeName(parent, ""));
    await this.refreshFiles();
    return entry.path;
  }

  /** Obsidian's "Make a copy": "Name 1.md" beside the note, opened in the active tab. */
  async makeCopy(path: string): Promise<string> {
    await this.flush(path);
    const content = this.states.get(path)?.doc.toString() ?? (await api.readNote(path));
    const taken = new Set(this.files.map((f) => f.path.toLowerCase()));
    const base = path.replace(/\.md$/, "");
    let n = 1;
    while (taken.has(`${base} ${n}.md`.toLowerCase())) n++;
    const entry = await this.createNote(`${base} ${n}.md`, content);
    await this.open(entry.path);
    return entry.path;
  }

  /** Delete a note or folder (the backend moves it to the vault's .trash). */
  async remove(path: string) {
    const under = (p: string) => p === path || p.startsWith(path + "/");
    await Promise.all([...this.saveTimers.keys()].filter(under).map((p) => this.flush(p)));
    await api.deletePath(path);
    for (const p of [...this.states.keys()].filter(under)) this.states.delete(p);
    for (const p of [...this.scrollTops.keys()].filter(under)) this.scrollTops.delete(p);
    this.recent = this.recent.filter((p) => !under(p));
    for (const tab of this.tabs) {
      tab.back = tab.back.filter((p) => !under(p));
      tab.forward = tab.forward.filter((p) => !under(p));
      if (tab.path && under(tab.path)) tab.path = null;
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

// App state: the vault's files, the layout of tab groups (splits, see
// layout.ts) with each tab's back/forward history, and one EditorState per
// open note. Each tab group has its own EditorView showing its active tab;
// switching swaps states, so it costs no re-parse or re-render of unchanged
// notes.
//
// The same note in two panes: the note's main state (with its undo history)
// is shown by exactly one of them. Every other pane showing that note gets a
// light mirror state of the same document without a history of its own.
// Whatever pane a change is typed in, it is applied there and then forwarded
// to the other panes as a transaction annotated as a copy, so all of them
// stay in step, each with its own selection and scroll position. Undo in a
// mirror runs on the main state. Saving and the "doc" event follow the
// original change only, so a note is still saved once.

import { redo, undo } from "@codemirror/commands";
import { Annotation, EditorSelection, type EditorState, Prec, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { isTauri, api, type FileEntry, type LinkIndex, type VaultInfo } from "./api";
import { countsField } from "./editor/counts";
import { configEffects } from "./editor/config";
import { createNoteState, VIEW_MODES, type ViewMode, viewModeCompartment, viewModeOf } from "./editor/editor";
import { headingPos } from "./editor/headings";
import type { EditorHost, NoteRef } from "./editor/host";
import { type Edge, Layout, type LayoutJSON, type TabGroup } from "./layout";
import { formatLink, type LinkStyle, resolveLink } from "./links/internal";
import { duration, nextFrame, smoothScrollTo } from "./motion";
import { fileName, isUnder, movedPath, noteName, parentDir } from "./paths";

export interface Tab {
  id: number;
  path: string | null;
  back: string[];
  forward: string[];
  /** Live Preview, Source mode or Reading view, per tab like Obsidian's. */
  mode: ViewMode;
  /** A pinned tab keeps its note: links followed from it open in a new tab. */
  pinned: boolean;
  /** Backlinks shown under the note (Obsidian's "Backlinks in document"). */
  backlinks: boolean;
  /** Where this tab left its note (scroll, selection), restored when it shows that note again. */
  memory: TabMemory | null;
  /** A view instead of a note: the graph, or the local graph of `graphFile` (path is null then). */
  type?: ViewType;
  /** The note a local graph shows (it follows the note open in the active pane). */
  graphFile?: string | null;
}

/** The views a tab can show instead of a note. */
export type ViewType = "graph" | "localgraph";

/**
 * Back/forward history entries are note paths, or one of these for a view
 * ("\0graph", "\0localgraph\0Note.md"); no path starts with a NUL.
 */
export function viewEntry(tab: { type?: ViewType; graphFile?: string | null }): string {
  return tab.type === "localgraph" ? `\0localgraph\0${tab.graphFile ?? ""}` : "\0graph";
}

export function parseViewEntry(entry: string): { type: ViewType; file: string | null } | null {
  if (!entry.startsWith("\0")) return null;
  if (entry.startsWith("\0localgraph\0")) return { type: "localgraph", file: entry.slice(12) || null };
  return { type: "graph", file: null };
}

/** A tab's title: its note's name, the view's name, or "New tab". */
export function tabTitle(tab: Tab): string {
  if (tab.type === "graph") return "Graph view";
  if (tab.type === "localgraph") return tab.graphFile ? `Graph of ${noteName(tab.graphFile)}` : "Local graph";
  return tab.path ? noteName(tab.path) : "New tab";
}

export interface TabMemory {
  path: string;
  /** null: no position to restore (a split places its pane by a line instead). */
  scrollTop: number | null;
  selection: EditorSelection | null;
}

export type Group = TabGroup<Tab>;

/**
 * Where to open a note, like Obsidian's: in the tab (false), a new tab, or a
 * new tab group to the right of (or below) the pane.
 */
export type OpenWhere = false | "tab" | "right" | "down";

/** Ctrl/Cmd+Alt+click opens to the right, Ctrl/Cmd+click in a new tab, as in Obsidian. */
export function whereFromEvent(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): OpenWhere {
  const mod = e.ctrlKey || e.metaKey;
  return mod && e.altKey ? "right" : mod ? "tab" : false;
}

/**
 * - "files": the vault's file list changed.
 * - "tabs": a tab bar or view header needs redrawing (tabs, titles, pins, history, active pane).
 * - "layout": tab groups were added, removed or moved (the split tree changed).
 * - "pane": a pane swapped to a different note or tab (listeners get the group).
 * - "show": the active pane now shows a different note, or another pane became active.
 * - "doc": a note's text changed. "links": the link index refreshed.
 * - "mode": a tab switched between editing and reading.
 */
export type Change = "files" | "tabs" | "layout" | "pane" | "show" | "doc" | "links" | "mode";

/** A tab group's editor and what it shows. */
interface Pane {
  group: Group;
  view: EditorView;
  scroller: HTMLElement | null;
  /** The tab and note on screen (null: the empty "New tab" state). */
  tab: Tab | null;
  path: string | null;
}

interface SavedTab {
  path: string | null;
  type?: ViewType;
  file?: string | null;
  mode: ViewMode;
  pinned: boolean;
  backlinks?: boolean;
  back: string[];
  forward: string[];
  scroll?: number;
  sel?: [number, number];
}

export interface SavedWorkspace {
  v: 1;
  root: LayoutJSON<SavedTab>;
  active: number;
}

interface ClosedTab {
  saved: SavedTab;
  group: Group;
  index: number;
}

const SAVE_DELAY = 300;
const LINK_INDEX_DELAY = 1000;
const CLOSED_MAX = 20;

/** Marks a change copied from the pane it was typed in to another pane showing the same note. */
const copied = Annotation.define<boolean>();

/** A saved selection, kept inside a (possibly shorter) document. */
function clampSelection(sel: EditorSelection, length: number): EditorSelection {
  return EditorSelection.create(
    sel.ranges.map((r) => EditorSelection.range(Math.min(r.anchor, length), Math.min(r.head, length))),
    sel.mainIndex,
  );
}

export class Workspace {
  vault: VaultInfo = { path: "", name: "" };
  files: FileEntry[] = [];
  notes: NoteRef[] = [];
  links: LinkIndex = { outgoing: {}, backlinks: {} };
  layout: Layout<Tab>;
  /** Recently shown notes, most recent first. */
  recent: string[] = [];
  /** Shows the editor's right-click menu (set by the app). */
  editorMenu: EditorHost["contextMenu"];
  /** The mode a new tab starts in (Settings → Editor: default view and editing mode). */
  newTabMode: () => ViewMode = () => "live";
  /** Whether a new tab shows backlinks under its note (Settings → Backlinks). */
  newTabBacklinks: () => boolean = () => false;
  /** The editing mode new notes open in (Live Preview or Source mode). */
  editingMode: () => ViewMode = () => "live";
  /** Where "Create new note" puts a note when no folder is given (Settings → Files and links). */
  newNoteFolder: () => string = () => "";
  /** Whether deleting removes for good instead of moving to the vault's .trash. */
  permanentDelete: () => boolean = () => false;
  /** Asked before a delete that wasn't confirmed already; false cancels it. */
  confirmDelete: ((path: string) => Promise<boolean>) | null = null;
  /** How new links are written (Settings → Files and links). */
  linkStyle: () => LinkStyle = () => ({ format: "shortest", wikilinks: true });
  /** Asked before merging one note into another; false cancels. */
  confirmMerge: ((from: string, into: string) => Promise<boolean>) | null = null;
  /** Excluded files (Settings → Files and links): left out of the switcher, search, suggestions. */
  isExcluded: (path: string) => boolean = () => false;
  /** Told after a note or folder moved, with the notes as they were before (to update links). */
  onRenamed: ((from: string, to: string, before: NoteRef[]) => void) | null = null;

  private nextTabId = 1;
  private panes = new Map<Group, Pane>();
  private paneOfView = new Map<EditorView, Pane>();
  /** Each loaded note's main state: the source of truth, holding its undo history. */
  private states = new Map<string, EditorState>();
  /** The view showing a note's main state, while any pane shows the note. */
  private owners = new Map<string, EditorView>();
  /** Last scroll position per note, for a tab arriving at it through history. */
  private scrollTops = new Map<string, number>();
  private saveTimers = new Map<string, number>();
  private linkTimer = 0;
  private listeners = new Set<(change: Change, group?: Group) => void>();
  private shownKey = "";
  private closed: ClosedTab[] = [];
  private readonly host: EditorHost;
  /** Mirrors have no history: undo and redo there act on the note's main state. */
  private readonly mirrorKeys = Prec.high(
    keymap.of([
      { key: "Mod-z", run: (v) => this.historyCommand(v, false), preventDefault: true },
      { key: "Mod-y", mac: "Mod-Shift-z", run: (v) => this.historyCommand(v, true), preventDefault: true },
      { linux: "Mod-Shift-z", win: "Mod-Shift-z", run: (v) => this.historyCommand(v, true), preventDefault: true },
    ]),
  );

  constructor() {
    this.host = {
      openLink: (target, where, view) => void this.openLink(target, where, view ? this.paneOfView.get(view)?.group : undefined),
      openUrl: (url) => void api.openExternal(url).catch((err) => console.error(`Could not open ${url}`, err)),
      notes: () => this.includedNotes(),
      formatLink: (target, view, display) => this.linkTo(target, this.paneOfView.get(view)?.path ?? null, display),
      contextMenu: (view, at, pos, keyboard) => {
        const pane = this.paneOfView.get(view);
        if (pane) this.focusGroup(pane.group);
        this.editorMenu?.(view, at, pos, keyboard);
      },
    };
    this.layout = new Layout(this.blankTab());
    this.pane(this.layout.activeGroup);
  }

  on(fn: (change: Change, group?: Group) => void) {
    this.listeners.add(fn);
  }

  off(fn: (change: Change, group?: Group) => void) {
    this.listeners.delete(fn);
  }

  private emit(change: Change, group?: Group) {
    for (const fn of this.listeners) fn(change, group);
  }

  // ----- the active pane -----

  get activeGroup(): Group {
    return this.layout.activeGroup;
  }

  /** The active pane's tab. */
  get active(): Tab {
    return this.layout.activeGroup.active;
  }

  /** The active pane's tabs. */
  get tabs(): Tab[] {
    return this.layout.activeGroup.tabs;
  }

  /** The active pane's editor. */
  get view(): EditorView {
    return this.pane(this.layout.activeGroup).view;
  }

  /** The element that scrolls the active pane's note. */
  get scroller(): HTMLElement | null {
    return this.pane(this.layout.activeGroup).scroller;
  }

  groups(): Group[] {
    return this.layout.groups();
  }

  groupOf(tab: Tab): Group | undefined {
    return this.layout.groupOf(tab);
  }

  viewOf(group: Group): EditorView {
    return this.pane(group).view;
  }

  groupOfView(view: EditorView): Group | undefined {
    return this.paneOfView.get(view)?.group;
  }

  /** The pane (UI) hands over the element that scrolls a group's note; its scroll is restored. */
  setScroller(group: Group, el: HTMLElement) {
    const pane = this.pane(group);
    pane.scroller = el;
    const memory = pane.tab?.memory;
    if (memory && memory.path === pane.path && memory.scrollTop !== null) el.scrollTop = memory.scrollTop;
  }

  /** The tab group's editor, created with the group. */
  private pane(group: Group): Pane {
    let pane = this.panes.get(group);
    if (pane) return pane;
    const view = new EditorView({ dispatchTransactions: (trs, v) => this.dispatch(trs, v) });
    pane = { group, view, scroller: null, tab: null, path: null };
    this.panes.set(group, pane);
    this.paneOfView.set(view, pane);
    return pane;
  }

  /** Make a pane the active one (a click or focus inside it). */
  focusGroup(group: Group) {
    if (group === this.layout.activeGroup || !this.panes.has(group)) return;
    this.layout.activeGroup = group;
    this.settle();
  }

  /**
   * After any change to tabs or panes: redraw the tab bars, and tell the
   * views following the active pane if it now shows something else.
   */
  private settle(layoutChanged = false) {
    if (layoutChanged) this.emit("layout");
    this.emit("tabs");
    const group = this.layout.activeGroup;
    const key = `${group.id}:${group.active.id}:${group.active.path}:${group.active.type ?? ""}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.emit("show");
    }
  }

  // ----- vault -----

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

  /**
   * Resolve a link target the way Obsidian does: a path from the vault
   * folder or from the linking note's folder, or a note name, any case.
   */
  resolve(target: string, from: string | null = this.active.path): string | null {
    return resolveLink(target, from, this.notes);
  }

  // ----- showing notes in panes -----

  /**
   * Make a group's editor show its active tab. A note already on screen in
   * another pane gets a mirror state here; otherwise this pane takes the
   * note's main state. Returns false when it already showed that tab.
   */
  private present(group: Group): boolean {
    const pane = this.pane(group);
    const tab = group.active;
    const path = tab.path;
    if (pane.tab === tab && pane.path === path) {
      if (path) this.applyMode(pane.view, tab.mode);
      return false;
    }
    if (path && !this.states.has(path)) {
      // A restored tab whose note isn't loaded yet: show it once it is.
      void this.load(path).then((state) => {
        if (state && group.active === tab && this.panes.get(group) === pane && this.present(group)) this.settle();
      });
      return false;
    }
    this.stash(pane);
    pane.tab = tab;
    pane.path = path;
    if (path) {
      const memory = tab.memory?.path === path ? tab.memory : null;
      const owner = this.owners.get(path);
      if (!owner) {
        let state = this.states.get(path)!;
        if (memory?.selection && !memory.selection.eq(state.selection)) {
          state = state.update({ selection: clampSelection(memory.selection, state.doc.length) }).state;
        }
        this.states.set(path, state);
        if (pane.view.state !== state) pane.view.setState(state);
        this.owners.set(path, pane.view);
      } else {
        const doc = owner.state.doc;
        pane.view.setState(
          createNoteState({
            doc,
            host: this.host,
            history: false,
            extensions: this.mirrorKeys,
            selection: clampSelection(memory?.selection ?? owner.state.selection, doc.length),
            counts: owner.state.field(countsField, false),
          }),
        );
      }
      this.applyMode(pane.view, tab.mode);
      this.applyConfig(pane.view);
      this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, 50);
    }
    this.emit("pane", group);
    if (path && pane.scroller) {
      const top = memoryOf(tab, path)?.scrollTop;
      if (top !== null) pane.scroller.scrollTop = top ?? this.scrollTops.get(path) ?? 0;
    }
    return true;
  }

  /** Remember where a pane's tab is in its note, and let go of the note. */
  private stash(pane: Pane) {
    this.remember(pane);
    this.release(pane);
  }

  private remember(pane: Pane) {
    if (!pane.tab || !pane.path) return;
    const scrollTop = pane.scroller?.scrollTop ?? 0;
    pane.tab.memory = { path: pane.path, scrollTop, selection: pane.view.state.selection };
    this.scrollTops.set(pane.path, scrollTop);
  }

  /**
   * The pane stops showing its note. If it held the main state and another
   * pane still shows the note, that pane takes the main state over (keeping
   * its own selection and scroll), so a note on screen always has its main
   * state on screen and edits never have to update a hidden copy.
   */
  private release(pane: Pane) {
    const path = pane.path;
    pane.tab = null;
    pane.path = null;
    if (!path || this.owners.get(path) !== pane.view) return;
    this.owners.delete(path);
    this.states.set(path, pane.view.state);
    const heir = [...this.panes.values()].find((p) => p !== pane && p.path === path);
    if (!heir) return;
    const scrollTop = heir.scroller?.scrollTop;
    const main = this.states.get(path)!;
    const state = main.update({ selection: clampSelection(heir.view.state.selection, main.doc.length) }).state;
    this.states.set(path, state);
    heir.view.setState(state);
    this.owners.set(path, heir.view);
    if (heir.tab) this.applyMode(heir.view, heir.tab.mode);
    this.applyConfig(heir.view);
    if (heir.scroller && scrollTop !== undefined) heir.scroller.scrollTop = scrollTop;
  }

  /** Configure a view's state for its tab's mode (a no-op when it already is). */
  private applyMode(view: EditorView, mode: ViewMode) {
    if (viewModeOf(view.state) !== mode) view.dispatch({ effects: viewModeCompartment.reconfigure(VIEW_MODES[mode]) });
  }

  /** Bring a view's state up to the current editor settings (a no-op when it already is). */
  private applyConfig(view: EditorView) {
    const effects = configEffects(view.state);
    if (effects.length) view.dispatch({ effects });
  }

  /**
   * The editor settings changed: reconfigure every editor on screen in place
   * (one transaction each, nothing re-created). Notes off screen catch up
   * when they are next shown.
   */
  reconfigureEditors() {
    for (const pane of this.panes.values()) if (pane.path) this.applyConfig(pane.view);
  }

  /** Every transaction of every pane's editor comes through here. */
  private dispatch(trs: readonly Transaction[], view: EditorView) {
    view.update(trs);
    if (!trs.some((tr) => tr.docChanged)) return;
    const pane = this.paneOfView.get(view);
    const path = pane?.path;
    if (!path) return;
    if (this.owners.get(path) === view) this.states.set(path, view.state);
    for (const tr of trs) {
      if (!tr.docChanged || tr.annotation(copied)) continue;
      this.forward(path, tr, view);
      if (!tr.isUserEvent("external")) this.scheduleSave(path);
    }
    this.emit("doc");
  }

  /** Copy a change to every other pane showing the note. */
  private forward(path: string, tr: Transaction, from: EditorView) {
    let spec: TransactionSpec | null = null;
    for (const pane of this.panes.values()) {
      if (pane.path !== path || pane.view === from) continue;
      if (!spec) {
        const userEvent = tr.annotation(Transaction.userEvent);
        spec = {
          changes: tr.changes,
          annotations: userEvent ? [copied.of(true), Transaction.userEvent.of(userEvent)] : [copied.of(true)],
        };
      }
      pane.view.dispatch(spec);
    }
  }

  /** Undo or redo from a mirror: run it on the note's main state, which forwards the result. */
  private historyCommand(view: EditorView, isRedo: boolean): boolean {
    const path = this.paneOfView.get(view)?.path;
    const owner = path ? this.owners.get(path) : undefined;
    if (!owner || owner === view) return false;
    return (isRedo ? redo : undo)(owner);
  }

  // ----- tabs -----

  private blankTab(): Tab {
    return { id: this.nextTabId++, path: null, back: [], forward: [], mode: this.newTabMode(), pinned: false, backlinks: this.newTabBacklinks(), memory: null };
  }

  newTab(group: Group = this.activeGroup) {
    const tab = this.blankTab();
    this.layout.addTab(group, tab);
    this.select(group, tab);
  }

  /** Show a tab: the active tab of its group, in the active pane. */
  activate(tab: Tab) {
    const group = this.layout.groupOf(tab);
    if (group) this.select(group, tab);
  }

  private select(group: Group, tab: Tab, focus = true) {
    if (group.active === tab && this.layout.activeGroup === group && this.panes.get(group)?.tab === tab) return;
    group.active = tab;
    this.layout.activeGroup = group;
    this.present(group);
    this.settle();
    if (focus && tab.path) this.pane(group).view.focus();
  }

  closeTab(tab: Tab) {
    this.closeTabs([tab]);
  }

  /**
   * Close tabs, in any groups. In each group the active tab passes to its
   * nearest open neighbour; a group left without tabs collapses and gives
   * its space to its sibling, except the last one, which shows a new empty
   * tab (Obsidian's "New tab").
   */
  closeTabs(close: Tab[]) {
    const gone = new Set(close);
    let layoutChanged = false;
    const wasActive = this.active;
    for (const group of this.layout.groups()) {
      const doomed = group.tabs.filter((t) => gone.has(t));
      if (!doomed.length) continue;
      for (const tab of doomed) {
        this.rememberClosed(tab, group);
        this.layout.removeTab(tab);
      }
      if (group.tabs.length) continue;
      if (this.layout.groups().length > 1) {
        this.dropGroup(group);
        layoutChanged = true;
      } else {
        const blank = this.blankTab();
        group.tabs.push(blank);
        group.active = blank;
      }
    }
    for (const group of this.layout.groups()) this.present(group);
    this.settle(layoutChanged);
    if (this.active !== wasActive && this.active.path) this.view.focus();
  }

  /** Close a whole tab group (its tabs can be brought back with Undo close tab). */
  closeGroup(group: Group = this.activeGroup) {
    this.closeTabs([...group.tabs]);
  }

  /** Remove a group's pane and take the group out of the layout. */
  private dropGroup(group: Group) {
    const pane = this.panes.get(group);
    if (pane) {
      this.stash(pane);
      this.panes.delete(group);
      this.paneOfView.delete(pane.view);
      pane.view.destroy();
    }
    this.layout.removeGroup(group);
  }

  /** Obsidian's "Close others", "Close tabs after" and "Close all" act within the tab's group and leave pinned tabs open. */
  closeOthers(tab: Tab) {
    this.closeTabs((this.layout.groupOf(tab)?.tabs ?? []).filter((t) => t !== tab && !t.pinned));
  }

  /** "Close all other tabs": every other unpinned tab, in every group. */
  closeAllOthers(tab: Tab = this.active) {
    this.closeTabs(this.layout.tabs().filter((t) => t !== tab && !t.pinned));
  }

  closeToRight(tab: Tab) {
    const tabs = this.layout.groupOf(tab)?.tabs ?? [];
    this.closeTabs(tabs.slice(tabs.indexOf(tab) + 1).filter((t) => !t.pinned));
  }

  closeAll(group: Group = this.activeGroup) {
    this.closeTabs(group.tabs.filter((t) => !t.pinned));
  }

  private rememberClosed(tab: Tab, group: Group) {
    if (!tab.path && !tab.type) return;
    this.closed.push({ saved: this.saveTab(tab), group, index: group.tabs.indexOf(tab) });
    if (this.closed.length > CLOSED_MAX) this.closed.shift();
  }

  canUndoClose() {
    return this.closed.some((c) => c.saved.type || (c.saved.path && this.notes.some((n) => n.path === c.saved.path)));
  }

  /** Obsidian's "Undo close tab": reopen the last closed tab where it was (or in the active pane). */
  async undoCloseTab() {
    while (this.closed.length) {
      const { saved, group: was, index } = this.closed.pop()!;
      const tab = this.loadTab(saved);
      if (!tab || (!tab.type && (!tab.path || !(await this.load(tab.path))))) continue;
      const group = this.layout.groups().includes(was) ? was : this.activeGroup;
      this.layout.addTab(group, tab, index);
      this.select(group, tab);
      return;
    }
  }

  /** Obsidian's "Toggle backlinks in document", per tab. */
  toggleBacklinks(tab: Tab = this.active) {
    tab.backlinks = !tab.backlinks;
    this.emit("tabs");
  }

  togglePin(tab: Tab = this.active) {
    tab.pinned = !tab.pinned;
    this.emit("tabs");
  }

  /** Switch a tab between Live Preview, Source mode and Reading view. */
  setMode(mode: ViewMode, tab: Tab = this.active) {
    if (tab.mode === mode) return;
    tab.mode = mode;
    for (const pane of this.panes.values()) if (pane.tab === tab && tab.path) this.applyMode(pane.view, mode);
    this.emit("mode");
  }

  cycleTab(dir: 1 | -1) {
    const tabs = this.tabs;
    const i = tabs.indexOf(this.active);
    this.activate(tabs[(i + dir + tabs.length) % tabs.length]);
  }

  /** Obsidian's "Go to tab #n" (1-based; 0 means the last tab), in the active pane. */
  gotoTab(n: number) {
    const tabs = this.tabs;
    const tab = n === 0 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (tab) this.activate(tab);
  }

  // ----- splits -----

  /**
   * Split right / Split down: a new tab group beside or below the tab's
   * group, showing the same note in the same mode and place, made active.
   */
  split(tab: Tab = this.active, edge: Edge = "right") {
    const group = this.layout.groupOf(tab);
    if (!group) return;
    const pane = this.panes.get(group);
    if (pane?.tab === tab) this.remember(pane);
    // The new pane is narrower or shorter, so the same scroll offset would
    // show other text: it starts at the line at the top of the old one.
    const topLine = pane?.tab === tab ? this.topLine(pane) : null;
    const memory = tab.memory ? { ...tab.memory, scrollTop: topLine === null ? tab.memory.scrollTop : null } : null;
    const copy: Tab = { ...this.blankTab(), path: tab.path, mode: tab.mode, backlinks: tab.backlinks, memory, type: tab.type, graphFile: tab.graphFile };
    const added = this.layout.split(group, edge, [copy]);
    this.layout.activeGroup = added;
    this.present(added);
    const view = this.pane(added).view;
    if (topLine !== null) {
      // Both panes keep that line at the top, though both now wrap narrower.
      const keep = EditorView.scrollIntoView(topLine, { y: "start", yMargin: 0 });
      view.dispatch({ effects: keep });
      pane!.view.dispatch({ effects: keep });
    }
    this.settle(true);
    if (copy.path) requestAnimationFrame(() => view.focus());
  }

  /** The start of the first line in view in a pane, or null at the very top. */
  private topLine(pane: Pane): number | null {
    const scroller = pane.scroller;
    if (!scroller || scroller.scrollTop <= 0) return null;
    const view = pane.view;
    const docTop = view.documentTop - scroller.getBoundingClientRect().top;
    if (docTop >= 0) return null; // the title is still in view
    return view.lineBlockAtHeight(-docTop).from;
  }

  /** Move a tab to another group (or elsewhere in its own) at a tab-bar position. */
  moveTab(tab: Tab, to: Group, index: number) {
    const from = this.layout.groupOf(tab);
    if (!from) return;
    const fromPane = this.panes.get(from);
    if (fromPane?.tab === tab) this.remember(fromPane);
    if (!this.layout.moveTab(tab, to, index)) return;
    const collapsed = !this.layout.groups().includes(from);
    if (collapsed) this.dropPane(from);
    else this.present(from);
    this.present(to);
    this.settle(collapsed);
    const view = this.pane(to).view;
    if (tab.path) requestAnimationFrame(() => view.focus());
  }

  /**
   * Move a tab into a new group on an edge of `target`. When the tab was
   * the only one in its group, that group's editor moves with it, so nothing
   * is rebuilt or re-rendered.
   */
  moveTabToEdge(tab: Tab, target: Group, edge: Edge) {
    const from = this.layout.groupOf(tab);
    if (!from) return;
    const fromPane = this.panes.get(from);
    if (fromPane?.tab === tab) this.remember(fromPane);
    const added = this.layout.moveTabToEdge(tab, target, edge);
    if (!added) return;
    if (!this.layout.groups().includes(from) && fromPane) {
      // Hand the editor (already showing this tab) to the new group.
      this.panes.delete(from);
      fromPane.group = added;
      this.panes.set(added, fromPane);
    } else this.present(from);
    this.present(added);
    this.settle(true);
    const view = this.pane(added).view;
    if (tab.path) requestAnimationFrame(() => view.focus());
  }

  private dropPane(group: Group) {
    const pane = this.panes.get(group);
    if (!pane) return;
    this.stash(pane);
    this.panes.delete(group);
    this.paneOfView.delete(pane.view);
    pane.view.destroy();
  }

  /** The group beside the active one, if any. */
  neighbour(edge: Edge, group: Group = this.activeGroup): Group | null {
    return this.layout.neighbour(group, edge);
  }

  /** Obsidian's "Focus on tab group to the left" and friends. */
  focusNeighbour(edge: Edge) {
    const next = this.neighbour(edge);
    if (!next) return;
    this.focusGroup(next);
    if (next.active.path) this.pane(next).view.focus();
  }

  /** Move the active tab into the group beside its own, at the end of its tabs. */
  moveToNeighbour(edge: Edge) {
    const next = this.neighbour(edge);
    if (next) this.moveTab(this.active, next, next.tabs.length);
  }

  /** The layout changed size (a divider was dragged): settle and save. */
  resized() {
    this.emit("layout");
  }

  // ----- navigation -----

  /**
   * Open a note in the active pane's tab (or a new tab, or a new pane to the
   * right or below), optionally at a 1-based line (selecting columns `ch` of
   * it) or at a heading. `group` opens relative to another pane.
   */
  async open(
    path: string,
    opts: { where?: OpenWhere; line?: number; ch?: [number, number]; heading?: string; group?: Group } = {},
  ) {
    const state = await this.load(path);
    if (!state) return;
    let group = opts.group && this.layout.groups().includes(opts.group) ? opts.group : this.activeGroup;
    let where = opts.where ?? false;
    const current = group.active;
    // A pinned tab keeps its note; anything else opened from it gets a new tab.
    if (!where && current.pinned && (current.type || (current.path && current.path !== path))) where = "tab";
    const alreadyShown = !where && current.path === path && group === this.activeGroup;
    let tab = current;
    let layoutChanged = false;
    if (where === "right" || where === "down") {
      const pane = this.panes.get(group);
      if (pane) this.remember(pane);
      tab = this.blankTab();
      group = this.layout.split(group, where === "right" ? "right" : "bottom", [tab]);
      layoutChanged = true;
    } else if (where === "tab") {
      tab = this.blankTab();
      this.layout.addTab(group, tab);
    } else if (tab.type) {
      // A graph tab becomes the note (Obsidian's click on a node); Back returns to the graph.
      tab.back.push(viewEntry(tab));
      tab.forward = [];
      tab.type = undefined;
      tab.graphFile = undefined;
    } else if (tab.path !== path && tab.path) {
      tab.back.push(tab.path);
      tab.forward = [];
    }
    tab.path = path;
    group.active = tab;
    this.layout.activeGroup = group;
    this.present(group);
    this.settle(layoutChanged);
    const view = this.pane(group).view;
    const doc = view.state.doc;
    const line = opts.line ? doc.line(Math.min(opts.line, doc.lines)) : null;
    const pos = line ? line.from : opts.heading ? headingPos(doc, opts.heading) : null;
    if (pos === null) {
      view.focus();
      return;
    }
    const clamp = (ch: number) => Math.min(line!.to, line!.from + ch);
    const selection = line && opts.ch ? { anchor: clamp(opts.ch[0]), head: clamp(opts.ch[1]) } : { anchor: pos };
    // Within the note on screen the jump glides; into a just-switched note
    // it lands at once, so the first frame already shows the target.
    if (alreadyShown) this.jumpTo(selection);
    else {
      view.dispatch({ selection, effects: EditorView.scrollIntoView(selection.anchor, { y: "center" }) });
      view.focus();
    }
  }

  /** Put the caret (or a selection) in the active pane's note and glide it into view. */
  jumpTo(selection: { anchor: number; head?: number }) {
    this.view.dispatch({ selection });
    void this.glideTo(selection.anchor);
    this.view.focus();
  }

  /** Follow a link target: "Note", "Note#Heading", or "#Heading" in the open note. */
  async openLink(target: string, where: OpenWhere = false, group: Group = this.activeGroup) {
    const hash = target.indexOf("#");
    const name = (hash < 0 ? target : target.slice(0, hash)).trim();
    const heading = hash < 0 ? undefined : target.slice(hash + 1);
    let path = name ? this.resolve(name, group.active.path) : group.active.path;
    if (!path) {
      if (!name) return;
      // A link to a note that doesn't exist yet: create it (a bare name goes where new notes go).
      let file = name.replace(/%20/g, " ").replace(/\.md$/i, "");
      if (!file.includes("/")) {
        const folder = this.newNoteFolder();
        file = folder ? `${folder}/${file}` : file;
      }
      path = (await this.createNote(`${file}.md`)).path;
    }
    await this.open(path, { where, heading, group });
  }

  /**
   * Smoothly scroll a document position to the middle of the active pane. A
   * long jump cuts to one screen short of the target first, so the editor
   * never has to render every line in between.
   */
  private async glideTo(pos: number) {
    const scroller = this.scroller;
    const view = this.view;
    if (!scroller || duration("slow") <= 0) {
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      return;
    }
    const targetTop = () => {
      const block = view.lineBlockAt(pos);
      const docTop = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
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

  /** Back and forward walk the active pane's own history. */
  async goBack() {
    await this.travel(-1);
  }

  async goForward() {
    await this.travel(1);
  }

  private async travel(dir: 1 | -1) {
    const group = this.activeGroup;
    const tab = group.active;
    const from = dir < 0 ? tab.back : tab.forward;
    const to = dir < 0 ? tab.forward : tab.back;
    const entry = from[from.length - 1];
    if (!entry) return;
    const view = parseViewEntry(entry);
    if (!view && !(await this.load(entry))) return;
    from.pop();
    if (tab.type) to.push(viewEntry(tab));
    else if (tab.path) to.push(tab.path);
    tab.type = view?.type;
    tab.graphFile = view ? view.file : undefined;
    tab.path = view ? null : entry;
    if (group.active === tab) this.present(group);
    this.settle();
    if (group === this.activeGroup && tab.path) this.pane(group).view.focus();
  }

  /**
   * Open the graph (or the local graph of a note) in a tab: the active tab
   * if it is empty, else a new tab, or a new pane to the right or below.
   */
  openView(type: ViewType, where: OpenWhere = false, file: string | null = null) {
    let group = this.activeGroup;
    let tab = group.active;
    let layoutChanged = false;
    if (where === "right" || where === "down") {
      const pane = this.panes.get(group);
      if (pane) this.remember(pane);
      tab = this.blankTab();
      group = this.layout.split(group, where === "right" ? "right" : "bottom", [tab]);
      layoutChanged = true;
    } else if (where === "tab" || tab.path || tab.type) {
      tab = this.blankTab();
      this.layout.addTab(group, tab);
    }
    tab.type = type;
    tab.graphFile = type === "localgraph" ? file : undefined;
    group.active = tab;
    this.layout.activeGroup = group;
    this.present(group);
    this.settle(layoutChanged);
  }

  /** A local graph tab now follows another note. */
  setGraphFile(tab: Tab, file: string | null) {
    if (tab.type !== "localgraph" || tab.graphFile === file) return;
    tab.graphFile = file;
    this.emit("tabs");
  }

  private async load(path: string): Promise<EditorState | null> {
    let state = this.states.get(path);
    if (state) return state;
    try {
      const doc = await api.readNote(path);
      state = this.states.get(path); // loaded meanwhile
      if (state) return state;
      state = createNoteState({ doc, host: this.host });
      this.states.set(path, state);
      return state;
    } catch (err) {
      console.error(`Could not open ${path}`, err);
      return null;
    }
  }

  // ----- saving and restoring the layout -----

  private saveTab(tab: Tab): SavedTab {
    const saved: SavedTab = { path: tab.path, mode: tab.mode, pinned: tab.pinned, back: tab.back.slice(-20), forward: tab.forward.slice(-20) };
    if (tab.backlinks) saved.backlinks = true;
    if (tab.type) {
      saved.type = tab.type;
      if (tab.type === "localgraph") saved.file = tab.graphFile ?? null;
    }
    const pane = [...this.panes.values()].find((p) => p.tab === tab);
    if (pane) this.remember(pane);
    const memory = tab.memory?.path === tab.path ? tab.memory : null;
    if (memory) {
      if (memory.scrollTop !== null) saved.scroll = Math.round(memory.scrollTop);
      if (memory.selection) saved.sel = [memory.selection.main.anchor, memory.selection.main.head];
    }
    return saved;
  }

  private loadTab(saved: SavedTab): Tab | null {
    if (!saved || typeof saved !== "object") return null;
    const isNote = (p: unknown): p is string => typeof p === "string" && this.notes.some((n) => n.path === p);
    const exists = (p: unknown): p is string => isNote(p) || (typeof p === "string" && parseViewEntry(p) !== null);
    const type = saved.type === "graph" || saved.type === "localgraph" ? saved.type : undefined;
    const path = type || saved.path === null ? null : isNote(saved.path) ? saved.path : undefined;
    if (path === undefined) return null; // its note is gone
    const tab = this.blankTab();
    tab.path = path;
    if (type) {
      tab.type = type;
      if (type === "localgraph") tab.graphFile = isNote(saved.file) ? saved.file : null;
    }
    tab.mode = saved.mode === "source" || saved.mode === "reading" ? saved.mode : "live";
    tab.pinned = saved.pinned === true;
    tab.backlinks = saved.backlinks === true;
    tab.back = Array.isArray(saved.back) ? saved.back.filter(exists) : [];
    tab.forward = Array.isArray(saved.forward) ? saved.forward.filter(exists) : [];
    if (path && typeof saved.scroll === "number") {
      const sel = Array.isArray(saved.sel) ? EditorSelection.single(Number(saved.sel[0]) || 0, Number(saved.sel[1]) || 0) : null;
      tab.memory = { path, scrollTop: saved.scroll, selection: sel };
    }
    return tab;
  }

  /** The split tree, sizes, each group's tabs and active tab, and the active pane. */
  saveLayout(): SavedWorkspace {
    return { v: 1, root: this.layout.toJSON((t) => this.saveTab(t)), active: this.layout.groups().indexOf(this.activeGroup) };
  }

  /**
   * Put back a saved layout (notes that no longer exist are dropped
   * quietly). Returns false if nothing could be restored.
   */
  async restoreLayout(saved: unknown): Promise<boolean> {
    if (!saved || typeof saved !== "object" || (saved as SavedWorkspace).v !== 1) return false;
    const { root, active } = saved as SavedWorkspace;
    const layout = Layout.fromJSON<Tab, SavedTab>(root, (s) => this.loadTab(s), active);
    if (!layout || !layout.tabs().some((t) => t.path || t.type)) return false;
    await Promise.all(layout.groups().map((g) => (g.active.path ? this.load(g.active.path) : null)));
    for (const pane of [...this.panes.values()]) this.dropPane(pane.group);
    this.layout = layout;
    for (const group of layout.groups()) this.present(group);
    this.shownKey = "";
    this.settle(true);
    if (this.active.path) this.view.focus();
    return true;
  }

  // ----- files -----

  async createNote(path: string, content = ""): Promise<FileEntry> {
    const entry = await api.createNote(path, content);
    await this.refreshFiles();
    return entry;
  }

  /**
   * Create "Untitled.md" (or "Untitled 1.md", ...) in a folder (by default
   * where Settings → Files and links puts new notes) and open it for editing.
   */
  async newNote(folder: string = this.newNoteFolder(), where?: OpenWhere): Promise<string> {
    if (folder && !this.isFolder(folder)) await api.createFolder(folder).catch(() => {});
    const entry = await this.createNote(this.freeName(folder, ".md"));
    await this.open(entry.path, { where: where ?? (this.active.path !== null || this.active.type ? "tab" : false) });
    // A new note is for writing in, even when new tabs open in Reading view.
    if (this.active.path === entry.path && this.active.mode === "reading") this.setMode(this.editingMode());
    return entry.path;
  }

  /** Rename a note (keeping its folder and .md) or a folder. */
  async rename(path: string, newName: string) {
    newName = newName.trim().replace(/[\\/:]/g, "");
    const isDir = this.isFolder(path);
    if (!newName || newName === (isDir ? fileName(path) : noteName(path))) return;
    const dir = parentDir(path);
    await this.relocate(path, `${dir ? dir + "/" : ""}${newName}${isDir ? "" : ".md"}`);
  }

  /** Move a note or folder into another folder ("" for the vault root). */
  async moveTo(path: string, folder: string) {
    const to = folder ? `${folder}/${fileName(path)}` : fileName(path);
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
    const under = (p: string) => isUnder(p, from);
    await Promise.all([...this.saveTimers.keys()].filter(under).map((p) => this.flush(p)));
    const before = this.notes;
    await api.renamePath(from, to);
    const swap = (p: string) => movedPath(p, from, to);
    for (const map of [this.states, this.scrollTops, this.owners] as Map<string, unknown>[]) {
      for (const [key, value] of [...map]) {
        if (!under(key)) continue;
        map.delete(key);
        map.set(swap(key), value);
      }
    }
    const swapEntry = (e: string) => {
      const view = parseViewEntry(e);
      return !view ? swap(e) : view.file ? viewEntry({ type: view.type, graphFile: swap(view.file) }) : e;
    };
    for (const tab of this.layout.tabs()) {
      if (tab.path) tab.path = swap(tab.path);
      if (tab.graphFile) tab.graphFile = swap(tab.graphFile);
      tab.back = tab.back.map(swapEntry);
      tab.forward = tab.forward.map(swapEntry);
      if (tab.memory) tab.memory.path = swap(tab.memory.path);
    }
    for (const pane of this.panes.values()) if (pane.path) pane.path = swap(pane.path);
    for (const c of this.closed) {
      if (c.saved.path) c.saved.path = swap(c.saved.path);
    }
    this.recent = this.recent.map(swap);
    for (const fn of this.moveListeners) fn(swap);
    await this.refreshFiles();
    this.emit("tabs");
    this.shownKey = "";
    this.settle();
    void this.refreshLinks();
    this.onRenamed?.(from, to, before);
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

  private included: { notes: NoteRef[]; test: (path: string) => boolean; out: NoteRef[] } | null = null;

  /** The notes that aren't excluded (Settings → Files and links → Excluded files). */
  includedNotes(): NoteRef[] {
    const c = this.included;
    if (c && c.notes === this.notes && c.test === this.isExcluded) return c.out;
    const out = this.notes.filter((n) => !this.isExcluded(n.path));
    this.included = { notes: this.notes, test: this.isExcluded, out };
    return out;
  }

  /** A new link to `target` from the note at `from`, in the style the settings ask for. */
  linkTo(target: string, from: string | null = this.active.path, display?: string, subpath = ""): string {
    return formatLink(target, from, this.notes, this.linkStyle(), display, subpath);
  }

  /**
   * Change a note's text from outside its editors (link updates after a
   * rename): only the lines that differ are replaced, through the editor if
   * the note is loaded (so it is undoable and saved as usual), else on disk.
   */
  async updateText(path: string, next: string) {
    const doc = this.owners.get(path)?.state.doc ?? this.states.get(path)?.doc;
    if (!doc) {
      await api.writeNote(path, next);
      this.touch(path);
      return;
    }
    const lines = next.split("\n");
    if (lines.length !== doc.lines) {
      this.change(path, { changes: { from: 0, to: doc.length, insert: next } });
      return;
    }
    const changes: { from: number; to: number; insert: string }[] = [];
    lines.forEach((text, i) => {
      const line = doc.line(i + 1);
      if (line.text !== text) changes.push({ from: line.from, to: line.to, insert: text });
    });
    if (changes.length) this.change(path, { changes });
  }

  /** Whether a note is loaded in the editor (its text may hold unsaved edits). */
  isLoaded(path: string) {
    return this.states.has(path);
  }

  /** Mark a file as just modified (our own saves, or a change on disk), for views that cache by modified time. */
  private touch(path: string) {
    const entry = this.files.find((f) => f.path === path);
    if (entry) entry.mtime_ms = Date.now();
  }

  /** The text of a note: from the editor if it is loaded (unsaved edits included), else from disk. */
  async text(path: string): Promise<string> {
    return this.states.get(path)?.doc.toString() ?? (await api.readNote(path));
  }

  /** Obsidian's "Make a copy": "Name 1.md" beside the note, opened in the active tab. */
  async makeCopy(path: string): Promise<string> {
    await this.flush(path);
    const content = await this.text(path);
    const taken = new Set(this.files.map((f) => f.path.toLowerCase()));
    const base = path.replace(/\.md$/, "");
    let n = 1;
    while (taken.has(`${base} ${n}.md`.toLowerCase())) n++;
    const entry = await this.createNote(`${base} ${n}.md`, content);
    await this.open(entry.path);
    return entry.path;
  }

  /**
   * Obsidian's "Merge entire file with...": append this note's text to
   * another note (after a blank line), then delete this one. The other note
   * opens where this one was.
   */
  async mergeInto(path: string, into: string) {
    if (path === into) return;
    if (this.confirmMerge && !(await this.confirmMerge(path, into))) return;
    const [text, target] = await Promise.all([this.text(path), this.load(into)]);
    if (!target) return;
    const doc = this.owners.get(into)?.state.doc ?? this.states.get(into)?.doc ?? target.doc;
    const sep = !doc.length ? "" : doc.sliceString(doc.length - 1) === "\n" ? "\n" : "\n\n";
    this.change(into, { changes: { from: doc.length, insert: sep + text } });
    await this.flush(into);
    const showing = this.layout.tabs().filter((t) => t.path === path);
    await this.remove(path, { confirmed: true });
    for (const tab of showing) {
      tab.path = into;
      tab.memory = null;
    }
    for (const group of this.layout.groups()) this.present(group);
    this.settle();
  }

  /** Apply a change to a note from outside its editors (wherever it is shown, or just its state). */
  private change(path: string, spec: TransactionSpec) {
    const owner = this.owners.get(path);
    if (owner) {
      owner.dispatch(spec);
      return;
    }
    const state = this.states.get(path);
    if (!state) return;
    const tr = state.update(spec);
    this.states.set(path, tr.state);
    if (tr.docChanged && !tr.isUserEvent("external")) this.scheduleSave(path);
  }

  /**
   * Delete a note or folder: to the vault's .trash, or for good, as Settings
   * → Files and links says, after asking if it says to ask. Returns whether
   * it was deleted.
   */
  async remove(path: string, opts: { confirmed?: boolean } = {}): Promise<boolean> {
    if (!opts.confirmed && this.confirmDelete && !(await this.confirmDelete(path))) return false;
    const under = (p: string) => isUnder(p, path);
    await Promise.all([...this.saveTimers.keys()].filter(under).map((p) => this.flush(p)));
    await api.deletePath(path, this.permanentDelete());
    for (const pane of this.panes.values()) if (pane.path && under(pane.path)) this.release(pane);
    for (const p of [...this.states.keys()].filter(under)) this.states.delete(p);
    for (const p of [...this.scrollTops.keys()].filter(under)) this.scrollTops.delete(p);
    this.recent = this.recent.filter((p) => !under(p));
    this.closed = this.closed.filter((c) => !c.saved.path || !under(c.saved.path));
    for (const tab of this.layout.tabs()) {
      tab.back = tab.back.filter((p) => !under(p));
      tab.forward = tab.forward.filter((p) => !under(p));
      if (tab.path && under(tab.path)) tab.path = null;
      if (tab.graphFile && under(tab.graphFile)) tab.graphFile = null;
    }
    await this.refreshFiles();
    for (const group of this.layout.groups()) this.present(group);
    this.settle();
    void this.refreshLinks();
    return true;
  }

  // ----- saving notes -----

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
    this.touch(path);
    clearTimeout(this.linkTimer);
    this.linkTimer = window.setTimeout(() => void this.refreshLinks(), LINK_INDEX_DELAY);
  }

  private async flush(path: string) {
    if (this.saveTimers.has(path)) {
      clearTimeout(this.saveTimers.get(path));
      await this.save(path);
    }
  }

  /** Save the active note now (Obsidian's "Save current file"). */
  async saveNow(path = this.active.path) {
    if (path) await this.flush(path);
  }

  async flushAll() {
    await Promise.all([...this.saveTimers.keys()].map((p) => this.flush(p)));
  }

  // ----- outside changes -----

  private async onVaultChanged(kind: string, paths: string[]) {
    if (kind !== "modify") await this.refreshFiles();
    else for (const path of paths) this.touch(path);
    for (const path of paths) {
      const state = this.states.get(path);
      if (!state || this.saveTimers.has(path)) continue;
      if (kind === "remove") continue;
      const doc = await api.readNote(path).catch(() => null);
      const current = this.owners.get(path)?.state.doc ?? this.states.get(path)?.doc;
      if (doc === null || !current || doc === current.toString()) continue;
      this.change(path, { changes: { from: 0, to: current.length, insert: doc }, userEvent: "external" });
    }
    void this.refreshLinks();
  }
}

const memoryOf = (tab: Tab, path: string) => (tab.memory?.path === path ? tab.memory : null);

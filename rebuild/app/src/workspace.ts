// App state: the open vault (vault.ts: its files and link index), and the
// layout of tab groups (splits, see layout.ts) with their tabs (tabs.ts).
// This module changes the layout (opening, closing, splitting, moving,
// navigating, following renames and deletes) and tells the views through
// change events. The editors that show the notes are noteEditors.ts; the
// saved form of the layout is savedLayout.ts.

import { EditorView } from "@codemirror/view";
import { api } from "./api";
import type { ViewMode } from "./editor/editor";
import { headingPos } from "./editor/headings";
import type { EditorHost, EmbedHost, PropertyHost } from "./editor/host";
import { IMAGE_EXT } from "./editor/embeds";
import { createEditorHost } from "./editorHost";
import { type Edge, Layout } from "./layout";
import { formatLink, type LinkStyle, resolveLink } from "./links/internal";
import { listeners } from "./listeners";
import { createNote, fileSettings } from "./fileOps";
import { NoteEditors } from "./noteEditors";
import { loadTab, type SavedTab, type SavedWorkspace, saveTab } from "./savedLayout";
import { type Group, linkTabs, type OpenWhere, parseViewEntry, pushBack, type Tab, tabFollowsMove, tabForgets, unlinkTab, type ViewType, viewEntry } from "./tabs";
import { Vault } from "./vault";

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

interface ClosedTab {
  saved: SavedTab;
  group: Group;
  index: number;
}

const CLOSED_MAX = 20;

export class Workspace {
  readonly vault = new Vault(
    (change) => this.emit(change),
    (path) => this.editors.reload(path),
  );
  layout: Layout<Tab>;
  /** Recently shown notes, most recent first. */
  recent: string[] = [];
  /** Shows the editor's right-click menu (set by the app). */
  editorMenu: EditorHost["contextMenu"];
  /** The mode a new tab starts in (Settings → Editor: default view and editing mode). */
  newTabMode: () => ViewMode = () => "live";
  /** Whether a new tab shows backlinks under its note (Settings → Backlinks). */
  newTabBacklinks: () => boolean = () => false;
  /** How new links are written (Settings → Files and links). */
  linkStyle: () => LinkStyle = () => ({ format: "shortest", wikilinks: true });
  /** The vault's properties, for the Properties block (set by the app). */
  propertyHost: PropertyHost | null = null;
  /** Each tab group's editor, and the notes they show. */
  readonly editors: NoteEditors;
  /** What embeds and image tabs read: notes' text and images' blob: URLs. */
  readonly embeds: EmbedHost;

  private nextTabId = 1;
  private changes = listeners<[Change, Group?]>();
  private moves = listeners<[(path: string) => string]>();
  private shownKey = "";
  private closed: ClosedTab[] = [];

  constructor() {
    const host = createEditorHost(this);
    this.embeds = host.embeds;
    this.editors = new NoteEditors(host, {
      shown: (group, path) => {
        if (path) this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, 50);
        this.emit("pane", group);
      },
      loaded: () => this.settle(),
      changed: () => this.emit("doc"),
      saved: (path) => this.vault.written(path),
    });
    this.layout = new Layout(this.blankTab());
    this.editors.viewOf(this.layout.activeGroup);
  }

  /** Listen for changes; returns a function that stops listening. */
  on(fn: (change: Change, group?: Group) => void): () => void {
    return this.changes.on(fn);
  }

  private emit(change: Change, group?: Group) {
    this.changes.emit(change, group);
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
    return this.editors.viewOf(this.layout.activeGroup);
  }

  groups(): Group[] {
    return this.layout.groups();
  }

  groupOf(tab: Tab): Group | undefined {
    return this.layout.groupOf(tab);
  }

  /** Make a pane the active one (a click or focus inside it). */
  focusGroup(group: Group) {
    if (group === this.layout.activeGroup || !this.editors.has(group)) return;
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

  // ----- links -----

  /**
   * Resolve a link target the way Obsidian does: a path from the vault
   * folder or from the linking note's folder, or a note name, any case.
   */
  resolve(target: string, from: string | null = this.active.path): string | null {
    return resolveLink(target, from, this.vault.notes) ?? resolveLink(target, from, this.vault.files.filter(f => !f.is_dir));
  }

  /** A new link to `target` from the note at `from`, in the style the settings ask for. */
  linkTo(target: string, from: string | null, display?: string, subpath = ""): string {
    return formatLink(target, from, this.vault.files.filter(f => !f.is_dir), this.linkStyle(), display, subpath);
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

  private select(group: Group, tab: Tab) {
    if (group.active === tab && this.layout.activeGroup === group && this.editors.shows(group, tab)) return;
    this.show(group, tab);
    if (tab.path) this.editors.viewOf(group).focus();
  }

  /** "Move to new window": the note opens in a window of its own (its unsaved edits saved first) and leaves this one. */
  async moveToWindow(tab: Tab) {
    const path = tab.path;
    if (!path) return;
    // Write directly, not through the autosave (which only logs a failure): a failed save or open keeps the tab.
    const doc = this.editors.doc(path);
    if (doc) {
      await api.writeNote(path, doc.toString());
      this.vault.written(path);
    }
    await api.openNoteWindow(path);
    // Navigating or typing in the tab during the awaits keeps it here too.
    if (tab.path === path && this.editors.doc(path) === doc && this.groupOf(tab)) this.closeTab(tab);
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
        this.editors.drop(group);
        this.layout.removeGroup(group);
        layoutChanged = true;
      } else {
        const blank = this.blankTab();
        group.tabs.push(blank);
        group.active = blank;
      }
    }
    this.presentAll();
    this.settle(layoutChanged);
    if (this.active !== wasActive && this.active.path) this.view.focus();
  }

  /** Obsidian's "Close others", "Close tabs after" and "Close all" act within the tab's group and leave pinned tabs open. */
  closeOthers(tab: Tab) {
    this.closeTabs((this.layout.groupOf(tab)?.tabs ?? []).filter((t) => t !== tab && !t.pinned));
  }

  /** "Close all other tabs": every other unpinned tab, in every group. */
  closeAllOthers(tab: Tab) {
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
    return this.closed.some((c) => c.saved.type || (c.saved.path && this.vault.notes.some((n) => n.path === c.saved.path)));
  }

  /** Obsidian's "Undo close tab": reopen the last closed tab where it was (or in the active pane). */
  async undoCloseTab() {
    while (this.closed.length) {
      const { saved, group: was, index } = this.closed.pop()!;
      const tab = this.loadTab(saved);
      if (!tab || (!tab.type && (!tab.path || !(await this.editors.load(tab.path))))) continue;
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

  /** "Link with tab..." (with `to`), or "Unlink tab" (null). */
  setLink(tab: Tab, to: Tab | null) {
    if (to) linkTabs(tab, to, this.layout.tabs());
    else unlinkTab(tab, this.layout.tabs());
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
    this.editors.showMode(tab);
    this.emit("mode");
    if (mode !== "reading" && tab === this.active) this.view.focus();
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

  /** Every group's editor shows its group's active tab. */
  private presentAll() {
    for (const group of this.layout.groups()) this.editors.present(group);
  }

  // ----- splits -----

  /**
   * Split right / Split down: a new tab group beside or below the tab's
   * group, showing the same note in the same mode and place, made active.
   */
  split(tab: Tab = this.active, edge: Edge = "right") {
    const group = this.layout.groupOf(tab);
    if (!group) return;
    const showing = this.editors.shows(group, tab);
    if (showing) this.editors.remember(group);
    // The new pane is narrower or shorter, so the same scroll offset would
    // show other text: it starts at the line at the top of the old one.
    const topLine = showing ? this.editors.topLine(group) : null;
    const memory = tab.memory ? { ...tab.memory, scrollTop: topLine === null ? tab.memory.scrollTop : null } : null;
    const copy: Tab = { ...this.blankTab(), path: tab.path, mode: tab.mode, backlinks: tab.backlinks, memory, type: tab.type, viewFile: tab.viewFile };
    const added = this.layout.split(group, edge, [copy]);
    this.layout.activeGroup = added;
    this.editors.present(added);
    const view = this.editors.viewOf(added);
    if (topLine !== null) {
      // Both panes keep that line at the top, though both now wrap narrower.
      const keep = EditorView.scrollIntoView(topLine, { y: "start", yMargin: 0 });
      view.dispatch({ effects: keep });
      this.editors.viewOf(group).dispatch({ effects: keep });
    }
    this.settle(true);
    if (copy.path) requestAnimationFrame(() => view.focus());
  }

  /** Move a tab to another group (or elsewhere in its own) at a tab-bar position. */
  moveTab(tab: Tab, to: Group, index: number) {
    const from = this.layout.groupOf(tab);
    if (!from) return;
    if (this.editors.shows(from, tab)) this.editors.remember(from);
    if (!this.layout.moveTab(tab, to, index)) return;
    const collapsed = !this.layout.groups().includes(from);
    if (collapsed) this.editors.drop(from);
    else this.editors.present(from);
    this.editors.present(to);
    this.settle(collapsed);
    const view = this.editors.viewOf(to);
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
    if (this.editors.shows(from, tab)) this.editors.remember(from);
    const added = this.layout.moveTabToEdge(tab, target, edge);
    if (!added) return;
    // Hand the editor (already showing this tab) to the new group.
    if (this.layout.groups().includes(from) || !this.editors.rehome(from, added)) this.editors.present(from);
    this.editors.present(added);
    this.settle(true);
    const view = this.editors.viewOf(added);
    if (tab.path) requestAnimationFrame(() => view.focus());
  }

  /** The group beside the active one, if any. */
  neighbour(edge: Edge): Group | null {
    return this.layout.neighbour(this.activeGroup, edge);
  }

  /** Obsidian's "Focus on tab group to the left" and friends. */
  focusNeighbour(edge: Edge) {
    const next = this.neighbour(edge);
    if (!next) return;
    this.focusGroup(next);
    if (next.active.path) this.editors.viewOf(next).focus();
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

  /**
   * Where `open` and `openView` put what they open: the group's tab, a new
   * tab (`tab` true), or a new group to the right or below.
   */
  private target(group: Group, where: OpenWhere, tab: boolean): { group: Group; tab: Tab; layoutChanged: boolean } {
    if (where === "right" || where === "down") {
      this.editors.remember(group);
      const blank = this.blankTab();
      return { group: this.layout.split(group, where === "right" ? "right" : "bottom", [blank]), tab: blank, layoutChanged: true };
    }
    if (!tab) return { group, tab: group.active, layoutChanged: false };
    const blank = this.blankTab();
    this.layout.addTab(group, blank);
    return { group, tab: blank, layoutChanged: false };
  }

  /** Show `tab`, now the active tab of `group`, in the active pane. */
  private show(group: Group, tab: Tab, layoutChanged = false) {
    group.active = tab;
    this.layout.activeGroup = group;
    this.editors.present(group);
    this.settle(layoutChanged);
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
    if (IMAGE_EXT.test(path) || /\.canvas$/i.test(path)) return this.openAttachment(path, opts.where ?? false, opts.group);
    const state = await this.editors.load(path);
    if (!state) return;
    const from = opts.group && this.layout.groups().includes(opts.group) ? opts.group : this.activeGroup;
    let where = opts.where ?? false;
    const current = from.active;
    // A pinned tab keeps its note; anything else opened from it gets a new tab.
    if (!where && current.pinned && (current.type || (current.path && current.path !== path))) where = "tab";
    const alreadyShown = !where && current.path === path && from === this.activeGroup;
    const { group, tab, layoutChanged } = this.target(from, where, where === "tab");
    // A graph tab becomes the note (Obsidian's click on a node); Back returns to the graph.
    if (!where && (tab.type || tab.path !== path)) pushBack(tab);
    tab.type = tab.viewFile = undefined;
    tab.path = path;
    this.show(group, tab, layoutChanged);
    const view = this.editors.viewOf(group);
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

  /** An image from the file list: shown in the tab (or where `where` says), as Obsidian's image view. */
  private openAttachment(path: string, where: OpenWhere, from = this.activeGroup) {
    if (!where && from.active.pinned && from.active.viewFile !== path) where = "tab";
    const { group, tab, layoutChanged } = this.target(from, where, where === "tab");
    pushBack(tab);
    tab.path = null;
    tab.type = /\.canvas$/i.test(path) ? "canvas" : "image";
    this.recent = [path, ...this.recent.filter(p => p !== path)].slice(0, 50);
    tab.viewFile = path;
    this.show(group, tab, layoutChanged);
  }

  /** Put the caret (or a selection) in the active pane's note and glide it into view. */
  jumpTo(selection: { anchor: number; head?: number }) {
    this.view.dispatch({ selection });
    void this.editors.glide(this.activeGroup, selection.anchor);
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
        const folder = fileSettings.newNoteFolder();
        file = folder ? `${folder}/${file}` : file;
      }
      path = (await createNote(this, `${file}.md`)).path;
    }
    await this.open(path, { where, heading, group });
  }

  /** Back (-1) and forward (1) walk the active pane's own history. */
  async travel(dir: 1 | -1) {
    const group = this.activeGroup;
    const tab = group.active;
    const from = dir < 0 ? tab.back : tab.forward;
    const to = dir < 0 ? tab.forward : tab.back;
    const entry = from[from.length - 1];
    if (!entry) return;
    const view = parseViewEntry(entry);
    if (!view && !(await this.editors.load(entry))) return;
    from.pop();
    if (tab.type) to.push(viewEntry(tab));
    else if (tab.path) to.push(tab.path);
    tab.type = view?.type;
    tab.viewFile = view ? view.file : undefined;
    tab.path = view ? null : entry;
    if (group.active === tab) this.editors.present(group);
    this.settle();
    if (group === this.activeGroup && tab.path) this.editors.viewOf(group).focus();
  }

  /**
   * Open the graph (or the local graph of a note) in a tab: the active tab
   * if it is empty, else a new tab, or a new pane to the right or below.
   */
  openView(type: ViewType, where: OpenWhere = false, file: string | null = null) {
    const active = this.activeGroup.active;
    const { group, tab, layoutChanged } = this.target(this.activeGroup, where, where === "tab" || !!active.path || !!active.type);
    tab.type = type;
    tab.viewFile = type === "localgraph" ? file : undefined;
    this.show(group, tab, layoutChanged);
  }

  /** A local graph tab now follows another note. */
  setGraphFile(tab: Tab, file: string | null) {
    if (tab.type !== "localgraph" || tab.viewFile === file) return;
    tab.viewFile = file;
    this.emit("tabs");
  }

  // ----- saving and restoring the layout -----

  private saveTab(tab: Tab): SavedTab {
    this.editors.rememberTab(tab);
    return saveTab(tab);
  }

  private loadTab(saved: SavedTab): Tab | null {
    const isNote = (p: unknown): p is string => typeof p === "string" && this.vault.notes.some((n) => n.path === p);
    return loadTab(saved, () => this.blankTab(), isNote);
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
    await Promise.all(layout.groups().map((g) => (g.active.path ? this.editors.load(g.active.path) : null)));
    this.editors.dropAll();
    this.layout = layout;
    this.presentAll();
    this.shownKey = "";
    this.settle(true);
    if (this.active.path) this.view.focus();
    return true;
  }

  // ----- what is open follows the files -----

  /** Called with a path-mapping function after anything is renamed or moved. */
  onMove(fn: (swap: (path: string) => string) => void) {
    this.moves.on(fn);
  }

  /** A file or folder moved (see fileOps.ts): tabs, their history, closed tabs and recents follow. */
  async followMove(swap: (path: string) => string) {
    for (const tab of this.layout.tabs()) tabFollowsMove(tab, swap);
    for (const c of this.closed) {
      if (c.saved.path) c.saved.path = swap(c.saved.path);
    }
    this.recent = this.recent.map(swap);
    this.moves.emit(swap);
    await this.vault.refreshFiles();
    this.emit("tabs");
    this.shownKey = "";
    this.settle();
    void this.vault.refreshLinks();
  }

  /** Files were deleted: tabs showing them go empty, and they leave every history. */
  async forget(under: (path: string) => boolean) {
    this.recent = this.recent.filter((p) => !under(p));
    this.closed = this.closed.filter((c) => !c.saved.path || !under(c.saved.path));
    for (const tab of this.layout.tabs()) tabForgets(tab, under);
    await this.vault.refreshFiles();
    this.presentAll();
    this.settle();
    void this.vault.refreshLinks();
  }

  /** These tabs now show another note, from its top. */
  reopen(tabs: Tab[], path: string) {
    for (const tab of tabs) {
      tab.path = path;
      tab.memory = null;
    }
    this.presentAll();
    this.settle();
  }

  /** Save a note now (Obsidian's "Save current file"), if it has changes waiting. */
  async saveNow(path = this.active.path) {
    if (path) await this.editors.flush((p) => p === path);
  }
}

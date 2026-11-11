// The editors: one CodeMirror view per tab group, showing its active tab,
// and one EditorState per open note. Switching swaps states, so it costs no
// re-parse or re-render of unchanged notes. Notes load the first time they
// are shown and save a moment after each change.
//
// The same note in two panes: the note's main state (with its undo history)
// is shown by exactly one of them. Every other pane showing that note gets a
// light mirror state of the same document without a history of its own.
// Whatever pane a change is typed in, it is applied there and then forwarded
// to the other panes as a transaction annotated as a copy, so all of them
// stay in step, each with its own selection and scroll position. Undo in a
// mirror runs on the main state. Saving and the "changed" event follow the
// original change only, so a note is still saved once.

import { redo, undo } from "@codemirror/commands";
import { Annotation, EditorSelection, type EditorState, Prec, type Text, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { api } from "./api";
import { configEffects } from "./editor/config";
import { retryDelay } from "./fileSave";
import { drainAllows, pathHeld, popPathHold, pushPathHold } from "./holdDrain";
import { writesSealed } from "./saveSeal";
import { bumpPathGen, pageOwnsDisk, pageVault, pathGen, sourceVault } from "./vaultRoot";
import { authoritativeNote, queuedNote, writeVaultNote } from "./vaultWrite";
import { countsField } from "./editor/counts";
import { createNoteState, VIEW_MODES, type ViewMode, viewModeCompartment, viewModeOf } from "./editor/editor";
import type { EditorHost } from "./editor/host";
import { kept } from "./memo";
import { type Group, memoryOf, type Tab } from "./tabs";

const SAVE_DELAY = 300;

/** Marks a change copied from the pane it was typed in to another pane showing the same note. */
const copied = Annotation.define<boolean>();

/** A tab group's editor and what it shows. */
interface Pane {
  group: Group;
  view: EditorView;
  scroller: HTMLElement | null;
  /** The tab and note on screen (null: the empty "New tab" state). */
  tab: Tab | null;
  path: string | null;
}

/** A note's path while a save is in flight. `move` updates `path` so the write follows a rename. */
interface SaveSlot {
  path: string;
  job?: Promise<boolean>;
  /** Generation of the edit this slot is saving. A newer one wins. */
  gen?: number;
}

/** What the editors tell the workspace. */
interface EditorEvents {
  /** A pane now shows another tab or note (`path` null: none). */
  shown(group: Group, path: string | null): void;
  /** A note a pane was waiting for has loaded and is on screen. */
  loaded(): void;
  /** A note's text changed in an editor. */
  changed(): void;
  /** A note's disk text changed (save or external reload). */
  saved(path: string): void;
}

/** A saved selection, kept inside a (possibly shorter) document. */
function clampSelection(sel: EditorSelection, length: number): EditorSelection {
  return EditorSelection.create(
    sel.ranges.map((r) => EditorSelection.range(Math.min(r.anchor, length), Math.min(r.head, length))),
    sel.mainIndex,
  );
}

export class NoteEditors {
  private panes = new Map<Group, Pane>();
  private paneOfView = new Map<EditorView, Pane>();
  /** Each loaded note's main state: the source of truth, holding its undo history. */
  private states = new Map<string, EditorState>();
  /** The view showing a note's main state, while any pane shows the note. */
  private owners = new Map<string, EditorView>();
  /** Last scroll position per note, for a tab arriving at it through history. */
  private scrollTops = new Map<string, number>();
  private saveTimers = new Map<string, number>();
  private retryTimers = new Map<string, number>();
  private retryAttempt = new Map<string, number>();
  /** Latest text is not on disk. Kept apart from the timers: a failed save has no timer until its retry is armed. */
  private dirty = new Set<string>();
  /** Path identity for an in-flight save, so a rename can retarget it. */
  private slots = new Map<string, SaveSlot>();
  /** Renames and deletes hold these paths so a new save cannot use the old name. */
  private holds: Array<(path: string) => boolean> = [];
  private reloads = new Map<string, symbol>();
  /** Bumped when a note changes on disk, so an in-flight `load` does not publish the old text. */
  private loadEpoch = new Map<string, number>();
  /** One disk read per path. Callers that arrive while it runs share the result. */
  private loading = new Map<string, Promise<EditorState | null>>();
  /** Mirrors have no history: undo and redo there act on the note's main state. */
  private readonly mirrorKeys = Prec.high(
    keymap.of([
      { key: "Mod-z", run: (v) => this.historyCommand(v, false), preventDefault: true },
      { key: "Mod-y", mac: "Mod-Shift-z", run: (v) => this.historyCommand(v, true), preventDefault: true },
      { linux: "Mod-Shift-z", win: "Mod-Shift-z", run: (v) => this.historyCommand(v, true), preventDefault: true },
    ]),
  );

  constructor(
    private readonly host: EditorHost,
    private readonly events: EditorEvents,
  ) {}

  /** The tab group's editor, created with the group. */
  private pane(group: Group): Pane {
    return kept(this.panes, group, () => {
      const view = new EditorView({ dispatchTransactions: (trs, v) => this.dispatch(trs, v) });
      const pane = { group, view, scroller: null, tab: null, path: null };
      this.paneOfView.set(view, pane);
      return pane;
    });
  }

  viewOf(group: Group): EditorView {
    return this.pane(group).view;
  }

  /** A temporary embedded view uses the same document, history, mirrors and save path. Load first. */
  embed(group: Group, path: string, parent: HTMLElement, scroller: HTMLElement) {
    const key = { ...group, active: { ...group.active, path, type: undefined, mode: "live" as const, memory: null } };
    const view = this.viewOf(key);
    this.present(key);
    this.panes.get(key)!.group = group; // Links and editor menus belong to the real pane.
    parent.append(view.dom); this.setScroller(key, scroller);
    return { view, dispose: () => this.drop(key) };
  }

  groupOfView(view: EditorView): Group | undefined {
    return this.paneOfView.get(view)?.group;
  }

  /** The note on screen in a view. */
  pathOf(view: EditorView): string | null {
    return this.paneOfView.get(view)?.path ?? null;
  }

  has(group: Group): boolean {
    return this.panes.has(group);
  }

  /** Whether a group's editor has `tab` on screen. */
  shows(group: Group, tab: Tab): boolean {
    return this.panes.get(group)?.tab === tab;
  }

  /** The pane (UI) hands over the element that scrolls a group's note; its scroll is restored. */
  setScroller(group: Group, el: HTMLElement) {
    const pane = this.pane(group);
    pane.scroller = el;
    const memory = pane.tab?.memory;
    if (memory && memory.path === pane.path && memory.scrollTop !== null) el.scrollTop = memory.scrollTop;
  }

  /**
   * Make a group's editor show its active tab. A note already on screen in
   * another pane gets a mirror state here; otherwise this pane takes the
   * note's main state. Returns false when it already showed that tab.
   */
  present(group: Group): boolean {
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
        if (state && group.active === tab && this.panes.get(group) === pane && this.present(group)) this.events.loaded();
      });
      return false;
    }
    this.stash(pane);
    pane.tab = tab;
    pane.path = path;
    if (path) {
      const memory = memoryOf(tab, path);
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
    } else pane.view.setState(createNoteState({ doc: "", host: this.host, extensions: this.mirrorKeys }));
    this.events.shown(group, path);
    if (path && pane.scroller) {
      const top = memoryOf(tab, path)?.scrollTop;
      if (top !== null) pane.scroller.scrollTop = top ?? this.scrollTops.get(path) ?? 0;
    }
    return true;
  }

  /** Remember where a pane's tab is in its note, and let go of the note. */
  private stash(pane: Pane) {
    this.rememberPane(pane);
    this.releasePane(pane);
  }

  private rememberPane(pane: Pane) {
    if (!pane.tab || !pane.path) return;
    const scrollTop = pane.scroller?.scrollTop ?? 0;
    pane.tab.memory = { path: pane.path, scrollTop, selection: pane.view.state.selection };
    this.scrollTops.set(pane.path, scrollTop);
  }

  /** Note where a group's editor is in its note (scroll, selection), in the tab it shows. */
  remember(group: Group) {
    const pane = this.panes.get(group);
    if (pane) this.rememberPane(pane);
  }

  /** The same, for whichever editor has `tab` on screen. */
  rememberTab(tab: Tab) {
    const pane = [...this.panes.values()].find((p) => p.tab === tab);
    if (pane) this.rememberPane(pane);
  }

  /**
   * The pane stops showing its note. If it held the main state and another
   * pane still shows the note, that pane takes the main state over (keeping
   * its own selection and scroll), so a note on screen always has its main
   * state on screen and edits never have to update a hidden copy.
   */
  private releasePane(pane: Pane) {
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

  /** Remove a group's editor (its group left the layout). */
  drop(group: Group) {
    const pane = this.panes.get(group);
    if (!pane) return;
    this.stash(pane);
    this.panes.delete(group);
    this.paneOfView.delete(pane.view);
    pane.view.destroy();
  }

  dropAll() {
    for (const group of [...this.panes.keys()]) this.drop(group);
  }

  /** Hand a group's editor, as it is, to another group (its only tab moved there). */
  rehome(from: Group, to: Group): boolean {
    const pane = this.panes.get(from);
    if (!pane) return false;
    this.panes.delete(from);
    pane.group = to;
    this.panes.set(to, pane);
    return true;
  }

  /** Configure a view's state for its tab's mode (a no-op when it already is). */
  private applyMode(view: EditorView, mode: ViewMode) {
    if (viewModeOf(view.state) !== mode) view.dispatch({ effects: viewModeCompartment.reconfigure(VIEW_MODES[mode]) });
  }

  /** A tab switched modes: the editor showing it follows. */
  showMode(tab: Tab) {
    for (const pane of this.panes.values()) if (pane.tab === tab && tab.path) this.applyMode(pane.view, tab.mode);
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
  reconfigure() {
    for (const pane of this.panes.values()) if (pane.path) this.applyConfig(pane.view);
  }

  /** The start of the first line in view in a group's editor, or null at the very top. */
  topLine(group: Group): number | null {
    const { scroller, view } = this.pane(group);
    if (!scroller || scroller.scrollTop <= 0) return null;
    const docTop = view.documentTop - scroller.getBoundingClientRect().top;
    if (docTop >= 0) return null; // the title is still in view
    return view.lineBlockAtHeight(-docTop).from;
  }

  /** Scroll a document position to the middle of a group's editor. */
  glide(group: Group, pos: number) {
    this.pane(group).view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  }

  /** Every transaction of every pane's editor comes through here. */
  private dispatch(trs: readonly Transaction[], view: EditorView) {
    view.update(trs);
    if (!trs.some((tr) => tr.docChanged)) return;
    const path = this.paneOfView.get(view)?.path;
    if (!path) return;
    if (this.owners.get(path) === view) this.states.set(path, view.state);
    for (const tr of trs) {
      if (!tr.docChanged || tr.annotation(copied)) continue;
      this.forward(path, tr, view);
      if (!tr.isUserEvent("external")) {
        this.slot(path).gen = bumpPathGen(path);
        this.scheduleSave(path);
      }
    }
    this.events.changed();
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
    if (!owner || owner === view && !owner.state.readOnly) return false;
    const mode = viewModeOf(owner.state);
    // An editable mirror may share its history with a Reading tab.
    if (owner.state.readOnly) this.applyMode(owner, "live");
    try { return (isRedo ? redo : undo)(owner); }
    finally { this.applyMode(owner, mode); }
  }

  // ----- notes -----

  async load(path: string): Promise<EditorState | null> {
    const state = this.states.get(path);
    if (state) return state;
    let pending = this.loading.get(path);
    if (!pending) {
      pending = this.loadFromDisk(path);
      this.loading.set(path, pending);
      void pending.finally(() => {
        if (this.loading.get(path) === pending) this.loading.delete(path);
      });
    }
    return pending;
  }

  /**
   * Read `path` and publish it. A disk change (`reload`) during the read starts
   * it again, so the note that appears is not an older snapshot.
   */
  private async loadFromDisk(path: string): Promise<EditorState | null> {
    for (;;) {
      const generation = this.loadEpoch.get(path) ?? 0;
      let doc: string;
      try {
        doc = await api.readNote(path);
      } catch (err) {
        console.error(`Could not open ${path}`, err);
        return null;
      }
      // A recovery write still in flight wins over the disk snapshot this read just took.
      const recovered = authoritativeNote(pageVault() || sourceVault(), path);
      if (recovered !== undefined) doc = recovered;
      const installed = this.states.get(path);
      if (installed) return installed;
      if ((this.loadEpoch.get(path) ?? 0) !== generation) continue;
      const created = createNoteState({ doc, host: this.host, extensions: this.mirrorKeys });
      const raced = this.states.get(path);
      if (raced) return raced;
      if ((this.loadEpoch.get(path) ?? 0) !== generation) continue;
      this.states.set(path, created);
      return created;
    }
  }

  /** Whether a note is loaded in the editor (its text may hold unsaved edits). */
  isLoaded(path: string) {
    return this.states.has(path);
  }

  /** A loaded note's text as it is now (wherever it is shown). */
  doc(path: string): Text | undefined {
    return this.owners.get(path)?.state.doc ?? this.states.get(path)?.doc;
  }

  /** The text of a note: from the editor if it is loaded (unsaved edits included), else from disk. */
  async text(path: string): Promise<string> {
    return this.states.get(path)?.doc.toString() ?? (await api.readNote(path));
  }

  /** Apply a change to a note from outside its editors (wherever it is shown, or just its state). */
  change(path: string, spec: TransactionSpec) {
    const owner = this.owners.get(path);
    if (owner) {
      owner.dispatch(spec);
      return;
    }
    const state = this.states.get(path);
    if (!state) return;
    const tr = state.update(spec);
    this.states.set(path, tr.state);
    if (tr.docChanged && !tr.isUserEvent("external")) {
      this.slot(path).gen = bumpPathGen(path);
      this.scheduleSave(path);
    }
  }

  /** A loaded note changed on disk (not by us, nothing unsaved): take the new text. */
  async reload(path: string) {
    // A batch queued against the old vault must not replace this page once the backend has moved.
    if (!pageOwnsDisk()) return;
    // Even when this note is not loaded yet: the open that is in flight must not keep the old text.
    this.loadEpoch.set(path, (this.loadEpoch.get(path) ?? 0) + 1);
    if (!this.states.has(path) || this.dirty.has(path) || this.saveTimers.has(path) || this.retryTimers.has(path) || this.slots.get(path)?.job) return;
    const before = this.doc(path);
    const mine = Symbol();
    this.reloads.set(path, mine);
    const text = await api.readNote(path).catch(() => null);
    if (this.reloads.get(path) !== mine) return;
    this.reloads.delete(path);
    const current = this.doc(path);
    // A newer reload or local typing while the read ran takes precedence.
    if (text === null || !current || current !== before || this.dirty.has(path) || this.saveTimers.has(path) || this.retryTimers.has(path) || this.slots.get(path)?.job || text === current.toString()) return;
    this.change(path, { changes: { from: 0, to: current.length, insert: text }, userEvent: "external" });
    this.events.saved(path); // Refresh cached previews after canonical text has reloaded.
  }

  /** Paths under a moved folder (or a moved note) follow it. */
  move(under: (path: string) => boolean, swap: (path: string) => string) {
    this.rekey(this.states, under, swap);
    this.rekey(this.scrollTops, under, swap);
    this.rekey(this.owners, under, swap);
    this.rekey(this.saveTimers, under, swap);
    this.rekey(this.retryTimers, under, swap);
    this.rekey(this.retryAttempt, under, swap);
    const dirty = new Set<string>();
    for (const path of this.dirty) dirty.add(under(path) ? swap(path) : path);
    this.dirty = dirty;
    for (const [key, slot] of [...this.slots]) {
      if (!under(key)) continue;
      this.slots.delete(key);
      slot.path = swap(key);
      this.slots.set(slot.path, slot);
    }
    for (const pane of this.panes.values()) if (pane.path) pane.path = swap(pane.path);
  }

  private rekey<T>(map: Map<string, T>, under: (path: string) => boolean, swap: (path: string) => string) {
    for (const [key, value] of [...map]) {
      if (!under(key)) continue;
      map.delete(key);
      map.set(swap(key), value);
    }
  }

  /** Notes that were deleted: no pane shows them and nothing is kept. */
  forget(under: (path: string) => boolean) {
    for (const pane of this.panes.values()) if (pane.path && under(pane.path)) this.releasePane(pane);
    for (const p of [...this.states.keys()].filter(under)) this.states.delete(p);
    for (const p of [...this.scrollTops.keys()].filter(under)) this.scrollTops.delete(p);
    this.dropSaves(under);
  }

  private dropSaves(under: (path: string) => boolean) {
    for (const path of [...this.saveTimers.keys()]) if (under(path)) this.clearTimer(this.saveTimers, path);
    for (const path of [...this.retryTimers.keys()]) if (under(path)) this.clearTimer(this.retryTimers, path);
    for (const path of [...this.retryAttempt.keys()]) if (under(path)) this.retryAttempt.delete(path);
    for (const path of [...this.dirty]) if (under(path)) this.dirty.delete(path);
    for (const path of [...this.slots.keys()]) if (under(path)) this.slots.delete(path);
  }

  private clearTimer(map: Map<string, number>, path: string) {
    clearTimeout(map.get(path));
    map.delete(path);
  }

  private slot(path: string): SaveSlot {
    let slot = this.slots.get(path);
    if (!slot) {
      slot = { path };
      this.slots.set(path, slot);
    }
    return slot;
  }

  // ----- saving -----

  /** Block new writes for these paths until release. In-flight writes still finish. */
  hold(under: (path: string) => boolean): void {
    this.holds.push(under);
    pushPathHold(under);
  }

  /** Drop one hold taken with the same function. */
  release(under: (path: string) => boolean): void {
    const at = this.holds.lastIndexOf(under);
    if (at >= 0) this.holds.splice(at, 1);
    popPathHold(under);
  }

  /** True when a note still has text that has not reached disk. */
  hasUnsaved(which: (path: string) => boolean = () => true): boolean {
    return this.pending(which).size > 0;
  }

  /** A seal blocks every write. A hold blocks every write except the drain that runs before the rename or delete. */
  private blocked(path: string): boolean {
    if (writesSealed()) return true;
    if (drainAllows(path)) return false;
    return this.holds.some((under) => under(path)) || pathHeld(path);
  }

  private scheduleSave(path: string) {
    const slot = this.slot(path);
    this.dirty.add(slot.path);
    this.retryAttempt.delete(slot.path);
    this.clearTimer(this.retryTimers, slot.path);
    this.clearTimer(this.saveTimers, slot.path);
    // The callback reads slot.path when it fires, so a rename in between saves the new path.
    this.saveTimers.set(slot.path, window.setTimeout(() => {
      this.saveTimers.delete(slot.path);
      void this.save(slot.path);
    }, SAVE_DELAY));
  }

  private scheduleRetry(slot: SaveSlot) {
    const n = this.retryAttempt.get(slot.path) ?? 0;
    this.retryAttempt.set(slot.path, n + 1);
    this.clearTimer(this.retryTimers, slot.path);
    this.retryTimers.set(slot.path, window.setTimeout(() => {
      this.retryTimers.delete(slot.path);
      void this.save(slot.path);
    }, retryDelay(n)));
  }

  /**
   * Write `path` now. False: the write failed, or the path moved and the follow-up has not finished.
   * A timer-driven follow-up (`eager` false) leaves a debounce that has not elapsed yet; flush does not.
   */
  private save(path: string, eager = false): Promise<boolean> {
    const slot = this.slot(path);
    if (slot.job) {
      return slot.job.then(() => {
        const at = slot.path;
        if (!eager && this.saveTimers.has(at)) return true;
        return this.dirty.has(at) || this.saveTimers.has(at) || this.retryTimers.has(at) ? this.save(at, eager) : true;
      });
    }
    let job!: Promise<boolean>;
    const written = this.write(slot).finally(() => {
      if (slot.job === job) slot.job = undefined;
    });
    job = written.then((ok) => {
      // The file was renamed while this write was in flight: put the same text at the new path.
      // A timer-driven save still waits out the debounce a newer keystroke just armed.
      if (slot.path !== path && this.dirty.has(slot.path)) {
        if (!eager && this.saveTimers.has(slot.path)) return true;
        return this.save(slot.path, eager);
      }
      return ok;
    });
    slot.job = job;
    return job;
  }

  private async write(slot: SaveSlot): Promise<boolean> {
    this.clearTimer(this.saveTimers, slot.path);
    this.clearTimer(this.retryTimers, slot.path);
    const path = slot.path;
    const state = this.states.get(path);
    if (!state) {
      this.dirty.delete(path);
      return true;
    }
    if (this.blocked(path)) {
      this.dirty.add(path);
      this.scheduleSave(path);
      return false;
    }
    // A direct write accepted after this edit owns the path. Do not put the older text back.
    // Leave it dirty when that write is still queued, so a delete will not skip it.
    if (slot.gen !== undefined && pathGen(path) > slot.gen) {
      const queued = queuedNote(pageVault() || sourceVault(), path);
      if (!queued) this.dirty.delete(path);
      return !queued;
    }
    const text = state.doc.toString();
    let failed = false;
    try {
      const status = await writeVaultNote(path, text, undefined, slot.gen, sourceVault());
      if (status !== "sent") {
        this.dirty.add(path);
        this.scheduleSave(path);
        return false;
      }
    } catch (err) {
      console.error(`Could not save ${path}`, err);
      failed = true;
    }
    const landed = slot.path;
    if (!this.states.has(landed)) {
      this.dirty.delete(landed);
      return true;
    }
    if (landed !== path) {
      this.dirty.add(landed);
      return false;
    }
    const latest = this.states.get(landed);
    const moved = !!latest && latest.doc.toString() !== text;
    if (failed) {
      this.dirty.add(landed);
      // A newer keystroke is written on the next pass. Backoff waits only when this text itself failed.
      if (moved) {
        if (!this.saveTimers.has(landed)) this.scheduleSave(landed);
        return false;
      }
      this.scheduleRetry(slot);
      return false;
    }
    if (moved) {
      this.dirty.add(landed);
      if (!this.saveTimers.has(landed) && !this.retryTimers.has(landed)) this.scheduleSave(landed);
      return false;
    }
    this.dirty.delete(landed);
    this.retryAttempt.delete(landed);
    this.events.saved(landed);
    return true;
  }

  /** Dirty note text, for a vault handoff that has to survive reload. */
  snapshot(): { path: string; text: string; gen: number }[] {
    const out: { path: string; text: string; gen: number }[] = [];
    for (const path of this.dirty) {
      const text = this.states.get(path)?.doc.toString();
      if (text === undefined) continue;
      out.push({ path, text, gen: this.slots.get(path)?.gen ?? pathGen(path) });
    }
    return out;
  }

  /** Paths with a waiting edit, a timer, or a write still in flight. */
  private pending(which: (path: string) => boolean): Set<string> {
    const paths = new Set<string>();
    for (const path of this.dirty) if (which(path)) paths.add(path);
    for (const path of this.saveTimers.keys()) if (which(path)) paths.add(path);
    for (const path of this.retryTimers.keys()) if (which(path)) paths.add(path);
    for (const [path, slot] of this.slots) if (slot.job && which(path)) paths.add(path);
    return paths;
  }

  /**
   * Save now whatever is waiting, for the notes `which` picks (all by default).
   * A keystroke that lands while the write is in flight is written too.
   * Resolves false when a write failed and that note is still dirty.
   */
  async flush(which: (path: string) => boolean = () => true): Promise<boolean> {
    // A failed write is tried once per flush, then left on its backoff. A newer keystroke is written in the next pass.
    const backedOff = new Set<string>();
    for (let pass = 0; pass < 8; pass++) {
      const paths = [...this.pending(which)].filter((path) => !backedOff.has(path));
      if (!paths.length) return ![...this.retryTimers.keys()].some(which);
      await Promise.all(paths.map((path) => this.save(path, true)));
      for (const path of this.retryTimers.keys()) if (which(path)) backedOff.add(path);
    }
    return !this.pending(which).size;
  }
}

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
import { countsField } from "./editor/counts";
import { createNoteState, VIEW_MODES, type ViewMode, viewModeCompartment, viewModeOf } from "./editor/editor";
import type { EditorHost } from "./editor/host";
import { duration, nextFrame, smoothScrollTo } from "./motion";
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

/** What the editors tell the workspace. */
export interface EditorEvents {
  /** A pane now shows another tab or note (`path` null: none). */
  shown(group: Group, path: string | null): void;
  /** A note a pane was waiting for has loaded and is on screen. */
  loaded(): void;
  /** A note's text changed in an editor. */
  changed(): void;
  /** A note was written to disk. */
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
    let pane = this.panes.get(group);
    if (pane) return pane;
    const view = new EditorView({ dispatchTransactions: (trs, v) => this.dispatch(trs, v) });
    pane = { group, view, scroller: null, tab: null, path: null };
    this.panes.set(group, pane);
    this.paneOfView.set(view, pane);
    return pane;
  }

  viewOf(group: Group): EditorView {
    return this.pane(group).view;
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
    }
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
    this.release(pane);
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

  /**
   * Smoothly scroll a document position to the middle of a group's editor.
   * A long jump cuts to one screen short of the target first, so the editor
   * never has to render every line in between.
   */
  async glide(group: Group, pos: number) {
    const { scroller, view } = this.pane(group);
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
      if (!tr.isUserEvent("external")) this.scheduleSave(path);
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
    if (!owner || owner === view) return false;
    return (isRedo ? redo : undo)(owner);
  }

  // ----- notes -----

  async load(path: string): Promise<EditorState | null> {
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
    if (tr.docChanged && !tr.isUserEvent("external")) this.scheduleSave(path);
  }

  /** A loaded note changed on disk (not by us, nothing unsaved): take the new text. */
  async reload(path: string) {
    if (!this.states.has(path) || this.saveTimers.has(path)) return;
    const text = await api.readNote(path).catch(() => null);
    const current = this.doc(path);
    if (text === null || !current || text === current.toString()) return;
    this.change(path, { changes: { from: 0, to: current.length, insert: text }, userEvent: "external" });
  }

  /** Paths under a moved folder (or a moved note) follow it. */
  move(under: (path: string) => boolean, swap: (path: string) => string) {
    for (const map of [this.states, this.scrollTops, this.owners] as Map<string, unknown>[]) {
      for (const [key, value] of [...map]) {
        if (!under(key)) continue;
        map.delete(key);
        map.set(swap(key), value);
      }
    }
    for (const pane of this.panes.values()) if (pane.path) pane.path = swap(pane.path);
  }

  /** Notes that were deleted: no pane shows them and nothing is kept. */
  forget(under: (path: string) => boolean) {
    for (const pane of this.panes.values()) if (pane.path && under(pane.path)) this.release(pane);
    for (const p of [...this.states.keys()].filter(under)) this.states.delete(p);
    for (const p of [...this.scrollTops.keys()].filter(under)) this.scrollTops.delete(p);
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
    this.events.saved(path);
  }

  /** Save now whatever is waiting to be saved, for the notes `which` picks (all by default). */
  async flush(which: (path: string) => boolean = () => true) {
    await Promise.all(
      [...this.saveTimers.keys()].filter(which).map((path) => {
        clearTimeout(this.saveTimers.get(path));
        return this.save(path);
      }),
    );
  }
}

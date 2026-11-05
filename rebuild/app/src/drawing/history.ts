// Undo and redo for a drawing. A step keeps copies of the raw records it
// changed, before and after, plus the length of `elements` either side, so
// undo puts the file's own records back rather than inverting an edit. Undoing
// every step returns the scene to what was read, and the scene is clean
// again: a save then writes the original bytes.
//
// A gesture runs as a transaction. `preview` changes an element without a new
// version while the pointer moves; `commit` makes one stamped change per
// element and records the step. `cancel` (Escape) puts everything back.

import {
  addElement, cloneRecord, findElement, previewElement, putRecord, recordAt, restoreRecords, updateElement,
  type DrawingElement, type Json, type JsonObject, type Scene, type Stamp,
} from "./scene";

type Patch = Record<string, Json | undefined>;

export interface Step {
  before: Map<number, JsonObject>;
  after: Map<number, JsonObject>;
  lengthBefore: number;
  lengthAfter: number;
  selectionBefore: string[];
  selectionAfter: string[];
}

const LIMIT = 200;
const lengthOf = (scene: Scene) => Array.isArray(scene.data.elements) ? scene.data.elements.length : 0;

export class Transaction {
  readonly lengthBefore: number;
  readonly selectionBefore: string[];
  private readonly before = new Map<number, JsonObject>();
  private readonly slots = new Map<string, number>();
  private readonly pending = new Map<string, Patch>();
  private readonly dirtyBefore: boolean;
  private done = false;

  constructor(private readonly history: DrawingHistory, readonly scene: Scene, selection: readonly string[], private readonly stamp: Stamp) {
    this.lengthBefore = lengthOf(scene);
    this.selectionBefore = [...selection];
    this.dirtyBefore = scene.dirty;
  }

  /** Remember element `id` as it is now, before the first change to it. */
  touch(id: string): DrawingElement | undefined {
    const el = findElement(this.scene, id);
    if (!el) return undefined;
    if (!this.slots.has(id)) {
      this.slots.set(id, el.slot);
      const raw = recordAt(this.scene, el.slot);
      if (raw && el.slot < this.lengthBefore) this.before.set(el.slot, cloneRecord(raw));
    }
    return el;
  }

  /** A live change: drawn now, stamped once at `commit`. Each call replaces the last one for `id`. */
  preview(id: string, patch: Patch): DrawingElement | undefined {
    const el = this.touch(id);
    if (!el) return undefined;
    const slot = this.slots.get(id)!;
    const base = this.before.get(slot);
    // Start from the record as it was, so a field the last frame set and this one doesn't goes back.
    if (base) putRecord(this.scene, slot, base);
    this.pending.set(id, patch);
    return previewElement(this.scene, id, patch);
  }

  /** A stamped change, made now. */
  update(id: string, patch: Patch): DrawingElement | undefined {
    if (!this.touch(id)) return undefined;
    return updateElement(this.scene, id, patch, this.stamp);
  }

  /**
   * `patch` on top of what this transaction already holds for `id`: added to
   * its live change if it has one, made now if not. A gesture that gathers
   * every element's patch first and merges each once stamps it once.
   */
  merge(id: string, patch: Patch): DrawingElement | undefined {
    const live = this.pending.get(id);
    return live ? this.preview(id, { ...live, ...patch }) : this.update(id, patch);
  }

  /**
   * Fold `patch` into the live change for `id` and draw it now, without a new
   * version. `commit` stamps it once. Unlike `merge`, this never stamps on
   * the first call, so a gesture can add followers on every frame.
   */
  absorb(id: string, patch: Patch): DrawingElement | undefined {
    const live = this.pending.get(id);
    return this.preview(id, live ? { ...live, ...patch } : patch);
  }

  /** Whether `id` has a live change waiting for `commit`. */
  isLive(id: string): boolean { return this.pending.has(id); }

  add(type: string, props: Record<string, Json>): DrawingElement {
    const el = addElement(this.scene, type, props, this.stamp);
    this.slots.set(el.id, el.slot);
    return el;
  }

  /** Ids this transaction changed or added. */
  ids(): string[] { return [...this.slots.keys()]; }

  /** Finish: stamp the live changes and record the step. Returns false if nothing changed. */
  commit(selection: readonly string[]): boolean {
    if (this.done) return false;
    this.done = true;
    for (const [id, patch] of this.pending) {
      const slot = this.slots.get(id)!;
      const base = this.before.get(slot);
      if (!base) continue;
      putRecord(this.scene, slot, base);
      updateElement(this.scene, id, patch, this.stamp);
    }
    const length = lengthOf(this.scene);
    const after = new Map<number, JsonObject>();
    for (const slot of this.slots.values()) {
      const raw = recordAt(this.scene, slot);
      if (raw) after.set(slot, cloneRecord(raw));
    }
    for (let slot = this.lengthBefore; slot < length; slot++) {
      const raw = recordAt(this.scene, slot);
      if (raw && !after.has(slot)) after.set(slot, cloneRecord(raw));
    }
    let changed = length !== this.lengthBefore;
    if (!changed) for (const [slot, raw] of this.before) if (JSON.stringify(raw) !== JSON.stringify(after.get(slot))) { changed = true; break; }
    if (!changed) { this.scene.dirty = this.dirtyBefore; return false; }
    this.history.push({ before: this.before, after, lengthBefore: this.lengthBefore, lengthAfter: length, selectionBefore: this.selectionBefore, selectionAfter: [...selection] });
    return true;
  }

  /** Put back everything this transaction changed and drop what it added. */
  cancel() {
    if (this.done) return;
    this.done = true;
    restoreRecords(this.scene, this.before, this.lengthBefore);
    this.scene.dirty = this.dirtyBefore;
  }
}

export class DrawingHistory {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  /** Steps applied since the scene was read; at 0 the scene matches the file it came from. */
  private depth = 0;
  constructor(private readonly stamp: Stamp = {}) {}

  begin(scene: Scene, selection: readonly string[]): Transaction {
    return new Transaction(this, scene, selection, this.stamp);
  }

  push(step: Step) {
    this.undoStack.push(step);
    if (this.undoStack.length > LIMIT) {
      this.undoStack.shift();
      // The oldest step can't be undone now, so the read state can't come back.
      this.depth = Number.NaN;
    }
    this.redoStack = [];
    this.depth++;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Undo one step. Returns the selection to show, or null if there was nothing to undo. */
  undo(scene: Scene): string[] | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    restoreRecords(scene, step.before, step.lengthBefore);
    this.redoStack.push(step);
    this.depth--;
    scene.dirty = this.depth !== 0;
    return step.selectionBefore;
  }

  redo(scene: Scene): string[] | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    restoreRecords(scene, step.after, step.lengthAfter);
    this.undoStack.push(step);
    this.depth++;
    scene.dirty = true;
    return step.selectionAfter;
  }

  /** The step undo (or redo) would apply next, for redrawing what it touches. */
  peek(forward: boolean): Step | undefined {
    const stack = forward ? this.redoStack : this.undoStack;
    return stack[stack.length - 1];
  }

  clear() { this.undoStack = []; this.redoStack = []; this.depth = 0; }
}

/** Ids of the elements a step touches, to redraw after undo or redo. */
export function stepIds(step: Pick<Step, "before" | "after">): string[] {
  const ids = new Set<string>();
  for (const raw of [...step.before.values(), ...step.after.values()]) if (typeof raw.id === "string") ids.add(raw.id);
  return [...ids];
}

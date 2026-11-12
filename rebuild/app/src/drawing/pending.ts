// Open drawing tabs save their edits after a short pause. The writer is owned
// by the path, so a rename, a move or a delete cannot leave a retry that
// recreates the old file. Free of the DOM, so file operations can use it.

import { createOwnedSaves, type OwnedHandle, type OwnedHooks } from "../ownedSave";

interface PendingDrawing {
  /** The file the tab saves to. */
  readonly path: string;
  /** Write the waiting edit now, if any; resolves when every save so far is on disk. */
  save(): Promise<void>;
}

const open = new Set<PendingDrawing>();
/** Writes that already started, including from a tab that has since closed. */
const inflight = new Set<{ path: string; work: Promise<void> }>();
const owned = createOwnedSaves(300);

/** Track an open drawing tab until the returned function is called. */
export function trackDrawing(drawing: PendingDrawing): () => void {
  open.add(drawing);
  return () => open.delete(drawing);
}

/** Remember a write that must finish even if its tab has already closed. */
export function holdDrawingWrite(path: string, work: Promise<void>): Promise<void> {
  const entry = { path, work };
  inflight.add(entry);
  void work.finally(() => inflight.delete(entry));
  return work;
}

/** The one writer for this drawing path. A later view of the same path adopts it. */
export function attachDrawing(path: string, hooks?: OwnedHooks): OwnedHandle {
  return owned.attach(path, hooks);
}

export function holdDrawings(under: (path: string) => boolean): void {
  owned.hold(under);
}

export function releaseDrawings(under: (path: string) => boolean): void {
  owned.release(under);
}

export function retargetDrawings(under: (path: string) => boolean, swap: (path: string) => string): void {
  owned.retarget(under, swap);
}

export function discardDrawings(under: (path: string) => boolean): void {
  owned.discard(under);
}

export function drawingsPending(which: (path: string) => boolean = () => true): boolean {
  return owned.pending(which);
}

/** Dirty drawing text a vault reload has to keep. */
export function snapshotDrawings(): { path: string; text: string; gen: number }[] {
  return owned.snapshot();
}

/** Write the waiting edits of every drawing whose path passes `which`. */
export async function saveDrawings(which: (path: string) => boolean = () => true): Promise<boolean> {
  const jobs = [
    ...[...open].filter((drawing) => which(drawing.path)).map((drawing) => drawing.save()),
    ...[...inflight].filter((entry) => which(entry.path)).map((entry) => entry.work),
  ];
  const [saved] = await Promise.all([owned.save(which), Promise.all(jobs)]);
  return saved;
}

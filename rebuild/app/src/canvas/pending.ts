// Open canvas tabs save their edits after a short pause. The writer is owned
// by the path, so a closed tab's failed save is still flushed on quit, and a
// rename retargets it instead of leaving a retry on the old path.

import { createOwnedSaves, type OwnedHandle, type OwnedHooks } from "../ownedSave";

interface PendingCanvas {
  readonly path: string;
  /** Write the waiting edit now, if any. */
  save(): Promise<void>;
}

const open = new Set<PendingCanvas>();
const inflight = new Set<{ path: string; work: Promise<void> }>();
const owned = createOwnedSaves(300);

/** Track an open canvas tab until the returned function is called. */
export function trackCanvas(canvas: PendingCanvas): () => void {
  open.add(canvas);
  return () => open.delete(canvas);
}

/** Remember a write that must finish even if its tab has already closed. */
export function holdCanvasWrite(path: string, work: Promise<void>): Promise<void> {
  const entry = { path, work };
  inflight.add(entry);
  void work.finally(() => inflight.delete(entry));
  return work;
}

/** The one writer for this canvas path. A later view of the same path adopts it. */
export function attachCanvas(path: string, hooks?: OwnedHooks): OwnedHandle {
  return owned.attach(path, hooks);
}

export function holdCanvases(under: (path: string) => boolean): void {
  owned.hold(under);
}

export function releaseCanvases(under: (path: string) => boolean): void {
  owned.release(under);
}

export function retargetCanvases(under: (path: string) => boolean, swap: (path: string) => string): void {
  owned.retarget(under, swap);
}

export function discardCanvases(under: (path: string) => boolean): void {
  owned.discard(under);
}

export function canvasesPending(which: (path: string) => boolean = () => true): boolean {
  return owned.pending(which);
}

/** Dirty canvas text a vault reload has to keep. */
export function snapshotCanvases(): { path: string; text: string; gen: number }[] {
  return owned.snapshot();
}

/** Write the waiting edits of every canvas whose path passes `which`. */
export async function saveCanvases(which: (path: string) => boolean = () => true): Promise<boolean> {
  const jobs = [
    ...[...open].filter((canvas) => which(canvas.path)).map((canvas) => canvas.save()),
    ...[...inflight].filter((entry) => which(entry.path)).map((entry) => entry.work),
  ];
  const [saved] = await Promise.all([owned.save(which), Promise.all(jobs)]);
  return saved;
}

// Open canvas tabs save their edits after a short pause. Closing the window
// writes what is waiting and waits for it. A tab that has already closed can
// still have a write in flight; that promise stays here until it settles.

interface PendingCanvas {
  readonly path: string;
  /** Write the waiting edit now, if any. */
  save(): Promise<void>;
}

const open = new Set<PendingCanvas>();
const inflight = new Set<{ path: string; work: Promise<void> }>();

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

/** Write the waiting edits of every open canvas whose path passes `which`. */
export async function saveCanvases(which: (path: string) => boolean = () => true): Promise<void> {
  await Promise.all([
    ...[...open].filter((canvas) => which(canvas.path)).map((canvas) => canvas.save()),
    ...[...inflight].filter((entry) => which(entry.path)).map((entry) => entry.work),
  ]);
}

// Open drawing tabs save their edits after a short pause. A rename, a move,
// a delete, a copy or an export of that file first writes what is waiting,
// so the file on disk is the drawing as shown and no late save lands at the
// old path. Free of the DOM, so the file operations can use it.

interface PendingDrawing {
  /** The file the tab saves to. */
  readonly path: string;
  /** Write the waiting edit now, if any; resolves when every save so far is on disk. */
  save(): Promise<void>;
}

const open = new Set<PendingDrawing>();

/** Track an open drawing tab until the returned function is called. */
export function trackDrawing(drawing: PendingDrawing): () => void {
  open.add(drawing);
  return () => open.delete(drawing);
}

/** Write the waiting edits of every open drawing whose path passes `which`. */
export async function saveDrawings(which: (path: string) => boolean = () => true): Promise<void> {
  await Promise.all([...open].filter((d) => which(d.path)).map((d) => d.save()));
}

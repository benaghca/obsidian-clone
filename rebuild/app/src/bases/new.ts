import { newCanvas } from "../fileOps";
import type { Workspace } from "../workspace";
/** Reuse attachment creation's folder, naming, serialization and open behavior. */
export const newBase = (ws: Workspace, folder?: string) => newCanvas(ws, folder, "base");

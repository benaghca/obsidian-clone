// The live camera of each canvas tab. Kept off the canvas module so the
// startup bundle can drop a tab's camera without loading the board.
import type { Tab } from "../tabs";

export interface CanvasTabViewport {
  path: string;
  cx: number;
  cy: number;
  scale: number;
}

/** Only live tabs. Never part of the saved layout. */
export const canvasViewports = new WeakMap<Tab, CanvasTabViewport>();

// Quit and every window-close path wait for pending note, canvas, drawing
// and settings writes, then destroy the window. A hung write must not pin
// the window open, so the wait gives up after a short timeout.

import { saveCanvases } from "./canvas/pending";
import { saveDrawings } from "./drawing/pending";
import { settings } from "./settings/store";

/** How long a close waits for pending saves before the window is destroyed. */
export const QUIT_FLUSH_MS = 2_000;

export function flushOpenSaves(notes: () => Promise<unknown>): Promise<unknown> {
  return Promise.all([notes(), saveCanvases(), saveDrawings(), settings.flush()]);
}

export interface CloseWindow {
  onCloseRequested(handler: (event: { preventDefault(): void }) => void | Promise<void>): Promise<unknown>;
  destroy(): Promise<void>;
}

/**
 * Tauri keeps the window alive while a JS close listener exists, then this
 * handler flushes and destroys it. That is the compositor and Alt+F4 path,
 * and Grove's own close button, which asks the window to close.
 * preventDefault runs before the first await so the page is not torn down
 * while the writes are still in flight.
 */
export async function bindCloseFlush(win: CloseWindow, flush: () => Promise<unknown>, timeoutMs = QUIT_FLUSH_MS): Promise<void> {
  let closing: Promise<void> | null = null;
  await win.onCloseRequested((event) => {
    event.preventDefault();
    closing ??= (async () => {
      await raceTimeout(flush(), timeoutMs);
      await win.destroy();
    })();
    return closing;
  });
}

function raceTimeout(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    const finish = () => { clearTimeout(timer); resolve(); };
    work.then(finish, finish);
  });
}

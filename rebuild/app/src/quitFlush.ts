// Quit and every window-close path wait for pending note, canvas, drawing
// and settings writes, then destroy the window. A failed save is retried
// with backoff until it lands or the deadline passes. A hung write must not
// pin the window open, so the wait gives up after a short timeout.

import { saveCanvases } from "./canvas/pending";
import { saveDrawings } from "./drawing/pending";
import { retryDelay } from "./fileSave";
import { settings } from "./settings/store";
import { flushHandoff } from "./vaultWrite";

/** How long a close waits for pending saves before the window is destroyed. */
export const QUIT_FLUSH_MS = 2_000;

export async function flushOpenSaves(notes: () => Promise<unknown>): Promise<boolean> {
  const [note, canvas, drawing, pref] = await Promise.all([
    Promise.resolve()
      .then(notes)
      .then((ok) => ok !== false, () => false),
    saveCanvases().then((ok) => ok !== false, () => false),
    saveDrawings().then((ok) => ok !== false, () => false),
    settings.flush().then((ok) => ok !== false, () => false),
  ]);
  // After the editors, so an older queued snapshot cannot overwrite a newer edit.
  const hand = await flushHandoff().then((ok) => ok !== false, () => false);
  return note && canvas && drawing && pref && hand;
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
      await flushUntilClean(flush, timeoutMs);
      await win.destroy();
    })();
    return closing;
  });
}

/** Grove's X. close() runs the handler above, which owns the deadline. */
export function requestClose(win: { close(): Promise<void> | void }): void {
  void win.close();
}

/**
 * Try the flush, and when something is still dirty wait out the backoff and
 * try again, until every save is clean or `timeoutMs` from now. The deadline
 * is not reset when a retry starts. A flush that never settles still loses
 * to the deadline.
 */
async function flushUntilClean(flush: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (true) {
    const remain = deadline - Date.now();
    if (remain <= 0) return;
    const ok = await raceTimeout(flush(), remain);
    if (ok === null || ok) return;
    const gap = Math.min(retryDelay(attempt), deadline - Date.now());
    attempt += 1;
    if (gap <= 0) return;
    await sleep(gap);
  }
}

/** True when the flush finished clean, false when it failed, null when the deadline won. */
function raceTimeout(work: Promise<unknown>, timeoutMs: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    const finish = (ok: boolean) => { clearTimeout(timer); resolve(ok); };
    work.then((value) => finish(value !== false), () => finish(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

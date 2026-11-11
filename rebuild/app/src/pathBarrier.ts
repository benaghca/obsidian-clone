// A rename or delete in one window has to finish the other windows' pending
// saves of that path first. Holds are per page, so a pop-out would otherwise
// write the old path back after this window moved or trashed it.

import { retryDelay } from "./fileSave";
import { beginHoldDrain } from "./holdDrain";
import { isUnder, movedPath } from "./paths";
import { type SwitchIo, switchIo } from "./vaultSwitch";
import { flushHandoff } from "./vaultWrite";

const HOLD = "grove-path-hold";
const ACK = "grove-path-ack";
const DONE = "grove-path-done";
const DONE_ACK = "grove-path-done-ack";
const PEER_WAIT_MS = 2_000;

export interface PathOps {
  hold(under: (path: string) => boolean): void;
  release(under: (path: string) => boolean): void;
  flush(under: (path: string) => boolean): Promise<boolean>;
  /** Queued direct writes for this page. Defaults to this page's journal. */
  handoff?(): Promise<boolean>;
  retarget(under: (path: string) => boolean, swap: (path: string) => string): void;
  discard(under: (path: string) => boolean): void;
  /** Workspace tabs, history, and move listeners. Ack waits until this settles. */
  moved?(from: string, to: string, swap: (path: string) => string): Promise<void> | void;
  /** Workspace tabs and history after a delete. Ack waits until this settles. */
  removed?(under: (path: string) => boolean): Promise<void> | void;
}

interface PathBody {
  id?: string;
  from?: string;
  label?: string;
  ok?: boolean;
  path?: string;
  to?: string | null;
}

let peerOverride: SwitchIo | undefined;

/** Tests point both sides at one bus. Production leaves this unset. */
export function usePathPeers(io: SwitchIo | undefined): void {
  peerOverride = io;
}

function bodyOf(payload: unknown): PathBody {
  return payload && typeof payload === "object" ? payload as PathBody : {};
}

async function resolveIo(): Promise<SwitchIo | null | "local"> {
  if (peerOverride) return peerOverride;
  try {
    return await switchIo();
  } catch {
    // A test mock that does not export isTauri throws when that binding is read.
    return "local";
  }
}

async function currentPeers(): Promise<SwitchIo | null | "local"> {
  const io = await resolveIo();
  // No other windows right now: nothing to wait for. A failed window list is null.
  if (io === "local" || io === null || io.others.length === 0) return io === null ? null : "local";
  return io;
}

/** The bus a later window can emit on. An unlabeled empty bus is not shared. */
function sharedBus(io: SwitchIo | null | "local"): SwitchIo | null {
  if (!io || io === "local") return null;
  if (io.self === "" && io.others.length === 0) return null;
  return io;
}

function timerHost(): { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") return window;
  return globalThis;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { timerHost().setTimeout(resolve, ms); });
}

/** Drop labels whose windows are gone. A peer that is still open stays pending. */
async function dropDeparted(io: SwitchIo, pending: Set<string>): Promise<void> {
  if (!io.listWindows) return;
  let labels: string[];
  try { labels = await io.listWindows(); } catch { return; }
  const live = new Set(labels);
  for (const label of [...pending]) if (!live.has(label)) pending.delete(label);
}

/**
 * Tell peers the path changed. An ack wakes the wait at once. The foreground
 * wait is bounded; retries continue in the background. A living peer stays
 * held until it acks. A window that has gone is not waited on.
 */
async function finishPeers(io: SwitchIo, id: string, ok: boolean, to: string | null): Promise<void> {
  if (!io.others.length) {
    try { await io.bus.emit(DONE, { id, from: io.self, ok, to }); } catch { /* no peer is waiting */ }
    return;
  }
  const pending = new Set(io.others);
  let wake = () => {};
  const unlisten = await io.bus.listen(DONE_ACK, (payload) => {
    const body = bodyOf(payload);
    if (body.id !== id || !body.label || !pending.has(body.label)) return;
    pending.delete(body.label);
    wake();
  });
  const finished = (async () => {
    let attempt = 0;
    while (pending.size) {
      try { await io.bus.emit(DONE, { id, from: io.self, ok, to }); } catch { /* retain the transaction and retry */ }
      await dropDeparted(io, pending);
      if (!pending.size) break;
      const acked = new Promise<void>((resolve) => { wake = resolve; });
      await Promise.race([acked, sleep(retryDelay(attempt))]);
      attempt += 1;
    }
  })();
  let cancelBudget = () => {};
  const budget = new Promise<void>((resolve) => {
    const timer = timerHost().setTimeout(resolve, PEER_WAIT_MS);
    cancelBudget = () => { timerHost().clearTimeout(timer); resolve(); };
  });
  await Promise.race([finished, budget]);
  cancelBudget();
  if (!pending.size) unlisten();
  else void finished.finally(() => unlisten());
}

function askHold(io: SwitchIo, id: string, path: string): Promise<boolean> {
  if (!io.others.length) return Promise.resolve(true);
  const pending = new Set(io.others);
  let settled = false;
  let timer = 0;
  let stop = () => {};
  let resolveFinish!: (ok: boolean) => void;
  const done = new Promise<boolean>((resolve) => { resolveFinish = resolve; });
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    timerHost().clearTimeout(timer);
    stop();
    resolveFinish(ok);
  };
  return io.bus.listen(ACK, (payload) => {
    const body = bodyOf(payload);
    if (body.id !== id || !body.label || !pending.has(body.label)) return;
    if (!body.ok) { finish(false); return; }
    pending.delete(body.label);
    if (!pending.size) finish(true);
  }).then((unlisten) => {
    stop = unlisten;
    timer = timerHost().setTimeout(() => finish(false), PEER_WAIT_MS);
    return io.bus.emit(HOLD, { id, from: io.self, path }).then(() => done);
  });
}

/**
 * Other windows flush `from` and hold it. Then `run` renames or deletes.
 * `to` null is a delete. False means a peer was still saving: `run` did not start.
 */
export async function coordinatePaths(from: string, to: string | null, run: () => Promise<boolean>): Promise<boolean> {
  const io = await currentPeers();
  if (io === "local" || (io !== null && io.others.length === 0)) return run();
  if (!io) {
    console.warn(to === null ? "Could not delete while windows could not be listed" : "Could not rename while windows could not be listed");
    return false;
  }
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const agreed = await askHold(io, id, from);
  if (!agreed) {
    console.warn(to === null ? "Could not delete while a window is still saving" : "Could not rename while a window is still saving");
    await finishPeers(io, id, false, to);
    return false;
  }
  let ok = false;
  try {
    ok = await run();
  } catch (err) {
    await finishPeers(io, id, false, to);
    throw err;
  }
  await finishPeers(io, id, ok, to);
  return ok;
}

/** Pop-out (and the main window) answer a rename or delete started somewhere else. */
export async function installPathBarrier(ops: PathOps, io?: Pick<SwitchIo, "bus" | "self">): Promise<void> {
  // Listen even when this is the only window. A pop-out can open later and
  // rename; currentPeers() would treat "alone right now" as nothing to install.
  const resolved = io ?? sharedBus(await resolveIo());
  if (!resolved) return;
  const bus = resolved.bus;
  const self = resolved.self;
  const held = new Map<string, { under: (path: string) => boolean; from: string }>();
  await bus.listen(HOLD, (payload) => {
    const body = bodyOf(payload);
    if (!body.id || !body.path || body.from === self) return;
    const from = body.path;
    const under = (path: string) => isUnder(path, from);
    held.set(body.id, { under, from });
    ops.hold(under);
    void (async () => {
      let ok = false;
      const endDrain = beginHoldDrain(under);
      try {
        ok = (await ops.flush(under)) !== false;
        // A failed queued snapshot must refuse the delete. The bytes stay queued.
        const handed = await (ops.handoff ?? flushHandoff)();
        if (!handed) ok = false;
      } catch { ok = false; }
      finally { endDrain(); }
      await bus.emit(ACK, { id: body.id, label: self, ok });
    })();
  });
  await bus.listen(DONE, (payload) => {
    const body = bodyOf(payload);
    if (!body.id || body.from === self) return;
    const ack = () => { void bus.emit(DONE_ACK, { id: body.id, label: self, ok: true }); };
    const mine = held.get(body.id);
    // Already applied (a retry). Ack again so the initiator can stop.
    if (!mine) { ack(); return; }
    const settle = (follow: Promise<void> | void | undefined, after: () => void) => {
      if (follow && typeof follow.then === "function") {
        void follow.then(() => {
          if (!held.has(body.id!)) return;
          held.delete(body.id!);
          ack();
          after();
        }, () => { /* stay held; the initiator retries DONE */ });
        return;
      }
      held.delete(body.id!);
      ack();
      after();
    };
    if (body.ok && body.to) {
      const next = body.to;
      const swap = (path: string) => movedPath(path, mine.from, next);
      ops.retarget(mine.under, swap);
      settle(ops.moved?.(mine.from, next, swap), () => {
        ops.release(mine.under);
        void ops.flush((path) => isUnder(path, next));
      });
      return;
    }
    if (body.ok) {
      ops.discard(mine.under);
      settle(ops.removed?.(mine.under), () => { ops.release(mine.under); });
      return;
    }
    held.delete(body.id);
    ack();
    ops.release(mine.under);
  });
}

// Switching vaults changes the backend root for every window. Pending saves
// have to land in the old vault first, and then stop, or a note from vault A
// is written onto the same name in vault B. Pop-out windows share that root,
// so they flush and seal before the switch too.

import { isTauri } from "./api";
import { canvasesPending, saveCanvases } from "./canvas/pending";
import { drawingsPending, saveDrawings } from "./drawing/pending";
import { sealWrites, unsealWrites, writesSealed } from "./saveSeal";
import { settings } from "./settings/store";

const BARRIER = "grove-save-barrier";
const ACK = "grove-save-ack";
const THAW = "grove-save-thaw";
const RELOAD = "grove-save-reload";
const PEER_WAIT_MS = 2_000;

export interface EventBus {
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
  emit(event: string, payload?: unknown): Promise<void>;
}

export interface SaveBarrier {
  flushNotes(): Promise<boolean>;
  dirty(): boolean;
  reload(): void;
  warn?(message: string, err?: unknown): void;
}

export interface VaultSwitchDeps extends SaveBarrier {
  open(path: string, create: boolean): Promise<{ path: string; name: string }>;
}

export interface SwitchIo {
  bus: EventBus;
  /** Labels of the other windows that must acknowledge the barrier. */
  others: string[];
  self: string;
}

/** In-memory bus for tests. Listeners are registered before the returned promise resolves. */
export function localSaveBus(): EventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    listen(event, handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, set = new Set());
      set.add(handler);
      return Promise.resolve(() => set!.delete(handler));
    },
    emit(event, payload) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(payload);
      return Promise.resolve();
    },
  };
}

export function savesPending(notes: { hasUnsaved(): boolean }): boolean {
  return notes.hasUnsaved() || canvasesPending() || drawingsPending() || settings.hasUnsaved();
}

let switching = false;
/** Barrier ids whose switch already aborted. A slow peer must not seal after that. */
const cancelled = new Set<string>();

async function flushLocal(deps: SaveBarrier): Promise<boolean> {
  const [notes, canvases, drawings, prefs] = await Promise.all([
    deps.flushNotes().then((ok) => ok !== false, () => false),
    saveCanvases().then((ok) => ok !== false, () => false),
    saveDrawings().then((ok) => ok !== false, () => false),
    settings.flush().then((ok) => ok !== false, () => false),
  ]);
  return notes && canvases && drawings && prefs;
}

function payloadId(payload: unknown): { id?: string; from?: string; label?: string; ok?: boolean } {
  return payload && typeof payload === "object" ? payload as { id?: string; from?: string; label?: string; ok?: boolean } : {};
}

/** Pop-out (and the main window) answer a switch started somewhere else. */
export async function installVaultSwitch(deps: SaveBarrier, io?: Pick<SwitchIo, "bus" | "self">): Promise<void> {
  const bus = io?.bus ?? (await defaultBus());
  if (!bus) return;
  const self = io?.self ?? (await selfLabel());
  await bus.listen(BARRIER, (payload) => {
    const body = payloadId(payload);
    if (!body.id || body.from === self) return;
    const id = body.id;
    void (async () => {
      const clean = await flushLocal(deps);
      if (cancelled.has(id)) {
        await bus.emit(ACK, { id, label: self, ok: false });
        return;
      }
      const ok = clean && !deps.dirty();
      // This window's own seal. The switcher seals separately, after every peer agrees.
      if (ok) sealWrites();
      await bus.emit(ACK, { id, label: self, ok });
    })();
  });
  await bus.listen(THAW, (payload) => {
    const body = payloadId(payload);
    if (body.id) cancelled.add(body.id);
    if (body.from === self) return;
    if (!switching) unsealWrites();
  });
  // The sender reloads itself. Other windows reload from the event. Filter
  // on `from` only: `switching` is still set on the sender while a peer
  // handles this, and that must not stop the peer from reloading.
  await bus.listen(RELOAD, (payload) => {
    if (payloadId(payload).from === self) return;
    deps.reload();
  });
}

/**
 * Flush the old vault, seal, ask other windows, then open the new one.
 * A dirty or hung save aborts the switch and leaves the retries on the old
 * vault. There is no notice. After a successful open the seal stays up so
 * the reload's beforeunload cannot write into the new vault.
 */
export async function commitVaultSwitch(path: string, create: boolean, deps: VaultSwitchDeps, io?: SwitchIo): Promise<boolean> {
  // A finished switch leaves the seal up until this page reloads. Another
  // attempt must not open a vault underneath that.
  if (switching || writesSealed()) return false;
  switching = true;
  const warn = (message: string, err?: unknown) => deps.warn?.(message, err);
  try {
    const clean = await flushLocal(deps);
    if (!clean || deps.dirty()) {
      warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
      return false;
    }
    const peers = io ?? (await defaultIo());
    if (!peers) {
      warn("Could not list windows before switching vaults");
      return false;
    }
    // Peers flush in their own pages, where this seal is not visible. Seal
    // only once they agree, and do it before the open await so a timer here
    // cannot write after the backend root changes.
    const agreed = await askPeers(peers);
    if (!agreed || deps.dirty()) {
      unsealWrites();
      await thawPeers(peers);
      warn("Could not switch vaults while a window is still saving");
      return false;
    }
    sealWrites();
    try {
      await deps.open(path, create);
    } catch (err) {
      unsealWrites();
      await thawPeers(peers);
      warn(create ? "Could not create vault" : "Could not open vault", err);
      return false;
    }
    await peers.bus.emit(RELOAD, { from: peers.self });
    deps.reload();
    return true;
  } catch (err) {
    unsealWrites();
    warn(create ? "Could not create vault" : "Could not open vault", err);
    return false;
  } finally {
    switching = false;
  }
}

async function askPeers(io: SwitchIo): Promise<boolean> {
  if (!io.others.length) return true;
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pending = new Set(io.others);
  let settled = false;
  let timer = 0;
  let stop = () => {};
  let resolveFinish!: (ok: boolean) => void;
  const done = new Promise<boolean>((resolve) => { resolveFinish = resolve; });
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    if (!ok) cancelled.add(id);
    else cancelled.delete(id);
    clearTimeout(timer);
    stop();
    resolveFinish(ok);
  };
  stop = await io.bus.listen(ACK, (payload) => {
    const body = payloadId(payload);
    if (body.id !== id || !body.label || !pending.has(body.label)) return;
    if (!body.ok) { finish(false); return; }
    pending.delete(body.label);
    if (!pending.size) finish(true);
  });
  timer = window.setTimeout(() => finish(false), PEER_WAIT_MS);
  await io.bus.emit(BARRIER, { id, from: io.self });
  return done;
}

function thawPeers(io: SwitchIo): Promise<void> {
  return io.bus.emit(THAW, { from: io.self });
}

async function defaultBus(): Promise<EventBus | null> {
  if (!isTauri) return null;
  try {
    const { listen, emit } = await import("@tauri-apps/api/event");
    return {
      listen: (event, handler) => listen(event, (e) => handler(e.payload)).then((stop) => stop),
      emit: (event, payload) => emit(event, payload),
    };
  } catch {
    return null;
  }
}

async function selfLabel(): Promise<string> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

/** Null means the window list failed: the caller must not switch. */
async function defaultIo(): Promise<SwitchIo | null> {
  if (!isTauri) return { bus: localSaveBus(), others: [], self: "" };
  try {
    const { getAllWindows, getCurrentWindow } = await import("@tauri-apps/api/window");
    const bus = await defaultBus();
    if (!bus) return null;
    const self = getCurrentWindow().label;
    const others = (await getAllWindows()).map((win) => win.label).filter((label) => label !== self);
    return { bus, others, self };
  } catch {
    return null;
  }
}

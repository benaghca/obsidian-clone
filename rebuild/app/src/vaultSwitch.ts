// Switching vaults changes the backend root for every window. Pending saves
// have to land in the old vault, and a seal is bound to that one attempt.
// An edit that arrives after the seal rolls the root back so the bytes stay
// on the vault they belong to. Pop-out windows share the root, so they flush
// and seal for the same attempt before the switch too.

import { isTauri } from "./api";
import { canvasesPending, saveCanvases } from "./canvas/pending";
import { drawingsPending, saveDrawings } from "./drawing/pending";
import { sealWrites, unsealWrites, writesSealed } from "./saveSeal";
import { settings } from "./settings/store";
import { backendRoot, setBackendRoot, setPageVault } from "./vaultRoot";
import { flushHandoff, handoffPending, preserveAccepted, vaultQuiet } from "./vaultWrite";

const BARRIER = "grove-save-barrier";
const ACK = "grove-save-ack";
const THAW = "grove-save-thaw";
const CONFIRM = "grove-save-confirm";
const CONFIRM_ACK = "grove-save-confirm-ack";
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
  /** Backend root before open, so a rejected switch can put that vault back. */
  vault?: () => string;
}

export interface SwitchIo {
  bus: EventBus;
  /** Labels of the other windows that must acknowledge the barrier. */
  others: string[];
  self: string;
  /** Windows that still exist. A missing label has gone away and must not be waited on. */
  listWindows?: () => Promise<string[]>;
}

interface SealHooks {
  seal(): void;
  unseal(): void;
  sealed(): boolean;
}

interface BarrierBody {
  id?: string;
  from?: string;
  label?: string;
  ok?: boolean;
  /** Vault the bytes belong to. Peers preserve into this id before they reload. */
  vault?: string;
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
  return notes.hasUnsaved() || canvasesPending() || drawingsPending() || settings.hasUnsaved() || handoffPending();
}

function bodyOf(payload: unknown): BarrierBody {
  return payload && typeof payload === "object" ? payload as BarrierBody : {};
}

async function flushLocal(deps: SaveBarrier): Promise<boolean> {
  const [notes, canvases, drawings, prefs] = await Promise.all([
    deps.flushNotes().then((ok) => ok !== false, () => false),
    saveCanvases().then((ok) => ok !== false, () => false),
    saveDrawings().then((ok) => ok !== false, () => false),
    settings.flush().then((ok) => ok !== false, () => false),
  ]);
  return notes && canvases && drawings && prefs;
}

function stillDirty(deps: SaveBarrier, also?: string): boolean {
  // A queue for the vault we are leaving still counts, even after open has moved the root.
  return deps.dirty()
    || handoffPending(backendRoot())
    || (!!also && also !== backendRoot() && handoffPending(also));
}

async function emitReload(io: SwitchIo, id: string, vault: string): Promise<void> {
  try { await io.bus.emit(RELOAD, { id, from: io.self, vault }); } catch { /* this page still reloads */ }
}

async function restoreRoot(deps: VaultSwitchDeps, oldRoot: string): Promise<boolean> {
  if (!oldRoot) return false;
  try {
    const info = await deps.open(oldRoot, false);
    setBackendRoot(info.path || oldRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * One switcher. Two windows each have their own, so a thaw in one realm
 * cannot pretend to cancel a seal in the other. Tests build a second one.
 */
export function createVaultCoordinator(hooks: SealHooks) {
  let switching = false;
  let lost = false;
  let sealedFor: string | null = null;
  let ourId = "";
  const cancelled = new Set<string>();

  function newId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function seal(id: string) {
    sealedFor = id;
    hooks.seal();
  }

  /** Only the attempt that sealed can lift it. A lost race stays sealed for the winner. */
  function unseal(id: string) {
    if (sealedFor && sealedFor !== id) return;
    sealedFor = null;
    hooks.unseal();
  }

  function thawPeers(io: SwitchIo, id: string): Promise<void> {
    return io.bus.emit(THAW, { id, from: io.self }).then(() => {}, () => {});
  }

  function waitFor(io: SwitchIo, id: string, reply: string, request: string, cancelOnFail: boolean): Promise<boolean> {
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
      if (!ok && cancelOnFail) cancelled.add(id);
      clearTimeout(timer);
      stop();
      resolveFinish(ok);
    };
    return io.bus.listen(reply, (payload) => {
      const body = bodyOf(payload);
      if (body.id !== id || !body.label || !pending.has(body.label)) return;
      if (!body.ok) { finish(false); return; }
      pending.delete(body.label);
      if (!pending.size) finish(true);
    }).then((unlisten) => {
      stop = unlisten;
      timer = window.setTimeout(() => finish(false), PEER_WAIT_MS);
      return io.bus.emit(request, { id, from: io.self }).then(() => done, () => { finish(false); return false; });
    });
  }

  /** Pop-out (and the main window) answer a switch started somewhere else. */
  async function install(deps: SaveBarrier, io?: Pick<SwitchIo, "bus" | "self">): Promise<void> {
    const bus = io?.bus ?? (await defaultBus());
    if (!bus) return;
    const self = io?.self ?? (await selfLabel());
    await bus.listen(BARRIER, (payload) => {
      const body = bodyOf(payload);
      if (!body.id || body.from === self) return;
      const id = body.id;
      // Two windows can start a switch together. The smaller id goes ahead.
      // The other becomes a peer of that id and must not open a second root.
      if (ourId && id !== ourId && switching) {
        if (id < ourId) lost = true;
        else {
          void bus.emit(ACK, { id, label: self, ok: false });
          return;
        }
      }
      void (async () => {
        const clean = await flushLocal(deps);
        // The thaw may have arrived while this flush was still running.
        if (cancelled.has(id)) {
          await bus.emit(ACK, { id, label: self, ok: false });
          return;
        }
        const ok = clean && !stillDirty(deps);
        if (ok) seal(id);
        await bus.emit(ACK, { id, label: self, ok });
      })();
    });
    await bus.listen(THAW, (payload) => {
      const body = bodyOf(payload);
      if (body.id) cancelled.add(body.id);
      if (body.from === self) return;
      if (body.id && sealedFor === body.id) unseal(body.id);
    });
    await bus.listen(CONFIRM, (payload) => {
      const body = bodyOf(payload);
      if (!body.id || body.from === self) return;
      const ok = !cancelled.has(body.id) && !stillDirty(deps);
      void bus.emit(CONFIRM_ACK, { id: body.id, label: self, ok });
    });
    // Preserve first, then reload, with no await between. A keystroke that
    // landed after CONFIRM_ACK is still in the editors at this moment.
    await bus.listen(RELOAD, (payload) => {
      const body = bodyOf(payload);
      if (body.from === self) return;
      // A missed acknowledge keeps this page. Reloading would drop the only copy.
      // No vault id means there is nothing to store. A failed acknowledge keeps the page.
      if (body.vault && !preserveAccepted(body.vault)) return;
      deps.reload();
    });
  }

  async function rollback(peers: SwitchIo, id: string, deps: VaultSwitchDeps, oldRoot: string, warn: (message: string, err?: unknown) => void, create: boolean): Promise<boolean> {
    const restored = await restoreRoot(deps, oldRoot);
    if (restored) {
      unseal(id);
      await thawPeers(peers, id);
      await flushLocal(deps);
      await flushHandoff();
      warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
      return false;
    }
    // The new root is already open and the old one did not come back.
    // Stay sealed. Do not reload and do not write: the bytes are in the
    // durable handoff and the editors, and a write now would land on the new vault.
    preserveAccepted(oldRoot);
    warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
    return false;
  }

  /** Store the old vault's accepted bytes. False keeps the page and does not tell peers to reload. */
  async function reloadPreserved(peers: SwitchIo, id: string, deps: VaultSwitchDeps, oldRoot: string): Promise<boolean> {
    if (oldRoot && !preserveAccepted(oldRoot)) return false;
    await emitReload(peers, id, oldRoot);
    if (oldRoot && !preserveAccepted(oldRoot)) return false;
    deps.reload();
    return true;
  }

  /**
   * Flush the old vault, agree with other windows, seal, then open.
   * An edit accepted after the seal puts the old root back and is written
   * there. A failed save never opens. There is no notice.
   */
  async function commit(path: string, create: boolean, deps: VaultSwitchDeps, io?: SwitchIo): Promise<boolean> {
    if (switching || hooks.sealed()) return false;
    switching = true;
    lost = false;
    ourId = newId();
    const id = ourId;
    let opened = false;
    let peers: SwitchIo | null = null;
    let oldRoot = "";
    const warn = (message: string, err?: unknown) => deps.warn?.(message, err);
    try {
      oldRoot = deps.vault?.() ?? backendRoot();
      // The page keeps this identity until it actually reloads. open() may move the backend first.
      if (oldRoot) {
        setPageVault(oldRoot);
        setBackendRoot(oldRoot);
      }
      await vaultQuiet();
      // A previous attempt can leave a queue. Drain it before treating it as a reason to abort.
      if (handoffPending(backendRoot())) {
        const drained = await flushHandoff();
        if (!drained) {
          warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
          return false;
        }
      }
      const clean = await flushLocal(deps);
      if (lost) return false;
      if (!clean || stillDirty(deps, oldRoot)) {
        warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
        return false;
      }
      peers = io ?? (await switchIo());
      if (!peers) {
        warn("Could not list windows before switching vaults");
        return false;
      }
      // Peers flush where this seal is not visible yet. Seal only once they
      // agree, and before open, so a timer here cannot write the new root.
      const agreed = await waitFor(peers, id, ACK, BARRIER, true);
      if (lost || !agreed || stillDirty(deps)) {
        unseal(id);
        await thawPeers(peers, id);
        if (!lost) warn("Could not switch vaults while a window is still saving");
        return false;
      }
      seal(id);
      await vaultQuiet();
      if (lost || stillDirty(deps, oldRoot)) {
        unseal(id);
        await thawPeers(peers, id);
        await flushLocal(deps);
        await flushHandoff();
        warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
        return false;
      }
      try {
        const info = await deps.open(path, create);
        opened = true;
        // Accepted edits are stored before the read root moves, then the backend epoch flips.
        // The page vault stays on the old folder until reload.
        if (oldRoot && !preserveAccepted(oldRoot)) {
          // The backend already moved. Put the old vault back when we can, and do not reload.
          setBackendRoot(info.path || path);
          return rollback(peers, id, deps, oldRoot, warn, create);
        }
        setBackendRoot(info.path || path);
      } catch (err) {
        unseal(id);
        await thawPeers(peers, id);
        await flushHandoff();
        warn(create ? "Could not create vault" : "Could not open vault", err);
        return false;
      }
      const peersClean = await waitFor(peers, id, CONFIRM_ACK, CONFIRM, false);
      // Peers have not reloaded yet, so a dirty check here can still roll the root back.
      if (lost || !peersClean || stillDirty(deps, oldRoot)) return rollback(peers, id, deps, oldRoot, warn, create);
      // Once RELOAD is sent, peers may already be on the new root. Preserve,
      // then reload. A failed acknowledge keeps this page. Do not open the old root again.
      const reloaded = await reloadPreserved(peers, id, deps, oldRoot);
      if (!reloaded) {
        warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending");
        return false;
      }
      return true;
    } catch (err) {
      if (opened && peers) {
        const reloaded = await reloadPreserved(peers, id, deps, oldRoot);
        if (!reloaded) {
          warn(create ? "Could not create vault while a save is still pending" : "Could not open vault while a save is still pending", err);
          return false;
        }
        return true;
      }
      unseal(id);
      if (peers) await thawPeers(peers, id);
      await flushHandoff();
      warn(create ? "Could not create vault" : "Could not open vault", err);
      return false;
    } finally {
      switching = false;
      if (ourId === id) ourId = "";
    }
  }

  function reset() {
    switching = false;
    lost = false;
    ourId = "";
    sealedFor = null;
    cancelled.clear();
  }

  return { install, commit, reset };
}

const prod = createVaultCoordinator({
  seal: sealWrites,
  unseal: unsealWrites,
  sealed: writesSealed,
});

export const installVaultSwitch = prod.install;
export const commitVaultSwitch = prod.commit;

/** Drops coordinator bookkeeping. Tests also call `unsealWrites`. */
export function resetVaultSwitchForTests(): void {
  prod.reset();
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
export async function switchIo(): Promise<SwitchIo | null> {
  if (!isTauri) return { bus: localSaveBus(), others: [], self: "" };
  try {
    const { getAllWindows, getCurrentWindow } = await import("@tauri-apps/api/window");
    const bus = await defaultBus();
    if (!bus) return null;
    const self = getCurrentWindow().label;
    const labels = () => getAllWindows().then((wins) => wins.map((win) => win.label));
    const others = (await labels()).filter((label) => label !== self);
    return { bus, others, self, listWindows: labels };
  } catch {
    return null;
  }
}

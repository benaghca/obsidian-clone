// One debounced writer per canvas or drawing path. Closing the tab drops the
// view, not the unsaved text: the writer stays until the bytes land or the
// file is deleted. A second view of the same path adopts that writer.

import { api } from "./api";
import { fileSave, type FileSave } from "./fileSave";
import { writesSealed } from "./saveSeal";

interface ViewHooks {
  begin: ((text: string) => void) | null;
  onWrote: ((text: string) => void) | null;
  postpone: () => boolean;
  /** Latest text to store before a flush. Null leaves the slot alone. */
  prepare: () => string | null;
}

interface Owner {
  slot: { path: string; text: string };
  disk: FileSave;
  stack: ViewHooks[];
  dropped: boolean;
}

export interface OwnedHooks {
  /** Runs at the start of a write, before the request is sent. */
  begin?: (text: string) => void;
  /** Runs after the write succeeds, still inside that write. */
  onWrote?: (text: string) => void;
  postpone?: () => boolean;
  prepare?: () => string | null;
}

export interface OwnedHandle {
  path(): string;
  text(): string;
  setText(text: string): void;
  touch(): void;
  flush(): Promise<boolean>;
  /** Forget pending edits. An external change uses this; a close does not. */
  drop(): void;
  /** This view is gone. Dirty text stays owned until it saves or is discarded. */
  detach(): void;
  readonly dirty: boolean;
}

export interface OwnedSaves {
  attach(path: string, hooks?: OwnedHooks): OwnedHandle;
  save(which?: (path: string) => boolean): Promise<boolean>;
  hold(under: (path: string) => boolean): void;
  release(under: (path: string) => boolean): void;
  retarget(under: (path: string) => boolean, swap: (path: string) => string): void;
  discard(under: (path: string) => boolean): void;
  pending(which?: (path: string) => boolean): boolean;
}

export function createOwnedSaves(delay: number): OwnedSaves {
  const owners = new Map<string, Owner>();
  const holds: Array<(path: string) => boolean> = [];

  function blocked(path: string): boolean {
    return writesSealed() || holds.some((under) => under(path));
  }

  function make(path: string): Owner {
    const slot = { path, text: "" };
    const owner: Owner = {
      slot,
      disk: null as unknown as FileSave,
      stack: [],
      dropped: false,
    };
    owner.disk = fileSave({
      delay,
      text: () => slot.text,
      postpone: () => blocked(slot.path) || (owner.stack.at(-1)?.postpone() ?? false),
      write: async (text) => {
        owner.stack.at(-1)?.begin?.(text);
        await api.writeNote(slot.path, text);
        owner.stack.at(-1)?.onWrote?.(text);
      },
      onError: (err) => console.error(`Could not save ${slot.path}`, err),
    });
    owners.set(path, owner);
    return owner;
  }

  async function flushOwner(owner: Owner): Promise<boolean> {
    const prepared = owner.stack.at(-1)?.prepare() ?? null;
    if (prepared !== null && prepared !== owner.slot.text) {
      owner.slot.text = prepared;
      if (!owner.disk.dirty) owner.disk.touch();
    }
    return owner.disk.flush();
  }

  return {
    attach(path, hooks = {}) {
      const found = owners.get(path);
      const owner = found && !found.dropped ? found : make(path);
      const mine: ViewHooks = {
        begin: hooks.begin ?? null,
        onWrote: hooks.onWrote ?? null,
        postpone: hooks.postpone ?? (() => false),
        prepare: hooks.prepare ?? (() => null),
      };
      owner.stack.push(mine);
      return {
        path: () => owner.slot.path,
        text: () => owner.slot.text,
        setText: (text) => { owner.slot.text = text; },
        touch: () => owner.disk.touch(),
        flush: () => flushOwner(owner),
        drop: () => owner.disk.drop(),
        detach() {
          if (owner.dropped) return;
          const at = owner.stack.lastIndexOf(mine);
          if (at >= 0) owner.stack.splice(at, 1);
          if (owner.stack.length > 0) return;
          // A failed write stays owned. A clean one leaves once its chain settles.
          void owner.disk.flush().finally(() => {
            if (owner.dropped || owner.stack.length > 0 || owner.disk.dirty) return;
            if (owners.get(owner.slot.path) === owner) owners.delete(owner.slot.path);
          });
        },
        get dirty() { return owner.disk.dirty; },
      };
    },

    async save(which = () => true) {
      const list = [...owners.values()].filter((owner) => !owner.dropped && which(owner.slot.path));
      const results = await Promise.all(list.map((owner) => flushOwner(owner)));
      return results.every(Boolean);
    },

    hold(under) { holds.push(under); },

    release(under) {
      const at = holds.lastIndexOf(under);
      if (at >= 0) holds.splice(at, 1);
    },

    retarget(under, swap) {
      for (const [path, owner] of [...owners]) {
        if (owner.dropped || !under(path)) continue;
        owners.delete(path);
        owner.slot.path = swap(path);
        const prev = owners.get(owner.slot.path);
        if (prev && prev !== owner) {
          prev.dropped = true;
          prev.disk.drop();
          prev.stack.length = 0;
        }
        owners.set(owner.slot.path, owner);
      }
    },

    discard(under) {
      for (const [path, owner] of [...owners]) {
        if (!under(path)) continue;
        owner.dropped = true;
        owner.disk.drop();
        owner.stack.length = 0;
        owners.delete(path);
      }
    },

    pending(which = () => true) {
      return [...owners.values()].some((owner) => !owner.dropped && which(owner.slot.path) && owner.disk.dirty);
    },
  };
}

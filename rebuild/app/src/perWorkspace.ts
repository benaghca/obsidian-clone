// The vault-wide indexes and caches every view shares (the tag reader, the
// properties index, search's facts): one per workspace.

import type { Workspace } from "./workspace";

/** One `create(ws)` per workspace, made the first time it is asked for. */
export function perWorkspace<T>(create: (ws: Workspace) => T): (ws: Workspace) => T {
  const made = new WeakMap<Workspace, T>();
  return (ws) => {
    let value = made.get(ws);
    if (!value) made.set(ws, (value = create(ws)));
    return value;
  };
}

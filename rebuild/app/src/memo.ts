// Values made once and kept: by key in a map (decorations, extensions,
// icons, ...), or one per workspace (the vault-wide indexes and caches every
// view shares: the tag reader, the properties index, search's facts).

import type { Workspace } from "./workspace";

/** `map`'s value for `key`, made (and kept there) the first time it is asked for. */
export function kept<K, V>(map: { get(key: K): V | undefined; set(key: K, value: V): unknown }, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) map.set(key, (value = make()));
  return value;
}

/** One `create(ws)` per workspace, made the first time it is asked for. */
export function perWorkspace<T>(create: (ws: Workspace) => T): (ws: Workspace) => T {
  const made = new WeakMap<Workspace, T>();
  return (ws) => kept(made, ws, () => create(ws));
}

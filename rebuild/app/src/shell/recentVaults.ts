// Recent vaults the switcher lists. Kept in localStorage (this machine only).
// The backend still remembers just the last opened vault; this list is the
// footer's menu, newest first.

import { readStored, store } from "../storage";

export interface VaultRef {
  path: string;
  name: string;
}

const RECENT_KEY = "grove.recent-vaults";
const MAX_RECENT = 8;

/** `info` moves to the front. An empty path is dropped. Capped at `max`. */
export function addRecent(list: readonly VaultRef[], info: VaultRef, max = MAX_RECENT): VaultRef[] {
  const path = info.path.trim();
  const kept = list.filter((item) => item.path.trim() && item.path !== path);
  if (!path || max <= 0) return kept.slice(0, Math.max(0, max));
  const name = info.name.trim() || path.split(/[/\\]/).filter(Boolean).pop() || path;
  return [{ path, name }, ...kept].slice(0, max);
}

/** What was remembered, newest first, skipping anything that is not a vault. */
export function readRecents(): VaultRef[] {
  const raw = readStored(RECENT_KEY, []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: VaultRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const path = typeof (item as VaultRef).path === "string" ? (item as VaultRef).path.trim() : "";
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const given = typeof (item as VaultRef).name === "string" ? (item as VaultRef).name.trim() : "";
    out.push({ path, name: given || path.split(/[/\\]/).filter(Boolean).pop() || path });
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export function rememberVault(info: VaultRef) {
  store(RECENT_KEY, addRecent(readRecents(), info));
}

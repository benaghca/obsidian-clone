// Two identities. `backendRoot` is the vault the backend will execute against.
// `pageVault` is the vault this page's models still belong to. A switch
// updates the backend when open() resolves, and leaves the page on the old
// vault until this document reloads. Writers capture the page and submit
// only when it is still the backend.

let root = "";
let page = "";
let clock = 0;
const gens = new Map<string, number>();
const rootWatchers = new Set<() => void>();

export function setBackendRoot(path: string): void {
  if (root === path) return;
  root = path;
  for (const hear of rootWatchers) hear();
}

/** Fired when the backend root actually changes. In-flight list reads must not install after this. */
export function onBackendRootChange(hear: () => void): () => void {
  rootWatchers.add(hear);
  return () => { rootWatchers.delete(hear); };
}

export function backendRoot(): string {
  return root;
}

/** The vault whose notes, canvases, and settings are on this page. */
export function setPageVault(path: string): void {
  page = path;
}

export function pageVault(): string {
  return page;
}

/** Identity a mutation binds at the start of its async work. */
export function sourceVault(): string {
  return page || root;
}

/**
 * Disk callbacks may refresh a model only while this page still owns the
 * backend. A sealed switch, or a backend that has already moved, must not
 * drop an accepted edit and read the other vault.
 */
export function pageOwnsDisk(): boolean {
  if (writesSealedLazy()) return false;
  if (!page) return true;
  return page === root;
}

/** Late import avoids a cycle with the seal module. */
function writesSealedLazy(): boolean {
  // Assigned by saveSeal's module init via registerSeal. Before that, nothing is sealed.
  return sealedNow();
}

let sealedNow = () => false;

export function registerSeal(read: () => boolean): void {
  sealedNow = read;
}

/**
 * A foreign modify may replace a view only when it is this file, it is not
 * our own echo, and the page still owns the backend.
 */
export function deliverForeignChange(matches: boolean, echoing: boolean, drop: () => void, load: () => void): void {
  if (!matches || echoing || !pageOwnsDisk()) return;
  drop();
  load();
}

/** Next generation for `path`. A later edit compares greater than an earlier one. */
export function bumpPathGen(path: string): number {
  const next = ++clock;
  gens.set(path, next);
  return next;
}

export function pathGen(path: string): number {
  return gens.get(path) ?? 0;
}

export function resetBackendRootForTests(): void {
  root = "";
  page = "";
  clock = 0;
  gens.clear();
}

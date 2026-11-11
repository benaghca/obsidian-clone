// The backend root the page last saw a vault open resolve to. Workspace
// `vault.path` stays on the old folder until reload, so it cannot guard a
// write. Mutations capture this value and submit only while it still matches.

let root = "";
let clock = 0;
const gens = new Map<string, number>();

export function setBackendRoot(path: string): void {
  root = path;
}

export function backendRoot(): string {
  return root;
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
  clock = 0;
  gens.clear();
}

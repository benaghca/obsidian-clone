// A hold blocks every writer of that path. Only the drain that is about to
// rename or delete THAT path may write it. A drain for a different path
// does not authorize this one. Ctrl+S, close, and a queued retry wait.

const holds: Array<(path: string) => boolean> = [];
const drains: Array<(path: string) => boolean> = [];

export function pushPathHold(under: (path: string) => boolean): void {
  holds.push(under);
}

export function popPathHold(under: (path: string) => boolean): void {
  const at = holds.lastIndexOf(under);
  if (at >= 0) holds.splice(at, 1);
}

export function pathHeld(path: string): boolean {
  return holds.some((under) => under(path));
}

export function beginHoldDrain(under: (path: string) => boolean): void {
  drains.push(under);
}

export function endHoldDrain(): void {
  drains.pop();
}

/** True only for a path this drain is flushing before its own mutation. */
export function drainAllows(path: string): boolean {
  return drains.some((under) => under(path));
}

export function resetHoldsForTests(): void {
  holds.splice(0);
  drains.splice(0);
}

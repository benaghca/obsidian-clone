// Only the rename or delete that is draining saves before it mutates the
// path may write through a hold. Ctrl+S, close, and a second barrier wait.

let depth = 0;

export function beginHoldDrain(): void {
  depth += 1;
}

export function endHoldDrain(): void {
  depth -= 1;
}

export function drainingHold(): boolean {
  return depth > 0;
}

// Alignment while dragging on a canvas: the moving box snaps when one of its
// edges or its center comes within a few screen pixels of another card's
// edge or center, and guides show what it lines up with. Pure; the drag
// calls it once per frame. The other cards' lines are sorted once per drag,
// so each frame is a binary search, not a scan of the board.

export interface Box { x: number; y: number; width: number; height: number }
export type Axis = "x" | "y";
/** A guide line in board units, along `axis` at `at` (x: vertical, y: horizontal), with dots. */
export interface Guide { axis: Axis; at: number; from: number; to: number; dots: number[] }
interface Line { at: number; box: Box; k: number }
export interface AlignTargets { x: Line[]; y: Line[] }

const size = (axis: Axis) => (axis === "x" ? "width" : "height");
const across = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const STOPS = [0, 0.5, 1];

/** The other boxes' edges and centers per axis, sorted. Boxes without a finite size are skipped. */
export function alignTargets(boxes: readonly Box[]): AlignTargets {
  const lines = (axis: Axis) => boxes
    .filter((b) => [b.x, b.y, b.width, b.height].every(Number.isFinite))
    .flatMap((box) => STOPS.map((k) => ({ at: box[axis] + box[size(axis)] * k, box, k })))
    .sort((a, b) => a.at - b.at);
  return { x: lines("x"), y: lines("y") };
}

/** The first index whose line is at or after `v`. */
function lowerBound(lines: Line[], v: number) {
  let lo = 0, hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].at < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** The nearest line to `v`, if it is closer than `within`. */
function nearest(lines: Line[], v: number, within: number): number | undefined {
  const i = lowerBound(lines, v);
  let best: number | undefined, gap = within;
  for (const j of [i - 1, i]) {
    const line = lines[j];
    if (line && Math.abs(line.at - v) < gap) { gap = Math.abs(line.at - v); best = line.at - v; }
  }
  return best;
}

/**
 * How far to move along `axis` so that one of `stops` of `box` (0 = start
 * edge, .5 = center, 1 = end edge) meets the nearest target within `within`
 * board units. 0 when nothing is close enough.
 */
export function snapOffset(box: Box, axis: Axis, targets: AlignTargets, within: number, stops = STOPS): number {
  let best = 0, gap = within;
  for (const k of stops) {
    const offset = nearest(targets[axis], box[axis] + box[size(axis)] * k, gap);
    if (offset !== undefined && Math.abs(offset) < gap) { gap = Math.abs(offset); best = offset; }
  }
  return best;
}

/** Where a box touches a guide line: its center, or both corners of the aligned edge. */
const touches = (box: Box, axis: Axis, k: number) => {
  const other = across(axis);
  return k === 0.5 ? [box[other] + box[size(other)] / 2] : [box[other], box[other] + box[size(other)]];
};

/** The guides for `box` (already snapped) along `axis`: one per other box it lines up with. */
export function guidesFor(box: Box, axis: Axis, targets: AlignTargets, stops = STOPS): Guide[] {
  const out = new Map<string, Guide>();
  const lines = targets[axis];
  for (const k of stops) {
    const v = box[axis] + box[size(axis)] * k;
    for (let i = lowerBound(lines, v - 0.01); i < lines.length && lines[i].at <= v + 0.01; i++) {
      const dots = [...touches(box, axis, k), ...touches(lines[i].box, axis, lines[i].k)];
      const at = lines[i].at, key = `${at}:${dots.join(",")}`;
      if (!out.has(key)) out.set(key, { axis, at, from: Math.min(...dots), to: Math.max(...dots), dots });
    }
  }
  return [...out.values()];
}

// The smallest set of edits that turns one text into another, for applying an
// outside change to an open note. Replacing the whole document would move the
// cursor to the top and lose the scroll anchor. Edits limited to what really
// changed let CodeMirror map the selection, the scroll position and the undo
// history across them.
//
// Lines are compared first (Myers' O(ND) diff, the same approach as Cinder's
// ui/diff.js). A small changed block is then compared word by word, and each
// edit is trimmed to the characters that differ, so a caret on a line the
// sync also edited stays where it was.

export interface TextEdit {
  /** Range in the old text. */
  from: number;
  to: number;
  insert: string;
}

/**
 * Above this many line edits, the diff stops and the changed middle is
 * replaced as one block. That keeps a rewrite of a big note fast; it is then
 * only as minimal as a common prefix and suffix.
 */
export const MAX_LINE_EDITS = 1000;
/** A changed block up to this many characters (each side) is compared word by word. */
const REFINE_CHARS = 4000;
/** Word edits past this inside one block: keep the block as one edit. */
const MAX_WORD_EDITS = 200;

/** Line breaks as CodeMirror stores them, so offsets match the editor's document. */
export function normalizeLineBreaks(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** Start offset of every line (each line keeps its "\n"), plus the text's length at the end. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  if (starts[starts.length - 1] !== text.length) starts.push(text.length);
  return starts;
}

/** Start offset of every word, run of spaces, or other single character, plus the length. */
function wordStarts(text: string): number[] {
  const starts: number[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}_]+|\s+|[^]/gu)) starts.push(m.index);
  starts.push(text.length);
  return starts;
}

/** Each piece as a small integer, equal pieces equal, so the diff compares numbers. */
function intern(text: string, starts: number[], ids: Map<string, number>): Int32Array {
  const out = new Int32Array(starts.length - 1);
  for (let i = 0; i < out.length; i++) {
    const line = text.slice(starts[i], starts[i + 1]);
    let id = ids.get(line);
    if (id === undefined) ids.set(line, (id = ids.size));
    out[i] = id;
  }
  return out;
}

/** A changed block of pieces: old pieces [a0, a1) become new pieces [b0, b1). */
type Hunk = [a0: number, a1: number, b0: number, b1: number];

/** Myers' diff of two piece sequences (equal ends already trimmed). Null past `limit` edits. */
function hunksOf(a: Int32Array, b: Int32Array, limit: number): Hunk[] | null {
  const n = a.length, m = b.length;
  if (!n && !m) return [];
  if (!n || !m) return [[0, n, 0, m]];
  const max = Math.min(n + m, limit);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v for diagonals -d-1..d+1 as it was before step d.
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  if (!found) return null;
  // Walk back from the end, collecting edit runs (in reverse).
  const hunks: Hunk[] = [];
  let x = n, y = m;
  let open: Hunk | null = null;
  const close = () => { if (open) { hunks.push(open); open = null; } };
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d], k = x - y;
    const at = (kk: number) => t[kk + d + 1];
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(prevK), py = px - prevK;
    if (x > px && y > py) {
      close();
      const run = Math.min(x - px, y - py);
      x -= run; y -= run;
    }
    if (d > 0) {
      if (!open) open = [x, x, y, y];
      if (x === px) { y--; open[2] = y; } else { x--; open[0] = x; }
    }
    x = px; y = py;
  }
  close();
  return hunks.reverse();
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Trim the characters an edit's old and new text share at either end. */
function trimmed(old: string, from: number, to: number, insert: string): TextEdit | null {
  let start = 0;
  const most = Math.min(to - from, insert.length);
  while (start < most && old.charCodeAt(from + start) === insert.charCodeAt(start)) start++;
  let end = 0;
  while (end < most - start && old.charCodeAt(to - 1 - end) === insert.charCodeAt(insert.length - 1 - end)) end++;
  // Never cut an emoji or other surrogate pair in half.
  if (start && isHigh(old.charCodeAt(from + start - 1))) start--;
  if (end && isLow(old.charCodeAt(to - end))) end--;
  if (to - from === start + end && insert.length === start + end) return null;
  return { from: from + start, to: to - end, insert: insert.slice(start, insert.length - end) };
}

/**
 * Edits between `old` and `next`, both cut into pieces at the given starts.
 * Offsets are in `old`, shifted by `base`. Past `limit` piece edits, the
 * changed middle is one edit; `exact` false then returns null instead.
 */
function editsBetween(old: string, oldStarts: number[], next: string, nextStarts: number[], limit: number, base: number, exact: boolean): TextEdit[] | null {
  const oldCount = oldStarts.length - 1, nextCount = nextStarts.length - 1;
  const piece = (text: string, starts: number[], i: number) => text.slice(starts[i], starts[i + 1]);
  // Equal pieces at the start and end need no diff; most syncs change one spot.
  let pre = 0;
  while (pre < oldCount && pre < nextCount && piece(old, oldStarts, pre) === piece(next, nextStarts, pre)) pre++;
  let suf = 0;
  while (suf < oldCount - pre && suf < nextCount - pre && piece(old, oldStarts, oldCount - 1 - suf) === piece(next, nextStarts, nextCount - 1 - suf)) suf++;
  const ids = new Map<string, number>();
  const a = intern(old, oldStarts.slice(pre, oldStarts.length - suf), ids);
  const b = intern(next, nextStarts.slice(pre, nextStarts.length - suf), ids);
  let hunks = hunksOf(a, b, limit);
  if (!hunks) {
    if (!exact) return null;
    hunks = [[0, a.length, 0, b.length]];
  }
  const edits: TextEdit[] = [];
  for (const [a0, a1, b0, b1] of hunks) {
    const from = oldStarts[pre + a0], to = oldStarts[pre + a1];
    const edit = trimmed(old, from, to, next.slice(nextStarts[pre + b0], nextStarts[pre + b1]));
    if (edit) edits.push({ from: edit.from + base, to: edit.to + base, insert: edit.insert });
  }
  return edits;
}

/** A replaced block compared word by word, so text inside it that did not change keeps its place. */
function refined(old: string, edit: TextEdit): TextEdit[] {
  const gone = old.slice(edit.from, edit.to);
  if (!gone.length || !edit.insert.length || gone.length > REFINE_CHARS || edit.insert.length > REFINE_CHARS) return [edit];
  return editsBetween(gone, wordStarts(gone), edit.insert, wordStarts(edit.insert), MAX_WORD_EDITS, edit.from, false) ?? [edit];
}

/**
 * Edits (in old-text offsets, sorted, not overlapping) that turn `old` into
 * `next`. Both texts must use "\n" line breaks. Empty when they are equal.
 */
export function minimalChanges(old: string, next: string, limit = MAX_LINE_EDITS): TextEdit[] {
  if (old === next) return [];
  const edits = editsBetween(old, lineStarts(old), next, lineStarts(next), limit, 0, true)!;
  return edits.flatMap((edit) => refined(old, edit));
}

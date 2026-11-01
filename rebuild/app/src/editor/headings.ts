// Find a heading by its visible text, for links that carry #heading, or a
// block by its id, for links that carry #^id.

import type { Text } from "@codemirror/state";

/** Heading source without ATX markers or a trailing block ID. */
export const headingLabel = (text: string) => text.replace(/^#{1,6}[ \t]*/, "").replace(/[ \t]+\^[a-zA-Z0-9-]+[ \t]*$/, "").replace(/[ \t]+#+[ \t]*$/, "").trim();
/** Obsidian drops pipes and collapses spaces in heading link targets. */
export const headingTarget = (text: string) => text.replace(/\|/g, "").replace(/\s+/g, " ").trim();

/**
 * Start of the first heading line whose text matches (case-insensitively);
 * "A#B" means B. For "^id", the block carrying an inline or standalone ID.
 * Ids inside a code fence are not ids. A standalone id on line 1 resolves
 * there; blank lines above an id are skipped, and with no block above it
 * the id does not resolve.
 */
export function headingPos(doc: Text, heading: string): number | null {
  const want = headingTarget(heading.split("#").pop()!).toLowerCase();
  if (!want || want === "^") return null;
  if (want.startsWith("^")) return blockPos(doc, want);
  let pos = 0;
  for (const text of doc.iterLines()) {
    if (text.startsWith("#")) {
      const m = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
      if (m && headingTarget(headingLabel(text)).toLowerCase() === want) return pos;
    }
    pos += text.length + 1;
  }
  return null;
}

/**
 * Whether each line is a code-fence line or inside one. Same rule as
 * `Fences` in linksTags.ts (CommonMark: at most three spaces, a matching
 * marker at least as long, nothing after a closer).
 */
export function codeFenceMask(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length);
  let open: { marker: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].replace(/\r$/, ""));
    if (open) {
      mask[i] = true;
      if (m && m[1][0] === open.marker && m[1].length >= open.len && !m[2].trim()) open = null;
    } else if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      open = { marker: m[1][0], len: m[1].length };
      mask[i] = true;
    } else mask[i] = false;
  }
  return mask;
}

/** Offset of the block named by a lowercased "^id". */
function blockPos(doc: Text, want: string): number | null {
  const mark = ` ${want}`;
  const lines: string[] = [];
  const from: number[] = [];
  let pos = 0;
  for (const text of doc.iterLines()) {
    lines.push(text);
    from.push(pos);
    pos += text.length + 1;
  }
  const fenced = codeFenceMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const text = lines[i];
    if (text.trimEnd().toLowerCase().endsWith(mark)) return from[i];
    if (text.trim().toLowerCase() !== want) continue;
    let top = i - 1;
    while (top >= 0 && !lines[top].trim()) top--;
    if (top < 0) return i === 0 ? from[i] : null;
    if (fenced[top]) {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[top].replace(/\r$/, ""));
      if (fence) {
        top--;
        while (top > 0 && !lines[top].replace(/\r$/, "").trimStart().startsWith(fence[1])) top--;
        top = Math.max(0, top);
      }
    } else while (top > 0 && lines[top - 1].trim() && !fenced[top - 1]) top--;
    return from[top];
  }
  return null;
}

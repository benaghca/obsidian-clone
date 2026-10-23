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
 */
export function headingPos(doc: Text, heading: string): number | null {
  const want = headingTarget(heading.split("#").pop()!).toLowerCase();
  if (!want || want === "^") return null;
  const block = want.startsWith("^") ? ` ${want}` : null;
  let pos = 0;
  for (const text of doc.iterLines()) {
    if (block) {
      if (text.trimEnd().toLowerCase().endsWith(block)) return pos;
      if (text.trim().toLowerCase() === want) {
        let line = Math.max(1, doc.lineAt(pos).number - 1);
        while (line > 1 && !doc.line(line).text.trim()) line--;
        const fence = /^\s*(`{3,}|~{3,})/.exec(doc.line(line).text);
        if (fence) { line--; while (line > 1 && !doc.line(line).text.trimStart().startsWith(fence[1])) line--; }
        else while (line > 1 && doc.line(line - 1).text.trim()) line--;
        return doc.line(Math.max(1, line)).from;
      }
    } else if (text.startsWith("#")) {
      const m = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
      if (m && headingTarget(headingLabel(text)).toLowerCase() === want) return pos;
    }
    pos += text.length + 1;
  }
  return null;
}

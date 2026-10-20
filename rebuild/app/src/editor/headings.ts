// Find a heading by its visible text, for links that carry #heading.

import type { Text } from "@codemirror/state";

/** Start of the first heading line whose text matches (case-insensitively); "A#B" means B. */
export function headingPos(doc: Text, heading: string): number | null {
  const want = heading.split("#").pop()!.trim().toLowerCase();
  if (!want || want.startsWith("^")) return null;
  let pos = 0;
  for (const text of doc.iterLines()) {
    if (text.startsWith("#")) {
      const m = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
      if (m && m[1].toLowerCase() === want) return pos;
    }
    pos += text.length + 1;
  }
  return null;
}

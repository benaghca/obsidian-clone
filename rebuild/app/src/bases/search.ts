// The toolbar Search box (BASES_PLAN §3.6): plain text matching over what
// each row shows, not the search engine. Every word of the query must appear,
// in any shown value, ignoring case. Nothing is written.
import { displayValue, isFormulaError, type Context, type Value } from "./functions";

/** The query's words, lower-cased. No words: every row matches. */
export const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * A row's searchable text: the title (cards), then each shown value, one per
 * line so a word never spans two values. Checkboxes, empty values and
 * formula errors have no text.
 */
export function rowText(context: Context, keys: readonly string[], title?: string): string {
  let text = title?.toLowerCase() ?? "";
  for (const key of keys) {
    try {
      const value: Value = context.get(key);
      if (value === null || typeof value === "boolean" || isFormulaError(value)) continue;
      text += "\n" + displayValue(value).toLowerCase();
    } catch { /* an error cell shows no text */ }
  }
  return text;
}

export const matchesTerms = (text: string, terms: readonly string[]) => terms.every(term => text.includes(term));

/** The rows whose text has every word, in their order. Yields every 256 rows (runSliced). */
export function* searchWork<T>(rows: readonly T[], query: string, textOf: (row: T) => string): Generator<void, readonly T[]> {
  const terms = searchTerms(query);
  if (!terms.length) return rows;
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (matchesTerms(textOf(rows[i]), terms)) out.push(rows[i]);
    if ((i & 255) === 255) yield;
  }
  return out;
}

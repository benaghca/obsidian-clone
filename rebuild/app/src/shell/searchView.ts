// The search view in the left sidebar, with Obsidian's search syntax
// (searchQuery.ts). The query is parsed once per change; the backend is
// asked only about its terms (searchFacts.ts keeps their lines until the
// vault changes) and each note is then matched in memory. Results are the
// matching notes by name, as Obsidian sorts them by default, each with the
// lines that matched (the first five), the words looked for highlighted.

import { compareNames, noteName } from "../paths";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import type { Span } from "./mentions";
import { propertyIndex } from "./propertyIndex";
import { searchFacts } from "./searchFacts";
import { highlightsOf, type Line, matches, needs, parseQuery, shownLines } from "./searchQuery";
import { highlighted, pagedRows } from "./sideView";

const LINES = 5;
const PAGE = 50;

export function createSearchView(ws: Workspace): { el: HTMLElement; search(query: string): void } {
  const input = h("input", { class: "search-input", type: "search", placeholder: "Search...", "aria-label": "Search" });
  const info = h("div", { class: "search-results-info" });
  const results = h("div", { class: "search-results" });
  let seq = 0;

  input.addEventListener("input", async () => {
    const mine = ++seq;
    const q = parseQuery(input.value);
    if (!q) {
      info.hidden = true;
      results.replaceChildren();
      return;
    }
    const [facts, props] = await Promise.all([
      searchFacts(ws).facts([q]) ?? { lines: () => undefined },
      needs(q).props ? propertyIndex(ws).notes() : null,
    ]);
    if (mine !== seq) return;
    // Excluded files (Settings → Files and links) are hidden from search.
    const found = ws.vault.notes.filter((n) => !ws.vault.isExcluded(n.path) && matches(n.path, q, facts)).sort((a, b) => compareNames(a.name, b.name));
    const words = highlightsOf(q);
    const propLine = (path: string) => (key: string): Line | null => {
      const note = props?.get(path);
      const p = note?.props.find((x) => x.key.toLowerCase() === key);
      return p && note ? { line: p.line + 2, text: note.lines[p.line] } : null;
    };
    const row = ({ path }: { path: string }) => {
      const lines = shownLines(path, q, facts, propLine(path));
      return h(
        "div",
        { class: "search-result" },
        h(
          "div",
          { class: "search-result-file-title", onclick: (e: MouseEvent) => void ws.open(path, { where: whereFromEvent(e) }) },
          noteName(path),
          lines.length ? h("span", { class: "search-result-count" }, String(lines.length)) : null,
        ),
        ...lines.slice(0, LINES).map((hit) =>
          h(
            "div",
            { class: "search-result-file-match", onclick: () => void ws.open(path, { line: hit.line }) },
            ...highlighted(hit.text, spansOf(hit.text, words)),
          ),
        ),
      );
    };
    info.hidden = false;
    info.textContent = `${found.length.toLocaleString()} result${found.length === 1 ? "" : "s"}`;
    results.replaceChildren();
    if (found.length) pagedRows(results, found, row, PAGE);
    else results.append(h("div", { class: "pane-empty" }, "No matches found."));
  });

  return {
    el: h("div", { class: "search-view" }, h("div", { class: "search-input-container" }, input), info, results),
    search(query) {
      input.value = query;
      input.dispatchEvent(new Event("input"));
    },
  };
}

/** Where the words are in a line (every occurrence, any case), in order (snippetParts takes overlaps). */
function spansOf(text: string, words: string[]): Span[] {
  const lower = text.toLowerCase();
  const spans: Span[] = [];
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) spans.push({ from: i, to: i + w.length });
  return spans.sort((a, b) => a.from - b.from);
}

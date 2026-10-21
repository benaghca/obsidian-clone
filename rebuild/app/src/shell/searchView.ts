// The search view in the left sidebar, with Obsidian's search syntax
// (searchQuery.ts). The query is parsed once per change; the backend is
// asked only about its terms (searchFacts.ts keeps their lines until the
// vault changes) and each note is then matched in memory. Results are the
// matching notes by name, as Obsidian sorts them by default, each with the
// lines that matched (the first five), the words looked for highlighted.

import { noteName } from "../paths";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { searchFacts, type VaultFacts } from "./searchFacts";
import { highlightsOf, matchingNotes, parseQuery, propertyLine, shownLines, spansOf } from "./searchQuery";
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
    const facts: VaultFacts = (await searchFacts(ws).facts([q])) ?? { lines: () => undefined };
    if (mine !== seq) return;
    const found = matchingNotes(ws.vault.notes, q, facts, ws.vault.isExcluded);
    const words = highlightsOf(q);
    const row = ({ path }: { path: string }) => {
      const lines = shownLines(path, q, facts, (key) => propertyLine(facts.notes?.get(path), key));
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

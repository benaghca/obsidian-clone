// The search view in the left sidebar, with Obsidian's search syntax
// (searchQuery.ts). The query is parsed once per change; the backend is
// asked only about its terms (searchFacts.ts keeps their lines until the
// vault changes) and each note is then matched in memory. Laid out as
// Obsidian 1.14.4's (observed): a Match case toggle in the field; "N
// results" (the matches, not the notes) beside the sort order (Obsidian's
// six, remembered); each matching note with its count of matches, folding
// away its lines (the first five), the words looked for highlighted. A
// note's count is worked out when its row is drawn, and the total just
// after the results are painted, so counting never holds up a key.

import { compareFiles, noteName, SORT_ORDERS, type SortOrder } from "../paths";
import { kept } from "../memo";
import { dropdown } from "../settings/controls";
import { readStored, store } from "../storage";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { searchFacts, type VaultFacts } from "./searchFacts";
import { highlightsOf, matchCount, matchingNotes, parseQuery, propertyLine, shownLines, spansOf } from "./searchQuery";
import { afterPaint, foldIn, foldToggle, highlighted, pagedRows } from "./sideView";

const LINES = 5;
const PAGE = 50;
/** A sidebar's height of results, drawn with the key (the rest of the page just after). */
const AT_ONCE = 12;
const OPTIONS_KEY = "grove.search";

export function createSearchView(ws: Workspace): { el: HTMLElement; search(query: string): void } {
  const saved = readStored(OPTIONS_KEY, {}) as { sort?: SortOrder; matchCase?: boolean };
  let sort: SortOrder = SORT_ORDERS.some(([o]) => o === saved.sort) ? saved.sort! : "alphabetical";
  let matchCase = saved.matchCase === true;
  const remember = () => store(OPTIONS_KEY, { sort, matchCase });

  const input = h("input", { class: "search-input", type: "search", placeholder: "Search...", "aria-label": "Search" });
  const clear = h("div", { class: "search-input-clear-button", "aria-label": "Clear search", onclick: () => (search(""), input.focus()) }, icon("circle-x", 16));
  const caseToggle = h(
    "div",
    {
      class: `input-right-decorator clickable-icon${matchCase ? " is-active" : ""}`,
      "aria-label": "Match case",
      onclick: () => {
        matchCase = !matchCase;
        caseToggle.classList.toggle("is-active", matchCase);
        remember();
        void run();
      },
    },
    icon("case-sensitive", 16),
  );
  const count = h("div", { class: "search-results-result-count" });
  const order = dropdown(SORT_ORDERS, sort, (o) => {
    sort = o;
    remember();
    void run();
  }, "Sort order");
  const info = h("div", { class: "search-results-info" }, count, order);
  const results = h("div", { class: "search-results" });
  const collapsed = new Set<string>();
  let seq = 0;

  async function run() {
    const mine = ++seq;
    const q = parseQuery(input.value, matchCase);
    clear.hidden = !input.value;
    if (!q) {
      info.hidden = true;
      results.replaceChildren();
      return;
    }
    const facts: VaultFacts = (await searchFacts(ws).facts([q], false, matchCase)) ?? { lines: () => undefined, matchCase };
    if (mine !== seq) return;
    let found = matchingNotes(ws.vault.notes, q, facts, ws.vault.isExcluded);
    if (sort !== "alphabetical") {
      const entries = new Map(ws.vault.files.map((f) => [f.path, f]));
      const inOrder = compareFiles(sort);
      found = found.map((n) => entries.get(n.path)!).filter(Boolean).sort(inOrder);
    }
    const words = highlightsOf(q);
    const lines = (path: string) => shownLines(path, q, facts, (key) => propertyLine(facts.notes?.get(path), key));
    const counts = new Map<string, number>();
    const countOf = (path: string, shown?: ReturnType<typeof lines>) => kept(counts, path, () => matchCount(shown ?? lines(path), words, matchCase));
    const row = ({ path }: { path: string }) => {
      const shown = lines(path);
      const n = countOf(path, shown);
      const matches = h(
        "div",
        { class: "search-result-file-matches" },
        ...shown.slice(0, LINES).map((hit) =>
          h(
            "div",
            { class: "search-result-file-match", onclick: () => void ws.open(path, { line: hit.line }) },
            ...highlighted(hit.text, spansOf(hit.text, words, matchCase)),
          ),
        ),
      );
      const chevron = foldToggle(matches, collapsed.has(path), foldIn(collapsed, path));
      return h(
        "div",
        { class: "search-result" },
        h(
          "div",
          { class: "search-result-file-title", onclick: (e: MouseEvent) => void ws.open(path, { where: whereFromEvent(e) }) },
          chevron,
          h("div", { class: "search-result-file-name" }, noteName(path)),
          n ? h("span", { class: "search-result-count" }, n.toLocaleString()) : null,
        ),
        shown.length ? matches : null,
      );
    };
    info.hidden = false;
    results.replaceChildren();
    if (!found.length) {
      count.textContent = "0 results";
      results.append(h("div", { class: "pane-empty" }, "No matches found."));
      return;
    }
    pagedRows(results, found, row, PAGE, AT_ONCE);
    afterPaint(() => {
      if (mine !== seq) return;
      const total = found.reduce((sum, n) => sum + countOf(n.path), 0);
      count.textContent = `${total.toLocaleString()} result${total === 1 ? "" : "s"}`;
    });
  }

  function search(query: string) {
    input.value = query;
    void run();
  }
  input.addEventListener("input", () => void run());

  return {
    el: h(
      "div",
      { class: "search-view" },
      h("div", { class: "search-input-container global-search-input-container" }, icon("search", 16), input, caseToggle, clear),
      info,
      results,
    ),
    search,
  };
}

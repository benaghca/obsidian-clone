// The search view in the left sidebar, with Obsidian's search syntax
// (searchQuery.ts). The query is parsed once per change; the backend is
// asked only about its terms (searchFacts.ts keeps their lines until the
// vault changes) and each note is then matched in memory. Laid out as
// Obsidian 1.14.4's (observed): a Match case toggle and a filled clear
// button in the field; Search settings opens labeled toggles; "N results"
// stays beside a round "..." menu and the sort order. Each matching note
// folds away its lines (the first five). ArrowDown lands on the file row
// first. A note's count is worked out when its row is drawn, and the total
// just after the results are painted, so counting never holds up a key.

import { writeClipboard } from "../editor/clipboard";
import { compareFiles, noteName, SORT_ORDERS, type SortOrder } from "../paths";
import { kept } from "../memo";
import { dropdown, toggle } from "../settings/controls";
import { readStored, store } from "../storage";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon, moreOptionsGlyph } from "./icons";
import { showMenu } from "./menu";
import { searchFacts, type VaultFacts } from "./searchFacts";
import { explainQuery, highlightsOf, matchCount, matchingNotes, parseQuery, propertyLine, shownLines, spansOf } from "./searchQuery";
import { afterPaint, bindResultKeys, hitColumns, highlighted, linesAround, noteText, pagedRows, resultGroup } from "./sideView";

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
  const clear = h("div", { class: "search-input-clear-button", "aria-label": "Clear search", onclick: () => (search(""), input.focus()) }, icon("x", 14));
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
  const countLabel = h("span", { class: "search-results-count-label" });
  const count = h(
    "div",
    {
      class: "search-results-result-count",
      role: "button",
      "aria-label": "More options",
      onclick: () => {
        const text = copied.map((n) => `${n.name}\n${n.lines.map((line) => `\t${line}`).join("\n")}`).join("\n\n");
        showMenu([{ title: "Copy search results", icon: "copy", disabled: !copied.length, action: () => writeClipboard(text) }], count);
      },
    },
    countLabel,
    moreOptionsGlyph(),
  );
  const results = h("div", { class: "search-results" });
  const explainEl = h("div", { class: "search-explain" });
  explainEl.hidden = true;
  let settingsOpen = false;
  let moreContext = false;
  let explain = false;
  let collapse = false;
  const texts = new Map<string, string>();
  const openedRows = new Set<string>();
  const closedRows = new Set<string>();
  const rowKey = (path: string, line: number) => `${path}:${line}`;
  const wantsContext = (path: string, line: number) => (moreContext ? !closedRows.has(rowKey(path, line)) : openedRows.has(rowKey(path, line)));
  let copied: { name: string; lines: string[] }[] = [];
  const settingRow = (name: string, onChange: (on: boolean) => void) =>
    h("div", { class: "search-settings-row" }, h("div", { class: "search-settings-name" }, name), toggle(false, onChange, name));
  const panel = h(
    "div",
    { class: "search-settings" },
    settingRow("Collapse results", (on) => {
      collapse = on;
      if (!on) collapsed.clear();
      void run();
    }),
    settingRow("Show more context", (on) => {
      moreContext = on;
      closedRows.clear();
      void run();
    }),
    settingRow("Explain search terms", (on) => {
      explain = on;
      explainEl.hidden = !on;
      void run();
    }),
  );
  panel.hidden = true;
  const settingsBtn = iconButton(icon("sliders-horizontal", 16), "Search settings", () => {
    settingsOpen = !settingsOpen;
    settingsBtn.classList.toggle("is-active", settingsOpen);
    panel.hidden = !settingsOpen;
  });
  const order = dropdown(SORT_ORDERS, sort, (o) => {
    sort = o;
    remember();
    void run();
  }, "Sort order");
  const info = h("div", { class: "search-results-info" }, count, order);
  const collapsed = new Set<string>();
  let seq = 0;

  function toggleContext(path: string, line: number) {
    const key = rowKey(path, line);
    if (wantsContext(path, line)) {
      openedRows.delete(key);
      if (moreContext) closedRows.add(key);
      else closedRows.delete(key);
    } else {
      closedRows.delete(key);
      openedRows.add(key);
    }
    void run();
  }

  async function run() {
    const mine = ++seq;
    const q = parseQuery(input.value, matchCase);
    clear.hidden = !input.value;
    if (explain) explainEl.textContent = q ? explainQuery(q) : "Enter a search to explain it.";
    if (!q) {
      countLabel.textContent = "";
      copied = [];
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
    if (collapse) for (const n of found) collapsed.add(n.path);
    const needText = moreContext || openedRows.size > 0;
    if (needText) {
      texts.clear();
      await Promise.all(found.map(async (n) => texts.set(n.path, await noteText(ws, n.path))));
      if (mine !== seq) return;
    }
    const words = highlightsOf(q);
    const lines = (path: string) => shownLines(path, q, facts, (key) => propertyLine(facts.notes?.get(path), key));
    const counts = new Map<string, number>();
    const countOf = (path: string, shown?: ReturnType<typeof lines>) => kept(counts, path, () => matchCount(shown ?? lines(path), words, matchCase));
    const matchRow = (path: string, hit: { line: number; text: string }) => {
      const spans = spansOf(hit.text, words, matchCase);
      const around = wantsContext(path, hit.line) ? linesAround(texts.get(path) ?? "", hit.line) : { before: "", after: "" };
      const open = wantsContext(path, hit.line) && !!(around.before || around.after);
      const chevron = h(
        "div",
        {
          class: "clickable-icon backlink-context-toggle",
          "aria-label": open ? "Hide context" : "Show more context",
          onclick: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            toggleContext(path, hit.line);
          },
        },
        icon("chevrons-up-down", 14),
      );
      return h(
        "div",
        {
          class: "search-result-file-match",
          "data-preview-path": path,
          onclick: (event: MouseEvent) => void ws.open(path, { line: hit.line, ch: hitColumns(event, spans) }),
        },
        around.before ? h("div", { class: "search-result-context" }, around.before) : null,
        h("div", { class: "search-result-file-match-text" }, ...highlighted(hit.text, spans)),
        around.after ? h("div", { class: "search-result-context" }, around.after) : null,
        chevron,
      );
    };
    const row = ({ path }: { path: string }) => {
      const shown = lines(path);
      const n = countOf(path, shown);
      const matches = h("div", { class: "search-result-file-matches" }, ...shown.slice(0, LINES).map((hit) => matchRow(path, hit)));
      const result = resultGroup(path, matches, n ? n.toLocaleString() : null, collapsed, (event) => void ws.open(path, { where: whereFromEvent(event) }));
      if (!shown.length) matches.remove();
      return result;
    };
    copied = found.map((n) => ({ name: noteName(n.path), lines: lines(n.path).slice(0, LINES).map((hit) => hit.text) }));
    results.replaceChildren();
    if (!found.length) {
      countLabel.textContent = "0 results";
      results.append(h("div", { class: "pane-empty" }, "No matches found."));
      return;
    }
    pagedRows(results, found, row, PAGE, AT_ONCE);
    afterPaint(() => {
      if (mine !== seq) return;
      const total = found.reduce((sum, n) => sum + countOf(n.path), 0);
      countLabel.textContent = `${total.toLocaleString()} result${total === 1 ? "" : "s"}`;
    });
  }

  function search(query: string) {
    input.value = query;
    void run();
  }
  input.addEventListener("input", () => void run());

  const el = h(
    "div",
    { class: "search-view" },
    h("div", { class: "search-input-container global-search-input-container" }, h("div", { class: "search-input-field" }, icon("search", 16), input, caseToggle, clear), settingsBtn),
    panel,
    explainEl,
    info,
    results,
  );
  bindResultKeys(el);
  return { el, search };
}

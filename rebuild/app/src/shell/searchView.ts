// The search view: Rust matches saved notes and counts every occurrence;
// the page sorts/excludes them, reads shown lines for drawn rows, and highlights.

import { api, type SearchNote, type SearchLine } from "../api";
import { writeClipboard } from "../editor/clipboard";
import { noteName, SORT_ORDERS, type SortOrder } from "../paths";
import { dropdown, toggle } from "../settings/controls";
import { readStored, store } from "../storage";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon, moreOptionsGlyph } from "./icons";
import { showMenu, type MenuEntry } from "./menu";
import { searchReader, searchResults, type SearchRequest } from "./searchRead";
import { explainQuery, highlightsOf, parseQuery, spansOf } from "./searchQuery";
import { bindResultKeys, hitColumns, highlighted, linesAround, noteText, pagedRows, resultGroup } from "./sideView";

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
        const snapshot = copied;
        let text = "";
        const item: MenuEntry = { title: "Copy search results", icon: "copy", disabled: true, action: () => writeClipboard(text) };
        const refresh = showMenu([item], count);
        if (snapshot?.notes.length) {
          void api.searchLines(snapshot.query, snapshot.matchCase, snapshot.notes.map(n => n.path), LINES).then(lines => {
            if (snapshot.seq !== seq) return;
            text = snapshot.notes.map(n => `${noteName(n.path)}\n${(lines[n.path] ?? []).map(line => `\t${line.text}`).join("\n")}`).join("\n\n");
            item.disabled = false;
            refresh?.();
          }).catch(err => console.error("Could not read search results for copying", err));
        }
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
  let copied: (SearchRequest & { notes: SearchNote[] }) | null = null;
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

  const reader = searchReader(ws, render, (request, error) => {
    if (request.seq !== seq) return;
    console.error("Could not search notes", error);
    countLabel.textContent = "0 results";
    results.replaceChildren(h("div", { class: "pane-empty" }, "Could not read search results."));
  });

  function run() {
    const mine = ++seq;
    const query = input.value;
    const q = parseQuery(query, matchCase);
    clear.hidden = !query;
    copied = null;
    if (explain) explainEl.textContent = q ? explainQuery(q) : "Enter a search to explain it.";
    if (!q) {
      reader.cancel();
      countLabel.textContent = "";
      results.replaceChildren();
      return;
    }
    reader.read({ query, matchCase, seq: mine });
  }

  function render(request: SearchRequest, notes: SearchNote[]) {
    const { seq: mine, query, matchCase: caseSensitive } = request;
    if (mine !== seq) return;
    const q = parseQuery(query, caseSensitive)!;
    const found = searchResults(ws.vault.files, notes, path => ws.vault.isExcluded(path), sort);
    if (collapse) for (const n of found) collapsed.add(n.path);
    texts.clear();
    const words = highlightsOf(q);
    const lines = new Map<string, SearchLine[]>();
    const matchRow = (path: string, hit: { line: number; text: string }) => {
      const spans = spansOf(hit.text, words, caseSensitive);
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
    const row = ({ path, count: n }: SearchNote) => {
      const shown = lines.get(path) ?? [];
      const matches = h("div", { class: "search-result-file-matches" }, ...shown.slice(0, LINES).map((hit) => matchRow(path, hit)));
      const result = resultGroup(path, matches, n ? n.toLocaleString() : null, collapsed, (event) => void ws.open(path, { where: whereFromEvent(event) }));
      if (!shown.length) matches.remove();
      return result;
    };
    copied = { ...request, notes: found };
    const total = found.reduce((sum, n) => sum + n.count, 0);
    countLabel.textContent = `${total.toLocaleString()} result${total === 1 ? "" : "s"}`;
    results.replaceChildren();
    if (!found.length) {
      results.append(h("div", { class: "pane-empty" }, "No matches found."));
      return;
    }
    pagedRows(results, found, row, PAGE, AT_ONCE, async batch => {
      const shown = await api.searchLines(query, caseSensitive, batch.map(n => n.path), LINES);
      if (mine !== seq) return false;
      if (moreContext || openedRows.size > 0) {
        await Promise.all(batch.filter(n => (shown[n.path] ?? []).some(hit => wantsContext(n.path, hit.line)))
          .map(async n => { const text = await noteText(ws, n.path); if (mine === seq) texts.set(n.path, text); }));
      }
      if (mine !== seq) return false;
      for (const n of batch) lines.set(n.path, shown[n.path] ?? []);
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

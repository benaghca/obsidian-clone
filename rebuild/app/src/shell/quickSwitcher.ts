// Ctrl+O quick switcher: the shared Obsidian prompt pattern (centered modal,
// dim overlay, fuzzy results with bolded matches, footer key hints).

import { animateOut } from "../motion";
import { parentDir, type Workspace } from "../workspace";
import { h } from "./dom";
import { highlight } from "./fuzzy";
import { type SwitcherItem, switcherItems } from "./switcherItems";

export function openQuickSwitcher(ws: Workspace) {
  if (document.querySelector(".modal-container:not(.is-closing)")) return;
  const restoreFocus = document.activeElement as HTMLElement | null;

  const input = h("input", { class: "prompt-input", "aria-label": "Find or create a note" });
  input.placeholder = "Find or create a note...";
  const clear = h("div", { class: "search-input-clear-button", "aria-label": "Clear", onclick: () => setQuery("") });
  const results = h("div", { class: "prompt-results" });
  const hint = (key: string, text: string) =>
    h("div", { class: "prompt-instruction" }, h("span", { class: "prompt-instruction-command" }, key), text);
  const prompt = h(
    "div",
    { class: "prompt" },
    h("div", { class: "prompt-input-container" }, input, clear),
    results,
    h(
      "div",
      { class: "prompt-instructions" },
      hint("↑↓", "to navigate"),
      hint("↵", "to open"),
      hint("ctrl ↵", "to open in new tab"),
      hint("shift ↵", "to create"),
      hint("esc", "to dismiss"),
    ),
  );
  const overlay = h("div", { class: "modal-container" }, h("div", { class: "modal-bg", onclick: () => close() }), prompt);

  let items: SwitcherItem[] = [];
  let selected = 0;

  const compute = (query: string) => switcherItems(query, ws.notes, ws.recent, ws.active.path);

  function render() {
    results.replaceChildren(
      ...items.map((item, i) => {
        const row = h(
          "div",
          {
            class: `suggestion-item${i === selected ? " is-selected" : ""}`,
            onmousemove: () => select(i),
            onclick: (e: MouseEvent) => choose(i, e.ctrlKey || e.metaKey),
          },
          h("div", { class: "suggestion-title" }, highlight(item.name, item.indices)),
        );
        if (item.path === null) row.append(h("div", { class: "suggestion-aux" }, "Enter to create"));
        else if (parentDir(item.path)) row.append(h("div", { class: "suggestion-note" }, parentDir(item.path)));
        return row;
      }),
    );
    if (!items.length) results.append(h("div", { class: "suggestion-empty" }, "No notes found."));
    clear.style.display = input.value ? "" : "none";
  }

  function select(i: number) {
    if (i === selected) return;
    results.children[selected]?.classList.remove("is-selected");
    selected = i;
    const row = results.children[selected] as HTMLElement | undefined;
    row?.classList.add("is-selected");
    row?.scrollIntoView({ block: "nearest" });
  }

  function setQuery(q: string) {
    input.value = q;
    items = compute(q);
    selected = 0;
    render();
    input.focus();
  }

  async function choose(i: number, newTab: boolean) {
    const item = items[i];
    if (!item) return;
    close(false);
    if (item.path) await ws.open(item.path, { newTab });
    else await ws.openLink(item.name, newTab);
  }

  // The overlay plays its exit and removes itself; the note being opened
  // never waits on it.
  function close(restore = true) {
    void animateOut(overlay);
    if (restore) restoreFocus?.focus();
  }

  input.addEventListener("input", () => {
    items = compute(input.value);
    selected = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) select(Math.min(selected + 1, items.length - 1));
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) select(Math.max(selected - 1, 0));
    else if (e.key === "Enter" && e.shiftKey) void ws.openLink(input.value.trim(), e.ctrlKey).then(() => close(false));
    else if (e.key === "Enter") void choose(selected, e.ctrlKey || e.metaKey);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  document.body.append(overlay);
  setQuery("");
}

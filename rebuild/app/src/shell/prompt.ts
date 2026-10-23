// The shared Obsidian prompt: a centred modal over a dim overlay with an
// input, a list of suggestions (first one highlighted) and a footer of key
// hints. The quick switcher, the command palette and "Move file to..." are
// all this one component with different items.

import { h } from "./dom";
import { fuzzyRank, highlight } from "./fuzzy";
import { icon } from "./icons";

export interface PromptOptions<T> {
  placeholder: string;
  /** Footer hints: [keys, what they do]. */
  instructions: [string, string][];
  /** The suggestions for a query, best first. Runs on each keystroke, so keep it cheap. */
  items(query: string): T[];
  /** Fill a row for an item. */
  render(item: T, row: HTMLElement): void;
  choose(item: T, e: KeyboardEvent | MouseEvent): void;
  emptyText: string;
  /** Extra keys (Shift+Enter to create, ...). Return true if handled. */
  onKey?(e: KeyboardEvent, selected: T | undefined, query: string, close: (restoreFocus?: boolean) => void, setQuery: (query: string, keep?: (item: T) => boolean) => void): boolean;
  className?: string;
  /** Give focus back to where it was before running the choice (commands act on the editor). */
  restoreFocusOnChoose?: boolean;
}

/** The usual footer: navigate, what Enter does, dismiss. */
export const hints = (enter: string): [string, string][] => [
  ["↑↓", "to navigate"],
  ["↵", enter],
  ["esc", "to dismiss"],
];

/** A suggestion's title, its matched letters bold, and a muted note under it (a folder) if given. */
export function suggestionText(row: HTMLElement, title: string, indices: number[], note = "") {
  const content = h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(title, indices)));
  if (note) content.append(h("div", { class: "suggestion-note" }, note));
  row.append(content);
}

/**
 * The prompt over a list, fuzzy-filtered by each item's label (the whole
 * list, in its order, before anything is typed): "Move file to...", "Insert
 * template", an image's "Swap file...".
 */
export function pickFrom<T>(
  list: readonly T[],
  label: (item: T) => string,
  opts: Pick<PromptOptions<T>, "placeholder" | "emptyText" | "restoreFocusOnChoose"> & { enter: string; choose(item: T): void },
) {
  openPrompt<{ item: T; indices: number[] }>({
    ...opts,
    instructions: hints(opts.enter),
    items: (query) => (query.trim() ? fuzzyRank(query, list, label) : list.map((item) => ({ item, indices: [] }))),
    render: ({ item, indices }, row) => suggestionText(row, label(item), indices),
    choose: ({ item }) => opts.choose(item),
  });
}

let openCount = 0;

/** Whether a prompt is open (hotkeys and menus leave the keyboard to it). */
export const isPromptOpen = () => openCount > 0;

export function openPrompt<T>(opts: PromptOptions<T>) {
  if (document.querySelector(".modal-container:not(.is-closing)")) return;
  const restoreFocus = document.activeElement as HTMLElement | null;

  const input = h("input", { class: "prompt-input", placeholder: opts.placeholder, spellcheck: "false", "aria-label": opts.placeholder });
  const clear = h(
    "div",
    { class: "search-input-clear-button", "aria-label": "Clear search", onclick: () => setQuery("") },
    icon("circle-x", 16),
  );
  const results = h("div", { class: "prompt-results" });
  const prompt = h(
    "div",
    { class: `prompt${opts.className ? ` ${opts.className}` : ""}` },
    h("div", { class: "prompt-input-container" }, input, clear),
    results,
    h(
      "div",
      { class: "prompt-instructions" },
      ...opts.instructions.map(([keys, text]) =>
        h("div", { class: "prompt-instruction" }, h("span", { class: "prompt-instruction-command" }, keys), h("span", null, text)),
      ),
    ),
  );
  const overlay = h("div", { class: "modal-container" }, h("div", { class: "modal-bg", onclick: () => close() }), prompt);

  let items: T[] = [];
  let selected = 0;
  let closed = false;

  function render() {
    results.replaceChildren(
      ...items.map((item, i) => {
        const row = h("div", {
          class: `suggestion-item${i === selected ? " is-selected" : ""}`,
          onmousemove: () => select(i),
          onclick: (e: MouseEvent) => choose(i, e),
        });
        opts.render(item, row);
        return row;
      }),
    );
    if (!items.length) results.append(h("div", { class: "suggestion-empty" }, opts.emptyText));
    clear.hidden = !input.value;
  }

  function select(i: number) {
    if (i === selected || !items.length) return;
    results.children[selected]?.classList.remove("is-selected");
    selected = i;
    const row = results.children[selected] as HTMLElement | undefined;
    row?.classList.add("is-selected");
    row?.scrollIntoView({ block: "nearest" });
  }

  function update(keep?: (item: T) => boolean) {
    const previous = items[selected];
    items = opts.items(input.value);
    if (keep && previous && keep(previous) && !items.some(keep)) items = [previous, ...items.slice(0, -1)];
    selected = keep ? Math.max(0, items.findIndex(keep)) : 0;
    render();
  }

  function setQuery(q: string, keep?: (item: T) => boolean) {
    input.value = q;
    update(keep);
    input.focus();
    if (keep) (results.children[selected] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  function choose(i: number, e: KeyboardEvent | MouseEvent) {
    const item = items[i];
    if (item === undefined) return;
    close(!!opts.restoreFocusOnChoose);
    opts.choose(item, e);
  }

  function close(restore = true) {
    if (closed) return;
    closed = true;
    openCount--;
    overlay.remove();
    if (restore) restoreFocus?.focus();
  }

  input.addEventListener("input", () => update());
  input.addEventListener("keydown", (e) => {
    if (opts.onKey?.(e, items[selected], input.value, close, setQuery)) {
      // handled by the caller
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      select(items.length ? (selected + 1) % items.length : 0);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      select(items.length ? (selected - 1 + items.length) % items.length : 0);
    } else if (e.key === "Enter" && !e.isComposing) {
      choose(selected, e);
    } else if (e.key === "Escape") {
      close();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  openCount++;
  document.body.append(overlay);
  setQuery("");
}

/**
 * The footer's ↑ ↓ ↵ glyphs (and the arrows in hotkey hints) are not in
 * most UI fonts, and the first layout that uses them makes the engine search
 * the system fonts for a fallback: about 10ms, which used to land on the
 * first Ctrl+O or Ctrl+P. Laying them out once, hidden, while the app is
 * idle after startup pays that ahead of time.
 */
export function warmUpPromptGlyphs() {
  const run = () => {
    const probe = h(
      "div",
      { class: "prompt", "aria-hidden": "true" },
      h(
        "div",
        { class: "prompt-instructions" },
        h("div", { class: "prompt-instruction" }, h("span", { class: "prompt-instruction-command" }, "↑↓ ↵ ← →"), h("span", null, "↑↓ ↵")),
      ),
      h("div", { class: "menu-item-hotkey" }, "← → ↑ ↓ ↵"),
    );
    probe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;animation:none";
    document.body.append(probe);
    void probe.offsetHeight;
    probe.remove();
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 500);
}

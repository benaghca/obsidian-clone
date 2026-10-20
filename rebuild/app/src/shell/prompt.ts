// The shared Obsidian prompt: a centred modal over a dim overlay with an
// input, a list of suggestions (first one highlighted) and a footer of key
// hints. The quick switcher, the command palette and "Move file to..." are
// all this one component with different items.

import { animateOut } from "../motion";
import { h } from "./dom";
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
  onKey?(e: KeyboardEvent, selected: T | undefined, query: string, close: (restoreFocus?: boolean) => void): boolean;
  className?: string;
  /** Give focus back to where it was before running the choice (commands act on the editor). */
  restoreFocusOnChoose?: boolean;
}

export interface Prompt {
  close(restoreFocus?: boolean): void;
  readonly query: string;
}

let openCount = 0;

/** Whether a prompt is open (hotkeys and menus leave the keyboard to it). */
export const isPromptOpen = () => openCount > 0;

export function openPrompt<T>(opts: PromptOptions<T>): Prompt | null {
  if (document.querySelector(".modal-container:not(.is-closing)")) return null;
  const restoreFocus = document.activeElement as HTMLElement | null;

  const input = h("input", { class: "prompt-input", "aria-label": opts.placeholder });
  input.placeholder = opts.placeholder;
  input.spellcheck = false;
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

  function update() {
    items = opts.items(input.value);
    selected = 0;
    render();
  }

  function setQuery(q: string) {
    input.value = q;
    update();
    input.focus();
  }

  function choose(i: number, e: KeyboardEvent | MouseEvent) {
    const item = items[i];
    if (item === undefined) return;
    close(!!opts.restoreFocusOnChoose);
    opts.choose(item, e);
  }

  // The overlay plays its exit and removes itself; whatever was chosen never
  // waits on it.
  function close(restore = true) {
    if (closed) return;
    closed = true;
    openCount--;
    void animateOut(overlay);
    if (restore) restoreFocus?.focus();
  }

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (opts.onKey?.(e, items[selected], input.value, close)) {
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
  return {
    close,
    get query() {
      return input.value;
    },
  };
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

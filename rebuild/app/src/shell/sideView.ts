// What every sidebar view is (an element that works only while shown), and
// the parts their trees share: collapsible sections with a count, chevrons
// that fold a group, "Show N more" rows and highlighted matches.

import { h } from "./dom";
import { icon } from "./icons";
import { type Span, snippetParts } from "./mentions";

export interface SideView {
  el: HTMLElement;
  /** Shown (sidebar open, this view selected) or not; hidden views do no work. */
  setActive(active: boolean): void;
}

/**
 * Vault-wide data a view shows (all tags, all property names), read only
 * while the view is shown: `delay` ms after it goes stale (`changed()`), or
 * when it is shown again after going stale while hidden. A read a newer one
 * overtook is dropped; a failed one keeps the last data. Each read that
 * lands is drawn with `render`.
 */
export function liveData<T>(initial: T, read: () => Promise<T>, render: () => void, what: string) {
  let data = initial;
  let active = false;
  let stale = true;
  let timer = 0;
  let seq = 0;
  async function refresh() {
    const mine = ++seq;
    try {
      const next = await read();
      if (mine === seq) data = next;
    } catch (err) {
      console.error(`Could not read ${what}`, err);
    }
    if (mine !== seq || !active) return;
    stale = false;
    render();
  }
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (active) timer = window.setTimeout(() => void refresh(), delay);
  };
  return {
    get data() {
      return data;
    },
    get active() {
      return active;
    },
    get stale() {
      return stale;
    },
    changed(delay: number) {
      stale = true;
      schedule(delay);
    },
    /** Returns whether `next` is a change; a view shown while stale reads again after `delay`. */
    setActive(next: boolean, delay: number): boolean {
      if (next === active) return false;
      active = next;
      if (active && stale) schedule(delay);
      else if (!active) clearTimeout(timer);
      return true;
    },
  };
}

/** Run after the current frame is painted, so a note switch shows first. */
export const afterPaint = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, 0));

/** A collapsible "Linked mentions"-style section with a count. */
export function section(title: string, open: boolean, onToggle: (open: boolean) => void) {
  const count = h("div", { class: "tree-item-flair" });
  const body = h("div", { class: "search-result-container" });
  const chevron = foldToggle(body, !open, (collapsed) => onToggle(!collapsed));
  // A click anywhere on the header folds the section, as one on its chevron does.
  const header = h("div", { class: "tree-item-self backlink-header", onclick: () => chevron.click() }, chevron, h("div", { class: "tree-item-inner" }, title), count);
  return { el: h("div", { class: "backlink-section" }, header, body), body, count };
}

/** A chevron that folds `group` away (or opens it) without the click reaching its row. */
export function foldToggle(group: HTMLElement, collapsed: boolean, onToggle: (collapsed: boolean) => void): HTMLElement {
  group.hidden = collapsed;
  const chevron = h(
    "div",
    {
      class: `tree-item-icon collapse-icon${collapsed ? " is-collapsed" : ""}`,
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        group.hidden = !group.hidden;
        chevron.classList.toggle("is-collapsed", group.hidden);
        onToggle(group.hidden);
      },
    },
    icon("chevron-down", 14),
  );
  return chevron;
}

/** Rows for `items`, `page` at a time, then a "Show N more" row that adds four pages more. */
export function pagedRows<T>(into: HTMLElement, items: T[], row: (item: T) => Node, page: number) {
  const more = h("div", { class: "search-result-more" });
  let shown = 0;
  const showMore = (n: number) => {
    more.before(...items.slice(shown, shown + n).map(row));
    shown = Math.min(items.length, shown + n);
    more.textContent = `Show ${(items.length - shown).toLocaleString()} more`;
    more.hidden = shown >= items.length;
  };
  more.addEventListener("click", () => showMore(page * 4));
  into.append(more);
  showMore(page);
}

/** A line with the columns in `spans` highlighted, as search results show them. */
export const highlighted = (text: string, spans: Span[]) =>
  snippetParts(text, spans).map((part) => (part.hit ? h("span", { class: "search-result-file-matched-text" }, part.text) : part.text));

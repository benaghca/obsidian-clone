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

/** Run after the current frame is painted, so a note switch shows first. */
export const afterPaint = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, 0));

/** A collapsible "Linked mentions"-style section with a count. */
export function section(title: string, open: boolean, onToggle: (open: boolean) => void) {
  const count = h("div", { class: "tree-item-flair" });
  const chevron = h("div", { class: `tree-item-icon collapse-icon${open ? "" : " is-collapsed"}` }, icon("chevron-down", 14));
  const body = h("div", { class: "search-result-container" });
  body.hidden = !open;
  const header = h(
    "div",
    {
      class: "tree-item-self backlink-header",
      onclick: () => {
        body.hidden = !body.hidden;
        chevron.classList.toggle("is-collapsed", body.hidden);
        onToggle(!body.hidden);
      },
    },
    chevron,
    h("div", { class: "tree-item-inner" }, title),
    count,
  );
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

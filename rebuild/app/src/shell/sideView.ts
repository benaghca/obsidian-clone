// What every sidebar view is (an element that works only while shown), and
// the parts their trees share: collapsible sections with a count, chevrons
// that fold a group, "Show N more" rows and highlighted matches.

import { noteName } from "../paths";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon, type IconName } from "./icons";
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
  let timer = 0;
  let seq = 0;
  async function refresh() {
    const mine = ++seq;
    try {
      const next = await read();
      if (mine === seq) live.data = next;
    } catch (err) {
      console.error(`Could not read ${what}`, err);
    }
    if (mine !== seq || !live.active) return;
    live.stale = false;
    render();
  }
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (live.active) timer = window.setTimeout(() => void refresh(), delay);
  };
  const live = {
    data: initial,
    active: false,
    stale: true,
    changed(delay: number) {
      live.stale = true;
      schedule(delay);
    },
    /** Returns whether `next` is a change; a view shown while stale reads again after `delay`. */
    setActive(next: boolean, delay: number): boolean {
      if (next === live.active) return false;
      live.active = next;
      if (live.active && live.stale) schedule(delay);
      else if (!live.active) clearTimeout(timer);
      return true;
    },
  };
  return live;
}

/** A sidebar's icon tabs over its content: `show` puts a view in and marks its tab; a click calls `select`. */
export function viewTabs<K extends string>(tabs: readonly (readonly [K, IconName, string])[], viewOf: (name: K) => HTMLElement, select: (name: K) => void) {
  const buttons = new Map(tabs.map(([name, iconName, label]) => [name, iconButton(icon(iconName), label, () => select(name), "workspace-tab-header")]));
  const content = h("div", { class: "workspace-leaf-content" });
  return {
    buttons,
    content,
    header: h("div", { class: "workspace-tab-header-container", "data-tauri-drag-region": "" }, ...buttons.values()),
    show(name: K) {
      for (const [n, b] of buttons) b.classList.toggle("is-active", n === name);
      if (content.firstElementChild !== viewOf(name)) content.replaceChildren(viewOf(name));
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

/** A foldToggle callback that keeps whether `key` is folded in `folded`. */
export const foldIn = (folded: Set<string>, key: string) => (on: boolean) => void (on ? folded.add(key) : folded.delete(key));

/**
 * Rows for `items`, `page` at a time (the first `now` at once, the rest of
 * the page just after they are painted), then a "Show N more" row that adds
 * four pages more.
 */
export function pagedRows<T>(into: HTMLElement, items: T[], row: (item: T) => Node, page: number, now = page) {
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
  showMore(now);
  if (now < page) afterPaint(() => more.isConnected && shown === now && showMore(page - now));
}

/** A line with the columns in `spans` highlighted, as search results show them. */
export const highlighted = (text: string, spans: Span[]) =>
  snippetParts(text, spans).map((part) => (part.hit ? h("span", { class: "search-result-file-matched-text", "data-from": String(part.range!.from), "data-to": String(part.range!.to) }, part.text) : part.text));

/** A pressed highlight's original columns; clicks elsewhere in the row use its first match. */
export function hitColumns(event: MouseEvent, spans: Span[]): [number, number] | undefined {
  const hit = (event.target as Element).closest<HTMLElement>(".search-result-file-matched-text");
  const span = hit ? { from: Number(hit.dataset.from), to: Number(hit.dataset.to) } : spans[0];
  return span && [span.from, span.to];
}

/** A note's foldable result group, shared by Search and Backlinks. */
export function resultGroup(path: string, matches: HTMLElement, count: string | null, collapsed: Set<string>, open: (event: MouseEvent) => void) {
  return h("div", { class: "search-result" },
    h("div", { class: "search-result-file-title", "data-preview-path": path, onclick: open },
      foldToggle(matches, collapsed.has(path), foldIn(collapsed, path)),
      h("div", { class: "search-result-file-name" }, noteName(path)),
      count === null ? null : h("span", { class: "search-result-count" }, count)),
    matches);
}

/** A snippet whose pressed highlight selects its original source columns. */
export function resultMatch(ws: Workspace, path: string, hit: { text: string; line: number }, spans: Span[]) {
  return h("div", {
    class: "search-result-file-match", "data-preview-path": path,
    onclick: (event: MouseEvent) => void ws.open(path, { line: hit.line, ch: hitColumns(event, spans) }),
  }, ...highlighted(hit.text, spans));
}

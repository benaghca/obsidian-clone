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
export function pagedRows<T>(into: HTMLElement, items: T[], row: (item: T) => Node, page: number, now = page, before?: (items: T[]) => Promise<boolean | void>) {
  const more = h("div", { class: "search-result-more" });
  let shown = 0;
  let busy = false;
  const showMore = async (n: number) => {
    if (busy) return;
    busy = true;
    try {
      const batch = items.slice(shown, shown + n);
      if (before && await before(batch) === false) return;
      if (more.parentNode !== into) return;
      more.before(...batch.map(row));
      shown += batch.length;
      more.textContent = `Show ${(items.length - shown).toLocaleString()} more`;
      more.hidden = shown >= items.length;
    } finally { busy = false; }
  };
  const append = (n: number) => showMore(n).catch(err => console.error("Could not read result rows", err));
  more.addEventListener("click", () => void append(page * 4));
  into.append(more);
  void append(now).then(() => {
    if (now < page) afterPaint(() => more.isConnected && shown === now && void append(page - now));
  });
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
  return h("div", { class: "tree-item search-result" },
    h("div", { class: "search-result-file-title", "data-preview-path": path, onclick: open },
      foldToggle(matches, collapsed.has(path), foldIn(collapsed, path)),
      h("div", { class: "search-result-file-name" }, noteName(path)),
      count === null ? null : h("span", { class: "search-result-count" }, count)),
    matches);
}

/** Fold or open every result group under `root`. */
export function setGroupsCollapsed(root: ParentNode, collapsed: boolean) {
  for (const icon of root.querySelectorAll<HTMLElement>(".search-result-file-title .collapse-icon")) {
    if (icon.classList.contains("is-collapsed") !== collapsed) icon.click();
  }
}

/** Folds every result group under `root`, then opens them on the next press. */
export function collapseResultsButton(root: ParentNode): HTMLElement {
  const button = iconButton(icon("list", 16), "Collapse results", () => {
    const icons = [...root.querySelectorAll(".search-result-file-title .collapse-icon")];
    const collapse = icons.some((node) => !node.classList.contains("is-collapsed"));
    setGroupsCollapsed(root, collapse);
    button.setAttribute("aria-label", collapse ? "Expand results" : "Collapse results");
  });
  return button;
}

const reveal = (row: HTMLElement) => {
  const scroller = row.closest<HTMLElement>(".search-results, .backlink-pane, .outline-list");
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  if (r.top < box.top) scroller.scrollTop -= box.top - r.top;
  else if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom;
};

type ResultStop = { kind: "file" | "match"; el: HTMLElement };

/** The file group first, then each of its visible matches. */
function resultStops(root: HTMLElement): ResultStop[] {
  const groups = [...root.querySelectorAll<HTMLElement>(".search-result")].filter((el) => el.offsetParent);
  if (!groups.length) {
    return [...root.querySelectorAll<HTMLElement>(".search-result-file-match")].filter((row) => row.offsetParent).map((el) => ({ kind: "match", el }));
  }
  const out: ResultStop[] = [];
  for (const group of groups) {
    out.push({ kind: "file", el: group });
    for (const row of group.querySelectorAll<HTMLElement>(".search-result-file-match")) {
      if (row.offsetParent) out.push({ kind: "match", el: row });
    }
  }
  return out;
}

/**
 * ArrowDown and ArrowUp move through each file row, then its visible matches.
 * The first ArrowDown from the field lands on the file. Enter opens the
 * highlighted row. A menu that is already open keeps the keys.
 */
export function bindResultKeys(root: HTMLElement) {
  root.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    if (event.altKey || event.metaKey || event.ctrlKey || document.querySelector(".menu")) return;
    // The search field keeps these keys (they move the result highlight). A sort menu or a filter does not.
    const target = event.target as HTMLElement | null;
    if (target?.closest("select, input:not(.search-input), textarea")) return;
    const stops = resultStops(root);
    if (!stops.length) return;
    const current = stops.findIndex((stop) => (stop.kind === "file" ? stop.el.classList.contains("has-focus") : stop.el.classList.contains("is-selected")));
    if (event.key === "Enter") {
      if (current < 0) return;
      event.preventDefault();
      const stop = stops[current];
      if (stop.kind === "file") stop.el.querySelector<HTMLElement>(".search-result-file-title")?.click();
      else stop.el.click();
      return;
    }
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(stops.length - 1, current + 1) : Math.max(0, current < 0 ? stops.length - 1 : current - 1);
    for (const stop of stops) {
      stop.el.classList.toggle("has-focus", stop.kind === "file" && stop === stops[next]);
      if (stop.kind === "match") stop.el.classList.toggle("is-selected", stop === stops[next]);
    }
    const row = stops[next].kind === "file" ? stops[next].el.querySelector<HTMLElement>(".search-result-file-title") ?? stops[next].el : stops[next].el;
    reveal(row);
  });
}

/** The note's text: the open editor when it is loaded, otherwise a read. */
export async function noteText(ws: Workspace, path: string): Promise<string> {
  const doc = ws.editors.doc(path);
  if (doc) return doc.toString();
  try {
    // Loaded only when a closed note is read, so importing this file does not touch `window`.
    const { api } = await import("../api");
    return await api.readNote(path);
  } catch {
    return "";
  }
}

const headingLine = (line: string) => /^#{1,6}(?:\s|$)/.test(line);
/** A blank line or a heading ends the block. A heading is its own block. */
const blockBreak = (line: string) => line.trim() === "" || headingLine(line);

/** The rest of the hit's paragraph: lines until a blank line or a heading. Not the hit itself. */
export function linesAround(text: string, line: number): { before: string; after: string } {
  const lines = text.split("\n");
  const i = line - 1;
  if (i < 0 || i >= lines.length || headingLine(lines[i])) return { before: "", after: "" };
  let start = i;
  while (start > 0 && !blockBreak(lines[start - 1])) start--;
  let end = i;
  while (end + 1 < lines.length && !blockBreak(lines[end + 1])) end++;
  return {
    before: lines.slice(start, i).join("\n"),
    after: lines.slice(i + 1, end + 1).join("\n"),
  };
}

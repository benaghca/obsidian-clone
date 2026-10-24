// Backlinks view for the right sidebar. "Linked mentions" are the notes
// whose [[links]] resolve to the open note, from the backend's link index,
// grouped per note with the line around each link and the link
// highlighted. "Unlinked mentions" are plain-text uses of the note's title,
// found with the backend's search; that section starts collapsed and is only
// searched while it is open. Each mention is its own row. Clicking a result
// opens the note at it. Link, on the row, wraps that one mention as a link.
//
// None of this runs on a keystroke: it follows note switches, and the link
// index, which the workspace refreshes a second after a save.

import { api, type SearchHit } from "../api";
import { updateNoteText } from "../fileOps";
import { kept } from "../memo";
import { compareFiles, noteName, SORT_ORDERS, type SortOrder } from "../paths";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import { linkSpans, mentionSpans, type Span } from "./mentions";
import { showMenu } from "./menu";
import { afterPaint, bindResultKeys, collapseResultsButton, hitColumns, highlighted, linesAround, noteText, pagedRows, resultGroup, section, type SideView } from "./sideView";

interface Mention {
  from: string;
  line: number;
  text: string;
  /** Mentions on this line (one row shows them all). */
  count: number;
  /** Highlighted columns, worked out only when the row is drawn. */
  spans: () => Span[];
}

const UNLINKED_DELAY = 300;
const SEARCH_LIMIT = 500;
/** Matches shown per note before a "show more" row; keeps the DOM small for heavily linked notes. */
const PAGE = 25;

/**
 * The Backlinks view. `pathOf` is the note it is for: the active pane's in
 * the right sidebar; a pane's own note when shown under it ("Backlinks in
 * document").
 */
export function createBacklinksView(ws: Workspace, pathOf: () => string | null = () => ws.active.path): SideView {
  const collapsedFiles = new Set<string>();
  /** A row opened from its chevron, and a row folded while Show more context is on. */
  const opened = new Set<string>();
  const closed = new Set<string>();
  const noteCache = new Map<string, string>();
  let unlinkedOpen = false;
  let moreContext = false;
  let sort: SortOrder = "alphabetical";
  let filterText = "";

  const linked = section("Linked mentions", true, () => {});
  const unlinked = section("Unlinked mentions", false, (open) => {
    unlinkedOpen = open;
    if (open) scheduleUnlinked(0);
  });
  const pane = h("div", { class: "backlink-pane", tabindex: "0" });
  const filterInput = h("input", { class: "backlink-filter", type: "search", placeholder: "Filter...", "aria-label": "Filter backlinks" });
  filterInput.hidden = true;
  const contextBtn = iconButton(icon("move-vertical", 16), "Show more context", () => {
    moreContext = !moreContext;
    closed.clear();
    contextBtn.classList.toggle("is-active", moreContext);
    shownLinked = "";
    renderLinked();
    scheduleUnlinked(0);
  });
  const sortBtn = iconButton(icon("arrow-down-narrow-wide", 16), "Change sort order", () => {
    showMenu(SORT_ORDERS.map(([order, title]) => ({
      title,
      checked: order === sort,
      action: () => {
        sort = order;
        sortBtn.classList.toggle("is-active", order !== "alphabetical");
        shownLinked = "";
        renderLinked();
        scheduleUnlinked(0);
      },
    })), sortBtn);
  });
  const filterBtn = iconButton(icon("search", 16), "Show search filter", () => {
    const on = filterInput.hidden !== false;
    filterBtn.classList.toggle("is-active", on);
    filterInput.hidden = !on;
    if (!on && filterText) {
      filterText = "";
      filterInput.value = "";
      shownLinked = "";
      renderLinked();
      scheduleUnlinked(0);
    } else if (on) filterInput.focus();
  });
  const toolbar = h("div", { class: "nav-buttons-container backlink-toolbar" }, collapseResultsButton(pane), contextBtn, sortBtn, filterBtn);
  const el = h("div", { class: "backlink-view" }, h("div", { class: "nav-header" }, toolbar, filterInput), pane);
  pane.append(linked.el, unlinked.el);
  bindResultKeys(pane);

  let active = false;
  let shownLinked = "";
  let unlinkedTimer = 0;
  let unlinkedSeq = 0;

  const rowKey = (m: Mention) => `${m.from}:${m.line}`;
  const wantsContext = (m: Mention) => !closed.has(rowKey(m)) && (moreContext || opened.has(rowKey(m)));

  filterInput.addEventListener("input", () => {
    filterText = filterInput.value;
    shownLinked = "";
    renderLinked();
    scheduleUnlinked(0);
  });

  function passes(m: Mention): boolean {
    const q = filterText.trim().toLowerCase();
    return !q || noteName(m.from).toLowerCase().includes(q) || m.text.toLowerCase().includes(q);
  }

  /** Rows grouped per note; returns the number of mentions shown (Obsidian's count). */
  function renderGroups(into: HTMLElement, mentions: Mention[], emptyText: string, row: (m: Mention) => HTMLElement) {
    const byFile = new Map<string, Mention[]>();
    for (const m of mentions) if (passes(m)) kept(byFile, m.from, () => []).push(m);
    const entries = new Map(ws.vault.files.map((f) => [f.path, f]));
    const order = compareFiles(sort);
    const files = [...byFile.keys()].sort((a, b) => order(
      entries.get(a) ?? { name: noteName(a), mtime_ms: 0, ctime_ms: 0 },
      entries.get(b) ?? { name: noteName(b), mtime_ms: 0, ctime_ms: 0 },
    ));
    into.replaceChildren(
      ...files.map((path) => {
        const all = byFile.get(path)!;
        const matches = h("div", { class: "search-result-file-matches" });
        pagedRows(matches, all, row, PAGE);
        return resultGroup(path, matches, total(all).toLocaleString(), collapsedFiles, () => void ws.open(path));
      }),
    );
    if (!files.length) into.append(h("div", { class: "search-empty-state" }, emptyText));
    return total(mentions.filter(passes));
  }

  const total = (mentions: Mention[]) => mentions.reduce((n, m) => n + m.count, 0);

  function contextOf(m: Mention): { before: string; after: string } | null {
    if (!wantsContext(m)) return null;
    const text = noteCache.get(m.from);
    if (text === undefined) return null;
    const around = linesAround(text, m.line);
    return around.before || around.after ? around : null;
  }

  function queueContext(mentions: Mention[], again: () => void) {
    const missing = [...new Set(mentions.filter(wantsContext).map((m) => m.from))].filter((p) => !noteCache.has(p));
    if (!missing.length) return;
    void Promise.all(missing.map(async (p) => noteCache.set(p, await noteText(ws, p)))).then(again);
  }

  function contextChevron(m: Mention) {
    const on = wantsContext(m);
    return h("div", {
      class: `clickable-icon backlink-context-toggle${on ? " is-expanded" : ""}`,
      "aria-label": on ? "Hide context" : "Show more context",
      onclick: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const key = rowKey(m);
        if (wantsContext(m)) {
          opened.delete(key);
          if (moreContext) closed.add(key);
          else closed.delete(key);
        } else {
          closed.delete(key);
          opened.add(key);
        }
        shownLinked = "";
        renderLinked();
        if (unlinkedOpen) void renderUnlinked();
      },
    }, icon("chevrons-up-down", 14));
  }

  function mentionRow(m: Mention, button: HTMLElement | null) {
    const spans = m.spans();
    const ctx = contextOf(m);
    const open = (event: MouseEvent) => void ws.open(m.from, { line: m.line, ch: hitColumns(event, spans) });
    const chevron = contextChevron(m);
    if (!ctx && !button) {
      return h("div", { class: "search-result-file-match", "data-preview-path": m.from, onclick: open }, ...highlighted(m.text, spans), chevron);
    }
    return h("div", { class: "search-result-file-match", "data-preview-path": m.from, onclick: open },
      ctx?.before ? h("div", { class: "search-result-context" }, ctx.before) : null,
      h("div", { class: "search-result-file-match-text" }, ...highlighted(m.text, spans)),
      ctx?.after ? h("div", { class: "search-result-context" }, ctx.after) : null,
      button,
      chevron);
  }

  function renderLinked(force = false) {
    const path = pathOf();
    const entries = path ? (ws.vault.links.backlinks[path] ?? []) : [];
    // Skip the DOM work (and keep scroll and collapsed groups) when nothing changed.
    const key = `${path}\n${sort}\n${filterText}\n${moreContext ? 1 : 0}\n${[...opened].sort()}\n${[...closed].sort()}\n${entries.map((b) => `${b.from}:${b.line}:${b.text}`).join("\n")}`;
    if (!force && key === shownLinked) return;
    shownLinked = key;
    const resolved = new Map<string, boolean>();
    // Link targets resolve from the note they are in.
    const isHere = (target: string, from: string) => kept(resolved, `${from}\n${target}`, () => ws.resolve(target, from) === path);
    // One row per line, however many links it has; the count is every link.
    const byLine = new Map<string, Mention>();
    for (const b of entries) {
      const row = byLine.get(`${b.from}:${b.line}`);
      if (row) row.count++;
      else byLine.set(`${b.from}:${b.line}`, { ...b, count: 1, spans: () => linkSpans(b.text, (t) => isHere(t, b.from)) });
    }
    const mentions = [...byLine.values()];
    const n = renderGroups(linked.body, mentions, path ? "No backlinks found." : "No file is open.", (m) => mentionRow(m, null));
    linked.count.textContent = n ? n.toLocaleString() : "";
    queueContext(mentions, () => shownLinked === key && renderLinked(true));
  }

  function scheduleUnlinked(ms: number) {
    clearTimeout(unlinkedTimer);
    if (active && unlinkedOpen) unlinkedTimer = window.setTimeout(() => void renderUnlinked(), ms);
  }

  async function renderUnlinked() {
    const path = pathOf();
    const seq = ++unlinkedSeq;
    if (!path) {
      renderGroups(unlinked.body, [], "No file is open.", (m) => mentionRow(m, null));
      unlinked.count.textContent = "";
      return;
    }
    const title = noteName(path);
    let hits: SearchHit[] = [];
    try {
      hits = await api.search(title, SEARCH_LIMIT);
    } catch (err) {
      console.error("Could not search for unlinked mentions", err);
    }
    if (seq !== unlinkedSeq || pathOf() !== path) return; // superseded
    const mentions: Mention[] = [];
    for (const hit of hits) {
      if (hit.line === 0 || hit.path === path || !hit.path.endsWith(".md") || ws.vault.isExcluded(hit.path)) continue;
      // One row per mention, so Link wraps that occurrence and leaves the others.
      for (const span of mentionSpans(hit.text, title)) {
        mentions.push({ from: hit.path, line: hit.line, text: hit.text, count: 1, spans: () => [span] });
      }
    }
    const n = renderGroups(unlinked.body, mentions, "No unlinked mentions found.", unlinkedRow);
    unlinked.count.textContent = n ? n.toLocaleString() : "";
    queueContext(mentions, () => seq === unlinkedSeq && void renderUnlinked());
  }

  /** The line, with this mention highlighted, and a Link button that wraps it. */
  function unlinkedRow(m: Mention) {
    const button = h("button", {
      class: "search-result-file-match-replace-button",
      type: "button",
      onclick: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        void linkMention(m);
      },
    }, "Link");
    return mentionRow(m, button);
  }

  /** Turn this one mention into a link in the other note, if that text is still there. */
  async function linkMention(m: Mention) {
    const target = pathOf();
    const span = m.spans()[0];
    if (!target || !span) return;
    const doc = ws.editors.doc(m.from);
    let note: string;
    try {
      note = doc ? doc.toString() : await api.readNote(m.from);
    } catch (err) {
      console.error("Could not link mention", err);
      return;
    }
    const lines = note.split("\n");
    const line = lines[m.line - 1];
    if (line === undefined) return;
    const still = mentionSpans(line, noteName(target)).some((s) => s.from === span.from && s.to === span.to);
    if (!still) return;
    const word = line.slice(span.from, span.to);
    lines[m.line - 1] = line.slice(0, span.from) + ws.linkTo(target, m.from, word) + line.slice(span.to);
    await updateNoteText(ws, m.from, lines.join("\n"));
  }

  function refresh() {
    noteCache.clear();
    shownLinked = "";
    renderLinked();
    scheduleUnlinked(UNLINKED_DELAY);
  }

  ws.on((change) => {
    if (!active) return;
    if (change === "show" || change === "pane") afterPaint(refresh);
    else if (change === "links" || change === "files") refresh();
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) afterPaint(refresh);
      else clearTimeout(unlinkedTimer);
    },
  };
}

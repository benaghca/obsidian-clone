// Backlinks view for the right sidebar. "Linked mentions" are the notes
// whose [[links]] resolve to the open note, from the backend's link index,
// grouped per note with the line around each link and the link
// highlighted. "Unlinked mentions" are plain-text uses of the note's title,
// found with the backend's search; that section starts collapsed and is only
// searched while it is open. Clicking a result opens the note at it.
//
// None of this runs on a keystroke: it follows note switches, and the link
// index, which the workspace refreshes a second after a save.

import { api, type SearchHit } from "../api";
import { compareNames, noteName } from "../paths";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { linkSpans, mentionSpans, snippetParts, type Span } from "./mentions";
import { afterPaint, type SideView } from "./outlineView";

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
  let unlinkedOpen = false;

  const linked = section("Linked mentions", true, () => {});
  const unlinked = section("Unlinked mentions", false, (open) => {
    unlinkedOpen = open;
    if (open) scheduleUnlinked(0);
  });
  const el = h("div", { class: "backlink-pane" }, linked.el, unlinked.el);

  let active = false;
  let shownLinked = "";
  let unlinkedTimer = 0;
  let unlinkedSeq = 0;

  /** A collapsible "Linked mentions"-style section with a count. */
  function section(title: string, open: boolean, onToggle: (open: boolean) => void) {
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

  /** Rows grouped per note; returns the number of mentions shown (Obsidian's count). */
  function renderGroups(into: HTMLElement, mentions: Mention[], emptyText: string) {
    const byFile = new Map<string, Mention[]>();
    for (const m of mentions) byFile.set(m.from, [...(byFile.get(m.from) ?? []), m]);
    const files = [...byFile.keys()].sort((a, b) => compareNames(noteName(a), noteName(b)));
    into.replaceChildren(
      ...files.map((path) => {
        const all = byFile.get(path)!;
        const matches = h("div", { class: "search-result-file-matches" });
        const more = h("div", { class: "search-result-more" });
        let shown = 0;
        const showMore = (n: number) => {
          more.before(...all.slice(shown, shown + n).map(matchRow));
          shown = Math.min(all.length, shown + n);
          more.textContent = `Show ${(all.length - shown).toLocaleString()} more`;
          more.hidden = shown >= all.length;
        };
        more.addEventListener("click", () => showMore(PAGE * 4));
        matches.append(more);
        showMore(PAGE);
        const collapsed = collapsedFiles.has(path);
        matches.hidden = collapsed;
        const chevron = h(
          "div",
          {
            class: `tree-item-icon collapse-icon${collapsed ? " is-collapsed" : ""}`,
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              matches.hidden = !matches.hidden;
              chevron.classList.toggle("is-collapsed", matches.hidden);
              if (matches.hidden) collapsedFiles.add(path);
              else collapsedFiles.delete(path);
            },
          },
          icon("chevron-down", 14),
        );
        return h(
          "div",
          { class: "search-result" },
          h(
            "div",
            { class: "search-result-file-title", onclick: () => void ws.open(path) },
            chevron,
            h("div", { class: "search-result-file-name" }, noteName(path)),
            h("span", { class: "search-result-count" }, total(all).toLocaleString()),
          ),
          matches,
        );
      }),
    );
    if (!files.length) into.append(h("div", { class: "search-empty-state" }, emptyText));
    return total(mentions);
  }

  const total = (mentions: Mention[]) => mentions.reduce((n, m) => n + m.count, 0);

  function matchRow(m: Mention) {
    const spans = m.spans();
    return h(
      "div",
      {
        class: "search-result-file-match",
        onclick: () => {
          const first = spans[0];
          void ws.open(m.from, { line: m.line, ch: first ? [first.from, first.to] : undefined });
        },
      },
      ...snippetParts(m.text, spans).map((part) =>
        part.hit ? h("span", { class: "search-result-file-matched-text" }, part.text) : part.text,
      ),
    );
  }

  function renderLinked() {
    const path = pathOf();
    const entries = path ? (ws.links.backlinks[path] ?? []) : [];
    // Skip the DOM work (and keep scroll and collapsed groups) when nothing changed.
    const key = `${path}\n${entries.map((b) => `${b.from}:${b.line}:${b.text}`).join("\n")}`;
    if (key === shownLinked) return;
    shownLinked = key;
    const resolved = new Map<string, boolean>();
    // Link targets resolve from the note they are in.
    const isHere = (target: string, from: string) => {
      const key = `${from}\n${target}`;
      let here = resolved.get(key);
      if (here === undefined) resolved.set(key, (here = ws.resolve(target, from) === path));
      return here;
    };
    // One row per line, however many links it has; the count is every link.
    const byLine = new Map<string, Mention>();
    for (const b of entries) {
      const row = byLine.get(`${b.from}:${b.line}`);
      if (row) row.count++;
      else byLine.set(`${b.from}:${b.line}`, { ...b, count: 1, spans: () => linkSpans(b.text, (t) => isHere(t, b.from)) });
    }
    const n = renderGroups(linked.body, [...byLine.values()], path ? "No backlinks found." : "No file is open.");
    linked.count.textContent = n ? n.toLocaleString() : "";
  }

  function scheduleUnlinked(ms: number) {
    clearTimeout(unlinkedTimer);
    if (active && unlinkedOpen) unlinkedTimer = window.setTimeout(() => void renderUnlinked(), ms);
  }

  async function renderUnlinked() {
    const path = pathOf();
    const seq = ++unlinkedSeq;
    if (!path) {
      renderGroups(unlinked.body, [], "No file is open.");
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
      if (hit.line === 0 || hit.path === path || !hit.path.endsWith(".md") || ws.isExcluded(hit.path)) continue;
      const spans = mentionSpans(hit.text, title);
      if (spans.length) mentions.push({ from: hit.path, line: hit.line, text: hit.text, count: spans.length, spans: () => spans });
    }
    const n = renderGroups(unlinked.body, mentions, "No unlinked mentions found.");
    unlinked.count.textContent = n ? n.toLocaleString() : "";
  }

  function refresh() {
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

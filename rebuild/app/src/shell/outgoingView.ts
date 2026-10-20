// Outgoing links view for the right sidebar, like Obsidian's: the notes the
// open note links to, with how many times, and its unresolved links faded
// below them; then "Unlinked mentions", the other notes' names that appear
// in it as plain text, each with a button that turns the mention into a
// link. Links are read after a switch has painted and after the link index
// refreshes (a second after a save). Unlinked mentions start collapsed and
// are only worked out while open: after a switch has painted, and 300ms
// after typing stops. Nothing here runs on a keystroke.

import { noteName, whereFromEvent, type Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { wikilinkTargets } from "./linksTags";
import { snippetParts } from "./mentions";
import { afterPaint, type SideView } from "./outlineView";
import { type UnlinkedMention, unlinkedMentions } from "./unlinked";

const DELAY = 300;
/** Mentions drawn before a "Show more" row. */
const PAGE = 50;

export function createOutgoingView(ws: Workspace): SideView {
  /** A collapsible section with a count, like the backlinks view's. */
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

  let unlinkedOpen = false;
  const links = section("Links", true, () => {});
  const unlinked = section("Unlinked mentions", false, (open) => {
    unlinkedOpen = open;
    if (open) schedule(0);
    else clearTimeout(timer);
  });
  const el = h("div", { class: "backlink-pane outgoing-link-pane" }, links.el, unlinked.el);

  let active = false;
  let shownLinks = "";
  let shownUnlinked = "";
  let timer = 0;

  function renderLinks() {
    const path = ws.active.path;
    const targets = path ? wikilinkTargets(ws.view.state.doc.toString()) : [];
    const resolved = new Map<string, string | null>();
    const counts = new Map<string, { path: string | null; name: string; n: number }>();
    for (const target of targets) {
      const name = target.split("/").pop()!;
      let dest = resolved.get(target.toLowerCase());
      if (dest === undefined) resolved.set(target.toLowerCase(), (dest = ws.resolve(target)));
      const key = dest ?? `?${name.toLowerCase()}`;
      const entry = counts.get(key) ?? { path: dest, name: dest ? noteName(dest) : name, n: 0 };
      entry.n++;
      counts.set(key, entry);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    const found = [...counts.values()].filter((c) => c.path).sort(byName);
    const unresolved = [...counts.values()].filter((c) => !c.path).sort(byName);
    // Same list as last time: leave the DOM (and its scroll) alone.
    const key = `${path}\n${[...found, ...unresolved].map((c) => `${c.path ?? "?"}:${c.name}:${c.n}`).join("\n")}`;
    if (key === shownLinks) return;
    shownLinks = key;
    links.body.replaceChildren(
      ...[...found, ...unresolved].map((c) =>
        h(
          "div",
          {
            class: `tree-item-self outgoing-link-item${c.path ? "" : " is-unresolved"}`,
            title: c.path ?? `${c.name} (not created yet)`,
            onclick: (e: MouseEvent) => {
              const where = whereFromEvent(e);
              if (c.path) void ws.open(c.path, { where });
              else void ws.openLink(c.name, where);
            },
          },
          h("div", { class: "tree-item-icon" }, icon(c.path ? "file-text" : "file", 16)),
          h("div", { class: "tree-item-inner" }, c.name),
          h("div", { class: "tree-item-flair" }, String(c.n)),
        ),
      ),
    );
    if (!path) links.body.append(h("div", { class: "search-empty-state" }, "No file is open."));
    else if (!targets.length) links.body.append(h("div", { class: "search-empty-state" }, "No outgoing links."));
    links.count.textContent = found.length + unresolved.length ? String(found.length + unresolved.length) : "";
  }

  function schedule(ms: number) {
    clearTimeout(timer);
    if (active && unlinkedOpen) timer = window.setTimeout(renderUnlinked, ms);
  }

  function renderUnlinked() {
    const path = ws.active.path;
    const mentions = path ? unlinkedMentions(ws.view.state.doc.toString(), ws.notes, path) : [];
    const key = `${path}\n${mentions.map((m) => `${m.line}:${m.from}:${m.to}:${m.path}:${m.text}`).join("\n")}`;
    if (key === shownUnlinked) return;
    shownUnlinked = key;
    unlinked.body.replaceChildren();
    let shown = 0;
    const more = h("div", { class: "search-result-more" });
    const showMore = (n: number) => {
      more.before(...mentions.slice(shown, shown + n).map(card));
      shown = Math.min(mentions.length, shown + n);
      more.textContent = `Show ${(mentions.length - shown).toLocaleString()} more`;
      more.hidden = shown >= mentions.length;
    };
    more.addEventListener("click", () => showMore(PAGE * 4));
    unlinked.body.append(more);
    showMore(PAGE);
    if (!mentions.length) unlinked.body.append(h("div", { class: "search-empty-state" }, path ? "No unlinked mentions found." : "No file is open."));
    unlinked.count.textContent = mentions.length ? mentions.length.toLocaleString() : "";
  }

  /** One mention: the line with the name highlighted (click to go there), and a button that links it. */
  function card(m: UnlinkedMention) {
    const button = h(
      "div",
      {
        class: "unlinked-mention-link",
        title: `Link to ${m.name}`,
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          linkMention(m);
        },
      },
      icon("link", 14),
      h("span", null, m.name),
    );
    return h(
      "div",
      {
        class: "search-result-file-match unlinked-mention",
        onclick: () => {
          const path = ws.active.path;
          if (path) void ws.open(path, { line: m.line, ch: [m.from, m.to] });
        },
      },
      h(
        "div",
        { class: "unlinked-mention-text" },
        ...snippetParts(m.text, [{ from: m.from, to: m.to }]).map((part) =>
          part.hit ? h("span", { class: "search-result-file-matched-text" }, part.text) : part.text,
        ),
      ),
      button,
    );
  }

  /** Turn a mention into a [[link]] in the open note, if the line still reads the same. */
  function linkMention(m: UnlinkedMention) {
    const view = ws.view;
    const doc = view.state.doc;
    if (m.line > doc.lines) return schedule(0);
    const line = doc.line(m.line);
    if (line.text !== m.text) return schedule(0);
    const text = m.text.slice(m.from, m.to);
    const insert = text.toLowerCase() === m.name.toLowerCase() ? `[[${text}]]` : `[[${m.name}|${text}]]`;
    view.dispatch({ changes: { from: line.from + m.from, to: line.from + m.to, insert }, userEvent: "input.link" });
    schedule(0);
  }

  ws.on((change) => {
    if (!active) return;
    if (change === "show") {
      afterPaint(renderLinks);
      if (unlinkedOpen) afterPaint(() => schedule(0));
    } else if (change === "links" || change === "files") {
      renderLinks();
      schedule(DELAY);
    } else if (change === "doc") schedule(DELAY);
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) {
        afterPaint(renderLinks);
        schedule(0);
      } else clearTimeout(timer);
    },
  };
}

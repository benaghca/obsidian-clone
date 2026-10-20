// Outgoing links view for the right sidebar: the notes the open note links
// to, with how many times, and its unresolved links faded below them, like
// Obsidian's. Read from the note's text after a switch has painted and after
// the link index refreshes (a second after a save), never on a keystroke.

import { noteName, type Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { wikilinkTargets } from "./linksTags";
import { afterPaint, type SideView } from "./outlineView";

export function createOutgoingView(ws: Workspace): SideView {
  const count = h("div", { class: "tree-item-flair" });
  const chevron = h("div", { class: "tree-item-icon collapse-icon" }, icon("chevron-down", 14));
  const body = h("div", { class: "search-result-container" });
  const header = h(
    "div",
    {
      class: "tree-item-self backlink-header",
      onclick: () => {
        body.hidden = !body.hidden;
        chevron.classList.toggle("is-collapsed", body.hidden);
      },
    },
    chevron,
    h("div", { class: "tree-item-inner" }, "Links"),
    count,
  );
  const el = h("div", { class: "backlink-pane outgoing-link-pane" }, h("div", { class: "backlink-section" }, header, body));

  let active = false;
  let shown = "";

  function refresh() {
    if (!active) return;
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
    const links = [...counts.values()].filter((c) => c.path).sort(byName);
    const unresolved = [...counts.values()].filter((c) => !c.path).sort(byName);
    // Same list as last time: leave the DOM (and its scroll) alone.
    const key = `${path}\n${[...links, ...unresolved].map((c) => `${c.path ?? "?"}:${c.name}:${c.n}`).join("\n")}`;
    if (key === shown) return;
    shown = key;
    body.replaceChildren(
      ...[...links, ...unresolved].map((c) =>
        h(
          "div",
          {
            class: `tree-item-self outgoing-link-item${c.path ? "" : " is-unresolved"}`,
            title: c.path ?? `${c.name} (not created yet)`,
            onclick: (e: MouseEvent) => {
              const newTab = e.ctrlKey || e.metaKey;
              if (c.path) void ws.open(c.path, { newTab });
              else void ws.openLink(c.name, newTab);
            },
          },
          h("div", { class: "tree-item-icon" }, icon(c.path ? "file-text" : "file", 16)),
          h("div", { class: "tree-item-inner" }, c.name),
          h("div", { class: "tree-item-flair" }, String(c.n)),
        ),
      ),
    );
    if (!path) body.append(h("div", { class: "search-empty-state" }, "No file is open."));
    else if (!targets.length) body.append(h("div", { class: "search-empty-state" }, "No outgoing links."));
    count.textContent = links.length + unresolved.length ? String(links.length + unresolved.length) : "";
  }

  ws.on((change) => {
    if (!active) return;
    if (change === "show") afterPaint(refresh);
    else if (change === "links" || change === "files") refresh();
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) afterPaint(refresh);
    },
  };
}

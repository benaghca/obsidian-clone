// Obsidian's Properties view core plugin, in the right sidebar. All
// properties: every property name in the vault with its type's icon and how
// many notes have it. Sorted as Obsidian's sort menu offers (by frequency by
// default), with a filter field behind its search button. A click searches
// for the name ([name]); right-click offers Rename (in place, as Obsidian
// renames it), Property type and Delete property, the two that rewrite
// every note having it. It reads the properties index (propertyIndex.ts)
// only while shown: when a vault change settles, and a moment after the
// open note's frontmatter changes. File properties: the open note's
// properties, editable, as its Properties block shows them.

import type { EditorView } from "@codemirror/view";
import { frontmatterField, readFrontmatter, removeProperty, renameKey } from "../editor/frontmatter";
import { propertyRows } from "../editor/properties";
import { TYPE_ICONS, typeItems } from "../editor/propertyFields";
import { compareNames } from "../paths";
import { settings } from "../settings/store";
import { readStored, store } from "../storage";
import type { Workspace } from "../workspace";
import { editInPlace, h, iconButton } from "./dom";
import { icon } from "./icons";
import { SEPARATOR, showMenu } from "./menu";
import { type PropertyName, propertyIndex } from "./propertyIndex";
import { liveData, type SideView } from "./sideView";

const DELAY = 300;
const SORT_KEY = "grove.properties.sort";

const SORTS = [
  ["name", "Property name (A to Z)"],
  ["nameReverse", "Property name (Z to A)"],
  ["frequency", "Frequency (high to low)"],
  ["frequencyReverse", "Frequency (low to high)"],
] as const;
type Sort = (typeof SORTS)[number][0];

const compare: Record<Sort, (a: PropertyName, b: PropertyName) => number> = {
  name: (a, b) => compareNames(a.key, b.key),
  nameReverse: (a, b) => compareNames(b.key, a.key),
  frequency: (a, b) => b.count - a.count || compareNames(a.key, b.key),
  frequencyReverse: (a, b) => a.count - b.count || compareNames(a.key, b.key),
};

/**
 * Rename a property (`to`) or delete it (null) in every note that has it,
 * through the notes' editors, so each is saved like any edit. A note whose
 * frontmatter Grove can't read line by line, or that already has a property
 * called `to`, is left as it is.
 */
async function rewriteProperty(ws: Workspace, key: string, to: string | null) {
  for (const [path, note] of await propertyIndex(ws).notes()) {
    if (!note.props.some((p) => p.key === key) || !(await ws.editors.load(path))) continue;
    const fm = readFrontmatter(ws.editors.doc(path)!);
    const p = fm?.props?.find((q) => q.key === key);
    if (!fm || !p || (to !== null && fm.props!.some((q) => q.key === to))) continue;
    ws.editors.change(path, { changes: to === null ? removeProperty(fm, p) : renameKey(fm, p, to), userEvent: "input.property" });
  }
}

export function createPropertiesView(ws: Workspace, searchFor: (query: string) => void): SideView {
  const saved = readStored(SORT_KEY);
  let sort: Sort = SORTS.some(([s]) => s === saved) ? (saved as Sort) : "frequency";
  const list = h("div", { class: "tag-container" });
  const empty = h("div", { class: "pane-empty" }, "No properties found.");
  const filter = h("input", { class: "search-input", type: "search", placeholder: "Search...", "aria-label": "Search properties" });
  const filterBox = h("div", { class: "search-input-container" }, filter);
  filterBox.hidden = true;
  const sortButton = iconButton(icon("arrow-up-narrow-wide"), "Change sort order", () =>
    showMenu(
      SORTS.flatMap(([s, title], i) => [i === 2 ? SEPARATOR : null, { title, checked: s === sort, action: () => setSort(s) }]),
      sortButton,
    ),
  );
  const filterButton = iconButton(icon("search"), "Show search filter", () => {
    filterBox.hidden = !filterBox.hidden;
    filterButton.classList.toggle("is-active", !filterBox.hidden);
    if (filterBox.hidden) filter.value = "";
    else filter.focus();
    render();
  });
  const el = h(
    "div",
    { class: "backlink-pane tag-pane all-properties" },
    h("div", { class: "nav-header" }, h("div", { class: "nav-buttons-container" }, sortButton, filterButton)),
    filterBox,
    list,
    empty,
  );

  const names = liveData<PropertyName[]>([], () => propertyIndex(ws).names(), render, "properties");
  let shown = "";
  let lastFm: unknown = null;

  function setSort(next: Sort) {
    sort = next;
    store(SORT_KEY, sort);
    render();
  }

  function render() {
    const words = filter.value.trim().toLowerCase();
    const rows = names.data.filter((n) => !words || n.key.toLowerCase().includes(words)).sort(compare[sort]);
    const key = JSON.stringify(rows.map((n) => [n.key, n.type, n.count]));
    if (key === shown) return;
    shown = key;
    list.replaceChildren(
      ...rows.map((n) => {
        const name = h("div", { class: "tree-item-inner" }, n.key);
        const rename = () =>
          editInPlace(name, (text) => {
            const to = text.trim();
            if (to && to !== n.key) void rewriteProperty(ws, n.key, to).catch((err) => console.warn(`Could not rename ${n.key}`, err));
          });
        return h(
          "div",
          { class: "tree-item" },
          h(
            "div",
            {
              class: "tree-item-self tag-pane-tag",
              onclick: () => !name.isContentEditable && searchFor(`["${n.key}"]`),
              oncontextmenu: (e: MouseEvent) => {
                e.preventDefault();
                showMenu(
                  [
                    { title: "Rename", icon: "pen-line", action: rename },
                    { title: "Property type", icon: "menu", submenu: () => typeItems(n.key, n.inferred, ws.propertyHost) },
                    SEPARATOR,
                    { title: "Delete property", icon: "trash-2", danger: true, action: () => void rewriteProperty(ws, n.key, null).catch((err) => console.warn(`Could not delete ${n.key}`, err)) },
                  ],
                  { x: e.clientX, y: e.clientY },
                );
              },
            },
            h("div", { class: "tree-item-icon" }, icon(TYPE_ICONS[n.type])),
            name,
            h("div", { class: "tree-item-flair" }, n.count.toLocaleString()),
          ),
        );
      }),
    );
    empty.hidden = rows.length > 0;
  }

  filter.addEventListener("input", render);
  ws.on((change) => {
    if (change === "doc" || change === "show") {
      // Only the open note's frontmatter can have changed: nothing to do while typing in its body.
      const fm = ws.active.path ? ws.view.state.field(frontmatterField, false) : null;
      if (fm === lastFm) return;
      lastFm = fm;
    } else if (change !== "links" && change !== "files") return;
    names.changed(DELAY);
  });
  settings.on((file) => {
    if (file === "types.json" || file === null) names.changed(0);
  });

  return { el, setActive: (next) => void names.setActive(next, 0) };
}

/** File properties: the open note's properties, as its Properties block shows them, without the heading. */
export function createFilePropertiesView(ws: Workspace): SideView {
  const el = h("div", { class: "file-properties" });
  let active = false;
  let shown: { path: string; view: EditorView; fm: unknown; rows: ReturnType<typeof propertyRows> } | null = null;
  function update() {
    if (!active) return;
    const path = ws.active.path;
    const view = ws.view;
    const fm = path ? view.state.field(frontmatterField, false) : null;
    if (!path) {
      shown = null;
      el.replaceChildren();
    } else if (shown?.path !== path || shown.view !== view) {
      shown = { path, view, fm, rows: propertyRows(view) };
      el.replaceChildren(shown.rows.el);
    } else if (shown.fm !== fm) {
      // Only when its frontmatter changed: nothing to do while typing in the body.
      shown.fm = fm;
      shown.rows.render();
    }
  }
  ws.on((change) => (change === "doc" || change === "show") && update());
  settings.on((file) => file === "types.json" && shown?.rows.render());
  return {
    el,
    setActive(next) {
      active = next;
      shown = null;
      update();
    },
  };
}

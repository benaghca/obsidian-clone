// All properties (Obsidian's Properties view core plugin): every property
// name in the vault with its type's icon and how many notes have it, in the
// right sidebar. Sorted as Obsidian's sort menu offers (by frequency by
// default), with a filter field behind its search button. A click searches
// for the name ([name]); right-click offers its Property type. It reads the
// properties index (propertyIndex.ts) only while shown: when a vault change
// settles, and a moment after the open note's frontmatter changes.

import { frontmatterField } from "../editor/frontmatter";
import { TYPE_ICONS, typeItems } from "../editor/propertyFields";
import { compareNames } from "../paths";
import { settings } from "../settings/store";
import { readStored, store } from "../storage";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import { SEPARATOR, showMenu } from "./menu";
import { type PropertyName, propertyIndex } from "./propertyIndex";
import type { SideView } from "./sideView";

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

export function createPropertiesView(ws: Workspace, searchFor: (query: string) => void): SideView {
  const saved = readStored(SORT_KEY);
  let sort: Sort = SORTS.some(([s]) => s === saved) ? (saved as Sort) : "frequency";
  const list = h("div", { class: "tag-container" });
  const empty = h("div", { class: "pane-empty" }, "No properties found.");
  const filter = h("input", { class: "search-input", "aria-label": "Search properties" });
  filter.type = "search";
  filter.placeholder = "Search...";
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

  let active = false;
  let stale = true;
  let timer = 0;
  let seq = 0;
  let names: PropertyName[] = [];
  let shown = "";
  let lastFm: unknown = null;

  function setSort(next: Sort) {
    sort = next;
    store(SORT_KEY, sort);
    render();
  }

  async function refresh() {
    const mine = ++seq;
    try {
      const found = await propertyIndex(ws).names();
      if (mine !== seq) return;
      names = found;
    } catch (err) {
      console.error("Could not read properties", err);
    }
    if (mine !== seq || !active) return;
    stale = false;
    render();
  }

  function render() {
    const words = filter.value.trim().toLowerCase();
    const rows = names.filter((n) => !words || n.key.toLowerCase().includes(words)).sort(compare[sort]);
    const key = JSON.stringify(rows.map((n) => [n.key, n.type, n.count]));
    if (key === shown) return;
    shown = key;
    list.replaceChildren(
      ...rows.map((n) =>
        h(
          "div",
          { class: "tree-item" },
          h(
            "div",
            {
              class: "tree-item-self tag-pane-tag",
              onclick: () => searchFor(`["${n.key}"]`),
              oncontextmenu: (e: MouseEvent) => {
                e.preventDefault();
                showMenu([{ title: "Property type", icon: "list", submenu: () => typeItems(n.key, n.inferred, ws.propertyHost) }], { x: e.clientX, y: e.clientY });
              },
            },
            h("div", { class: "tree-item-icon" }, icon(TYPE_ICONS[n.type])),
            h("div", { class: "tree-item-inner" }, n.key),
            h("div", { class: "tree-item-flair" }, n.count.toLocaleString()),
          ),
        ),
      ),
    );
    empty.hidden = rows.length > 0;
  }

  function schedule(delay = DELAY) {
    clearTimeout(timer);
    if (active) timer = window.setTimeout(() => void refresh(), delay);
  }

  filter.addEventListener("input", render);
  ws.on((change) => {
    if (change === "doc" || change === "show") {
      // Only the open note's frontmatter can have changed: nothing to do while typing in its body.
      const fm = ws.active.path ? ws.view.state.field(frontmatterField, false) : null;
      if (fm === lastFm) return;
      lastFm = fm;
    } else if (change !== "links" && change !== "files") return;
    stale = true;
    schedule();
  });
  settings.on((file) => {
    if (file === "types.json" || file === null) schedule(0);
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active && stale) schedule(0);
      else if (!active) clearTimeout(timer);
    },
  };
}

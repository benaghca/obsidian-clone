// The graph's floating settings panel, laid out like Obsidian's (observed in
// 1.14.4): a 240px card in the top-right corner of the graph with four
// collapsible sections, Filters, Groups, Display and Forces. Its header has
// Restore default settings and Close; once closed, only a gear (open) and a
// wand (start the timelapse animation) remain. Every control applies as it
// moves; the values are saved in .grove/graph.json through the settings
// store. The open sections and whether the panel is open are saved too.

import { button, slider, toggle } from "../settings/controls";
import type { ColorGroup, GraphSettings } from "../settings/schema";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";

export interface PanelHost {
  local: boolean;
  get(): GraphSettings;
  set<K extends keyof GraphSettings & string>(key: K, value: GraphSettings[K]): void;
  reset(): void;
  animate(): void;
}

type SectionKey = "collapse-filter" | "collapse-color-groups" | "collapse-display" | "collapse-forces";

/** Colours offered for a new group, in turn (Obsidian picks one at random). */
const GROUP_COLORS = [0xe05252, 0xe0ac00, 0x08b94e, 0x086ddd, 0x7852ee, 0xd53984, 0x00bfbc, 0xe9973f];

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, "0")}`;

export function createGraphPanel(host: PanelHost): { el: HTMLElement; sync(): void } {
  const el = h("div", { class: "graph-controls" });
  const cfg = () => host.get();

  const controlButton = (cls: string, name: IconName, label: string, onClick: () => void) => {
    const b = h("div", { class: `clickable-icon graph-controls-button ${cls}`, "aria-label": label, title: label, role: "button" }, icon(name, 16));
    b.tabIndex = 0;
    b.addEventListener("click", onClick);
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    });
    return b;
  };

  const setClosed = (closed: boolean) => {
    el.classList.toggle("is-close", closed);
    host.set("close", closed);
  };

  // ----- rows -----

  type ToggleKey = "showTags" | "showAttachments" | "hideUnresolved" | "showOrphans" | "showArrow" | "localBacklinks" | "localForelinks" | "localInterlinks";
  const toggleRow = (key: ToggleKey, name: string, invert = false) => {
    const t = toggle(invert ? !cfg()[key] : cfg()[key], (on) => host.set(key, invert ? !on : on), name);
    syncers.push(() => {
      const on = invert ? !cfg()[key] : cfg()[key];
      t.classList.toggle("is-enabled", on);
      t.setAttribute("aria-checked", String(on));
    });
    return h("div", { class: "setting-item mod-toggle" }, h("div", { class: "setting-item-info" }, h("div", { class: "setting-item-name" }, name)), h("div", { class: "setting-item-control" }, t));
  };

  type SliderKey = "textFadeMultiplier" | "nodeSizeMultiplier" | "lineSizeMultiplier" | "centerStrength" | "repelStrength" | "linkStrength" | "linkDistance" | "localJumps";
  const sliderRow = (key: SliderKey, name: string, min: number, max: number, step: number | "any", digits: number) => {
    const parts = slider({
      min,
      max,
      step,
      value: cfg()[key],
      label: name,
      format: (v) => v.toFixed(digits),
      onInput: (v) => host.set(key, v),
    });
    const input = parts.find((p) => p instanceof HTMLInputElement) as HTMLInputElement;
    syncers.push(() => {
      if (Number(input.value) === cfg()[key]) return;
      input.value = String(cfg()[key]);
      const value = parts.find((p) => p.classList.contains("slider-value"));
      if (value) value.textContent = cfg()[key].toFixed(digits);
      input.style.setProperty("--slider-fill", String((cfg()[key] - min) / (max - min)));
    });
    return h(
      "div",
      { class: "setting-item mod-slider" },
      h("div", { class: "setting-item-info" }, h("div", { class: "setting-item-name" }, name)),
      h("div", { class: "setting-item-control" }, ...parts),
    );
  };

  const syncers: (() => void)[] = [];

  // Filters: a search field (Grove's search syntax), then what to show.
  const search = h("input", { class: "graph-search-input", "aria-label": "Search files" });
  search.spellcheck = false;
  search.type = "search";
  search.placeholder = "Search files...";
  search.value = cfg().search;
  let searchTimer = 0;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => host.set("search", search.value), 250);
  });
  search.addEventListener("keydown", (e) => e.stopPropagation());
  syncers.push(() => {
    if (document.activeElement !== search && search.value !== cfg().search) search.value = cfg().search;
  });

  const filters = [
    h("div", { class: "search-input-container graph-search" }, icon("search", 16), search),
    ...(host.local
      ? [
          sliderRow("localJumps", "Depth", 1, 5, 1, 0),
          toggleRow("localBacklinks", "Incoming links"),
          toggleRow("localForelinks", "Outgoing links"),
          toggleRow("localInterlinks", "Neighbor links"),
        ]
      : []),
    toggleRow("showTags", "Tags"),
    toggleRow("showAttachments", "Attachments"),
    toggleRow("hideUnresolved", "Existing files only"),
    host.local ? null : toggleRow("showOrphans", "Orphans"),
  ];

  // Groups: a query and a colour each; a node takes the colour of the first group it matches.
  const groupList = h("div", { class: "graph-color-groups-container" });
  const setGroups = (groups: ColorGroup[]) => host.set("colorGroups", groups);
  function renderGroups() {
    const groups = cfg().colorGroups;
    groupList.replaceChildren(
      ...groups.map((g, i) => {
        const query = h("input", { class: "graph-color-group-query", "aria-label": "Group query" });
        query.spellcheck = false;
        query.type = "text";
        query.placeholder = "Enter query...";
        query.value = g.query;
        let timer = 0;
        query.addEventListener("input", () => {
          clearTimeout(timer);
          timer = window.setTimeout(() => setGroups(cfg().colorGroups.map((x, j) => (j === i ? { ...x, query: query.value } : x))), 250);
        });
        query.addEventListener("keydown", (e) => e.stopPropagation());
        const color = h("input", { class: "graph-color-group-color", "aria-label": "Click to change color" });
        color.type = "color";
        color.value = hex(g.color.rgb);
        color.addEventListener("input", () =>
          setGroups(cfg().colorGroups.map((x, j) => (j === i ? { ...x, color: { a: 1, rgb: parseInt(color.value.slice(1), 16) } } : x))),
        );
        const remove = controlButton("graph-color-group-remove", "x", "Delete group", () => {
          setGroups(cfg().colorGroups.filter((_, j) => j !== i));
          renderGroups();
        });
        return h("div", { class: "graph-color-group" }, query, color, remove);
      }),
    );
  }
  renderGroups();
  let shownGroups = JSON.stringify(cfg().colorGroups);
  syncers.push(() => {
    const now = JSON.stringify(cfg().colorGroups);
    if (now === shownGroups) return;
    shownGroups = now;
    if (!groupList.contains(document.activeElement)) renderGroups();
  });
  const newGroup = button("New group", () => {
    const groups = cfg().colorGroups;
    setGroups([...groups, { query: "", color: { a: 1, rgb: GROUP_COLORS[groups.length % GROUP_COLORS.length] } }]);
    renderGroups();
    groupList.querySelector<HTMLInputElement>(".graph-color-group:last-child .graph-color-group-query")?.focus();
  });
  newGroup.classList.add("graph-color-button-container");

  // Display
  const animateButton = button("Animate", () => host.animate());
  const display = [
    toggleRow("showArrow", "Arrows"),
    sliderRow("textFadeMultiplier", "Text fade threshold", -3, 3, 0.1, 2),
    sliderRow("nodeSizeMultiplier", "Node size", 0.1, 5, "any", 2),
    sliderRow("lineSizeMultiplier", "Link thickness", 0.1, 5, "any", 2),
    h("div", { class: "setting-item mod-cta" }, h("div", { class: "setting-item-control" }, animateButton)),
  ];

  // Forces
  const forces = [
    sliderRow("centerStrength", "Center force", 0, 1, "any", 2),
    sliderRow("repelStrength", "Repel force", 0, 20, "any", 2),
    sliderRow("linkStrength", "Link force", 0, 1, "any", 2),
    sliderRow("linkDistance", "Link distance", 30, 500, 1, 0),
  ];

  const sections: [SectionKey, string, string, (HTMLElement | null)[]][] = [
    ["collapse-filter", "mod-filter", "Filters", filters],
    ["collapse-color-groups", "mod-color-groups", "Groups", [groupList, newGroup]],
    ["collapse-display", "mod-display", "Display", display],
    ["collapse-forces", "mod-forces", "Forces", forces],
  ];
  const sectionEls = sections.map(([key, cls, title, rows]) => {
    const chevron = h("div", { class: "tree-item-icon collapse-icon" }, icon("chevron-down", 16));
    const children = h("div", { class: "tree-item-children" }, ...rows);
    const self = h("div", { class: "tree-item-self mod-collapsible", role: "button", "aria-label": title }, chevron, h("div", { class: "tree-item-inner" }, title));
    self.tabIndex = 0;
    const section = h("div", { class: `tree-item graph-control-section ${cls}` }, self, children);
    const show = (collapsed: boolean) => {
      section.classList.toggle("is-collapsed", collapsed);
      chevron.classList.toggle("is-collapsed", collapsed);
      children.hidden = collapsed;
      self.setAttribute("aria-expanded", String(!collapsed));
    };
    show(cfg()[key]);
    const flip = () => {
      const collapsed = !section.classList.contains("is-collapsed");
      show(collapsed);
      host.set(key, collapsed);
    };
    self.addEventListener("click", flip);
    self.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      }
    });
    return section;
  });

  el.append(
    controlButton("mod-close", "x", "Close", () => setClosed(true)),
    controlButton("mod-open", "settings", "Open graph settings", () => setClosed(false)),
    controlButton("mod-animate", "wand-sparkles", "Start timelapse animation", () => host.animate()),
    controlButton("mod-reset", "rotate-ccw", "Restore default settings", () => host.reset()),
    ...sectionEls,
  );
  el.classList.toggle("is-close", cfg().close);
  // Presses in the panel are its own, not the graph's (no pan or hover behind it).
  for (const type of ["pointerdown", "wheel", "contextmenu"] as const) el.addEventListener(type, (e) => e.stopPropagation());

  return {
    el,
    sync() {
      for (const fn of syncers) fn();
    },
  };
}

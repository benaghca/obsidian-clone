// The graph's floating settings panel, laid out like Obsidian's (observed in
// 1.14.4): a 240px card in the top-right corner of the graph with four
// collapsible sections, Filters, Groups, Display and Forces. Its header has
// Restore default settings and Close; once closed, only a gear (open) and a
// wand (start the timelapse animation) remain. Every control applies as it
// moves; the values are saved in .grove/graph.json through the settings
// store. The open sections and whether the panel is open are saved too.

import { button, row, setToggle, slider, toggle } from "../settings/controls";
import type { ColorGroup, GraphSettings } from "../settings/schema";
import { h, keyButton, pressable } from "../shell/dom";
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

/** The panel's shadow is drawn this far around it (px). */
const SHADOW = 64;
const shadowImages = new Map<string, string>();

/**
 * Obsidian's three-layer panel shadow, drawn once into an image and shown
 * as a nine-slice border image behind the panel. A CSS box-shadow with a
 * 30px blur is painted again with every frame of anything else on the page
 * in WebKitGTK (measured: 7ms of each editor frame in the next pane); an
 * image costs about 1ms.
 */
function shadowImage(dark: boolean, dpr: number): string {
  const key = `${dark}:${dpr}`;
  let url = shadowImages.get(key);
  if (url) return url;
  const k = SHADOW;
  const c = document.createElement("canvas");
  c.width = c.height = 3 * k * dpr;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const far = 3 * k * 4; // the box itself is drawn off the image; only its shadow lands on it
  const layers: [number, number, number][] = dark
    ? [[2, 1, 0.121], [6.7, 3.4, 0.179], [30, 15, 0.3]]
    : [[2, 1, 0.027], [6.7, 3.4, 0.043], [30, 15, 0.07]];
  for (const [blur, y, alpha] of layers) {
    g.save();
    g.shadowColor = `rgba(0, 0, 0, ${alpha})`;
    g.shadowBlur = blur;
    g.shadowOffsetX = far;
    g.shadowOffsetY = y;
    g.beginPath();
    g.roundRect(k - far, k, k, k, 8);
    g.fill();
    g.restore();
  }
  url = c.toDataURL();
  shadowImages.set(key, url);
  return url;
}

export function createGraphPanel(host: PanelHost): { el: HTMLElement; shadow: HTMLElement; sync(): void; restyle(): void } {
  const el = h("div", { class: "graph-controls" });
  const cfg = () => host.get();

  const controlButton = (cls: string, name: IconName, label: string, onClick: () => void) =>
    keyButton(icon(name, 16), label, onClick, `graph-controls-button ${cls}`);

  const shadow = h("div", { class: "graph-controls-shadow" });
  const restyle = () => {
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    shadow.style.borderImage = `url(${shadowImage(document.documentElement.classList.contains("theme-dark"), dpr)}) ${SHADOW * dpr} / ${SHADOW}px`;
  };
  restyle();
  new ResizeObserver(() => {
    shadow.hidden = el.classList.contains("is-close");
    shadow.style.width = `${el.offsetWidth}px`;
    shadow.style.height = `${el.offsetHeight}px`;
  }).observe(el);

  const setClosed = (closed: boolean) => {
    el.classList.toggle("is-close", closed);
    shadow.hidden = closed;
    host.set("close", closed);
  };

  // ----- rows -----

  type ToggleKey = "showTags" | "showAttachments" | "hideUnresolved" | "showOrphans" | "showArrow" | "localBacklinks" | "localForelinks" | "localInterlinks";
  const toggleRow = (key: ToggleKey, name: string, invert = false) => {
    const t = toggle(invert ? !cfg()[key] : cfg()[key], (on) => host.set(key, invert ? !on : on), name);
    syncers.push(() => setToggle(t, invert ? !cfg()[key] : cfg()[key]));
    return row({ name, cls: "mod-toggle" }, t);
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
    return row({ name, cls: "mod-slider" }, ...parts);
  };

  const syncers: (() => void)[] = [];

  // Filters: a search field (Grove's search syntax), then what to show.
  const search = h("input", { class: "graph-search-input", type: "search", value: cfg().search, placeholder: "Search files...", spellcheck: "false", "aria-label": "Search files" });
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
        const query = h("input", { class: "graph-color-group-query", type: "text", value: g.query, placeholder: "Enter query...", spellcheck: "false", "aria-label": "Group query" });
        let timer = 0;
        query.addEventListener("input", () => {
          clearTimeout(timer);
          timer = window.setTimeout(() => setGroups(cfg().colorGroups.map((x, j) => (j === i ? { ...x, query: query.value } : x))), 250);
        });
        query.addEventListener("keydown", (e) => e.stopPropagation());
        const color = h("input", { class: "graph-color-group-color", type: "color", value: hex(g.color.rgb), "aria-label": "Click to change color" });
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
    const section = h("div", { class: `tree-item graph-control-section ${cls}` }, self, children);
    const show = (collapsed: boolean) => {
      section.classList.toggle("is-collapsed", collapsed);
      chevron.classList.toggle("is-collapsed", collapsed);
      children.hidden = collapsed;
      self.setAttribute("aria-expanded", String(!collapsed));
    };
    show(cfg()[key]);
    pressable(self, () => {
      const collapsed = !section.classList.contains("is-collapsed");
      show(collapsed);
      host.set(key, collapsed);
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
  shadow.hidden = cfg().close;
  // Presses in the panel are its own, not the graph's (no pan or hover behind it).
  for (const type of ["pointerdown", "wheel", "contextmenu"] as const) el.addEventListener(type, (e) => e.stopPropagation());

  return {
    el,
    shadow,
    restyle,
    sync() {
      for (const fn of syncers) fn();
    },
  };
}

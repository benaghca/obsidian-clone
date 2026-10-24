// The settings modal, laid out like Obsidian 1.14's settings: a large
// centred modal with a navigation column on the left (a search field, then
// "Options" and "Core plugins" with an icon per section) and the selected
// section on the right, in cards. Opening builds only the frame and the
// selected section; other sections are built the first time they are shown
// (or searched), so opening and switching each fit in a frame. The last
// section shown is remembered while the app runs.

import { kept } from "../memo";
import { animateOut } from "../motion";
import { h, keyButton } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";

export interface SettingsSection {
  id: string;
  name: string;
  icon: IconName;
  /** "options" sections first, then the core plugins that have options. */
  group: "options" | "plugins";
  /** Whether the section is listed now (a core plugin's page only while it is on). */
  shown?(): boolean;
  /** Left out of the settings search (Hotkeys, which has its own filter). */
  unsearchable?: boolean;
  build(): HTMLElement | HTMLElement[];
}

let lastSection = "general";
let session = 0;

/** Counts openings, so a page built in an earlier opening can tell it is stale. */
export const settingsSession = () => session;
let current: { close(): void; show(id: string): void; refreshNav(): void } | null = null;

/** Whether the settings modal is open (the app's hotkeys stand aside meanwhile). */
export const isSettingsOpen = () => current !== null;

/** Re-list the sections (a core plugin was turned on or off, so its page comes or goes). */
export function refreshSettingsNav() {
  current?.refreshNav();
}

/** Open settings at a section (the last one shown, by default), or switch to it if open. */
export function openSettings(sections: SettingsSection[], id?: string, onClose?: () => void) {
  if (current) {
    if (id) current.show(id);
    return;
  }
  session++;
  const restoreFocus = document.activeElement as HTMLElement | null;
  let listed = sections.filter((s) => s.shown?.() ?? true);
  const built = new Map<string, HTMLElement>();
  const navItems = new Map<string, HTMLElement>();
  const content = h("div", { class: "vertical-tab-content" });
  const contentContainer = h("div", { class: "vertical-tab-content-container" }, content);
  let selected = "";

  const sectionEl = (s: SettingsSection) => kept(built, s.id, () => h("div", { class: "setting-section", "data-section": s.id }, ...[s.build()].flat()));

  function show(sectionId: string) {
    const s = listed.find((x) => x.id === sectionId) ?? listed[0];
    if (search.value) clearSearch();
    if (s.id === selected) return;
    selected = s.id;
    lastSection = s.id;
    for (const [sid, item] of navItems) {
      item.classList.toggle("is-active", sid === s.id);
      item.setAttribute("aria-selected", String(sid === s.id));
    }
    content.replaceChildren(sectionEl(s));
    contentContainer.scrollTop = 0;
  }

  // ----- search: every section's rows, filtered by name and description -----
  const search = h("input", { class: "setting-search-input", type: "search", placeholder: "Search settings...", spellcheck: "false", "aria-label": "Search settings" });
  const emptyResult = h("div", { class: "setting-search-empty" }, "No settings match.");

  function runSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) return clearSearch(true);
    content.replaceChildren();
    let any = false;
    for (const s of listed) {
      if (s.unsearchable) continue;
      const el = sectionEl(s);
      let hits = 0;
      for (const group of el.querySelectorAll<HTMLElement>(".setting-group")) {
        let groupHits = 0;
        for (const r of group.querySelectorAll<HTMLElement>(".setting-items > .setting-item")) {
          // A row that only shows in some states (a custom format, a folder
          // field) isn't a match while it is hidden.
          const text = (r.querySelector(".setting-item-info")?.textContent ?? "").toLowerCase();
          const match = !r.hidden && (text.includes(q) || s.name.toLowerCase().includes(q));
          r.classList.toggle("is-search-hidden", !match);
          if (match) groupHits++;
        }
        group.classList.toggle("is-search-hidden", groupHits === 0);
        hits += groupHits;
      }
      if (!hits) continue;
      any = true;
      content.append(h("div", { class: "setting-search-section-title" }, s.name), el);
    }
    if (!any) content.append(emptyResult);
    for (const item of navItems.values()) item.classList.remove("is-active");
    contentContainer.scrollTop = 0;
  }

  function clearSearch(reshow = false) {
    search.value = "";
    for (const el of built.values()) for (const hidden of el.querySelectorAll(".is-search-hidden")) hidden.classList.remove("is-search-hidden");
    if (reshow) {
      const id = selected;
      selected = "";
      show(id);
    }
  }
  search.addEventListener("input", runSearch);

  // ----- navigation -----
  const navGroup = (title: string, group: SettingsSection["group"]) => {
    const items = listed.filter((s) => s.group === group);
    if (!items.length) return null;
    return h(
      "div",
      { class: "vertical-tab-header-group" },
      h("div", { class: "vertical-tab-header-group-title" }, title),
      h(
        "div",
        { class: "vertical-tab-header-group-items", role: "tablist", "aria-label": title },
        ...items.map((s) => {
          const item = h(
            "div",
            { class: "vertical-tab-nav-item", role: "tab", "data-setting-id": s.id },
            h("div", { class: "vertical-tab-nav-item-icon" }, icon(s.icon, 16)),
            h("div", { class: "vertical-tab-nav-item-title" }, s.name),
          );
          item.tabIndex = 0;
          item.addEventListener("click", () => show(s.id));
          navItems.set(s.id, item);
          return item;
        }),
      ),
    );
  };
  const navGroups = h("div", { class: "vertical-tab-header-group-container" });
  function renderNav() {
    navItems.clear();
    navGroups.replaceChildren(...([navGroup("Options", "options"), navGroup("Core plugins", "plugins")].filter(Boolean) as HTMLElement[]));
    for (const [sid, item] of navItems) {
      item.classList.toggle("is-active", sid === selected && !search.value);
      item.setAttribute("aria-selected", String(sid === selected));
    }
  }
  renderNav();
  const nav = h(
    "div",
    { class: "vertical-tab-header" },
    h("div", { class: "setting-search-container" }, h("div", { class: "search-input-container" }, icon("search", 16), search)),
    navGroups,
  );
  // Up/down move between sections, Enter or Space opens one (Tab moves through them too).
  nav.addEventListener("keydown", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".vertical-tab-nav-item");
    if (!item) return;
    const all = [...navItems.values()];
    const i = all.indexOf(item);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length];
      next.focus();
      show(next.dataset.settingId!);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show(item.dataset.settingId!);
    }
  });

  const closeButton = keyButton(icon("x", 16), "Close", () => close(), "modal-close-button");
  const modal = h(
    "div",
    { class: "modal mod-settings", role: "dialog", "aria-modal": "true", "aria-label": "Settings" },
    closeButton,
    h("div", { class: "modal-content vertical-tabs-container" }, nav, contentContainer),
  );
  const overlay = h("div", { class: "modal-container mod-dim mod-settings-container" }, h("div", { class: "modal-bg", onclick: () => close() }), modal);

  // Escape closes (a control that is capturing keys, like a hotkey being
  // recorded, takes Escape first and stops it). Keys never leak to the app.
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      if (search.value && document.activeElement === search) return clearSearch(true);
      close();
    }
    e.stopPropagation();
  });

  function close() {
    if (current?.close !== close) return;
    current = null;
    // Esc (and the other closes) return to the note. The overlay's removal
    // can drop focus on the way out, so the note is focused again if that happens.
    const refocus = () => (onClose ? onClose() : restoreFocus?.focus());
    void animateOut(overlay).then(() => {
      if (document.activeElement === document.body) refocus();
    });
    refocus();
  }

  current = {
    close,
    show,
    refreshNav() {
      listed = sections.filter((s) => s.shown?.() ?? true);
      renderNav();
    },
  };
  document.body.append(overlay);
  show(id ?? lastSection);
  search.focus({ preventScroll: true });
}

// The one menu component, used for every context menu and dropdown: an icon
// per item, separators between sections, disabled, checked and danger items,
// a right-aligned hotkey hint, and submenus. Like Obsidian's, the menu never
// takes focus: while it is open it owns the keyboard (arrows, Home/End,
// Enter, Escape, ArrowLeft/Right for submenus, type-ahead), and the mouse
// and the keyboard move one shared highlight.
//
// Only the top level is built on open; a submenu is built when it opens.

import { h } from "./dom";
import { icon, type IconName } from "./icons";

export interface MenuEntry {
  title: string;
  content?: HTMLElement;
  icon?: IconName;
  action?: () => void;
  disabled?: boolean;
  checked?: boolean;
  /** Destructive (Delete): red, like Obsidian's. */
  danger?: boolean;
  /** A muted title row that can't be chosen (the graph's node menu names its note). */
  label?: boolean;
  /** Shortcut hint shown on the right, e.g. "Ctrl + B". */
  hotkey?: string;
  submenu?: MenuItems | (() => MenuItems);
}

export const SEPARATOR = "separator" as const;
/** Falsy entries are skipped, so menus can be built with `cond && item`. */
export type MenuItems = (MenuEntry | typeof SEPARATOR | null | undefined | false)[];

/** Where to open: at the pointer (context menu) or under an element (dropdown). */
type MenuAnchor = { x: number; y: number } | HTMLElement;

interface MenuOptions {
  /** Dropdowns: line the menu up with the anchor's left (default) or right edge. */
  align?: "left" | "center" | "right";
  className?: string;
  /** Opened from the keyboard: highlight the first item straight away. */
  keyboard?: boolean;
  /** Open at the pointer even when `at` is the button that toggles the menu. */
  point?: { x: number; y: number };
  /** A row that keeps an outline while this menu is open. */
  highlight?: HTMLElement;
}

const SUBMENU_DELAY = 150;
const EDGE = 8;

let root: Menu | null = null;
let anchorEl: HTMLElement | null = null;
let highlightEl: HTMLElement | null = null;

/** Drop separators at the ends and doubled ones, and the falsy entries. */
export function tidy(items: MenuItems): (MenuEntry | typeof SEPARATOR)[] {
  const out: (MenuEntry | typeof SEPARATOR)[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item === SEPARATOR && (out.length === 0 || out[out.length - 1] === SEPARATOR)) continue;
    out.push(item);
  }
  if (out[out.length - 1] === SEPARATOR) out.pop();
  return out;
}

const selectable = (item: MenuEntry | typeof SEPARATOR | undefined): item is MenuEntry =>
  !!item && item !== SEPARATOR && !item.disabled && !item.label;

class Menu {
  readonly el: HTMLElement;
  readonly items: (MenuEntry | typeof SEPARATOR)[];
  private rows: (HTMLElement | null)[] = [];
  selected = -1;
  child: Menu | null = null;
  private childIndex = -1;
  private timer = 0;

  constructor(
    items: MenuItems,
    readonly parent: Menu | null,
  ) {
    this.items = tidy(items);
    const withIcons = this.items.some((item) => item !== SEPARATOR && item.icon);
    this.el = h("div", { class: `menu${parent ? " mod-submenu" : ""}`, role: "menu" });
    this.rows = this.items.map((item, i) => {
      if (item === SEPARATOR) {
        this.el.append(h("div", { class: "menu-separator", role: "separator" }));
        return null;
      }
      const row = this.row(item, i, withIcons);
      this.el.append(row);
      return row;
    });
    this.el.addEventListener("mouseleave", () => {
      if (!this.child) this.select(-1);
      clearTimeout(this.timer);
    });
    // The menu never takes focus, so a press inside it must not move focus either.
    this.el.addEventListener("mousedown", e => { if (!(e.target as Element).closest("input")) e.preventDefault(); });
  }

  private row(item: MenuEntry, i: number, withIcons: boolean) {
    const cls = ["menu-item", item.disabled && "is-disabled", item.danger && "is-warning", item.label && "is-label", item.checked && "is-checked", item.submenu && "has-submenu"];
    const row = h(
      "div",
      { class: cls.filter(Boolean).join(" "), role: "menuitem", "aria-disabled": item.disabled ? "true" : undefined },
      withIcons ? h("div", { class: "menu-item-icon" }, item.icon ? icon(item.icon, 16) : null) : null,
      h("div", { class: "menu-item-title" }, item.title),
      item.hotkey ? h("div", { class: "menu-item-hotkey" }, item.hotkey) : null,
      item.checked ? h("div", { class: "menu-item-icon mod-checked" }, icon("check", 16)) : null,
      item.submenu ? h("div", { class: "menu-item-icon mod-submenu" }, icon("chevron-right", 16)) : null,
    );
    if (item.content) { row.replaceChildren(item.content); row.setAttribute("aria-label", item.title); }
    row.addEventListener("mousemove", () => this.hover(i));
    row.addEventListener("click", e => { if (!(e.target as Element).closest("input")) this.activate(i, false); });
    return row;
  }

  select(i: number) {
    if (i === this.selected) return;
    this.rows[this.selected]?.classList.remove("selected");
    this.selected = i;
    this.rows[i]?.classList.add("selected");
  }

  /** Mouse over an item: highlight it, and open or close submenus after a short delay. */
  private hover(i: number) {
    if (!selectable(this.items[i])) return;
    this.child?.select(-1);
    if (i === this.selected && (this.childIndex === i || !(this.items[i] as MenuEntry).submenu)) return;
    this.select(i);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.selected !== i) return;
      if ((this.items[i] as MenuEntry).submenu) this.openChild(i, false);
      else this.closeChild();
    }, SUBMENU_DELAY);
  }

  move(dir: 1 | -1) {
    const n = this.items.length;
    if (!this.items.some(selectable)) return;
    let i = this.selected;
    if (i < 0) i = dir > 0 ? -1 : n;
    do i = (i + dir + n) % n;
    while (!selectable(this.items[i]));
    this.select(i);
  }

  first() {
    this.select(-1);
    this.move(1);
  }

  last() {
    this.select(-1);
    this.move(-1);
  }

  /** Type-ahead: the next item whose title starts with this letter. */
  jumpTo(letter: string) {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.selected + k + n) % n;
      const item = this.items[i];
      if (selectable(item) && item.title.toLowerCase().startsWith(letter)) return this.select(i);
    }
  }

  activate(i: number, keyboard: boolean) {
    const item = this.items[i];
    if (!selectable(item)) return;
    if (item.submenu) {
      this.select(i);
      this.openChild(i, keyboard);
      return;
    }
    const input = item.content?.querySelector<HTMLInputElement>('input[type="color"]');
    if (input) { input.focus(); input.showPicker(); return; }
    closeMenu();
    item.action?.();
  }

  openChild(i: number, keyboard: boolean) {
    clearTimeout(this.timer);
    const item = this.items[i] as MenuEntry;
    if (this.childIndex === i && this.child) {
      if (keyboard) this.child.first();
      return;
    }
    this.closeChild();
    const items = typeof item.submenu === "function" ? item.submenu() : item.submenu!;
    const child = new Menu(items, this);
    this.child = child;
    this.childIndex = i;
    document.body.append(child.el);
    const row = this.rows[i]!.getBoundingClientRect();
    const own = this.el.getBoundingClientRect();
    const size = child.el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(child.el).paddingTop) + child.el.clientTop;
    let x = own.right - 2;
    if (x + size.width > innerWidth - EDGE) x = Math.max(EDGE, own.left - size.width + 2);
    place(child.el, x, Math.min(row.top - pad, innerHeight - size.height - EDGE));
    if (keyboard) child.first();
  }

  closeChild() {
    if (!this.child) return;
    this.child.closeChild();
    this.child.el.remove();
    this.child = null;
    this.childIndex = -1;
  }

  /** The innermost open menu, which the keyboard drives. */
  deepest(): Menu {
    return this.child ? this.child.deepest() : this;
  }

  contains(node: Node): boolean {
    return this.el.contains(node) || !!this.child?.contains(node);
  }

  close() {
    clearTimeout(this.timer);
    this.closeChild();
    this.el.remove();
  }
}

function place(el: HTMLElement, x: number, y: number) {
  el.style.left = `${Math.round(Math.max(EDGE, x))}px`;
  el.style.top = `${Math.round(Math.max(EDGE, y))}px`;
}

/** Close the open menu and release its input listeners. */
export function closeMenu() {
  highlightEl?.classList.remove("has-active-menu");
  highlightEl = null;
  if (!root) return;
  const focused = root.contains(document.activeElement!);
  root.close();
  root = null;
  if (focused && anchorEl?.isConnected) anchorEl.focus({ preventScroll: true });
  anchorEl?.classList.remove("has-active-menu");
  anchorEl = null;
  window.removeEventListener("keydown", onKey, true);
  document.removeEventListener("pointerdown", onPress, true);
  window.removeEventListener("blur", closeMenu);
  window.removeEventListener("resize", closeMenu);
}

export function isMenuOpen() {
  return root !== null;
}

export function showMenu(items: MenuItems, at: MenuAnchor, opts: MenuOptions = {}) {
  const sameAnchor = at instanceof HTMLElement && at === anchorEl;
  closeMenu();
  // A second click on the button that opened this dropdown just closes it.
  if (sameAnchor) return;
  const menu = new Menu(items, null);
  if (!menu.items.length) return;
  if (opts.className) menu.el.classList.add(opts.className);
  document.body.append(menu.el);
  const size = menu.el.getBoundingClientRect();
  let x: number;
  let y: number;
  const point = opts.point ?? (at instanceof HTMLElement ? null : at);
  if (point) {
    // At the pointer; flipped to the other side of it when there is no room.
    x = point.x;
    y = point.y;
    if (x + size.width > innerWidth - EDGE) x = point.x - size.width;
    if (y + size.height > innerHeight - EDGE) y = point.y - size.height;
  } else {
    const r = (at as HTMLElement).getBoundingClientRect();
    x = opts.align === "right" ? r.right - size.width : opts.align === "center" ? r.left + (r.width - size.width) / 2 : r.left;
    y = r.bottom + 4;
    if (y + size.height > innerHeight - EDGE && r.top - size.height - 4 >= EDGE) y = r.top - size.height - 4;
  }
  if (at instanceof HTMLElement) {
    at.classList.add("has-active-menu");
    anchorEl = at;
  }
  if (opts.highlight) {
    highlightEl = opts.highlight;
    highlightEl.classList.add("has-active-menu");
  }
  place(menu.el, Math.min(x, innerWidth - size.width - EDGE), Math.min(y, innerHeight - size.height - EDGE));
  root = menu;
  if (opts.keyboard) menu.first();
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPress, true);
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
}

// A searchable picker beneath a control inside the root's custom content row.
export const closeMenuChild = () => root?.closeChild();
export function showMenuChild(items: MenuItems, at: HTMLElement, className: string) {
  if(!root||root.items[0]===SEPARATOR||!root.items[0])return;root.items[0].submenu=items;root.closeChild();root.openChild(0,false);delete root.items[0].submenu;const r=at.getBoundingClientRect(), child=root.child!;child.el.classList.add(className);const size=child.el.getBoundingClientRect();place(child.el,Math.min(r.left,innerWidth-size.width-EDGE),Math.min(r.bottom+4,innerHeight-size.height-EDGE));
}

function onPress(e: MouseEvent) {
  const target = e.target as Node;
  if (root?.contains(target)) return;
  // The dropdown's own button toggles it in its click handler.
  if (anchorEl?.contains(target)) return;
  closeMenu();
}

function onKey(e: KeyboardEvent) {
  if (!root) return;
  if (e.target instanceof HTMLInputElement && e.key !== "Escape") return;
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
  e.preventDefault();
  e.stopPropagation();
  const menu = root.deepest();
  switch (e.key) {
    case "ArrowDown":
      return menu.move(1);
    case "ArrowUp":
      return menu.move(-1);
    case "Home":
      return menu.first();
    case "End":
      return menu.last();
    case "ArrowRight": {
      const item = menu.items[menu.selected];
      if (selectable(item) && item.submenu) menu.openChild(menu.selected, true);
      return;
    }
    case "ArrowLeft":
    case "Escape":
      if (menu.parent) menu.parent.closeChild();
      else closeMenu();
      return;
    case "Enter":
    case " ":
      if (menu.selected >= 0) menu.activate(menu.selected, true);
      return;
    case "Tab":
      return;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) menu.jumpTo(e.key.toLowerCase());
  }
}

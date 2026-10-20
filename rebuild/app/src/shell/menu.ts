// Small context/dropdown menu, closed by Escape or any click outside.

import { h } from "./dom";

export interface MenuItem {
  title: string;
  action: () => void;
  danger?: boolean;
  checked?: boolean;
}

let open: HTMLElement | null = null;

export function closeMenu() {
  open?.remove();
  open = null;
}

export function showMenu(items: MenuItem[], x: number, y: number) {
  closeMenu();
  const menu = h(
    "div",
    { class: "menu" },
    ...items.map((item) =>
      h(
        "div",
        {
          class: `menu-item${item.danger ? " is-warning" : ""}${item.checked ? " is-checked" : ""}`,
          onclick: () => {
            closeMenu();
            item.action();
          },
        },
        item.title,
      ),
    ),
  );
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  open = menu;
}

document.addEventListener(
  "mousedown",
  (e) => {
    if (open && !open.contains(e.target as Node)) closeMenu();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (open && e.key === "Escape") closeMenu();
});

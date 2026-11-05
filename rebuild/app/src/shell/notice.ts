// A notice in the window's top right corner: a few lines of plain text that
// go away after a while or when clicked. Notices stack in arrival order.

import { h } from "./dom";

export function notice(lines: string[], ms = 6000): HTMLElement {
  let stack = document.querySelector<HTMLElement>(".notice-container");
  if (!stack) {
    stack = h("div", { class: "notice-container" });
    document.body.append(stack);
  }
  const el = h("div", { class: "notice", role: "status", "aria-live": "polite" }, ...lines.map((line) => h("div", { class: "notice-line" }, line)));
  const close = () => {
    clearTimeout(timer);
    el.remove();
    if (!stack.childElementCount) stack.remove();
  };
  el.addEventListener("click", close);
  const timer = window.setTimeout(close, ms);
  stack.append(el);
  return el;
}

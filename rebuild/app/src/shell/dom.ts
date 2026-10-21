// Tiny DOM helpers for the app chrome.

type Child = Node | string | null | undefined | false;
type Props = {
  class?: string;
  title?: string;
  role?: string;
  tabindex?: string;
  // Fields: set as attributes before anything reads them (a value is the starting value).
  type?: string;
  value?: string;
  placeholder?: string;
  spellcheck?: "false";
  contenteditable?: "plaintext-only";
  id?: string;
  list?: string;
  min?: string;
  max?: string;
  step?: string;
  [attr: `data-${string}`]: string | undefined;
  [attr: `aria-${string}`]: string | undefined;
  [event: `on${string}`]: ((e: any) => void) | undefined;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined) continue;
    if (key === "class") el.className = value as string;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value as EventListener);
    else el.setAttribute(key, value as string);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** A clickable icon button, Obsidian's "clickable-icon". */
export function iconButton(icon: SVGElement, label: string, onClick?: (e: MouseEvent) => void, cls = "") {
  return h("div", { class: `clickable-icon ${cls}`.trim(), "aria-label": label, title: label, onclick: onClick }, icon);
}

/**
 * Follow a drag that a press (`down`) on `el` started: `apply` runs at most
 * once a frame with the latest pointer position, and once more at the end,
 * then `done`. Only what `apply` writes changes on each frame.
 */
export function dragPointer(down: PointerEvent, el: HTMLElement, apply: (e: PointerEvent) => void, done: () => void) {
  try {
    el.setPointerCapture(down.pointerId);
  } catch {
    // not a live pointer (a synthetic event): the moves still reach the element while over it
  }
  let last = down;
  let frame = 0;
  const move = (e: PointerEvent) => {
    last = e;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      apply(last);
    });
  };
  const up = () => {
    cancelAnimationFrame(frame);
    apply(last);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    done();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/** Make an element a keyboard button: in the Tab order, and Enter or Space presses it like a click. */
export function pressable<E extends HTMLElement>(el: E, onPress: (e: MouseEvent | KeyboardEvent) => void): E {
  el.tabIndex = 0;
  el.addEventListener("click", onPress);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPress(e);
    }
  });
  return el;
}

/** An icon button the keyboard can press too (the settings' and the graph panel's small buttons). */
export const keyButton = (icon: SVGElement, label: string, onPress: (e: MouseEvent | KeyboardEvent) => void, cls = "") =>
  pressable(h("div", { class: `clickable-icon ${cls}`.trim(), "aria-label": label, title: label, role: "button" }, icon), onPress);

// Tiny DOM helpers for the app chrome.

type Child = Node | string | null | undefined | false;
// Fields are attributes; value is the starting value, before callers read it.
type Props = Partial<Record<
  "class" | "title" | "role" | "tabindex" | "type" | "value" | "placeholder" |
  "id" | "list" | "min" | "max" | "step" | "alt" | "style", string
>> & {
  spellcheck?: "false";
  contenteditable?: "plaintext-only";
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
  const listening = new AbortController();
  const up = () => {
    cancelAnimationFrame(frame);
    apply(last);
    listening.abort();
    done();
  };
  el.addEventListener("pointermove", move, listening);
  el.addEventListener("pointerup", up, listening);
  el.addEventListener("pointercancel", up, listening);
}

/**
 * Edit `label`'s text where it is, all of it selected (Obsidian's inline
 * rename): Enter or leaving it commits, Escape gives up. The label shows its
 * old text again; `commit` gets what was typed (the old text, given up).
 */
export function editInPlace(label: HTMLElement, commit: (text: string) => void) {
  const shown = label.textContent ?? "";
  label.contentEditable = "plaintext-only";
  label.focus();
  getSelection()?.selectAllChildren(label);
  label.addEventListener(
    "blur",
    () => {
      label.contentEditable = "false";
      const text = label.textContent ?? "";
      label.textContent = shown;
      commit(text);
    },
    { once: true },
  );
  label.onkeydown = (ev) => {
    if (ev.key === "Enter" || ev.key === "Escape") {
      ev.preventDefault();
      label.onkeydown = null;
      if (ev.key === "Escape") label.textContent = shown;
      label.blur();
    }
  };
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

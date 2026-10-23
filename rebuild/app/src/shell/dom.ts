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
export function dragPointer(down: PointerEvent, el: HTMLElement, apply: (e: PointerEvent) => void, done: (cancelled: boolean) => void, capture = true) {
  try {
    if (capture) el.setPointerCapture(down.pointerId);
  } catch {
    // not a live pointer (a synthetic event): the moves still reach the element while over it
  }
  let last = down;
  let frame = 0;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    last = e;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      apply(last);
    });
  };
  const listening = new AbortController();
  const finish = (cancelled: boolean) => {
    if (listening.signal.aborted) return;
    cancelAnimationFrame(frame);
    listening.abort();
    if (!cancelled) apply(last);
    done(cancelled);
  };
  window.addEventListener("pointermove", move, listening);
  window.addEventListener("pointerup", (e) => { if (e.pointerId === down.pointerId) { last = e; finish(false); } }, listening);
  window.addEventListener("pointercancel", (e) => { if (e.pointerId === down.pointerId) finish(true); }, listening);
  window.addEventListener("blur", () => finish(true), listening);
  return () => finish(true);
}

const errorKeys = new WeakMap<HTMLElement, AbortController>();

/** A rename error beneath its field; only a failed rename listens for Escape outside it. */
export function fieldError(field: HTMLElement, message: string, cancel?: () => void) {
  errorKeys.get(field)?.abort();
  errorKeys.delete(field);
  let error = field.nextElementSibling as HTMLElement | null;
  if (!error?.classList.contains("rename-error")) error = null;
  if (message) field.setAttribute("aria-invalid", "true");
  else field.removeAttribute("aria-invalid");
  if (!message) return error?.remove();
  if (!error) field.after(error = h("div", { class: "rename-error", role: "alert" }));
  error.textContent = message;
  if (cancel) {
    const controller = new AbortController();
    errorKeys.set(field, controller);
    document.addEventListener("keydown", (event) => {
      if (!field.isConnected) return fieldError(field, "");
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      fieldError(field, "");
      cancel();
    }, { capture: true, signal: controller.signal });
  }
}

/** Inline rename: Enter or blur commits; an error keeps the draft editable, Escape cancels. */
export function editInPlace(label: HTMLElement, commit: (text: string) => void | Promise<void>) {
  const shown = label.textContent ?? "";
  let pending = false, closed = false;
  label.contentEditable = "plaintext-only";
  label.focus();
  getSelection()?.selectAllChildren(label);
  const clear = () => fieldError(label, "");
  const close = () => {
    closed = true;
    clear();
    label.contentEditable = "false";
    label.textContent = shown;
    label.onkeydown = null;
    label.removeEventListener("blur", finish);
    label.removeEventListener("input", clear);
  };
  const finish = async () => {
    if (pending || closed) return;
    pending = true;
    try { await commit(label.textContent ?? ""); close(); }
    catch (err) { if (!closed && label.isConnected) fieldError(label, String(err instanceof Error ? err.message : err), () => { close(); label.blur(); }); }
    finally { pending = false; }
  };
  label.addEventListener("blur", finish);
  label.addEventListener("input", clear);
  label.onkeydown = (ev) => {
    if (ev.key === "Enter" || ev.key === "Escape") {
      ev.preventDefault();
      if (ev.key === "Escape") { close(); label.blur(); }
      else void finish().then(() => { if (closed) label.blur(); });
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

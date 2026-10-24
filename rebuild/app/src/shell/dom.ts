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
  return h("div", { class: `clickable-icon ${cls}`.trim(), "aria-label": label, onclick: onClick }, icon);
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

/** Inline rename: Enter or blur commits; an error keeps the draft editable, Escape cancels. `invalid` is shown while typing. */
export function editInPlace(label: HTMLElement, commit: (text: string) => void | Promise<void>, invalid?: (text: string) => string) {
  const shown = label.textContent ?? "";
  let pending = false, closed = false;
  label.contentEditable = "plaintext-only";
  label.focus();
  getSelection()?.selectAllChildren(label);
  const clear = () => fieldError(label, "");
  const preview = () => fieldError(label, invalid?.(label.textContent ?? "") ?? "");
  const close = () => {
    closed = true;
    clear();
    label.contentEditable = "false";
    label.textContent = shown;
    label.onkeydown = null;
    label.removeEventListener("blur", finish);
    label.removeEventListener("input", preview);
  };
  const finish = async () => {
    if (pending || closed) return;
    pending = true;
    try { await commit(label.textContent ?? ""); close(); }
    catch (err) { if (!closed && label.isConnected) fieldError(label, String(err instanceof Error ? err.message : err), () => { close(); label.blur(); }); }
    finally { pending = false; }
  };
  label.addEventListener("blur", finish);
  label.addEventListener("input", preview);
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
  pressable(h("div", { class: `clickable-icon ${cls}`.trim(), "aria-label": label, role: "button" }, icon), onPress);

const TIP_DELAY = 300;
const TIP_TARGET = ".clickable-icon[aria-label], .workspace-tab-header-inner-close-button[aria-label], .workspace-tab-header-status-icon[aria-label], .status-bar-item.mod-clickable[aria-label], .copy-code-button[aria-label], .code-block-flair[aria-label], .cm-foldPlaceholder[aria-label]";

/** One delayed tooltip for labelled controls. It appears after a short wait, with no fade. */
export function installTooltips() {
  let owner: HTMLElement | null = null, tip: HTMLElement | null = null;
  let timer = 0;
  let listening: AbortController | null = null;
  const close = () => {
    clearTimeout(timer);
    listening?.abort();
    listening = null;
    tip?.remove();
    tip = owner = null;
  };
  document.addEventListener("pointerover", event => {
    const next = (event.target as Element).closest<HTMLElement>(TIP_TARGET);
    if (next === owner) return;
    close();
    if (!next?.getAttribute("aria-label") || event.buttons) return;
    owner = next;
    listening = new AbortController();
    const options = { capture: true, signal: listening.signal };
    for (const type of ["pointerdown", "keydown", "scroll"]) document.addEventListener(type, close, options);
    for (const type of ["blur", "resize"]) window.addEventListener(type, close, options);
    timer = window.setTimeout(() => {
      if (!owner?.isConnected) return close();
      tip = h("div", { class: "tooltip", role: "tooltip" }, owner.getAttribute("aria-label"));
      document.body.append(tip);
      const r = owner.getBoundingClientRect(), width = tip.offsetWidth, height = tip.offsetHeight;
      const side = !!owner.closest(".workspace-ribbon");
      const above = !side && r.bottom + height + 8 > innerHeight - 8;
      tip.classList.toggle("mod-right", side);
      tip.classList.toggle("mod-top", above);
      const left = Math.max(8, Math.min(side ? r.right + 8 : r.left + (r.width - width) / 2, innerWidth - width - 8));
      const top = Math.max(8, Math.min(side ? r.top + (r.height - height) / 2 : above ? r.top - height - 8 : r.bottom + 8, innerHeight - height - 8));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.setProperty("--tip-arrow", `${Math.max(8, Math.min(side ? r.top + r.height / 2 - top - 5 : r.left + r.width / 2 - left - 5, (side ? height : width) - 18))}px`);
    }, TIP_DELAY);
  });
  document.addEventListener("pointerout", event => { if (owner && !owner.contains(event.relatedTarget as Node | null)) close(); });
}

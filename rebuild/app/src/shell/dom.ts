// Tiny DOM helpers for the app chrome.

type Child = Node | string | null | undefined | false;
type Props = {
  class?: string;
  title?: string;
  role?: string;
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

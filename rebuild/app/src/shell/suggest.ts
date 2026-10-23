// Obsidian's suggestion popover under a text field (the Properties block's
// name and value fields): the items that match what is typed, fuzzy-ranked
// with their letters bold, an icon per item if given. ↑↓ move, Enter or a
// click takes one, Escape closes it. It shows while the field has focus,
// and the field keeps the focus throughout.
//
// Call it before the field's own key handlers are added, so Enter and
// Escape reach the popover first while it is open.

import { h } from "./dom";
import { fuzzyRank, highlight } from "./fuzzy";
import { icon, type IconName } from "./icons";

export interface SuggestItem {
  text: string;
  icon?: IconName;
}

interface SuggestOptions {
  /** The items for what is typed (ranked here). */
  items(query: string): SuggestItem[] | Promise<SuggestItem[]>;
  choose(item: SuggestItem): void;
  className?: string;
  /** Highlight the first item before anything is typed (tags: not, as in Obsidian). */
  selectEmpty?: boolean;
}

const MAX = 50;

export function suggest(field: HTMLElement, o: SuggestOptions) {
  let box: HTMLElement | null = null;
  let shown: SuggestItem[] = [];
  let selected = -1;
  let seq = 0;
  const query = () => (field instanceof HTMLInputElement ? field.value : (field.textContent ?? "")).trim();

  async function update() {
    const mine = ++seq;
    const q = query();
    const all = await o.items(q);
    if (mine !== seq || document.activeElement !== field) return;
    const ranked = q ? fuzzyRank(q, all, (i) => i.text) : all.map((item) => ({ item, indices: [] as number[] }));
    if (!ranked.length) return close();
    shown = ranked.slice(0, MAX).map((r) => r.item);
    selected = q || o.selectEmpty !== false ? 0 : -1;
    box ??= document.body.appendChild(h("div", { class: `suggestion-container${o.className ? ` ${o.className}` : ""}` }));
    box.replaceChildren(
      ...ranked.slice(0, MAX).map(({ item, indices }, i) =>
        h(
          "div",
          { class: "suggestion-item", onmousedown: (e: MouseEvent) => e.preventDefault(), onclick: () => take(i), onmousemove: () => select(i) },
          item.icon ? h("div", { class: "suggestion-icon" }, icon(item.icon)) : null,
          h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(item.text, indices))),
        ),
      ),
    );
    select(selected);
    const r = field.getBoundingClientRect();
    box.style.left = `${Math.round(r.left)}px`;
    box.style.top = `${Math.round(r.bottom + 4)}px`;
  }

  function select(i: number) {
    selected = i;
    box?.querySelectorAll(".suggestion-item").forEach((row, k) => row.classList.toggle("is-selected", k === i));
    box?.children[i]?.scrollIntoView({ block: "nearest" });
  }

  function take(i: number) {
    const item = shown[i];
    close();
    if (item) o.choose(item);
  }

  function close() {
    seq++;
    box?.remove();
    box = null;
    shown = [];
  }

  field.addEventListener("focus", () => void update());
  field.addEventListener("input", () => void update());
  field.addEventListener("blur", close);
  field.addEventListener("keydown", (e) => {
    if (!box) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") select((selected + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    else if (e.key === "Enter" && selected >= 0) take(selected);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
}

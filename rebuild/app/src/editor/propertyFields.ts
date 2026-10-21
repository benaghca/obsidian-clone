// The Properties block's parts that aren't the block itself: each type's
// icon and name, the "Property type" submenu (the row icon's menu and the
// All properties view share it), and the two fields a row is made of, a
// name field and a one-line text field, which commit on Enter or when left
// and suggest what the vault already has (shell/suggest.ts).

import { h } from "../shell/dom";
import type { IconName } from "../shell/icons";
import type { MenuItems } from "../shell/menu";
import { suggest, type SuggestItem } from "../shell/suggest";
import { CHOOSABLE_TYPES, fixedType, type PropertyType } from "./frontmatter";
import type { PropertyHost } from "./host";

export const TYPE_ICONS: Record<PropertyType, IconName> = {
  text: "text-align-start",
  list: "list",
  number: "binary",
  checkbox: "square-check-big",
  date: "calendar",
  datetime: "clock",
  tags: "tags",
  aliases: "forward",
  unknown: "file-question-mark",
};

export const TYPE_NAMES: Record<PropertyType, string> = {
  text: "Text",
  list: "List",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  datetime: "Date & time",
  tags: "Tags",
  aliases: "Aliases",
  unknown: "Unknown",
};

/** The "Property type" submenu for a name (the row icon's menu, and the All properties view's). */
export function typeItems(key: string, inferred: PropertyType, vault: PropertyHost | null): MenuItems {
  const fixed = fixedType(key);
  const chosen = vault?.typeOf(key) ?? null;
  // Tags, aliases and cssclasses have their own type: the menu shows it, every item disabled.
  const types = fixed ? [...new Set([...CHOOSABLE_TYPES, fixed])].sort((a, b) => TYPE_NAMES[a].localeCompare(TYPE_NAMES[b])) : CHOOSABLE_TYPES;
  return [
    !fixed && { title: `Automatic (${TYPE_NAMES[inferred]})`, icon: "loader", checked: !chosen, disabled: !vault, action: () => vault?.setType(key, null) },
    ...types.map((t) => ({ title: TYPE_NAMES[t], icon: TYPE_ICONS[t], checked: chosen === t, disabled: !!fixed || !vault, action: () => vault?.setType(key, t) })),
  ];
}

/** A key field, suggesting the vault's names: written on Enter or when left; Escape gives the old key back. */
export function keyInput(key: string, names: () => Promise<SuggestItem[]>, commit: (key: string) => void) {
  const input = h("input", { class: "property-key-input", "data-part": "key", "aria-label": key || "New property" });
  input.value = key;
  suggest(input, {
    className: "mod-property-key",
    items: names,
    choose: (item) => {
      input.value = item.text;
      finish();
    },
  });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    commit(input.value.trim());
    done = false;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = key;
      finish();
    }
  });
  input.addEventListener("blur", finish);
  return input;
}

/**
 * A one-line text field (a plain-text editable span): `commit` on Enter or
 * when left, Escape undoes. It suggests `values` (a pick commits it, or goes
 * to `choose`).
 */
export function editable(
  text: string,
  commit: (text: string) => void,
  leave: (el: HTMLElement) => void,
  values: () => Promise<SuggestItem[]>,
  choose?: (item: SuggestItem) => void,
) {
  const el = h("div", { class: "property-text", "data-part": "value" });
  el.contentEditable = "plaintext-only";
  el.textContent = text;
  suggest(el, {
    className: "mod-property-value",
    items: values,
    selectEmpty: !choose,
    choose:
      choose ??
      ((item) => {
        el.textContent = item.text;
        leave(el);
      }),
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      if (e.key === "Escape") el.textContent = text;
      leave(el);
    }
  });
  el.addEventListener("blur", () => {
    const next = el.textContent!.replace(/\s*\n\s*/g, " ");
    if (next !== text) commit(next);
  });
  return el;
}

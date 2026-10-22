// The settings page's building blocks, after Obsidian 1.14's: a row is a
// name, a muted description under it and its controls on the right; rows
// sit in rounded cards with thin separators between them, under an optional
// heading. Controls: toggle, dropdown, slider (value shown), text and number
// inputs, buttons, small icon buttons and hotkey chips. Keyboard: everything
// is in the Tab order; Space or Enter flips a toggle, arrow keys move a
// slider (natively), dropdowns are native selects.

import { h, keyButton, pressable } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";

type Child = Node | string | null | undefined | false;

export interface RowOptions {
  name: string;
  desc?: Child | Child[];
  /** Extra classes (mod-toggle, mod-slider, ...). */
  cls?: string;
}

/** One setting: name and description on the left, controls on the right. */
export function row(o: RowOptions, ...controls: Child[]): HTMLElement {
  const desc = [o.desc ?? null].flat();
  return h(
    "div",
    { class: `setting-item${o.cls ? ` ${o.cls}` : ""}` },
    h(
      "div",
      { class: "setting-item-info" },
      h("div", { class: "setting-item-name" }, o.name),
      desc.some(Boolean) ? h("div", { class: "setting-item-description" }, ...desc) : null,
    ),
    h("div", { class: "setting-item-control" }, ...controls),
  );
}

/** A card of rows, with an optional heading above it. Falsy rows are left out. */
export function group(heading: string | null, ...rows: Child[]): HTMLElement {
  return h(
    "div",
    { class: "setting-group" },
    heading ? h("div", { class: "setting-item setting-item-heading" }, h("div", { class: "setting-item-name" }, heading)) : null,
    h("div", { class: "setting-items" }, ...rows),
  );
}

/** Show a toggle on or off (without telling its listener). */
export function setToggle(el: HTMLElement, on: boolean) {
  el.classList.toggle("is-enabled", on);
  el.setAttribute("aria-checked", String(on));
}

/** Obsidian's pill switch. Space or Enter flips it. */
export function toggle(value: boolean, onChange: (on: boolean) => void, label: string): HTMLElement {
  const el = pressable(h("div", { class: "checkbox-container", role: "switch", "aria-label": label }), () => {
    const on = !el.classList.contains("is-enabled");
    setToggle(el, on);
    onChange(on);
  });
  setToggle(el, value);
  return el;
}

/** A native select (keyboard and screen readers come with it), drawn like Obsidian's. */
export function dropdown<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void, label: string): HTMLElement {
  const select = h("select", { class: "dropdown", "aria-label": label });
  for (const [v, text] of options) select.append(h("option", { value: v }, text));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value as T));
  return h("div", { class: "dropdown-container" }, select, h("span", { class: "dropdown-chevron" }, icon("chevrons-up-down", 16)));
}

export interface SliderOptions {
  min: number;
  max: number;
  /** "any" for a continuous slider. */
  step: number | "any";
  value: number;
  label: string;
  /** The value as shown beside the slider. */
  format(v: number): string;
  /** Called as the slider moves (settings apply live). */
  onInput(v: number): void;
  /** If given, a "Restore default" button appears while the value differs. */
  defaultValue?: number;
}

/** Restore-default button, value label, then the range input, as Obsidian lays them out. */
export function slider(o: SliderOptions): HTMLElement[] {
  const input = h("input", { class: "slider", type: "range", min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.value), "aria-label": o.label });
  const value = h("span", { class: "slider-value" });
  const restore =
    o.defaultValue === undefined
      ? null
      : extraButton("rotate-ccw", "Restore default", () => {
          input.value = String(o.defaultValue);
          show();
          o.onInput(o.defaultValue!);
        });
  const show = () => {
    const v = Number(input.value);
    value.textContent = o.format(v);
    input.style.setProperty("--slider-fill", String((v - o.min) / (o.max - o.min)));
    restore?.classList.toggle("is-disabled", v === o.defaultValue);
    input.setAttribute("aria-valuetext", o.format(v));
  };
  show();
  input.addEventListener("input", () => {
    show();
    o.onInput(Number(input.value));
  });
  return [restore, value, input].filter(Boolean) as HTMLElement[];
}

export interface TextOptions {
  value: string;
  placeholder?: string;
  label: string;
  /** Called on every edit; the settings store debounces the write. */
  onInput(v: string): void;
  /** Called when the field loses focus or Enter is pressed. */
  onCommit?(v: string): void;
  type?: "text" | "number";
  cls?: string;
  /** The id of a <datalist> to suggest from. */
  list?: string;
}

export function textInput(o: TextOptions): HTMLInputElement {
  const cls = `setting-input${o.cls ? ` ${o.cls}` : ""}`;
  const input = h("input", { class: cls, type: o.type ?? "text", value: o.value, placeholder: o.placeholder, list: o.list, spellcheck: "false", "aria-label": o.label });
  input.addEventListener("input", () => o.onInput(input.value));
  const commit = () => o.onCommit?.(input.value);
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  return input;
}

export function button(text: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const el = h("button", { type: "button" }, text);
  el.addEventListener("click", onClick);
  return el;
}

/** The small icon buttons beside controls (Restore default, Options, Customize). */
export function extraButton(name: IconName, label: string, onClick: (e: MouseEvent | KeyboardEvent) => void, cls = ""): HTMLElement {
  return keyButton(icon(name, 16), label, onClick, `extra-setting-button ${cls}`);
}

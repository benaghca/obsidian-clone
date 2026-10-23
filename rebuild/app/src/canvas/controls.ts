import { confirmDialog } from "../shell/confirm";
import { h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { showMenu } from "../shell/menu";
import { hints, openPrompt } from "../shell/prompt";
import { settings } from "../settings/store";
import type { CanvasNode } from "./model";

export const canvasReadOnly = new WeakSet<HTMLElement>();
export function canvasSettings(el: HTMLElement, anchor: HTMLElement, refresh: () => void) {
  const opts = settings.get("canvas.json");
  showMenu([
    ...([['snapToGrid', 'Snap to grid', 'grid-2x2'], ['snapToObjects', 'Snap to objects', 'scan-line']] as const).map(([key, title, icon]) => ({
      title, icon, checked: opts[key], action: () => { settings.set("canvas.json", key, !opts[key]); },
    })),
    { title: "Read-only", icon: "lock", checked: canvasReadOnly.has(el), action: () => {
      if (canvasReadOnly.has(el)) canvasReadOnly.delete(el); else canvasReadOnly.add(el);
      el.classList.toggle("is-readonly", canvasReadOnly.has(el)); refresh();
    } },
  ], anchor, { align: "right" });
}
export function canvasHelp() {
  const rows = [
    ["Pan", "Space + Drag", "Scroll"], ["Pan horizontally", "Shift + Scroll"], ["Zoom", "Ctrl + Scroll"],
    ["Zoom to fit", "Shift + 1"], ["Zoom to selection", "Shift + 2"],
    ["Add to / remove from selection", "Shift + Click", "Shift + Drag to select"],
    ["Constrain card movement to axis", "Shift + Drag"], ["Disable snapping while dragging", "Alt"],
    ["Remove card", "Backspace", "Delete"], ["Undo", "Ctrl + Z"], ["Redo", "Ctrl + Shift + Z"],
  ];
  void confirmDialog({ title: "Canvas help", confirm: "Close", cancel: false,
    message: h("div", { class: "canvas-help" }, ...rows.map(([label, ...keys]) => h("div", null, label,
      h("span", null, ...keys.map(key => h("kbd", null, key)))))),
  });
}
export function selectionMenu(world: HTMLElement, remove: () => void, zoom: () => void,
  edit: (node: CanvasNode) => void, recolor: (nodes: CanvasNode[]) => void) {
  let selected: CanvasNode[] = [];
  const toolbar = h("div", { class: "canvas-selection-menu", role: "toolbar", "aria-label": "Selection" });
  const colorButton = keyButton(icon("palette"), "Set color", () => {
    const choose = (color?: string) => {
      selected.forEach(node => { node.color = color; }); recolor(selected);
    };
    showMenu([
      ...["Default", "Red", "Orange", "Yellow", "Green", "Cyan", "Purple"].map((title, i) => ({
        title, content: h("span", { class: "canvas-swatch", style: `background:${i ? `var(--color-${title.toLowerCase()})` : "var(--background-modifier-border-focus)"}` }),
        action: () => choose(i ? String(i) : undefined),
      })),
      { title: "Custom color", content: h("span", { class: "canvas-swatch mod-custom" }), action: () => openPrompt({
        placeholder: "Hex color (#rrggbb)", instructions: hints("to set color"), emptyText: "Enter a hex color.",
        items: query => /^#[0-9a-f]{6}$/i.test(query) ? [query] : [],
        render: (value, row) => { row.textContent = value; }, choose: value => choose(value),
      }) },
    ], colorButton, { className: "canvas-color-menu" });
  });
  const editButton = keyButton(icon("square-pen"), "Edit", () => { if (selected.length === 1) edit(selected[0]); });
  toolbar.append(keyButton(icon("trash-2"), "Remove", remove), colorButton,
    keyButton(icon("scan-search"), "Zoom to selection\n(Shift + 2)", zoom), editButton);
  world.append(toolbar);
  return {
    update(nodes: CanvasNode[]) {
      selected = nodes; toolbar.hidden = !nodes.length;
      editButton.hidden = nodes.length !== 1 || nodes[0].type !== "text";
      if (!nodes.length) return;
      const left = Math.min(...nodes.map(n => n.x)), right = Math.max(...nodes.map(n => n.x + n.width));
      toolbar.style.left = `${(left + right) / 2}px`;
      toolbar.style.top = `${Math.min(...nodes.map(n => n.y))}px`;
    },
    dispose: () => toolbar.remove(),
  };
}

import { confirmDialog } from "../shell/confirm";
import { h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { closeMenu, showMenu } from "../shell/menu";
import { settings } from "../settings/store";
import { edgeBounds, type CanvasEdge, type CanvasNode } from "./model";

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
    ["Remove card", "Backspace", "Delete"], ["Undo", "Ctrl + Z"], ["Redo", "Ctrl + Y", "Ctrl + Shift + Z"],
  ];
  void confirmDialog({ title: "Canvas help", confirm: "Close", cancel: false,
    message: h("div", { class: "canvas-help" }, ...rows.map(([label, ...keys]) => h("div", null, label,
      h("span", null, ...keys.map(key => h("kbd", null, key)))))),
  });
}
export function selectionMenu(world: HTMLElement, allNodes: CanvasNode[], remove: () => void, zoom: (items: Pick<CanvasNode, "x" | "y" | "width" | "height">[]) => void,
  edit: (item: CanvasNode | CanvasEdge) => void, recolor: (items: (CanvasNode | CanvasEdge)[]) => void) {
  let selected: (CanvasNode | CanvasEdge)[] = [], edges: CanvasEdge[] = [], disposed = false;
  let positions: Pick<CanvasNode, "x" | "y" | "width" | "height">[] = [];
  const zoomSelection = () => { closeMenu(); zoom(positions); };
  const toolbar = h("div", { class: "canvas-selection-menu", tabindex: "-1", role: "toolbar", "aria-label": "Selection" });
  const colorButton = keyButton(icon("palette"), "Set color", () => {
    const choose = (color?: string) => {
      if (disposed) return;
      const changed = selected.filter(node => node.color !== color);
      if (changed.length) { changed.forEach(node => { node.color = color; }); recolor(changed); }
    };
    const custom = h("input", { type: "color", "aria-label": "Custom color" });
    custom.value = /^#[0-9a-f]{6}$/i.test(selected[0]?.color ?? "") ? selected[0].color! : "#000000";
    custom.addEventListener("change", () => { choose(custom.value); closeMenu(); });
    showMenu([
      ...["Default", "Red", "Orange", "Yellow", "Green", "Cyan", "Purple"].map((title, i) => ({
        title, checked: selected.every(node => (node.color ?? "0") === String(i)), content: h("span", { class: "canvas-swatch", style: `background:${i ? `var(--color-${title.toLowerCase()})` : "var(--background-modifier-border-focus)"}` }),
        action: () => choose(i ? String(i) : undefined),
      })),
      { title: "Custom color", content: h("span", { class: "canvas-swatch mod-custom" }, custom) },
    ], toolbar, { className: "canvas-color-menu", align: "center" });
  });
  const editButton = keyButton(icon("square-pen"), "Edit", e => { if (e.type === "click" && (e as MouseEvent).detail > 1) return; closeMenu(); if (selected.length === 1) edit(selected[0]); });
  const direction = keyButton(icon("arrow-right"), "Line direction", () => {
    showMenu((["Nondirectional", "Unidirectional", "Bidirectional"] as const).map((title, i) => ({
      title, icon: (["minus", "arrow-right", "move-horizontal"] as const)[i],
      checked: edges.every(edge => (edge.fromEnd === "arrow" ? 1 : 0) + (edge.toEnd !== "none" ? 1 : 0) === i),
      action: () => {
        const changed = edges.filter(edge => edge.fromEnd !== (i === 2 ? "arrow" : undefined) || edge.toEnd !== (i === 0 ? "none" : undefined));
        changed.forEach(edge => { edge.fromEnd = i === 2 ? "arrow" : undefined; edge.toEnd = i === 0 ? "none" : undefined; });
        if (changed.length) recolor(changed);
      },
    })), direction);
  });
  const removeLabel = keyButton(icon("square-x"), "Remove label", () => {
    closeMenu(); const changed = edges.filter(edge => edge.label);
    changed.forEach(edge => { edge.label = undefined; }); if (changed.length) recolor(changed);
  });
  toolbar.append(keyButton(icon("trash-2"), "Remove", () => { closeMenu(); remove(); }), colorButton,
    keyButton(icon("scan-search"), "Zoom to selection\n(Shift + 2)", zoomSelection), editButton);
  world.append(toolbar);
  return {
    zoom: zoomSelection,
    update(nodes: CanvasNode[], chosenEdges: CanvasEdge[] = []) {
      edges = chosenEdges; selected = [...nodes, ...edges]; toolbar.hidden = !selected.length;
      direction.remove(); removeLabel.remove();
      if (edges.length) toolbar.insertBefore(direction, editButton);
      if (edges.some(edge => edge.label)) toolbar.insertBefore(removeLabel, editButton);
      editButton.hidden = selected.length !== 1 || !!nodes.length && nodes[0].type !== "text";
      editButton.setAttribute("aria-label", edges.length ? "Edit label" : "Edit");
      if (!selected.length) return;
      positions = [...nodes, ...edges.map(edge => edgeBounds(allNodes.find(n => n.id === edge.fromNode)!, allNodes.find(n => n.id === edge.toNode)!, edge))];
      const left = Math.min(...positions.map(n => n.x)), right = Math.max(...positions.map(n => n.x + n.width));
      toolbar.style.left = `${(left + right) / 2}px`;
      const labels = [...world.querySelectorAll<HTMLElement>(".canvas-group-label, .canvas-file-label")]
        .filter(label => nodes.some(n => n.id === label.parentElement!.dataset.nodeId));
      toolbar.style.top = `${Math.min(...positions.map(n => n.y), ...labels.map(label => label.parentElement!.offsetTop + label.offsetTop))}px`;
    },
    dispose() { disposed = true; if (toolbar.matches(".has-active-menu") || toolbar.querySelector(".has-active-menu")) closeMenu(); toolbar.remove(); },
  };
}

import { IMAGE_EXT } from "../editor/embeds";
import { showMenu, SEPARATOR } from "../shell/menu";
import { hints, openPrompt, suggestionText } from "../shell/prompt";
import { fuzzyRank } from "../shell/fuzzy";
import type { Workspace } from "../workspace";
import type { CanvasNode } from "./model";

export type BackgroundPicker = (node: CanvasNode, anchor: HTMLElement, apply: () => void) => void;
export function groupAlign(group: CanvasNode, nodes: CanvasNode[], anchor: HTMLElement, apply: (nodes: CanvasNode[]) => void) {
  const inside = nodes.filter(n => n !== group && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height);
  showMenu([
    ...["Align left", "Align center", "Align right", "Align top", "Align middle", "Align bottom"].map((title, i) => ({
      title, disabled: inside.length < 2, action: () => {
        const axis = i < 3 ? "x" : "y", size = i < 3 ? "width" : "height", part = (i % 3) / 2;
        const min = Math.min(...inside.map(n => n[axis])), max = Math.max(...inside.map(n => n[axis] + n[size]));
        const changed = inside.filter(n => n[axis] !== min + (max - min - n[size]) * part);
        changed.forEach(n => { n[axis] = min + (max - min - n[size]) * part; }); if (changed.length) apply(changed);
      },
    })), SEPARATOR,
    ...["Arrange in a row", "Arrange in a column", "Arrange in a grid", "Distribute horizontal spacing", "Distribute vertical spacing", "Justify horizontally", "Justify vertically"].map(title => ({ title, disabled: true })),
  ], anchor, { className: "canvas-group-menu" });
}

export function groupBackground(ws: Workspace, node: CanvasNode, anchor: HTMLElement, apply: () => void, valid: () => boolean) {
  const files = ws.vault.files.filter(f => !f.is_dir && IMAGE_EXT.test(f.path) && !ws.vault.isExcluded(f.path));
  const pick = (): void => openPrompt({
    placeholder: "Type to search...", instructions: hints("to select"), emptyText: "No images found.",
    items: query => query.trim() ? fuzzyRank(query, files, f => f.path) : files.map(item => ({ item, indices: [] as number[] })),
    render: ({ item, indices }, row) => suggestionText(row, item.path, indices),
    choose: ({ item: file }, e) => {
      // The second toolbar click can land on the newly opened prompt's first row.
      if (e instanceof MouseEvent && e.detail > 1) { pick(); return; }
      if (valid() && node.background !== file.path) { node.background = file.path; apply(); }
    },
  });
  const style = async (value?: string) => {
    if (!valid() || node.backgroundStyle === value) return;
    if (value === "ratio") {
      const held = ws.embeds.image(node.background!);
      try { const img = new Image(); img.src = await held.url; await img.decode(); if (!valid()) return; node.width = Math.round(node.height * img.naturalWidth / img.naturalHeight); }
      catch { return; } finally { held.release(); }
    }
    node.backgroundStyle = value; apply();
  };
  if (!node.background) { pick(); return; }
  showMenu([
    { title: "Replace background", icon: "image", action: pick },
    { title: "Remove background", icon: "image-minus", action: () => { if (valid()) { node.background = node.backgroundStyle = undefined; apply(); } } }, SEPARATOR,
    ...["Cover", "Keep aspect ratio", "Repeat"].map((title, i) => ({ title, checked: node.backgroundStyle === [undefined, "ratio", "repeat"][i], action: () => { void style([undefined, "ratio", "repeat"][i]); } })),
  ], anchor, { className: "canvas-group-menu" });
}

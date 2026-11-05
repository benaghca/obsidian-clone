// The drawing editor: the select tool with move, resize and rotate handles
// and a marquee; rectangle, diamond and ellipse; line and arrow with points to
// edit and arrow ends that bind to shapes; freedraw with pen pressure; text,
// free or inside a shape; the eraser; a style panel; undo and redo; and a
// sheet of its keys. It edits the scene the tab painted and asks the tab to
// repaint only the elements a change touched. Lines stay clean: new elements
// are written with roughness 0, so other apps draw them the way Grove does.
//
// During a move only the touched nodes get a translate; resize and rotate
// redraw their few elements each frame, and so do arrows bound to what moves.
// Each gesture is one undo step, and each element it changes gets one new
// version.

import { dragPointer, h, keyButton } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import {
  arrowLabelPatch, arrowsBoundTo, bindPoints, bindTargetAt, boundWith, deletePatches, followArrows, labelsFor,
  Patches, sceneLookup, setBinding, targetOf, unbindLeft, type Target,
} from "./binding";
import {
  boxFrom, centreOf, elementFrame, frameCorners, handleAt, handleCursor, handlePoints, hitElement, hitTest, HANDLE_HIT, isEditable,
  marqueeHits, normalizeAngle, resizeFrame, rotateFrame, rotatePoint, selectionFrame, toLocal, type Frame, type Handle,
} from "./geometry";
import { DrawingHistory, stepIds, type Transaction } from "./history";
import { isLinear, midpoints, pathMidpoint, pointAt, pointsPatch, snapAngle, strokePatch, worldPoints } from "./linear";
import { drawingColor, fontFamilyCss } from "./render";
import { findElement, type DrawingElement, type Json, type LinearElement, type Point, type Scene, type TextAlign, type TextElement } from "./scene";
import { arrowTextPatch, freeTextPatch, labelPatch, labelWidthFor, roughMeasure, type Measure, type TextStyle } from "./text";
import {
  followOf, followPatch, groupResizedPatch, groupRotatedPatch, movedPatch, resizable, resizedPatch,
  type Follow, type Patch,
} from "./transform";

export interface EditorHost {
  el: HTMLElement;
  scene(): Scene | null;
  /** False while the drawing is still painting, or couldn't be opened. */
  ready(): boolean;
  toScene(clientX: number, clientY: number): Point;
  /** A scene point in px from the view's top left. */
  toScreen(p: Point): Point;
  scale(): number;
  node(id: string): SVGElement | null;
  repaint(ids: Iterable<string>): void;
  /** The scene changed: save it soon. */
  changed(): void;
}

export type Tool = "select" | "rectangle" | "diamond" | "ellipse" | "arrow" | "line" | "freedraw" | "text" | "eraser";

interface Style {
  strokeColor: string; backgroundColor: string; fillStyle: string; strokeWidth: number; strokeStyle: string; opacity: number;
  fontSize: number; fontFamily: number; textAlign: string; startArrowhead: string; endArrowhead: string;
}
type StyleKey = keyof Style;

// Shared by every drawing tab for the session, like a pen left on the desk.
const defaults: Style = {
  strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", opacity: 100,
  fontSize: 20, fontFamily: 2, textAlign: "left", startArrowhead: "none", endArrowhead: "arrow",
};

const STROKES = ["#1e1e1e", "#d03030", "#2a8a3e", "#2464c8", "#e08a00", "#8a3fc0"];
const FILLS = ["transparent", "#ffd6d6", "#d3f2d8", "#d6e6ff", "#ffe8b8", "#ece0f8"];
const COLOR_RE = /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i;
const HEADS: [string, string][] = [["none", "None"], ["arrow", "Arrow"], ["triangle", "Triangle"], ["dot", "Dot"], ["bar", "Bar"]];

const TOOLS: [Tool, string, IconName, string][] = [
  ["select", "Select", "mouse-pointer-2", "v"],
  ["rectangle", "Rectangle", "square", "r"],
  ["diamond", "Diamond", "diamond", "d"],
  ["ellipse", "Ellipse", "circle", "e"],
  ["arrow", "Arrow", "move-up-right", "a"],
  ["line", "Line", "slash", "l"],
  ["freedraw", "Pen", "pencil", "p"],
  ["text", "Text", "type", "t"],
  ["eraser", "Eraser", "eraser", "x"],
];

export const DRAWING_KEYS: [string, string][] = [
  ["V", "Select"],
  ["R, D, E", "Rectangle, diamond, ellipse"],
  ["A, L", "Arrow, line"],
  ["P", "Pen"],
  ["T", "Text"],
  ["X", "Eraser"],
  ["Shift + drag", "Square or circle; keep proportions; snap turns and lines to 15°; move on one axis"],
  ["Alt + drag", "Draw or resize from the centre"],
  ["Shift + click", "Add to or take from the selection"],
  ["Drag a point", "Move a line's point; an arrow end over a shape binds to it"],
  ["Drag a midpoint", "Add a point"],
  ["Alt + click a point", "Remove the point"],
  ["Double-click or Enter", "Edit text, or a shape's or arrow's label"],
  ["Esc or Ctrl + Enter", "Finish editing text"],
  ["Ctrl + A", "Select all"],
  ["Arrow keys", "Nudge by 1 (with Shift, by 10)"],
  ["Delete or Backspace", "Delete the selection"],
  ["Ctrl + Z", "Undo"],
  ["Ctrl + Shift + Z or Ctrl + Y", "Redo"],
  ["Esc", "Cancel a drag, then deselect, then back to Select"],
  ["Space + drag, or middle drag", "Pan"],
  ["Ctrl + wheel", "Zoom"],
  ["?", "Show or hide these keys"],
];

type Gesture =
  | { kind: "move"; start: Point; dx: number; dy: number; members: DrawingElement[]; nodes: [SVGElement, string | null][]; click: string | null; followers: DrawingElement[]; tx: Transaction | null }
  | { kind: "resize"; tx: Transaction; handle: Exclude<Handle, "rotate">; frame: Frame; members: DrawingElement[]; follows: Follow[]; followers: DrawingElement[]; last: Patches }
  | { kind: "rotate"; tx: Transaction; start: Point; frame: Frame; members: DrawingElement[]; follows: Follow[]; followers: DrawingElement[]; last: Patches }
  | { kind: "marquee"; start: Point; now: Point; base: string[] }
  | { kind: "create"; tx: Transaction; id: string; start: Point }
  | { kind: "linear"; tx: Transaction; id: string; start: Point; startTarget: DrawingElement | null; endTarget: DrawingElement | null; end: Point }
  | { kind: "point"; tx: Transaction; el: DrawingElement; base: Point[]; index: number; added: boolean; moved: boolean; target: DrawingElement | null; labels: DrawingElement[]; press: [number, number] }
  | { kind: "freedraw"; tx: Transaction; id: string; origin: Point; pts: Point[]; pressures: number[] | null; stop: () => void }
  | { kind: "erase"; ids: Set<string>; last: Point };

interface Editing {
  tx: Transaction;
  id: string;
  /** The element as it was when editing began. */
  el: DrawingElement;
  container: DrawingElement | null;
  /** What the container needs on top of a grown height: a new label adds itself to its list. */
  containerBase: Patch;
  isNew: boolean;
  area: HTMLTextAreaElement;
  style: TextStyle;
  /** Colour and opacity picked while typing. */
  extra: Patch;
}

const SHAPE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);
const isLabel = (el: DrawingElement) => el.type === "text" && !!(el as TextElement).containerId;
const labelOwner = (el: DrawingElement) => (el as TextElement).containerId;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");
const CHROME = ".drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help, .drawing-text-editor";

// Which elements a style key changes.
const STYLE_FOR: Record<StyleKey, (type: string) => boolean> = {
  strokeColor: () => true,
  opacity: () => true,
  backgroundColor: (t) => SHAPE_TYPES.has(t),
  fillStyle: (t) => SHAPE_TYPES.has(t),
  strokeWidth: (t) => t !== "text" && t !== "image",
  strokeStyle: (t) => t !== "text" && t !== "image" && t !== "freedraw",
  fontSize: (t) => t === "text",
  fontFamily: (t) => t === "text",
  textAlign: (t) => t === "text",
  startArrowhead: (t) => t === "arrow",
  endArrowhead: (t) => t === "arrow",
};
const TEXT_KEYS = new Set<StyleKey>(["fontSize", "fontFamily", "textAlign"]);
// What a tool makes, for the panel to show that type's sections.
const TOOL_TYPE: Partial<Record<Tool, string>> = { rectangle: "rectangle", diamond: "diamond", ellipse: "ellipse", arrow: "arrow", line: "line", freedraw: "freedraw", text: "text" };

let measureContext: CanvasRenderingContext2D | null | undefined;
const measure: Measure = (line, size, family) => {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return roughMeasure(line, size, family);
  measureContext.font = `${size}px ${fontFamilyCss(family)}`;
  return measureContext.measureText(line).width;
};

export function drawingEditor(host: EditorHost) {
  const { el } = host;
  const history = new DrawingHistory();
  let tool: Tool = "select";
  let selection: string[] = [];
  let gesture: Gesture | null = null;
  let styleTx: Transaction | null = null;
  let editing: Editing | null = null;
  let cancelDrag: (() => void) | undefined;

  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "drawing-overlay");
  overlay.setAttribute("aria-hidden", "true");

  // ----- toolbar -----
  const toolButtons = new Map<Tool, HTMLElement>();
  const tools = h("div", { class: "drawing-control-group drawing-tools" });
  for (const [name, label, glyph, key] of TOOLS) {
    const button = keyButton(icon(glyph), `${label} (${key.toUpperCase()})`, (event) => { event.stopPropagation(); setTool(name); el.focus({ preventScroll: true }); });
    button.dataset.tool = name;
    toolButtons.set(name, button);
    tools.append(button);
  }
  const undoButton = keyButton(icon("undo-2"), "Undo (Ctrl+Z)", (event) => { event.stopPropagation(); step(false); el.focus({ preventScroll: true }); });
  const redoButton = keyButton(icon("redo-2"), "Redo (Ctrl+Shift+Z)", (event) => { event.stopPropagation(); step(true); el.focus({ preventScroll: true }); });
  const helpButton = keyButton(icon("keyboard"), "Keys (?)", (event) => { event.stopPropagation(); toggleHelp(); });
  const toolbar = h("div", { class: "drawing-toolbar" }, tools, h("div", { class: "drawing-control-group drawing-tools" }, undoButton, redoButton, helpButton));

  // ----- style panel -----
  const panel = h("div", { class: "drawing-style", "aria-label": "Style" });
  const choices = new Map<StyleKey, HTMLElement[]>();
  const sections: [HTMLElement, StyleKey][] = [];
  const section = (key: StyleKey, title: string, ...rows: (HTMLElement | SVGElement)[]) => {
    const node = h("div", { class: "drawing-style-section" }, h("div", { class: "drawing-style-title" }, title), ...rows);
    sections.push([node, key]);
    return node;
  };
  const choice = (key: StyleKey, value: string | number, label: string, body: HTMLElement | SVGElement | string) => {
    const button = h("button", { class: "drawing-style-choice", type: "button", "aria-label": label, title: label, "data-value": String(value) }, body);
    button.addEventListener("click", (event) => { event.stopPropagation(); setStyle({ [key]: value } as Partial<Style>); });
    const list = choices.get(key) ?? [];
    list.push(button);
    choices.set(key, list);
    return button;
  };
  const swatch = (key: "strokeColor" | "backgroundColor", color: string) => {
    const dot = h("span", { class: `drawing-swatch${color === "transparent" ? " is-none" : ""}` });
    dot.style.setProperty("--swatch", color);
    return choice(key, color, color === "transparent" ? "None" : color, dot);
  };
  const hexInput = (key: "strokeColor" | "backgroundColor", label: string) => {
    const input = h("input", { class: "drawing-hex", type: "text", spellcheck: "false", "aria-label": label, placeholder: "#hex" }) as HTMLInputElement;
    const apply = () => {
      const value = input.value.trim();
      if (COLOR_RE.test(value)) setStyle({ [key]: value.toLowerCase() } as Partial<Style>);
      else refresh();
    };
    input.addEventListener("change", apply);
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") { apply(); el.focus({ preventScroll: true }); }
      if (event.key === "Escape") { refresh(); el.focus({ preventScroll: true }); }
    });
    return input;
  };
  const strokeHex = hexInput("strokeColor", "Stroke colour");
  const fillHex = hexInput("backgroundColor", "Fill colour");
  const widthIcon = (w: number) => {
    const line = h("span", { class: "drawing-width-mark" });
    line.style.height = `${w}px`;
    return line;
  };
  const dashIcon = (style: string) => h("span", { class: `drawing-dash-mark is-${style}` });
  const fillIcon = (style: string) => h("span", { class: `drawing-fill-mark is-${style}` });
  const opacity = h("input", { class: "drawing-opacity", type: "range", min: "0", max: "100", step: "5", "aria-label": "Opacity" }) as HTMLInputElement;
  const opacityValue = h("span", { class: "drawing-opacity-value" });
  opacity.addEventListener("input", () => { setStyle({ opacity: Number(opacity.value) }, true); });
  opacity.addEventListener("change", () => { setStyle({ opacity: Number(opacity.value) }); });
  opacity.addEventListener("keydown", (event) => event.stopPropagation());
  const headRow = (key: "startArrowhead" | "endArrowhead", side: string) => h("div", { class: "drawing-style-row" },
    ...HEADS.map(([value, label]) => choice(key, value, `${side} ${label.toLowerCase()}`, h("span", { class: `drawing-head-mark is-${value}${key === "startArrowhead" ? " is-start" : ""}` }))));
  panel.append(
    section("strokeColor", "Stroke", h("div", { class: "drawing-style-row" }, ...STROKES.map((c) => swatch("strokeColor", c))), strokeHex),
    section("backgroundColor", "Fill", h("div", { class: "drawing-style-row" }, ...FILLS.map((c) => swatch("backgroundColor", c))), fillHex),
    section("fillStyle", "Fill style", h("div", { class: "drawing-style-row" },
      choice("fillStyle", "solid", "Solid", fillIcon("solid")),
      choice("fillStyle", "hachure", "Hatched", fillIcon("hachure")),
      choice("fillStyle", "cross-hatch", "Cross-hatched", fillIcon("cross-hatch")))),
    section("strokeWidth", "Stroke width", h("div", { class: "drawing-style-row" },
      choice("strokeWidth", 1, "Thin", widthIcon(1)),
      choice("strokeWidth", 2, "Medium", widthIcon(2)),
      choice("strokeWidth", 4, "Thick", widthIcon(4)))),
    section("strokeStyle", "Stroke style", h("div", { class: "drawing-style-row" },
      choice("strokeStyle", "solid", "Solid line", dashIcon("solid")),
      choice("strokeStyle", "dashed", "Dashed line", dashIcon("dashed")),
      choice("strokeStyle", "dotted", "Dotted line", dashIcon("dotted")))),
    section("startArrowhead", "Arrowheads", headRow("startArrowhead", "Start"), headRow("endArrowhead", "End")),
    section("fontFamily", "Font", h("div", { class: "drawing-style-row" },
      choice("fontFamily", 1, "Hand-drawn", h("span", { class: "drawing-font-mark is-hand" }, "Aa")),
      choice("fontFamily", 2, "Normal", h("span", { class: "drawing-font-mark is-normal" }, "Aa")),
      choice("fontFamily", 3, "Code", h("span", { class: "drawing-font-mark is-code" }, "Aa")))),
    section("fontSize", "Font size", h("div", { class: "drawing-style-row" },
      choice("fontSize", 16, "Small", "S"), choice("fontSize", 20, "Medium size", "M"),
      choice("fontSize", 28, "Large", "L"), choice("fontSize", 36, "Extra large", "XL"))),
    section("textAlign", "Align", h("div", { class: "drawing-style-row" },
      choice("textAlign", "left", "Align left", icon("text-align-start")),
      choice("textAlign", "center", "Align centre", icon("text-align-center")),
      choice("textAlign", "right", "Align right", icon("text-align-end")))),
    section("opacity", "Opacity", h("div", { class: "drawing-style-row" }, opacity, opacityValue)),
  );
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  // While text is being edited, a press on the panel's buttons keeps the caret in the text.
  panel.addEventListener("mousedown", (event) => { if (editing && !(event.target as Element).closest("input")) event.preventDefault(); });

  // ----- key sheet -----
  const help = h("div", { class: "drawing-help", role: "dialog", "aria-label": "Drawing keys" },
    h("div", { class: "drawing-help-title" }, "Drawing keys"),
    h("table", {}, h("tbody", {}, ...DRAWING_KEYS.map(([keys, what]) => h("tr", {}, h("td", {}, h("kbd", {}, keys)), h("td", {}, what))))),
  );
  help.hidden = true;
  help.addEventListener("pointerdown", (event) => { event.stopPropagation(); toggleHelp(false); });

  el.append(overlay, toolbar, panel, help);

  // ----- state helpers -----
  const scene = () => host.scene();
  const live = (s: Scene, id: string) => { const e = findElement(s, id); return e && isEditable(e) ? e : undefined; };
  const finder = (s: Scene) => (id: string) => findElement(s, id);
  const selected = (s: Scene) => {
    const out: DrawingElement[] = [];
    for (const id of selection) { const e = live(s, id); if (e) out.push(e); }
    return out;
  };
  const tolerance = () => 6 / host.scale();
  const reach = () => HANDLE_HIT / host.scale();

  // Labels of the given shapes that aren't selected themselves: they move with their shape.
  function labelsOf(s: Scene, ids: readonly string[]): Map<string, DrawingElement[]> {
    const owners = new Set(ids);
    const out = new Map<string, DrawingElement[]>();
    if (!owners.size) return out;
    for (const e of s.elements) {
      if (!isEditable(e) || !isLabel(e) || owners.has(e.id)) continue;
      const owner = labelOwner(e)!;
      if (!owners.has(owner)) continue;
      const list = out.get(owner) ?? [];
      list.push(e);
      out.set(owner, list);
    }
    return out;
  }

  /** Arrows bound to `ids` that aren't among them: their ends follow. */
  const followersOf = (s: Scene, ids: ReadonlySet<string>) => arrowsBoundTo(s, ids).filter((a) => !ids.has(a.id));

  /** The one selected line or arrow whose points are shown, if that's what is selected. */
  function pointTarget(s: Scene): DrawingElement | null {
    const els = selected(s);
    return els.length === 1 && isLinear(els[0]) ? els[0] : null;
  }
  // A two-point line is edited by its ends alone; one with more points also gets the frame's handles.
  const showsFrame = (els: DrawingElement[]) => !(els.length === 1 && isLinear(els[0]) && (els[0] as LinearElement).points.length <= 2);

  function setSelection(ids: string[]) {
    selection = [...new Set(ids)];
    refresh();
  }

  function setTool(next: Tool) {
    if (gesture) cancelDrag?.();
    if (editing) finishText();
    tool = next;
    if (next !== "select") selection = [];
    el.dataset.tool = next;
    refresh();
  }

  function toggleHelp(show: boolean = help.hidden === true) {
    help.hidden = !show;
    helpButton.classList.toggle("is-active", show);
  }

  // ----- painting the overlay -----
  const sp = (p: Point) => host.toScreen(p).map((v) => Math.round(v * 10) / 10);
  const pts = (list: Point[]) => list.map((p) => sp(p).join(",")).join(" ");

  function frameOfSelection(s: Scene): Frame | null {
    const els = selected(s);
    const frame = selectionFrame(els);
    if (!frame) return null;
    if (gesture?.kind === "move") return { ...frame, x: frame.x + gesture.dx, y: frame.y + gesture.dy };
    return frame;
  }

  function hintMarkup(t: Target): string {
    const f = t.frame;
    if (t.type === "ellipse") {
      const c = centreOf(f);
      const [x, y] = sp(c);
      const scale = host.scale();
      return `<ellipse class="drawing-bind-hint" cx="${x}" cy="${y}" rx="${f.width / 2 * scale + 3}" ry="${f.height / 2 * scale + 3}" transform="rotate(${f.angle * 180 / Math.PI} ${x} ${y})"/>`;
    }
    if (t.type === "diamond") {
      const c = centreOf(f);
      const verts: Point[] = [[c[0], f.y], [f.x + f.width, c[1]], [c[0], f.y + f.height], [f.x, c[1]]];
      return `<polygon class="drawing-bind-hint" points="${pts(verts.map((p) => rotatePoint(p, c, f.angle)))}"/>`;
    }
    return `<polygon class="drawing-bind-hint" points="${pts(frameCorners(f))}"/>`;
  }

  function paintOverlay() {
    const s = scene();
    let out = "";
    if (s && host.ready()) {
      const els = selected(s);
      const frame = frameOfSelection(s);
      const shift: Point = gesture?.kind === "move" ? [gesture.dx, gesture.dy] : [0, 0];
      if (els.length > 1) {
        for (const e of els) {
          const f = elementFrame(e);
          out += `<polygon class="drawing-member" points="${pts(frameCorners({ ...f, x: f.x + shift[0], y: f.y + shift[1] }))}"/>`;
        }
      }
      const busyDrawing = gesture?.kind === "create" || gesture?.kind === "linear" || gesture?.kind === "point" || gesture?.kind === "freedraw";
      if (frame && !busyDrawing && !editing && showsFrame(els)) {
        const scale = host.scale();
        out += `<polygon class="drawing-frame" points="${pts(frameCorners(frame))}"/>`;
        if (!gesture || gesture.kind === "resize" || gesture.kind === "rotate") {
          const handles = handlePoints(frame, scale, canResize(els));
          const c = centreOf(frame);
          const top = host.toScreen(rotatePoint([c[0], frame.y], c, frame.angle));
          const knob = handles.rotate ? host.toScreen(handles.rotate) : null;
          if (knob) out += `<line class="drawing-stem" x1="${knob[0]}" y1="${knob[1]}" x2="${top[0]}" y2="${top[1]}"/>`;
          for (const [name, at] of Object.entries(handles) as [Handle, Point][]) {
            const [x, y] = host.toScreen(at);
            out += name === "rotate"
              ? `<circle class="drawing-handle is-rotate" data-handle="rotate" cx="${x}" cy="${y}" r="4.5"/>`
              : `<rect class="drawing-handle" data-handle="${name}" x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5"/>`;
          }
        }
      }
      const line = pointTarget(s);
      if (line && !editing && (!gesture || gesture.kind === "point")) {
        const world = worldPoints(line);
        world.forEach((p, i) => { const [x, y] = sp(p); out += `<circle class="drawing-point" data-point="${i}" cx="${x}" cy="${y}" r="5"/>`; });
        if (!gesture) {
          const scale = host.scale();
          midpoints(world).forEach((p, i) => {
            if (Math.hypot(world[i + 1][0] - world[i][0], world[i + 1][1] - world[i][1]) * scale < 28) return;
            const [x, y] = sp(p);
            out += `<circle class="drawing-midpoint" data-mid="${i}" cx="${x}" cy="${y}" r="3.5"/>`;
          });
        }
      }
      for (const t of hints()) out += hintMarkup(t);
      if (gesture?.kind === "marquee") {
        const box = boxFrom(gesture.start, gesture.now);
        const [x, y] = host.toScreen([box.x, box.y]);
        const scale = host.scale();
        out += `<rect class="drawing-marquee" x="${x}" y="${y}" width="${box.width * scale}" height="${box.height * scale}"/>`;
      }
    }
    overlay.innerHTML = out;
    hideEdited();
  }

  // Shapes an arrow end is about to bind to.
  function hints(): Target[] {
    const out: Target[] = [];
    if (gesture?.kind === "linear") for (const t of [gesture.startTarget, gesture.endTarget]) if (t) out.push(targetOf(t));
    if (gesture?.kind === "point" && gesture.target) out.push(targetOf(gesture.target));
    return out;
  }

  const canResize = (els: DrawingElement[]) => els.length > 1 || (els.length === 1 && resizable(els[0]));

  // ----- the panel's state -----
  /** The element types the panel speaks for: the selection (with its labels), or what the tool makes. */
  function panelContext(s: Scene): DrawingElement[] {
    if (editing) return [findElement(s, editing.id) ?? editing.el];
    const els = selected(s);
    for (const list of labelsOf(s, els.map((e) => e.id)).values()) els.push(...list);
    return els;
  }

  function refreshPanel() {
    const s = scene();
    const els = s ? panelContext(s) : [];
    const made = TOOL_TYPE[tool];
    panel.hidden = !s || !host.ready() || tool === "eraser" || (tool === "select" && !els.length);
    if (panel.hidden) return;
    const types = els.length ? els.map((e) => e.type) : made ? [made] : [];
    for (const [node, key] of sections) {
      const keys: StyleKey[] = key === "startArrowhead" ? ["startArrowhead", "endArrowhead"] : [key];
      node.hidden = !keys.some((k) => types.some((t) => STYLE_FOR[k](t)));
    }
    const value = (key: StyleKey): string | number | null => {
      const mine = els.filter((e) => STYLE_FOR[key](e.type));
      if (!mine.length) return defaults[key];
      const read = (e: DrawingElement) => {
        const v = (e as unknown as Record<string, unknown>)[key];
        return key.endsWith("Arrowhead") ? (v as string | null) ?? "none" : v as string | number;
      };
      const first = read(mine[0]);
      return mine.every((e) => read(e) === first) ? first : null;
    };
    for (const [key, buttons] of choices) {
      const v = value(key);
      for (const b of buttons) {
        const on = v !== null && b.dataset.value === String(v);
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      }
    }
    const stroke = value("strokeColor"), fill = value("backgroundColor"), alpha = value("opacity");
    if (document.activeElement !== strokeHex) strokeHex.value = typeof stroke === "string" ? stroke : "";
    if (document.activeElement !== fillHex) fillHex.value = typeof fill === "string" ? fill : "";
    if (document.activeElement !== opacity || !styleTx) opacity.value = String(alpha ?? 100);
    opacityValue.textContent = alpha === null ? "–" : `${alpha}%`;
  }

  function refresh() {
    const s = scene();
    if (s) selection = selection.filter((id) => !!live(s, id));
    // The toolbar stays up through a repaint; presses wait for `ready` anyway.
    toolbar.hidden = !s;
    for (const [name, button] of toolButtons) {
      button.classList.toggle("is-active", name === tool);
      button.setAttribute("aria-pressed", String(name === tool));
    }
    undoButton.classList.toggle("is-disabled", !history.canUndo);
    redoButton.classList.toggle("is-disabled", !history.canRedo);
    el.classList.toggle("is-drawing-tool", tool !== "select");
    refreshPanel();
    paintOverlay();
  }

  // ----- edits -----
  function finishEdit(tx: Transaction, ids: Iterable<string>, next: string[] = selection) {
    const committed = tx.commit(next);
    host.repaint(ids);
    selection = next;
    if (committed) host.changed();
    refresh();
    return committed;
  }

  /** Run gathered patches through `tx`, one change per element. */
  function apply(tx: Transaction, patches: Patches) {
    for (const [id, patch] of patches) tx.merge(id, patch);
  }

  const textStyle = (e: DrawingElement, over: Partial<Style> = {}): TextStyle => {
    const t = e as TextElement;
    return {
      fontSize: Number(over.fontSize ?? t.fontSize), fontFamily: Number(over.fontFamily ?? t.fontFamily), lineHeight: t.lineHeight,
      textAlign: (over.textAlign ?? t.textAlign) as TextAlign, verticalAlign: t.verticalAlign,
    };
  };

  /** A text element laid out again with `style`: in its shape, on its arrow, or on its own. */
  function relayout(s: Scene, text: DrawingElement, style: TextStyle, value: string, out: Patches) {
    const owner = labelOwner(text);
    const container = owner ? live(s, owner) : undefined;
    if (container && isLinear(container)) out.merge(text.id, arrowTextPatch(pathMidpoint(worldPoints(container)), value, style, measure));
    else if (container) {
      const { label, container: grown } = labelPatch(container, value, style, measure);
      out.merge(text.id, label);
      if (grown) out.merge(container.id, grown);
    } else out.merge(text.id, freeTextPatch(text, value, style, measure));
  }

  function setStyle(patch: Partial<Style>, liveFrame = false) {
    Object.assign(defaults, patch);
    const s = scene();
    if (editing && s) { restyleEditing(patch); return; }
    const els = s && !gesture ? selected(s) : [];
    if (!s || !els.length) { dropLiveStyle(); refresh(); return; }
    styleTx ??= history.begin(s, selection);
    const out = new Patches();
    const keys = Object.keys(patch) as StyleKey[];
    const write = (e: DrawingElement, keysFor: StyleKey[]) => {
      const p: Patch = {};
      for (const k of keysFor) if (STYLE_FOR[k](e.type)) p[k] = (k.endsWith("Arrowhead") && patch[k] === "none" ? null : patch[k]) as Json;
      if (Object.keys(p).length) out.merge(e.id, p);
    };
    // A new font, size or alignment lays the text out again.
    const fonts = keys.some((k) => TEXT_KEYS.has(k));
    const ids = els.map((e) => e.id);
    for (const e of els) {
      write(e, keys);
      if (fonts && e.type === "text") relayout(s, e, textStyle(e, patch), (e as TextElement).originalText, out);
    }
    // Labels take their shape's ink, opacity and font.
    for (const list of labelsOf(s, ids).values()) for (const label of list) {
      write(label, keys.filter((k) => k === "strokeColor" || k === "opacity" || TEXT_KEYS.has(k)));
      if (fonts) relayout(s, label, textStyle(label, patch), (label as TextElement).originalText, out);
    }
    for (const [id, p] of out) styleTx.preview(id, p);
    if (liveFrame) { host.repaint(out.keys()); refreshPanel(); return; }
    const tx = styleTx;
    styleTx = null;
    finishEdit(tx, tx.ids());
  }

  function remove() {
    const s = scene();
    if (!s) return;
    const els = selected(s);
    if (!els.length) return;
    deleteNow(s, els.map((e) => e.id), []);
  }

  function deleteNow(s: Scene, ids: Iterable<string>, next: string[]) {
    const { patches } = deletePatches(s, ids, finder(s));
    if (!patches.size) return;
    const tx = history.begin(s, selection);
    apply(tx, patches);
    finishEdit(tx, patches.keys(), next);
  }

  function nudge(dx: number, dy: number) {
    const s = scene();
    if (!s) return;
    const els = selected(s);
    if (!els.length) return;
    const tx = history.begin(s, selection);
    const all = [...els];
    for (const list of labelsOf(s, els.map((e) => e.id)).values()) all.push(...list);
    const moving = new Set(all.map((e) => e.id));
    const followers = followersOf(s, moving);
    const out = new Patches();
    for (const e of all) out.merge(e.id, movedPatch(e, dx, dy));
    unbindLeft(all, moving, finder(s), out);
    apply(tx, out);
    const follow = followArrows(s, followers, sceneLookup(finder(s)));
    apply(tx, follow);
    finishEdit(tx, [...out.keys(), ...follow.keys()]);
  }

  function step(forward: boolean) {
    const s = scene();
    if (!s || gesture || editing) return;
    dropLiveStyle();
    const next = history.peek(forward);
    if (!next) return;
    const ids = stepIds(next);
    const sel = forward ? history.redo(s) : history.undo(s);
    if (!sel) return;
    host.repaint(ids);
    selection = sel;
    host.changed();
    refresh();
  }

  function selectAll() {
    const s = scene();
    if (!s) return;
    if (tool !== "select") setTool("select");
    setSelection(s.elements.filter((e) => isEditable(e) && !isLabel(e)).map((e) => e.id));
  }

  // ----- text -----
  function hideEdited() {
    if (!editing) return;
    const node = host.node(editing.id);
    if (node && node.getAttribute("visibility") !== "hidden") node.setAttribute("visibility", "hidden");
  }

  /** What text a press at `p` edits: a free text, a shape's or arrow's label, or a new text there. */
  function editTextAt(s: Scene, p: Point, arrows: boolean) {
    const hit = hitTest(s.elements, p, tolerance());
    if (hit?.type === "text") return startText(s, hit, null);
    if (hit && (SHAPE_TYPES.has(hit.type) || (arrows && isLinear(hit)))) return startText(s, null, hit);
    // An unfilled shape takes text anywhere inside it, not only on its outline.
    const inside = bindTargetAt(s.elements, p, 0, (e) => !SHAPE_TYPES.has(e.type));
    if (inside) return startText(s, null, inside);
    startText(s, null, null, p);
  }

  function startText(s: Scene, text: DrawingElement | null, container: DrawingElement | null, at?: Point) {
    if (editing) finishText();
    const tx = history.begin(s, selection);
    let isNew = false;
    let containerBase: Patch = {};
    if (!text && container) {
      const existing = labelsFor(s, new Set([container.id]))[0];
      if (existing) text = existing;
    }
    if (!text) {
      isNew = true;
      const lineH = defaults.fontSize * 1.25;
      const props: Record<string, Json> = {
        text: "", originalText: "", fontSize: defaults.fontSize, fontFamily: defaults.fontFamily, roughness: 0,
        strokeColor: defaults.strokeColor, opacity: defaults.opacity, width: 0, height: lineH, strokeWidth: 1,
      };
      if (container) {
        const c = centreOf(elementFrame(container));
        Object.assign(props, { x: c[0], y: c[1] - lineH / 2, textAlign: "center", verticalAlign: "middle", containerId: container.id, strokeColor: container.strokeColor, opacity: container.opacity });
      } else Object.assign(props, { x: at![0], y: at![1] - lineH / 2, textAlign: defaults.textAlign });
      text = tx.add("text", props);
      if (container) {
        const list = boundWith(container, text.id, "text");
        if (list !== undefined) containerBase = { boundElements: list };
        tx.preview(container.id, containerBase);
      }
    } else if (!container) {
      const owner = labelOwner(text);
      container = owner ? live(s, owner) ?? null : null;
    }
    const area = h("textarea", { class: "drawing-text-editor", spellcheck: "false", "aria-label": "Text" }) as HTMLTextAreaElement;
    area.value = (text as TextElement).originalText;
    area.wrap = "off";
    el.append(area);
    editing = { tx, id: text.id, el: text, container, containerBase, isNew, area, style: textStyle(text), extra: {} };
    selection = [];
    area.addEventListener("input", () => layoutEditing());
    area.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        finishText();
        el.focus({ preventScroll: true });
      }
    });
    area.addEventListener("pointerdown", (event) => event.stopPropagation());
    area.addEventListener("blur", () => setTimeout(() => { if (editing?.area === area && document.activeElement !== area) finishText(); }, 0));
    layoutEditing();
    refresh();
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function layoutEditing() {
    const s = scene();
    const ed = editing;
    if (!s || !ed) return;
    const value = ed.area.value;
    const out = new Patches();
    const c = ed.container;
    if (c && isLinear(c)) out.merge(ed.id, arrowTextPatch(pathMidpoint(worldPoints(c)), value, ed.style, measure));
    else if (c) {
      const { label, container } = labelPatch(c, value, ed.style, measure);
      out.merge(ed.id, label);
      out.merge(c.id, { ...ed.containerBase, ...container });
    } else out.merge(ed.id, freeTextPatch(ed.el, value, ed.style, measure));
    out.merge(ed.id, { fontSize: ed.style.fontSize, fontFamily: ed.style.fontFamily, textAlign: ed.style.textAlign, ...ed.extra });
    for (const [id, patch] of out) ed.tx.preview(id, patch);
    host.repaint(out.keys());
    hideEdited();
    placeArea();
  }

  function placeArea() {
    const s = scene();
    const ed = editing;
    if (!s || !ed) return;
    const t = (findElement(s, ed.id) ?? ed.el) as TextElement;
    const scale = host.scale();
    const style = ed.style;
    const lineH = style.fontSize * (t.lineHeight > 0 ? t.lineHeight : 1.25);
    const hgt = Math.max(Math.abs(t.height), lineH);
    // A label in a shape wraps where its lines will: the box is as wide as the shape's inside,
    // centred on the label. Free text gets room for the next letter, so typing doesn't scroll it.
    const shape = ed.container && !isLinear(ed.container) ? live(s, ed.container.id) : undefined;
    const room = style.fontSize;
    const w = shape ? labelWidthFor(shape.type, elementFrame(shape).width, style.fontSize) + 2 : Math.max(Math.abs(t.width), 1) + room;
    const mid = t.x + Math.abs(t.width) / 2;
    const left = shape || style.textAlign === "center" ? mid - w / 2 : style.textAlign === "right" ? t.x + Math.abs(t.width) - w : t.x;
    const [x, y] = host.toScreen([left, t.y]);
    const a = ed.area.style;
    a.left = `${x}px`;
    a.top = `${y}px`;
    a.width = `${w * scale}px`;
    a.height = `${hgt * scale}px`;
    a.whiteSpace = shape ? "pre-wrap" : "pre";
    ed.area.wrap = shape ? "soft" : "off";
    a.fontSize = `${style.fontSize * scale}px`;
    a.fontFamily = fontFamilyCss(style.fontFamily);
    a.lineHeight = String(t.lineHeight > 0 ? t.lineHeight : 1.25);
    a.textAlign = style.textAlign;
    a.color = drawingColor(t.strokeColor, document.documentElement.classList.contains("theme-dark"));
    a.opacity = String(t.opacity / 100);
    a.transformOrigin = `${(mid - left) * scale}px ${hgt * scale / 2}px`;
    a.transform = t.angle ? `rotate(${t.angle}rad)` : "";
  }

  function restyleEditing(patch: Partial<Style>) {
    const ed = editing!;
    if (patch.fontSize !== undefined) ed.style.fontSize = patch.fontSize;
    if (patch.fontFamily !== undefined) ed.style.fontFamily = patch.fontFamily;
    if (patch.textAlign !== undefined) ed.style.textAlign = patch.textAlign as TextAlign;
    if (patch.strokeColor !== undefined) ed.extra.strokeColor = patch.strokeColor;
    if (patch.opacity !== undefined) ed.extra.opacity = patch.opacity;
    layoutEditing();
    refreshPanel();
  }

  /** Finish editing text: keep it, or drop it if it's empty. `cancel` puts everything back. */
  function finishText(cancel = false) {
    const ed = editing;
    if (!ed) return;
    editing = null;
    ed.area.remove();
    const s = scene();
    const ids = ed.tx.ids();
    if (!s || cancel || (ed.isNew && !ed.area.value.trim())) {
      ed.tx.cancel();
      host.repaint(ids);
      refresh();
      return;
    }
    tool = "select";
    el.dataset.tool = tool;
    const owner = ed.container && live(s, ed.container.id) ? ed.container.id : null;
    if (!ed.area.value.trim()) {
      const { patches } = deletePatches(s, [ed.id], finder(s));
      apply(ed.tx, patches);
      finishEdit(ed.tx, [...ids, ...patches.keys()], owner ? [owner] : []);
      return;
    }
    finishEdit(ed.tx, ids, [owner ?? ed.id]);
  }

  // ----- pointer -----
  function begin(event: PointerEvent): Gesture | null {
    const s = scene();
    if (!s) return null;
    const p = host.toScene(event.clientX, event.clientY);
    const style = {
      strokeColor: defaults.strokeColor, strokeWidth: defaults.strokeWidth, strokeStyle: defaults.strokeStyle, opacity: defaults.opacity, roughness: 0,
    };
    switch (tool) {
      case "rectangle": case "diamond": case "ellipse": {
        const tx = history.begin(s, selection);
        const created = tx.add(tool, { x: p[0], y: p[1], width: 0, height: 0, ...style, backgroundColor: defaults.backgroundColor, fillStyle: defaults.fillStyle });
        selection = [];
        return { kind: "create", tx, id: created.id, start: p };
      }
      case "arrow": case "line": {
        const tx = history.begin(s, selection);
        const props: Record<string, Json> = { x: p[0], y: p[1], width: 0, height: 0, ...style, points: [[0, 0], [0, 0]] };
        if (tool === "arrow") { props.startArrowhead = head(defaults.startArrowhead); props.endArrowhead = head(defaults.endArrowhead); }
        const created = tx.add(tool, props);
        selection = [];
        const startTarget = tool === "arrow" ? bindTargetAt(s.elements, p, tolerance()) : null;
        return { kind: "linear", tx, id: created.id, start: p, end: p, startTarget, endTarget: null };
      }
      case "freedraw": {
        const tx = history.begin(s, selection);
        const pen = event.pointerType === "pen";
        const pressures = pen ? [event.pressure || 0.5] : null;
        const created = tx.add("freedraw", { x: p[0], y: p[1], width: 0, height: 0, ...style, strokeStyle: "solid", backgroundColor: "transparent", points: [[0, 0]], pressures: pressures ?? [], simulatePressure: !pen });
        selection = [];
        const g: Extract<Gesture, { kind: "freedraw" }> = { kind: "freedraw", tx, id: created.id, origin: p, pts: [p], pressures, stop: () => {} };
        // Every pointer sample counts for a stroke, not just the last one each frame.
        const collect = (e: PointerEvent) => {
          if (e.pointerId !== event.pointerId) return;
          for (const c of e.getCoalescedEvents?.() ?? [e]) addStrokePoint(g, c);
        };
        window.addEventListener("pointermove", collect);
        g.stop = () => window.removeEventListener("pointermove", collect);
        return g;
      }
      case "eraser": {
        const g: Extract<Gesture, { kind: "erase" }> = { kind: "erase", ids: new Set(), last: p };
        eraseAt(s, g, p);
        return g;
      }
      case "text":
        editTextAt(s, p, false);
        return null;
    }
    const els = selected(s);
    // A selected line's points come first, then the midpoints that add one.
    const line = pointTarget(s);
    if (line) {
      const world = worldPoints(line);
      const at = pointAt(world, p, reach());
      if (at >= 0 && event.altKey) { removePoint(s, line, world, at); return null; }
      const mid = at < 0 ? pointAt(midpoints(world), p, reach()) : -1;
      if (at >= 0 || mid >= 0) {
        const tx = history.begin(s, selection);
        const base = world.map((q) => [q[0], q[1]] as Point);
        let index = at;
        if (mid >= 0) { base.splice(mid + 1, 0, midpoints(world)[mid]); index = mid + 1; }
        return { kind: "point", tx, el: line, base, index, added: mid >= 0, moved: false, target: null, labels: labelsFor(s, new Set([line.id])), press: [event.clientX, event.clientY] };
      }
    }
    const frame = selectionFrame(els);
    if (frame && showsFrame(els)) {
      const handle = handleAt(frame, p, host.scale(), canResize(els));
      if (handle) {
        const tx = history.begin(s, selection);
        const follows: Follow[] = [];
        for (const [owner, list] of labelsOf(s, selection)) {
          const box = live(s, owner);
          if (box) for (const label of list) follows.push(followOf(label, box));
        }
        const followers = followersOf(s, new Set(els.map((e) => e.id)));
        if (handle === "rotate") return { kind: "rotate", tx, start: p, frame, members: els, follows, followers, last: new Patches() };
        return { kind: "resize", tx, handle, frame, members: els, follows, followers, last: new Patches() };
      }
    }
    const hit = hitTest(s.elements, p, tolerance());
    if (event.shiftKey) {
      if (hit && selection.includes(hit.id)) { setSelection(selection.filter((id) => id !== hit.id)); return null; }
      if (hit) setSelection([...selection, hit.id]);
      else return { kind: "marquee", start: p, now: p, base: [...selection] };
    } else if (hit && !selection.includes(hit.id)) setSelection([hit.id]);
    else if (!hit && !(frame && insideFrame(frame, p))) {
      setSelection([]);
      return { kind: "marquee", start: p, now: p, base: [] };
    }
    // A press on one of several selected elements picks it alone, unless the press becomes a drag.
    const click = !event.shiftKey && hit && selection.length > 1 ? hit.id : null;
    const members = selected(s);
    for (const list of labelsOf(s, selection).values()) members.push(...list);
    const nodes: [SVGElement, string | null][] = [];
    for (const m of members) { const node = host.node(m.id); if (node) nodes.push([node, node.getAttribute("transform")]); }
    const followers = followersOf(s, new Set(members.map((m) => m.id)));
    return { kind: "move", start: p, dx: 0, dy: 0, members, nodes, click, followers, tx: followers.length ? history.begin(s, selection) : null };
  }

  const head = (v: string) => v === "none" ? null : v;

  const insideFrame = (f: Frame, p: Point) => {
    const q = toLocal(f, p);
    return q[0] >= f.x && q[0] <= f.x + f.width && q[1] >= f.y && q[1] <= f.y + f.height;
  };

  function addStrokePoint(g: Extract<Gesture, { kind: "freedraw" }>, e: PointerEvent) {
    const p = host.toScene(e.clientX, e.clientY);
    const last = g.pts[g.pts.length - 1];
    // Samples closer than a screen pixel add nothing a viewer could see.
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) * host.scale() < 1) return;
    g.pts.push(p);
    g.pressures?.push(e.pressure || 0.5);
  }

  function eraseAt(s: Scene, g: Extract<Gesture, { kind: "erase" }>, p: Point) {
    const tol = tolerance();
    // Sample the path since the last frame so a fast swipe misses nothing in between.
    const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) / tol));
    const fresh: string[] = [];
    for (let i = 1; i <= steps; i++) {
      const q: Point = [g.last[0] + (p[0] - g.last[0]) * i / steps, g.last[1] + (p[1] - g.last[1]) * i / steps];
      for (const e of s.elements) {
        if (g.ids.has(e.id) || !hitElement(e, q, tol)) continue;
        const owner = isLabel(e) ? live(s, labelOwner(e)!) : undefined;
        const target = owner ?? e;
        for (const id of [target.id, ...labelsFor(s, new Set([target.id])).map((l) => l.id)]) if (!g.ids.has(id)) { g.ids.add(id); fresh.push(id); }
      }
    }
    g.last = p;
    for (const id of fresh) host.node(id)?.classList.add("is-erasing");
  }

  function removePoint(s: Scene, line: DrawingElement, world: Point[], at: number) {
    if (world.length <= 2) return;
    const next = world.filter((_, i) => i !== at);
    const la = line as LinearElement;
    const lookup = sceneLookup(finder(s));
    const out = new Patches();
    // Taking away an end lets go of that end's shape; the next point becomes the end, where it is.
    const last = world.length - 1;
    if (at === 0 && la.startBinding) setBinding(line, "start", null, finder(s), out);
    if (at === last && la.endBinding) setBinding(line, "end", null, finder(s), out);
    const start = at !== 0 && la.startBinding ? lookup(la.startBinding.elementId) : null;
    const end = at !== last && la.endBinding ? lookup(la.endBinding.elementId) : null;
    const ends = bindPoints(next, start, end);
    out.merge(line.id, pointsPatch(ends));
    for (const l of labelsFor(s, new Set([line.id]))) out.merge(l.id, arrowLabelPatch(l, ends));
    const tx = history.begin(s, selection);
    apply(tx, out);
    finishEdit(tx, out.keys());
  }

  /** The points of a point drag, with bound ends not being dragged put back on their shapes. */
  function pointDragPoints(s: Scene, g: Extract<Gesture, { kind: "point" }>, p: Point, snap: boolean, target?: DrawingElement | null): Point[] {
    const list = g.base.map((q) => [q[0], q[1]] as Point);
    const last = list.length - 1;
    const from = g.index > 0 ? list[g.index - 1] : list[1];
    list[g.index] = snap && from ? snapAngle(from, p) : p;
    const la = g.el as LinearElement;
    const lookup = sceneLookup(finder(s));
    const startTarget = g.index === 0 ? (target ? targetOf(target) : null) : la.startBinding ? lookup(la.startBinding.elementId) : null;
    const endTarget = g.index === last ? (target ? targetOf(target) : null) : la.endBinding ? lookup(la.endBinding.elementId) : null;
    return bindPoints(list, startTarget, endTarget);
  }

  function track(g: Gesture, event: PointerEvent) {
    const s = scene();
    if (!s) return;
    const p = host.toScene(event.clientX, event.clientY);
    switch (g.kind) {
      case "move": {
        let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
        // Shift keeps the move on one axis.
        if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        g.dx = dx; g.dy = dy;
        for (const [node, was] of g.nodes) node.setAttribute("transform", `translate(${dx} ${dy})${was ? ` ${was}` : ""}`);
        if (g.tx && g.followers.length) {
          const moving = new Set(g.members.map((m) => m.id));
          const follow = followArrows(s, g.followers, sceneLookup(finder(s), moving, dx, dy));
          for (const [id, patch] of follow) g.tx.preview(id, patch);
          host.repaint(follow.keys());
        }
        break;
      }
      case "resize": {
        const opts = { keepAspect: event.shiftKey, fromCentre: event.altKey };
        const r = resizeFrame(g.frame, g.handle, p, opts);
        const ids: string[] = [];
        g.last.clear();
        if (g.members.length === 1) g.last.merge(g.members[0].id, resizedPatch(g.members[0], g.frame, r));
        else for (const m of g.members) g.last.merge(m.id, groupResizedPatch(m, g.frame, r));
        for (const [id, patch] of g.last) { g.tx.preview(id, patch); ids.push(id); }
        followLabels(s, g.tx, g.follows, ids, r.flipX, r.flipY, g.members.length === 1);
        followBound(s, g, ids);
        host.repaint(ids);
        break;
      }
      case "rotate": {
        const angle = rotateFrame(g.frame, g.start, p, event.shiftKey);
        const ids: string[] = [];
        g.last.clear();
        if (g.members.length === 1) g.last.merge(g.members[0].id, { angle });
        else {
          const pivot = centreOf(g.frame);
          for (const m of g.members) g.last.merge(m.id, groupRotatedPatch(m, pivot, angle));
        }
        for (const [id, patch] of g.last) { g.tx.preview(id, patch); ids.push(id); }
        followLabels(s, g.tx, g.follows, ids);
        followBound(s, g, ids);
        host.repaint(ids);
        break;
      }
      case "marquee": {
        g.now = p;
        const box = boxFrom(g.start, p);
        selection = [...new Set([...g.base, ...marqueeHits(s.elements, box).map((e) => e.id)])];
        break;
      }
      case "create": {
        let x0 = g.start[0], y0 = g.start[1];
        let w = p[0] - x0, hgt = p[1] - y0;
        if (event.shiftKey) {
          const side = Math.max(Math.abs(w), Math.abs(hgt));
          w = Math.sign(w || 1) * side; hgt = Math.sign(hgt || 1) * side;
        }
        if (event.altKey) { x0 -= w; y0 -= hgt; w *= 2; hgt *= 2; }
        const x = Math.min(x0, x0 + w), y = Math.min(y0, y0 + hgt);
        g.tx.preview(g.id, { x: r2(x), y: r2(y), width: r2(Math.abs(w)), height: r2(Math.abs(hgt)) });
        host.repaint([g.id]);
        break;
      }
      case "linear": {
        g.end = event.shiftKey ? snapAngle(g.start, p) : p;
        const created = findElement(s, g.id);
        if (created?.type === "arrow") g.endTarget = bindTargetAt(s.elements, g.end, tolerance(), (e) => e.id === g.id);
        g.tx.preview(g.id, pointsPatch([g.start, g.end]));
        host.repaint([g.id]);
        break;
      }
      case "point": {
        // A click on a point or a midpoint changes nothing; it takes a drag of a few pixels.
        if (!g.moved && Math.hypot(event.clientX - g.press[0], event.clientY - g.press[1]) < 3) break;
        g.moved = true;
        const end = g.index === 0 || g.index === g.base.length - 1;
        g.target = end && g.el.type === "arrow" ? bindTargetAt(s.elements, p, tolerance(), (e) => e.id === g.el.id || labelOwner(e) === g.el.id) : null;
        const list = pointDragPoints(s, g, p, event.shiftKey, null);
        g.tx.preview(g.el.id, pointsPatch(list));
        const ids = [g.el.id];
        for (const l of g.labels) { g.tx.preview(l.id, arrowLabelPatch(l, list)); ids.push(l.id); }
        host.repaint(ids);
        break;
      }
      case "freedraw": {
        g.tx.preview(g.id, strokePatch(g.origin, g.pts, g.pressures));
        host.repaint([g.id]);
        break;
      }
      case "erase":
        eraseAt(s, g, p);
        break;
    }
    refreshPanel();
    paintOverlay();
  }

  // Arrows bound to shapes being resized or turned, put back on their outlines each frame.
  function followBound(s: Scene, g: Extract<Gesture, { kind: "resize" | "rotate" }>, ids: string[]) {
    if (!g.followers.length) return;
    const follow = followArrows(s, g.followers, sceneLookup(finder(s)));
    for (const [id, patch] of follow) { g.tx.preview(id, patch); ids.push(id); }
  }

  function followLabels(s: Scene, tx: Transaction, follows: Follow[], ids: string[], flipX = false, flipY = false, localFlips = true) {
    for (const f of follows) {
      const owner = findElement(s, f.owner);
      if (!owner) continue;
      // One element's flips are in its own axes. A group's are in the upright box, which
      // matches a member only while that member is upright or turned a half turn.
      const turned = normalizeAngle(f.frame.angle);
      const aligned = localFlips || turned < 1e-9 || Math.abs(turned - Math.PI) < 1e-9;
      tx.preview(f.id, followPatch(f, elementFrame(owner), aligned && flipX, aligned && flipY));
      ids.push(f.id);
    }
  }

  /** Drop an uncommitted style preview (the opacity slider) and put its elements back. */
  function dropLiveStyle() {
    const tx = styleTx;
    if (!tx) return;
    const ids = tx.ids();
    tx.cancel();
    styleTx = null;
    if (ids.length) host.repaint(ids);
  }

  /** Cancel a drag or a live style change, and finish text being typed, so the scene holds only finished edits. */
  function endLive() {
    if (gesture) cancelDrag?.();
    dropLiveStyle();
    if (editing) finishText();
  }

  function finish(g: Gesture, cancelled: boolean) {
    gesture = null;
    cancelDrag = undefined;
    const s = scene();
    switch (g.kind) {
      case "move": {
        if (cancelled || !s || (!g.dx && !g.dy)) {
          for (const [node, was] of g.nodes) { if (was) node.setAttribute("transform", was); else node.removeAttribute("transform"); }
          if (g.tx) { const ids = g.tx.ids(); g.tx.cancel(); host.repaint(ids); }
          if (!cancelled && g.click) setSelection([g.click]);
          break;
        }
        const tx = g.tx ?? history.begin(s, selection);
        const moving = new Set(g.members.map((m) => m.id));
        const out = new Patches();
        for (const m of g.members) out.merge(m.id, movedPatch(m, g.dx, g.dy));
        // An arrow dragged away from a shape that stayed lets go of it.
        unbindLeft(g.members, moving, finder(s), out);
        apply(tx, out);
        const follow = followArrows(s, g.followers, sceneLookup(finder(s)));
        apply(tx, follow);
        finishEdit(tx, [...out.keys(), ...follow.keys()]);
        break;
      }
      case "resize":
      case "rotate": {
        const ids = g.tx.ids();
        if (cancelled || !s) { g.tx.cancel(); host.repaint(ids); break; }
        const together = new Set(g.members.map((m) => m.id));
        const out = unbindLeft(g.members, together, finder(s));
        apply(g.tx, out);
        finishEdit(g.tx, [...ids, ...out.keys()]);
        break;
      }
      case "marquee":
        if (cancelled) selection = g.base;
        break;
      case "create": {
        const made = s ? findElement(s, g.id) : undefined;
        const tiny = !made || (made.width * host.scale() < 3 && made.height * host.scale() < 3);
        if (cancelled || tiny) { g.tx.cancel(); host.repaint([g.id]); break; }
        tool = "select";
        el.dataset.tool = tool;
        finishEdit(g.tx, [g.id], [g.id]);
        break;
      }
      case "linear": {
        const made = s ? findElement(s, g.id) : undefined;
        const tiny = Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) * host.scale() < 3;
        if (cancelled || !s || !made || tiny) { g.tx.cancel(); host.repaint([g.id]); break; }
        const out = new Patches();
        let { startTarget, endTarget } = g;
        // Both ends on one shape would be a loop with nothing to aim at: keep the start's.
        if (startTarget && endTarget && startTarget.id === endTarget.id) endTarget = null;
        if (made.type === "arrow") {
          setBinding(made, "start", startTarget, finder(s), out);
          setBinding(made, "end", endTarget, finder(s), out);
        }
        out.merge(g.id, pointsPatch(bindPoints([g.start, g.end], startTarget ? targetOf(startTarget) : null, endTarget ? targetOf(endTarget) : null)));
        apply(g.tx, out);
        tool = "select";
        el.dataset.tool = tool;
        finishEdit(g.tx, [g.id, ...out.keys()], [g.id]);
        break;
      }
      case "point": {
        const ids = g.tx.ids();
        if (cancelled || !s || !g.moved) { g.tx.cancel(); host.repaint(ids); break; }
        const now = findElement(s, g.el.id);
        const at = now ? worldPoints(now)[g.index] : g.base[g.index];
        const out = new Patches();
        const last = g.base.length - 1;
        // The dragged end binds to the shape it was let go over, or to nothing.
        if (g.el.type === "arrow" && (g.index === 0 || g.index === last)) setBinding(g.el, g.index === 0 ? "start" : "end", g.target, finder(s), out);
        const list = pointDragPoints(s, g, at, false, g.target);
        out.merge(g.el.id, pointsPatch(list));
        for (const l of g.labels) out.merge(l.id, arrowLabelPatch(l, list));
        apply(g.tx, out);
        finishEdit(g.tx, [...ids, ...out.keys()]);
        break;
      }
      case "freedraw": {
        g.stop();
        if (cancelled || !s) { g.tx.cancel(); host.repaint([g.id]); break; }
        g.tx.preview(g.id, strokePatch(g.origin, g.pts, g.pressures));
        // The pen stays in hand for the next stroke.
        finishEdit(g.tx, [g.id], []);
        break;
      }
      case "erase": {
        for (const id of g.ids) host.node(id)?.classList.remove("is-erasing");
        if (!cancelled && s && g.ids.size) deleteNow(s, g.ids, []);
        break;
      }
    }
    refresh();
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || gesture || !host.ready()) return;
    if ((event.target as Element).closest(CHROME)) return;
    const s = scene();
    if (!s) return;
    event.preventDefault();
    // A press away from the text being typed finishes it, and does nothing else.
    if (editing) { finishText(); el.focus({ preventScroll: true }); return; }
    el.focus({ preventScroll: true });
    dropLiveStyle();
    const g = begin(event);
    if (!g) { refresh(); return; }
    gesture = g;
    paintOverlay();
    cancelDrag = dragPointer(event, el, (move) => { if (gesture === g) track(g, move); }, (cancelled) => finish(g, cancelled));
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (tool !== "select" || gesture || editing || !host.ready() || (event.target as Element).closest(CHROME)) return;
    const s = scene();
    if (!s) return;
    event.preventDefault();
    editTextAt(s, host.toScene(event.clientX, event.clientY), true);
  };

  const onHover = (event: PointerEvent) => {
    if (gesture || event.buttons || !host.ready()) return;
    if ((event.target as Element).closest(CHROME)) { el.style.cursor = ""; return; }
    const s = scene();
    if (!s) return;
    if (tool === "text") { el.style.cursor = "text"; return; }
    if (tool !== "select") { el.style.cursor = "crosshair"; return; }
    const p = host.toScene(event.clientX, event.clientY);
    const line = pointTarget(s);
    if (line) {
      const world = worldPoints(line);
      if (pointAt(world, p, reach()) >= 0 || pointAt(midpoints(world), p, reach()) >= 0) { el.style.cursor = "pointer"; return; }
    }
    const els = selected(s);
    const frame = selectionFrame(els);
    const handle = frame && showsFrame(els) ? handleAt(frame, p, host.scale(), canResize(els)) : null;
    if (handle && frame) { el.style.cursor = handleCursor(handle, frame.angle); return; }
    const over = hitTest(s.elements, p, tolerance()) || (frame && insideFrame(frame, p));
    el.style.cursor = over ? "move" : "";
  };

  const onKey = (event: KeyboardEvent) => {
    if (isTyping(event.target) || event.isComposing || !scene() || !host.ready()) return;
    if ((event.target as Element).closest?.(".drawing-controls, .drawing-toolbar")) {
      if (event.key === "Enter" || event.key === " ") return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let handled = true;
    if (event.key === "Escape") {
      if (gesture) cancelDrag?.();
      else if (!help.hidden) toggleHelp(false);
      else if (tool !== "select") setTool("select");
      else if (selection.length) setSelection([]);
      else handled = false;
    } else if (mod && !event.altKey && key === "z") step(event.shiftKey);
    else if (mod && !event.altKey && !event.shiftKey && key === "y") step(true);
    else if (mod && !event.altKey && !event.shiftKey && key === "a") selectAll();
    else if (mod || event.altKey || gesture) handled = false;
    else if (event.key === "Delete" || event.key === "Backspace") remove();
    else if (event.key === "Enter" && selection.length === 1) {
      const s = scene()!;
      const one = live(s, selection[0]);
      if (one?.type === "text") startText(s, one, null);
      else if (one && (SHAPE_TYPES.has(one.type) || isLinear(one))) startText(s, null, one);
      else handled = false;
    } else if (event.key === "?") toggleHelp();
    else if (event.key.startsWith("Arrow") && selection.length) {
      const d = event.shiftKey ? 10 : 1;
      const [dx, dy] = event.key === "ArrowLeft" ? [-d, 0] : event.key === "ArrowRight" ? [d, 0] : event.key === "ArrowUp" ? [0, -d] : [0, d];
      nudge(dx, dy);
    } else {
      const picked = TOOLS.find(([, , , k]) => k === key);
      if (picked && !event.shiftKey) setTool(picked[0]);
      else handled = false;
    }
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onHover);
  el.addEventListener("dblclick", onDoubleClick);
  el.addEventListener("keydown", onKey);
  el.dataset.tool = tool;

  return {
    /** The view moved or zoomed: the overlay and the text box follow. */
    viewChanged() { paintOverlay(); placeArea(); },
    /** The tab painted (new content, theme or a finished chunked paint). */
    painted: refresh,
    /** The file changed on disk under us: forget history and drop what's gone. */
    reset() {
      if (gesture) cancelDrag?.();
      dropLiveStyle();
      finishText(true);
      history.clear();
      refresh();
    },
    /** Cancel a drag or a live style change, and keep text being typed. The tab calls this before it saves or closes. */
    endLive,
    /** A gesture, a live style change or text editing is under way; the scene holds unstamped frames. */
    get busy() { return !!gesture || !!styleTx || !!editing; },
    get tool() { return tool; },
    get selection() { return [...selection]; },
    dispose() {
      endLive();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onHover);
      el.removeEventListener("dblclick", onDoubleClick);
      el.removeEventListener("keydown", onKey);
      overlay.remove(); toolbar.remove(); panel.remove(); help.remove();
    },
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
export type DrawingEditor = ReturnType<typeof drawingEditor>;

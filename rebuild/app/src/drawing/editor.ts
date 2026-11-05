// The drawing editor: the select tool with move, resize and rotate handles
// and a marquee; rectangle, diamond and ellipse tools; a style panel; undo and
// redo; and a sheet of its keys. It edits the scene the tab painted and asks
// the tab to repaint only the elements a change touched. Lines stay clean:
// new shapes are written with roughness 0, so other apps draw them the way
// Grove does.
//
// During a move only the touched nodes get a translate; resize and rotate
// redraw their few elements each frame. Each gesture is one undo step, and
// each element it changes gets one new version.

import { dragPointer, h, keyButton } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import {
  boxFrom, centreOf, elementFrame, frameCorners, handleAt, handleCursor, handlePoints, hitTest, isEditable,
  marqueeHits, normalizeAngle, resizeFrame, rotateFrame, rotatePoint, selectionFrame, toLocal, type Frame, type Handle,
} from "./geometry";
import { DrawingHistory, stepIds, type Transaction } from "./history";
import { findElement, type DrawingElement, type Point, type Scene } from "./scene";
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

export type Tool = "select" | "rectangle" | "diamond" | "ellipse";

interface Style { strokeColor: string; backgroundColor: string; fillStyle: string; strokeWidth: number; strokeStyle: string; opacity: number }
type StyleKey = keyof Style;

// Shared by every drawing tab for the session, like a pen left on the desk.
const defaults: Style = { strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", opacity: 100 };

const STROKES = ["#1e1e1e", "#d03030", "#2a8a3e", "#2464c8", "#e08a00", "#8a3fc0"];
const FILLS = ["transparent", "#ffd6d6", "#d3f2d8", "#d6e6ff", "#ffe8b8", "#ece0f8"];
const COLOR_RE = /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent)$/i;

const TOOLS: [Tool, string, IconName, string][] = [
  ["select", "Select", "mouse-pointer-2", "v"],
  ["rectangle", "Rectangle", "square", "r"],
  ["diamond", "Diamond", "diamond", "d"],
  ["ellipse", "Ellipse", "circle", "e"],
];

export const DRAWING_KEYS: [string, string][] = [
  ["V", "Select"],
  ["R", "Rectangle"],
  ["D", "Diamond"],
  ["E", "Ellipse"],
  ["Shift + drag", "Square or circle; keep proportions; snap turns to 15°; move on one axis"],
  ["Alt + drag", "Draw or resize from the centre"],
  ["Shift + click", "Add to or take from the selection"],
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
  | { kind: "move"; start: Point; dx: number; dy: number; members: DrawingElement[]; nodes: [SVGElement, string | null][]; click: string | null }
  | { kind: "resize"; tx: Transaction; handle: Exclude<Handle, "rotate">; frame: Frame; members: DrawingElement[]; follows: Follow[] }
  | { kind: "rotate"; tx: Transaction; start: Point; frame: Frame; members: DrawingElement[]; follows: Follow[] }
  | { kind: "marquee"; start: Point; now: Point; base: string[] }
  | { kind: "create"; tx: Transaction; id: string; start: Point };

const isLabel = (el: DrawingElement) => el.type === "text" && !!(el as DrawingElement & { containerId: string | null }).containerId;
const labelOwner = (el: DrawingElement) => (el as DrawingElement & { containerId: string | null }).containerId;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");

export function drawingEditor(host: EditorHost) {
  const { el } = host;
  const history = new DrawingHistory();
  let tool: Tool = "select";
  let selection: string[] = [];
  let gesture: Gesture | null = null;
  let styleTx: Transaction | null = null;
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
  const section = (title: string, ...rows: (HTMLElement | SVGElement)[]) => h("div", { class: "drawing-style-section" }, h("div", { class: "drawing-style-title" }, title), ...rows);
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
  panel.append(
    section("Stroke", h("div", { class: "drawing-style-row" }, ...STROKES.map((c) => swatch("strokeColor", c))), strokeHex),
    section("Fill", h("div", { class: "drawing-style-row" }, ...FILLS.map((c) => swatch("backgroundColor", c))), fillHex),
    section("Fill style", h("div", { class: "drawing-style-row" },
      choice("fillStyle", "solid", "Solid", fillIcon("solid")),
      choice("fillStyle", "hachure", "Hatched", fillIcon("hachure")),
      choice("fillStyle", "cross-hatch", "Cross-hatched", fillIcon("cross-hatch")))),
    section("Stroke width", h("div", { class: "drawing-style-row" },
      choice("strokeWidth", 1, "Thin", widthIcon(1)),
      choice("strokeWidth", 2, "Medium", widthIcon(2)),
      choice("strokeWidth", 4, "Thick", widthIcon(4)))),
    section("Stroke style", h("div", { class: "drawing-style-row" },
      choice("strokeStyle", "solid", "Solid line", dashIcon("solid")),
      choice("strokeStyle", "dashed", "Dashed line", dashIcon("dashed")),
      choice("strokeStyle", "dotted", "Dotted line", dashIcon("dotted")))),
    section("Opacity", h("div", { class: "drawing-style-row" }, opacity, opacityValue)),
  );
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());

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
  const selected = (s: Scene) => {
    const out: DrawingElement[] = [];
    for (const id of selection) { const e = live(s, id); if (e) out.push(e); }
    return out;
  };
  const tolerance = () => 6 / host.scale();

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

  function setSelection(ids: string[]) {
    selection = [...new Set(ids)];
    refresh();
  }

  function setTool(next: Tool) {
    if (gesture) cancelDrag?.();
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
  const pts = (list: Point[]) => list.map((p) => host.toScreen(p).map((v) => Math.round(v * 10) / 10).join(",")).join(" ");

  function frameOfSelection(s: Scene): Frame | null {
    const els = selected(s);
    const frame = selectionFrame(els);
    if (!frame) return null;
    if (gesture?.kind === "move") return { ...frame, x: frame.x + gesture.dx, y: frame.y + gesture.dy };
    return frame;
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
      if (frame && gesture?.kind !== "create") {
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
      if (gesture?.kind === "marquee") {
        const box = boxFrom(gesture.start, gesture.now);
        const [x, y] = host.toScreen([box.x, box.y]);
        const scale = host.scale();
        out += `<rect class="drawing-marquee" x="${x}" y="${y}" width="${box.width * scale}" height="${box.height * scale}"/>`;
      }
    }
    overlay.innerHTML = out;
  }

  const canResize = (els: DrawingElement[]) => els.length > 1 || (els.length === 1 && resizable(els[0]));

  // ----- the panel's state -----
  function refreshPanel() {
    const s = scene();
    const els = s ? selected(s) : [];
    panel.hidden = !s || !host.ready() || (tool === "select" && !els.length);
    if (panel.hidden) return;
    const value = (key: StyleKey): string | number | null => {
      if (!els.length) return defaults[key];
      const first = els[0][key];
      return els.every((e) => e[key] === first) ? first : null;
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

  function setStyle(patch: Partial<Style>, liveFrame = false) {
    Object.assign(defaults, patch);
    const s = scene();
    const els = s && !gesture ? selected(s) : [];
    if (!s || !els.length) { dropLiveStyle(); refresh(); return; }
    styleTx ??= history.begin(s, selection);
    const ids = els.map((e) => e.id);
    // Labels take their shape's ink and opacity.
    if ("strokeColor" in patch || "opacity" in patch) {
      const labelPatch: Patch = {};
      if (patch.strokeColor !== undefined) labelPatch.strokeColor = patch.strokeColor;
      if (patch.opacity !== undefined) labelPatch.opacity = patch.opacity;
      for (const list of labelsOf(s, ids).values()) for (const label of list) { styleTx.preview(label.id, labelPatch); ids.push(label.id); }
    }
    for (const e of els) styleTx.preview(e.id, patch as Patch);
    if (liveFrame) { host.repaint(ids); refreshPanel(); return; }
    const tx = styleTx;
    styleTx = null;
    finishEdit(tx, tx.ids());
  }

  function remove() {
    const s = scene();
    if (!s) return;
    const els = selected(s);
    if (!els.length) return;
    const tx = history.begin(s, selection);
    const ids = els.map((e) => e.id);
    for (const list of labelsOf(s, ids).values()) for (const label of list) ids.push(label.id);
    for (const id of ids) tx.update(id, { isDeleted: true });
    finishEdit(tx, ids, []);
  }

  function nudge(dx: number, dy: number) {
    const s = scene();
    if (!s) return;
    const els = selected(s);
    if (!els.length) return;
    const tx = history.begin(s, selection);
    const all = [...els];
    for (const list of labelsOf(s, els.map((e) => e.id)).values()) all.push(...list);
    for (const e of all) tx.update(e.id, movedPatch(e, dx, dy));
    finishEdit(tx, all.map((e) => e.id));
  }

  function step(forward: boolean) {
    const s = scene();
    if (!s || gesture) return;
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

  // ----- pointer -----
  function begin(event: PointerEvent): Gesture | null {
    const s = scene();
    if (!s) return null;
    const p = host.toScene(event.clientX, event.clientY);
    if (tool !== "select") {
      const tx = history.begin(s, selection);
      const created = tx.add(tool, {
        x: p[0], y: p[1], width: 0, height: 0,
        strokeColor: defaults.strokeColor, backgroundColor: defaults.backgroundColor, fillStyle: defaults.fillStyle,
        strokeWidth: defaults.strokeWidth, strokeStyle: defaults.strokeStyle, opacity: defaults.opacity, roughness: 0,
      });
      selection = [];
      return { kind: "create", tx, id: created.id, start: p };
    }
    const els = selected(s);
    const frame = selectionFrame(els);
    if (frame) {
      const handle = handleAt(frame, p, host.scale(), canResize(els));
      if (handle) {
        const tx = history.begin(s, selection);
        const follows: Follow[] = [];
        for (const [owner, list] of labelsOf(s, selection)) {
          const box = live(s, owner);
          if (box) for (const label of list) follows.push(followOf(label, box));
        }
        if (handle === "rotate") return { kind: "rotate", tx, start: p, frame, members: els, follows };
        return { kind: "resize", tx, handle, frame, members: els, follows };
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
    return { kind: "move", start: p, dx: 0, dy: 0, members, nodes, click };
  }

  const insideFrame = (f: Frame, p: Point) => {
    const q = toLocal(f, p);
    return q[0] >= f.x && q[0] <= f.x + f.width && q[1] >= f.y && q[1] <= f.y + f.height;
  };

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
        break;
      }
      case "resize": {
        const opts = { keepAspect: event.shiftKey, fromCentre: event.altKey };
        const r = resizeFrame(g.frame, g.handle, p, opts);
        const ids: string[] = [];
        if (g.members.length === 1) {
          const m = g.members[0];
          g.tx.preview(m.id, resizedPatch(m, g.frame, r));
          ids.push(m.id);
        } else for (const m of g.members) { g.tx.preview(m.id, groupResizedPatch(m, g.frame, r)); ids.push(m.id); }
        followLabels(s, g.tx, g.follows, ids, r.flipX, r.flipY, g.members.length === 1);
        host.repaint(ids);
        break;
      }
      case "rotate": {
        const angle = rotateFrame(g.frame, g.start, p, event.shiftKey);
        const ids: string[] = [];
        if (g.members.length === 1) { g.tx.preview(g.members[0].id, { angle }); ids.push(g.members[0].id); }
        else {
          const pivot = centreOf(g.frame);
          for (const m of g.members) { g.tx.preview(m.id, groupRotatedPatch(m, pivot, angle)); ids.push(m.id); }
        }
        followLabels(s, g.tx, g.follows, ids);
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
    }
    refreshPanel();
    paintOverlay();
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

  /** Cancel a drag or a live style change so the scene holds only finished edits. */
  function endLive() {
    if (gesture) cancelDrag?.();
    dropLiveStyle();
  }

  function finish(g: Gesture, cancelled: boolean) {
    gesture = null;
    cancelDrag = undefined;
    const s = scene();
    switch (g.kind) {
      case "move": {
        if (cancelled || !s || (!g.dx && !g.dy)) {
          for (const [node, was] of g.nodes) { if (was) node.setAttribute("transform", was); else node.removeAttribute("transform"); }
          if (!cancelled && g.click) setSelection([g.click]);
          break;
        }
        const tx = history.begin(s, selection);
        for (const m of g.members) tx.update(m.id, movedPatch(m, g.dx, g.dy));
        finishEdit(tx, g.members.map((m) => m.id));
        break;
      }
      case "resize":
      case "rotate": {
        const ids = g.tx.ids();
        if (cancelled) { g.tx.cancel(); host.repaint(ids); break; }
        finishEdit(g.tx, ids);
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
    }
    refresh();
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || gesture || !host.ready()) return;
    if ((event.target as Element).closest(".drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help")) return;
    const s = scene();
    if (!s) return;
    event.preventDefault();
    el.focus({ preventScroll: true });
    dropLiveStyle();
    const g = begin(event);
    if (!g) { refresh(); return; }
    gesture = g;
    paintOverlay();
    cancelDrag = dragPointer(event, el, (move) => { if (gesture === g) track(g, move); }, (cancelled) => finish(g, cancelled));
  };

  const onHover = (event: PointerEvent) => {
    if (gesture || event.buttons || !host.ready()) return;
    if ((event.target as Element).closest(".drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help")) { el.style.cursor = ""; return; }
    const s = scene();
    if (!s) return;
    if (tool !== "select") { el.style.cursor = "crosshair"; return; }
    const p = host.toScene(event.clientX, event.clientY);
    const els = selected(s);
    const frame = selectionFrame(els);
    const handle = frame ? handleAt(frame, p, host.scale(), canResize(els)) : null;
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
    else if (event.key === "?") toggleHelp();
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
  el.addEventListener("keydown", onKey);
  el.dataset.tool = tool;

  return {
    /** The view moved or zoomed: the overlay follows. */
    viewChanged: paintOverlay,
    /** The tab painted (new content, theme or a finished chunked paint). */
    painted: refresh,
    /** The file changed on disk under us: forget history and drop what's gone. */
    reset() {
      endLive();
      history.clear();
      refresh();
    },
    /** Cancel a drag or a live style change. The tab calls this before it saves or closes. */
    endLive,
    /** A gesture or a live style change is under way; the scene holds unstamped frames. */
    get busy() { return !!gesture || !!styleTx; },
    get tool() { return tool; },
    get selection() { return [...selection]; },
    dispose() {
      endLive();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onHover);
      el.removeEventListener("keydown", onKey);
      overlay.remove(); toolbar.remove(); panel.remove(); help.remove();
    },
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
export type DrawingEditor = ReturnType<typeof drawingEditor>;

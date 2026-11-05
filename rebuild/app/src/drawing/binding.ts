// Arrows bound to shapes. An arrow end holds `{elementId, focus, gap}`, and
// the shape lists the arrow in its `boundElements`. Grove keeps bindings
// simple: a bound end sits on the shape's outline, `gap` short of it, on the
// line from its neighbouring point toward the shape's centre (for a two-point
// arrow bound at both ends, from the other shape's centre). `focus` is kept
// as stored and new bindings write 0, which is the same aim.
//
// Everything here returns patches for the editor to run through a
// transaction, so undo puts bindings back with everything else.

import { centreOf, elementFrame, isEditable, rotatePoint, toLocal, type Frame } from "./geometry";
import { isLinear, pathMidpoint, pointsPatch, worldPoints, type Patch } from "./linear";
import type { Binding, BoundElement, DrawingElement, Json, LinearElement, Point, Scene, TextElement } from "./scene";

export const BIND_GAP = 4;

/** Where an end can bind: a shape's type and frame, maybe moved by a drag not yet written. */
export interface Target { id: string; type: string; frame: Frame }

const SHAPES = new Set(["rectangle", "diamond", "ellipse", "image"]);
const containerOf = (el: DrawingElement) => el.type === "text" ? (el as TextElement).containerId : null;

/** Shapes, images and free text take arrow ends. Labels answer for their shape instead. */
export function isBindable(el: DrawingElement): boolean {
  if (!isEditable(el)) return false;
  return SHAPES.has(el.type) || (el.type === "text" && !containerOf(el));
}

export function targetOf(el: DrawingElement, dx = 0, dy = 0): Target {
  const f = elementFrame(el);
  return { id: el.id, type: el.type, frame: { ...f, x: f.x + dx, y: f.y + dy } };
}

// How far along the ray from the centre through `o` (local, centre at 0) the outline is: 1 means `o` is on it.
function outlineScale(type: string, hw: number, hh: number, o: Point): number {
  const ax = Math.abs(o[0]), ay = Math.abs(o[1]);
  hw = Math.max(hw, 1e-6); hh = Math.max(hh, 1e-6);
  if (type === "ellipse") {
    const e = Math.hypot(o[0] / hw, o[1] / hh);
    return e > 0 ? 1 / e : Infinity;
  }
  if (type === "diamond") {
    const e = ax / hw + ay / hh;
    return e > 0 ? 1 / e : Infinity;
  }
  return Math.min(ax > 0 ? hw / ax : Infinity, ay > 0 ? hh / ay : Infinity);
}

/** Whether scene point `p` is inside the target's outline, or within `tol` of it. */
export function insideTarget(t: Target, p: Point, tol = 0): boolean {
  const c = centreOf(t.frame);
  const q = toLocal(t.frame, p);
  return outlineScale(t.type, t.frame.width / 2 + tol, t.frame.height / 2 + tol, [q[0] - c[0], q[1] - c[1]]) >= 1;
}

/** The topmost element an arrow end at `p` would bind to. `skip` leaves out the arrow itself and its label. */
export function bindTargetAt(elements: readonly DrawingElement[], p: Point, tol: number, skip: (el: DrawingElement) => boolean = () => false): DrawingElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isBindable(el) || skip(el)) continue;
    if (insideTarget(targetOf(el), p, tol)) return el;
  }
  return null;
}

/**
 * Where the line from `from` toward the target's centre crosses its outline,
 * pulled `gap` back toward `from`. Null when `from` is inside the outline.
 */
export function outlinePoint(t: Target, from: Point, gap: number): Point | null {
  const f = t.frame;
  const c = centreOf(f);
  const q = toLocal(f, from);
  const o: Point = [q[0] - c[0], q[1] - c[1]];
  const len = Math.hypot(o[0], o[1]);
  if (len < 1e-9) return null;
  const s = outlineScale(t.type, f.width / 2, f.height / 2, o);
  if (!(s < 1)) return null;
  const pull = Math.min(Math.max(gap, 0), len * (1 - s));
  const local: Point = [c[0] + o[0] * s + (o[0] / len) * pull, c[1] + o[1] * s + (o[1] / len) * pull];
  return rotatePoint(local, c, f.angle);
}

/**
 * Scene points `pts` with each bound end moved onto its target. An end whose
 * aim starts inside its target stays where it is.
 */
export function bindPoints(pts: Point[], start: Target | null, end: Target | null, startGap = BIND_GAP, endGap = BIND_GAP): Point[] {
  const out = pts.map((p) => [p[0], p[1]] as Point);
  const n = out.length;
  if (n < 2) return out;
  if (start) {
    const from = n === 2 && end ? centreOf(end.frame) : out[1];
    const p = outlinePoint(start, from, startGap);
    if (p) out[0] = p;
  }
  if (end) {
    const from = out[n - 2];
    const p = outlinePoint(end, from, endGap);
    if (p) out[n - 1] = p;
  }
  return out;
}

/** Patches keyed by element id; a second patch for an id adds to the first. */
export class Patches extends Map<string, Patch> {
  merge(id: string, patch: Patch) {
    this.set(id, { ...this.get(id), ...patch });
    return this;
  }
}

const bindingsOf = (el: DrawingElement) => isLinear(el) ? [el.startBinding, el.endBinding] as [Binding | null, Binding | null] : [null, null] as [null, null];

/** Arrows (and lines) whose ends are bound to any of `ids`, read from their own bindings. */
export function arrowsBoundTo(scene: Scene, ids: ReadonlySet<string>): DrawingElement[] {
  if (!ids.size) return [];
  const out: DrawingElement[] = [];
  for (const el of scene.elements) {
    if (!isEditable(el) || !isLinear(el)) continue;
    const [s, e] = bindingsOf(el);
    if ((s && ids.has(s.elementId)) || (e && ids.has(e.elementId))) out.push(el);
  }
  return out;
}

/** Text labels whose container is one of `ids`. */
export function labelsFor(scene: Scene, ids: ReadonlySet<string>): DrawingElement[] {
  if (!ids.size) return [];
  return scene.elements.filter((e) => isEditable(e) && e.type === "text" && ids.has(containerOf(e) ?? ""));
}

/** Where an arrow's label goes once the arrow's points are `pts`: centred on the path's midpoint. */
export function arrowLabelPatch(label: DrawingElement, pts: Point[]): Patch {
  const [mx, my] = pathMidpoint(pts);
  const w = Math.abs(label.width), h = Math.abs(label.height);
  return { x: r4(mx - w / 2), y: r4(my - h / 2), angle: 0 };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export type TargetLookup = (id: string) => Target | null;

/**
 * Bound arrows after their shapes moved: each one's ends go back onto its
 * shapes, and its label to its new midpoint. `lookup` gives each shape where
 * it is now. Arrows with no live target are left alone.
 */
export function followArrows(scene: Scene, arrows: readonly DrawingElement[], lookup: TargetLookup, out = new Patches()): Patches {
  const owners = new Set(arrows.map((a) => a.id));
  const labels = new Map<string, DrawingElement[]>();
  for (const l of labelsFor(scene, owners)) { const k = containerOf(l)!; labels.set(k, [...(labels.get(k) ?? []), l]); }
  for (const a of arrows) {
    const [s, e] = bindingsOf(a);
    const start = s ? lookup(s.elementId) : null;
    const end = e ? lookup(e.elementId) : null;
    if (!start && !end) continue;
    const pts = bindPoints(worldPoints(a), start, end, s?.gap ?? BIND_GAP, e?.gap ?? BIND_GAP);
    out.merge(a.id, pointsPatch(pts));
    for (const l of labels.get(a.id) ?? []) out.merge(l.id, arrowLabelPatch(l, pts));
  }
  return out;
}

/** The lookup for shapes as the scene holds them, with `moved` ids shifted by `dx`, `dy`. */
export function sceneLookup(find: (id: string) => DrawingElement | undefined, moved?: ReadonlySet<string>, dx = 0, dy = 0): TargetLookup {
  return (id) => {
    const el = find(id);
    if (!el || !isBindable(el)) return null;
    return moved?.has(id) ? targetOf(el, dx, dy) : targetOf(el);
  };
}

function boundList(el: DrawingElement): BoundElement[] { return el.boundElements; }

/** `boundElements` with `{id, type}` added, if it isn't there yet. */
export function boundWith(el: DrawingElement, id: string, type: string): Json | undefined {
  const list = boundList(el);
  if (list.some((b) => b.id === id)) return undefined;
  return [...list.map((b) => ({ ...b })), { type, id }] as unknown as Json;
}

/** `boundElements` without `ids`; null once nothing is left. Undefined if nothing changes. */
export function boundWithout(el: DrawingElement, ids: ReadonlySet<string>): Json | undefined {
  const list = boundList(el);
  if (!list.some((b) => ids.has(b.id))) return undefined;
  const kept = list.filter((b) => !ids.has(b.id)).map((b) => ({ ...b }));
  return (kept.length ? kept : null) as unknown as Json;
}

/** Patches that make an arrow's `which` end bound to `target` (or to nothing), keeping both shapes' lists right. */
export function setBinding(arrow: DrawingElement, which: "start" | "end", target: DrawingElement | null, find: (id: string) => DrawingElement | undefined, out = new Patches(), pending?: Patches): Patches {
  const key = which === "start" ? "startBinding" : "endBinding";
  const otherKey = which === "start" ? "endBinding" : "startBinding";
  const la = arrow as LinearElement;
  const was = la[key];
  const pendingArrow = pending?.get(arrow.id) ?? out.get(arrow.id);
  const other = pendingArrow && otherKey in pendingArrow ? pendingArrow[otherKey] as unknown as Binding | null : la[otherKey];
  if ((was?.elementId ?? null) === (target?.id ?? null)) return out;
  out.merge(arrow.id, { [key]: target ? { elementId: target.id, focus: 0, gap: BIND_GAP } as unknown as Json : null });
  // The old shape forgets the arrow unless the other end still holds it.
  if (was && was.elementId !== other?.elementId) {
    const old = find(was.elementId);
    if (old) {
      const list = withPending(old, out, pending);
      const next = boundWithout(list, new Set([arrow.id]));
      if (next !== undefined) out.merge(old.id, { boundElements: next });
    }
  }
  if (target) {
    const next = boundWith(withPending(target, out, pending), arrow.id, "arrow");
    if (next !== undefined) out.merge(target.id, { boundElements: next });
  }
  return out;
}

// An element as a view whose `boundElements` already has the patches waiting for it.
function withPending(el: DrawingElement, out: Patches, pending?: Patches): DrawingElement {
  const p = out.get(el.id) ?? pending?.get(el.id);
  if (!p || !("boundElements" in p)) return el;
  const raw = p.boundElements;
  const list = Array.isArray(raw) ? raw as unknown as BoundElement[] : [];
  return { ...el, boundElements: list } as unknown as DrawingElement;
}

/**
 * Patches to delete `ids`, with what goes with them: a deleted shape's label,
 * an arrow's label, and bindings and `boundElements` entries that pointed at
 * anything deleted. Returns the patches and the ids now deleted.
 */
export function deletePatches(scene: Scene, ids: Iterable<string>, find: (id: string) => DrawingElement | undefined): { patches: Patches; gone: Set<string> } {
  const gone = new Set<string>();
  for (const id of ids) { const el = find(id); if (el && isEditable(el)) gone.add(id); }
  for (const l of labelsFor(scene, gone)) gone.add(l.id);
  const patches = new Patches();
  for (const id of gone) patches.merge(id, { isDeleted: true });
  for (const el of scene.elements) {
    if (gone.has(el.id) || el.isDeleted || !el.known) continue;
    const [s, e] = bindingsOf(el);
    if (s && gone.has(s.elementId)) patches.merge(el.id, { startBinding: null });
    if (e && gone.has(e.elementId)) patches.merge(el.id, { endBinding: null });
    const next = boundWithout(el, gone);
    if (next !== undefined) patches.merge(el.id, { boundElements: next });
  }
  return { patches, gone };
}

/**
 * For arrows that moved, resized or turned on their own: unbind each end whose
 * shape didn't go with them (`with` holds what changed together).
 */
export function unbindLeft(arrows: readonly DrawingElement[], together: ReadonlySet<string>, find: (id: string) => DrawingElement | undefined, out = new Patches()): Patches {
  for (const a of arrows) {
    if (!isLinear(a)) continue;
    const [s, e] = bindingsOf(a);
    if (s && !together.has(s.elementId)) setBinding(a, "start", null, find, out);
    if (e && !together.has(e.elementId)) setBinding(a, "end", null, find, out);
  }
  return out;
}

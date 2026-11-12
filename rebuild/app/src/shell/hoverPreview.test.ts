import { afterEach, expect, test, vi } from "vitest";
import { readingMode } from "../editor/render";
import type { Workspace } from "../workspace";
import { installHoverPreviews } from "./hoverPreview";

type Popup = { contains: (node: unknown) => boolean };
const mocks = vi.hoisted(() => ({
  view: null as unknown, draw: vi.fn(), destroy: vi.fn(), target: "",
  // Every popover made, and the ones still attached to the body.
  popups: [] as Popup[], open: new Set<Popup>(),
}));
vi.mock("@codemirror/view", async (original) => ({ ...await original<typeof import("@codemirror/view")>(), EditorView: class {
  static findFromDOM() { return mocks.view; }
  constructor(readonly options: unknown) {}
  destroy() { mocks.destroy(); }
} }));
vi.mock("../editor/embeds", async (original) => ({ ...await original<typeof import("../editor/embeds")>(),
  NoteEmbedWidget: class { constructor(target: string) { mocks.target = target; } toDOM() { mocks.draw(); return {}; } destroy() {} },
}));
// Elements inside a popover carry `in: popup`; that is what contains() checks.
vi.mock("./dom", () => ({ h: () => {
  const popup: Popup & Record<string, unknown> = {
    addEventListener() {}, contains: (node) => (node as { in?: unknown } | null)?.in === popup,
    remove: () => { mocks.destroy(); mocks.open.delete(popup); },
    offsetWidth: 450, offsetHeight: 400, style: {},
  };
  mocks.popups.push(popup);
  return popup;
} }));

let listeners = () => 0;
const resolveSpy = vi.fn((_name: string, _from: string | null) => "Note.md");

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup(hit?: { closest: (selector: string) => unknown; contains: () => boolean }) {
  vi.useFakeTimers();
  mocks.popups.length = 0;
  mocks.open.clear();
  const doc = new EventTarget();
  // Count listeners still live: those added with a signal stop counting once it aborts.
  const live: (AbortSignal | undefined)[] = [];
  const add = doc.addEventListener.bind(doc);
  doc.addEventListener = (type: string, fn: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
    live.push(typeof options === "object" ? options.signal : undefined);
    add(type, fn, options);
  };
  const win = { setTimeout, addEventListener: (_type: string, _fn: unknown, options?: AddEventListenerOptions) => { live.push(options?.signal); } };
  listeners = () => live.filter((signal) => !signal?.aborted).length;
  const rect = { x: 100, y: 100, left: 100, top: 100, bottom: 120 };
  const link = { dataset: { href: "Note" }, getBoundingClientRect: () => rect };
  const el = hit ?? { closest: (selector: string) => selector === "[data-href]" ? link : null, contains: () => false };
  Object.assign(doc, { body: { append: (popup: Popup) => mocks.open.add(popup) }, elementFromPoint: () => el });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { platform: "Linux" });
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const source = { state: { facet: (facet: unknown) => facet === readingMode ? false : ({}) }, posAtCoords: () => null };
  mocks.view = source;
  const ws = { view: source, resolve: resolveSpy, vault: { files: [] }, embeds: {}, editors: { pathOf: () => "Source.md" }, on: () => () => {} };
  installHoverPreviews(ws as unknown as Workspace);
  const event = (type: string, props = {}) => {
    const e = new Event(type);
    const { target = el, ...attributes } = props as { target?: unknown };
    Object.defineProperty(e, "target", { value: target });
    Object.assign(e, { ctrlKey: true, pointerType: "mouse", clientX: 120, clientY: 110, buttons: 0, ...attributes });
    doc.dispatchEvent(e);
  };
  return event;
}

test("preview opens once after 350ms, stays through movement, and closes after 180ms outside", () => {
  const event = setup();
  event("pointermove");
  vi.advanceTimersByTime(349);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("pointermove");
  vi.advanceTimersByTime(1);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  event("pointermove");
  vi.advanceTimersByTime(500);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  event("pointermove", { ctrlKey: false, target: { closest: () => null } });
  vi.advanceTimersByTime(179);
  expect(mocks.destroy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(mocks.destroy).toHaveBeenCalled();
});

test("releasing Ctrl while the pointer remains on the link keeps the preview", () => {
  const event = setup();
  event("pointermove");
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  // The modifier opens the preview. Leaving both the link and the popover is what closes it.
  event("pointermove", { ctrlKey: false });
  vi.advanceTimersByTime(500);
  expect(mocks.destroy).not.toHaveBeenCalled();
});

test("leaving cancels pending work; returning and Escape can restart it", () => {
  const event = setup();
  event("pointermove");
  vi.advanceTimersByTime(100);
  event("pointermove", { ctrlKey: false });
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("pointermove");
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  event("keydown", { key: "Escape" });
  expect(mocks.destroy).toHaveBeenCalled();
});

test("macOS uses Cmd for previews", () => {
  const event = setup();
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  event("pointermove");
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("pointermove", { ctrlKey: false, metaKey: true });
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
});

test("a mouse move without a pointer move does not open a preview", () => {
  const event = setup();
  event("mousemove");
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
});

test("pressing Ctrl while the pointer stays on a link opens the preview", () => {
  const event = setup();
  event("pointermove", { ctrlKey: false });
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  // The key event's target is not the link. The element under the last pointer is.
  event("keydown", { key: "Control", ctrlKey: true, target: { closest: () => null } });
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
});

test("macOS Cmd press while still opens the preview and Ctrl does not", () => {
  const event = setup();
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  event("pointermove", { ctrlKey: false, metaKey: false });
  event("keydown", { key: "Control", ctrlKey: true, metaKey: false, target: { closest: () => null } });
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("keydown", { key: "Meta", ctrlKey: false, metaKey: true, target: { closest: () => null } });
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
});

test("a rendered embed without data-href still previews its target", () => {
  const embed = { dataset: { embedHref: "Embedded#Head" }, getBoundingClientRect: () => ({ x: 40, y: 50, left: 40, top: 50, bottom: 200, right: 300 }) };
  const event = setup({ closest: (selector: string) => selector === "[data-embed-href]" ? embed : null, contains: () => false });
  event("pointermove");
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  expect(mocks.target).toBe("Note.md#Head");
});

test("touch does not open a preview, a pen does, and a pressed button does not", () => {
  const event = setup();
  event("pointermove", { pointerType: "touch" });
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("pointermove", { buttons: 1 });
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("pointermove", { pointerType: "pen", buttons: 0 });
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
});

// Nested previews. `inPopup(n)` is an element inside the nth popover made.
const rect = { x: 10, y: 10, left: 10, top: 10, bottom: 30, right: 80 };
const linkIn = (popup: Popup, href: string) => ({ in: popup, closest: (selector: string) =>
  selector === "[data-href]" ? { dataset: { href }, getBoundingClientRect: () => rect } : null });
const bodyIn = (popup: Popup) => ({ in: popup, closest: () => null });
const outside = { closest: () => null };
type Fire = ReturnType<typeof setup>;
// Ctrl+hover the root link, then a link in each new popover, `depth` popovers in all.
function chain(event: Fire, depth: number) {
  event("pointermove");
  vi.advanceTimersByTime(350);
  for (let i = 1; i < depth; i++) {
    const parent = mocks.popups[i - 1];
    event("pointermove", { target: bodyIn(parent), ctrlKey: false });
    event("pointermove", { target: linkIn(parent, `Level${i}`) });
    vi.advanceTimersByTime(350);
  }
  expect(mocks.open.size).toBe(depth);
}

test("Ctrl+hover inside a preview stacks a preview, depth 3 and more, keeping every parent", () => {
  const event = setup();
  chain(event, 4);
  expect([...mocks.open]).toEqual(mocks.popups);
  // Each nested link resolves from the note its own preview shows, not from the editor.
  expect(resolveSpy.mock.calls.map(([name, from]) => [name, from])).toEqual([
    ["Note", "Source.md"], ["Level1", "Note.md"], ["Level2", "Note.md"], ["Level3", "Note.md"],
  ]);
  // Moving around the deepest preview keeps the whole chain.
  event("pointermove", { target: bodyIn(mocks.popups[3]), ctrlKey: false });
  vi.advanceTimersByTime(1000);
  expect(mocks.open.size).toBe(4);
});

test("a link inside a preview needs Ctrl, even when the editor is in Reading view", () => {
  const event = setup();
  mocks.view = { state: { facet: () => true }, posAtCoords: () => null };
  event("pointermove", { ctrlKey: false });
  vi.advanceTimersByTime(350);
  expect(mocks.open.size).toBe(1);
  event("pointermove", { target: linkIn(mocks.popups[0], "Other"), ctrlKey: false });
  vi.advanceTimersByTime(1000);
  expect(mocks.open.size).toBe(1);
  event("pointermove", { target: linkIn(mocks.popups[0], "Other") });
  vi.advanceTimersByTime(350);
  expect(mocks.open.size).toBe(2);
});

test("leaving a child back into its parent closes that child and deeper ones after 180ms", () => {
  const event = setup();
  chain(event, 4);
  event("pointermove", { target: bodyIn(mocks.popups[1]), ctrlKey: false });
  vi.advanceTimersByTime(179);
  expect(mocks.open.size).toBe(4);
  vi.advanceTimersByTime(1);
  expect([...mocks.open]).toEqual(mocks.popups.slice(0, 2));
  // Coming back before the delay keeps the child.
  event("pointermove", { target: linkIn(mocks.popups[1], "Again") });
  vi.advanceTimersByTime(350);
  expect(mocks.open.size).toBe(3);
  event("pointermove", { target: bodyIn(mocks.popups[1]), ctrlKey: false });
  vi.advanceTimersByTime(100);
  event("pointermove", { target: bodyIn(mocks.popups.at(-1)!), ctrlKey: false });
  vi.advanceTimersByTime(1000);
  expect(mocks.open.size).toBe(3);
});

test("the link that opened a child keeps it without Ctrl; the root link keeps only the first", () => {
  const event = setup();
  chain(event, 3);
  event("pointermove", { target: linkIn(mocks.popups[1], "Level2"), ctrlKey: false });
  vi.advanceTimersByTime(1000);
  expect(mocks.open.size).toBe(3);
  event("pointermove", { ctrlKey: false });
  vi.advanceTimersByTime(180);
  expect([...mocks.open]).toEqual(mocks.popups.slice(0, 1));
  expect(mocks.draw).toHaveBeenCalledTimes(3);
});

test("Ctrl+hovering another link in a parent replaces that parent's children at once", () => {
  const event = setup();
  chain(event, 4);
  event("pointermove", { target: linkIn(mocks.popups[0], "Sibling") });
  expect([...mocks.open]).toEqual(mocks.popups.slice(0, 1));
  vi.advanceTimersByTime(350);
  expect(mocks.open.size).toBe(2);
  expect(mocks.popups).toHaveLength(5);
});

test("leaving the whole chain closes it after 180ms with no previews or listeners left", () => {
  const event = setup();
  const before = listeners();
  chain(event, 12);
  expect(listeners()).toBeGreaterThan(before);
  event("pointermove", { target: outside, ctrlKey: false });
  vi.advanceTimersByTime(179);
  expect(mocks.open.size).toBe(12);
  vi.advanceTimersByTime(1);
  expect(mocks.open.size).toBe(0);
  expect(listeners()).toBe(before);
  // Twelve popovers, each with its own detached view, all destroyed.
  expect(mocks.destroy).toHaveBeenCalledTimes(24);
  vi.advanceTimersByTime(1000);
  expect(mocks.draw).toHaveBeenCalledTimes(12);
});

test("Escape and typing close the whole chain at once", () => {
  for (const key of ["Escape", "a"]) {
    const event = setup();
    const before = listeners();
    chain(event, 3);
    event("keydown", { key, target: bodyIn(mocks.popups[2]) });
    expect(mocks.open.size).toBe(0);
    expect(listeners()).toBe(before);
    vi.useRealTimers();
  }
});

test("a wheel or scroll in a parent closes only the previews above it; outside closes them all", () => {
  const event = setup();
  const before = listeners();
  chain(event, 4);
  event("wheel", { target: bodyIn(mocks.popups[3]) });
  expect(mocks.open.size).toBe(4);
  event("scroll", { target: bodyIn(mocks.popups[1]) });
  expect([...mocks.open]).toEqual(mocks.popups.slice(0, 2));
  event("mousedown", { target: bodyIn(mocks.popups[0]) });
  expect(mocks.open.size).toBe(1);
  event("wheel", { target: outside });
  expect(mocks.open.size).toBe(0);
  expect(listeners()).toBe(before);
});

test("a nested preview that cannot open (a non-note link) leaves its parents open", () => {
  const event = setup();
  chain(event, 2);
  resolveSpy.mockReturnValueOnce("image.png");
  event("pointermove", { target: linkIn(mocks.popups[1], "image.png") });
  vi.advanceTimersByTime(350);
  expect(mocks.open.size).toBe(2);
  event("pointermove", { target: bodyIn(mocks.popups[1]), ctrlKey: false });
  vi.advanceTimersByTime(1000);
  expect(mocks.open.size).toBe(2);
});

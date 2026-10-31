import { afterEach, expect, test, vi } from "vitest";
import { readingMode } from "../editor/render";
import type { Workspace } from "../workspace";
import { installHoverPreviews } from "./hoverPreview";

const mocks = vi.hoisted(() => ({ view: null as unknown, draw: vi.fn(), destroy: vi.fn() }));
vi.mock("@codemirror/view", async (original) => ({ ...await original<typeof import("@codemirror/view")>(), EditorView: class {
  static findFromDOM() { return mocks.view; }
  constructor(readonly options: unknown) {}
  destroy() { mocks.destroy(); }
} }));
vi.mock("../editor/embeds", async (original) => ({ ...await original<typeof import("../editor/embeds")>(),
  NoteEmbedWidget: class { toDOM() { mocks.draw(); return {}; } destroy() {} },
}));
vi.mock("./dom", () => ({ h: () => ({
  addEventListener() {}, contains: () => false, remove: () => mocks.destroy(),
  offsetWidth: 450, offsetHeight: 400, style: {},
}) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup() {
  vi.useFakeTimers();
  const doc = new EventTarget();
  const rect = { x: 100, y: 100, left: 100, top: 100, bottom: 120 };
  const link = { dataset: { href: "Note" }, getBoundingClientRect: () => rect };
  const el = { closest: (selector: string) => selector === "[data-href]" ? link : null, contains: () => false };
  Object.assign(doc, { body: { append() {} }, elementFromPoint: () => el });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { setTimeout, addEventListener() {} });
  vi.stubGlobal("navigator", { platform: "Linux" });
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const source = { state: { facet: (facet: unknown) => facet === readingMode ? false : ({}) }, posAtCoords: () => null };
  mocks.view = source;
  const ws = { view: source, resolve: () => "Note.md", vault: { files: [] }, embeds: {}, editors: { pathOf: () => "Source.md" }, on: () => () => {} };
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

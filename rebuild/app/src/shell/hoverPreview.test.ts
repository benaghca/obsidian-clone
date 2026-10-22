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
  Object.assign(doc, { body: { append() {} } });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { setTimeout, addEventListener() {} });
  vi.stubGlobal("navigator", { platform: "Linux" });
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  const source = { state: { facet: (facet: unknown) => facet === readingMode ? false : ({}) } };
  mocks.view = source;
  const rect = { x: 100, y: 100, left: 100, top: 100, bottom: 120 };
  const link = { dataset: { href: "Note" }, getBoundingClientRect: () => rect };
  const el = { closest: (selector: string) => selector === "[data-href]" ? link : null };
  const ws = { view: source, resolve: () => "Note.md", vault: { files: [] }, embeds: {}, editors: { pathOf: () => "Source.md" }, on: () => () => {} };
  installHoverPreviews(ws as unknown as Workspace);
  const event = (type: string, props = {}) => {
    const e = new Event(type);
    Object.defineProperty(e, "target", { value: el });
    Object.assign(e, { ctrlKey: true, ...props });
    doc.dispatchEvent(e);
  };
  return event;
}

test("preview opens once after 350ms, stays through movement, and closes after 180ms outside", () => {
  const event = setup();
  event("mousemove");
  vi.advanceTimersByTime(349);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("mousemove");
  vi.advanceTimersByTime(1);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  event("mousemove");
  vi.advanceTimersByTime(500);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  event("mousemove", { ctrlKey: false });
  vi.advanceTimersByTime(179);
  expect(mocks.destroy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(mocks.destroy).toHaveBeenCalled();
});

test("releasing Ctrl while the pointer remains on the link keeps the preview", () => {
  const event = setup();
  event("mousemove");
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  // The modifier opens the preview. Leaving both the link and the popover is what closes it.
  event("mousemove", { ctrlKey: false });
  vi.advanceTimersByTime(500);
  expect(mocks.destroy).not.toHaveBeenCalled();
});

test("leaving cancels pending work; returning and Escape can restart it", () => {
  const event = setup();
  event("mousemove");
  vi.advanceTimersByTime(100);
  event("mousemove", { ctrlKey: false });
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("mousemove");
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
  event("keydown", { key: "Escape" });
  expect(mocks.destroy).toHaveBeenCalled();
});

test("macOS uses Cmd for previews", () => {
  const event = setup();
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  event("mousemove");
  vi.advanceTimersByTime(400);
  expect(mocks.draw).not.toHaveBeenCalled();
  event("mousemove", { ctrlKey: false, metaKey: true });
  vi.advanceTimersByTime(350);
  expect(mocks.draw).toHaveBeenCalledTimes(1);
});

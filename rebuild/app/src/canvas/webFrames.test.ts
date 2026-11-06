import { expect, test } from "vitest";
import { WEB_FRAME_CAP, webFrameFits, webFrameSlots, type WebFrameCard, type WebFrameView } from "./webFrames";

const view = (over: Partial<WebFrameView> = {}): WebFrameView => ({
  x: 0, y: 0, width: 1000, height: 800, focusX: 500, focusY: 400, scale: 1, titles: false, ...over,
});

function card(id: string, x: number, wants = true): WebFrameCard {
  return { id, x, y: 0, width: 200, height: 120, wants };
}

test("frames stay off in title mode, off screen, and under the title size", () => {
  const cards = [card("a", 0), card("b", 5000), card("c", 100, false)];
  expect(webFrameSlots(cards, view({ titles: true }), [])).toEqual([]);
  expect(webFrameSlots(cards, view(), [])).toEqual(["a"]);
  expect(webFrameFits({ width: 28, height: 22 }, view())).toBe(false);
  expect(webFrameFits({ width: 400, height: 120 }, view())).toBe(true);
  expect(webFrameFits({ width: 400, height: 120 }, view({ scale: 0.1 }))).toBe(false);
  expect(webFrameSlots([card("tiny", 0)], view(), []).length).toBe(1);
  const tiny = { ...card("tiny", 0), width: 28, height: 22 };
  expect(webFrameSlots([tiny], view(), [])).toEqual([]);
});

test("at most six live frames, nearest first, and a live one stays until it leaves", () => {
  const cards = Array.from({ length: 8 }, (_, i) => card(String(i), i * 120));
  const first = webFrameSlots(cards, view(), []);
  expect(first).toHaveLength(WEB_FRAME_CAP);
  // Card 3's center (460, 60) is the closest to the focus (500, 400).
  expect(first[0]).toBe("3");
  const again = webFrameSlots(cards, view(), first);
  expect(again).toEqual(first);
  const left = webFrameSlots(cards.filter((c) => c.id !== first[0]), view(), first);
  expect(left).toHaveLength(WEB_FRAME_CAP);
  expect(left).not.toContain(first[0]);
  expect(left.slice(0, WEB_FRAME_CAP - 1)).toEqual(first.slice(1));
});

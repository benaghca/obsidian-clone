import { expect, it } from "vitest";
import { cardSpan, columnSpan, KANBAN, kanbanCardHeight, nearestIndex, trackWidth } from "./kanbanLayout";

it("sizes a card from its cover and property lines, as the stylesheet does", () => {
  // 2 border + 16 padding + 20 title; then 4 + 20 per property line; a cover adds its height.
  expect(kanbanCardHeight(0, 0)).toBe(38);
  expect(kanbanCardHeight(2, 0)).toBe(82);
  expect(kanbanCardHeight(3, 128)).toBe(38 + 4 + 60 + 128);
});

it("mounts the columns in view and one more each side", () => {
  const w = 272, step = w + KANBAN.gap;
  expect(trackWidth(0, w)).toBe(0);
  expect(trackWidth(3, w)).toBe(2 * KANBAN.pad + 3 * w + 2 * KANBAN.gap);
  // 1,000 px shows columns 0–3 (the 4th partly); overscan adds column 4.
  expect(columnSpan(200, 0, 1000, w)).toEqual({ first: 0, end: 5 });
  const at = 50 * step + KANBAN.pad;
  expect(columnSpan(200, at, 1000, w)).toEqual({ first: 49, end: 55 });
  expect(columnSpan(200, trackWidth(200, w) - 1000, 1000, w)).toEqual({ first: 195, end: 200 });
  expect(columnSpan(3, 0, 5000, w)).toEqual({ first: 0, end: 3 });
  expect(columnSpan(0, 0, 1000, w)).toEqual({ first: 0, end: 0 });
});

it("draws only the cards in view and three past each edge, whatever the column's length", () => {
  const pitch = 90;
  expect(cardSpan(10_000, 0, 600, pitch)).toEqual({ first: 0, end: 10 });
  expect(cardSpan(10_000, 450_000, 600, pitch)).toEqual({ first: 4997, end: 5010 });
  expect(cardSpan(10_000, 10_000 * pitch, 600, pitch)).toEqual({ first: 9997, end: 10_000 });
  expect(cardSpan(2, 0, 600, pitch)).toEqual({ first: 0, end: 2 });
  expect(cardSpan(0, 0, 600, pitch)).toEqual({ first: 0, end: 0 });
  for (let top = 0; top < 50_000; top += 777) {
    const { first, end } = cardSpan(10_000, top, 700, pitch);
    expect(end - first).toBeLessThanOrEqual(Math.ceil(700 / pitch) + 7);
    expect(first * pitch).toBeLessThanOrEqual(top);
    expect(end * pitch).toBeGreaterThanOrEqual(Math.min(10_000 * pitch, top + 700));
  }
});

it("moves Left/Right to the card at the same height on screen", () => {
  const pitch = 90;
  expect(nearestIndex(3, 0, 0, 10, pitch)).toBe(3);
  // The other column is scrolled 900 px further: the same height is 10 cards on.
  expect(nearestIndex(3, 0, 900, 50, pitch)).toBe(13);
  expect(nearestIndex(40, 3000, 0, 50, pitch)).toBe(7);
  expect(nearestIndex(9, 0, 0, 4, pitch)).toBe(3);
});

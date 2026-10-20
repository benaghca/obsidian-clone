import { expect, test } from "vitest";
import { SEPARATOR, tidy } from "./menu";

test("tidy drops falsy entries and separators at the ends or doubled", () => {
  const a = { title: "A" };
  const b = { title: "B" };
  expect(tidy([SEPARATOR, null, a, false, SEPARATOR, SEPARATOR, undefined, b, SEPARATOR])).toEqual([a, SEPARATOR, b]);
  expect(tidy([SEPARATOR, false])).toEqual([]);
});

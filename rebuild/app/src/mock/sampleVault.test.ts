import { expect, test } from "vitest";
import { sampleVault } from "./sampleVault";

test("big note matches the spec's stress case", () => {
  const big = sampleVault()["Big note.md"];
  expect(big.split("\n").length).toBe(5000);
  expect(big.length).toBeGreaterThan(250_000);
});

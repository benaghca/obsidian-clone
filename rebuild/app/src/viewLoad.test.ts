import { expect, test } from "vitest";
import { hasBaseFence } from "./editor/embeds";
import { noteNeedsBase } from "./viewLoad";

test("a base fence matches the editor, backticks or tildes", () => {
  expect(hasBaseFence("```base\nviews:\n```")).toBe(true);
  expect(noteNeedsBase("```base\nviews:\n```")).toBe(true);
  expect(noteNeedsBase("~~~\nbase\n~~~")).toBe(false);
  expect(noteNeedsBase("~~~base\nviews:\n~~~")).toBe(true);
  expect(noteNeedsBase("~~~~base\nviews:\n~~~~")).toBe(true);
  expect(noteNeedsBase("   ```base\n")).toBe(true);
  expect(noteNeedsBase("   ~~~base\n")).toBe(true);
  expect(noteNeedsBase("    ```base\n")).toBe(false);
  expect(noteNeedsBase("```bash\n")).toBe(false);
  expect(noteNeedsBase("~~~bash\n")).toBe(false);
  expect(noteNeedsBase("```BASE\n")).toBe(false);
  expect(noteNeedsBase("Before\n\n~~~base\nviews:\n~~~\n")).toBe(true);
  expect(noteNeedsBase("~~~base\r\nviews:\r\n~~~\r\n")).toBe(true);
  expect(noteNeedsBase("![[View.base]]")).toBe(true);
  expect(noteNeedsBase("![[View.base#Table]]")).toBe(true);
  expect(noteNeedsBase("plain text")).toBe(false);
});

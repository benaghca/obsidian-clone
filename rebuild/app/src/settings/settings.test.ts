import { expect, test } from "vitest";
import { accentVars, hexToHsl } from "./accent";
import { excluder } from "./exclude";
import { APP, APPEARANCE, defaults, sanitize, sanitizeHotkeys, serialize, serializeHotkeys } from "./schema";

test("unknown or invalid values fall back to defaults quietly; unknown keys are kept for the next write", () => {
  const { values, extra } = sanitize(APP, {
    useTab: false,
    tabSize: 99,
    newLinkFormat: "weird",
    userIgnoreFilters: ["Archive/", 3],
    futureSetting: { a: 1 },
  });
  expect(values.useTab).toBe(false);
  expect(values.tabSize).toBe(4);
  expect(values.newLinkFormat).toBe("shortest");
  expect(values.userIgnoreFilters).toEqual([]);
  expect(extra).toEqual({ futureSetting: { a: 1 } });
  expect(sanitize(APP, null).values).toEqual(defaults(APP));
  expect(sanitize(APP, [1, 2]).values).toEqual(defaults(APP));
  // Fonts and colours that could break out of their CSS are refused.
  const a = sanitize(APPEARANCE, { textFontFamily: 'x"; } body { display:none', accentColor: "red", zoomLevel: 0.7, baseFontSize: 18 }).values;
  expect([a.textFontFamily, a.accentColor, a.zoomLevel, a.baseFontSize]).toEqual(["", "", 0, 18]);
});

test("files keep only what differs from the defaults, plus unknown keys", () => {
  const values = { ...defaults(APP), useTab: false, userIgnoreFilters: ["Archive/"] };
  const text = serialize(APP, values, { futureSetting: 1 });
  expect(JSON.parse(text)).toEqual({ futureSetting: 1, useTab: false, userIgnoreFilters: ["Archive/"] });
  expect(text).toContain('\n  "useTab": false');
  expect(serialize(APP, defaults(APP))).toBe("{}\n");
  expect(defaults(APP).attachmentFolderPath).toBe("/");
});

test("hotkeys.json: Obsidian's shape, invalid entries dropped, sorted on write", () => {
  const map = sanitizeHotkeys({
    "editor:toggle-bold": [{ modifiers: ["Mod"], key: "B" }],
    "app:go-back": [],
    bad: [{ modifiers: ["Hyper"], key: "x" }],
    worse: "Ctrl+P",
  });
  expect(Object.keys(map)).toEqual(["editor:toggle-bold", "app:go-back"]);
  expect(Object.keys(JSON.parse(serializeHotkeys(map)))).toEqual(["app:go-back", "editor:toggle-bold"]);
  expect(sanitizeHotkeys(null)).toEqual({});
});

test("excluded files: folder paths, file paths and /regular expressions/", () => {
  const ex = excluder(["Archive/", "Daily", "Inbox/Scratch", "/draft/i", "/([/"]);
  expect(ex("Archive/Old.md")).toBe(true);
  expect(ex("Archived.md")).toBe(false);
  expect(ex("Daily/2026-10-03.md")).toBe(true);
  expect(ex("Daily notes.md")).toBe(false);
  expect(ex("Inbox/Scratch.md")).toBe(true);
  expect(ex("Projects/DRAFT plan.md")).toBe(true);
  expect(ex("Ideas.md")).toBe(false);
  expect(excluder([])("anything.md")).toBe(false);
});

test("the accent: hue, saturation and lightness, lifted for the dark theme", () => {
  expect(hexToHsl("#27867a")).toEqual([172, 55, 34]);
  expect(hexToHsl("#808080")).toEqual([0, 0, 50]);
  const teal = accentVars("");
  expect(teal["--accent-h"]).toBe("172");
  expect(parseInt(teal["--accent-l-dark-text"])).toBeGreaterThanOrEqual(50);
  const pale = accentVars("#e0f0ee");
  expect(parseInt(pale["--accent-l-dark-text"])).toBeLessThanOrEqual(78);
});

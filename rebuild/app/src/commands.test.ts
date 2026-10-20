import { expect, test } from "vitest";
import { CommandRegistry, fromStored, hotkeyFromEvent, hotkeyLabel, toStored } from "./commands";

const key = (init: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, code: "", preventDefault() {}, stopPropagation() {}, ...init }) as KeyboardEvent;

test("hotkeys print the way Obsidian prints them", () => {
  expect(hotkeyLabel({ mod: true, key: "p" })).toBe("Ctrl + P");
  expect(hotkeyLabel({ mod: true, alt: true, key: "arrowleft" })).toBe("Ctrl + Alt + ←");
  expect(hotkeyLabel({ key: "f2" })).toBe("F2");
});

test("a chord runs its command once, only while available; plain keys are ignored", () => {
  const reg = new CommandRegistry();
  let ran = 0;
  let available = true;
  reg.register({ id: "x", name: "X", hotkeys: [{ mod: true, key: "b" }], when: () => available, run: () => ran++ });
  expect(reg.handleKeydown(key({ key: "b" }))).toBe(false);
  expect(reg.handleKeydown(key({ key: "b", code: "KeyB", ctrlKey: true }))).toBe(true);
  available = false;
  expect(reg.handleKeydown(key({ key: "b", code: "KeyB", ctrlKey: true }))).toBe(false);
  expect(ran).toBe(1);
  expect(reg.menuItem("x").disabled).toBe(true);
  expect(reg.menuItem("x").hotkey).toBe("Ctrl + B");
});

test("bracket hotkeys match the physical key when Alt changes the character", () => {
  const reg = new CommandRegistry();
  let ran = 0;
  reg.register({ id: "l", name: "L", hotkeys: [{ mod: true, alt: true, key: "[" }], run: () => ran++ });
  expect(reg.handleKeydown(key({ key: "“", code: "BracketLeft", ctrlKey: true, altKey: true }))).toBe(true);
  expect(ran).toBe(1);
});

test("hotkeys wait while a modal or menu has the keyboard, and ids are unique", () => {
  const reg = new CommandRegistry();
  reg.register({ id: "p", name: "P", hotkeys: [{ mod: true, key: "p" }], run: () => {} });
  reg.suspended = () => true;
  expect(reg.handleKeydown(key({ key: "p", ctrlKey: true }))).toBe(false);
  expect(() => reg.register({ id: "p", name: "again", run: () => {} })).toThrow();
});

test("custom hotkeys replace the defaults everywhere, and can be removed or reset", () => {
  const reg = new CommandRegistry();
  let a = 0;
  let b = 0;
  reg.register(
    { id: "a", name: "A", hotkeys: [{ mod: true, key: "p" }], run: () => a++ },
    { id: "b", name: "B", run: () => b++ },
  );
  let changed = 0;
  reg.onChange(() => changed++);
  reg.setCustomHotkeys({ b: [{ mod: true, key: "p" }], a: [] });
  expect(changed).toBe(1);
  expect(reg.hotkeysOf("a")).toEqual([]);
  expect(reg.hotkey("b")).toBe("Ctrl + P");
  expect(reg.handleKeydown(key({ key: "p", code: "KeyP", ctrlKey: true }))).toBe(true);
  expect([a, b]).toEqual([0, 1]);
  expect(reg.isCustomized("a")).toBe(true);
  // Both on the same keys: each sees the other as a conflict.
  reg.setCustomHotkeys({ b: [{ mod: true, key: "p" }] });
  expect(reg.conflicts({ mod: true, key: "p" }, "a").map((c) => c.id)).toEqual(["b"]);
  expect(reg.conflicts({ mod: true, key: "p" }, "b").map((c) => c.id)).toEqual(["a"]);
  reg.setCustomHotkeys({});
  expect(reg.hotkey("a")).toBe("Ctrl + P");
  expect(reg.hotkey("b")).toBeUndefined();
});

test("a core plugin that is off takes its commands away: not listed, not run, hotkeys free", () => {
  const reg = new CommandRegistry();
  let on = true;
  let ran = 0;
  reg.pluginEnabled = () => on;
  reg.register({ id: "daily", name: "Daily", plugin: "daily-notes", hotkeys: [{ mod: true, key: "d" }], run: () => ran++ }, { id: "core", name: "Core", run: () => {} });
  on = false;
  expect(reg.all().map((c) => c.id)).toEqual(["core"]);
  expect(reg.handleKeydown(key({ key: "d", code: "KeyD", ctrlKey: true }))).toBe(false);
  expect(reg.run("daily")).toBe(false);
  expect(reg.conflicts({ mod: true, key: "d" })).toEqual([]);
  on = true;
  expect(reg.handleKeydown(key({ key: "d", code: "KeyD", ctrlKey: true }))).toBe(true);
  expect(ran).toBe(1);
});

test("a key press becomes a hotkey (modifiers alone don't), and hotkeys.json's format round-trips", () => {
  const ev = (init: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
  expect(hotkeyFromEvent(ev({ key: "Control", ctrlKey: true }))).toBeNull();
  expect(hotkeyFromEvent(ev({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }))).toEqual({ key: "p", mod: true, shift: true });
  expect(hotkeyFromEvent(ev({ key: "“", code: "BracketLeft", altKey: true, metaKey: true }))).toEqual({ key: "[", mod: true, alt: true });
  expect(toStored({ mod: true, shift: true, key: "p" })).toEqual({ modifiers: ["Mod", "Shift"], key: "P" });
  expect(toStored({ mod: true, alt: true, key: "arrowleft" })).toEqual({ modifiers: ["Mod", "Alt"], key: "ArrowLeft" });
  expect(toStored({ key: "f2" })).toEqual({ modifiers: [], key: "F2" });
  for (const hk of [{ mod: true, key: "," }, { alt: true, key: "enter" }, { mod: true, shift: true, key: "pagedown" }, { key: "f12" }]) {
    expect(fromStored(toStored(hk))).toEqual(hk);
  }
  expect(fromStored({ modifiers: ["Ctrl"], key: ";" })).toEqual({ mod: true, key: ";" });
});

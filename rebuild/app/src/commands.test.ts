import { expect, test } from "vitest";
import { CommandRegistry, hotkeyLabel } from "./commands";

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

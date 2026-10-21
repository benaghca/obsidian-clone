// The command registry. Every action the app offers is registered here once,
// with an id, an Obsidian-style name ("Group: Action" for the views and
// tools, plain for core actions), an optional icon and default hotkeys.
// Buttons, menus, hotkeys and the command palette all run commands through
// it, so a command's name, icon, hotkey and availability are the same
// everywhere.
//
// Hotkeys can be changed in Settings → Hotkeys: a command's custom hotkeys
// replace its defaults, everywhere at once (the handler, menus, the palette).
// A command can belong to a core plugin; while that plugin is off the command
// is gone: not listed, not run, its hotkeys free.

import { listeners } from "./listeners";
import type { IconName } from "./shell/icons";
import { isMac } from "./shell/keys";
import type { MenuEntry } from "./shell/menu";
import type { StoredHotkey } from "./settings/schema";
import { readStored, store } from "./storage";

export interface Hotkey {
  /** Ctrl on Linux and Windows, Cmd on macOS. */
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** KeyboardEvent.key, lower case ("p", "arrowleft", "f2", "["). */
  key: string;
}

export interface Command {
  id: string;
  name: string;
  icon?: IconName;
  /** Default hotkeys (Settings → Hotkeys can replace them). */
  hotkeys?: Hotkey[];
  /** The core plugin this command belongs to (Settings → Core plugins can turn it off). */
  plugin?: string;
  /** Whether the command can run right now; unavailable ones are hidden from the palette and disabled in menus. */
  when?: () => boolean;
  run: () => unknown;
}

// Keys whose KeyboardEvent.key changes with Alt/Shift on some layouts: fall
// back to the physical key for these.
const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};

function codeKey(code: string): string | undefined {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return CODE_KEYS[code];
}

const comboOf = (mod: boolean, alt: boolean, shift: boolean, key: string) =>
  `${mod ? "Mod+" : ""}${alt ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;

export const hotkeyCombo = (hk: Hotkey) => comboOf(!!hk.mod, !!hk.alt, !!hk.shift, hk.key.toLowerCase());

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "os", "altgraph", "capslock", "fn", "dead", "process", "unidentified"]);

/**
 * The hotkey a key press makes, for Settings → Hotkeys' "press a hotkey":
 * null while only modifiers are down. Keys whose character changes with
 * Alt or Shift on some layouts are taken from the physical key.
 */
export function hotkeyFromEvent(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): Hotkey | null {
  const key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;
  const physical = codeKey(e.code);
  const hk: Hotkey = { key: (e.altKey || e.shiftKey) && physical ? physical : key };
  if (e.ctrlKey || e.metaKey) hk.mod = true;
  if (e.altKey) hk.alt = true;
  if (e.shiftKey) hk.shift = true;
  return hk;
}

// hotkeys.json writes keys as KeyboardEvent.key does ("P", "ArrowLeft", "F2").
const NAMED_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Enter", "Tab", "Escape", "Backspace", "Delete", "Home", "End", "Insert", "Space"];
const namedKey = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));

/** A hotkey as hotkeys.json stores it ({ modifiers: ["Mod", "Shift"], key: "P" }, Obsidian's format). */
export function toStored(hk: Hotkey): StoredHotkey {
  const modifiers: StoredHotkey["modifiers"] = [];
  if (hk.mod) modifiers.push("Mod");
  if (hk.alt) modifiers.push("Alt");
  if (hk.shift) modifiers.push("Shift");
  const k = hk.key;
  const key = namedKey.get(k) ?? (/^f\d{1,2}$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k);
  return { modifiers, key };
}

export function fromStored(hk: StoredHotkey): Hotkey {
  const out: Hotkey = { key: hk.key === "Space" ? " " : hk.key.toLowerCase() };
  // "Ctrl" and "Meta" (macOS-specific in Obsidian's files) count as Grove's one modifier.
  if (hk.modifiers.some((m) => m === "Mod" || m === "Ctrl" || m === "Meta")) out.mod = true;
  if (hk.modifiers.includes("Alt")) out.alt = true;
  if (hk.modifiers.includes("Shift")) out.shift = true;
  return out;
}

const KEY_LABELS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↵",
  tab: "Tab",
  pageup: "Page Up",
  pagedown: "Page Down",
  delete: "Delete",
  backspace: "Backspace",
  " ": "Space",
  escape: "Esc",
  home: "Home",
  end: "End",
  insert: "Insert",
};

/** "Ctrl + Shift + P" (macOS: "⌘ ⇧ P"), as Obsidian prints hotkeys. */
export function hotkeyLabel(hk: Hotkey): string {
  const key = KEY_LABELS[hk.key] ?? (hk.key.length === 1 ? hk.key.toUpperCase() : hk.key[0].toUpperCase() + hk.key.slice(1));
  if (isMac) return `${hk.mod ? "⌘ " : ""}${hk.alt ? "⌥ " : ""}${hk.shift ? "⇧ " : ""}${key}`;
  return [hk.mod && "Ctrl", hk.alt && "Alt", hk.shift && "Shift", key].filter(Boolean).join(" + ");
}

const RECENT_KEY = "grove.recentCommands";
const RECENT_MAX = 10;

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private byCombo = new Map<string, Command[]>();
  private recentIds: string[] = [];
  /** Custom hotkeys by command id (Settings → Hotkeys); they replace the defaults. */
  private custom = new Map<string, Hotkey[]>();
  private changes = listeners();
  /** While true (a modal is open), hotkeys are left alone. */
  suspended = () => false;
  /** Whether a core plugin is on (set by the app from Settings → Core plugins). */
  pluginEnabled: (plugin: string) => boolean = () => true;

  constructor() {
    const saved = readStored(RECENT_KEY, []);
    if (Array.isArray(saved)) this.recentIds = saved.filter((id) => typeof id === "string");
  }

  register(...cmds: Command[]) {
    for (const cmd of cmds) {
      if (this.commands.has(cmd.id)) throw new Error(`Command ${cmd.id} registered twice`);
      this.commands.set(cmd.id, cmd);
      for (const hk of this.hotkeysOf(cmd.id)) this.index(hk, cmd);
    }
  }

  private index(hk: Hotkey, cmd: Command) {
    const combo = hotkeyCombo(hk);
    this.byCombo.set(combo, [...(this.byCombo.get(combo) ?? []), cmd]);
  }

  /**
   * Replace the custom hotkeys (all of them, as read from hotkeys.json). A
   * command listed with no hotkeys has none; one not listed keeps its defaults.
   */
  setCustomHotkeys(custom: Record<string, Hotkey[]>) {
    this.custom = new Map(Object.entries(custom));
    this.byCombo.clear();
    for (const cmd of this.commands.values()) for (const hk of this.hotkeysOf(cmd.id)) this.index(hk, cmd);
    this.changed();
  }

  /** Called when hotkeys or plugins change, so hints can be redrawn. */
  readonly onChange = this.changes.on;

  /** Tell listeners that what commands show (hotkeys, availability through plugins) changed. */
  changed() {
    this.changes.emit();
  }

  /** A command's hotkeys now: its custom ones if set, else its defaults. */
  hotkeysOf(id: string): Hotkey[] {
    return this.custom.get(id) ?? this.commands.get(id)?.hotkeys ?? [];
  }

  isCustomized(id: string): boolean {
    return this.custom.has(id);
  }

  /** The enabled commands bound to the same keys as `hk`, other than `id`. */
  conflicts(hk: Hotkey, id?: string): Command[] {
    return (this.byCombo.get(hotkeyCombo(hk)) ?? []).filter((c) => c.id !== id && this.isEnabled(c));
  }

  /** Whether a command exists and its plugin (if any) is on. */
  isEnabled(cmd: Command | string): boolean {
    const c = typeof cmd === "string" ? this.commands.get(cmd) : cmd;
    return !!c && (!c.plugin || this.pluginEnabled(c.plugin));
  }

  get(id: string): Command {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`No command ${id}`);
    return cmd;
  }

  /** Every enabled command (a core plugin's are gone while it is off). */
  all(): Command[] {
    return [...this.commands.values()].filter((c) => this.isEnabled(c));
  }

  isAvailable(cmd: Command): boolean {
    return this.isEnabled(cmd) && (cmd.when ? cmd.when() : true);
  }

  /** Run a command if it is available; returns whether it ran. */
  run(id: string): boolean {
    const cmd = this.get(id);
    if (!this.isAvailable(cmd)) return false;
    void cmd.run();
    return true;
  }

  /** The command's first hotkey, printed, if it has one. */
  hotkey(id: string): string | undefined {
    const hk = this.hotkeysOf(id)[0];
    return hk ? hotkeyLabel(hk) : undefined;
  }

  /** A menu item that runs the command, with its icon, hotkey and availability. */
  menuItem(id: string, overrides: Partial<MenuEntry> = {}): MenuEntry {
    const cmd = this.get(id);
    return {
      title: cmd.name,
      icon: cmd.icon,
      hotkey: this.hotkey(id),
      disabled: !this.isAvailable(cmd),
      action: () => this.run(id),
      ...overrides,
    };
  }

  /** Most recently run from the palette first. */
  recent(): string[] {
    return this.recentIds.filter((id) => this.isEnabled(id));
  }

  noteUsed(id: string) {
    this.recentIds = [id, ...this.recentIds.filter((x) => x !== id)].slice(0, RECENT_MAX);
    store(RECENT_KEY, this.recentIds);
  }

  /**
   * The global hotkey handler. Plain typing returns at the first check, so
   * this costs nothing on the typing path; only Ctrl/Cmd/Alt chords and
   * function keys are looked up.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod && !e.altKey && !/^F\d/.test(e.key)) return false;
    if (e.isComposing || this.suspended()) return false;
    const key = e.key.toLowerCase();
    const candidates = [...(this.byCombo.get(comboOf(mod, e.altKey, e.shiftKey, key)) ?? [])];
    const physical = codeKey(e.code);
    if (physical && physical !== key) candidates.push(...(this.byCombo.get(comboOf(mod, e.altKey, e.shiftKey, physical)) ?? []));
    const cmd = candidates.find((c) => this.isAvailable(c));
    if (!cmd) return false;
    e.preventDefault();
    e.stopPropagation();
    void cmd.run();
    return true;
  }
}

export const commands = new CommandRegistry();

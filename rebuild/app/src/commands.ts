// The command registry. Every action the app offers is registered here once,
// with an id, an Obsidian-style name ("Group: Action" for the views and
// tools, plain for core actions), an optional icon and default hotkeys.
// Buttons, menus, hotkeys and the command palette all run commands through
// it, so a command's name, icon, hotkey and availability are the same
// everywhere.

import type { IconName } from "./shell/icons";
import { isMac } from "./shell/keys";
import type { MenuEntry } from "./shell/menu";

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
  hotkeys?: Hotkey[];
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

const hotkeyCombo = (hk: Hotkey) => comboOf(!!hk.mod, !!hk.alt, !!hk.shift, hk.key.toLowerCase());

const KEY_LABELS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↵",
  tab: "Tab",
  delete: "Delete",
  backspace: "Backspace",
  " ": "Space",
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
  /** While true (a modal is open), hotkeys are left alone. */
  suspended = () => false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      if (Array.isArray(saved)) this.recentIds = saved.filter((id) => typeof id === "string");
    } catch {
      // no storage: no recent commands
    }
  }

  register(...cmds: Command[]) {
    for (const cmd of cmds) {
      if (this.commands.has(cmd.id)) throw new Error(`Command ${cmd.id} registered twice`);
      this.commands.set(cmd.id, cmd);
      for (const hk of cmd.hotkeys ?? []) {
        const combo = hotkeyCombo(hk);
        this.byCombo.set(combo, [...(this.byCombo.get(combo) ?? []), cmd]);
      }
    }
  }

  get(id: string): Command {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`No command ${id}`);
    return cmd;
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  isAvailable(cmd: Command): boolean {
    return cmd.when ? cmd.when() : true;
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
    const hk = this.get(id).hotkeys?.[0];
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
    return this.recentIds.filter((id) => this.commands.has(id));
  }

  noteUsed(id: string) {
    this.recentIds = [id, ...this.recentIds.filter((x) => x !== id)].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentIds));
    } catch {
      // storage full or disabled: recents just aren't remembered
    }
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

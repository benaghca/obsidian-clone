// Ctrl+P command palette: the shared prompt listing every command that can
// run right now, with its hotkeys as chips on the right.

import { type Command, type CommandRegistry, hotkeyLabel } from "../commands";
import { h } from "./dom";
import { paletteSource } from "./paletteItems";
import { hints, openPrompt, suggestionText } from "./prompt";

export function openCommandPalette(registry: CommandRegistry) {
  const items = paletteSource<Command>(registry.all(), registry.recent(), (cmd) => registry.isAvailable(cmd));
  openPrompt({
    placeholder: "Select a command...",
    emptyText: "No commands found.",
    className: "mod-command-palette",
    restoreFocusOnChoose: true,
    instructions: hints("to use"),
    items,
    render({ cmd, indices }, row) {
      row.classList.add("mod-complex");
      suggestionText(row, cmd.name, indices);
      const hotkeys = registry.hotkeysOf(cmd.id);
      if (hotkeys.length) {
        row.append(h("div", { class: "suggestion-aux" }, ...hotkeys.map((hk) => h("kbd", { class: "suggestion-hotkey" }, hotkeyLabel(hk)))));
      }
    },
    choose({ cmd }) {
      registry.noteUsed(cmd.id);
      registry.run(cmd.id);
    },
  });
}

// Ctrl+P command palette: the shared prompt listing every command that can
// run right now, with its hotkeys as chips on the right.

import { type Command, type CommandRegistry, hotkeyLabel } from "../commands";
import { h } from "./dom";
import { paletteItems } from "./paletteItems";
import { hints, openPrompt, suggestionText } from "./prompt";

export function openCommandPalette(registry: CommandRegistry) {
  // Availability is read before the prompt takes focus: editor commands
  // depend on where focus is, and it goes back there before one runs.
  const available = registry.all().filter((cmd) => registry.isAvailable(cmd));
  const recent = registry.recent();
  openPrompt({
    placeholder: "Select a command...",
    emptyText: "No commands found.",
    className: "mod-command-palette",
    restoreFocusOnChoose: true,
    instructions: hints("to use"),
    items: (query) => paletteItems<Command>(query, available, recent),
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

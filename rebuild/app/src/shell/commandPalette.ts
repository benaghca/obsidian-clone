// Ctrl+P command palette: the shared prompt listing every command that can
// run right now, with its hotkeys as chips on the right.

import { type Command, type CommandRegistry, hotkeyLabel } from "../commands";
import { h } from "./dom";
import { highlight } from "./fuzzy";
import { paletteItems } from "./paletteItems";
import { openPrompt } from "./prompt";

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
    instructions: [
      ["↑↓", "to navigate"],
      ["↵", "to use"],
      ["esc", "to dismiss"],
    ],
    items: (query) => paletteItems<Command>(query, available, recent),
    render({ cmd, indices }, row) {
      row.classList.add("mod-complex");
      row.append(h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(cmd.name, indices))));
      if (cmd.hotkeys?.length) {
        row.append(
          h("div", { class: "suggestion-aux" }, ...cmd.hotkeys.map((hk) => h("kbd", { class: "suggestion-hotkey" }, hotkeyLabel(hk)))),
        );
      }
    },
    choose({ cmd }) {
      registry.noteUsed(cmd.id);
      registry.run(cmd.id);
    },
  });
}

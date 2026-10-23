// Grove's built-in features that Settings → Core plugins can turn off, with
// Obsidian's names. Each description says, in one line, what the plugin
// does and what turning it off removes: its commands (and their hotkeys),
// ribbon buttons, views, menu items and status bar items. There are no
// downloadable plugins.

import type { PluginId } from "./schema";

interface CorePlugin {
  id: PluginId;
  name: string;
  desc: string;
}

export const PLUGINS: CorePlugin[] = [
  {
    id: "backlink",
    name: "Backlinks",
    desc: "Show links from other notes to the current note. Turning it off removes the Backlinks tab, the backlink count in the status bar and backlinks at the bottom of notes.",
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    desc: "Save shortcuts to notes and folders. Turning it off removes the Bookmarks tab, its commands and every Bookmark item in menus.",
  },
  {
    id: "command-palette",
    name: "Command palette",
    desc: "Run any command from the keyboard with Ctrl+P. Turning it off removes the palette, its hotkey and its ribbon button.",
  },
  {
    id: "daily-notes",
    name: "Daily notes",
    desc: "Create or open today's note. Turning it off removes its commands and its ribbon button.",
  },
  {
    id: "graph",
    name: "Graph view",
    desc: "Show how your notes link together as a graph. Turning it off removes the graph and local graph, their commands, the ribbon button and the Local graph tab.",
  },
  {
    id: "note-composer",
    name: "Note composer",
    desc: "Merge one note into another. Turning it off removes its command and every Merge entire file with... item in menus.",
  },
  {
    id: "outgoing-link",
    name: "Outgoing links",
    desc: "Show the links in the current note and the unlinked mentions of other notes. Turning it off removes the Outgoing links tab and its command.",
  },
  {
    id: "outline",
    name: "Outline",
    desc: "Show the headings of the current note. Turning it off removes the Outline tab and its command.",
  },
  {
    id: "properties",
    name: "Properties view",
    desc: "Show every property in the vault and how many notes use it. Turning it off removes the All properties tab, its command and the property count in the status bar.",
  },
  {
    id: "switcher",
    name: "Quick switcher",
    desc: "Jump to any note from the keyboard with Ctrl+O. Turning it off removes the switcher, its hotkey, its ribbon button and Go to file.",
  },
  {
    id: "random-note",
    name: "Random note",
    desc: "Open a random note to rediscover or review it. Turning it off removes its command and its ribbon button.",
  },
  {
    id: "tag-pane",
    name: "Tags view",
    desc: "Show every tag in the vault and how often it is used. Turning it off removes the Tags tab and its command.",
  },
  {
    id: "templates",
    name: "Templates",
    desc: "Insert a note from your templates folder, or today's date and time. Turning it off removes its commands and its ribbon button.",
  },
  {
    id: "word-count",
    name: "Word count",
    desc: "Count the words and characters in the current note. Turning it off removes the counts from the status bar.",
  },
];

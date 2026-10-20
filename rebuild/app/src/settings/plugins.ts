// Grove's built-in features that Settings → Core plugins can turn off, with
// Obsidian's names. Each description says, in one line, what the plugin
// does and what turning it off removes: its commands (and their hotkeys),
// ribbon buttons, views, menu items and status bar items. There are no
// downloadable plugins.

import type { IconName } from "../shell/icons";
import type { PluginId } from "./schema";

export interface CorePlugin {
  id: PluginId;
  name: string;
  desc: string;
  icon: IconName;
}

export const PLUGINS: CorePlugin[] = [
  {
    id: "backlink",
    name: "Backlinks",
    desc: "Show links from other notes to the current note. Turning it off removes the Backlinks tab, the backlink count in the status bar and backlinks at the bottom of notes.",
    icon: "link",
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    desc: "Save shortcuts to notes and folders. Turning it off removes the Bookmarks tab, its commands and every Bookmark item in menus.",
    icon: "bookmark",
  },
  {
    id: "command-palette",
    name: "Command palette",
    desc: "Run any command from the keyboard with Ctrl+P. Turning it off removes the palette, its hotkey and its ribbon button.",
    icon: "terminal",
  },
  {
    id: "daily-notes",
    name: "Daily notes",
    desc: "Create or open today's note. Turning it off removes its commands and its ribbon button.",
    icon: "calendar",
  },
  {
    id: "graph",
    name: "Graph view",
    desc: "Show how your notes link together as a graph. Turning it off removes the graph and local graph, their commands, the ribbon button and the Local graph tab.",
    icon: "git-fork",
  },
  {
    id: "note-composer",
    name: "Note composer",
    desc: "Merge one note into another. Turning it off removes its command and every Merge entire file with... item in menus.",
    icon: "git-merge",
  },
  {
    id: "outgoing-link",
    name: "Outgoing links",
    desc: "Show the links in the current note and the unlinked mentions of other notes. Turning it off removes the Outgoing links tab and its command.",
    icon: "link-2",
  },
  {
    id: "outline",
    name: "Outline",
    desc: "Show the headings of the current note. Turning it off removes the Outline tab and its command.",
    icon: "list",
  },
  {
    id: "switcher",
    name: "Quick switcher",
    desc: "Jump to any note from the keyboard with Ctrl+O. Turning it off removes the switcher, its hotkey, its ribbon button and Go to file.",
    icon: "file-search",
  },
  {
    id: "random-note",
    name: "Random note",
    desc: "Open a random note to rediscover or review it. Turning it off removes its command and its ribbon button.",
    icon: "dices",
  },
  {
    id: "tag-pane",
    name: "Tags view",
    desc: "Show every tag in the vault and how often it is used. Turning it off removes the Tags tab and its command.",
    icon: "tags",
  },
  {
    id: "templates",
    name: "Templates",
    desc: "Insert a note from your templates folder, or today's date and time. Turning it off removes its commands and its ribbon button.",
    icon: "files",
  },
  {
    id: "word-count",
    name: "Word count",
    desc: "Count the words and characters in the current note. Turning it off removes the counts from the status bar.",
    icon: "whole-word",
  },
];

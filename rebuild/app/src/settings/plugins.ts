// Grove's built-in features that Settings → Core plugins can turn off, with
// Obsidian's names and descriptions (adapted where Grove's feature is
// smaller). Turning one off removes it: its commands (and their hotkeys),
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
    desc: "Show links from other files to the current file. Backlinks can be shown in a separate view or at the bottom of the note.",
    icon: "link",
  },
  { id: "bookmarks", name: "Bookmarks", desc: "Save shortcuts to files and folders.", icon: "bookmark" },
  { id: "command-palette", name: "Command palette", desc: "Use Ctrl+P and begin typing to invoke a command.", icon: "terminal" },
  { id: "daily-notes", name: "Daily notes", desc: "Create or open today's daily note.", icon: "calendar" },
  { id: "note-composer", name: "Note composer", desc: "Merge two notes into one.", icon: "git-merge" },
  {
    id: "outgoing-link",
    name: "Outgoing links",
    desc: "Show outgoing links and detect unlinked mentions of other notes in the current note.",
    icon: "link-2",
  },
  { id: "outline", name: "Outline", desc: "Show the table of contents for the current note.", icon: "list" },
  { id: "switcher", name: "Quick switcher", desc: "Jump to other files with your keyboard.", icon: "file-search" },
  { id: "random-note", name: "Random note", desc: "Open a random note to rediscover or review.", icon: "dices" },
  { id: "tag-pane", name: "Tags view", desc: "Show a list of all tags and their number of occurrences.", icon: "tags" },
  { id: "templates", name: "Templates", desc: "Insert template content from a folder of template files.", icon: "files" },
  { id: "word-count", name: "Word count", desc: "Show word count in the status bar.", icon: "whole-word" },
];

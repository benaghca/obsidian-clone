// The settings pages, in Obsidian 1.14's order: Options (General,
// Appearance, Interface, Editor, Files and links, Hotkeys, Core plugins),
// then a page for each core plugin with options. Every row here is backed
// by a working setting; what Grove can't do is left out (see
// rebuild/SETTINGS_NOTES.md). Rows write through the settings store, which
// tells the app at once, so changes apply live.

import { version } from "../../package.json";
import { commands } from "../commands";
import { systemPath } from "../paths";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import type { Workspace } from "../workspace";
import { formatDate } from "./dateFormat";
import { button, dropdown, extraButton, group, row, slider, textInput, toggle } from "./controls";
import { installedFonts } from "./fonts";
import { createHotkeysPage, showHotkeysFor } from "./hotkeys";
import { openSettings, refreshSettingsNav, type SettingsSection } from "./modal";
import { PLUGINS } from "./plugins";
import { APPEARANCE, type FileName, isFontName, type PluginId, type SettingsOf } from "./schema";
import { settings } from "./store";
import { zoomFactor } from "./appearance";
import { DEFAULT_ACCENT } from "./accent";

export interface SettingsContext {
  ws: Workspace;
  /** The ribbon's actions, which can be shown or hidden (Interface → Ribbon). */
  ribbon: { actions: { id: string; label: string; icon: IconName }[]; isShown(id: string): boolean; setShown(id: string, shown: boolean): void };
  copyText(text: string): void;
}

// Bind a control to one setting.
type Key<F extends FileName> = keyof SettingsOf<F> & string;
const get = <F extends FileName, K extends Key<F>>(file: F, key: K) => settings.get(file)[key];
const set = <F extends FileName, K extends Key<F>>(file: F, key: K) => (value: SettingsOf<F>[K]) => void settings.set(file, key, value);

function toggleRow<F extends FileName, K extends Key<F>>(file: F, key: K, name: string, desc: string) {
  return row({ name, desc, cls: "mod-toggle" }, toggle(get(file, key) as boolean, set(file, key) as (v: boolean) => void, name));
}

function dropdownRow<F extends FileName, K extends Key<F>>(file: F, key: K, name: string, desc: string, options: [string, string][], onChange?: (v: string) => void) {
  return row(
    { name, desc, cls: "mod-dropdown" },
    dropdown(options, get(file, key) as string, (v) => {
      settings.set(file, key, v as SettingsOf<F>[K]);
      onChange?.(v);
    }, name),
  );
}

function textRow<F extends FileName, K extends Key<F>>(file: F, key: K, name: string, desc: string, placeholder: string, list?: string) {
  const input = textInput({ value: get(file, key) as string, placeholder, label: name, onInput: (v) => void settings.set(file, key, v.trim() as SettingsOf<F>[K]) });
  if (list) input.setAttribute("list", list);
  return row({ name, desc, cls: "mod-text" }, input);
}

/** A <datalist> of the vault's folders or notes, for path fields. */
function pathList(ws: Workspace, id: string, kind: "folder" | "note"): HTMLElement {
  const list = h("datalist");
  list.id = id;
  const paths = kind === "folder" ? ws.files.filter((f) => f.is_dir).map((f) => f.path) : ws.notes.map((n) => n.path.replace(/\.md$/, ""));
  for (const p of paths.sort()) {
    const option = h("option");
    option.value = p;
    list.append(option);
  }
  return list;
}

function general(ctx: SettingsContext): HTMLElement {
  const config = systemPath(ctx.ws.vault.path, ".grove");
  return h(
    "div",
    null,
    group(
      null,
      row({
        name: `Version ${version}`,
        desc: "Grove makes no network connections. It has no updater, no account, no sync and no telemetry; a new version is a new build you install yourself.",
      }),
      row(
        { name: "Settings folder", desc: [h("div", null, "This vault's settings are plain JSON files in its .grove folder, so they travel with the vault."), h("div", { class: "setting-item-path" }, config)] },
        button("Copy path", () => ctx.copyText(config)),
      ),
    ),
  );
}

function appearance(): HTMLElement {
  const fonts = h("datalist");
  fonts.id = "grove-font-list";
  installedFonts((names) => {
    for (const name of names) {
      const option = h("option");
      option.value = name;
      fonts.append(option);
    }
  });
  const fontRow = (key: "interfaceFontFamily" | "textFontFamily" | "monospaceFontFamily", name: string, desc: string) => {
    const input = textInput({
      value: get("appearance.json", key),
      placeholder: "Default",
      label: name,
      onInput: (v) => {
        const ok = isFontName(v.trim());
        input.classList.toggle("is-invalid", !ok);
        if (ok) settings.set("appearance.json", key, v.trim());
      },
    });
    input.setAttribute("list", fonts.id);
    return row({ name, desc, cls: "mod-text" }, input);
  };

  const color = h("input", { class: "setting-color", "aria-label": "Accent color" });
  color.type = "color";
  color.value = get("appearance.json", "accentColor") || DEFAULT_ACCENT;
  const resetAccent = extraButton("rotate-ccw", "Restore default", () => {
    settings.set("appearance.json", "accentColor", "");
    color.value = DEFAULT_ACCENT;
    hex.value = DEFAULT_ACCENT;
    hex.classList.remove("is-invalid");
    resetAccent.classList.add("is-disabled");
  });
  resetAccent.classList.toggle("is-disabled", !get("appearance.json", "accentColor"));
  // The colour as hex beside the picker: type or paste one (#rrggbb, the # optional).
  const hex = textInput({
    value: color.value,
    placeholder: DEFAULT_ACCENT,
    label: "Accent color (hex)",
    cls: "setting-hex-input",
    onInput: (v) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
      hex.classList.toggle("is-invalid", !m && v.trim() !== "");
      if (!m) return;
      const value = `#${m[1].toLowerCase()}`;
      color.value = value;
      setAccent(value);
    },
    onCommit: () => {
      hex.value = color.value;
      hex.classList.remove("is-invalid");
    },
  });
  const setAccent = (value: string) => {
    settings.set("appearance.json", "accentColor", value === DEFAULT_ACCENT ? "" : value);
    resetAccent.classList.toggle("is-disabled", !get("appearance.json", "accentColor"));
  };
  color.addEventListener("input", () => {
    setAccent(color.value.toLowerCase());
    hex.value = color.value.toLowerCase();
    hex.classList.remove("is-invalid");
  });

  return h(
    "div",
    null,
    fonts,
    group(
      null,
      dropdownRow("appearance.json", "theme", "Base color scheme", "Choose Grove's default color scheme.", [
        ["dark", "Dark"],
        ["light", "Light"],
        ["system", "Adapt to system"],
      ]),
      row({ name: "Accent color", desc: "Choose the accent color used throughout the app. The default is Grove's forest teal.", cls: "mod-color" }, resetAccent, hex, color),
    ),
    group(
      "Font",
      fontRow("interfaceFontFamily", "Interface font", "Set base font for all of Grove. Only fonts installed on this computer, chosen by name."),
      fontRow("textFontFamily", "Text font", "Set font for editing and reading views."),
      fontRow("monospaceFontFamily", "Monospace font", "Set font for places like code blocks and frontmatter."),
      row(
        { name: "Font size", desc: "Font size in pixels that affects editing and reading views.", cls: "mod-slider" },
        ...slider({
          min: 10,
          max: 30,
          step: 1,
          value: get("appearance.json", "baseFontSize"),
          defaultValue: APPEARANCE.baseFontSize.default,
          label: "Font size",
          format: (v) => String(v),
          onInput: set("appearance.json", "baseFontSize"),
        }),
      ),
    ),
  );
}

function interfaceSection(ctx: SettingsContext): HTMLElement {
  return h(
    "div",
    null,
    group(
      null,
      toggleRow("appearance.json", "showViewHeader", "Show tab title bar", "Display the header at the top of every tab."),
      toggleRow("appearance.json", "showRibbon", "Show ribbon", "Display vertical toolbar on the side of the window."),
    ),
    group(
      "Ribbon",
      ...ctx.ribbon.actions.map((a) =>
        row({ name: a.label, cls: "mod-toggle" }, toggle(ctx.ribbon.isShown(a.id), (on) => ctx.ribbon.setShown(a.id, on), `Show ${a.label} in the ribbon`)),
      ),
    ),
    group(
      "Advanced",
      row(
        { name: "Zoom level", desc: "Controls the overall zoom level of the app.", cls: "mod-slider" },
        ...slider({
          min: -2.5,
          max: 3,
          step: 0.5,
          value: get("appearance.json", "zoomLevel"),
          defaultValue: 0,
          label: "Zoom level",
          format: (v) => `${Math.round(zoomFactor(v) * 100)}%`,
          onInput: set("appearance.json", "zoomLevel"),
        }),
      ),
    ),
  );
}

function editor(): HTMLElement {
  return h(
    "div",
    null,
    group(
      null,
      dropdownRow("app.json", "defaultViewMode", "Default view for new tabs", "The default view that a new Markdown tab gets opened in.", [
        ["source", "Editing view"],
        ["preview", "Reading view"],
      ]),
      row(
        { name: "Default editing mode", desc: "The default editing mode a new tab will start with.", cls: "mod-dropdown" },
        dropdown(
          [
            ["live", "Live Preview"],
            ["source", "Source mode"],
          ],
          get("app.json", "livePreview") ? "live" : "source",
          (v) => settings.set("app.json", "livePreview", v === "live"),
          "Default editing mode",
        ),
      ),
      row(
        { name: "Show editing mode in status bar", desc: "Show the editing mode toggle in the status bar.", cls: "mod-toggle" },
        toggle(get("core-plugins.json", "editor-status"), (on) => settings.set("core-plugins.json", "editor-status", on), "Show editing mode in status bar"),
      ),
    ),
    group(
      "Display",
      toggleRow("app.json", "showInlineTitle", "Inline title", "Display the filename as an editable title inline with the file contents."),
      toggleRow("app.json", "readableLineLength", "Readable line length", "Limit maximum line length. Less content fits onscreen, but long blocks of text are more readable."),
      toggleRow("app.json", "foldHeading", "Fold heading", "Lets you fold all content under a heading."),
      toggleRow("app.json", "foldIndent", "Fold indent", "Lets you fold part of an indentation, such as lists."),
      toggleRow("app.json", "showLineNumber", "Line numbers", "Show line numbers in the gutter."),
    ),
    group(
      "Behavior",
      toggleRow("app.json", "spellcheck", "Spellcheck", "Turn on the spellchecker. It runs inside the app with the system's dictionaries; nothing is sent anywhere."),
      toggleRow("app.json", "autoPairBrackets", "Auto-pair brackets", "Pair brackets and quotes automatically."),
      toggleRow("app.json", "autoPairMarkdown", "Auto-pair Markdown syntax", "Pair symbols automatically for bold, italic, code, and more."),
      toggleRow("app.json", "smartIndentList", "Smart lists", "Automatically set indentation and place list items correctly."),
      toggleRow("app.json", "useTab", "Indent using tabs", "Use tabs to indent by pressing the “Tab” key. Turn this off to indent using spaces."),
      row(
        { name: "Indent visual width", desc: "Number of spaces a tab character will render as.", cls: "mod-slider" },
        ...slider({ min: 1, max: 8, step: 1, value: get("app.json", "tabSize"), defaultValue: 4, label: "Indent visual width", format: String, onInput: set("app.json", "tabSize") }),
      ),
    ),
  );
}

function filesAndLinks(ctx: SettingsContext): HTMLElement {
  const folderRow = textRow("app.json", "newFileFolderPath", "Folder to create new notes in", "Newly created notes will appear in this folder.", "Example: folder 1/folder 2", "grove-folder-list");
  folderRow.hidden = get("app.json", "newFileLocation") !== "folder";

  // Excluded files: the filters as chips, and a field to add one.
  const filters = h("div", { class: "setting-filter-list" });
  const renderFilters = () => {
    filters.replaceChildren(
      ...get("app.json", "userIgnoreFilters").map((f) =>
        h(
          "div",
          { class: "setting-filter" },
          h("span", { class: "setting-filter-text" }, f),
          extraButton("x", `Remove ${f}`, () => {
            settings.set("app.json", "userIgnoreFilters", get("app.json", "userIgnoreFilters").filter((x) => x !== f));
            renderFilters();
          }),
        ),
      ),
    );
  };
  renderFilters();
  const addFilter = () => {
    const f = filterInput.value.trim();
    if (!f) return;
    const list = get("app.json", "userIgnoreFilters");
    if (!list.includes(f)) settings.set("app.json", "userIgnoreFilters", [...list, f]);
    filterInput.value = "";
    renderFilters();
  };
  const filterInput = textInput({ value: "", placeholder: "Folder, file or /regex/", label: "Add an excluded file filter", onInput: () => {} });
  filterInput.setAttribute("list", "grove-folder-list");
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addFilter();
  });

  return h(
    "div",
    null,
    pathList(ctx.ws, "grove-folder-list", "folder"),
    group(
      null,
      dropdownRow(
        "app.json",
        "newFileLocation",
        "Default location for new notes",
        "Where newly created notes are placed.",
        [
          ["root", "Vault folder"],
          ["current", "Same folder as current file"],
          ["folder", "In the folder specified below"],
        ],
        (v) => (folderRow.hidden = v !== "folder"),
      ),
      folderRow,
    ),
    group(
      "Links",
      dropdownRow("app.json", "newLinkFormat", "New link format", "What links to insert when auto-generating internal links.", [
        ["shortest", "Shortest path when possible"],
        ["relative", "Path from current file"],
        ["absolute", "Path from vault folder"],
      ]),
      toggleRow("app.json", "alwaysUpdateLinks", "Automatically update internal links", "Turn off to be prompted to update links after renaming a file."),
      row(
        { name: "Use [[Wikilinks]]", desc: "Auto-generate Wikilinks for [[links]] instead of Markdown links. Disable this option to generate Markdown links instead.", cls: "mod-toggle" },
        toggle(!get("app.json", "useMarkdownLinks"), (on) => settings.set("app.json", "useMarkdownLinks", !on), "Use [[Wikilinks]]"),
      ),
    ),
    group(
      "Trash",
      toggleRow("app.json", "promptDelete", "Confirm before deleting files", "Avoid accidentally deleting files."),
      dropdownRow("app.json", "trashOption", "Deleted files", "What happens to a file after you delete it.", [
        ["local", "Move to Grove trash (.trash folder)"],
        ["none", "Permanently delete"],
      ]),
    ),
    group(
      "Advanced",
      row(
        {
          name: "Excluded files",
          desc: "Excluded files are hidden in Search, the Tags view and Unlinked mentions, and in the Quick switcher and link suggestions. Add a folder or file path, or a /regular expression/.",
          cls: "mod-filters",
        },
        filterInput,
        button("Add", addFilter),
      ),
      filters,
    ),
  );
}

function corePlugins(): HTMLElement {
  // "Search plugins..." filters the list by name and description, as in Obsidian.
  const search = h("input", { "aria-label": "Search plugins" });
  search.type = "search";
  search.placeholder = "Search plugins...";
  search.spellcheck = false;
  const none = h("div", { class: "setting-search-empty" }, "No plugins match.");
  none.hidden = true;
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const r of list.querySelectorAll<HTMLElement>(".setting-items > .setting-item")) {
      const match = !q || (r.querySelector(".setting-item-info")?.textContent ?? "").toLowerCase().includes(q);
      r.classList.toggle("is-filtered-out", !match);
      if (match) shown++;
    }
    list.hidden = shown === 0;
    none.hidden = shown > 0;
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) {
      e.preventDefault();
      search.value = "";
      search.dispatchEvent(new Event("input"));
    }
  });
  const list = group(
    null,
    ...PLUGINS.map((p) => {
      const page = PLUGIN_PAGES.find((s) => s.id === p.id);
      const options = page
        ? extraButton("settings", "Options", () => openSettings([], p.id))
        : null;
      const hotkeys = extraButton("circle-plus", "Hotkeys", () => {
        showHotkeysFor(p.name);
        openSettings([], "hotkeys");
      });
      const sync = (on: boolean) => {
        if (options) options.hidden = !on;
        hotkeys.hidden = !on;
      };
      sync(get("core-plugins.json", p.id));
      return row(
        { name: p.name, desc: p.desc, cls: "mod-toggle" },
        options,
        hotkeys,
        toggle(get("core-plugins.json", p.id), (on) => {
          settings.set("core-plugins.json", p.id, on);
          sync(on);
          refreshSettingsNav();
        }, p.name),
      );
    }),
  );
  return h("div", null, h("div", { class: "search-input-container setting-plugin-search" }, icon("search", 16), search), list, none);
}

const DATE_PRESETS = ["YYYY-MM-DD", "YYYY.MM.DD", "YYYY/MM/DD", "YYYY/MM/YYYY-MM-DD"];

function dailyNotes(ctx: SettingsContext): HTMLElement {
  const format = get("daily-notes.json", "format");
  const preview = h("div", { class: "setting-item-preview" });
  const showPreview = () => (preview.textContent = `Your current syntax looks like this: ${formatDate(new Date(), get("daily-notes.json", "format") || "YYYY-MM-DD")}`);
  showPreview();
  const custom = textInput({
    value: format,
    placeholder: "YYYY-MM-DD",
    label: "Custom format",
    onInput: (v) => {
      settings.set("daily-notes.json", "format", v.trim() || "YYYY-MM-DD");
      showPreview();
    },
  });
  const customRow = row({ name: "Custom format", desc: ["For more syntax, use Moment.js tokens (YYYY, MM, DD, dddd, ...). ", preview], cls: "mod-text" }, custom);
  customRow.hidden = DATE_PRESETS.includes(format);
  const now = new Date();
  return h(
    "div",
    null,
    pathList(ctx.ws, "grove-note-list", "note"),
    pathList(ctx.ws, "grove-folder-list", "folder"),
    group(
      null,
      row(
        { name: "Date format", desc: "Choose how daily notes are named in your vault.", cls: "mod-dropdown" },
        dropdown(
          [...DATE_PRESETS.map((f) => [f, formatDate(now, f)] as [string, string]), ["custom", "Custom"]],
          DATE_PRESETS.includes(format) ? format : "custom",
          (v) => {
            customRow.hidden = v !== "custom";
            if (v !== "custom") settings.set("daily-notes.json", "format", v);
            else custom.focus();
            showPreview();
          },
          "Date format",
        ),
      ),
      customRow,
      textRow("daily-notes.json", "folder", "New file location", "New daily notes will be placed here.", "Example: folder 1/folder 2", "grove-folder-list"),
      textRow("daily-notes.json", "template", "Template file location", "Choose the file to use as a template.", "Example: folder/note", "grove-note-list"),
    ),
  );
}

function templates(ctx: SettingsContext): HTMLElement {
  return h(
    "div",
    null,
    pathList(ctx.ws, "grove-folder-list", "folder"),
    group(
      null,
      textRow("templates.json", "folder", "Template folder location", "Files in this folder will be available as templates.", "Example: folder 1/folder 2", "grove-folder-list"),
      textRow("templates.json", "dateFormat", "Date format", "{{date}} in the template file will be replaced with this value. You can also use {{date:YYYY-MM-DD}} to override the format once.", "YYYY-MM-DD"),
      textRow("templates.json", "timeFormat", "Time format", "{{time}} in the template file will be replaced with this value. You can also use {{time:HH:mm}} to override the format once.", "HH:mm"),
    ),
  );
}

const plugin = (id: PluginId) => () => settings.get("core-plugins.json")[id];

let PLUGIN_PAGES: SettingsSection[] = [];

/** Every settings page, in order. */
export function settingsSections(ctx: SettingsContext): SettingsSection[] {
  PLUGIN_PAGES = [
    {
      id: "backlink",
      name: "Backlinks",
      icon: "link",
      group: "plugins",
      shown: plugin("backlink"),
      build: () =>
        group(null, toggleRow("backlink.json", "backlinkInDocument", "Show backlinks at the bottom of notes", "Make backlinks visible in new tabs by default.")),
    },
    { id: "daily-notes", name: "Daily notes", icon: "calendar", group: "plugins", shown: plugin("daily-notes"), build: () => dailyNotes(ctx) },
    {
      id: "note-composer",
      name: "Note composer",
      icon: "git-merge",
      group: "plugins",
      shown: plugin("note-composer"),
      build: () => group(null, toggleRow("note-composer.json", "askBeforeMerging", "Confirm file merge", "Prompt before merging two files.")),
    },
    { id: "templates", name: "Templates", icon: "files", group: "plugins", shown: plugin("templates"), build: () => templates(ctx) },
  ];
  return [
    { id: "general", name: "General", icon: "circle-user", group: "options", build: () => general(ctx) },
    { id: "appearance", name: "Appearance", icon: "palette", group: "options", build: appearance },
    { id: "interface", name: "Interface", icon: "monitor", group: "options", build: () => interfaceSection(ctx) },
    { id: "editor", name: "Editor", icon: "pen-line", group: "options", build: editor },
    { id: "files", name: "Files and links", icon: "folder-cog", group: "options", build: () => filesAndLinks(ctx) },
    {
      id: "hotkeys",
      name: "Hotkeys",
      icon: "command",
      group: "options",
      // It has its own filter; its command rows are not settings to search.
      unsearchable: true,
      build: () => createHotkeysPage(commands),
    },
    { id: "core-plugins", name: "Core plugins", icon: "toy-brick", group: "options", build: corePlugins },
    ...PLUGIN_PAGES,
  ];
}

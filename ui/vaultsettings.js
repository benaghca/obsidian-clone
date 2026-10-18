/* Cinder vault settings: what goes in the vault's .cinder/settings.json and what comes out of it,
 * and a vault's first settings from Obsidian's own. The file holds each setting that differs from
 * Cinder's default (sorted, as Obsidian's app.json does), keeps keys this version doesn't know,
 * and leaves out what belongs to the machine rather than the vault.
 * See docs/superpowers/specs/2026-09-28-settings-json-design.md. No DOM here: tested under Node. */
'use strict';

(function (root) {
  // Machine settings: installed fonts differ, the frame is the app's, screenshot tools differ.
  const LOCAL_KEYS = ['fontText', 'fontMono', 'windowFrame', 'screenshotHide', 'screenshotDelay'];
  // Vault settings with no default (objects, empty when unset).
  const EXTRA_KEYS = ['hotkeys', 'propTypes'];

  // Built-in plugins, switched in Settings the way Obsidian switches Core plugins and Community
  // plugins. `on` is the fresh-vault default: the same core plugins a new Obsidian vault enables,
  // and none of the extras (Cinder's own stand-ins for community plugins). Ids of the core ones
  // match Obsidian's, so a vault's .obsidian/core-plugins.json seeds them.
  const PLUGINS = [
    { id: 'file-explorer', name: 'File explorer', desc: 'Browse the files and folders in the vault.', core: true, on: true },
    { id: 'global-search', name: 'Search', desc: 'Find text in any note.', core: true, on: true },
    { id: 'switcher', name: 'Quick switcher', desc: 'Open or create a note from the keyboard.', core: true, on: true },
    { id: 'graph', name: 'Graph view', desc: 'See how notes link to each other.', core: true, on: true },
    { id: 'backlink', name: 'Backlinks', desc: 'See what links to the open note, including mentions that aren’t links yet.', core: true, on: true },
    { id: 'canvas', name: 'Canvas', desc: 'Arrange notes, images and cards on an infinite board.', core: true, on: true },
    { id: 'outgoing-link', name: 'Outgoing links', desc: 'See the links in the open note.', core: true, on: true },
    { id: 'tag-pane', name: 'Tags view', desc: 'List every tag in the vault.', core: true, on: true },
    { id: 'properties', name: 'Properties view', desc: 'Edit a note’s properties at the top, and list every property in the vault.', core: true, on: true },
    { id: 'page-preview', name: 'Page preview', desc: 'Hover a link to preview the note it points to.', core: true, on: true },
    { id: 'note-composer', name: 'Note composer', desc: 'Extract a selection into a new note, or merge a note into another.', core: true, on: true },
    { id: 'command-palette', name: 'Command palette', desc: 'Run any command from the keyboard.', core: true, on: true },
    { id: 'editor-status', name: 'Editor status', desc: 'Show the cursor’s line and column, and the editing mode, in the status bar.', core: true, on: true },
    { id: 'bookmarks', name: 'Bookmarks', desc: 'Save notes, headings, searches and links.', core: true, on: true },
    { id: 'outline', name: 'Outline', desc: 'Show the open note’s headings.', core: true, on: true },
    { id: 'word-count', name: 'Word count', desc: 'Show words, characters and reading time in the status bar.', core: true, on: true },
    { id: 'file-recovery', name: 'File recovery', desc: 'Keep snapshots of notes so you can restore an earlier version.', core: true, on: true },
    { id: 'daily-notes', name: 'Daily notes', desc: 'Open a note for today, named by the date.', core: true, on: false },
    { id: 'templates', name: 'Templates', desc: 'Insert a note from the templates folder. {{date}} and {{title}} are filled in.', core: true, on: false },
    { id: 'random-note', name: 'Random note', desc: 'Open a note at random.', core: true, on: false },
    { id: 'bases', name: 'Bases', desc: 'Tables, cards and boards built from notes and their properties.', core: true, on: false },
    { id: 'calendar', name: 'Calendar', desc: 'A month in the sidebar. Click a day for its daily note.', core: false, on: false },
    { id: 'dataview', name: 'Dataview', desc: 'Dataview query blocks, and inline queries written = this.file.name.', core: false, on: false },
    { id: 'tasks', name: 'Tasks', desc: 'Every task in the vault, with due dates, priorities and repeats, plus tasks queries.', core: false, on: false },
    { id: 'kanban', name: 'Kanban', desc: 'Notes with kanban-plugin in their properties open as boards.', core: false, on: false },
    { id: 'templater', name: 'Templater', desc: 'Template commands written <% tp.date.now() %> and the rest of Templater’s syntax.', core: false, on: false },
    { id: 'excalidraw', name: 'Excalidraw', desc: 'Hand-drawn whiteboards, saved as .excalidraw files.', core: false, on: false },
    { id: 'spaced-repetition', name: 'Spaced repetition', desc: 'Flashcards in notes tagged #flashcards, reviewed on a schedule.', core: false, on: false },
    { id: 'periodic-notes', name: 'Periodic notes', desc: 'Weekly and monthly notes, alongside daily notes.', core: false, on: false },
    { id: 'related-notes', name: 'Related notes', desc: 'Notes that share words, tags and links with the one you have open.', core: false, on: false },
    { id: 'inbox', name: 'Inbox', desc: 'A board of stickies for things you capture, and the thin-window sticky layout.', core: false, on: false },
    { id: 'tag-wrangler', name: 'Tag wrangler', desc: 'Rename a tag everywhere it appears.', core: false, on: false },
  ];
  // Obsidian community-plugin ids that correspond to one of the plugins above.
  const COMMUNITY_FROM_OBSIDIAN = {
    calendar: 'calendar', dataview: 'dataview', 'obsidian-tasks': 'tasks', tasks: 'tasks',
    'obsidian-kanban': 'kanban', 'templater-obsidian': 'templater', 'obsidian-excalidraw-plugin': 'excalidraw',
    'obsidian-spaced-repetition': 'spaced-repetition', 'periodic-notes': 'periodic-notes', 'tag-wrangler': 'tag-wrangler',
  };
  const defaultPlugins = () => Object.fromEntries(PLUGINS.map(p => [p.id, !!p.on]));
  // A complete on/off map: unknown or mistyped values fall back to the default for that plugin.
  function normalizePlugins(v) {
    const out = defaultPlugins();
    if (!isObj(v)) return out;
    for (const p of PLUGINS) if (typeof v[p.id] === 'boolean') out[p.id] = v[p.id];
    return out;
  }
  // What to turn on or off from Obsidian's core-plugins.json (an array of ids, or a boolean map),
  // core-plugins-migration.json (a boolean map) and community-plugins.json (an array of ids).
  // Only plugins the files mention are returned; the caller lays them over the defaults.
  function pluginsFromObsidian(o) {
    const out = {};
    if (!isObj(o)) return out;
    const coreIds = PLUGINS.filter(p => p.core).map(p => p.id);
    const migration = isObj(o.corePluginsMigration) ? o.corePluginsMigration : null;
    const coreObj = !migration && isObj(o.corePlugins) ? o.corePlugins : null;
    const map = migration || coreObj;
    if (map) {
      for (const id of coreIds) if (typeof map[id] === 'boolean') out[id] = map[id];
    } else if (Array.isArray(o.corePlugins)) {
      const on = new Set(o.corePlugins.filter(x => typeof x === 'string'));
      for (const id of coreIds) out[id] = on.has(id);
    }
    if (Array.isArray(o.communityPlugins)) {
      for (const id of o.communityPlugins) if (COMMUNITY_FROM_OBSIDIAN[id]) out[COMMUNITY_FROM_OBSIDIAN[id]] = true;
    }
    return out;
  }
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const known = defaults => new Set([...Object.keys(defaults), ...EXTRA_KEYS]);

  // The object to write: previous's unknown keys, plus each vault setting that isn't its default.
  function forFile(cfg, defaults, previous = {}) {
    const k = known(defaults), out = {};
    for (const [key, v] of Object.entries(isObj(previous) ? previous : {})) if (!k.has(key)) out[key] = v;
    for (const key of k) {
      if (LOCAL_KEYS.includes(key) || !(key in cfg)) continue;
      const v = cfg[key];
      if (EXTRA_KEYS.includes(key) ? isObj(v) && Object.keys(v).length : !same(v, defaults[key])) out[key] = v;
    }
    return Object.fromEntries(Object.keys(out).sort().map(key => [key, out[key]]));
  }

  // The vault settings a file gives: every vault setting (its default when missing).
  function fromFile(obj, defaults) {
    const o = isObj(obj) ? obj : {}, out = {};
    for (const key of known(defaults)) {
      if (LOCAL_KEYS.includes(key)) continue;
      const def = EXTRA_KEYS.includes(key) ? {} : defaults[key];
      const v = key in o ? o[key] : def;
      // A value of the wrong kind (a typo in the file) falls back to the default.
      out[key] = EXTRA_KEYS.includes(key) ? (isObj(v) ? v : {}) : typeof v === typeof def || def == null ? v : def;
      if (key === 'plugins') out[key] = normalizePlugins(out[key]);
    }
    return out;
  }

  // A vault's first settings from Obsidian's: o = { daily, templates, app, templater, periodic },
  // the parsed files (.obsidian/daily-notes.json, templates.json, app.json, and the Templater and
  // Periodic Notes plugins' data.json). Only what's there and means the same in Cinder.
  function fromObsidian(o) {
    const out = {};
    if (!isObj(o)) return out;
    const str = v => typeof v === 'string' ? v : null;
    const folder = v => v.replace(/^\/+|\/+$/g, '');
    const note = v => folder(v).replace(/\.md$/i, '');
    const periodic = (p, k) => {
      if (!isObj(p)) return;
      if (str(p.folder) != null) out[k + 'Folder'] = folder(p.folder);
      if (str(p.format)) out[k + 'Format'] = p.format;
      if (str(p.template)) out[k + 'Template'] = note(p.template);
    };
    const pn = isObj(o.periodic) ? o.periodic : {};
    if (isObj(pn.daily) && pn.daily.enabled) periodic(pn.daily, 'daily'); else periodic(o.daily, 'daily');
    if (isObj(pn.weekly) && pn.weekly.enabled) periodic(pn.weekly, 'weekly');
    if (isObj(pn.monthly) && pn.monthly.enabled) periodic(pn.monthly, 'monthly');
    const tf = isObj(o.templates) && str(o.templates.folder) || isObj(o.templater) && str(o.templater.templates_folder);
    if (tf) out.templatesFolder = folder(tf);
    if (isObj(o.templater) && Array.isArray(o.templater.folder_templates)) {
      const lines = o.templater.folder_templates.filter(f => isObj(f) && str(f.folder) && str(f.template)).map(f => `${folder(f.folder)}: ${note(f.template)}`);
      if (lines.length) out.folderTemplates = lines.join('\n');
    }
    if (isObj(o.app)) {
      const a = str(o.app.attachmentFolderPath);
      if (a != null && !a.startsWith('./')) out.attachFolder = folder(a);
      if (o.app.newFileLocation === 'root') out.newNoteFolder = '';
      else if (o.app.newFileLocation === 'folder' && str(o.app.newFileFolderPath) != null) out.newNoteFolder = folder(o.app.newFileFolderPath);
    }
    const plugins = pluginsFromObsidian(o);
    if (Object.keys(plugins).length) out.plugins = plugins;
    return out;
  }

  const api = { forFile, fromFile, fromObsidian, LOCAL_KEYS, PLUGINS, defaultPlugins, normalizePlugins, pluginsFromObsidian };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CinderVaultSettings = api;
})(typeof window !== 'undefined' ? window : globalThis);

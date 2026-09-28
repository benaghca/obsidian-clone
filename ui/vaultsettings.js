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
    return out;
  }

  const api = { forFile, fromFile, fromObsidian, LOCAL_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CinderVaultSettings = api;
})(typeof window !== 'undefined' ? window : globalThis);

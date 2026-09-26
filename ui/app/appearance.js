/* Cinder app — Nerd Font icons and colour themes. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ Nerd Font icons

let nerdIcons = null;
async function loadNerdIcons() {
  if (nerdIcons) return nerdIcons;
  const text = await (await fetch('/vendor/nerd-icons.txt')).text();
  const SETS = { cod: 'Codicons', dev: 'Devicons', fa: 'Font Awesome', fae: 'Font Awesome ext.', iec: 'Power', linux: 'Logos', md: 'Material', oct: 'Octicons', pl: 'Powerline', ple: 'Powerline ext.', pom: 'Pomicons', seti: 'Seti', custom: 'Nerd Fonts', weather: 'Weather' };
  nerdIcons = text.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [name, hex] = l.split(' ');
    const dash = name.indexOf('-');
    return { name: name.slice(dash + 1).replace(/_/g, ' '), full: name, set: SETS[name.slice(0, dash)] || name.slice(0, dash), char: String.fromCodePoint(parseInt(hex, 16)) };
  });
  return nerdIcons;
}
// Search the Nerd Fonts icons by name and insert one (or copy it when no note is open).
async function insertIcon() {
  let icons;
  try { icons = await loadNerdIcons(); } catch (e) { return toast('Couldn’t load the icon list: ' + e.message); }
  const target = S.view === 'note' ? S.cur : null;
  const pick = await picker({
    placeholder: `Search ${icons.length.toLocaleString()} icons… (e.g. github, rust, calendar)`,
    items: q => (q ? rank(icons, q, x => x.full) : icons.slice(0, 60)).map(x => ({ main: `${x.char}   ${x.name}`, sub: x.set, value: x })),
  });
  if (!pick) return;
  if (target && S.cur === target && S.view === 'note') {
    if (S.mode !== 'edit') setMode('edit');
    insertText(ed.selectionStart, ed.selectionEnd, pick.char);
  } else {
    try { await navigator.clipboard.writeText(pick.char); toast(`Copied ${pick.full}`); } catch { toast('Open a note to insert icons'); }
  }
}

// Pick a colour theme, previewing each one as you move through the list.
async function chooseTheme() {
  const orig = cfg.palette;
  const v = await picker({
    placeholder: 'Choose a colour theme…',
    items: q => rank(CinderThemes.list, q, t => t.name).map(t => ({ main: t.name, sub: t.id === orig ? 'current' : '', value: t.id })),
    initial: orig,
    onHighlight: id => { if (cfg.palette !== id) { cfg.palette = id; applyTheme(); } },
  });
  cfg.palette = v || orig;
  saveCfg(); applyTheme();
}

function toggleTheme() {
  cfg.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  saveCfg(); applyTheme();
}


/* Cinder app — the note editor’s glue. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ editor glue

function insertText(a, b, text, selA, selB) { ed.insert(a, b, text, selA, selB); }

const cursorMoved = debounce(() => updateStatus(), 150);

// [[ completion: notes and attachments, aliases, headings after '#', and blocks after '#^'.
function linkOptions(q) {
  const files = [...S.files.keys()];
  const [nm, hd] = splitOnce(q, '#');
  if (hd?.startsWith('^')) return blockOptions(nm, hd.slice(1));
  if (hd != null) {
    const target = nm ? resolveLink(nm, S.cur) : S.cur;
    const n = target && S.notes.get(target);
    if (!n) return [];
    return rank(n.headings.map(h => h.text), hd).slice(0, 30).map(h => ({ label: h, detail: '#', insert: `${nm}#${h}` }));
  }
  const out = rank(files, q, p => noteName(p)).slice(0, 30)
    .map(p => ({ label: noteName(p), detail: dirname(p), insert: linkNameFor(p, files) }));
  if (q) for (const [a, p] of S.byAlias) {
    if (out.length >= 40) break;
    if (!a.includes(q.toLowerCase())) continue;
    const as = (S.notes.get(p)?.aliases || []).find(x => x.toLowerCase() === a) || a; // (as the note writes it)
    out.push({ label: as, detail: '→ ' + noteName(p), insert: `${linkNameFor(p, files)}|${as}` });
  }
  return out;
}

// [[Note#^ lists the note's paragraphs and list items, as in Obsidian. One with a ^id links to it;
// picking one without gives it an id first, at the end of its last line.
function blockOptions(nm, q) {
  const target = nm ? resolveLink(nm, S.cur) : S.cur, n = target && S.notes.get(target);
  if (!n) return [];
  const here = target === S.cur && S.view === 'note';
  const content = here ? ed.value : n.content, lines = content.split('\n');
  const cursorLine = here ? content.slice(0, ed.selectionStart).split('\n').length - 1 : -1;
  const blocks = [];
  let para = null, inCode = false;
  const flush = () => { if (para) blocks.push(para); para = null; };
  for (let i = content.slice(0, splitFrontmatter(content).fmLen).split('\n').length - 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { flush(); inCode = !inCode; continue; }
    if (inCode) continue;
    if (!l.trim() || /^#{1,6}\s/.test(l) || /^\s*\|/.test(l) || /^\s*\^[\w-]+\s*$/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); continue; }
    if (/^\s*([-*+]|\d+[.)])\s/.test(l)) { flush(); blocks.push({ text: l, line: i }); continue; }
    if (para) { para.text += ' ' + l.trim(); para.line = i; } else para = { text: l.trim(), line: i };
  }
  flush();
  const ql = q.toLowerCase(), taken = new Set([...content.matchAll(/\s\^([\w-]+)\s*$/gm)].map(m => m[1]));
  const newId = () => { let id; do id = Math.random().toString(36).slice(2, 8); while (taken.has(id)); taken.add(id); return id; };
  return blocks
    .map(b => ({ line: b.line, id: /\s\^([\w-]+)\s*$/.exec(lines[b.line])?.[1], text: b.text.replace(/\s\^[\w-]+\s*$/, '').replace(/^\s*([-*+]|\d+[.)])\s+(\[.\]\s+)?/, '').trim() }))
    .filter(b => b.text && b.line !== cursorLine && (!ql || b.text.toLowerCase().includes(ql) || b.id?.toLowerCase().startsWith(ql)))
    .slice(0, 30)
    .map(b => {
      const id = b.id || newId();
      const label = b.text.length > 70 ? b.text.slice(0, 69) + '…' : b.text;
      if (b.id) return { label, detail: '^' + id, insert: `${nm}#^${id}` };
      return { label, detail: '', insert: `${nm}#^${id}`, ...(here ? { addId: { line: b.line, id } } : { onPick: () => addBlockId(target, lines[b.line], b.line, id) }) };
    });
}
// Gives a block in another note its ^id (the line found again by its text, if the note has changed).
async function addBlockId(path, text, at, id) {
  const n = S.notes.get(path);
  if (!n) return;
  const lines = n.content.split('\n'), i = lines[at] === text ? at : lines.indexOf(text);
  if (i < 0) return toast(`Couldn’t add ^${id} to ${noteName(path)}: the line has changed`);
  lines[i] = lines[i].replace(/\s*$/, '') + ' ^' + id;
  try { await writeFile(path, lines.join('\n'), n.mtime); } catch (e) { return toast(`Couldn’t add ^${id} to ${noteName(path)}: ${e.message}`); }
  syncSplitPane();
}

function allTags() {
  const set = new Set();
  for (const n of S.notes.values()) for (const t of n.tags) set.add(t);
  return [...set].sort(collator.compare);
}

async function attachAndLink(file, pasted, editor = ed) {
  let name = file.name;
  if (pasted || !name || name === 'image.png') {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    name = `Pasted image ${fmtDate(new Date(), 'YYYYMMDDHHmm')}${String(new Date().getSeconds()).padStart(2, '0')}.${ext}`;
  }
  const path = uniquePath(cfg.attachFolder, name);
  try { await writeFile(path, file); } catch (e) { return toast('Attach failed: ' + e.message); }
  if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
  reindexAll(); renderTree();
  const link = `![[${linkNameFor(path, [...S.files.keys()])}]]`, at = editor.selectionStart;
  if (editor === ed) insertText(ed.selectionStart, ed.selectionEnd, link);
  else editor.insert(editor.selectionStart, editor.selectionEnd, link);
  return { path, from: at, to: at + link.length };
}


// ------------------------------------------------------------ Vim

// Vim's mode (and a command being typed, d2…) for the status bar; null with Vim off.
let vimNow = null;
const VIM_MODES = { normal: 'NORMAL', insert: 'INSERT', replace: 'REPLACE', visual: 'VISUAL', 'visual line': 'VISUAL LINE', 'visual block': 'VISUAL BLOCK' };
const vimStatusHtml = () => vimNow ? `<span class="sb-t sb-vim" title="Vim mode">${VIM_MODES[vimNow.mode] || esc(vimNow.mode.toUpperCase())}${vimNow.pending ? ` <kbd>${esc(vimNow.pending)}</kbd>` : ''}</span>` : '';

// Mappings and options from the vault's .obsidian.vimrc (as Obsidian's Vimrc Support plugin reads
// it), applied when Vim comes on and again when the file has changed. Mappings are added, so one
// taken out of the file stays until Cinder restarts.
// A read that fails says so once, not on every focus; only the latest read is applied, and only
// while Vim is still on (or the file would count as applied without having been).
let vimrcApplied = '', vimrcError = '', vimrcReads = 0;
async function loadVimrc() {
  if (!cfg.vim) return;
  const read = ++vimrcReads;
  let text = '';
  try { text = await api('/api/vimrc'); } catch (e) {
    if (read !== vimrcReads || e.message === vimrcError) return;
    vimrcError = e.message;
    return toast('Couldn’t read .obsidian.vimrc: ' + e.message, 5000);
  }
  if (read !== vimrcReads || !cfg.vim) return;
  vimrcError = '';
  if (!text || text === vimrcApplied) return;
  vimrcApplied = text;
  const skipped = ed.applyVimrc(text);
  if (skipped.length) toast(`.obsidian.vimrc: skipped ${skipped.length === 1 ? 'a line' : skipped.length + ' lines'} Cinder doesn’t run (only mappings and set): ${skipped.slice(0, 3).join(' · ')}`, 8000);
}

// What was copied in other apps is what Vim's p pastes: the clipboard is handed to Vim when the
// window comes back (how other apps' copies arrive) and after a copy in Cinder. In a browser tab,
// only once the page may read the clipboard (it never asks).
async function syncVimClipboard() {
  if (!cfg.vim) return;
  if (!NATIVE) {
    const p = await navigator.permissions?.query({ name: /** @type {PermissionName} */ ('clipboard-read') }).catch(() => null);
    if (p?.state !== 'granted') return;
  }
  try { CinderEditor.vimClipboard(await navigator.clipboard.readText()); } catch { }
}
window.addEventListener('focus', () => { syncVimClipboard(); loadVimrc(); });
for (const t of ['copy', 'cut']) document.addEventListener(t, () => setTimeout(syncVimClipboard, 50));

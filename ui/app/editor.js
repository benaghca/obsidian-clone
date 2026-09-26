/* Cinder app — the note editor’s glue. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ editor glue

function insertText(a, b, text, selA, selB) { ed.insert(a, b, text, selA, selB); }

const cursorMoved = debounce(() => updateStatus(), 150);

// [[ completion: notes and attachments, aliases, and headings after '#'.
function linkOptions(q) {
  const files = [...S.files.keys()];
  const [nm, hd] = splitOnce(q, '#');
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
    if (a.includes(q.toLowerCase())) out.push({ label: a, detail: '→ ' + noteName(p), insert: `${linkNameFor(p, files)}|${a}` });
  }
  return out;
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


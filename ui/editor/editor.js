// Folio editor: CodeMirror 6 + an Obsidian-style live preview layer.
//
// Bundled into ui/vendor/editor.bundle.js with `npm install && npm run build` in ui/editor/.
// app.js talks to it only through FolioEditor.create(parent, hooks).

import { EditorState, EditorSelection, StateField, StateEffect, Compartment, Prec, Annotation, Facet } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, keymap, placeholder, drawSelection, dropCursor, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, insertTab } from '@codemirror/commands';
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion, completionStatus } from '@codemirror/autocomplete';
import { vim, getCM } from '@replit/codemirror-vim';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { classHighlighter, tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';

// ------------------------------------------------------------------ markdown dialect

const Punct = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\p{P}\p{S}]/u;
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

// Obsidian extras on top of GFM: [[wikilinks]], ![[embeds]], ==highlights==, #tags, frontmatter, $math$.
const BLOCK_MATH_START = /^(\s{0,3})\$\$/;
const ObsidianMarkdown = {
  defineNodes: ['WikiLink', 'Embed', 'WikiMark', 'Highlight', 'HighlightMark', 'Tag', { name: 'Frontmatter', block: true }, 'FrontmatterMark',
    'InlineMath', 'InlineMathMark', { name: 'BlockMath', block: true }, 'BlockMathMark'],
  parseInline: [
    {
      // $x^2$ (not "$5 and $10": the opening $ can't be followed by a space, nor the closing one
      // preceded by a space or followed by a digit) and $$display$$ inside a paragraph.
      name: 'InlineMath', before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== 36) return -1;
        const display = cx.char(pos + 1) === 36, open = display ? 2 : 1;
        const rest = cx.slice(pos + open, cx.end);
        const m = display ? /^(?:\\.|[^\\$])+?\$\$/.exec(rest) : /^(?![\s$])(?:\\.|[^\\$\n])*?[^\s\\]\$(?!\d)/.exec(rest);
        if (!m) return -1;
        const end = pos + open + m[0].length;
        return cx.addElement(cx.elt('InlineMath', pos, end, [cx.elt('InlineMathMark', pos, pos + open), cx.elt('InlineMathMark', end - open, end)]));
      },
    },
    {
      name: 'WikiLink', before: 'Link',
      parse(cx, next, pos) {
        const embed = next === 33 && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91;
        if (!embed && !(next === 91 && cx.char(pos + 1) === 91)) return -1;
        const start = pos + (embed ? 3 : 2);
        const m = /^[^\[\]\n]+?\]\]/.exec(cx.slice(start, cx.end));
        if (!m) return -1;
        const end = start + m[0].length;
        return cx.addElement(cx.elt(embed ? 'Embed' : 'WikiLink', pos, end,
          [cx.elt('WikiMark', pos, start), cx.elt('WikiMark', end - 2, end)]));
      },
    },
    {
      name: 'Highlight', after: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
        const sB = /\s|^$/.test(before), sA = /\s|^$/.test(after);
        const pB = Punct.test(before), pA = Punct.test(after);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sA && (!pA || sB || pB), !sB && (!pB || sA || pA));
      },
    },
    {
      name: 'Tag',
      parse(cx, next, pos) {
        if (next !== 35) return -1;
        const prev = cx.slice(pos - 1, pos);
        if (prev && !/[\s(,;]/.test(prev)) return -1;
        const m = /^#([\p{L}\p{N}_\-\/]+)/u.exec(cx.slice(pos, cx.end));
        if (!m || /^[\d\/]+$/.test(m[1])) return -1;
        return cx.addElement(cx.elt('Tag', pos, pos + m[0].length));
      },
    },
  ],
  parseBlock: [{
    // $$ … $$ on their own lines (the closing $$ may end a line of the formula).
    name: 'BlockMath', before: 'FencedCode',
    parse(cx, line) {
      const m = BLOCK_MATH_START.exec(line.text);
      if (!m) return false;
      const start = cx.lineStart + m[1].length;
      const marks = [cx.elt('BlockMathMark', start, start + 2)];
      const first = line.text.slice(m[0].length).trimEnd();
      if (first.length >= 2 && first.endsWith('$$')) { // $$ on one line $$
        const end = cx.lineStart + m[0].length + first.length;
        marks.push(cx.elt('BlockMathMark', end - 2, end));
        cx.nextLine();
        cx.addElement(cx.elt('BlockMath', start, end, marks));
        return true;
      }
      let end = cx.lineStart + line.text.length;
      while (cx.nextLine()) {
        const t = line.text.trimEnd();
        if (t.endsWith('$$')) {
          end = cx.lineStart + t.length;
          marks.push(cx.elt('BlockMathMark', end - 2, end));
          cx.nextLine();
          break;
        }
        end = cx.lineStart + line.text.length;
      }
      cx.addElement(cx.elt('BlockMath', start, end, marks));
      return true;
    },
    endLeaf: (cx, line) => BLOCK_MATH_START.test(line.text),
  }, {
    name: 'Frontmatter', before: 'HorizontalRule',
    parse(cx, line) {
      if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
      const start = cx.lineStart;
      const marks = [cx.elt('FrontmatterMark', start, start + line.text.length)];
      while (cx.nextLine()) {
        if (/^---\s*$/.test(line.text)) {
          marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + line.text.length));
          cx.nextLine();
          break;
        }
      }
      cx.addElement(cx.elt('Frontmatter', start, cx.prevLineEnd(), marks));
      return true;
    },
  }],
};

const codeLanguages = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'ts', 'typescript', 'tsx'], support: javascript({ typescript: true, jsx: true }) }),
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'json', support: json() }),
  LanguageDescription.of({ name: 'rust', alias: ['rs'], support: rust() }),
  LanguageDescription.of({ name: 'sql', support: sql() }),
  LanguageDescription.of({ name: 'shell', alias: ['sh', 'bash', 'zsh', 'console'], support: new LanguageSupport(StreamLanguage.define(shell)) }),
  LanguageDescription.of({ name: 'powershell', alias: ['ps1', 'pwsh'], support: new LanguageSupport(StreamLanguage.define(powerShell)) }),
];

// Markdown punctuation gets a class so source mode can dim it.
const markStyle = HighlightStyle.define([
  { tag: t.processingInstruction, class: 'tok-mark' },
  { tag: t.monospace, class: 'tok-mono' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: t.contentSeparator, class: 'tok-mark' },
]);

// ------------------------------------------------------------------ state: focus & refresh

const setFocus = StateEffect.define();
const refresh = StateEffect.define();
const silent = Annotation.define();

const focusField = StateField.define({
  create: () => false,
  update(v, tr) { for (const e of tr.effects) if (e.is(setFocus)) v = e.value; return v; },
});

// Which parts of the document is the user "inside"? Syntax there stays visible.
function activity(state) {
  const ranges = state.field(focusField) ? state.selection.ranges : [];
  const doc = state.doc;
  return {
    touches: (from, to) => ranges.some(r => r.from <= to && r.to >= from),
    lines: (from, to) => {
      const a = doc.lineAt(from).from, b = doc.lineAt(to).to;
      return ranges.some(r => r.from <= b && r.to >= a);
    },
  };
}

// ------------------------------------------------------------------ widgets

class CheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  eq(o) { return o.checked === this.checked; }
  toDOM() {
    const el = document.createElement('input');
    el.type = 'checkbox'; el.checked = this.checked; el.className = 'cm-task-cb'; el.tabIndex = -1;
    return el;
  }
  ignoreEvent() { return false; }
}

class TextWidget extends WidgetType {
  constructor(text, cls) { super(); this.text = text; this.cls = cls; }
  eq(o) { return o.text === this.text && o.cls === this.cls; }
  toDOM() { const s = document.createElement('span'); s.className = this.cls; s.textContent = this.text; return s; }
}

// Images. app.js handles clicks (viewer), right-clicks (menu) and the resize grip, finding the
// link through posAtDOM; the widget ignores events so the editor leaves them alone.
class ImageWidget extends WidgetType {
  constructor(src, alt, width, block) { super(); this.src = src; this.alt = alt; this.width = width; this.block = block; }
  eq(o) { return o.src === this.src && o.width === this.width && o.block === this.block; }
  toDOM() {
    const wrap = document.createElement(this.block ? 'div' : 'span');
    wrap.className = (this.block ? 'cm-embed-block cm-image-block' : 'cm-image-inline') + ' cm-image';
    const img = document.createElement('img');
    img.src = this.src; img.alt = this.alt || '';
    if (this.width) img.width = this.width;
    const grip = document.createElement('span');
    grip.className = 'cm-img-grip'; grip.title = 'Drag to resize';
    wrap.append(img, grip);
    return wrap;
  }
}

// ![alt|300](src) sizes a Markdown image the way ![[img.png|300]] does.
const altWidth = alt => { const m = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt || ''); return m ? [m[1], parseInt(m[2])] : [alt || '', null]; };

// app.js hooks, per editor (the note editor and canvas card editors have their own).
const hooksFacet = Facet.define({ combine: v => v[0] || {} });
const hooksOf = state => state.facet(hooksFacet);

class EmbedWidget extends WidgetType {
  constructor(path, sub, version, h) { super(); this.path = path; this.sub = sub; this.version = version; this.h = h; }
  eq(o) { return o.path === this.path && o.sub === this.sub && o.version === this.version; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-note-embed';
    this.h.renderEmbed(el, this.path, this.sub);
    return el;
  }
}

// Embeds app.js renders itself (drawings, canvases, bases): hooks.visualEmbed(path) says which.
class VisualEmbedWidget extends WidgetType {
  constructor(path, width, sub, version, h) { super(); this.path = path; this.width = width; this.sub = sub; this.version = version; this.h = h; }
  eq(o) { return o.path === this.path && o.width === this.width && o.sub === this.sub && o.version === this.version; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-visual-embed';
    this.h.renderVisualEmbed(el, this.path, this.width, this.sub);
    return el;
  }
}

// Fenced code blocks app.js renders itself (```base, ```tasks …), with a button to edit the source.
class CodeBlockWidget extends WidgetType {
  constructor(lang, code, version, h) { super(); this.lang = lang; this.code = code; this.version = version; this.h = h; }
  eq(o) { return o.lang === this.lang && o.code === this.code && o.version === this.version; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-codeblock-widget';
    const body = document.createElement('div');
    const edit = document.createElement('button');
    edit.className = 'cm-codeblock-edit';
    edit.title = 'Edit the source';
    edit.textContent = '</>';
    edit.addEventListener('mousedown', e => {
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(el));
      view.dispatch({ selection: { anchor: line.to } });
      view.focus();
    });
    el.append(body, edit);
    this.h.renderCodeBlock(body, this.lang, this.code);
    return el;
  }
}

class TableWidget extends WidgetType {
  constructor(text, version, h) { super(); this.text = text; this.version = version; this.h = h; }
  eq(o) { return o.text === this.text && o.version === this.version; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-table-widget markdown';
    this.h.renderMarkdown(el, this.text);
    return el;
  }
}

// The note's frontmatter as a table of properties (app.js draws it with FolioProps). Edits come
// back as a function over the whole text, applied as the smallest change so undo stays tidy.
class PropsWidget extends WidgetType {
  constructor(text, version, h) { super(); this.text = text; this.version = version; this.h = h; }
  eq(o) { return o.text === this.text && o.version === this.version; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-props-block markdown';
    el.ctl = this.h.renderProperties(el, this.text, {
      edit: f => applyEdit(view, f),
      exit: dir => dir === 'up' ? this.h.focusTitle?.() : afterProps(view),
    });
    return el;
  }
  ignoreEvent() { return true; }
}
function applyEdit(view, f) {
  const doc = view.state.doc.toString(), next = f(doc);
  if (next === doc) return;
  let a = 0, b = 0;
  while (a < doc.length && a < next.length && doc[a] === next[a]) a++;
  while (b < doc.length - a && b < next.length - a && doc[doc.length - 1 - b] === next[next.length - 1 - b]) b++;
  view.dispatch({ changes: { from: a, to: doc.length - b, insert: next.slice(a, next.length - b) }, userEvent: 'input.properties' });
}
// End of the frontmatter's closing line, or -1.
function propsEnd(state) {
  const n = syntaxTree(state).topNode.firstChild;
  return n && n.name === 'Frontmatter' && n.from === 0 ? state.doc.lineAt(n.to).to : -1;
}
const showsProps = state => !!hooksOf(state).propertiesFor?.(state.doc.sliceString(0, Math.max(0, propsEnd(state))));
// Keyboard back into the text, just below the properties.
function afterProps(view) {
  const end = propsEnd(view.state);
  view.focus();
  if (end >= 0) view.dispatch({ selection: { anchor: Math.min(end + 1, view.state.doc.length) }, scrollIntoView: true });
}
// With properties showing, the cursor never sits inside the frontmatter's hidden text.
const skipProps = EditorState.transactionFilter.of(tr => {
  if (!tr.selection) return tr;
  const st = tr.state, end = propsEnd(st);
  if (end < 0 || !tr.newSelection.ranges.some(r => r.empty && r.head <= end) || !showsProps(st)) return tr;
  const extra = end >= st.doc.length ? { changes: { from: st.doc.length, insert: '\n' } } : {};
  const to = end + 1;
  return [tr, { ...extra, selection: EditorSelection.create(tr.newSelection.ranges.map(r => r.empty && r.head <= end ? EditorSelection.cursor(to) : r), tr.newSelection.mainIndex), sequential: true }];
});

// A rendered formula. preview: shown next to the source while it's being edited.
class MathWidget extends WidgetType {
  constructor(tex, display, h, preview = false) { super(); this.tex = tex; this.display = display; this.h = h; this.preview = preview; }
  eq(o) { return o.tex === this.tex && o.display === this.display && o.preview === this.preview; }
  toDOM() {
    const el = document.createElement(this.display && !this.preview ? 'div' : this.display ? 'div' : 'span');
    el.className = this.preview ? (this.display ? 'cm-math-preview cm-math-preview-block' : 'cm-math-preview') : this.display ? 'cm-embed-block cm-math-block' : 'cm-math-inline';
    if (this.h.renderMath) this.h.renderMath(el, this.tex, this.display);
    else el.textContent = this.tex;
    return el;
  }
  // Clicking a formula puts the cursor there, which reveals its source.
  ignoreEvent() { return false; }
}

// The TeX between a math node's delimiters.
function mathTex(doc, node) {
  const marks = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (/MathMark$/.test(c.name)) marks.push(c);
  const from = marks[0] ? marks[0].to : node.from, to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
  return doc.sliceString(from, Math.max(from, to));
}

// ------------------------------------------------------------------ live preview: inline

const hideDeco = Decoration.replace({});
const lineCls = cls => Decoration.line({ class: cls });
const markCls = (cls, attrs) => Decoration.mark(attrs ? { class: cls, attributes: attrs } : { class: cls });
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function parseWiki(inner) {
  const bar = inner.indexOf('|');
  const tgt = bar < 0 ? inner : inner.slice(0, bar);
  const alias = bar < 0 ? null : inner.slice(bar + 1);
  const hash = tgt.indexOf('#');
  return { name: (hash < 0 ? tgt : tgt.slice(0, hash)).trim(), sub: hash < 0 ? '' : tgt.slice(hash + 1).trim(), alias, bar };
}

// Is this node the only thing on its line (so it can become a block widget)?
function aloneOnLine(doc, from, to) {
  const line = doc.lineAt(from);
  return to <= line.to && line.text.trim() === doc.sliceString(from, to).trim();
}

function buildInline(view) {
  const { state } = view, doc = state.doc;
  const A = activity(state), h = hooksOf(state);
  const out = [];
  const hide = (from, to) => { if (to > from) out.push(hideDeco.range(from, to)); };
  const lineDeco = (pos, cls) => out.push(lineCls(cls).range(doc.lineAt(pos).from));
  const eachLine = (from, to, fn) => {
    for (let l = doc.lineAt(from); ; l = doc.line(l.number + 1)) { fn(l); if (l.to >= to || l.number === doc.lines) break; }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        const name = node.name;
        const nf = node.from, nt = node.to;
        let m;
        if ((m = /^ATXHeading(\d)$/.exec(name))) { lineDeco(nf, `cm-h cm-h${m[1]}`); return; }
        if ((m = /^SetextHeading(\d)$/.exec(name))) { lineDeco(nf, `cm-h cm-h${m[1]}`); return; }
        switch (name) {
          case 'HeaderMark': {
            const p = node.node.parent;
            if (p && /^Setext/.test(p.name)) { out.push(markCls('cm-faint').range(nf, nt)); return; }
            if (A.lines(nf, nt)) { out.push(markCls('cm-faint').range(nf, nt)); return; }
            const line = doc.lineAt(nf);
            if (nf === line.from || /^\s*$/.test(doc.sliceString(line.from, nf))) hide(line.from, Math.min(line.to, nt + 1));
            else hide(doc.sliceString(nf - 1, nf) === ' ' ? nf - 1 : nf, nt);
            return;
          }
          case 'Emphasis': out.push(markCls('cm-em').range(nf, nt)); return;
          case 'StrongEmphasis': out.push(markCls('cm-strong').range(nf, nt)); return;
          case 'Strikethrough': out.push(markCls('cm-strike').range(nf, nt)); return;
          case 'Highlight': out.push(markCls('cm-hl').range(nf, nt)); return;
          case 'InlineCode': out.push(markCls('cm-icode').range(nf, nt)); return;
          case 'EmphasisMark': case 'StrikethroughMark': case 'HighlightMark': {
            const p = node.node.parent;
            if (p && !A.touches(p.from, p.to)) hide(nf, nt); else out.push(markCls('cm-faint').range(nf, nt));
            return;
          }
          case 'CodeMark': {
            const p = node.node.parent;
            if (p?.name === 'InlineCode') { if (!A.touches(p.from, p.to)) hide(nf, nt); else out.push(markCls('cm-faint').range(nf, nt)); }
            return;
          }
          case 'FencedCode': case 'CodeBlock': {
            const first = doc.lineAt(nf).number, last = doc.lineAt(nt).number;
            eachLine(nf, nt, l => {
              let cls = 'cm-codeblock';
              if (l.number === first) cls += ' cm-codeblock-first';
              if (l.number === last) cls += ' cm-codeblock-last';
              out.push(lineCls(cls).range(l.from));
            });
            return;
          }
          case 'CodeInfo': out.push(markCls('cm-codeinfo').range(nf, nt)); return;
          case 'Blockquote': {
            const firstLine = doc.lineAt(nf);
            const cm = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/.exec(firstLine.text);
            eachLine(nf, nt, l => out.push(lineCls(cm ? `cm-callout c-${cm[2].toLowerCase()}` + (l.number === firstLine.number ? ' cm-callout-title' : '') : 'cm-quote').range(l.from)));
            if (cm && !A.lines(firstLine.from, firstLine.from)) {
              const s = firstLine.from + cm[1].length;
              const e = s + 2 + cm[2].length + 1 + cm[3].length;
              if (cm[4].trim()) hide(s, Math.min(firstLine.to, e + (doc.sliceString(e, e + 1) === ' ' ? 1 : 0)));
              else out.push(Decoration.replace({ widget: new TextWidget(cm[2], 'cm-callout-label') }).range(s, e));
            }
            return;
          }
          case 'QuoteMark': {
            if (A.lines(nf, nt)) { out.push(markCls('cm-faint').range(nf, nt)); return; }
            hide(nf, doc.sliceString(nt, nt + 1) === ' ' ? nt + 1 : nt);
            return;
          }
          case 'ListMark': {
            const item = node.node.parent, list = item?.parent;
            const task = node.node.nextSibling?.name === 'Task';
            if (A.lines(nf, nt)) { out.push(markCls('cm-listmark').range(nf, nt)); return; }
            if (task) { hide(nf, doc.sliceString(nt, nt + 1) === ' ' ? nt + 1 : nt); return; }
            if (list?.name === 'BulletList') out.push(Decoration.replace({ widget: new TextWidget('•', 'cm-bullet') }).range(nf, nt));
            else out.push(markCls('cm-listmark').range(nf, nt));
            return;
          }
          case 'Task': {
            const marker = node.node.firstChild;
            if (marker && /x/i.test(doc.sliceString(marker.from, marker.to))) out.push(markCls('cm-task-done').range(marker.to, nt));
            return;
          }
          case 'TaskMarker': {
            if (A.touches(nf, nt)) return;
            const checked = /x/i.test(doc.sliceString(nf, nt));
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(nf, nt));
            return;
          }
          case 'HorizontalRule': {
            if (A.lines(nf, nt)) return;
            lineDeco(nf, 'cm-hr'); hide(nf, nt);
            return;
          }
          case 'Frontmatter': {
            eachLine(nf, nt, l => out.push(lineCls('cm-frontmatter').range(l.from)));
            return false;
          }
          case 'Link': {
            const marks = [];
            let url = null;
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === 'LinkMark') marks.push(c);
              if (c.name === 'URL') url = doc.sliceString(c.from, c.to);
            }
            if (marks.length < 2) return;
            const textFrom = marks[0].to, textTo = marks[1].from;
            const href = url ? url.replace(/^<|>$/g, '') : null;
            const external = href && /^[a-z][a-z0-9+.-]*:/i.test(href);
            const attrs = href ? (external ? { 'data-url': href } : { 'data-link': safeDecode(href.split('#')[0]), 'data-sub': href.split('#')[1] || '' }) : null;
            if (A.touches(nf, nt)) {
              if (attrs) out.push(markCls('cm-link cm-raw', attrs).range(textFrom, textTo));
              out.push(markCls('cm-faint').range(textTo, nt));
              return false;
            }
            hide(nf, textFrom);
            if (textTo > textFrom) out.push(markCls('cm-link', attrs ? { ...attrs, 'data-live': '1' } : undefined).range(textFrom, textTo));
            hide(textTo, nt);
            return false;
          }
          case 'Image': {
            if (A.touches(nf, nt) || aloneOnLine(doc, nf, nt)) return false;
            const src = /\]\(\s*<?([^)\s>]+)/.exec(doc.sliceString(nf, nt))?.[1];
            const [alt, width] = altWidth(/^!\[([^\]]*)\]/.exec(doc.sliceString(nf, nt))?.[1]);
            const url = src && h.imageUrl(src);
            if (url) out.push(Decoration.replace({ widget: new ImageWidget(url, alt, width, false) }).range(nf, nt));
            return false;
          }
          case 'URL': {
            if (node.node.parent?.name === 'Link' || node.node.parent?.name === 'Image') return;
            const u = doc.sliceString(nf, nt);
            out.push(markCls('cm-link cm-url', { 'data-url': /^www\./.test(u) ? 'https://' + u : u, ...(A.touches(nf, nt) ? {} : { 'data-live': '1' }) }).range(nf, nt));
            return;
          }
          case 'WikiLink': {
            const inner = doc.sliceString(nf + 2, nt - 2);
            const w = parseWiki(inner);
            const target = h.resolve(w.name);
            const attrs = { 'data-link': w.name, 'data-sub': w.sub };
            const cls = 'cm-wikilink' + (target || !w.name ? '' : ' cm-unresolved');
            if (A.touches(nf, nt)) {
              out.push(markCls('cm-faint').range(nf, nf + 2), markCls(cls + ' cm-raw', attrs).range(nf + 2, nt - 2), markCls('cm-faint').range(nt - 2, nt));
              return false;
            }
            attrs['data-live'] = '1';
            if (w.alias != null) {
              hide(nf, nf + 2 + w.bar + 1);
              out.push(markCls(cls, attrs).range(nf + 2 + w.bar + 1, nt - 2));
            } else if (w.sub && w.name) {
              hide(nf, nf + 2);
              out.push(markCls(cls, attrs).range(nf + 2, nt - 2));
            } else {
              hide(nf, nf + 2);
              out.push(markCls(cls, attrs).range(nf + 2, nt - 2));
            }
            hide(nt - 2, nt);
            return false;
          }
          case 'Embed': {
            if (A.touches(nf, nt)) {
              const w = parseWiki(doc.sliceString(nf + 3, nt - 2));
              out.push(markCls('cm-faint').range(nf, nf + 3), markCls('cm-wikilink cm-raw', { 'data-link': w.name, 'data-sub': w.sub }).range(nf + 3, nt - 2), markCls('cm-faint').range(nt - 2, nt));
              return false;
            }
            if (aloneOnLine(doc, nf, nt)) return false; // block widget handles it
            const w = parseWiki(doc.sliceString(nf + 3, nt - 2));
            const target = h.resolve(w.name);
            if (target && IMG_EXT.test(target)) {
              const width = w.alias && /^\d+/.test(w.alias) ? parseInt(w.alias) : null;
              out.push(Decoration.replace({ widget: new ImageWidget(h.rawUrl(target), w.name, width, false) }).range(nf, nt));
            } else {
              hide(nf, nf + 3);
              out.push(markCls('cm-wikilink' + (target ? '' : ' cm-unresolved'), { 'data-link': w.name, 'data-sub': w.sub, 'data-live': '1' }).range(nf + 3, nt - 2));
              hide(nt - 2, nt);
            }
            return false;
          }
          case 'InlineMath': {
            const tex = mathTex(doc, node.node), display = doc.sliceString(nf, nf + 2) === '$$';
            if (A.touches(nf, nt)) {
              out.push(markCls('cm-math-src').range(nf, nt));
              if (tex.trim()) out.push(Decoration.widget({ widget: new MathWidget(tex, false, h, true), side: 1 }).range(nt));
            } else out.push(Decoration.replace({ widget: new MathWidget(tex, display, h) }).range(nf, nt));
            return false;
          }
          case 'BlockMath': {
            if (A.lines(nf, nt)) eachLine(nf, nt, l => out.push(lineCls('cm-math-src-line').range(l.from)));
            return false;
          }
          case 'Tag': {
            const tag = doc.sliceString(nf + 1, nt);
            out.push(markCls('cm-tag', A.touches(nf, nt) ? { 'data-tag': tag } : { 'data-tag': tag, 'data-live': '1' }).range(nf, nt));
            return;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

const livePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildInline(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) ||
      u.transactions.some(tr => tr.effects.some(e => e.is(setFocus) || e.is(refresh))))
      this.decorations = buildInline(u.view);
  }
}, { decorations: v => v.decorations });

// ------------------------------------------------------------------ live preview: blocks (tables, full-line embeds)

function buildBlocks(state) {
  const A = activity(state), doc = state.doc, out = [], h = hooksOf(state);
  syntaxTree(state).iterate({
    enter(node) {
      const nf = node.from, nt = node.to;
      if (node.name === 'Frontmatter') {
        const text = doc.sliceString(nf, doc.lineAt(nt).to);
        if (nf === 0 && h.propertiesFor?.(text)) out.push(Decoration.replace({ widget: new PropsWidget(text, h.version(), h), block: true }).range(0, doc.lineAt(nt).to));
        return false;
      }
      if (node.name === 'BlockMath') {
        const first = doc.lineAt(nf), last = doc.lineAt(nt), tex = mathTex(doc, node.node);
        // Being edited: the source stays, with a live rendering underneath.
        if (A.lines(first.from, last.to)) { if (tex.trim()) out.push(Decoration.widget({ widget: new MathWidget(tex, true, h, true), block: true, side: 1 }).range(last.to)); }
        else out.push(Decoration.replace({ widget: new MathWidget(tex, true, h), block: true }).range(first.from, last.to));
        return false;
      }
      if (node.name === 'FencedCode' && h.codeBlock) {
        const info = node.node.getChild('CodeInfo');
        const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : '';
        if (!lang || !h.codeBlock(lang)) return false;
        const first = doc.lineAt(nf), last = doc.lineAt(nt);
        if (A.lines(first.from, last.to)) return false;
        const closed = last.number > first.number && /^\s*(```|~~~)/.test(doc.sliceString(last.from, last.to));
        const end = closed ? last.from - 1 : last.to;
        const code = end > first.to ? doc.sliceString(first.to + 1, end) : '';
        out.push(Decoration.replace({ widget: new CodeBlockWidget(lang, code, h.version(), h), block: true }).range(first.from, last.to));
        return false;
      }
      if (node.name === 'Table') {
        const from = doc.lineAt(nf).from, to = doc.lineAt(nt).to;
        if (!A.lines(from, to)) {
          const text = doc.sliceString(from, to);
          out.push(Decoration.replace({ widget: new TableWidget(text, h.version(), h), block: true }).range(from, to));
        }
        return false;
      }
      if (node.name === 'Embed' || node.name === 'Image') {
        if (!aloneOnLine(doc, nf, nt)) return false;
        const line = doc.lineAt(nf);
        if (A.lines(line.from, line.to)) return false;
        let widget = null;
        if (node.name === 'Embed') {
          const w = parseWiki(doc.sliceString(nf + 3, nt - 2));
          const target = h.resolve(w.name);
          const width = w.alias && /^\d+/.test(w.alias) ? parseInt(w.alias) : null;
          if (target && h.visualEmbed && h.visualEmbed(target)) {
            widget = new VisualEmbedWidget(target, width, w.sub, h.version(), h);
          } else if (target && IMG_EXT.test(target)) {
            widget = new ImageWidget(h.rawUrl(target), w.name, width, true);
          } else if (target && /\.md$/i.test(target)) {
            widget = new EmbedWidget(target, w.sub, h.version(), h);
          }
        } else {
          const text = doc.sliceString(nf, nt);
          const src = /\]\(\s*<?([^)\s>]+)/.exec(text)?.[1];
          const url = src && h.imageUrl(src);
          const [alt, width] = altWidth(/^!\[([^\]]*)\]/.exec(text)?.[1]);
          if (url) widget = new ImageWidget(url, alt, width, true);
        }
        if (widget) out.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
        return false;
      }
    },
  });
  return Decoration.set(out, true);
}

const blockField = StateField.define({
  create: s => buildBlocks(s),
  update(v, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some(e => e.is(setFocus) || e.is(refresh))) return buildBlocks(tr.state);
    return v;
  },
  provide: f => EditorView.decorations.from(f),
});

// Clicks on rendered links, tags and checkboxes.
const clickHandler = EditorView.domEventHandlers({
  mousedown(e, view) {
    const cb = e.target.closest?.('.cm-task-cb');
    if (cb) {
      e.preventDefault();
      const pos = view.posAtDOM(cb);
      const line = view.state.doc.lineAt(pos), rep = toggledLine(hooksOf(view.state), line.text);
      if (rep != null) { view.dispatch({ changes: { from: line.from, to: line.to, insert: rep } }); return true; }
      const cur = view.state.sliceDoc(pos, pos + 3);
      if (/^\[[ xX]\]$/.test(cur)) view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: cur[1] === ' ' ? 'x' : ' ' } });
      return true;
    }
    // Clicking a rendered table drops the cursor into it, revealing the Markdown.
    const tw = e.target.closest?.('.cm-table-widget');
    if (tw && e.button === 0) {
      e.preventDefault();
      const pos = view.posAtDOM(tw);
      view.focus();
      view.dispatch({ selection: { anchor: Math.min(pos + 2, view.state.doc.lineAt(pos).to) } });
      return true;
    }
    const el = e.target.closest?.('[data-link],[data-url],[data-tag]');
    if (!el || e.button !== 0) return false;
    if (!el.dataset.live && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    const h = hooksOf(view.state);
    if (el.dataset.link != null) h.follow(el.dataset.link, el.dataset.sub || '');
    else if (el.dataset.url) h.openUrl(el.dataset.url);
    else if (el.dataset.tag) h.tag(el.dataset.tag);
    return true;
  },
});

const livePreview = [livePlugin, blockField, clickHandler, skipProps];

// ------------------------------------------------------------------ commands

const wrap = (before, after = before) => view => {
  view.dispatch(view.state.changeByRange(r => {
    const s = view.state.sliceDoc(r.from - before.length, r.from), e = view.state.sliceDoc(r.to, r.to + after.length);
    if (s === before && e === after) {
      return { changes: [{ from: r.from - before.length, to: r.from }, { from: r.to, to: r.to + after.length }], range: EditorSelection.range(r.from - before.length, r.to - before.length) };
    }
    return { changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }], range: EditorSelection.range(r.from + before.length, r.to + before.length) };
  }));
  return true;
};

// app.js decides how a task line toggles (done date, next occurrence of a recurring task).
function toggledLine(h, text) {
  const r = h.toggleTaskLine && h.toggleTaskLine(text);
  return r ? r.join('\n') : null;
}

function toggleCheckbox(view) {
  const changes = [];
  const seen = new Set();
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.head);
    if (seen.has(line.number)) continue; seen.add(line.number);
    let m;
    if ((m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text))) {
      const rep = toggledLine(hooksOf(view.state), line.text);
      if (rep != null) { changes.push({ from: line.from, to: line.to, insert: rep }); continue; }
      const p = line.from + m[1].length + 1;
      changes.push({ from: p, to: p + 1, insert: m[2] === ' ' ? 'x' : ' ' });
    } else if ((m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)/.exec(line.text))) {
      changes.push({ from: line.from + m[1].length, insert: '[ ] ' });
    } else {
      const ind = /^\s*/.exec(line.text)[0].length;
      changes.push({ from: line.from + ind, insert: '- [ ] ' });
    }
  }
  view.dispatch({ changes });
  return true;
}

const isListLine = (state, pos) => /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s/.test(state.doc.lineAt(pos).text);

function smartTab(view) {
  const s = view.state;
  if (s.selection.ranges.some(r => !r.empty || isListLine(s, r.head))) return indentMore(view);
  return insertTab(view);
}

// Insert a $$ … $$ block around the selection (or an empty one), cursor inside.
function blockMath(view) {
  view.dispatch(view.state.changeByRange(r => {
    const text = view.state.sliceDoc(r.from, r.to);
    const line = view.state.doc.lineAt(r.from);
    const pre = r.from === line.from ? '' : '\n';
    const insert = `${pre}$$\n${text}\n$$\n`;
    const at = r.from + pre.length + 3;
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(at, at + text.length) };
  }));
  return true;
}

// The lines the selection touches, each once (blank lines skipped when there are several).
function selectedLines(state) {
  const out = new Map();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number, end = state.doc.lineAt(r.to).number; n <= end; n++) out.set(n, state.doc.line(n));
  }
  const lines = [...out.values()];
  return lines.length > 1 ? lines.filter(l => l.text.trim()) : lines;
}

// Make the selected lines headings of `level` (0: plain text); the same level again removes it.
const setHeading = level => view => {
  const lines = selectedLines(view.state);
  const same = level && lines.every(l => (/^(#{1,6})\s/.exec(l.text)?.[1].length || 0) === level);
  view.dispatch({
    changes: lines.map(l => ({ from: l.from, to: l.from + (/^#{1,6}\s+/.exec(l.text)?.[0].length || 0), insert: same || !level ? '' : '#'.repeat(level) + ' ' })),
    scrollIntoView: true,
  });
  return true;
};

// Turn the selected lines into a bullet, numbered or task list, or back into text if they all are one.
const LIST_KIND = t => /^\s*[-*+]\s+\[.\]\s/.test(t) ? 'task' : /^\s*[-*+]\s/.test(t) ? 'bullet' : /^\s*\d+[.)]\s/.test(t) ? 'numbered' : null;
const toggleList = kind => view => {
  const lines = selectedLines(view.state);
  const all = lines.every(l => LIST_KIND(l.text) === kind);
  let n = 1;
  view.dispatch({
    changes: lines.map(l => {
      const m = /^(\s*)(?:[-*+]\s+\[.\]\s+|[-*+]\s+|\d+[.)]\s+)?/.exec(l.text);
      const insert = all ? '' : kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n++}. `;
      return { from: l.from + m[1].length, to: l.from + m[0].length, insert };
    }),
  });
  return true;
};

// Obsidian's "Add file property": starts the frontmatter if there is none, then asks for a name.
function addProperty(view) {
  if (propsEnd(view.state) < 0) view.dispatch({ changes: { from: 0, insert: '---\n---\n' }, userEvent: 'input.properties' });
  const go = () => {
    const ctl = view.dom.querySelector('.cm-props-block')?.ctl;
    if (ctl) ctl.add();
  };
  requestAnimationFrame(go);
  return true;
}

// Editor commands by name: app.js binds keys to them (Settings → Hotkeys) and runs them from the palette.
const COMMANDS = {
  bold: { name: 'Bold', run: wrap('**'), key: 'Mod-b' },
  italic: { name: 'Italic', run: wrap('*'), key: 'Mod-i' },
  highlight: { name: 'Highlight', run: wrap('=='), key: 'Mod-Shift-h' },
  strikethrough: { name: 'Strikethrough', run: wrap('~~'), key: '' },
  code: { name: 'Inline code', run: wrap('`'), key: '' },
  wikilink: { name: 'Wrap in [[link]]', run: wrap('[[', ']]'), key: 'Mod-k' },
  comment: { name: 'Hidden comment (%% %%)', run: wrap('%%'), key: '' },
  'toggle-checkbox': { name: 'Toggle checkbox', run: v => toggleCheckbox(v), key: 'Mod-Enter' },
  'inline-math': { name: 'Inline math ($…$)', run: wrap('$'), key: 'Mod-m' },
  'block-math': { name: 'Math block ($$…$$)', run: blockMath, key: 'Mod-Shift-m' },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`heading-${n}`, { name: `Heading ${n}`, run: setHeading(n), key: `Mod-${n}` }])),
  'heading-0': { name: 'Remove heading', run: setHeading(0), key: '' },
  'add-property': { name: 'Add file property', run: addProperty, key: 'Mod-;' },
  'bullet-list': { name: 'Bullet list', run: toggleList('bullet'), key: 'Mod-Shift-8' },
  'numbered-list': { name: 'Numbered list', run: toggleList('numbered'), key: 'Mod-Shift-7' },
  'task-list': { name: 'Task list', run: toggleList('task'), key: 'Mod-Shift-9' },
};
const keyBindings = keys => Object.entries(COMMANDS).flatMap(([id, c]) => {
  const k = keys && id in keys ? keys[id] : c.key;
  return k ? [{ key: k, run: c.run, preventDefault: true }] : [];
});

// ------------------------------------------------------------------ LaTeX completion

// [command, snippet (${} marks where the cursor goes; tab moves on), example rendered in the list]
const LATEX = [
  ...'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega'.split(' ').map(g => [g]),
  ['frac', 'frac{${num}}{${den}}', 'frac{a}{b}'], ['dfrac', 'dfrac{${num}}{${den}}', 'dfrac{a}{b}'], ['tfrac', 'tfrac{${num}}{${den}}', 'tfrac{a}{b}'],
  ['sqrt', 'sqrt{${x}}', 'sqrt{x}'], ['sqrt[n]', 'sqrt[${n}]{${x}}', 'sqrt[3]{x}'], ['binom', 'binom{${n}}{${k}}', 'binom{n}{k}'],
  ['sum', 'sum_{${i=1}}^{${n}} ', 'sum_{i=1}^{n}'], ['prod', 'prod_{${i=1}}^{${n}} ', 'prod_{i=1}^{n}'], ['int', 'int_{${a}}^{${b}} ${f(x)}\\,dx', 'int_a^b f(x)\\,dx'],
  ['iint', 'iint'], ['oint', 'oint'], ['lim', 'lim_{${x \\to \\infty}} ', 'lim_{x \\to \\infty}'], ['infty', 'infty'], ['partial', 'partial'], ['nabla', 'nabla'],
  ['pm', 'pm'], ['mp', 'mp'], ['times', 'times'], ['div', 'div'], ['cdot', 'cdot'], ['circ', 'circ'], ['bullet', 'bullet'], ['star', 'star'],
  ['leq', 'leq'], ['geq', 'geq'], ['neq', 'neq'], ['approx', 'approx'], ['equiv', 'equiv'], ['sim', 'sim'], ['simeq', 'simeq'], ['cong', 'cong'], ['propto', 'propto'], ['ll', 'll'], ['gg', 'gg'],
  ['in', 'in'], ['notin', 'notin'], ['subset', 'subset'], ['subseteq', 'subseteq'], ['supset', 'supset'], ['supseteq', 'supseteq'], ['cup', 'cup'], ['cap', 'cap'], ['setminus', 'setminus'], ['emptyset', 'emptyset'],
  ['forall', 'forall'], ['exists', 'exists'], ['neg', 'neg'], ['land', 'land'], ['lor', 'lor'], ['implies', 'implies'], ['iff', 'iff'],
  ['to', 'to'], ['gets', 'gets'], ['mapsto', 'mapsto'], ['rightarrow', 'rightarrow'], ['leftarrow', 'leftarrow'], ['Rightarrow', 'Rightarrow'], ['Leftarrow', 'Leftarrow'], ['Leftrightarrow', 'Leftrightarrow'], ['uparrow', 'uparrow'], ['downarrow', 'downarrow'],
  ['xrightarrow', 'xrightarrow{${text}}', 'xrightarrow{f}'],
  ['sin'], ['cos'], ['tan'], ['log'], ['ln'], ['exp'], ['max'], ['min'], ['det'], ['arg'], ['gcd'], ['operatorname', 'operatorname{${name}}', 'operatorname{rank}'],
  ['hat', 'hat{${x}}', 'hat{x}'], ['bar', 'bar{${x}}', 'bar{x}'], ['vec', 'vec{${v}}', 'vec{v}'], ['dot', 'dot{${x}}', 'dot{x}'], ['ddot', 'ddot{${x}}', 'ddot{x}'], ['tilde', 'tilde{${x}}', 'tilde{x}'],
  ['overline', 'overline{${x}}', 'overline{AB}'], ['underline', 'underline{${x}}', 'underline{x}'], ['overbrace', 'overbrace{${x}}^{${label}}', 'overbrace{a+b}^{n}'], ['underbrace', 'underbrace{${x}}_{${label}}', 'underbrace{a+b}_{n}'],
  ['mathbb', 'mathbb{${R}}', 'mathbb{R}'], ['mathcal', 'mathcal{${L}}', 'mathcal{L}'], ['mathbf', 'mathbf{${x}}', 'mathbf{x}'], ['mathrm', 'mathrm{${d}}', 'mathrm{d}'], ['mathfrak', 'mathfrak{${g}}', 'mathfrak{g}'], ['text', 'text{${words}}', 'text{if }x'],
  ['left(', 'left( ${} \\right)', 'left( x \\right)'], ['left[', 'left[ ${} \\right]', 'left[ x \\right]'], ['left\\{', 'left\\\\{ ${} \\right\\\\}', 'left\\{ x \\right\\}'], ['left|', 'left| ${} \\right|', 'left| x \\right|'],
  ['langle', 'langle ${} \\rangle', 'langle x \\rangle'], ['lfloor', 'lfloor ${} \\rfloor', 'lfloor x \\rfloor'], ['lceil', 'lceil ${} \\rceil', 'lceil x \\rceil'],
  ['ldots'], ['cdots'], ['vdots'], ['ddots'], ['quad'], ['qquad'], ['boxed', 'boxed{${x}}', 'boxed{x=1}'], ['cancel', 'cancel{${x}}', 'cancel{x}'], ['color', 'color{${red}}{${x}}', 'color{red}{x}'], ['tag', 'tag{${1}}', null],
  ['ce', 'ce{${H2O}}', 'ce{2H2 + O2 -> 2H2O}'], ['pu', 'pu{${9.81 m/s^2}}', 'pu{9.81 m/s^2}'],
  ...['matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Bmatrix'].map(e => [`begin{${e}}`, `begin{${e}}\n\t\${a} & \${b} \\\\\n\t\${c} & \${d}\n\\end{${e}}`, `begin{${e}} a & b \\\\ c & d \\end{${e}}`]),
  ['begin{cases}', 'begin{cases}\n\t${x} & \\text{if } ${cond} \\\\\n\t${y} & \\text{otherwise}\n\\end{cases}', 'begin{cases} x & \\text{if } c \\\\ y & \\text{else} \\end{cases}'],
  ['begin{aligned}', 'begin{aligned}\n\t${a} &= ${b} \\\\\n\t&= ${c}\n\\end{aligned}', 'begin{aligned} a &= b \\\\ &= c \\end{aligned}'],
];

// Is the cursor inside $…$ or $$…$$ (also while the closing $ isn't typed yet)?
function inMath(state, pos) {
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === 'InlineMath' || n.name === 'BlockMath') return true;
  const line = state.doc.lineAt(pos), before = line.text.slice(0, pos - line.from).replace(/\\\$/g, '');
  return (before.match(/\$/g) || []).length % 2 === 1;
}

function latexCompletions(context) {
  if (!inMath(context.state, context.pos)) return null;
  const m = context.matchBefore(/\\[a-zA-Z]*[{(\[|]?/);
  if (!m || (m.text.length < 2 && !context.explicit)) return null;
  const h = hooksOf(context.state);
  return {
    from: m.from,
    validFor: /^\\[a-zA-Z]*$/,
    options: LATEX.map(([cmd, snip, example]) => snippetCompletion('\\' + (snip || cmd), {
      label: '\\' + cmd,
      type: 'function',
      info: example === null || !h.renderMath ? undefined : () => { const el = document.createElement('div'); el.className = 'cm-math-info'; h.renderMath(el, '\\' + (example || cmd), false); return el; },
    })),
  };
}

// ------------------------------------------------------------------ completion

function completions(context) {
  const latex = latexCompletions(context);
  if (latex) return latex;
  let m = context.matchBefore(/!?\[\[[^\[\]\n|]*/);
  if (m) {
    const at = m.text.indexOf('[[') + 2;
    const q = m.text.slice(at);
    const from = m.from + at;
    const opts = hooksOf(context.state).linkOptions(q);
    if (!opts.length) return null;
    return {
      from, filter: false,
      options: opts.map((o, i) => ({
        label: o.label, detail: o.detail, boost: -i,
        apply(view, _c, f, to) {
          const close = view.state.sliceDoc(to, to + 2) === ']]' ? 2 : 0;
          const text = o.insert + ']]';
          view.dispatch({ changes: { from: f, to: to + close, insert: text }, selection: { anchor: f + text.length } });
        },
      })),
    };
  }
  m = context.matchBefore(/(?:^|[\s(,;])#[\p{L}\p{N}_\-\/]+/u);
  if (m) {
    const at = m.text.indexOf('#') + 1;
    const tags = hooksOf(context.state).tagOptions();
    if (!tags.length) return null;
    return { from: m.from + at, options: tags.map(tg => ({ label: tg, type: 'keyword' })), validFor: /^[\p{L}\p{N}_\-\/]*$/u };
  }
  return null;
}

// ------------------------------------------------------------------ public API

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--accent)' },
});

// opts: {keys: {command: key}, extraKeys: [{key, run}], placeholder, vim, live}
function create(parent, hooks, opts = {}) {
  const liveComp = new Compartment();
  const spellComp = new Compartment();
  const keysComp = new Compartment();
  const vimComp = new Compartment();

  let liveOn = opts.live ?? true, keys = opts.keys || {}, vimOn = !!opts.vim;
  const extensions = () => [
    vimComp.of(vimOn ? vim() : []),
    hooksFacet.of(hooks),
    focusField,
    EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    indentUnit.of('\t'),
    EditorState.tabSize.of(4),
    markdown({ base: markdownLanguage, codeLanguages, extensions: [ObsidianMarkdown] }),
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{'] } }]),
    closeBrackets(),
    autocompletion({ override: [completions], icons: false, activateOnTyping: true }),
    search({ top: true }),
    highlightSelectionMatches(),
    syntaxHighlighting(classHighlighter),
    syntaxHighlighting(markStyle),
    placeholder(opts.placeholder ?? 'Start writing…'),
    theme,
    spellComp.of(EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' })),
    liveComp.of(liveOn ? livePreview : []),
    Prec.highest(keymap.of(opts.extraKeys || [])),
    Prec.high(keysComp.of(keymap.of(keyBindings(keys)))),
    Prec.high(keymap.of([
      { key: 'Tab', run: smartTab, shift: indentLess },
      {
        key: 'ArrowUp', run(view) {
          const r = view.state.selection.main;
          // From the first line under the properties, up goes into them.
          const pe = liveOn && r.empty ? propsEnd(view.state) : -1;
          if (pe >= 0 && view.state.doc.lineAt(r.head).number === view.state.doc.lineAt(pe).number + 1) {
            const ctl = view.dom.querySelector('.cm-props-block')?.ctl;
            if (ctl) { ctl.focus('last'); return true; }
          }
          if (!r.empty || !hooks.focusTitle) return false;
          const a = view.coordsAtPos(r.head), b = view.coordsAtPos(0);
          if (a && b && a.top - b.top < 2) { hooks.focusTitle(); return true; }
          return false;
        },
      },
    ])),
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      // Ctrl+G (graph), Alt+←/→ (history), Ctrl+/ (shortcuts) and Ctrl+Shift+\ (right sidebar) belong to the app.
      ...searchKeymap.filter(k => k.key !== 'Mod-g' && k.key !== 'Mod-Shift-g'),
      ...historyKeymap,
      ...defaultKeymap.filter(k => !['Alt-ArrowLeft', 'Alt-ArrowRight', 'Mod-Enter', 'Mod-/', 'Shift-Mod-\\'].includes(k.key)),
    ]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && !u.transactions.some(tr => tr.annotation(silent))) hooks.onChange?.();
      if (u.docChanged || u.selectionSet) hooks.onCursor?.();
    }),
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = [...(e.clipboardData?.files || [])];
        if (!files.length) return false;
        e.preventDefault();
        if (!hooks.onFiles) return false;
        hooks.onFiles(files, true);
        return true;
      },
      drop(e, view) {
        const files = [...(e.dataTransfer?.files || [])];
        if (!files.length || !hooks.onFiles) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos != null) view.dispatch({ selection: { anchor: pos } });
        hooks.onFiles(files, false);
        return true;
      },
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: extensions() }) });
  const clamp = n => Math.max(0, Math.min(n, view.state.doc.length));

  return {
    view,
    get value() { return view.state.doc.toString(); },
    set value(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
    // New document with fresh undo history (opening a note).
    load(text) {
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
      // (selecting 0 lets the cursor step below the properties, if any)
      view.dispatch({ effects: setFocus.of(view.hasFocus), selection: { anchor: 0 }, annotations: [silent.of(true)] });
    },
    // Replace content without marking the note dirty (reload from disk).
    setSilently(text) {
      const { anchor, head } = view.state.selection.main;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [silent.of(true)],
      });
      view.dispatch({ selection: { anchor: clamp(anchor), head: clamp(head) }, annotations: [silent.of(true)] });
    },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    setSelectionRange(a, b = a, scroll = false) {
      view.dispatch({
        selection: { anchor: clamp(a), head: clamp(b) },
        effects: scroll ? EditorView.scrollIntoView(clamp(a), { y: 'center' }) : [],
      });
    },
    insert(a, b, text, selA, selB) {
      view.dispatch({
        changes: { from: clamp(a), to: clamp(b), insert: text },
        selection: selA != null ? { anchor: selA, head: selB ?? selA } : { anchor: clamp(a) + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    focus() { view.focus(); },
    hasFocus() { return view.hasFocus; },
    refresh() { view.dispatch({ effects: refresh.of(null) }); },
    setLive(on) { liveOn = on; view.dispatch({ effects: liveComp.reconfigure(on ? livePreview : []) }); },
    setKeys(k) { keys = k || {}; view.dispatch({ effects: keysComp.reconfigure(keymap.of(keyBindings(keys))) }); },
    // True while Escape has a job inside the editor: closing completions or search, or
    // leaving Vim's insert/visual mode. A host that also uses Escape should wait for false.
    get escapeBusy() {
      const st = vimOn && getCM(view)?.state.vim;
      return completionStatus(view.state) === 'active' || searchPanelOpen(view.state) || (!!st && (st.insertMode || st.visualMode));
    },
    setVim(on) { vimOn = !!on; view.dispatch({ effects: vimComp.reconfigure(vimOn ? vim() : []) }); },
    run(id) { const c = COMMANDS[id]; if (!c) return false; view.focus(); return c.run(view); },
    toggleCheckbox() { return toggleCheckbox(view); },
    openSearch() { view.focus(); openSearchPanel(view); },
    destroy() { view.destroy(); },
  };
}

window.FolioEditor = { create, commands: Object.fromEntries(Object.entries(COMMANDS).map(([id, c]) => [id, { name: c.name, key: c.key }])) };

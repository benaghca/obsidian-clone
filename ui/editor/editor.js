// Cinder editor: CodeMirror 6 + an Obsidian-style live preview layer.
//
// Bundled into ui/vendor/editor.bundle.js with `npm install && npm run build` in ui/editor/.
// app.js talks to it only through CinderEditor.create(parent, hooks).

import { EditorState, EditorSelection, StateField, StateEffect, Compartment, Prec, Annotation, Facet } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, keymap, placeholder, drawSelection, dropCursor, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, insertTab, insertNewline, moveLineUp, moveLineDown } from '@codemirror/commands';
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit, LanguageDescription, LanguageSupport, StreamLanguage, foldable, foldEffect, unfoldEffect, foldedRanges, codeFolding, unfoldAll } from '@codemirror/language';
import { markdown, markdownLanguage, insertNewlineContinueMarkupCommand, deleteMarkupBackward } from '@codemirror/lang-markdown';
import { htmlToMarkdown } from './html-markdown.js';
import { parser as mdParser } from '@lezer/markdown';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion, completionStatus, snippet, hasNextSnippetField, startCompletion } from '@codemirror/autocomplete';
import { vim, getCM, Vim, CodeMirror } from '@replit/codemirror-vim';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { classHighlighter, styleTags, tags as t } from '@lezer/highlight';
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

// As GFM's own task parser: a Task node holding the [?] marker and the item's text.
class StatusTaskParser {
  nextLine() { return false; }
  finish(cx, leaf) {
    cx.addLeafElement(leaf, cx.elt('Task', leaf.start, leaf.start + leaf.content.length,
      [cx.elt('TaskMarker', leaf.start, leaf.start + 3), ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3)]));
    return true;
  }
}

// Obsidian extras on top of GFM: [[wikilinks]], ![[embeds]], ==highlights==, #tags, frontmatter, $math$.
const BLOCK_MATH_START = /^(\s{0,3})\$\$/;
const ObsidianMarkdown = {
  defineNodes: ['WikiLink', 'Embed', 'WikiMark', 'Highlight', 'HighlightMark', 'Tag', { name: 'Frontmatter', block: true }, 'FrontmatterMark',
    'InlineMath', 'InlineMathMark', { name: 'BlockMath', block: true }, 'BlockMathMark', 'FootnoteRef'],
  parseInline: [
    {
      // [^label]: a footnote's reference, or its definition's label at the start of a line.
      name: 'FootnoteRef', before: 'Link',
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
        const m = /^\[\^([^\]\s]+)\]/.exec(cx.slice(pos, cx.end));
        return m ? cx.addElement(cx.elt('FootnoteRef', pos, pos + m[0].length)) : -1;
      },
    },
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
    // Tasks with Obsidian's other statuses ([/] in progress, [-] cancelled…): GFM reads only [ ] and [x].
    name: 'StatusTask', after: 'TaskList',
    leaf: (cx, leaf) => /^\[[^ xX\]\n]\][ \t]/.test(leaf.content) && cx.parentType().name === 'ListItem' ? new StatusTaskParser() : null,
  }, {
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

// Obsidian's %%comments%%: inline, or from a line that opens with %% to the next %% (or the end of
// the note). Shown dimmed while editing and left out of reading view, as in Obsidian.
const COMMENT_OPEN = /^(\s{0,3})%%/;
const opensComment = text => { const m = COMMENT_OPEN.exec(text); return m && !text.includes('%%', m[0].length) ? m : null; };
const ObsidianComments = {
  defineNodes: ['ObsidianComment', { name: 'ObsidianCommentBlock', block: true }, 'ObsidianCommentMark'],
  props: [styleTags({ 'ObsidianComment ObsidianCommentBlock': t.comment })],
  parseInline: [{
    name: 'ObsidianComment', before: 'Emphasis',
    parse(cx, next, pos) {
      if (next !== 37 || cx.char(pos + 1) !== 37) return -1;
      const close = cx.slice(pos + 2, cx.end).indexOf('%%');
      if (close < 0) return -1;
      const end = pos + close + 4;
      return cx.addElement(cx.elt('ObsidianComment', pos, end, [cx.elt('ObsidianCommentMark', pos, pos + 2), cx.elt('ObsidianCommentMark', end - 2, end)]));
    },
  }],
  parseBlock: [{
    name: 'ObsidianCommentBlock', before: 'FencedCode',
    parse(cx, line) {
      const m = opensComment(line.text);
      if (!m) return false;
      const start = cx.lineStart + m[1].length;
      const marks = [cx.elt('ObsidianCommentMark', start, start + 2)];
      let end = cx.lineStart + line.text.length;
      while (cx.nextLine()) {
        end = cx.lineStart + line.text.length;
        const i = line.text.indexOf('%%');
        if (i >= 0) { marks.push(cx.elt('ObsidianCommentMark', cx.lineStart + i, cx.lineStart + i + 2)); cx.nextLine(); break; }
      }
      cx.addElement(cx.elt('ObsidianCommentBlock', start, end, marks));
      return true;
    },
    endLeaf: (cx, line) => !!opensComment(line.text),
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

// Rich text pasted from a web page or a document comes in as Markdown, as in Obsidian. Plain text
// instead with Ctrl/Cmd+Shift+V, into code, or with hooks.pasteHtml() saying no.
let plainPaste = false;
const plainPasteKeys = EditorView.domEventHandlers({
  keydown(e) { plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v'; return false; },
});
function pasteRichText(e, view, hooks) {
  const plain = plainPaste;
  plainPaste = false;
  const html = e.clipboardData?.getData('text/html');
  if (!html || plain || hooks.pasteHtml?.() === false) return false;
  for (let n = syntaxTree(view.state).resolveInner(view.state.selection.main.from, -1); n; n = n.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|BlockMath|InlineMath|Frontmatter)$/.test(n.name)) return false;
  }
  const md = htmlToMarkdown(html);
  if (md == null) return false;
  e.preventDefault();
  view.dispatch(view.state.replaceSelection(md), { userEvent: 'input.paste', scrollIntoView: true });
  return true;
}

// Typing a Markdown mark over a selection wraps it rather than replacing it, as in Obsidian: * twice
// makes it bold, ` code, = twice highlights it. The selection stays on the text.
const WRAP_MARKS = new Set(['*', '_', '~', '=', '`', '$']);
function wrapSelectionInput(view, from, to, text) {
  const { state } = view;
  if (!WRAP_MARKS.has(text) || state.selection.ranges.some(r => r.empty)) return false;
  view.dispatch(state.changeByRange(r => ({
    changes: [{ from: r.from, insert: text }, { from: r.to, insert: text }],
    range: EditorSelection.range(r.anchor + 1, r.head + 1),
  })), { userEvent: 'input.type' });
  return true;
}

// ------------------------------------------------------------------ state: focus & refresh

const setFocus = StateEffect.define();
const refresh = StateEffect.define();
const silent = Annotation.define();

const focusField = StateField.define({
  create: () => false,
  update(v, tr) { for (const e of tr.effects) if (e.is(setFocus)) v = e.value; return v; },
});

// While the mouse button is down, what's shown stays as it was when it was pressed: revealing a
// table's or formula's source as a drag-selection reaches it moved the text under the pointer,
// and the selection jumped (and a click after a long selection landed somewhere else).
const setDrag = StateEffect.define();
const dragField = StateField.define({
  create: () => null,
  update(v, tr) { for (const e of tr.effects) if (e.is(setDrag)) v = e.value; return v; },
});
const dragFreeze = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.end = e => { if (e.type !== 'mousemove' || !(e.buttons & 1)) this.release(); };
  }
  release() {
    this.unlisten();
    if (this.view.state.field(dragField)) this.view.dispatch({ effects: setDrag.of(null) });
  }
  unlisten() { for (const t of ['mouseup', 'mousemove', 'blur']) window.removeEventListener(t, this.end, true); }
  // (Going with the state it belongs to, as when Ctrl+click on a link opens another note, there's
  // nothing to put back, and dispatching then would be in the middle of that update.)
  destroy() { this.unlisten(); }
}, {
  eventHandlers: {
    mousedown(e, view) {
      if (e.button !== 0) return;
      const s = view.state, shown = s.field(focusField) ? s.selection.ranges : [];
      view.dispatch({ effects: setDrag.of(shown) });
      // (Capture, and on the window: the button can come up anywhere, even outside the window.)
      for (const t of ['mouseup', 'mousemove', 'blur']) window.addEventListener(t, this.end, true);
    },
  },
});

// Which parts of the document is the user "inside"? Syntax there stays visible.
function activity(state) {
  const ranges = state.field(dragField, false) || (state.field(focusField) ? state.selection.ranges : []);
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

// A task's checkbox: ticked for any status but a space, as Obsidian draws them, with the status in
// data-task for themes.
class CheckboxWidget extends WidgetType {
  constructor(status) { super(); this.status = status; }
  eq(o) { return o.status === this.status; }
  toDOM() {
    const el = document.createElement('input');
    el.type = 'checkbox'; el.checked = this.status !== ' '; el.className = 'cm-task-cb'; el.tabIndex = -1; el.dataset.task = this.status;
    return el;
  }
  ignoreEvent() { return false; }
}

class InlineQueryWidget extends WidgetType {
  constructor(expr, version, h) { super(); this.expr = expr; this.version = version; this.h = h; }
  eq(o) { return o.expr === this.expr && o.version === this.version; }
  toDOM() { return this.h.inlineQuery(this.expr); }
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

// ![](https://…) of a web page (not an image): the live page, drawn by app.js.
class WebEmbedWidget extends WidgetType {
  constructor(url, alt, h) { super(); this.url = url; this.alt = alt; this.h = h; }
  eq(o) { return o.url === this.url && o.alt === this.alt; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-web-embed';
    el.dataset.url = this.url;
    this.h.renderWebEmbed(el, this.url, this.alt);
    return el;
  }
  // A new size for the same page resizes in place, so the page doesn't reload.
  updateDOM(dom) {
    if (dom.dataset.url !== this.url || !this.h.sizeWebEmbed) return false;
    this.h.sizeWebEmbed(dom, this.alt);
    return true;
  }
  ignoreEvent() { return true; }
}
const WEB_URL = /^https?:\/\/\S+$/i, IMAGE_URL = /\.(png|jpe?g|gif|webp|svg|avif|bmp)([?#]|$)/i;

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

// Where the cursor goes for a cell of a rendered table (the table's Markdown starts at `from`).
function tableCellPos(state, from, tw, cell) {
  const doc = state.doc, first = doc.lineAt(from);
  const rows = [...tw.querySelectorAll('tr')], ri = cell ? rows.indexOf(cell.parentElement) : 0;
  const line = doc.line(Math.min(doc.lines, first.number + (ri <= 0 ? 0 : ri + 1))); // (the |---| line under the header)
  const pipes = [];
  for (let i = 0; i < line.text.length; i++) { if (line.text[i] === '\\') i++; else if (line.text[i] === '|') pipes.push(i); }
  const ci = cell ? [...cell.parentElement.children].indexOf(cell) : 0, lead = /^\s*\|/.test(line.text);
  const start = lead ? pipes[ci] + 1 : ci ? pipes[ci - 1] + 1 : 0;
  const end = (lead ? pipes[ci + 1] : pipes[ci]) ?? line.length;
  if (!(start >= 0) || end < start) return Math.min(from + 2, first.to);
  let at = end;
  while (at > start && /\s/.test(line.text[at - 1])) at--;
  return line.from + Math.max(at, Math.min(start + 1, end));
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
  // A press on the table is the editor's (to put the cursor in the cell clicked); one on a link in
  // it is the link's. (Widgets' events are otherwise left alone, so a click on a table did nothing.)
  ignoreEvent(e) { return !(e.type === 'mousedown' && !e.target.closest?.('a')); }
}

// The note's frontmatter as a table of properties (app.js draws it with CinderProps). Edits come
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
  // [[Note\|alias]], as a table cell has to write it.
  const tgt = bar < 0 ? inner : inner.slice(0, bar > 0 && inner[bar - 1] === '\\' ? bar - 1 : bar);
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
          case 'FootnoteRef': {
            // A reference shows as its label, raised; a definition's label is dimmed.
            if (doc.sliceString(nt, nt + 1) === ':' && doc.lineAt(nf).from === nf) { out.push(markCls('cm-fn-def').range(nf, nt)); return; }
            if (A.touches(nf, nt)) { out.push(markCls('cm-faint').range(nf, nt)); return; }
            out.push(Decoration.replace({ widget: new TextWidget(doc.sliceString(nf + 2, nt - 1), 'cm-fn-ref') }).range(nf, nt));
            return;
          }
          case 'Emphasis': out.push(markCls('cm-em').range(nf, nt)); return;
          case 'StrongEmphasis': out.push(markCls('cm-strong').range(nf, nt)); return;
          case 'Strikethrough': out.push(markCls('cm-strike').range(nf, nt)); return;
          case 'Highlight': out.push(markCls('cm-hl').range(nf, nt)); return;
          case 'InlineCode': {
            // `= expr`: a Dataview inline query, shown as its value (hooks.inlineQuery) until the cursor comes in.
            const q = h.inlineQuery && /^`=\s+(\S[^`]*)`$/.exec(doc.sliceString(nf, nt));
            if (q && !A.touches(nf, nt)) { out.push(Decoration.replace({ widget: new InlineQueryWidget(q[1], h.version(), h) }).range(nf, nt)); return false; }
            out.push(markCls('cm-icode').range(nf, nt)); return;
          }
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
            // A fenced block's ``` lines are hidden (the opening one showing the language) until the
            // cursor comes into the block, as in Obsidian.
            const fence = name === 'FencedCode' && !A.lines(nf, nt) ? fenceOf(state, nf) : null;
            eachLine(nf, nt, l => {
              let cls = 'cm-codeblock';
              if (l.number === first) cls += ' cm-codeblock-first';
              if (l.number === last) cls += ' cm-codeblock-last';
              if (fence && (l.number === first || (fence.closed && l.number === last))) cls += ' cm-codeblock-fence';
              out.push(lineCls(cls).range(l.from));
            });
            if (fence) {
              const open = doc.line(first);
              out.push((fence.lang ? Decoration.replace({ widget: new TextWidget(fence.lang, 'cm-codeblock-lang') }) : hideDeco).range(open.from, open.to));
              if (fence.closed) { const close = doc.line(last); hide(close.from, close.to); }
              return false;
            }
            return;
          }
          case 'CodeInfo': out.push(markCls('cm-codeinfo').range(nf, nt)); return;
          case 'Blockquote': {
            const firstLine = doc.lineAt(nf);
            // A callout's [!type] follows as many > as it is deep (> > [!warning] in a quote).
            let depth = 1;
            for (let p = node.node.parent; p; p = p.parent) if (p.name === 'Blockquote') depth++;
            const cm = new RegExp(`^(\\s*(?:>\\s*){${depth}})\\[!([\\w-]+)\\]([+-]?)[ \\t]*(.*)$`).exec(firstLine.text);
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
            if (marker && /^\[[xX-]\]$/.test(doc.sliceString(marker.from, marker.to))) out.push(markCls('cm-task-done').range(marker.to, nt));
            return;
          }
          case 'TaskMarker': {
            if (A.touches(nf, nt)) return;
            out.push(Decoration.replace({ widget: new CheckboxWidget(doc.sliceString(nf + 1, nf + 2)) }).range(nf, nt));
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
      u.transactions.some(tr => tr.effects.some(e => e.is(setFocus) || e.is(refresh) || e.is(setDrag))))
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
          const rawAlt = /^!\[([^\]]*)\]/.exec(text)?.[1] || '';
          const [alt, width] = altWidth(rawAlt);
          if (url) widget = new ImageWidget(url, alt, width, true);
          else if (src && WEB_URL.test(src) && !IMAGE_URL.test(src) && h.renderWebEmbed) widget = new WebEmbedWidget(src, rawAlt, h);
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
      tr.effects.some(e => e.is(setFocus) || e.is(refresh) || e.is(setDrag))) return buildBlocks(tr.state);
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
    // Clicking a rendered table drops the cursor into it, revealing the Markdown: at the end of the
    // text of the cell clicked.
    const tw = e.target.closest?.('.cm-table-widget');
    if (tw && e.button === 0) {
      e.preventDefault();
      view.focus();
      view.dispatch({ selection: { anchor: tableCellPos(view.state, view.posAtDOM(tw), tw, e.target.closest('td, th')) } });
      return true;
    }
    const el = e.target.closest?.('[data-link],[data-url],[data-tag]');
    if (!el || e.button !== 0) return false;
    if (!el.dataset.live && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    const h = hooksOf(view.state);
    // Ctrl+click: in a new tab; Ctrl+Alt+click: in the other pane.
    const mod = e.ctrlKey || e.metaKey;
    if (el.dataset.link != null) h.follow(el.dataset.link, el.dataset.sub || '', { other: e.altKey && mod, tab: mod && !e.altKey });
    else if (el.dataset.url) h.openUrl(el.dataset.url);
    else if (el.dataset.tag) h.tag(el.dataset.tag);
    return true;
  },
});

// Up/Down onto a block shown rendered (a formula, table, code block or embed) step into its source,
// on its line nearest where you came from, as Obsidian does. CodeMirror's own vertical motion can't
// stop inside a widget, so it would jump the whole block.
const enterBlock = forward => view => {
  const { state } = view, sel = state.selection.main;
  if (state.selection.ranges.length > 1 || !sel.empty) return false;
  const line = state.doc.lineAt(sel.head), moved = view.moveVertically(sel, forward).head;
  if (moved >= line.from && moved <= line.to) return false; // a wrapped line: still moving within it
  const n = line.number + (forward ? 1 : -1);
  if (n < 1 || n > state.doc.lines) return false;
  const next = state.doc.line(n);
  let block = null;
  state.field(blockField).between(next.from, next.from, (from, to, d) => {
    if (d.spec.block && to > from && !(d.spec.widget instanceof PropsWidget)) { block = { from, to }; return false; }
  });
  if (!block) return false;
  const land = state.doc.lineAt(forward ? block.from : block.to);
  view.dispatch({ selection: { anchor: land.from + Math.min(sel.head - line.from, land.length) }, scrollIntoView: true, userEvent: 'select' });
  return true;
};

const livePreview = [livePlugin, blockField, clickHandler, skipProps,
  Prec.high(keymap.of([{ key: 'ArrowUp', run: enterBlock(false) }, { key: 'ArrowDown', run: enterBlock(true) }]))];

// ------------------------------------------------------------------ folding

// Headings fold their section and list items their sub-items, as in Obsidian. An arrow shows in
// the margin beside such a line while the pointer is on it, and stays, turned, while it's folded;
// the hidden part shows as … (a click opens it again). Ctrl+Shift+[ and ] fold and unfold where the
// cursor is, Ctrl+Alt+[ and ] everything.
function foldRangeOf(state, line) {
  if (/^#{1,6}[ \t]/.test(line.text)) {
    const r = foldable(state, line.from, line.to);
    return r && trimFold(state, r);
  }
  const m = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/.exec(line.text);
  if (!m) return null;
  for (let n = syntaxTree(state).resolveInner(line.from + m[0].length - 1, 1); n; n = n.parent) {
    if (n.name !== 'ListItem') continue;
    if (state.doc.lineAt(n.from).number !== line.number) return null;
    return n.to > line.to ? trimFold(state, { from: line.to, to: n.to }) : null;
  }
  return null;
}
// (Blank lines at the end of a section stay visible.)
function trimFold(state, r) {
  let to = r.to;
  while (to > r.from && /\s/.test(state.sliceDoc(to - 1, to))) to--;
  return to > r.from ? { from: r.from, to } : null;
}
function foldedAt(state, line) {
  let found = null;
  foldedRanges(state).between(line.to, line.to, (from, to) => { if (from === line.to) found = { from, to }; });
  return found;
}
function toggleFoldLine(view, line) {
  const open = foldedAt(view.state, line);
  if (open) { view.dispatch({ effects: unfoldEffect.of(open) }); return true; }
  const r = foldRangeOf(view.state, line);
  if (!r) return false;
  view.dispatch({ effects: foldEffect.of(r) });
  return true;
}
// The heading or list item the cursor is on, or else the section it's in.
function foldTarget(state) {
  const head = state.selection.main.head, here = state.doc.lineAt(head);
  if (foldRangeOf(state, here)) return here;
  for (let n = here.number - 1; n >= 1; n--) {
    const l = state.doc.line(n), r = /^#{1,6}[ \t]/.test(l.text) && foldRangeOf(state, l);
    if (r && r.to >= head) return l;
  }
  return null;
}
const foldHere = view => { const l = foldTarget(view.state); return !!l && !foldedAt(view.state, l) && toggleFoldLine(view, l); };
const unfoldHere = view => {
  const head = view.state.selection.main.head, line = view.state.doc.lineAt(head), effects = [];
  foldedRanges(view.state).between(line.from, line.to, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
  if (!effects.length) { const l = foldTarget(view.state), open = l && foldedAt(view.state, l); if (open) effects.push(unfoldEffect.of(open)); }
  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
};
const foldEverything = view => {
  const effects = [], { doc } = view.state;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n), r = !foldedAt(view.state, line) && foldRangeOf(view.state, line);
    if (r) effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
  return true;
};
class FoldArrow extends WidgetType {
  constructor(folded) { super(); this.folded = folded; }
  eq(o) { return o.folded === this.folded; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-fold-arrow' + (this.folded ? ' folded' : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
    return s;
  }
  ignoreEvent() { return false; }
}
const FOLDABLE_LINE = /^(?:#{1,6}[ \t]|[ \t]*(?:[-*+]|\d+[.)])[ \t])/;
const foldArrows = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || foldedRanges(u.startState) !== foldedRanges(u.state)) this.decorations = this.build(u.view);
  }
  build(view) {
    const out = [], { state } = view;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = state.doc.lineAt(pos);
        if (FOLDABLE_LINE.test(line.text) && foldRangeOf(state, line)) out.push(Decoration.widget({ widget: new FoldArrow(!!foldedAt(state, line)), side: -1 }).range(line.from));
        pos = line.to + 1;
      }
    }
    return Decoration.set(out);
  }
}, {
  decorations: v => v.decorations,
  eventHandlers: {
    mousedown(e, view) {
      const a = e.target.closest?.('.cm-fold-arrow');
      if (!a) return false;
      e.preventDefault();
      toggleFoldLine(view, view.state.doc.lineAt(view.posAtDOM(a)));
      return true;
    },
  },
});
const folding = [codeFolding({ placeholderText: '…' }), foldArrows];

// ------------------------------------------------------------------ commands

// The find bar's words, in the app's sentence case.
const SEARCH_PHRASES = { 'next': 'Next', 'previous': 'Previous', 'all': 'All', 'match case': 'Match case', 'regexp': 'Regex', 'by word': 'Whole word', 'replace': 'Replace', 'replace all': 'Replace all', 'close': 'Close' };

// Bold, italic and the like toggle: off when the selection is already wrapped (just outside it, or
// at its own ends), on otherwise. Runs of * and _ are counted, so Ctrl+I on **bold** makes
// ***bold italic*** rather than taking a * off each side, and Ctrl+B on that gives back *italic*.
const wrap = (before, after = before) => view => {
  const ch = before[0], n = before.length;
  if (after === before && before === ch.repeat(n)) return wrapRun(view, ch, n);
  view.dispatch(view.state.changeByRange(r => {
    const s = view.state.sliceDoc(r.from - before.length, r.from), e = view.state.sliceDoc(r.to, r.to + after.length);
    if (s === before && e === after) {
      return { changes: [{ from: r.from - before.length, to: r.from }, { from: r.to, to: r.to + after.length }], range: EditorSelection.range(r.from - before.length, r.to - before.length) };
    }
    return { changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }], range: EditorSelection.range(r.from + before.length, r.to + before.length) };
  }));
  return true;
};
function wrapRun(view, ch, n) {
  const st = view.state, mark = ch.repeat(n);
  const lead = s => { let i = 0; while (s[i] === ch) i++; return i; };
  const back = s => lead([...s].reverse().join(''));
  // How many of `ch` in a row mean this one is on: * alone is italic, ** bold, *** both.
  const on = k => n === 1 && (ch === '*' || ch === '_') ? k === 1 || k >= 3 : k >= n;
  view.dispatch(st.changeByRange(r => {
    const out = Math.min(back(st.sliceDoc(Math.max(0, r.from - 8), r.from)), lead(st.sliceDoc(r.to, r.to + 8)));
    if (on(out)) return { changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }], range: EditorSelection.range(r.from - n, r.to - n) };
    const inner = st.sliceDoc(r.from, r.to), inn = Math.min(lead(inner), back(inner));
    if (!out && inner.length > 2 * n && 2 * inn < inner.length && on(inn)) return { changes: [{ from: r.from, to: r.from + n }, { from: r.to - n, to: r.to }], range: EditorSelection.range(r.from, r.to - 2 * n) };
    return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }], range: EditorSelection.range(r.from + n, r.to + n) };
  }));
  return true;
}

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

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
// Enter on an empty line of a quote or callout ends it, a level at a time, as in Obsidian.
// (CodeMirror's own waits for a second empty quoted line, so it took three Enters to get out.) A
// blank line is left after it: text right below a quote's last line would still be in the quote.
function endQuote(view) {
  const { state } = view, r = state.selection.main;
  if (state.selection.ranges.length > 1 || !r.empty) return false;
  const line = state.doc.lineAt(r.head), m = /^((?:[ \t]*>)+)[ \t]*$/.exec(line.text);
  if (!m || r.head !== line.to || line.number === 1 || !/^[ \t]*>/.test(state.doc.line(line.number - 1).text)) return false;
  for (let n = syntaxTree(state).resolveInner(r.head, -1); n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return false;
  const keep = m[1].replace(/[ \t]*>$/, '');
  const insert = keep + '\n' + (keep ? keep + ' ' : '');
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, userEvent: 'delete' });
  return true;
}

// ------------------------------------------------------------------ fenced code blocks

// The fenced code block whose opening line is at or around `pos`: {from, to (its node), open and
// close (line numbers), mark (``` or ~~~…), lang, closed}, or null outside one.
function fenceOf(state, pos) {
  let n = syntaxTree(state).resolveInner(pos, 1);
  while (n && n.name !== 'FencedCode') n = n.parent;
  if (!n) { n = syntaxTree(state).resolveInner(pos, -1); while (n && n.name !== 'FencedCode') n = n.parent; }
  if (!n) return null;
  const doc = state.doc, open = doc.lineAt(n.from), close = doc.lineAt(n.to);
  const m = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/.exec(open.text);
  if (!m) return null;
  const ct = close.text.trim();
  const closed = close.number > open.number && ct.length >= m[2].length && ct === m[2][0].repeat(ct.length);
  return { from: n.from, to: n.to, open: open.number, close: close.number, indent: m[1], mark: m[2], lang: m[3], closed };
}

// Enter at the end of an opening fence that has no closing one: the closing fence goes in too, and
// the cursor between them (otherwise everything after it would be code).
function fenceEnter(view) {
  const { state } = view, r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  if (r.head !== line.to || !/^\s*(`{3,}|~{3,})[^`]*$/.test(line.text)) return false;
  const f = fenceOf(state, line.from);
  if (!f || f.open !== line.number || f.closed) return false;
  const insert = `\n${f.indent}\n${f.indent}${f.mark}`;
  view.dispatch({ changes: { from: r.head, insert }, selection: { anchor: r.head + 1 + f.indent.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

// ↓ on a code block's last line when nothing comes after it: a line after the block (closing it
// first if it has no closing fence), so there's always a way out.
function fenceExit(view) {
  const { state } = view, r = state.selection.main, doc = state.doc;
  if (!r.empty || doc.lineAt(r.head).number !== doc.lines) return false;
  const f = fenceOf(state, r.head);
  if (!f || f.close !== doc.lines) return false;
  const insert = f.closed ? '\n' : `\n${f.indent}${f.mark}\n`;
  view.dispatch({ changes: { from: doc.length, insert }, selection: { anchor: doc.length + insert.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

// ------------------------------------------------------------------ tables, as Advanced Tables does

// A table row's cells: split at | (not \| nor one in `code`), without the edge pipes, trimmed.
function tableCells(text) {
  const cells = [];
  let cur = '', code = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { cur += c + (text[i + 1] ?? ''); i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  if (cells.length > 1 && /^\s*\|/.test(text)) cells.shift();
  if (cells.length > 1 && /\|\s*$/.test(text) && !cells[cells.length - 1].trim()) cells.pop();
  return cells.map(x => x.trim());
}
// Which cell of row `text` column `col` is in.
function cellAt(text, col) {
  let n = /^\s*\|/.test(text) ? -1 : 0, code = false;
  for (let i = 0; i < col && i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '`') code = !code;
    if (text[i] === '|' && !code) n++;
  }
  return Math.max(0, n);
}
// How wide text shows: East Asian wide characters and emoji take two columns.
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u;
const textWidth = s => [...s].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0);

// The rows of a table laid out in columns: [lines, starts], where starts[r][c] is where cell c of
// row r's text begins in its line. Row 1 is the |---| row, which keeps its alignment colons.
function layoutTable(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  const align = Array.from({ length: cols }, (_, c) => { const d = rows[1]?.[c] || ''; return d.startsWith(':') && d.endsWith(':') && d.length > 1 ? 'c' : d.endsWith(':') ? 'r' : d.startsWith(':') ? 'l' : ''; });
  const width = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.filter((_, r) => r !== 1).map(r => textWidth(r[c] || ''))));
  const pad = (t, c) => {
    const room = width[c] - textWidth(t);
    if (align[c] === 'r') return ' '.repeat(room) + t;
    if (align[c] === 'c') return ' '.repeat(room >> 1) + t + ' '.repeat(room - (room >> 1));
    return t + ' '.repeat(room);
  };
  const starts = [], lines = rows.map((r, ri) => {
    const cells = Array.from({ length: cols }, (_, c) => ri === 1
      ? (align[c] === 'l' || align[c] === 'c' ? ':' : '-') + '-'.repeat(width[c] - 2) + (align[c] === 'r' || align[c] === 'c' ? ':' : '-')
      : pad(r[c] || '', c));
    const st = [];
    let at = 2;
    for (const cell of cells) { st.push(at + (ri === 1 || !cell.trim() ? 0 : cell.length - cell.trimStart().length)); at += cell.length + 3; }
    starts.push(st);
    return '| ' + cells.join(' | ') + ' |';
  });
  return [lines, starts];
}

// Tab / Shift+Tab in a table: tidy its columns and go to the next / previous cell (Tab past the
// last cell starts a new row). Enter: the same column in the next row. Elsewhere, false.
function tableMove(view, how) {
  const { state } = view, sel = state.selection.main;
  if (state.selection.ranges.length > 1) return false;
  let node = syntaxTree(state).resolveInner(sel.head, -1);
  while (node && node.name !== 'Table') node = node.parent;
  if (!node) return false;
  const doc = state.doc, first = doc.lineAt(node.from), last = doc.lineAt(node.to), line = doc.lineAt(sel.head);
  if (doc.lineAt(sel.anchor).number !== line.number) return false;
  const rows = [];
  for (let n = first.number; n <= last.number; n++) rows.push(tableCells(doc.line(n).text));
  const cols = Math.max(...rows.map(r => r.length));
  let r = line.number - first.number, c = Math.min(cellAt(line.text, sel.head - line.from), cols - 1);
  if (how === 'next') { c++; if (c >= cols) { c = 0; r++; } }
  else if (how === 'prev') { c--; if (c < 0) { c = cols - 1; r--; } }
  else r++;
  if (r === 1) r = how === 'prev' ? 0 : 2; // never into the |---| row
  if (r < 0) { r = 0; c = 0; }
  if (r >= rows.length) rows.push([]);
  const [lines, starts] = layoutTable(rows);
  let pos = first.from;
  for (let k = 0; k < r; k++) pos += lines[k].length + 1;
  const cell = rows[r][c] || '';
  const at = pos + starts[r][c];
  view.dispatch({ changes: { from: first.from, to: last.to, insert: lines.join('\n') }, selection: how === 'down' ? { anchor: at } : { anchor: at, head: at + cell.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

// ------------------------------------------------------------------ moving list items, as Outliner does

const indentOf = text => /^\s*/.exec(text)[0].replace(/\t/g, '    ').length;
// The lines of the list item on line n: it and the lines under it that are indented further.
function itemLines(doc, n) {
  const base = indentOf(doc.line(n).text);
  let end = n;
  while (end < doc.lines) { const t = doc.line(end + 1).text; if (!t.trim() || indentOf(t) <= base) break; end++; }
  return [n, end];
}
const LIST_TEXT = /^\s*(?:[-*+]|\d+[.)])\s/;
// Ctrl+Shift+↑/↓: move the list item under the cursor, children and all, past its neighbour at the
// same level. Off a list, the line moves, as with Alt+↑/↓.
function moveItem(view, dir) {
  const { state } = view, doc = state.doc, sel = state.selection.main, line = doc.lineAt(sel.head);
  if (!LIST_TEXT.test(line.text)) return (dir < 0 ? moveLineUp : moveLineDown)(view);
  const base = indentOf(line.text), [a, b] = itemLines(doc, line.number);
  let other;
  if (dir < 0) {
    let p = a - 1;
    while (p >= 1 && doc.line(p).text.trim() && indentOf(doc.line(p).text) > base) p--;
    if (p < 1 || !LIST_TEXT.test(doc.line(p).text) || indentOf(doc.line(p).text) !== base) return true;
    other = itemLines(doc, p);
  } else {
    const n = b + 1;
    if (n > doc.lines || !LIST_TEXT.test(doc.line(n).text) || indentOf(doc.line(n).text) !== base) return true;
    other = itemLines(doc, n);
  }
  const text = (x, y) => doc.sliceString(doc.line(x).from, doc.line(y).to);
  const mine = text(a, b), theirs = text(other[0], other[1]), off = sel.head - doc.line(a).from;
  const from = doc.line(Math.min(a, other[0])).from, to = doc.line(Math.max(b, other[1])).to;
  const insert = dir < 0 ? mine + '\n' + theirs : theirs + '\n' + mine;
  const head = dir < 0 ? from + off : from + theirs.length + 1 + off;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: head }, scrollIntoView: true, userEvent: 'move.line' });
  return true;
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
  fold: { name: 'Fold heading or list item', run: foldHere, key: 'Mod-Shift-[' },
  unfold: { name: 'Unfold', run: unfoldHere, key: 'Mod-Shift-]' },
  'fold-all': { name: 'Fold all headings and lists', run: foldEverything, key: 'Mod-Alt-[' },
  'unfold-all': { name: 'Unfold all', run: unfoldAll, key: 'Mod-Alt-]' },
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

// A field that holds nothing but math (the drawing's equation editor).
const allMath = Facet.define({ combine: v => v.some(Boolean) });

// Is the cursor inside $…$ or $$…$$ (also while the closing $ isn't typed yet)?
function inMath(state, pos) {
  if (state.facet(allMath)) return true;
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === 'InlineMath' || n.name === 'BlockMath') return true;
  const line = state.doc.lineAt(pos), before = line.text.slice(0, pos - line.from).replace(/\\\$/g, '');
  return (before.match(/\$/g) || []).length % 2 === 1;
}

// ------------------------------------------------------------------ math snippets (LaTeX Suite style)

// Typed inside $…$ or $$…$$, these expand at once. [trigger, template (${} = a Tab stop), word]:
// word triggers only fire at the start of a word, so "\\sum" stays as typed; the others (xsr → x^{2})
// work straight after a name.
const MATH_AUTO = [
  ['//', '\\frac{${}}{${}}${}'], ['sq', '\\sqrt{${}}${}', 1], ['td', '^{${}}${}'], ['__', '_{${}}${}'],
  ['sr', '^{2}'], ['cb', '^{3}'], ['invs', '^{-1}'], ['ooo', '\\infty', 1], ['...', '\\dots'],
  ['<=', '\\le '], ['>=', '\\ge '], ['!=', '\\neq '], ['->', '\\to '], ['<->', '\\leftrightarrow '], ['=>', '\\implies '], ['=<', '\\impliedby '],
  ['~~', '\\approx '], ['xx', '\\times ', 1], ['**', '\\cdot '], ['+-', '\\pm '], ['-+', '\\mp '],
  ['inn', '\\in ', 1], ['notin', '\\notin ', 1], ['sub=', '\\subseteq '], ['AA', '\\forall ', 1], ['EE', '\\exists ', 1],
  ['RR', '\\mathbb{R}', 1], ['NN', '\\mathbb{N}', 1], ['ZZ', '\\mathbb{Z}', 1], ['QQ', '\\mathbb{Q}', 1], ['CC', '\\mathbb{C}', 1],
  ['hat', '\\hat{${}}${}', 1], ['bar', '\\overline{${}}${}', 1], ['vec', '\\vec{${}}${}', 1], ['dot', '\\dot{${}}${}', 1], ['tilde', '\\tilde{${}}${}', 1],
  ['bf', '\\mathbf{${}}${}', 1], ['cal', '\\mathcal{${}}${}', 1], ['text', '\\text{${}}${}', 1],
  ['sum', '\\sum_{${i=1}}^{${n}} ${}', 1], ['prod', '\\prod_{${i=1}}^{${n}} ${}', 1], ['lim', '\\lim_{${n} \\to ${\\infty}} ${}', 1],
  ['dint', '\\int_{${a}}^{${b}} ${} \\, d${x}', 1], ['par', '\\frac{\\partial ${y}}{\\partial ${x}} ${}', 1],
  ['lr(', '\\left( ${} \\right)${}', 1], ['lr[', '\\left[ ${} \\right]${}', 1], ['lr|', '\\left| ${} \\right|${}', 1],
  ['pmat', '\\begin{pmatrix} ${} \\end{pmatrix}${}', 1], ['case', '\\begin{cases} ${} \\end{cases}${}', 1],
  ...[['a', 'alpha'], ['b', 'beta'], ['g', 'gamma'], ['G', 'Gamma'], ['d', 'delta'], ['D', 'Delta'], ['e', 'epsilon'], ['z', 'zeta'], ['h', 'eta'],
    ['t', 'theta'], ['T', 'Theta'], ['i', 'iota'], ['k', 'kappa'], ['l', 'lambda'], ['L', 'Lambda'], ['m', 'mu'], ['n', 'nu'], ['x', 'xi'],
    ['p', 'pi'], ['P', 'Pi'], ['r', 'rho'], ['s', 'sigma'], ['S', 'Sigma'], ['u', 'upsilon'], ['f', 'phi'], ['F', 'Phi'], ['c', 'chi'],
    ['y', 'psi'], ['Y', 'Psi'], ['o', 'omega'], ['O', 'Omega']].map(([k, g]) => ['@' + k, '\\' + g]),
  [':e', '\\varepsilon'], [':f', '\\varphi'], [':t', '\\vartheta'],
].sort((a, b) => b[0].length - a[0].length);
// Outside math, a word followed by Tab: mk → $…$, dm → a $$ block.
const MATH_TAB = [['mk', '$${}$${}'], ['dm', '$$\n${}\n$$${}']];

let lastSpaced = -1; // where the last space-ended expansion left the cursor
let lastExpanded = -1; // where the last expansion ended (no suggestion list for what it just wrote)
function mathSnippetInput(view, from, to, text) {
  if (from !== to || text.length !== 1 || !hooksOf(view.state).mathSnippets?.()) return false;
  const st = view.state;
  if (!inMath(st, from)) return false;
  // "\\le " already ends in a space: a space typed straight after it isn't doubled.
  if (text === ' ' && from === lastSpaced) { lastSpaced = -1; return true; }
  const line = st.doc.lineAt(from);
  const typed = st.sliceDoc(Math.max(line.from, from - 10), from) + text;
  for (const [trig, tpl, word] of MATH_AUTO) {
    if (!typed.endsWith(trig)) continue;
    const start = from + 1 - trig.length;
    if (start < line.from) continue;
    if (word && /[\\a-zA-Z]/.test(st.sliceDoc(start - 1, start))) continue;
    snippet(tpl)(view, null, start, from);
    lastSpaced = tpl.endsWith(' ') ? view.state.selection.main.head : -1;
    lastExpanded = view.state.selection.main.head;
    return true;
  }
  // x1 → x_1 (a single-letter name followed by a digit)
  if (/\d/.test(text) && /(^|[^\\a-zA-Z])[a-zA-Z]$/.test(st.sliceDoc(Math.max(line.from, from - 2), from))) {
    view.dispatch({ changes: { from, insert: '_' + text }, selection: { anchor: from + 2 }, userEvent: 'input.type' });
    return true;
  }
  return false;
}

// Tab: expand mk / dm, or inside math step over a closing bracket or $.
function mathTab(view) {
  const st = view.state, r = st.selection.main;
  if (!r.empty || !hooksOf(st).mathSnippets?.() || hasNextSnippetField(st)) return false;
  const line = st.doc.lineAt(r.head), before = line.text.slice(0, r.head - line.from);
  if (!inMath(st, r.head)) {
    for (const [trig, tpl] of MATH_TAB) {
      if (new RegExp(`(^|[\\s(\\[])${trig}$`).test(before)) { snippet(tpl)(view, null, r.head - trig.length, r.head); return true; }
    }
    return false;
  }
  const next = st.sliceDoc(r.head, r.head + 2);
  const m = /^(\$\$|[})\]$|])/.exec(next);
  if (m) { view.dispatch({ selection: { anchor: r.head + m[1].length } }); return true; }
  return false;
}

function latexCompletions(context) {
  if (!inMath(context.state, context.pos)) return null;
  if (context.pos === lastExpanded && !context.explicit) return null;
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

// Templater: typing "<%" lists the commands in plain words (hooks.templaterOptions('open')), and
// "tp." inside a <% … %> tag lists what comes next (hooks.templaterOptions('member', 'tp.date')).
// Each option is {label, detail, info, snippet}; a snippet's ${fields} are Tab stops.
function templaterCompletions(context) {
  const h = hooksOf(context.state);
  if (!h.templaterOptions) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const open = before.lastIndexOf('<%');
  if (open < 0 || before.lastIndexOf('%>') > open) return null;
  const inTag = before.slice(open);
  const infoOf = o => o.info ? () => { const d = document.createElement('div'); d.className = 'cm-tp-info'; d.innerHTML = o.info; return d; } : undefined;
  // Just after "<%" (plus any words typed to narrow the list): whole commands.
  let m = /^<%([-_*]?)(\s*)([A-Za-z' ]*)$/.exec(inTag);
  if (m && !/\btp\b/.test(m[3])) {
    const opts = h.templaterOptions('open');
    if (!opts.length) return null;
    const tagFrom = line.from + open, from = tagFrom + 2 + m[1].length + m[2].length;
    const after = context.state.sliceDoc(context.pos, Math.min(line.to, context.pos + 3));
    const closeLen = /^\s?%>/.test(after) ? after.indexOf('%>') + 2 : 0;
    return {
      from, filter: true,
      options: opts.map((o, i) => ({
        label: o.label, detail: o.detail, info: infoOf(o), boost: -i, section: o.section,
        apply: (view, c, _f, to) => snippet(o.snippet)(view, c, tagFrom, to + closeLen),
      })),
      validFor: /^[A-Za-z' ]*$/,
    };
  }
  // tp.something.  → its members.
  m = /\btp((?:\.\w+)*)\.(\w*)$/.exec(inTag);
  if (m) {
    const opts = h.templaterOptions('member', 'tp' + m[1]);
    if (!opts.length) return null;
    return {
      from: context.pos - m[2].length,
      options: opts.map((o, i) => ({ label: o.label, detail: o.detail, info: infoOf(o), boost: -i, type: o.snippet.includes('(') ? 'function' : 'property', apply: snippet(o.snippet) })),
      validFor: /^\w*$/,
    };
  }
  return null;
}

// Task lines: dates, repeats and priorities as you type (hooks.taskSuggest(line, pos), null when off).
function taskCompletions(context) {
  const h = hooksOf(context.state);
  if (!h.taskSuggest || /Code|Comment/.test(syntaxTree(context.state).resolveInner(context.pos, -1).name)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const r = h.taskSuggest(line.text, context.pos - line.from);
  if (!r) return null;
  return {
    from: line.from + r.from, filter: false,
    options: r.options.map((o, i) => ({
      label: o.label, detail: o.detail, boost: -i,
      apply(view, _c, f, to) {
        view.dispatch({ changes: { from: f, to, insert: o.insert }, selection: { anchor: f + o.insert.length } });
        if (o.reopen) setTimeout(() => startCompletion(view));
      },
    })),
  };
}

function completions(context) {
  const latex = latexCompletions(context);
  if (latex) return latex;
  const tp = templaterCompletions(context);
  if (tp) return tp;
  const task = taskCompletions(context);
  if (task) return task;
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

// ------------------------------------------------------------------ focus mode and typewriter scrolling

// Focus mode: the lines of one paragraph (or list item, or block) get .cm-focus-para, so CSS can
// dim the rest. It's the cursor's paragraph, except while scrolling: then the one in the middle of
// the window, so the light follows what's being read. Typing or moving the cursor brings it back.
const focusAt = StateEffect.define();
const focusPara = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.at = null; // the scrolled-to position, while the light follows the scrolling
    this.quietUntil = 0; // scrolls just after an edit or a cursor move are the editor keeping the cursor in view
    this.frame = 0;
    this.deco = this.build();
    this.onScroll = () => {
      if (performance.now() < this.quietUntil || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const box = this.scroller.getBoundingClientRect(), content = this.view.contentDOM.getBoundingClientRect();
        const pos = this.view.posAtCoords({ x: content.left + 4, y: (Math.max(box.top, 0) + Math.min(box.bottom, innerHeight)) / 2 }, false);
        this.view.dispatch({ effects: focusAt.of(pos) });
      });
    };
    // What scrolls: the editor itself, or the page it sits in.
    this.scroller = view.scrollDOM;
    for (let el = view.dom.parentElement; el; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) { this.scroller = el; break; }
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
  }
  update(u) {
    const moved = u.docChanged || u.selectionSet;
    if (moved) { this.at = null; this.quietUntil = performance.now() + 250; }
    for (const tr of u.transactions) for (const e of tr.effects) if (e.is(focusAt)) this.at = e.value;
    if (moved || u.viewportChanged || u.transactions.some(tr => tr.effects.some(e => e.is(focusAt)))) this.deco = this.build();
  }
  build() {
    const doc = this.view.state.doc, head = this.at ?? this.view.state.selection.main.head;
    const report = hooksOf(this.view.state).onFocusPos;
    if (report) queueMicrotask(() => report(head)); // the host's outline follows the light
    let a = doc.lineAt(Math.min(head, doc.length)).number, b = a;
    const blank = n => !doc.line(n).text.trim();
    if (!blank(a)) {
      while (a > 1 && !blank(a - 1)) a--;
      while (b < doc.lines && !blank(b + 1)) b++;
    }
    const out = [];
    for (let n = a; n <= b; n++) out.push(Decoration.line({ class: 'cm-focus-para' }).range(doc.line(n).from));
    return Decoration.set(out);
  }
  destroy() { this.scroller.removeEventListener('scroll', this.onScroll); cancelAnimationFrame(this.frame); }
}, { decorations: v => v.deco });

// Typewriter scrolling: the line being typed on stays in the middle of the window.
const typewriter = EditorState.transactionExtender.of(tr =>
  tr.selection && (tr.docChanged || (tr.isUserEvent('select') && !tr.isUserEvent('select.pointer'))) ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) } : null);

// ------------------------------------------------------------------ public API

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--accent)' },
});

// ------------------------------------------------------------------ Vim

// With Vim on, the Ctrl keys Vim uses belong to Vim in the editor, in every mode. Vim sees keys
// first; one it lets through (Ctrl+N in insert mode, say) stops here, before Cinder's formatting
// keys, CodeMirror's own (Ctrl+A selects all) and the app's shortcuts (Ctrl+N made a new note and
// left this one). Ctrl+C, Ctrl+V and Ctrl+X still copy, paste and cut.
const VIM_KEYS = [...'abdefghijklmnoprtuwy', '[', ']'].map(k => 'Ctrl-' + k);

// j and k (and ↓ ↑) go a row on screen, through a wrapped paragraph rather than over it (Vim's
// gj/gk); with a count (5j) or after an operator (dj) they count whole lines, as Vim's own do.
// (Vim's j/k aren't reachable from here, so both are rebuilt from vim.js's moveByLines and
// moveByDisplayLines; VERTICAL is their "keep the column from the last up/down" check, by name.)
const VERTICAL = ['moveByLines', 'moveByDisplayLines', 'moveByScroll', 'moveToColumn', 'moveToEol', 'rowOrLine'];
function rowOrLine(cm, head, args, vim, inputState) {
  const keep = VERTICAL.includes(vim.lastMotion?.name), n = Math.round(args.repeat), dir = args.forward ? 1 : -1;
  if (inputState.getRepeat() > 0 || inputState.operator) {
    const ch = keep ? vim.lastHPos : (vim.lastHPos = head.ch);
    const line = Math.min(Math.max(head.line + dir * n, cm.firstLine()), cm.lastLine());
    vim.lastHSPos = cm.charCoords(new CodeMirror.Pos(line, ch), 'div').left;
    return new CodeMirror.Pos(line, ch);
  }
  if (!keep) vim.lastHSPos = cm.charCoords(head, 'div').left;
  let cur = head;
  for (let i = 0; i < n; i++) {
    const r = cm.findPosV(cur, dir, 'line', vim.lastHSPos);
    if (r.hitSide) break;
    cur = r;
  }
  if (cur !== head) vim.lastHPos = cur.ch;
  return cur;
}

// The system clipboard is Vim's unnamed register (Vim's `set clipboard=unnamedplus`, which
// `set clipboard=` in the vimrc turns off): yanks and deletes go to it, and what was copied
// elsewhere is what p pastes, once the app hands it over (vimClipboard, when the window regains
// focus).
let vimSetUp = false;
function setUpVim() {
  if (vimSetUp) return;
  vimSetUp = true;
  Vim.defineMotion('rowOrLine', rowOrLine);
  Vim.mapCommand('j', 'motion', 'rowOrLine', { forward: true, linewise: true });
  Vim.mapCommand('k', 'motion', 'rowOrLine', { forward: false, linewise: true });
  // (Vim's ↓ ↑ type its own j and k, not these.)
  Vim.mapCommand('<Down>', 'motion', 'rowOrLine', { forward: true, linewise: true });
  Vim.mapCommand('<Up>', 'motion', 'rowOrLine', { forward: false, linewise: true });
  Vim.defineOption('clipboard', 'unnamedplus', 'string');
  const rc = Vim.getRegisterController(), push = rc.pushText.bind(rc);
  rc.pushText = (name, ...rest) => {
    push(name, ...rest);
    if ((!name || name === '"') && /unnamed/.test(Vim.getOption('clipboard'))) navigator.clipboard?.writeText(rc.unnamedRegister.toString()).catch(() => { });
  };
}
// Text copied outside Vim becomes what p pastes (a line or more when it ends in a newline).
function vimClipboard(text) {
  if (!vimSetUp || !text || !/unnamed/.test(Vim.getOption('clipboard'))) return;
  const reg = Vim.getRegisterController().unnamedRegister;
  if (reg.toString() !== text) reg.setText(text, text.endsWith('\n'));
}
// Lines of a vimrc (Obsidian's .obsidian.vimrc): mappings and options only, so a vimrc can't edit
// the note it's applied in. Returns the lines it couldn't use.
const VIMRC_CMDS = /^([nvio]?(nore)?map|[nvio]?unmap|set|se)$/;
function applyVimrc(view, text) {
  const cm = getCM(view), bad = [];
  if (!cm) return bad;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('"')) continue;
    if (!VIMRC_CMDS.test(line.split(/\s/)[0])) { bad.push(line); continue; }
    try { Vim.handleEx(cm, line); } catch { bad.push(line); }
  }
  return bad;
}

// Vim's mode and the keys of a command being typed (d2…), for the host's status bar.
const vimStatus = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.cm = getCM(view);
    this.send = () => { const st = this.cm?.state.vim; if (st) hooksOf(view.state).onVimStatus?.({ mode: st.mode || 'normal', pending: st.status || '' }); };
    // (Vim updates its own status after these events, so this reads it a moment later.)
    this.later = () => setTimeout(this.send, 0);
    for (const ev of ['vim-mode-change', 'vim-keypress', 'vim-command-done']) this.cm?.on(ev, this.later);
    this.later();
  }
  destroy() {
    for (const ev of ['vim-mode-change', 'vim-keypress', 'vim-command-done']) this.cm?.off(ev, this.later);
    hooksOf(this.view.state).onVimStatus?.(null);
  }
});

const vimMode = () => { setUpVim(); return [vim(), vimStatus, Prec.high(keymap.of(VIM_KEYS.map(key => ({ key, run: () => true }))))]; };

// opts: {keys: {command: key}, extraKeys: [{key, run}], placeholder, vim, live}

function create(parent, hooks, opts = {}) {
  const liveComp = new Compartment();
  const spellComp = new Compartment();
  const keysComp = new Compartment();
  const vimComp = new Compartment();
  const focusComp = new Compartment(), typeComp = new Compartment();

  let liveOn = opts.live ?? true, keys = opts.keys || {}, vimOn = !!opts.vim;
  const extensions = () => [
    vimComp.of(vimOn ? vimMode() : []),
    focusComp.of(opts.focus ? focusPara : []),
    typeComp.of(opts.typewriter ? typewriter : []),
    hooksFacet.of(hooks),
    focusField,
    dragField,
    dragFreeze,
    EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    EditorView.inputHandler.of(mathSnippetInput),
    indentUnit.of('\t'),
    EditorState.tabSize.of(4),
    markdown({ base: markdownLanguage, codeLanguages, extensions: [ObsidianMarkdown, ObsidianComments], addKeymap: false }),
    // Enter carries a list or quote on; on an empty item it ends the list, as in Obsidian (not
    // CodeMirror's default, which first makes a tight list loose).
    Prec.high(keymap.of([{ key: 'Enter', run: v => fenceEnter(v) || tableMove(v, 'down') || endQuote(v) || continueMarkup(v) }, { key: 'Backspace', run: deleteMarkupBackward }])),
    EditorView.inputHandler.of(wrapSelectionInput),
    plainPasteKeys,
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{'] } }]),
    closeBrackets(),
    autocompletion({ override: [completions], icons: false, activateOnTyping: true }),
    search({ top: true }),
    EditorState.phrases.of(SEARCH_PHRASES),
    highlightSelectionMatches(),
    folding,
    syntaxHighlighting(classHighlighter),
    syntaxHighlighting(markStyle),
    placeholder(opts.placeholder ?? 'Start writing…'),
    theme,
    spellComp.of(EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' })),
    liveComp.of(liveOn ? livePreview : []),
    Prec.highest(keymap.of(opts.extraKeys || [])),
    Prec.high(keysComp.of(keymap.of(keyBindings(keys)))),
    Prec.high(keymap.of([
      { key: 'Tab', run: v => mathTab(v) || tableMove(v, 'next') || smartTab(v), shift: v => tableMove(v, 'prev') || indentLess(v) },
      { key: 'ArrowDown', run: v => fenceExit(v) },
      { key: 'Mod-Shift-ArrowUp', run: v => moveItem(v, -1) },
      { key: 'Mod-Shift-ArrowDown', run: v => moveItem(v, 1) },
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
        // WebKitGTK (the Linux app) pastes an image as an empty event: hooks.clipboardImage reads it.
        if (!files.length && !e.clipboardData?.types.length && hooks.clipboardImage && hooks.onFiles) {
          e.preventDefault();
          hooks.clipboardImage().then(f => f && hooks.onFiles([f], true));
          return true;
        }
        if (!files.length) return pasteRichText(e, view, hooks);
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
    // A note's whole editor state (text, selection, undo history), for tabs to keep and bring
    // back; current settings (keys, Vim, live preview) are re-applied when it returns.
    getState() { return view.state; },
    setState(st) {
      view.setState(st);
      view.dispatch({ effects: [setFocus.of(view.hasFocus), liveComp.reconfigure(liveOn ? livePreview : []), keysComp.reconfigure(keymap.of(keyBindings(keys))), vimComp.reconfigure(vimOn ? vimMode() : [])] });
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
    setVim(on) { vimOn = !!on; view.dispatch({ effects: vimComp.reconfigure(vimOn ? vimMode() : []) }); },
    // A vimrc's mappings and options (they apply to every editor); returns the lines it skipped.
    applyVimrc(text) { return vimOn ? applyVimrc(view, text) : []; },
    setFocusMode(on) { opts.focus = !!on; view.dispatch({ effects: focusComp.reconfigure(on ? focusPara : []) }); },
    setTypewriter(on) { opts.typewriter = !!on; view.dispatch({ effects: typeComp.reconfigure(on ? typewriter : []) }); },
    // Where the cursor is: {line, col, selected (characters), words (in the selection)}.
    cursorInfo() {
      const r = view.state.selection.main, l = view.state.doc.lineAt(r.head);
      const sel = view.state.sliceDoc(r.from, r.to);
      return { line: l.number, col: r.head - l.from + 1, selected: r.to - r.from, words: sel ? (sel.match(/[\p{L}\p{N}'’_-]+/gu) || []).length : 0 };
    },
    run(id) { const c = COMMANDS[id]; if (!c) return false; view.focus(); return c.run(view); },
    toggleCheckbox() { return toggleCheckbox(view); },
    // Insert a snippet over the selection; its ${fields} become Tab stops, the first one selected.
    snippet(text) { const r = view.state.selection.main; view.focus(); snippet(text)(view, null, r.from, r.to); },
    openSearch() { view.focus(); openSearchPanel(view); },
    destroy() { view.destroy(); },
  };
}

// ------------------------------------------------------------------ equation field

// A small LaTeX field where everything is math, so it has what the note editor has inside $…$:
// \command suggestions with previews, snippet fields to Tab through, and the math shortcuts.
// Enter submits (Shift+Enter for a new line) and Escape cancels, once any suggestion list is closed.
function mathField(parent, o = {}) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: o.value || '',
      extensions: [
        hooksFacet.of(o.hooks || {}),
        allMath.of(true),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        EditorView.inputHandler.of(mathSnippetInput),
        EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{'] } }]),
        closeBrackets(),
        autocompletion({ override: [latexCompletions], icons: false, activateOnTyping: true }),
        placeholder(o.placeholder || ''),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': o.label || 'LaTeX' }),
        Prec.high(keymap.of([
          { key: 'Tab', run: v => mathTab(v) },
          { key: 'Enter', run: v => { if (completionStatus(v.state) === 'active') return false; o.onSubmit?.(); return true; } },
          { key: 'Shift-Enter', run: insertNewline },
          { key: 'Escape', run: v => { if (completionStatus(v.state) === 'active') return false; o.onCancel?.(); return true; } },
        ])),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
        EditorView.updateListener.of(u => { if (u.docChanged) o.onChange?.(u.state.doc.toString()); }),
      ],
    }),
  });
  return {
    view,
    get value() { return view.state.doc.toString(); },
    focus() { view.focus(); view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true }); },
    destroy() { view.destroy(); },
  };
}

// ------------------------------------------------------------------ reading a note's structure

// The vault index reads notes with the same Markdown parser as the editor (Lezer), trimmed of
// the inline syntax it doesn't need. Returns, as offsets into `text`:
//   code: [[from, to]] (fenced and indented code, inline code, HTML blocks and comments),
//   urls: [[from, to]] (the targets of Markdown links, so "#anchor" isn't read as a tag),
//   headings: [{level, text, from}], links: [{from, to, url, text, image}],
//   comments: [[from, to]] (Obsidian's %%comments%%, which reading view leaves out).
const scanParser = mdParser.configure([ObsidianComments, { remove: ['Emphasis', 'HardBreak', 'Entity', 'HTMLTag', 'Autolink'] }]);
function scanMarkdown(text) {
  const code = [], urls = [], headings = [], links = [], comments = [];
  scanParser.parse(text).iterate({
    enter(n) {
      switch (n.name) {
        case 'FencedCode': case 'CodeBlock': case 'InlineCode': case 'HTMLBlock': case 'CommentBlock': case 'Comment':
          code.push([n.from, n.to]); return false;
        case 'ObsidianComment': case 'ObsidianCommentBlock':
          comments.push([n.from, n.to]); return false;
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3': case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          if (n.node.parent?.name !== 'Document') return; // not headings inside quotes or lists, as in Obsidian's outline
          const raw = text.slice(n.from, n.to);
          headings.push({ level: +n.name.slice(-1), text: raw.replace(/^#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$|[ \t]+$/, ''), from: n.from });
          return;
        }
        case 'SetextHeading1': case 'SetextHeading2': {
          if (n.node.parent?.name !== 'Document') return;
          const raw = text.slice(n.from, n.to).split('\n');
          headings.push({ level: +n.name.slice(-1), text: raw.slice(0, -1).map(l => l.trim()).join(' '), from: n.from });
          return;
        }
        case 'Link': case 'Image': {
          const u = n.node.getChild('URL');
          if (u) {
            urls.push([u.from, u.to]);
            const marks = n.node.getChildren('LinkMark');
            const textEnd = marks.length > 1 ? marks[1].from : u.from;
            links.push({ from: n.from, to: n.to, url: text.slice(u.from, u.to), text: text.slice(n.from + (n.name === 'Image' ? 2 : 1), textEnd), image: n.name === 'Image' });
          }
          return;
        }
      }
    },
  });
  return { code, urls, headings, links, comments };
}

window.CinderEditor = { create, mathField, scanMarkdown, vimKeys: VIM_KEYS, vimClipboard, commands: Object.fromEntries(Object.entries(COMMANDS).map(([id, c]) => [id, { name: c.name, key: c.key }])) };

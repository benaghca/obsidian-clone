// Folio editor: CodeMirror 6 + an Obsidian-style live preview layer.
//
// Bundled into ui/vendor/editor.bundle.js with `npm install && npm run build` in ui/editor/.
// app.js talks to it only through FolioEditor.create(parent, hooks).

import { EditorState, EditorSelection, StateField, StateEffect, Compartment, Prec, Annotation } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, ViewPlugin, keymap, placeholder, drawSelection, dropCursor, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, insertTab } from '@codemirror/commands';
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit, LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
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

// Obsidian extras on top of GFM: [[wikilinks]], ![[embeds]], ==highlights==, #tags, frontmatter.
const ObsidianMarkdown = {
  defineNodes: ['WikiLink', 'Embed', 'WikiMark', 'Highlight', 'HighlightMark', 'Tag', { name: 'Frontmatter', block: true }, 'FrontmatterMark'],
  parseInline: [
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

class ImageWidget extends WidgetType {
  constructor(src, alt, width, block) { super(); this.src = src; this.alt = alt; this.width = width; this.block = block; }
  eq(o) { return o.src === this.src && o.width === this.width && o.block === this.block; }
  toDOM() {
    const wrap = document.createElement(this.block ? 'div' : 'span');
    wrap.className = this.block ? 'cm-embed-block cm-image-block' : 'cm-image-inline';
    const img = document.createElement('img');
    img.src = this.src; img.alt = this.alt || '';
    if (this.width) img.width = this.width;
    wrap.append(img);
    return wrap;
  }
}

let H = null; // hooks from app.js

class EmbedWidget extends WidgetType {
  constructor(path, sub, version) { super(); this.path = path; this.sub = sub; this.version = version; }
  eq(o) { return o.path === this.path && o.sub === this.sub && o.version === this.version; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-note-embed';
    H.renderEmbed(el, this.path, this.sub);
    return el;
  }
}

class TableWidget extends WidgetType {
  constructor(text, version) { super(); this.text = text; this.version = version; }
  eq(o) { return o.text === this.text && o.version === this.version; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-embed-block cm-table-widget markdown';
    H.renderMarkdown(el, this.text);
    return el;
  }
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
  const A = activity(state);
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
            const alt = /^!\[([^\]]*)\]/.exec(doc.sliceString(nf, nt))?.[1] || '';
            const url = src && H.imageUrl(src);
            if (url) out.push(Decoration.replace({ widget: new ImageWidget(url, alt, null, false) }).range(nf, nt));
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
            const target = H.resolve(w.name);
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
            const target = H.resolve(w.name);
            if (target && IMG_EXT.test(target)) {
              const width = w.alias && /^\d+/.test(w.alias) ? parseInt(w.alias) : null;
              out.push(Decoration.replace({ widget: new ImageWidget(H.rawUrl(target), w.name, width, false) }).range(nf, nt));
            } else {
              hide(nf, nf + 3);
              out.push(markCls('cm-wikilink' + (target ? '' : ' cm-unresolved'), { 'data-link': w.name, 'data-sub': w.sub, 'data-live': '1' }).range(nf + 3, nt - 2));
              hide(nt - 2, nt);
            }
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
  const A = activity(state), doc = state.doc, out = [];
  syntaxTree(state).iterate({
    enter(node) {
      const nf = node.from, nt = node.to;
      if (node.name === 'Table') {
        const from = doc.lineAt(nf).from, to = doc.lineAt(nt).to;
        if (!A.lines(from, to)) {
          const text = doc.sliceString(from, to);
          out.push(Decoration.replace({ widget: new TableWidget(text, H.version()), block: true }).range(from, to));
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
          const target = H.resolve(w.name);
          if (target && IMG_EXT.test(target)) {
            const width = w.alias && /^\d+/.test(w.alias) ? parseInt(w.alias) : null;
            widget = new ImageWidget(H.rawUrl(target), w.name, width, true);
          } else if (target && /\.md$/i.test(target)) {
            widget = new EmbedWidget(target, w.sub, H.version());
          }
        } else {
          const text = doc.sliceString(nf, nt);
          const src = /\]\(\s*<?([^)\s>]+)/.exec(text)?.[1];
          const url = src && H.imageUrl(src);
          if (url) widget = new ImageWidget(url, /^!\[([^\]]*)\]/.exec(text)?.[1] || '', null, true);
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
    if (el.dataset.link != null) H.follow(el.dataset.link, el.dataset.sub || '');
    else if (el.dataset.url) H.openUrl(el.dataset.url);
    else if (el.dataset.tag) H.tag(el.dataset.tag);
    return true;
  },
});

const livePreview = [livePlugin, blockField, clickHandler];

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

function toggleCheckbox(view) {
  const changes = [];
  const seen = new Set();
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.head);
    if (seen.has(line.number)) continue; seen.add(line.number);
    let m;
    if ((m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text))) {
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

// ------------------------------------------------------------------ completion

function completions(context) {
  let m = context.matchBefore(/!?\[\[[^\[\]\n|]*/);
  if (m) {
    const at = m.text.indexOf('[[') + 2;
    const q = m.text.slice(at);
    const from = m.from + at;
    const opts = H.linkOptions(q);
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
    const tags = H.tagOptions();
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

function create(parent, hooks) {
  H = hooks;
  const liveComp = new Compartment();
  const spellComp = new Compartment();

  let liveOn = true;
  const extensions = () => [
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
    placeholder('Start writing…'),
    theme,
    spellComp.of(EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' })),
    liveComp.of(liveOn ? livePreview : []),
    Prec.high(keymap.of([
      { key: 'Mod-b', run: wrap('**') },
      { key: 'Mod-i', run: wrap('*') },
      { key: 'Mod-Shift-h', run: wrap('==') },
      { key: 'Mod-k', run: wrap('[[', ']]') },
      { key: 'Mod-Enter', run: toggleCheckbox },
      { key: 'Tab', run: smartTab, shift: indentLess },
      {
        key: 'ArrowUp', run(view) {
          const r = view.state.selection.main;
          if (!r.empty || !H.focusTitle) return false;
          const a = view.coordsAtPos(r.head), b = view.coordsAtPos(0);
          if (a && b && a.top - b.top < 2) { H.focusTitle(); return true; }
          return false;
        },
      },
    ])),
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      // Ctrl+G (graph) and Alt+←/→ (history) belong to the app.
      ...searchKeymap.filter(k => k.key !== 'Mod-g' && k.key !== 'Mod-Shift-g'),
      ...historyKeymap,
      ...defaultKeymap.filter(k => !['Alt-ArrowLeft', 'Alt-ArrowRight', 'Mod-Enter'].includes(k.key)),
    ]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && !u.transactions.some(tr => tr.annotation(silent))) H.onChange();
      if (u.docChanged || u.selectionSet) H.onCursor?.();
    }),
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = [...(e.clipboardData?.files || [])];
        if (!files.length) return false;
        e.preventDefault();
        H.onFiles(files, true);
        return true;
      },
      drop(e, view) {
        const files = [...(e.dataTransfer?.files || [])];
        if (!files.length) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos != null) view.dispatch({ selection: { anchor: pos } });
        H.onFiles(files, false);
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
      view.dispatch({ effects: setFocus.of(view.hasFocus) });
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
    toggleCheckbox() { return toggleCheckbox(view); },
    openSearch() { view.focus(); openSearchPanel(view); },
  };
}

window.FolioEditor = { create };

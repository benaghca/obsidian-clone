// K2 reference: compare-and-swap one property's lines, never a whole stale note.
import { fits, formatProperty, readProperties, yamlString, type Change, type Property, type PropertyType } from "./frontmatter";
import type { NoteProperties } from "../api";

export interface PropertyEdit {
  key: string;
  expect: string | null;
  to: { type: PropertyType; value: string | boolean | string[] } | { lines: string } | null;
}
export type EditResult =
  | { status: "done" | "unchanged"; before: string | null; after: string | null; props: NoteProperties; mtime_ms: number }
  | { status: "conflict"; current: string | null }
  | { status: "refused"; reason: string };
export type PropertyEditResult = EditResult & { change?: Change };
const refused = (reason: string): PropertyEditResult => ({ status: "refused", reason });
const MAX_BYTES = 16 * 1024 * 1024;
const tooLarge = (s: string) => s.length > MAX_BYTES || s.length > MAX_BYTES / 3 && new TextEncoder().encode(s).length > MAX_BYTES;
interface Line { text: string; from: number; end: number; eol: string }
interface Block { lines: Line[]; props: Property[]; open: Line; close: Line }
function lineAt(text: string, from: number): Line {
  const lf = text.indexOf("\n", from), end = lf < 0 ? text.length : lf + 1;
  const cr = lf >= 0 && text[lf - 1] === "\r";
  return { text: text.slice(from, lf < 0 ? end : lf - Number(cr)), from, end, eol: lf < 0 ? "" : cr ? "\r\n" : "\n" };
}
function blockOf(text: string): Block | null | false {
  const open = lineAt(text, text.startsWith("\uFEFF") ? 1 : 0);
  if (open.text.trim() !== "---") return null;
  const lines: Line[] = [];
  for (let at = open.end, n = 1; open.eol && at <= text.length && n <= 2000; n++) {
    const line = lineAt(text, at);
    if (line.text.trim() === "---") {
      const props = readProperties(lines.map(l => l.text));
      return props ? { open, close: line, lines, props } : false;
    }
    lines.push(line); if (!line.eol) break; at = line.end;
  }
  return false;
}
const info = (b: Block | null): NoteProperties => ({ props: b?.props ?? [], lines: b?.lines.map(l => l.text) ?? [] });
const sourceOf = (b: Block, p: Property) => b.lines.slice(p.line, p.line + p.count).map(l => l.text).join("\n");
const sameKey = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function colon(line: string): number {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    if (quote) { if (quote === '"' && line[i] === "\\") i++; else if (line[i] === quote) { if (quote === "'" && line[i + 1] === "'") i++; else quote = ""; } }
    else if (line[i] === '"' || line[i] === "'") quote = line[i];
    else if (line[i] === ":") return i;
  }
  return -1;
}
function one(lines: string, key: string): Property | null {
  if (lines.includes("\r")) return null;
  const text = lines.split("\n"), props = readProperties(text);
  return props?.length === 1 && props[0].line === 0 && props[0].count === text.length && sameKey(props[0].key, key) && props[0].type !== "unknown" ? props[0] : null;
}
function target(edit: PropertyEdit, b: Block | null, p?: Property): { lines: string | null; intended?: Property } | null {
  if (edit.to === null) return { lines: null };
  if ("lines" in edit.to) { const intended = typeof edit.to.lines === "string" && !tooLarge(edit.to.lines) && one(edit.to.lines, edit.key); return intended ? { lines: edit.to.lines, intended } : null; }
  const { type } = edit.to; let { value } = edit.to;
  if (!["text", "number", "checkbox", "date", "datetime", "list", "tags", "aliases"].includes(type)) return null;
  if (!["string", "boolean"].includes(typeof value) && !(Array.isArray(value) && value.every(v => typeof v === "string"))) return null;
  if (typeof value === "string" && tooLarge(value) || Array.isArray(value) && value.reduce((n, v) => n + v.length, 0) > MAX_BYTES) return null;
  const list = ["list", "tags", "aliases"].includes(type);
  if (list) { if (typeof value === "boolean") return null; value = Array.isArray(value) ? value : value ? [value] : []; }
  else if (Array.isArray(value) || (type === "checkbox" ? typeof value !== "boolean" && value !== "" : typeof value !== "string")) return null;
  let lines = formatProperty(edit.key, type, value);
  const key = p && b ? b.lines[p.line].text.slice(0, colon(b.lines[p.line].text)) : lines.slice(0, colon(lines));
  lines = key + lines.slice(colon(lines));
  if (p && b) {
    const old = sourceOf(b, p), inline = old.slice(colon(old) + 1).trim();
    if (list && Array.isArray(value) && value.length) {
      const indent = /^([ \t]*)-/.exec(old.split("\n").slice(1).find(l => l.trim()) ?? "")?.[1] ?? "  ";
      lines = inline.startsWith("[") ? `${key}: [${value.map(v => /[,\[\]]/.test(v) ? JSON.stringify(v) : yamlString(v)).join(", ")}]` : [`${key}:`, ...value.map(v => `${indent}- ${yamlString(v)}`)].join("\n");
    } else if (typeof value === "string" && value && ["text", "date", "datetime"].includes(type)) {
      const styled = inline.startsWith("'") && !/[\r\n]/.test(value) ? `'${value.replaceAll("'", "''")}'` : inline.startsWith('"') ? JSON.stringify(value) : null;
      if (styled && one(`${key}: ${styled}`, edit.key)) lines = `${key}: ${styled}`;
    }
  }
  const intended = one(lines, edit.key);
  if (!intended || !fits(intended, type) || JSON.stringify(intended.value) !== JSON.stringify(value)) return null;
  return { lines, intended };
}

/** UTF-16 offsets for an editor transaction. Filesystem mtime is supplied by the caller. */
export function editProperty(text: string, edit: PropertyEdit): PropertyEditResult {
  if (tooLarge(text)) return refused("Note exceeds 16 MB");
  if (!edit || typeof edit.key !== "string" || !edit.key || /[\r\n\0]/.test(edit.key) || edit.key.length > 1024 || !(edit.expect === null || typeof edit.expect === "string")) return refused("Invalid property edit");
  const block = blockOf(text);
  if (block === false) return refused("Frontmatter is not safely editable");
  const p = block?.props.find(p => sameKey(p.key, edit.key));
  if (p?.type === "unknown") return refused("Property is not safely editable");
  if (edit.to !== null && (!edit.to || typeof edit.to !== "object")) return refused("Invalid target property");
  const next = target(edit, block, p);
  if (!next) return refused("Invalid target property");
  const before = p && block ? sourceOf(block, p) : null;
  // A missing empty target already belongs to No value; do not create a key.
  const after = !p && edit.to !== null && !("lines" in edit.to) && next.intended && (next.intended.value === "" || Array.isArray(next.intended.value) && !next.intended.value.length) ? null : next.lines;
  if (before === after) return { status: "unchanged", before, after, props: info(block), mtime_ms: 0 };
  if (before !== edit.expect) return { status: "conflict", current: before };
  const eol = block?.open.eol || (text.includes("\r\n") ? "\r\n" : "\n");
  const formatted = after?.split("\n").map((line, i, all) => line + (i === all.length - 1 ? "" : block && p && i < p.count - 1 ? block.lines[p.line + i].eol : eol)).join("") ?? "";
  let change: Change;
  if (block && p) {
    const first = block.lines[p.line], last = block.lines[p.line + p.count - 1];
    change = after === null ? { from: first.from, to: last.end, insert: "" } : { from: first.from, to: last.end - last.eol.length, insert: formatted };
  } else if (block) change = { from: block.close.from, to: block.close.from, insert: formatted + eol };
  else { const at = text.startsWith("\uFEFF") ? 1 : 0; change = { from: at, to: at, insert: `---${eol}${formatted}${eol}---${eol}` }; }
  const result = text.slice(0, change.from) + change.insert + text.slice(change.to), parsed = blockOf(result);
  if (parsed === false) return refused("Edit validation failed");
  const actual = parsed?.props.find(q => sameKey(q.key, edit.key));
  const actualLines = parsed && actual ? sourceOf(parsed, actual) : null;
  const other = (b: Block | null) => b?.props.filter(q => !sameKey(q.key, edit.key)).map(q => [q.key, sourceOf(b, q)]) ?? [];
  const body = (s: string, b: Block | null) => s.slice(b ? b.close.end : s.startsWith("\uFEFF") ? 1 : 0);
  if (tooLarge(result) || actualLines !== after || JSON.stringify(other(block)) !== JSON.stringify(other(parsed)) || body(text, block) !== body(result, parsed)) return refused("Edit validation failed");
  if (actual && next.intended && (actual.type !== next.intended.type || JSON.stringify(actual.value) !== JSON.stringify(next.intended.value))) return refused("Edit validation failed");
  return { status: "done", before, after, props: info(parsed), mtime_ms: 0, change };
}

// Replace only an edited YAML block; never reserialize the file.
import { yamlString } from "../editor/frontmatter";
import { type Yaml } from "./yaml";
export interface Sort { property: string; direction: "ASC" | "DESC" }
export function writeView(source: string, key: "order" | "sort" | "filters" | "columnSize", value: Yaml | Sort[] | undefined, viewIndex = 0): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const text = (i: number) => lines[i].replace(/\r?\n$/, "");
  const content = (i: number) => text(i).trim() && !text(i).trimStart().startsWith("#");
  const indent = (i: number) => /^ */.exec(text(i))![0].length;
  let views = lines.findIndex((_, i) => /^(?:views|"views"|'views')\s*:/.test(text(i)));
  if (views < 0 || /:\s*\[\]\s*(?:#.*)?$/.test(text(views))) {
    if (value === undefined) return source;
    if (viewIndex) throw Error("View does not exist");
    const prefix = views < 0 ? source + (source && !source.endsWith("\n") ? eol : "") : lines.slice(0, views).join("");
    const suffix = views < 0 ? "" : lines.slice(views + 1).join("");
    return prefix + `views:${eol}  - type: table${eol}    name: View${eol}` + block(4) + suffix;
  }
  let end = views + 1;
  while (end < lines.length && (!content(end) || indent(end) > 0)) end++;
  const starts: number[] = [];
  let itemIndent = -1;
  for (let i = views + 1; i < end; i++) if (content(i) && /^ *-\s/.test(text(i))) {
    if (itemIndent < 0) itemIndent = indent(i);
    if (indent(i) === itemIndent) starts.push(i);
  }
  const start = starts[viewIndex];
  if (start === undefined) throw Error("View does not exist");
  end = starts[viewIndex + 1] ?? end;
  const level = itemIndent + 2;
  let at = -1, inline = false;
  for (let i = start; i < end; i++) {
    const body = i === start ? text(i).slice(itemIndent + 2) : text(i).slice(level);
    if ((i === start || indent(i) === level) && new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*:`).test(body)) { at = i; inline = i === start; break; }
  }
  if (at >= 0) {
    let stop = at + 1, last = stop;
    while (stop < end && (!content(stop) || indent(stop) > level)) { if (content(stop)) last = stop + 1; stop++; }
    let replacement = block(level);
    if (inline && !replacement) replacement = " ".repeat(itemIndent) + "-" + eol;
    else if (inline) replacement = " ".repeat(itemIndent) + "- " + replacement.slice(level);
    if (last === lines.length && !source.endsWith("\n")) replacement = replacement.slice(0, -eol.length);
    return lines.slice(0, at).join("") + replacement + lines.slice(last).join("");
  }
  if (value === undefined) return source;
  // Insert before trailing comments/blank lines so they remain byte-identical.
  while (end > start + 1 && !content(end - 1)) end--;
  const prefix = lines.slice(0, end).join("");
  return prefix + (prefix.endsWith("\n") ? "" : eol) + block(level) + lines.slice(end).join("");

  function block(level: number) {
    const pad = " ".repeat(level);
    if (value === undefined) return "";
    if (key === "columnSize") return yamlBlock(key, value as Yaml, level, eol);
    if (key === "filters") return yamlBlock(key, value as Yaml, level, eol);
    if (!(value as Yaml[]).length) return `${pad}${key}: []${eol}`;
    return `${pad}${key}:${eol}` + (value as (string | Sort)[]).map(item => typeof item === "string" ? `${pad}  - ${yamlString(item)}${eol}` : `${pad}  - property: ${yamlString(item.property)}${eol}${pad}    direction: ${item.direction}${eol}`).join("");
  }
}

// Canonical block YAML for the small filter/view values we write.
function yamlBlock(key: string, value: Yaml, level: number, eol: string): string {
  const pad = " ".repeat(level);
  const scalar = (v: Yaml) => typeof v === "string" ? yamlString(v) : JSON.stringify(v);
  if (value === null || typeof value !== "object" || !Object.keys(value).length) return `${pad}${yamlString(key)}: ${scalar(value)}${eol}`;
  const children = Array.isArray(value) ? value.map(v => {
    if (v === null || typeof v !== "object") return `${pad}  - ${scalar(v)}${eol}`;
    const block = Object.entries(v).map(([k, child]) => yamlBlock(k, child, level + 4, eol)).join("");
    return `${pad}  - ${block.slice(level + 4)}`;
  }).join("") : Object.entries(value).map(([k, v]) => yamlBlock(k, v, level + 2, eol)).join("");
  return `${pad}${yamlString(key)}:${eol}${children}`;
}
export function writeFilters(source: string, value: Yaml, viewIndex?: number): string {
  if (viewIndex !== undefined) return writeView(source, "filters", value, viewIndex);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const at = lines.findIndex(line => /^(?:filters|"filters"|'filters')\s*:/.test(line));
  if (at < 0) return yamlBlock("filters", value, 0, eol) + source;
  let stop = at + 1, last = stop;
  while (stop < lines.length && (/^ +\S/.test(lines[stop]) || !lines[stop].trim() || lines[stop].trimStart().startsWith("#"))) {
    if (lines[stop].trim() && !lines[stop].trimStart().startsWith("#")) last = stop + 1;
    stop++;
  }
  let block = yamlBlock("filters", value, 0, eol);
  if (last === lines.length && !source.endsWith("\n")) block = block.slice(0, -eol.length);
  return lines.slice(0, at).join("") + block + lines.slice(last).join("");
}
export function addView(source: string, name: string): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const at = lines.findIndex(line => /^(?:views|"views"|'views')\s*:/.test(line));
  const item = (indent: number) => `${" ".repeat(indent)}- type: table${eol}${" ".repeat(indent + 2)}name: ${yamlString(name)}${eol}`;
  if (at < 0) return source + (source && !source.endsWith("\n") ? eol : "") + `views:${eol}  - type: table${eol}    name: View${eol}` + item(2);
  if (/:\s*\[\]\s*(?:#.*)?$/.test(lines[at].trimEnd())) return lines.slice(0,at).join("") + `views:${eol}  - type: table${eol}    name: View${eol}` + item(2) + lines.slice(at+1).join("");
  let end = at + 1;
  while (end < lines.length && (/^ +\S/.test(lines[end]) || !lines[end].trim() || lines[end].trimStart().startsWith("#"))) end++;
  const indent = /^ */.exec(lines.slice(at+1,end).find(line => /^ *-\s/.test(line)) ?? "  ")![0].length;
  while (end > at + 1 && (!lines[end-1].trim() || lines[end-1].trimStart().startsWith("#"))) end--;
  const prefix = lines.slice(0,end).join("");
  return prefix + (prefix.endsWith("\n") ? "" : eol) + item(indent) + lines.slice(end).join("");
}

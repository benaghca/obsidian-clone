// Replace only the selected view's order/sort block; never reserialize the file.
import { yamlString } from "../editor/frontmatter";
export interface Sort { property: string; direction: "ASC" | "DESC" }
export function writeView(source: string, key: "order" | "sort", value: string[] | Sort[], viewIndex = 0): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const text = (i: number) => lines[i].replace(/\r?\n$/, "");
  const content = (i: number) => text(i).trim() && !text(i).trimStart().startsWith("#");
  const indent = (i: number) => /^ */.exec(text(i))![0].length;
  let views = lines.findIndex((_, i) => /^(?:views|"views"|'views')\s*:/.test(text(i)));
  if (views < 0 || /:\s*\[\]\s*(?:#.*)?$/.test(text(views))) {
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
    if (inline) replacement = " ".repeat(itemIndent) + "- " + replacement.slice(level);
    if (last === lines.length && !source.endsWith("\n")) replacement = replacement.slice(0, -eol.length);
    return lines.slice(0, at).join("") + replacement + lines.slice(last).join("");
  }
  // Insert before trailing comments/blank lines so they remain byte-identical.
  while (end > start + 1 && !content(end - 1)) end--;
  const prefix = lines.slice(0, end).join("");
  return prefix + (prefix.endsWith("\n") ? "" : eol) + block(level) + lines.slice(end).join("");

  function block(level: number) {
    const pad = " ".repeat(level);
    if (!value.length) return `${pad}${key}: []${eol}`;
    return `${pad}${key}:${eol}` + value.map(item => typeof item === "string" ? `${pad}  - ${yamlString(item)}${eol}` : `${pad}  - property: ${yamlString(item.property)}${eol}${pad}    direction: ${item.direction}${eol}`).join("");
  }
}

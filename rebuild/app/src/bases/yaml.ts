// Read-only YAML subset for Bases. Never stringify: unsupported YAML stays on disk.
export type Yaml = null | string | number | boolean | Yaml[] | { [key: string]: Yaml };
export const mapping = (v: Yaml | undefined): Record<string, Yaml> => v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};

// Comments and map separators only count outside quoted scalars.
function boundary(text: string, marker: string) {
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === "\\") i++;
      else if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") i++;
        else quote = "";
      }
    } else if ((ch === '"' || ch === "'") && (i === 0 || !/[\w]/.test(text[i - 1]))) quote = ch;
    else if (ch === marker && (marker === "#" ? i === 0 || /\s/.test(text[i - 1]) : i + 1 === text.length || /\s/.test(text[i + 1]))) return i;
  }
  if (quote) throw Error("Unclosed quoted value");
  return -1;
}
function scalar(raw: string): Yaml {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try { const s = JSON.parse(v); if (typeof s === "string") return s; } catch { /* readable error below */ }
    throw Error("Invalid double-quoted value");
  }
  if (v.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(v)) throw Error("Invalid single-quoted value");
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v === "[]") return [];
  if (v === "{}") return {};
  if (/^[\[\]{}&*!|>%@`]/.test(v) || boundary(v, ":") >= 0) throw Error("Unsupported YAML value");
  if (!v || /^(null|~)$/i.test(v)) return null;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)) return Number(v);
  return v;
}
export function readYaml(source: string): Record<string, Yaml> {
  const lines: { indent: number; text: string; line: number }[] = [];
  if (source.length > 1_000_000) throw Error("Base file is too large");
  source.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((raw, n) => {
    if (/^ *\t/.test(raw)) throw Error(`Tabs in indentation at line ${n + 1}`);
    const comment = boundary(raw, "#");
    const text = (comment < 0 ? raw : raw.slice(0, comment)).trimEnd();
    if (!text.trim() || text === "---" || text === "...") return;
    const indent = text.length - text.trimStart().length, body = text.trimStart();
    // A list's inline mapping starts at the same indentation as its following keys.
    if (/^-\s+/.test(body) && boundary(body.slice(2), ":") >= 0) {
      lines.push({ indent, text: "-", line: n + 1 }, { indent: indent + 2, text: body.slice(2).trimStart(), line: n + 1 });
    } else lines.push({ indent, text: body, line: n + 1 });
  });
  let at = 0;
  function block(indent: number, depth: number): Yaml {
    if (depth > 40) throw Error("YAML nesting is too deep");
    const list = /^-(\s|$)/.test(lines[at].text);
    const result: Yaml[] | Record<string, Yaml> = list ? [] : Object.create(null);
    while (at < lines.length && lines[at].indent === indent) {
      const row = lines[at++];
      if (list) {
        if (!/^-(\s|$)/.test(row.text)) throw Error(`Expected list at line ${row.line}`);
        const value = row.text.slice(1).trim();
        (result as Yaml[]).push(value ? scalar(value) : at < lines.length && lines[at].indent > indent ? block(lines[at].indent, depth + 1) : null);
      } else {
        const colon = boundary(row.text, ":");
        if (colon < 1) throw Error(`Expected key: value at line ${row.line}`);
        const key = scalar(row.text.slice(0, colon));
        if (typeof key !== "string" || Object.hasOwn(result, key)) throw Error(`Invalid or duplicate key at line ${row.line}`);
        const value = row.text.slice(colon + 1).trim();
        (result as Record<string, Yaml>)[key] = value ? scalar(value) : at < lines.length && lines[at].indent > indent ? block(lines[at].indent, depth + 1) : null;
      }
      if (at < lines.length && lines[at].indent > indent) throw Error(`Unexpected indentation at line ${lines[at].line}`);
    }
    return result;
  }
  if (!lines.length) return {};
  if (lines[0].indent) throw Error("Expected an unindented mapping");
  const out = block(0, 0);
  if (at !== lines.length || Array.isArray(out)) throw Error("Expected a base mapping");
  return mapping(out);
}

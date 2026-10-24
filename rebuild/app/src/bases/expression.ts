// Small expression interpreter. Parse the entire expression before evaluation;
// no eval, JavaScript property access, or silent execution of unknown functions.
import { isUnder, trimSlashes } from "../paths";
export type Value = string | number | boolean | null | Value[];
export interface Context { get(key: string): Value; hasTag(tag: string): boolean; hasLink(link: string): boolean }
export type Expression = (context: Context) => Value;
const empty = (v: Value) => v === null || v === "" || Array.isArray(v) && !v.length;
export function compare(a: Value, b: Value): number | null {
  if (empty(a) || empty(b)) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}
export function expression(source: string): Expression {
  if (source.length > 4000) throw Error("Expression is too long");
  const tokens = source.match(/\s+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?|[A-Za-z_][\w.]*(?:[\w])?|==|!=|>=|<=|&&|\|\||[!><(),-]|./g)?.filter(t => !/^\s+$/.test(t)) ?? [];
  if (tokens.length > 500) throw Error("Expression is too complex");
  let at = 0, depth = 0;
  const take = (t: string) => tokens[at] === t ? (++at, true) : false;
  const need = (t: string) => { if (!take(t)) throw Error(`Expected ${t}`); };
  function atom(): Expression {
    if (++depth > 50) throw Error("Expression nesting is too deep");
    let out: Expression;
    if (take("!")) { const v = atom(); out = c => !v(c); }
    else if (take("-")) { const v = atom(); out = c => typeof v(c) === "number" ? -(v(c) as number) : null; }
    else if (take("(")) { out = binary(0); need(")"); }
    else {
      const t = tokens[at++];
      if (!t) throw Error("Expected an expression");
      if (/^["']/.test(t)) {
        let value: string;
        if (t[0] === '"') value = JSON.parse(t);
        else value = t.slice(1, -1).replace(/\\(['\\])/g, "$1");
        out = () => value;
      } else if (/^\d/.test(t)) out = () => Number(t);
      else if (["true", "false", "null"].includes(t)) out = () => t === "null" ? null : t === "true";
      else if (take("(")) {
        const args: Expression[] = [];
        if (!take(")")) { do { args.push(binary(0)); } while (take(",")); need(")"); }
        const arity = (n: number) => { if (args.length !== n) throw Error(`Expected ${n} arguments for ${t}`); };
        if (t === "today") { arity(0); out = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; }
        else if (t === "if") { arity(3); out = c => args[0](c) ? args[1](c) : args[2](c); }
        else if (t === "file.inFolder") { arity(1); out = c => { const folder = trimSlashes(String(args[0](c))); return !folder || isUnder(String(c.get("file.folder")), folder); }; }
        else if (t === "file.hasTag") { arity(1); out = c => c.hasTag(String(args[0](c))); }
        else if (t === "file.hasLink") { arity(1); out = c => c.hasLink(String(args[0](c))); }
        else if (t === "contains" || t.endsWith(".contains")) {
          const method = t !== "contains"; arity(method ? 1 : 2);
          const target = method ? property(t.slice(0, -9)) : args[0];
          out = c => { const v = target(c), item = args[method ? 0 : 1](c); return typeof v === "string" ? v.includes(String(item)) : Array.isArray(v) && v.includes(item); };
        } else throw Error(`Unsupported function: ${t}`);
      } else out = property(t);
    }
    depth--; return out;
  }
  function property(key: string): Expression {
    if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?$/.test(key) || key === "this" || key.startsWith("this.")) throw Error(`Unsupported property: ${key}`);
    if (key.startsWith("file.") && !["name", "path", "folder", "ext", "mtime", "ctime", "tags", "size"].includes(key.slice(5))) throw Error(`Unsupported property: ${key}`);
    return c => c.get(key);
  }
  const levels = [["||"], ["&&"], ["==", "!=", ">", ">=", "<", "<="]];
  function binary(level: number): Expression {
    if (level === levels.length) return atom();
    let left = binary(level + 1);
    while (levels[level].includes(tokens[at])) {
      const op = tokens[at++], a = left, b = binary(level + 1);
      left = c => {
        if (op === "&&") return !!a(c) && !!b(c);
        if (op === "||") return !!a(c) || !!b(c);
        const x = a(c), y = b(c);
        if (op === "==" || op === "!=") { const eq = x === y || empty(x) && empty(y); return op === "==" ? eq : !eq; }
        const order = compare(x, y);
        return order !== null && (op === ">" ? order > 0 : op === ">=" ? order >= 0 : op === "<" ? order < 0 : order <= 0);
      };
    }
    return left;
  }
  const out = binary(0);
  if (at !== tokens.length) throw Error(`Unsupported expression near ${tokens[at]}`);
  return out;
}

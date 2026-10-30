// Parse the entire expression before evaluation. Only explicit AST nodes,
// whitelisted functions and Context getters are executable: no eval/JS access.
import { arithmetic, checked, compareValues, equalValues, fileProperties, FormulaError, FormulaFile, globalFunction, isFormulaError, member, methodFunction, runtime, truthy, validateCall, valueProperties, type Context, type Runtime, type Value } from "./functions";
export { FormulaError, FormulaFile, FormulaLink, FormulaDate, FormulaDuration, isFormulaError, displayValue } from "./functions";
export type { Context, Value } from "./functions";
export const compare = compareValues;
export interface Expression {
  (context: Context): Value;
  /** Parse failure available before any rows exist. */
  readonly error?: FormulaError;
  /** Getter keys, prefixed with this. for host-note dependencies. */
  readonly dependencies?: readonly string[];
  readonly usesThis?: boolean;
}

type Scope = "row" | "this";
type Node =
  | { type: "literal"; value: Value }
  | { type: "read"; scope: Scope; key: string }
  | { type: "file"; scope: Scope }
  | { type: "unary"; op: string; value: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] }
  | { type: "method"; base: Node; name: string; args: Node[] }
  | { type: "member"; base: Node; key: string };
interface Token { type: "id" | "number" | "string" | "op"; text: string; at: number }
const operators = new Map([["||", 1], ["&&", 2], ["==", 3], ["!=", 3], [">", 4], [">=", 4], ["<", 4], ["<=", 4], ["+", 5], ["-", 5], ["*", 6], ["/", 6], ["%", 6]]);
function tokenize(source: string): Token[] {
  if (source.length > 4000) throw new FormulaError("Expression is too long", "parse", 4000);
  const tokens: Token[] = [];
  const id = /[A-Za-z_][A-Za-z_0-9]*/y, numeric = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
  for (let at = 0; at < source.length;) {
    if (/\s/.test(source[at])) { at++; continue; }
    const start = at, ch = source[at];
    if (ch === '"' || ch === "'") {
      at++;
      let value = "", ended = false;
      while (at < source.length) {
        const c = source[at++];
        if (c === ch) { ended = true; break; }
        if (c === "\n" || c === "\r") throw new FormulaError("Unescaped newline in text", "parse", at - 1);
        if (c !== "\\") { value += c; continue; }
        const escape = source[at++];
        if (escape === "u") {
          const hex = source.slice(at, at + 4);
          if (!/^[0-9a-f]{4}$/i.test(hex)) throw new FormulaError("Invalid Unicode escape", "parse", at);
          value += String.fromCharCode(parseInt(hex, 16)); at += 4;
        } else {
          const escapes = new Map([["n", "\n"], ["r", "\r"], ["t", "\t"], ["b", "\b"], ["f", "\f"], ["\\", "\\"], ["/", "/"], ['"', '"'], ["'", "'"]]);
          const decoded = escapes.get(escape);
          if (decoded === undefined) throw new FormulaError("Invalid text escape", "parse", at - 1);
          value += decoded;
        }
      }
      if (!ended) throw new FormulaError("Unterminated text", "parse", start);
      tokens.push({ type: "string", text: value, at: start });
    } else {
      id.lastIndex = at; numeric.lastIndex = at;
      const name = id.exec(source), number = name ? null : numeric.exec(source);
      if (name) { tokens.push({ type: "id", text: name[0], at }); at = id.lastIndex; }
      else if (number) { tokens.push({ type: "number", text: number[0], at }); at = numeric.lastIndex; }
      else {
        const pair = source.slice(at, at + 2);
        if (["==", "!=", ">=", "<=", "&&", "||"].includes(pair)) { tokens.push({ type: "op", text: pair, at }); at += 2; }
        else if ("!><()+-*/%,.[]".includes(ch)) { tokens.push({ type: "op", text: ch, at }); at++; }
        else throw new FormulaError(`Unexpected character ${ch}`, "parse", at);
      }
    }
    if (tokens.length > 500) throw new FormulaError("Expression is too complex", "parse", start);
  }
  return tokens;
}
class Parser {
  private at = 0;
  private depth = 0;
  constructor(private tokens: Token[], private length: number) {}
  private fail(message: string): never { throw new FormulaError(message, "parse", this.tokens[this.at]?.at ?? this.length); }
  private take(text: string) { if (this.tokens[this.at]?.text === text && this.tokens[this.at].type === "op") { this.at++; return true; } return false; }
  private need(text: string) { if (!this.take(text)) this.fail(`Expected ${text}`); }
  private nested<T>(parse: () => T): T {
    if (++this.depth > 50) this.fail("Expression nesting is too deep");
    try { return parse(); } finally { this.depth--; }
  }
  private identifier() { const t = this.tokens[this.at++]; if (!t || t.type !== "id") this.fail("Expected a property name"); return t.text; }
  private propertyName(): string {
    if (this.take(".")) return this.identifier();
    if (this.take("[")) {
      const t = this.tokens[this.at++];
      if (!t || t.type !== "string") this.fail("Property brackets require literal text");
      this.need("]"); return t.text;
    }
    return this.fail("Expected a property name");
  }
  parse(): Node {
    const node = this.binary(1);
    if (this.at !== this.tokens.length) this.fail(`Unsupported expression near ${this.tokens[this.at].text}`);
    return node;
  }
  private binary(min: number): Node {
    let left = this.unary();
    while (true) {
      const token = this.tokens[this.at];
      const level = token?.type === "op" ? operators.get(token.text) : undefined;
      if (level === undefined || level < min) break;
      this.at++;
      left = { type: "binary", op: token.text, left, right: this.binary(level + 1) };
    }
    return left;
  }
  private unary(): Node {
    const t = this.tokens[this.at];
    if (t?.type === "op" && ["!", "-", "+"].includes(t.text)) {
      this.at++; return this.nested(() => ({ type: "unary", op: t.text, value: this.unary() }));
    }
    return this.postfix(this.primary());
  }
  private args(): Node[] {
    return this.nested(() => {
      this.need("("); const args: Node[] = [];
      if (!this.take(")")) { do { args.push(this.binary(1)); } while (this.take(",")); this.need(")"); }
      return args;
    });
  }
  private primary(): Node {
    if (this.take("(")) return this.nested(() => { const out = this.binary(1); this.need(")"); return out; });
    const token = this.tokens[this.at++];
    if (!token) this.fail("Expected an expression");
    if (token.type === "string") return { type: "literal", value: token.text };
    if (token.type === "number") {
      const value = Number(token.text);
      if (!Number.isFinite(value)) this.fail("Numeric literal is not finite");
      return { type: "literal", value };
    }
    if (token.type !== "id") this.fail("Expected an expression");
    const name = token.text;
    if (["true", "false", "null"].includes(name)) return { type: "literal", value: name === "null" ? null : name === "true" };
    if (this.tokens[this.at]?.text === "(") {
      const args = this.args(); validateCall(name, args.length); return { type: "call", name, args };
    }
    if (name === "file") return { type: "file", scope: "row" };
    let scope: Scope = "row", prefix = name;
    if (name === "this") {
      scope = "this";
      if (this.tokens[this.at]?.text !== "." && this.tokens[this.at]?.text !== "[") return { type: "file", scope };
      prefix = this.propertyName();
      if (prefix === "file") return { type: "file", scope };
    }
    if ((prefix === "note" || prefix === "formula") && [".", "["].includes(this.tokens[this.at]?.text)) return { type: "read", scope, key: `${prefix}.${this.propertyName()}` };
    return { type: "read", scope, key: prefix };
  }
  private postfix(node: Node): Node {
    while (this.take(".")) {
      const name = this.identifier();
      if (this.tokens[this.at]?.text === "(") {
        const args = this.args(); validateCall(name, args.length, true);
        node = { type: "method", base: node, name, args };
      } else if (node.type === "file") {
        if (!fileProperties.has(name)) this.fail(`Unsupported property: file.${name}`);
        node = { type: "read", scope: node.scope, key: `file.${name}` };
      } else {
        if (!valueProperties.has(name)) this.fail(`Unsupported property: ${name}`);
        node = { type: "member", base: node, key: name };
      }
    }
    return node;
  }
}
function evaluate(node: Node, c: Context, rt: Runtime): Value {
  rt.step();
  switch (node.type) {
    case "literal": return node.value;
    case "read": return checked((node.scope === "row" ? c : c.this)?.get(node.key));
    case "file": { const context = node.scope === "row" ? c : c.this; return context ? new FormulaFile(context) : null; }
    case "member": return member(evaluate(node.base, c, rt), node.key);
    case "method": return methodFunction(evaluate(node.base, c, rt), node.name, node.args.map(n => evaluate(n, c, rt)), c, rt);
    case "call": {
      if (node.name === "if") return evaluate(node.args[truthy(evaluate(node.args[0], c, rt)) ? 1 : 2], c, rt);
      return globalFunction(node.name, node.args.map(n => evaluate(n, c, rt)), c, rt);
    }
    case "unary": {
      const v = checked(evaluate(node.value, c, rt));
      if (node.op === "!") return !truthy(v);
      if (v === null) return null;
      if (typeof v !== "number") throw Error("Unary arithmetic requires a number");
      return node.op === "-" ? -v : v;
    }
    case "binary": {
      const a = checked(evaluate(node.left, c, rt));
      if (node.op === "&&") return truthy(a) && truthy(evaluate(node.right, c, rt));
      if (node.op === "||") return truthy(a) || truthy(evaluate(node.right, c, rt));
      const b = checked(evaluate(node.right, c, rt));
      if (node.op === "==" || node.op === "!=") { const equal = equalValues(a, b, rt); return node.op === "==" ? equal : !equal; }
      if (["+", "-", "*", "/", "%"].includes(node.op)) return arithmetic(node.op, a, b, rt);
      const order = compareValues(a, b);
      return order !== null && (node.op === ">" ? order > 0 : node.op === ">=" ? order >= 0 : node.op === "<" ? order < 0 : order <= 0);
    }
  }
}
function dependencies(node: Node, keys = new Set<string>()): Set<string> {
  const key = (scope: Scope, name: string) => keys.add(`${scope === "this" ? "this." : ""}${name}`);
  switch (node.type) {
    case "read": key(node.scope, node.key); break;
    case "file": key(node.scope, "file.path"); break;
    case "member": dependencies(node.base, keys); break;
    case "unary": dependencies(node.value, keys); break;
    case "binary": dependencies(node.left, keys); dependencies(node.right, keys); break;
    case "method":
      if (node.base.type === "file") {
        const fact = new Map([["hasTag", "tags"], ["hasLink", "links"], ["inFolder", "folder"], ["hasProperty", "properties"], ["asLink", "path"]]).get(node.name);
        key(node.base.scope, `file.${fact ?? "path"}`);
      } else dependencies(node.base, keys);
      node.args.forEach(n => dependencies(n, keys)); break;
    case "call": node.args.forEach(n => dependencies(n, keys)); break;
    case "literal": break;
  }
  return keys;
}
function failure(error: unknown, phase: "parse" | "evaluate"): FormulaError { return error instanceof FormulaError ? error : new FormulaError(error instanceof Error ? error.message : String(error), phase); }

/** Strict compiler for editors/filter validation. Parse errors throw; evaluation errors are values. */
export function expression(source: string): Expression {
  let node: Node;
  try { node = new Parser(tokenize(source), source.length).parse(); }
  catch (error) { throw failure(error, "parse"); }
  const read: Expression = context => {
    try { return checked(evaluate(node, context, runtime(context.now ? () => context.now!() : Date.now))); }
    catch (error) { return failure(error, "evaluate"); }
  };
  const keys = Object.freeze([...dependencies(node)]);
  return Object.assign(read, { dependencies: keys, usesThis: keys.some(key => key.startsWith("this.")) });
}
/** Formula-column compiler: keeps the parse error visible, including when the base has no rows. */
export function compileFormula(source: string): Expression {
  try { return expression(source); }
  catch (error) { const value = failure(error, "parse"); return Object.assign(() => value, { error: value, dependencies: Object.freeze([]), usesThis: false }); }
}
/** Filters must exclude error-valued rows instead of treating the error object as truthy. */
export function testExpression(compiled: Expression, context: Context): boolean {
  const value = compiled(context);
  return !isFormulaError(value) && truthy(value);
}

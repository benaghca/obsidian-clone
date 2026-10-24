import { expression } from "./expression";
import { mapping, type Yaml } from "./yaml";
export const conjunctions = { and: "All the following are true", or: "Any of the following are true", not: "None of the following are true" };
export type Conjunction = keyof typeof conjunctions;
export function group(filter: Yaml | undefined): { op: Conjunction; children: Yaml[] } {
  const entries = Object.entries(mapping(filter));
  if (entries.length === 1 && Object.hasOwn(conjunctions, entries[0][0]) && Array.isArray(entries[0][1])) return {op: entries[0][0] as Conjunction, children: entries[0][1]};
  return {op:"and",children:filter == null ? [] : [filter]};
}
export function changeFilter(filter: Yaml | undefined, path: number[], change: (value: Yaml | undefined) => Yaml): Yaml {
  if (!path.length) return change(filter);
  const {op,children}=group(filter), [at,...rest]=path;
  return {[op]:children.flatMap((child,i)=>i!==at?[child]:[changeFilter(child,rest,change)])};
}
export function isGroup(filter: Yaml | undefined): boolean {
  const entries=Object.entries(mapping(filter));
  return entries.length===1 && Object.hasOwn(conjunctions,entries[0][0]) && Array.isArray(entries[0][1]);
}
export const countFilters = (filter: Yaml | undefined): number => filter == null ? 0 : !isGroup(filter) ? 1 : group(filter).children.reduce<number>((sum, child) => sum + countFilters(child), 0);
export interface Comparison { property: string; operator: string; value: string }
export function comparison(source: string): Comparison | null {
  const match = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(source);
  const call = /^(file)\.(inFolder|hasTag|hasLink)\((.*)\)$/.exec(source) ?? /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\.(contains)\((.*)\)$/.exec(source);
  const result = match ? {property:match[1],operator:match[2],value:match[3]} : call ? {property:call[1],operator:call[2],value:call[3]} : null;
  if (!result) return null;
  // Only literal RHS values (or today()) can safely be edited as one value.
  if (!/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false|null|today\(\))$/.test(result.value)) return null;
  try { expression(source); return result; } catch { return null; }
}
export function filterExpression(row: Comparison): string {
  if (row.property === "file" && ["inFolder","hasTag","hasLink"].includes(row.operator)) return `file.${row.operator}(${row.value})`;
  if (["isEmpty","notEmpty"].includes(row.operator)) return `${row.property} ${row.operator === "isEmpty" ? "==" : "!="} null`;
  if (row.operator === "contains") return `${row.property}.contains(${row.value})`;
  return `${row.property} ${row.operator} ${row.value}`;
}
export function literal(text: string, type: string): string {
  if (text === "today()" && ["date","datetime"].includes(type)) return text;
  if (type === "number") { if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw Error("Enter a number"); return text; }
  if (type === "checkbox") { if (!["true","false"].includes(text)) throw Error("Enter true or false"); return text; }
  return JSON.stringify(text);
}

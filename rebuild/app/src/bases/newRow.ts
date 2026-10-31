import { Text } from "@codemirror/state";
import { addProperty, readFrontmatter, type Property, type PropertyType } from "../editor/frontmatter";
import { newNote } from "../fileOps";
import type { Workspace } from "../workspace";
import { comparison, group, isGroup } from "./filters";
import { noteKey } from "./model";
import type { Yaml } from "./yaml";
import type { Value } from "./functions";
import { inspectDocument, propertyMove } from "./move";
import { editProperty } from "../editor/propertyEdit";
// Bounded inference: positive file folder/tag calls and unambiguous literal equalities.
export function rowSeed(columns: string[], filters: (Yaml | undefined)[], types: Map<string,PropertyType>) {
  const inferred=new Map<string,PropertyType>();
  let folder="";const tags=new Set<string>(), values=new Map<string,Property["value"]>(), conflicts=new Set<string>();
  function visit(filter: Yaml | undefined) {
    if(typeof filter!=="string") {if(!isGroup(filter))return;const g=group(filter);if(g.op!=="not")g.children.forEach(visit);return;}
    const row=comparison(filter);if(!row)return;
    let value: string|number|boolean|null;
    try {value=JSON.parse(row.value);} catch {if(!row.value.startsWith("'"))return;value=row.value.slice(1,-1).replace(/\\(['\\])/g,"$1");}
    if(row.property==="file") {if(row.operator==="inFolder"&&typeof value==="string"&&!folder)folder=value;if(row.operator==="hasTag"&&typeof value==="string"&&value)tags.add(value.replace(/^#/,""));return;}
    if(row.operator!=="=="||/^(file|formula)\./.test(row.property)||value===null)return;
    const key=noteKey(row.property);inferred.set(key,typeof value==="number"?"number":typeof value==="boolean"?"checkbox":/^\d{4}-\d{2}-\d{2}/.test(value)?value.includes("T")?"datetime":"date":"text");const next=typeof value==="number"?String(value):value;
    if(values.has(key)&&values.get(key)!==next){conflicts.add(key);values.delete(key);}else if(!conflicts.has(key))values.set(key,next);
  }
  filters.forEach(visit);
  // Tags come first, as in native New row; all note columns follow in view order.
  const entries=new Map<string,Property["value"]>();if(tags.size)entries.set("tags",[...tags]);
  for(const column of columns)if(!/^(file|formula)\./.test(column)&&!entries.has(noteKey(column)))entries.set(noteKey(column),values.get(noteKey(column))??"");
  for(const [key,value]of values)if(!entries.has(key))entries.set(key,value);
  let doc=Text.empty;
  for(const [key,value]of entries){const edit=addProperty(readFrontmatter(doc),key,key==="tags"?"tags":types.get(key)??inferred.get(key)??"text",value);doc=doc.replace(edit.from,edit.to,Text.of(edit.insert.split("\n")));}
  return {folder:folder.replace(/^\/+|\/+$/g,""),text:doc.toString()};
}
let creating=Promise.resolve();
/** The column is the explicit seed, including lists and No value, after ordinary filter defaults. */
export function seedColumn(seed: ReturnType<typeof rowSeed>, key: string, value: Value, kind?: PropertyType) {
  const edit = propertyMove(key, inspectDocument(seed.text, key), value, kind), result = editProperty(seed.text, edit);
  if (result.status === "refused" || result.status === "conflict") throw Error("Column value cannot be used for a new note");
  if (result.status === "done" && result.change) return { ...seed, text: seed.text.slice(0, result.change.from) + result.change.insert + seed.text.slice(result.change.to) };
  return seed;
}
export function newRow(ws:Workspace, seed:ReturnType<typeof rowSeed>) {
  const next=creating.then(async()=>{
    const path=await newNote(ws,seed.folder,"tab");
    if(seed.text){ws.editors.change(path,{changes:{from:0,insert:seed.text},userEvent:"input.property"});await ws.saveNow(path);}
    if(ws.active.path===path){const title=document.querySelector<HTMLElement>('.workspace-tabs.mod-active .inline-title');if(title){title.classList.add("is-renaming");title.focus();getSelection()?.selectAllChildren(title);}}
    return path;
  });creating=next.then(()=>{},()=>{});return next;
}

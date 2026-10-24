import { api } from "../api";
import { TYPE_ICONS } from "../editor/propertyFields";
import type { PropertyType } from "../editor/frontmatter";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { closeMenu, SEPARATOR, showMenu, type MenuItems } from "../shell/menu";
import type { Workspace } from "../workspace";
import { baseModel, noteKey } from "./model";
import { writeView, type Sort } from "./write";
type Model = ReturnType<typeof baseModel>;
const same = (a: string, b: string) => noteKey(a) === noteKey(b);
const sortsOf = (base: Model): Sort[] => base.sorts.map(s => ({property:s.property,direction:s.direction === 1 ? "ASC" : "DESC"}));
export function baseMenus(ws: Workspace, path: string, current: () => Model, types: () => Map<string, PropertyType>, error: (e: unknown) => void, changed: () => Promise<void>) {
  let writing = Promise.resolve(), gone = false;
  const write = (key: "sort" | "order", change: (base: Model) => Sort[] | string[], done?: () => void) => {
    writing = writing.then(async () => {
      const source = await api.readNote(path), base = baseModel(source), next = writeView(source, key, change(base));
      if (next !== source) { await api.writeNote(path, next); ws.vault.written(path); }
      if (!gone) { await changed(); done?.(); }
    }).catch(error);
  };
  const keys = () => {
    const seen = new Set<string>();
    return [...current().columns, "file.name", "file.ctime", "file.ext", "file.folder", "file.mtime", "file.path", "file.size", "file.tags", ...types().keys(), ...current().formulaNames].filter(key => { const id = noteKey(key); if (seen.has(id)) return false; seen.add(id); return true; });
  };
  const kind = (key: string) => key.startsWith("formula.") ? "square-function" : key === "file.name" ? "info" : TYPE_ICONS[types().get(noteKey(key)) ?? (key === "file.size" ? "number" : /file\.[cm]time/.test(key) ? "datetime" : key === "file.tags" ? "tags" : "text")];
  const button = (name: string, glyph: IconName, run: () => void) => h("button", {type:"button","aria-label":name,onclick:(e:MouseEvent)=>{e.stopPropagation();run();}},icon(glyph),name);
  function sortMenu(at: HTMLElement, refresh = false) {
    const base = current();
    const items: MenuItems = [{title:"Sort by",label:true}];
    base.sorts.forEach((sort,i)=>{
      const direction=sort.direction===1?"ASC":"DESC", numeric=types().get(noteKey(sort.property))==="number";
      const property = button(base.label(sort.property),kind(sort.property),()=>{const r=property.getBoundingClientRect();showMenu(keys().map(key=>({title:base.label(key),icon:kind(key),action:()=>write("sort",b=>sortsOf(b).map((s,n)=>n===i?{...s,property:key}:s),()=>sortMenu(at,true))})),{x:r.x,y:r.bottom});});
      const toggle = button(numeric ? direction==="ASC"?"0 → 1":"1 → 0" : direction==="ASC"?"A → Z":"Z → A",direction==="ASC"?"chevron-up":"chevron-down",()=>write("sort",b=>sortsOf(b).map<Sort>((s,n)=>n===i?{...s,direction:s.direction==="ASC"?"DESC":"ASC"}:s),()=>sortMenu(at,true)));
      const remove = button("Remove sort","trash-2",()=>write("sort",b=>sortsOf(b).filter((_,n)=>n!==i),()=>sortMenu(at,true)));
      const row=h("div",{class:"bases-sort-row"},property,toggle,remove);
      items.push({title:`Sort ${sort.property}`,content:row});
    });
    items.push({title:"Add sort",icon:"plus",action:()=>showMenu(keys().filter(key=>!base.sorts.some(s=>same(s.property,key))).map(key=>({title:base.label(key),icon:kind(key),action:()=>write("sort",b=>[...sortsOf(b),{property:key,direction:"ASC"}],()=>sortMenu(at,true))})),at)});
    // A write completion rebuilds a menu at the same anchor; close first to avoid toggling it off.
    if(refresh)closeMenu();showMenu(items,at,{className:"bases-sort-menu",align:"right"});
  }
  function properties(at: HTMLElement, refresh = false) {
    const search=h("input",{type:"search",placeholder:"Find or create...","aria-label":"Find or create..."});
    const list=h("div",{class:"bases-property-list"});
    const draw=()=>list.replaceChildren(...keys().filter(key=>current().label(key).toLowerCase().includes(search.value.toLowerCase())).map(key=>{
      const check=h("input",{type:"checkbox","aria-label":current().label(key)});check.checked=current().columns.some(k=>same(k,key));
      const toggle=()=>write("order",b=>b.columns.some(k=>same(k,key))?b.columns.filter(k=>!same(k,key)):[...b.columns,key],draw);
      check.addEventListener("change",toggle);
      const row=h("label",{class:"bases-property-option",onmousedown:(e:MouseEvent)=>e.stopPropagation(),onclick:(e:MouseEvent)=>e.stopPropagation()},check,icon(kind(key)),h("span",null,current().label(key)),icon("chevron-right"));
      return row;
    }));
    search.addEventListener("input",draw);draw();
    const content=h("div",{class:"bases-properties-menu",onclick:(e:MouseEvent)=>e.stopPropagation()},search,list);
    if(refresh)closeMenu();showMenu([{title:"Properties",content},{title:"Add formula",icon:"plus",disabled:true},{title:"Hide all",action:()=>write("order",()=>[],()=>properties(at,true))}],at,{className:"bases-properties-popover",align:"right"});
    search.focus();
  }
  const hide=(key:string)=>write("order",b=>b.columns.filter(k=>!same(k,key)));
  function header(e: MouseEvent,key: string) {
    e.preventDefault();
    const sort=(direction:Sort["direction"])=>write("sort",b=>[{property:key,direction},...sortsOf(b).filter(s=>!same(s.property,key))]);
    showMenu([{title:"Hide column",action:()=>hide(key)},SEPARATOR,{title:"Sort A → Z",icon:"arrow-down-a-z",action:()=>sort("ASC")},{title:"Sort Z → A",icon:"arrow-up-z-a",action:()=>sort("DESC")},{title:"Clear sort",action:()=>write("sort",b=>sortsOf(b).filter(s=>!same(s.property,key)))}],{x:e.clientX,y:e.clientY});
  }
  let buttons: HTMLElement[] | null = null;
  function toolbar() {
    const base=current();
    if (buttons) {
      buttons[0].querySelector("span")!.textContent = base.name;
      buttons[1].querySelector("span")!.textContent = `${base.results} results`;
      const sort=buttons[2].querySelector("button")!;sort.classList.toggle("is-active",!!base.sorts.length);
      sort.querySelector(".bases-badge")?.remove();if(base.sorts.length)sort.append(h("span",{class:"bases-badge"},String(base.sorts.length)));
      return buttons;
    }
    const view=h("button",{type:"button",class:"bases-view-name","aria-label":"View"},icon("table"),h("span",null,base.name),icon("chevrons-up-down"));
    const count=h("button",{type:"button",class:"bases-count"},icon("text-align-start"),h("span",null,`${base.results} results`));
    const sort=button("Sort","arrow-up-narrow-wide",()=>sortMenu(sort));sort.classList.toggle("is-active",!!base.sorts.length);if(base.sorts.length)sort.append(h("span",{class:"bases-badge"},String(base.sorts.length)));
    const filter=button("Filter","list-filter",()=>{});filter.disabled=true;filter.classList.toggle("is-active",base.filtered);filter.title="Filter editing is held for Part B";
    const props=button("Properties","list",()=>properties(props));
    return buttons = [view,count,h("div",{class:"bases-toolbar-actions"},sort,filter,props)];
  }
  return {toolbar,header,dispose(){gone=true;}};
}

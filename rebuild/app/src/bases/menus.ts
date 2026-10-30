import { TYPE_ICONS } from "../editor/propertyFields";
import type { PropertyType } from "../editor/frontmatter";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { closeMenu, SEPARATOR, showMenu, type MenuItems } from "../shell/menu";
import type { Workspace } from "../workspace";
import { baseModel, noteKey, propertyId } from "./model";
import { addView, writeFilters, writeView, type Sort } from "./write";
import { filterMenu } from "./filterMenu";
import { drag, dropSlot, reordered } from "./drag";
import { resultsMenu } from "./results";
import { newRow, rowSeed } from "./newRow";
import type { Value } from "./expression";
import { mapping } from "./yaml";
import { configureView } from "./config";
import { writeViewSetting } from "./groups";
import { SUMMARY_NAMES, summaryFor } from "./summaries";
type Model = ReturnType<typeof baseModel>;
const same = (a: string, b: string) => noteKey(a) === noteKey(b);
const sortsOf = (base: Model): Sort[] => base.sorts.map(s => ({property:s.property,direction:s.direction === 1 ? "ASC" : "DESC"}));
/** Where a base's YAML is read from and written to: a .base file, or a ```base block in a note. */
export interface BaseFile { read(): Promise<string>; write(text: string): Promise<void> }
export function baseMenus(ws: Workspace, file: BaseFile, current: () => Model, types: () => Map<string, PropertyType>, error: (e: unknown) => void, changed: (index?: number) => Promise<void>, rows: () => Value[][]) {
  let writing = Promise.resolve(), gone = false;
  const save = (change: (source: string, base: Model) => string, done?: () => void, select?: (base: Model) => number) => {
    const index = current().viewIndex;
    writing = writing.then(async () => {
      const source = await file.read(), base = baseModel(source, index), next = change(source, base);
      if (next !== source) await file.write(next);
      if (!gone) { await changed(select?.(base)); done?.(); }
    }).catch(error);
  };
  const write = (key: "sort" | "order", change: (base: Model) => Sort[] | string[], done?: () => void) => save((source, base) => writeView(source, key, change(base), base.viewIndex), done);
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
      const direction=sort.direction===1?"ASC":"DESC", type=types().get(noteKey(sort.property))??(/file\.[cm]time/.test(sort.property)?"datetime":sort.property==="file.size"?"number":"text");
      const numeric=type==="number", date=["date","datetime"].includes(type);
      const label=(asc:boolean)=>date?asc?"Old to new":"New to old":numeric?asc?"0 → 1":"1 → 0":asc?"A → Z":"Z → A";
      const property = button(base.label(sort.property),sort.property==="file.name"?"text":kind(sort.property),()=>{const r=property.getBoundingClientRect();showMenu(keys().map(key=>({title:base.label(key),icon:key==="file.name"?"text":kind(key),action:()=>write("sort",b=>sortsOf(b).map((s,n)=>n===i?{...s,property:key}:s),()=>sortMenu(at,true))})),{x:r.x,y:r.bottom});});
      const toggle = button(label(direction==="ASC"),"chevrons-up-down",()=>showMenu((["ASC","DESC"] as const).map(d=>({title:label(d==="ASC"),checked:d===direction,action:()=>write("sort",b=>sortsOf(b).map((s,n)=>n===i?{...s,direction:d}:s),()=>sortMenu(at,true))})),toggle));
      const remove = button("Remove sort","trash-2",()=>write("sort",b=>sortsOf(b).filter((_,n)=>n!==i),()=>sortMenu(at,true)));
      property.append(icon("chevrons-up-down"));toggle.replaceChildren(h("span",null,label(direction==="ASC")),icon("chevrons-up-down"));remove.replaceChildren(icon("trash-2"));
      const grip=h("span",{class:"bases-sort-grip","aria-label":"Reorder sort"},icon("grip-vertical",16));
      const row=h("div",{class:"bases-sort-row"},grip,property,toggle,remove);
      grip.addEventListener("pointerdown",e=>{
        if(e.button!==0)return;let slot:number|null=null, moved=false;
        const rows=()=>[...document.querySelectorAll<HTMLElement>(".bases-sort-row")];
        const clear=()=>rows().forEach(row=>row.classList.remove("drop-before","drop-after"));
        drag(e,event=>{moved ||= Math.abs(event.clientY-e.clientY)>4;clear();slot=dropSlot(rows(),event.clientX,event.clientY,true);if(moved&&slot!==null){const list=rows();list[Math.min(slot,list.length-1)].classList.add(slot===list.length?"drop-after":"drop-before");}},(cancelled,event)=>{
          clear();if(event)slot=dropSlot(rows(),event.clientX,event.clientY,true);
          if(!cancelled&&moved&&slot!==null){const before=slot;write("sort",b=>reordered(sortsOf(b),b.sorts.findIndex(s=>same(s.property,sort.property)),before),()=>sortMenu(at,true));}
        });
      });
      items.push({title:`Sort ${sort.property}`,content:row});
    });
    items.push(SEPARATOR,{title:"Add sort",icon:"plus",action:()=>showMenu(keys().filter(key=>!base.sorts.some(s=>same(s.property,key))).map(key=>({title:base.label(key),icon:kind(key),action:()=>write("sort",b=>[...sortsOf(b),{property:key,direction:"ASC"}],()=>sortMenu(at,true))})),at)});
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
      const row=h("label",{class:`bases-property-option${check.checked?"":" is-unchecked"}`,onmousedown:(e:MouseEvent)=>e.stopPropagation(),onclick:(e:MouseEvent)=>e.stopPropagation()},check,icon(kind(key)),h("span",null,current().label(key)),icon("chevron-right"));
      return row;
    }));
    search.addEventListener("input",draw);draw();
    const content=h("div",{class:"bases-properties-menu",onclick:(e:MouseEvent)=>e.stopPropagation()},h("div",{class:"bases-search"},icon("search",14),search),list);
    if(refresh)closeMenu();showMenu([{title:"Properties",content},{title:"Add formula",icon:"plus",disabled:true},{title:"Hide all",icon:"eye-off",action:()=>write("order",()=>[],()=>properties(at,true))}],at,{className:"bases-properties-popover",align:"right"});
    search.focus();
  }
  const hide=(key:string)=>write("order",b=>b.columns.filter(k=>!same(k,key)));
  function header(e: MouseEvent,key: string) {
    e.preventDefault();
    const sort=(direction:Sort["direction"])=>write("sort",b=>[{property:key,direction},...sortsOf(b).filter(s=>!same(s.property,key))]);
    const group=(direction?: "ASC"|"DESC")=>save((source,b)=>writeViewSetting(source,"groupBy",direction?{property:propertyId(key),direction}:undefined,b.viewIndex));
    const summarize=(name?:string)=>save((source,b)=>{
      const choices={...mapping(b.view.summaries)};delete choices[key];delete choices[propertyId(key)];delete choices[noteKey(key)];
      if(name)choices[propertyId(key)]=name;
      return writeViewSetting(source,"summaries",Object.keys(choices).length?choices:undefined,b.viewIndex);
    });
    const activeGroup=!!current().groupBy&&same(current().groupBy!.property,key);
    const summaryItems=():MenuItems=>[
      {title:"None",checked:!summaryFor(current().summaryPlan,key),action:()=>summarize()},
      ...SUMMARY_NAMES.map(name=>({title:name,checked:summaryFor(current().summaryPlan,key)?.toLowerCase()===name.toLowerCase(),action:()=>summarize(name)})),
      current().summaryPlan.custom.size>0&&SEPARATOR,
      ...[...current().summaryPlan.custom.keys()].map(name=>({title:`Custom: ${name}`,checked:summaryFor(current().summaryPlan,key)===`custom.${name}`,action:()=>summarize(`custom.${name}`)})),
    ];
    showMenu([{title:"Hide column",icon:"eye-off",action:()=>hide(key)},{title:"Summarize...",icon:"sigma",submenu:summaryItems},{title:"Group by this property",icon:"group",checked:activeGroup,action:()=>group("ASC")},activeGroup&&{title:"Group A → Z",checked:current().groupBy!.direction==="ASC",action:()=>group("ASC")},activeGroup&&{title:"Group Z → A",checked:current().groupBy!.direction==="DESC",action:()=>group("DESC")},activeGroup&&{title:"Clear grouping",action:()=>group()},SEPARATOR,{title:"Sort A → Z",icon:"arrow-down-a-z",checked:current().sorts.some(s=>same(s.property,key)&&s.direction===1),action:()=>sort("ASC")},{title:"Sort Z → A",icon:"arrow-up-z-a",checked:current().sorts.some(s=>same(s.property,key)&&s.direction===-1),action:()=>sort("DESC")},current().sorts.some(s=>same(s.property,key)) && {title:"Clear sort",icon:"list-x",danger:true,action:()=>write("sort",b=>sortsOf(b).filter(s=>!same(s.property,key)))},SEPARATOR,{title:"Edit property...",icon:"pen-line",disabled:true},SEPARATOR,{title:"Property type",icon:"type",disabled:true}],{x:e.clientX,y:e.clientY});
  }
  function views(at: HTMLElement) {
    const configure=()=>configureView(at,current(),(key,value)=>save((source,b)=>writeView(source,key,value,b.viewIndex)),()=>draw(true));
    const search=h("input",{type:"search",placeholder:"Search...","aria-label":"Search views"});
    const content=h("div",{class:"bases-search",onclick:(e:MouseEvent)=>e.stopPropagation()},icon("search",14),search);
    const draw=(refresh=false)=>{
      const base=current();
      if(refresh)closeMenu();
      showMenu([{title:"Search views",content},...base.views.flatMap((v,i)=>{
        const title=typeof mapping(v).name==="string"?String(mapping(v).name):"View";
        if(!title.toLowerCase().includes(search.value.toLowerCase()))return [];
        const viewType = mapping(v).type;
        return [{title,content:h("div",{class:`bases-view-option${i===base.viewIndex?" is-current-view":""}`},icon(viewType === "cards" ? "grid-2x2" : "table",14),h("span",{class:"menu-item-title"},title),h("button",{class:"bases-view-options",type:"button","aria-label":"Configure view",onclick:(e:MouseEvent)=>{e.stopPropagation();if(i===current().viewIndex)configure();else void changed(i).then(configure);}},icon("chevron-right",14))),disabled:viewType!=null&&viewType!=="table"&&viewType!=="cards",action:()=>void changed(i)}];
      }),SEPARATOR,{title:"Add view",icon:"plus",action:()=>{
        save((source,b)=>{
          const names=new Set(b.views.map(v=>mapping(v).name));let n=0;while(names.has(n?`View ${n}`:"View"))n++;
          return addView(source,n?`View ${n}`:"View");
        },configure,b=>b.views.length);
      }}],at,{className:"bases-view-menu"});search.focus();
    };
    search.addEventListener("input",()=>draw(true));draw();
  }
  function filters(at: HTMLElement) {
    filterMenu({filters:local=>local?current().view.filters:current().root.filters,
      write:(local,change,done)=>save((source,b)=>writeFilters(source,change(local?b.view.filters:b.root.filters),local?b.viewIndex:undefined),done),
      keys,label:key=>current().label(key),kind,type:key=>types().get(noteKey(key))??(key==="file.size"?"number":"text")},at);
  }
  const baseLimit=()=>{const value=current().view.limit;return typeof value==="number"?value:undefined;};
  let buttons: HTMLElement[] | null = null;
  function toolbar() {
    const base=current();
    if (buttons) {
      buttons[0].querySelector("span")!.textContent = base.name;
      buttons[1].querySelector("span")!.textContent = `${base.results} results`;
      const sort=buttons[2].querySelector("button")!;sort.classList.toggle("is-active",!!base.sorts.length);
      sort.querySelector(".bases-badge")?.remove();if(base.sorts.length)sort.append(h("span",{class:"bases-badge"},String(base.sorts.length)));
      buttons[2].querySelector('[aria-label="Filter"]')!.classList.toggle("is-active",base.filtered);
      return buttons;
    }
    const view=h("button",{type:"button",class:"bases-view-name","aria-label":"View",onclick:()=>views(view)},icon(base.type === "cards" ? "grid-2x2" : "table"),h("span",null,base.name),icon("chevrons-up-down"));
    const count=h("button",{type:"button",class:"bases-count","aria-label":"Results",onclick:()=>resultsMenu(count,baseLimit(),current().total,current().columns.map(current().label),rows(),value=>save((source,b)=>writeView(source,"limit",value,b.viewIndex)))},icon("text-align-start"),h("span",null,`${base.results} results`));
    const sort=button("Sort","arrow-up-narrow-wide",()=>sortMenu(sort));sort.classList.toggle("is-active",!!base.sorts.length);if(base.sorts.length)sort.append(h("span",{class:"bases-badge"},String(base.sorts.length)));
    const filter=button("Filter","list-filter",()=>filters(filter));filter.classList.toggle("is-active",base.filtered);
    const props=button("Properties","list",()=>properties(props));
    const create=button("New","plus",()=>void newRow(ws,rowSeed(current().columns,[current().root.filters,current().view.filters],types())).catch(error));
    return buttons = [view,count,h("div",{class:"bases-toolbar-actions"},sort,filter,props,create)];
  }
  const size=(key:string,width?:number)=>save((source,b)=>{
    const sizes={...b.sizes}, id=propertyId(key);delete sizes[key];delete sizes[id];
    if(width!==undefined)sizes[id]=Math.max(40,width);
    return writeView(source,"columnSize",Object.keys(sizes).length?sizes:undefined,b.viewIndex);
  });
  return {toolbar,header,size,order:(change:(keys:string[])=>string[])=>write("order",b=>change(b.columns)),dispose(){gone=true;}};
}

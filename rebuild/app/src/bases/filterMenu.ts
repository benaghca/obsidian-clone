import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { closeMenu, showMenu, showMenuChild } from "../shell/menu";
import { menuInputEscape } from "./menuInput";
import { expression } from "./expression";
import { changeFilter, comparison, conjunctions, countFilters, filterExpression, group, isGroup, literal, type Comparison } from "./filters";
import type { Yaml } from "./yaml";
interface Host {
  filters(local: boolean): Yaml | undefined;
  write(local: boolean, change: (value: Yaml | undefined) => Yaml, done: () => void): void;
  keys(): string[]; label(key: string): string; kind(key: string): IconName; type(key: string): string;
}
export function filterMenu(host: Host, at: HTMLElement) {
  const expanded = new Set<boolean>([countFilters(host.filters(true)) ? true : false]);
  const drafts=new Map<string,{local:boolean;path:number[];row:Comparison}>();let serial=0;
  const advanced = new Set<string>();
  const button = (name: string, glyph: IconName, run: () => void) => h("button", {type:"button","aria-label":name,onclick:run},icon(glyph),h("span",null,name));
  function draw(refresh = false) {
    const content = h("div",{class:"bases-filter-editor",onclick:(e:MouseEvent)=>e.stopPropagation()});
    for (const local of [false,true]) {
      const section = h("section",{"data-scope":local?"view":"all"});
      const heading = button(local?"This view":"All views",expanded.has(local)?"chevron-down":"chevron-right",()=>{expanded.has(local)?expanded.delete(local):expanded.add(local);draw(true);});
      heading.className="bases-filter-heading";heading.append(h("span",{class:"bases-badge"},String(countFilters(host.filters(local)))));section.append(heading);
      const change = (path: number[], update: (v: Yaml | undefined) => Yaml, reopen = true) => host.write(local, value => changeFilter(value,path,update),()=>{if(reopen || at.classList.contains("has-active-menu"))draw(true);});
      const pick = (target: HTMLElement, choices: [string,string][], selected: string, choose: (value: string) => void) => {
        showMenu(choices.map(([value,title])=>({title,checked:value===selected,action:()=>choose(value)})),target);
      };
      const propertyPicker=(target:HTMLElement, selected:string, choose:(key:string)=>void)=>{
        const search=h("input",{type:"search",placeholder:"Search...","aria-label":"Filter property search"});
        const box=h("div",{class:"bases-search",onclick:(e:MouseEvent)=>e.stopPropagation()},icon("search",14),search);
        const keys=["file",...host.keys().filter(key=>key.startsWith("file.")),...host.keys().filter(key=>!key.startsWith("file."))].filter((key,i,all)=>all.indexOf(key)===i&&/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(key));
        const show=()=>{showMenuChild([{title:"Search properties",content:box},...keys.filter(key=>host.label(key).toLowerCase().includes(search.value.toLowerCase())).map(key=>({title:host.label(key),icon:host.kind(key),hotkey:key==="file"?undefined:key,checked:key===selected,action:()=>choose(key)}))],target,"bases-filter-picker");search.focus();};
        search.addEventListener("input",()=>show());show();
      };
      function render(value: Yaml | undefined, path: number[], depth = 0): HTMLElement {
        const {op,children}=group(value), box=h("div",{class:"bases-filter-group","data-depth":String(depth)});
        const conjunction=button(conjunctions[op],"chevrons-up-down",()=>pick(conjunction,Object.entries(conjunctions),op,next=>change(path,v=>({[next]:group(v).children}))));
        conjunction.className="bases-filter-conjunction";box.append(conjunction);
        if(path.length) box.append(button("Remove filter group","trash-2",()=>remove(path)));
        const pending=[...drafts.entries()].filter(([,d])=>d.local===local&&d.path.join(".")===path.join("."));
        const entries=children.map((child,i)=>({child,i,draftId:""})).concat(pending.map(([draftId,d],n)=>({child:filterExpression(d.row) as Yaml,i:children.length+n,draftId})));
        entries.forEach(({child,i,draftId})=>{
          const childPath=[...path,i];
          if(typeof child!=="string") {
            if(isGroup(child) || child == null) box.append(render(child,childPath,depth+1));
            else box.append(h("div",{class:"bases-filter-row"},"Unsupported filter",button("Remove filter","trash-2",()=>remove(childPath))));
            return;
          }
          const row=h("div",{class:"bases-filter-row"},h("span",{class:"bases-filter-where"},i?op==="not"?"nor":op:"where"));
          const id=draftId||`${local}:${childPath.join(".")}`, parsed=draftId?drafts.get(draftId)!.row:comparison(child);
          let committed=false;
          const save=(text:string)=>{if(committed)return;try{expression(text);committed=true;
            if(draftId){drafts.delete(draftId);change(path,v=>{const g=group(v);return{[g.op]:[...g.children,text]};});}
            else change(childPath,()=>text,false);}catch(e){inputError(text,e);}};
          let input: HTMLInputElement;
          const inputError=(_text:string,e:unknown)=>{input.setCustomValidity(e instanceof Error?e.message:String(e));input.reportValidity();};
          if(!parsed || advanced.has(id)) {
            input=h("input",{type:"text","aria-label":"Filter expression",value:child});row.append(input);
            const commit=()=>{if(input.value!==child)save(input.value);};
            input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();commit();}else if(e.key==="Escape")input.value=child;});input.addEventListener("blur",commit);
          } else {
            const type=host.type(parsed.property), numeric=type==="number", bool=type==="checkbox";
            const replace=(next:Comparison)=>{
              if(draftId){drafts.get(draftId)!.row=next;if(["isEmpty","notEmpty"].includes(next.operator))save(filterExpression(next));else draw(true);}
              else change(childPath,()=>filterExpression(next));
            };
            const property=button(host.label(parsed.property),host.kind(parsed.property),()=>propertyPicker(property,parsed.property,key=>replace({property:key,operator:key==="file"?"hasLink":"==",value:draftId?'""':host.type(key)==="number"?"0":host.type(key)==="checkbox"?"true":'""'})));
            if(draftId)property.dataset.draft=draftId;
            const ops=parsed.property==="file"?[['inFolder','in folder'],['hasTag','has tag'],['hasLink','has link']]:[["==","is"],["!=","is not"],["isEmpty","is empty"],["notEmpty","is not empty"],...(!bool?[[">",">"],[">=","≥"],["<","<"],["<=","≤"]]:[]),...(!numeric&&!bool?[["contains","contains"]]:[])];
            const operator=button(ops.find(o=>o[0]===parsed.operator)?.[1]??parsed.operator,"chevrons-up-down",()=>pick(operator,ops as [string,string][],parsed.operator,operator=>replace({...parsed,operator})));
            let display=parsed.value;
            if(display.startsWith('"'))display=JSON.parse(display);else if(display.startsWith("'"))display=display.slice(1,-1).replace(/\\(['\\])/g,"$1");
            input=h("input",{type:numeric?"number":"text","aria-label":"Filter value",value:display,placeholder:"Empty"});
            const commit=()=>{if(input.value===display || draftId && !input.value)return;try{const text=filterExpression({...parsed,value:literal(input.value,type)});if(text!==child)save(text);}catch(e){inputError(input.value,e);}};
            input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();commit();}else if(e.key==="Escape")input.value=display;});input.addEventListener("blur",()=>{if(input.value!==display)commit();});
            row.append(property,operator);
            if(!["isEmpty","notEmpty"].includes(parsed.operator))row.append(input);
            if(parsed.property==="file" && parsed.operator==="hasTag" && display){const clear=button("Clear value","x",()=>{input.value="";input.focus();});clear.className="bases-filter-icon";row.append(clear);}
          }
          input.addEventListener("input",()=>input.setCustomValidity(""));
          const code=button("Advanced filter","code-xml",()=>{advanced.has(id)?advanced.delete(id):advanced.add(id);draw(true);});code.className="bases-filter-icon";
          const trash=button("Remove filter","trash-2",()=>{if(draftId){drafts.delete(draftId);draw(true);}else remove(childPath);});trash.className="bases-filter-icon";
          row.append(code,trash);box.append(row);
        });
        const actions=h("div",{class:"bases-filter-add"},button("Add filter","plus",()=>{
          const draft=`draft-${++serial}`;drafts.set(draft,{local,path,row:{property:"file",operator:"hasLink",value:'""'}});draw(true);
          const target=document.querySelector<HTMLElement>(`[data-draft="${draft}"]`);
          if(target)propertyPicker(target,"file",key=>{drafts.get(draft)!.row={property:key,operator:key==="file"?"hasLink":"==",value:'""'};draw(true);});
        }),button("Add filter group","plus",()=>change(path,v=>{const g=group(v);return{[g.op]:[...g.children,{and:[]}]};})));
        box.append(actions);return box;
      }
      function remove(path:number[]) {const at=path.at(-1)!;change(path.slice(0,-1),v=>{const g=group(v);return{[g.op]:g.children.filter((_,i)=>i!==at)};});}
      if(expanded.has(local))section.append(render(host.filters(local),[]));
      content.append(section);
    }
    const cleanup=menuInputEscape(content);
    if(refresh)closeMenu();showMenu([{title:"Filter",content}],at,{className:"bases-filter-menu",align:"right"});
    if(!content.isConnected)cleanup();
  }
  draw();
}

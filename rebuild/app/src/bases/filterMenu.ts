import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { closeMenu, showMenu } from "../shell/menu";
import { expression } from "./expression";
import { changeFilter, comparison, conjunctions, countFilters, filterExpression, group, isGroup, literal } from "./filters";
import type { Yaml } from "./yaml";
interface Host {
  filters(local: boolean): Yaml | undefined;
  write(local: boolean, change: (value: Yaml | undefined) => Yaml, done: () => void): void;
  keys(): string[]; label(key: string): string; kind(key: string): IconName; type(key: string): string;
}
export function filterMenu(host: Host, at: HTMLElement) {
  const expanded = new Set<boolean>([countFilters(host.filters(true)) ? true : false]);
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
      function render(value: Yaml | undefined, path: number[], depth = 0): HTMLElement {
        const {op,children}=group(value), box=h("div",{class:"bases-filter-group","data-depth":String(depth)});
        const conjunction=button(conjunctions[op],"chevrons-up-down",()=>pick(conjunction,Object.entries(conjunctions),op,next=>change(path,v=>({[next]:group(v).children}))));
        conjunction.className="bases-filter-conjunction";box.append(conjunction);
        if(path.length) box.append(button("Remove filter group","trash-2",()=>remove(path)));
        children.forEach((child,i)=>{
          const childPath=[...path,i];
          if(typeof child!=="string") {
            if(isGroup(child) || child == null) box.append(render(child,childPath,depth+1));
            else box.append(h("div",{class:"bases-filter-row"},"Unsupported filter",button("Remove filter","trash-2",()=>remove(childPath))));
            return;
          }
          const row=h("div",{class:"bases-filter-row"},h("span",{class:"bases-filter-where"},i?op==="not"?"nor":op:"where"));
          const id=`${local}:${childPath.join(".")}`, parsed=comparison(child);
          let committed=false;
          const save=(text:string)=>{if(committed)return;try{expression(text);committed=true;change(childPath,()=>text,false);}catch(e){inputError(text,e);}};
          let input: HTMLInputElement;
          const inputError=(_text:string,e:unknown)=>{input.setCustomValidity(e instanceof Error?e.message:String(e));input.reportValidity();};
          if(!parsed || advanced.has(id)) {
            input=h("input",{type:"text","aria-label":"Filter expression",value:child});row.append(input);
            const commit=()=>{if(input.value!==child)save(input.value);};
            input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();commit();}else if(e.key==="Escape")input.value=child;});input.addEventListener("blur",commit);
          } else {
            const type=host.type(parsed.property), numeric=type==="number", bool=type==="checkbox";
            const property=button(host.label(parsed.property),host.kind(parsed.property),()=>pick(property,[["file","file"],...host.keys().filter(key=>/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(key)).map(key=>[key,host.label(key)] as [string,string])],parsed.property,key=>change(childPath,()=>filterExpression({property:key,operator:key==="file"?"inFolder":"==",value:host.type(key)==="number"?"0":host.type(key)==="checkbox"?"true":'""'}))));
            const ops=parsed.property==="file"?[['inFolder','in folder'],['hasTag','has tag'],['hasLink','has link']]:[["==","is"],["!=","is not"],...(!bool?[[">",">"],[">=","≥"],["<","<"],["<=","≤"]]:[]),...(!numeric&&!bool?[["contains","contains"]]:[])];
            const operator=button(ops.find(o=>o[0]===parsed.operator)?.[1]??parsed.operator,"chevrons-up-down",()=>pick(operator,ops as [string,string][],parsed.operator,operator=>change(childPath,()=>filterExpression({...parsed,operator}))));
            let display=parsed.value;
            if(display.startsWith('"'))display=JSON.parse(display);else if(display.startsWith("'"))display=display.slice(1,-1).replace(/\\(['\\])/g,"$1");
            input=h("input",{type:numeric?"number":"text","aria-label":"Filter value",value:display,placeholder:"Empty"});
            const commit=()=>{if(input.value===display)return;try{const text=filterExpression({...parsed,value:literal(input.value,type)});if(text!==child)save(text);}catch(e){inputError(input.value,e);}};
            input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();commit();}else if(e.key==="Escape")input.value=display;});input.addEventListener("blur",()=>{if(input.value!==display)commit();});
            row.append(property,operator,input);
          }
          input.addEventListener("input",()=>input.setCustomValidity(""));
          const code=button("Advanced filter","code-xml",()=>{advanced.has(id)?advanced.delete(id):advanced.add(id);draw(true);});code.className="bases-filter-icon";
          const trash=button("Remove filter","trash-2",()=>remove(childPath));trash.className="bases-filter-icon";
          row.append(code,trash);box.append(row);
        });
        const actions=h("div",{class:"bases-filter-add"},button("Add filter","plus",()=>change(path,v=>{const g=group(v);return{[g.op]:[...g.children,'file.name == ""']};})),button("Add filter group","plus",()=>change(path,v=>{const g=group(v);return{[g.op]:[...g.children,{and:[]}]};})));
        box.append(actions);return box;
      }
      function remove(path:number[]) {const at=path.at(-1)!;change(path.slice(0,-1),v=>{const g=group(v);return{[g.op]:g.children.filter((_,i)=>i!==at)};});}
      if(expanded.has(local))section.append(render(host.filters(local),[]));
      content.append(section);
    }
    // Cancel before the shared menu closes and blurs its input on Escape.
    const cancel=(e:KeyboardEvent)=>{if(e.key==="Escape" && e.target instanceof HTMLInputElement && content.contains(e.target))e.target.value=e.target.defaultValue;};
    window.addEventListener("keydown",cancel,true);
    const cleanup=()=>{window.removeEventListener("keydown",cancel,true);observer.disconnect();};
    const observer=new MutationObserver(()=>{if(!content.isConnected)cleanup();});
    observer.observe(document.body,{childList:true});
    if(refresh)closeMenu();showMenu([{title:"Filter",content}],at,{className:"bases-filter-menu",align:"right"});
    if(!content.isConnected)cleanup();
  }
  draw();
}

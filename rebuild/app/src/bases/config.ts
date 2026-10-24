import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { closeMenu, showMenu } from "../shell/menu";
import type { baseModel } from "./model";
export function configureView(at:HTMLElement, base:ReturnType<typeof baseModel>, write:(key:"name"|"rowHeight",value:string|undefined)=>void, back:()=>void) {
  const button=(label:string,glyph:IconName,action:()=>void)=>h("button",{type:"button","aria-label":label,onclick:action},icon(glyph,14));
  const name=h("input",{type:"text",value:base.name,"aria-label":"View name"});
  let previous=base.name;const commit=()=>{if(name.value!==previous){previous=name.value;write("name",previous);}};
  name.addEventListener("input",commit);name.addEventListener("blur",commit);
  const layout=h("select",{"aria-label":"Layout"},h("option",{value:"table"},"Table"));
  const height=h("select",{"aria-label":"Row height"},...[["","Short"],["medium","Medium"],["tall","Tall"],["extra","Extra tall"]].map(([value,label])=>h("option",{value},label)));
  height.value=String(base.view.rowHeight??"");height.addEventListener("change",()=>write("rowHeight",height.value||undefined));
  const more=button("View options","ellipsis-vertical",()=>{});more.setAttribute("aria-disabled","true");
  const header=h("div",{class:"bases-config-header"},button("Back","chevron-left",back),h("span",null,"Configure view"),more,button("Close","x",closeMenu));
  const content=h("div",{class:"bases-config",onclick:(e:MouseEvent)=>e.stopPropagation()},header,name,h("label",null,"Layout",layout),h("label",null,"Row height",height));
  closeMenu();showMenu([{title:"Configure view",content}],at,{className:"bases-config-menu"});name.focus();name.select();
}

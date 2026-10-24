import { h } from "../shell/dom";
import { closeMenu, showMenu, SEPARATOR } from "../shell/menu";
import { menuInputEscape } from "./menuInput";
import { writeClipboard } from "../editor/clipboard";
import type { Value } from "./expression";
export function tableTsv(headers:string[],rows:Value[][]) {
  const cell=(value:Value)=>{const text=Array.isArray(value)?value.join(", "):String(value??"");return /[\t\r\n"]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};
  return [headers,...rows].map(row=>row.map(cell).join("\t")).join("\n");
}
export function resultsMenu(at:HTMLElement, limit:number|undefined, total:number, headers:string[], rows:Value[][], write:(value:number|undefined)=>void) {
  const input=h("input",{type:"number",min:"0",step:"1",placeholder:"e.g. 10","aria-label":"Limit number of results",value:limit===undefined?"":String(limit)});
  let committed=false;
  const commit=()=>{const value=input.value===""?undefined:Number(input.value);if(input.validity.badInput||value!==undefined&&(!Number.isInteger(value)||value<0)){input.setCustomValidity("Enter a non-negative whole number");input.reportValidity();return false;}if(!committed&&value!==limit){committed=true;write(value);}return true;};
  input.addEventListener("input",()=>input.setCustomValidity(""));input.addEventListener("blur",commit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(commit())closeMenu();}});
  const content=h("div",{class:"bases-results-limit",onclick:(e:MouseEvent)=>e.stopPropagation()},h("span",null,"Limit number of results"),input);
  const cleanup=menuInputEscape(content);
  showMenu([{title:"Limit number of results",content},limit!==undefined&&limit<total&&{title:`Show all (${total})`,icon:"rotate-ccw",action:()=>write(undefined)},SEPARATOR,{title:"Copy to clipboard",icon:"copy",action:()=>{
    writeClipboard(tableTsv(headers,rows));const notice=h("div",{class:"bases-copy-notice",role:"status"},"Copied to your clipboard");document.body.append(notice);setTimeout(()=>notice.remove(),2500);
  }}],at,{className:"bases-results-menu"});
  if(!content.isConnected)cleanup();
}

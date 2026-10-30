import { h } from "../shell/dom";
import { closeMenu, showMenu, SEPARATOR } from "../shell/menu";
import { menuInputEscape } from "./menuInput";
import { writeClipboard } from "../editor/clipboard";
import type { Value } from "./expression";
import { baseNotice } from "./notice";

function cellText(value: Value): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}
function quoted(text: string, special: RegExp): string {
  return special.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function tableTsv(headers: string[], rows: Value[][]) {
  return [headers, ...rows].map(row => row.map(value => quoted(cellText(value), /[\t\r\n"]/)).join("\t")).join("\n");
}
/** Same cell text as the TSV copy. A field is quoted when it contains a comma, a quote, or a line break. */
export function tableCsv(headers: string[], rows: Value[][]) {
  return [headers, ...rows].map(row => row.map(value => quoted(cellText(value), /[",\r\n]/)).join(",")).join("\n");
}
/** One download name. The view title is kept. Separators and control characters become spaces. */
export function csvFilename(name: string | null | undefined): string {
  const cleaned = (name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/\.csv$/i, "");
  return `${cleaned || "Results"}.csv`;
}
export function csvExport(headers: string[], rows: Value[][], name: string | null | undefined) {
  return { title: "Export CSV...", icon: "file-down" as const, filename: csvFilename(name), text: tableCsv(headers, rows) };
}
function downloadCsv(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function resultsMenu(at:HTMLElement, limit:number|undefined, total:number, headers:string[], rows:Value[][], write:(value:number|undefined)=>void) {
  const input=h("input",{type:"number",min:"0",step:"1",placeholder:"e.g. 10","aria-label":"Limit number of results",value:limit===undefined?"":String(limit)});
  let committed=false;
  const commit=()=>{const value=input.value===""?undefined:Number(input.value);if(input.validity.badInput||value!==undefined&&(!Number.isInteger(value)||value<0)){input.setCustomValidity("Enter a non-negative whole number");input.reportValidity();return false;}if(!committed&&value!==limit){committed=true;write(value);}return true;};
  input.addEventListener("input",()=>input.setCustomValidity(""));input.addEventListener("blur",commit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(commit())closeMenu();}});
  const content=h("div",{class:"bases-results-limit",onclick:(e:MouseEvent)=>e.stopPropagation()},h("span",null,"Limit number of results"),input);
  const cleanup=menuInputEscape(content);
  const exported = csvExport(headers, rows, at.closest(".bases-toolbar")?.querySelector(".bases-view-name span")?.textContent);
  showMenu([{title:"Limit number of results",content},SEPARATOR,limit!==undefined&&limit<total&&{title:`Show all (${total})`,icon:"rotate-ccw",action:()=>write(undefined)},{title:"Copy to clipboard",icon:"copy",action:()=>{
    writeClipboard(tableTsv(headers,rows));baseNotice("Copied to your clipboard");
  }},{title:exported.title,icon:exported.icon,action:()=>downloadCsv(exported.text,exported.filename)}],at,{className:"bases-results-menu"});
  if(!content.isConnected)cleanup();
}

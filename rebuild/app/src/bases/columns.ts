import { h } from "../shell/dom";
import { drag, dropSlot, reordered } from "./drag";

/** Body cell padding, 8px on each side. Header chrome (icon and gap) is the +34 below. */
const CELL_PAD = 16;
/** Upper bound on one glyph, in px. The table font is 13.125px; this stays above it so a wide glyph is never skipped. */
const CELL_ADVANCE = 32;

/** One rendered cell. A fit passes these; opening a base does not. */
export interface ColumnSample {
  kind: string;
  text?: string;
  pills?: readonly string[];
}

export interface ColumnWidthInput {
  key: string;
  label: string;
  sorted: boolean;
  type: string;
  /** Tag, list and alias pills. Measured for the automatic width. */
  pills?: readonly (readonly string[])[];
  /** Plain cell strings. The automatic width stays header-sized when this is omitted. */
  text?: readonly string[];
  /** Per-cell kind and displayed value. Widens a fit past the column-type rule. */
  samples?: readonly ColumnSample[];
}

const listKind = (kind: string) => kind === "tags" || kind === "list" || kind === "aliases";

/** Identical rows share one measurement. The longest string is measured first so shorter ones can be skipped. */
function measureTexts(width: number, texts: readonly string[], textWidth: (text: string) => number): number {
  let longest = "";
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
    if (text.length > longest.length) longest = text;
  }
  const apply = (text: string) => {
    if (text.length * CELL_ADVANCE + CELL_PAD <= width) return;
    width = Math.max(width, Math.ceil(textWidth(text) + CELL_PAD));
  };
  if (longest) apply(longest);
  for (const text of unique) if (text !== longest) apply(text);
  return width;
}

function measurePills(width: number, rows: readonly (readonly string[])[], textWidth: (text: string) => number): number {
  const seen = new Set<string>();
  for (const pills of rows) {
    const id = JSON.stringify(pills);
    if (seen.has(id)) continue;
    seen.add(id);
    let bound = 16;
    for (const item of pills) bound += item.length * CELL_ADVANCE + 44;
    if (bound <= width) continue;
    width = Math.max(width, Math.ceil(pills.reduce((sum, item) => sum + textWidth(item) + 44, 16)));
  }
  return width;
}

/**
 * Column width in px. Header, fixed date and pill rules are the table's
 * automatic width. `samples` widens a fit to what each cell draws. The drag
 * floor is 40; file name stays at least 78 and every other column at least 60.
 */
export function columnWidth(textWidth: (text: string) => number, column: ColumnWidthInput): number {
  let width = Math.max(column.key === "file.name" ? 78 : 60, Math.ceil(textWidth(column.label) + 34 + (column.sorted ? 16 : 0)));
  if (!column.samples) {
    if (column.type === "date" || column.type === "datetime") return column.type === "date" ? 128 : 210;
    if (listKind(column.type)) return Math.max(40, measurePills(width, column.pills ?? [], textWidth));
    if (column.type !== "checkbox" && column.text) width = measureTexts(width, column.text, textWidth);
    return Math.max(40, width);
  }
  if (column.type === "date") width = 128;
  else if (column.type === "datetime") width = 210;
  else if (listKind(column.type)) width = measurePills(width, column.pills ?? [], textWidth);
  const texts: string[] = [];
  const pills: string[][] = [];
  for (const sample of column.samples) {
    if (sample.kind === "date") { width = Math.max(width, 128); continue; }
    if (sample.kind === "datetime") { width = Math.max(width, 210); continue; }
    if (sample.kind === "checkbox") continue;
    if (sample.pills) pills.push(sample.pills as string[]);
    else if (sample.text) texts.push(sample.text);
  }
  width = measurePills(width, pills, textWidth);
  width = measureTexts(width, texts, textWidth);
  return Math.max(40, width);
}

export function columnControls(head: HTMLElement, applySize: (key?: string, width?: number) => void, size: (key: string, width?: number) => void, order: (change: (keys: string[]) => string[]) => void, finished: () => void) {
  let active=false, cancel: (()=>void) | undefined;
  const line=h("div",{class:"bases-column-drop"});
  function attach(th: HTMLElement, key: string) {
    const handle=h("div",{class:"bases-resizer","aria-label":`Resize ${key}`});th.append(handle);
    handle.addEventListener("dblclick",e=>{e.preventDefault();e.stopPropagation();size(key);});
    th.addEventListener("pointerdown",e=>{
      if(e.button!==0||active)return;
      const resize=(e.target as Element).closest(".bases-resizer"), x=e.clientX, y=e.clientY, width=th.getBoundingClientRect().width;
      let moved=false, value=width, slot:number|null=null;
      const headers=()=>[...head.querySelectorAll<HTMLElement>("th")];
      active=true;
      if(resize)th.classList.add("is-resizing");
      cancel=drag(e,event=>{
        moved ||= Math.hypot(event.clientX-x,event.clientY-y)>4;
        if(resize){value=Math.max(40,width+event.clientX-x);applySize(key,value);return;}
        if(!moved)return;
        slot=dropSlot(headers(),event.clientX,event.clientY);
        if(slot===null){line.remove();return;}
        const cells=headers(), target=cells[Math.min(slot,cells.length-1)].getBoundingClientRect();
        line.style.cssText=`left:${slot===cells.length?target.right:target.left}px;top:${target.top}px;height:${target.height}px`;document.body.append(line);
      },(cancelled,event)=>{
        active=false;cancel=undefined;line.remove();th.classList.remove("is-resizing");
        if(moved)th.addEventListener("click",event=>event.stopImmediatePropagation(),{once:true,capture:true});
        if(resize){applySize();if(!cancelled&&moved&&value!==width)size(key,value);}
        else if(!cancelled&&moved&&event){slot=dropSlot(headers(),event.clientX,event.clientY);if(slot!==null){const before=slot;order(keys=>reordered(keys,keys.indexOf(key),before));}}
        finished();
      });
    });
  }
  return {attach,get active(){return active;},dispose(){cancel?.();line.remove();}};
}

import { h } from "../shell/dom";
import { drag, dropSlot, reordered } from "./drag";

/** Body cell padding, 8px on each side. Header chrome (icon and gap) is the +34 below. */
const CELL_PAD = 16;
/** Upper bound on one glyph, in px. The table font is 13.125px; this stays above it so a wide glyph is never skipped. */
const CELL_ADVANCE = 32;

export interface ColumnWidthInput {
  key: string;
  label: string;
  sorted: boolean;
  type: string;
  /** Tag, list and alias pills. Measured for the automatic width and for a fit. */
  pills?: readonly (readonly string[])[];
  /** Plain cell strings. Set only when fitting; the automatic width stays header-sized. */
  text?: readonly string[];
}

/**
 * Column width in px. Header, fixed date and pill rules are the table's
 * automatic width. `text` widens a fit to the longest plain cell. The drag
 * floor is 40; file name stays at least 78 and every other column at least 60.
 */
export function columnWidth(textWidth: (text: string) => number, column: ColumnWidthInput): number {
  let width = Math.max(column.key === "file.name" ? 78 : 60, Math.ceil(textWidth(column.label) + 34 + (column.sorted ? 16 : 0)));
  if (column.type === "date" || column.type === "datetime") return column.type === "date" ? 128 : 210;
  if (column.type === "tags" || column.type === "list" || column.type === "aliases") {
    for (const pills of column.pills ?? []) width = Math.max(width, Math.ceil(pills.reduce((sum, item) => sum + textWidth(item) + 44, 16)));
    return Math.max(40, width);
  }
  if (column.type !== "checkbox" && column.text) {
    const ranked = column.text.length > 1 ? [...column.text].sort((a, b) => b.length - a.length) : column.text;
    for (const text of ranked) {
      if (!text || text.length * CELL_ADVANCE + CELL_PAD <= width) continue;
      width = Math.max(width, Math.ceil(textWidth(text) + CELL_PAD));
    }
  }
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

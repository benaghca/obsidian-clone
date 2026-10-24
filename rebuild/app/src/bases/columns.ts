import { h } from "../shell/dom";
import { drag, dropSlot, reordered } from "./drag";
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

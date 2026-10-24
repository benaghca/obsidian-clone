// Pointer input only; one lifetime for moves, release and every cancellation path.
export function drag(e: PointerEvent, move: (e: PointerEvent) => void, end: (cancelled: boolean, e?: PointerEvent) => void) {
  const controller = new AbortController(), options = {capture:true,signal:controller.signal};
  e.preventDefault();
  const finish = (cancelled: boolean, event?: PointerEvent) => {controller.abort();end(cancelled,event);};
  window.addEventListener("pointermove",event=>{if(event.pointerId===e.pointerId)move(event);},options);
  window.addEventListener("pointerup",event=>{if(event.pointerId===e.pointerId)finish(false,event);},options);
  window.addEventListener("pointercancel",()=>finish(true),options);
  window.addEventListener("blur",()=>finish(true),options);
  window.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();finish(true);}},options);
  return ()=>finish(true);
}
export function reordered<T>(items: T[], from: number, before: number): T[] {
  const next=[...items], [item]=next.splice(from,1);
  next.splice(before-(before>from?1:0),0,item);return next;
}
export function dropSlot(elements: HTMLElement[], x: number, y: number, vertical = false): number | null {
  for(let i=0;i<elements.length;i++) {
    const r=elements[i].getBoundingClientRect();
    if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return i+Number(vertical?y>r.y+r.height/2:x>r.x+r.width/2);
  }
  return null;
}
